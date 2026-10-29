import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType, GamePhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { N_BP8_005_ACTIVATED_TAP_ENERGY_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_MEMBER_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActivatedAbilityEnergyResumeValidator } from '../../runtime/activated-ability-energy-resume-validator.js';
import { stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers } from '../../runtime/energy-below-placement-triggers.js';
import {
  isDirectOrGrantedActivatedAbilitySource,
  isGrantedActivatedAbilityInstance,
} from '../../runtime/granted-member-below-abilities.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const BASE_CODES = ['PL!N-bp8-005'] as const;
const SELECT_MEMBER = 'N_BP8_005_SELECT_NIJIGASAKI_MEMBER';
const memberSelector = and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'));
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp8005AiWorkflowHandlers(): void {
  registerActivatedAbilityHandler(ABILITY_ID, start, canStart);
  registerActivatedAbilityEnergyResumeValidator(ABILITY_ID, canResumePayment);
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SELECT_MEMBER,
    (game, input, context) =>
      finishRecovery(game, input.selectedCardId ?? null, context.continuePendingCardEffects),
    queryCardSelection
  );
}

function canStart(game: GameState, playerId: string, sourceCardId: string): boolean {
  const source = getCardById(game, sourceCardId);
  const player = getPlayerById(game, playerId);
  return (
    !game.activeEffect &&
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId &&
    !!player &&
    !!source &&
    source.ownerId === playerId &&
    isMemberCardData(source.data) &&
    findMemberSlot(player, sourceCardId) !== null &&
    isDirectOrGrantedActivatedAbilitySource(game, playerId, sourceCardId, ABILITY_ID, BASE_CODES) &&
    getEnergySelectionCandidates(game, playerId, 'TAP_ACTIVE_ENERGY').length >= 1
  );
}

function canResumePayment(game: GameState, invocation: ActiveEffectState): boolean {
  if (
    !isCurrentStageMemberAbilitySource(game, invocation) ||
    !isDirectOrGrantedActivatedAbilitySource(
      game,
      invocation.controllerId,
      invocation.sourceCardId,
      ABILITY_ID,
      BASE_CODES
    )
  )
    return false;
  return invocation.abilityInstanceId !== undefined
    ? isGrantedActivatedAbilityInstance(
        game,
        invocation.controllerId,
        invocation.sourceCardId,
        ABILITY_ID,
        invocation.abilityInstanceId
      )
    : cardCodeMatchesBase(
        getCardById(game, invocation.sourceCardId)?.data.cardCode ?? '',
        BASE_CODES[0]
      );
}

function start(game: GameState, playerId: string, sourceCardId: string): GameState {
  if (!canStart(game, playerId, sourceCardId)) return game;
  const sourceSlot = findMemberSlot(getPlayerById(game, playerId)!, sourceCardId)!;

  // Both costs are one transaction. A second special-energy request replays from
  // the original state with prior selections; no payment or use is committed here.
  const payment = payImmediateEffectCosts(game, playerId, sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!payment) return game;
  const stacked = stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers(
    payment.gameState,
    playerId,
    sourceSlot,
    1,
    { kind: 'CARD_EFFECT', playerId, sourceCardId, abilityId: ABILITY_ID }
  );
  if (!stacked || stacked.stackedEnergyCardIds.length !== 1) return game;

  let state = recordPayCostAction(stacked.gameState, playerId, {
    abilityId: ABILITY_ID,
    sourceCardId,
    sourceSlot,
    energyCardIds: payment.paidEnergyCardIds,
    paidEnergyCardIds: payment.paidEnergyCardIds,
    stackedEnergyCardIds: stacked.stackedEnergyCardIds,
    amount: 1,
    costType: 'TAP_ENERGY_AND_STACK_ENERGY_BELOW',
  });
  state = recordAbilityUseForContext(state, playerId, { abilityId: ABILITY_ID, sourceCardId });
  const targets = selectWaitingRoomCardIds(state, playerId, memberSelector);
  if (targets.length === 0) {
    return addAction(state, 'RESOLVE_ABILITY', playerId, {
      abilityId: ABILITY_ID,
      sourceCardId,
      step: 'NO_TARGET_AFTER_COST',
      paidEnergyCardIds: payment.paidEnergyCardIds,
      stackedEnergyCardIds: stacked.stackedEnergyCardIds,
      recoveredCardIds: [],
    });
  }
  return {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: `${ABILITY_ID}:${sourceCardId}:recover:${state.actionHistory.length}`,
      abilityId: ABILITY_ID,
      sourceCardId,
      controllerId: playerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: SELECT_MEMBER,
      stepText: '请选择自己的休息室中1张『虹咲』的成员卡加入手牌。',
      awaitingPlayerId: playerId,
      selectableCardIds: targets,
      selectionLabel: '选择要加入手牌的成员卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        sourceSlot,
        paidEnergyCardIds: payment.paidEnergyCardIds,
        stackedEnergyCardIds: stacked.stackedEnergyCardIds,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
}

function finishRecovery(game: GameState, selectedCardId: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== SELECT_MEMBER ||
    !selectedCardId
  )
    return game;
  const targets = selectWaitingRoomCardIds(game, effect.controllerId, memberSelector);
  const recovery = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    effect.controllerId,
    [selectedCardId],
    {
      candidateCardIds: (effect.selectableCardIds ?? []).filter((id) => targets.includes(id)),
      exactCount: 1,
    }
  );
  if (!recovery && !wasRestoredAfterPublicCardSelectionConfirmation(effect)) return game;
  const state = recovery?.gameState ?? game;
  return next(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_NIJIGASAKI_MEMBER',
      recoveredCardIds: recovery?.movedCardIds ?? [],
    }),
    effect.metadata?.orderedResolution === true
  );
}
