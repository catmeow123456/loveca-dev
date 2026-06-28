import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { stackEnergyFromEnergyZoneBelowMember } from '../../../effects/energy-below.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID } from '../../ability-ids.js';

const SELECT_RECOVERY_STEP_ID = 'PL_N_PB1_011_SELECT_NIJIGASAKI_LIVE_TO_HAND';

const nijigasakiLiveSelector = and(typeIs(CardType.LIVE), groupAliasIs('虹ヶ咲'));

export function registerNPb1011MiaWorkflowHandlers(): void {
  registerActivatedAbilityHandler(
    PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    startMiaStackEnergyRecoverNijigasakiLive
  );
  registerActiveEffectStepHandler(
    PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    SELECT_RECOVERY_STEP_ID,
    (game, input) => finishMiaRecovery(game, input.selectedCardId ?? null)
  );
}

function startMiaStackEnergyRecoverNijigasakiLive(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-pb1-011') ||
    sourceSlot === null ||
    player.energyZone.cardIds.length === 0
  ) {
    return game;
  }

  const stackResult = stackEnergyFromEnergyZoneBelowMember(game, player.id, sourceSlot, 1);
  if (!stackResult) {
    return game;
  }

  let state = stackResult.gameState;
  state = recordPayCostAction(state, player.id, {
    abilityId: PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    sourceCardId: cardId,
    sourceSlot,
    costType: 'STACK_ENERGY_BELOW',
    energyCardId: stackResult.stackedEnergyCardIds[0] ?? null,
    stackedEnergyCardIds: stackResult.stackedEnergyCardIds,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    sourceCardId: cardId,
  });

  const selectableCardIds = selectWaitingRoomCardIds(state, player.id, nijigasakiLiveSelector);
  if (selectableCardIds.length === 0) {
    return addMiaResolveAction(state, player.id, cardId, {
      sourceSlot,
      stackedEnergyCardIds: stackResult.stackedEnergyCardIds,
      recoveryCandidateCardIds: selectableCardIds,
      selectedCardIds: [],
    });
  }

  return {
    ...state,
    activeEffect: {
      ...createWaitingRoomToHandEffectState({
        id: `${PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID}:${cardId}:recover:action-${state.actionHistory.length}`,
        abilityId: PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
        ),
        stepId: SELECT_RECOVERY_STEP_ID,
        stepText: '请选择自己休息室1张「虹ヶ咲」LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        canSkipSelection: false,
        metadata: {
          sourceSlot,
          stackedEnergyCardIds: stackResult.stackedEnergyCardIds,
          recoveryCandidateCardIds: selectableCardIds,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
      selectionLabel: '选择加入手牌的虹咲LIVE',
      confirmSelectionLabel: '加入手牌',
    },
  };
}

function finishMiaRecovery(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_RECOVERY_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  return resolveMiaRecovery(game, [selectedCardId], effect.metadata);
}

function resolveMiaRecovery(
  game: GameState,
  selectedCardIds: readonly string[],
  metadata: NonNullable<GameState['activeEffect']>['metadata'] | undefined
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const candidateCardIds = getStringArray(metadata?.recoveryCandidateCardIds);
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    selectedCardIds,
    candidateCardIds.length > 0
      ? { candidateCardIds, exactCount: 1 }
      : { candidateCardIds, exactCount: 0 }
  );
  if (!recoveryResult) {
    return game;
  }

  return addAction(
    {
      ...recoveryResult.gameState,
      activeEffect: null,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: metadata?.sourceSlot ?? null,
      step: 'STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE',
      paidEnergyCardId: getStringArray(metadata?.stackedEnergyCardIds)[0] ?? null,
      stackedEnergyCardIds: getStringArray(metadata?.stackedEnergyCardIds),
      selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      selectedCardIds: recoveryResult.movedCardIds,
      recoveryCandidateCardIds: candidateCardIds,
    }
  );
}

function addMiaResolveAction(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  payload: {
    readonly sourceSlot: SlotPosition;
    readonly stackedEnergyCardIds: readonly string[];
    readonly recoveryCandidateCardIds: readonly string[];
    readonly selectedCardIds: readonly string[];
  }
): GameState {
  return addAction(
    {
      ...game,
      activeEffect: null,
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: PL_N_PB1_011_ACTIVATED_STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      sourceCardId,
      sourceSlot: payload.sourceSlot,
      step: 'STACK_ENERGY_BELOW_RECOVER_NIJIGASAKI_LIVE',
      paidEnergyCardId: payload.stackedEnergyCardIds[0] ?? null,
      stackedEnergyCardIds: payload.stackedEnergyCardIds,
      selectedCardId: payload.selectedCardIds[0] ?? null,
      selectedCardIds: payload.selectedCardIds,
      recoveryCandidateCardIds: payload.recoveryCandidateCardIds,
    }
  );
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
