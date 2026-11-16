import { getCardActiveEffect } from '../../../../domain/entities/game.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import {
  payImmediateEffectCosts,
  type EffectCostDefinition,
} from '../../../effects/effect-costs.js';
import { getActivePrintempsMemberCardIds } from '../../../effects/special-member-play.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { PL_PB2_012_ACTIVATED_WAIT_SELF_ADDITIONAL_COST_RECOVER_PRINTEMPS_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { getAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  enqueueEnterWaitingRoomTriggersFromDiscardResult,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { waitStageMembersAndEnqueueTriggers } from '../../runtime/wait-stage-members.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const ABILITY_ID = PL_PB2_012_ACTIVATED_WAIT_SELF_ADDITIONAL_COST_RECOVER_PRINTEMPS_LIVE_ABILITY_ID;
const CHOOSE_COST = 'PL_PB2_012_CHOOSE_ADDITIONAL_COST';
const DISCARD_COST = 'PL_PB2_012_DISCARD_TWO_COST';
const WAIT_COST = 'PL_PB2_012_WAIT_TWO_PRINTEMPS_COST';
const RECOVER = 'PL_PB2_012_RECOVER_PRINTEMPS_LIVE';
type CostBranch = 'DISCARD' | 'WAIT';
type Enqueue = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlPb2012KotoriWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerActivatedAbilityHandler(ABILITY_ID, start);
  registerActiveEffectStepHandler(ABILITY_ID, CHOOSE_COST, (game, input) => {
    const effect = getCardActiveEffect(game);
    const branch = input.selectedOptionId;
    if (
      !effect ||
      !sourceIsValid(game, effect.controllerId, effect.sourceCardId, effect) ||
      (branch !== 'DISCARD' && branch !== 'WAIT') ||
      !availableBranches(game, effect.controllerId, effect.sourceCardId).includes(branch)
    )
      return game;
    return selectCost(game, effect, branch);
  });
  for (const step of [DISCARD_COST, WAIT_COST]) {
    registerActiveEffectStepHandler(ABILITY_ID, step, (game, input, context) =>
      payCost(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
    );
  }
  registerActiveEffectStepHandler(ABILITY_ID, RECOVER, (game, input, context) =>
    finishWaitingRoomToHandWorkflow(
      game,
      input.selectedCardId ?? null,
      input.selectedCardIds,
      context.continuePendingCardEffects,
      {
        currentCandidateCardIds: recoveryTargets(game, game.activeEffect?.controllerId ?? ''),
      }
    )
  );
}

function sourceIsValid(
  game: GameState,
  playerId: string,
  cardId: string,
  effect?: ActiveEffectState
): boolean {
  const card = getCardById(game, cardId);
  return (
    !!card &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!-pb2-012') &&
    getSourceMemberSlot(game, playerId, cardId) !== null &&
    getPlayerById(game, playerId)?.memberSlots.cardStates.get(cardId)?.orientation ===
      OrientationState.ACTIVE &&
    (!effect?.sourceLifecycleId ||
      effect.sourceLifecycleId === getAbilitySourceLifecycleId(game, ABILITY_ID, cardId))
  );
}

function waitTargets(game: GameState, playerId: string, sourceId: string): readonly string[] {
  return getActivePrintempsMemberCardIds(game, playerId).filter((id) => id !== sourceId);
}

function availableBranches(
  game: GameState,
  playerId: string,
  sourceId: string
): readonly CostBranch[] {
  const branches: CostBranch[] = [];
  if ((getPlayerById(game, playerId)?.hand.cardIds.length ?? 0) >= 2) branches.push('DISCARD');
  if (waitTargets(game, playerId, sourceId).length >= 2) branches.push('WAIT');
  return branches;
}

function start(game: GameState, playerId: string, cardId: string): GameState {
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !sourceIsValid(game, playerId, cardId)
  )
    return game;
  const branches = availableBranches(game, playerId, cardId);
  if (branches.length === 0) return game;
  const effect: ActiveEffectState = {
    id: `${ABILITY_ID}:${cardId}:${game.turnCount}:${game.actionSequence}`,
    abilityId: ABILITY_ID,
    sourceCardId: cardId,
    controllerId: playerId,
    effectText: getAbilityEffectText(ABILITY_ID),
    stepId: CHOOSE_COST,
    stepText: '请选择追加费用。支付时也将此成员变为待机状态。',
    awaitingPlayerId: playerId,
    selectableOptions: branches.map((id) => ({
      id,
      label: id === 'DISCARD' ? '将2张手牌放置入休息室' : '将2名Printemps成员变为待机状态',
    })),
    canSkipSelection: false,
  };
  return branches.length === 1
    ? selectCost(game, effect, branches[0]!)
    : { ...game, activeEffect: effect };
}

function selectCost(game: GameState, effect: ActiveEffectState, branch: CostBranch): GameState {
  const discard = branch === 'DISCARD';
  const effectCosts: readonly EffectCostDefinition[] = [
    { kind: 'SET_SOURCE_MEMBER_ORIENTATION', orientation: OrientationState.WAITING },
    ...(discard
      ? [
          {
            kind: 'DISCARD_HAND_TO_WAITING_ROOM' as const,
            minCount: 2,
            maxCount: 2,
            optional: false,
          },
        ]
      : []),
  ];
  return {
    ...game,
    activeEffect: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      sourceLifecycleId: effect.sourceLifecycleId,
      effectText: effect.effectText,
      stepId: discard ? DISCARD_COST : WAIT_COST,
      stepText: discard
        ? '请选择2张手牌放置入休息室，并将此成员变为待机状态。'
        : '请选择另外2名活跃状态的『Printemps』成员，与此成员一起变为待机状态。',
      awaitingPlayerId: effect.controllerId,
      selectableCardIds: discard
        ? (getPlayerById(game, effect.controllerId)?.hand.cardIds ?? [])
        : waitTargets(game, effect.controllerId, effect.sourceCardId),
      selectableCardVisibility: discard ? 'AWAITING_PLAYER_ONLY' : 'PUBLIC',
      selectionLabel: discard ? '选择要放置入休息室的手牌' : '选择变为待机状态的成员',
      confirmSelectionLabel: discard ? '放置入休息室' : '变为待机状态',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      canSkipSelection: false,
      metadata: { effectCosts },
    },
  };
}

function payCost(
  game: GameState,
  ids: readonly string[],
  enqueue: Enqueue,
  continuation: Continue
): GameState {
  const effect = getCardActiveEffect(game);
  if (
    !effect ||
    ![DISCARD_COST, WAIT_COST].includes(effect.stepId) ||
    ids.length !== 2 ||
    new Set(ids).size !== 2 ||
    ids.some((id) => !effect.selectableCardIds?.includes(id)) ||
    !sourceIsValid(game, effect.controllerId, effect.sourceCardId, effect)
  )
    return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const discard = effect.stepId === DISCARD_COST;
  const candidates = discard
    ? player.hand.cardIds
    : waitTargets(game, player.id, effect.sourceCardId);
  if (ids.some((id) => !candidates.includes(id))) return game;
  const sourcePayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'SET_SOURCE_MEMBER_ORIENTATION', orientation: OrientationState.WAITING },
  ]);
  if (
    !sourcePayment ||
    getPlayerById(sourcePayment.gameState, player.id)?.memberSlots.cardStates.get(
      effect.sourceCardId
    )?.orientation !== OrientationState.WAITING
  )
    return game;
  const discardResult = discard
    ? discardHandCardsToWaitingRoomAndEnqueueTriggers(
        sourcePayment.gameState,
        player.id,
        ids,
        { count: 2, candidateCardIds: candidates },
        (state) => state
      )
    : null;
  const waitResult = !discard
    ? waitStageMembersAndEnqueueTriggers(sourcePayment.gameState, {
        playerId: player.id,
        memberCardIds: ids,
        cause: {
          kind: 'CARD_EFFECT',
          playerId: player.id,
          sourceCardId: effect.sourceCardId,
          abilityId: ABILITY_ID,
          pendingAbilityId: effect.id,
        },
        enqueueTriggeredCardEffects: (state) => state,
      })
    : null;
  if (
    (discard && !discardResult) ||
    (!discard && waitResult?.actuallyWaitedMemberCardIds.length !== 2)
  )
    return game;
  const paid = discardResult?.gameState ?? waitResult?.gameState;
  if (!paid) return game;
  let state = recordPayCostAction(paid, player.id, {
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    sourceSlot: sourcePayment.sourceSlot,
    waitedMemberCardIds: [effect.sourceCardId, ...(waitResult?.actuallyWaitedMemberCardIds ?? [])],
    discardedHandCardIds: discardResult?.discardedCardIds ?? [],
    branch: discard ? 'DISCARD' : 'WAIT',
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
  });
  state = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    { gameState: state },
    enqueue
  ).gameState;
  if (discardResult)
    state = enqueueEnterWaitingRoomTriggersFromDiscardResult(state, discardResult, enqueue);
  const targets = recoveryTargets(state, player.id);
  if (targets.length === 0)
    return continuation(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        abilityId: ABILITY_ID,
        sourceCardId: effect.sourceCardId,
        step: 'NO_PRINTEMPS_LIVE_AFTER_COST',
        recoveredCardIds: [],
      }),
      false
    );
  return {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      effectText: effect.effectText,
      stepId: RECOVER,
      stepText: '请选择自己休息室中1张『Printemps』的LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds: targets,
      canSkipSelection: false,
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
}

function recoveryTargets(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(
    game,
    playerId,
    and(typeIs(CardType.LIVE), unitAliasIs('Printemps'))
  );
}
