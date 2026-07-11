import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { PL_N_BP3_004_ACTIVATED_WAIT_SELF_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!N-bp3-004';
const DISCARD_STEP_ID = 'PL_N_BP3_004_SELECT_HAND_CARD_TO_DISCARD';
const RECOVER_STEP_ID = 'PL_N_BP3_004_SELECT_NIJIGASAKI_LIVE_TO_RECOVER';
const nijigasakiLiveSelector = and(typeIs(CardType.LIVE), groupAliasIs('虹ヶ咲'));

type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp3004KarinWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    PL_N_BP3_004_ACTIVATED_WAIT_SELF_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    (game, playerId, cardId) => start(game, playerId, cardId, deps)
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_004_ACTIVATED_WAIT_SELF_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    DISCARD_STEP_ID,
    (game, input, context) =>
      finishDiscard(
        game,
        input.selectedCardId ?? null,
        deps,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_004_ACTIVATED_WAIT_SELF_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    RECOVER_STEP_ID,
    (game, input, context) =>
      finishRecovery(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function start(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) return game;
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !card ||
    card.ownerId !== playerId ||
    !isMemberCardData(card.data) ||
    !cardCodeMatchesBase(card.data.cardCode, BASE_CARD_CODE) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE ||
    player.hand.cardIds.length === 0
  ) return game;

  const waitResult = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT', playerId, sourceCardId: cardId,
    abilityId: PL_N_BP3_004_ACTIVATED_WAIT_SELF_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) return game;
  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game, waitResult, deps.enqueueTriggeredCardEffects,
    { prepareGameStateBeforeEnqueue: (state, result, events) => addAction(state, 'PAY_COST', playerId, {
      abilityId: PL_N_BP3_004_ACTIVATED_WAIT_SELF_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      sourceCardId: cardId, sourceSlot, waitedMemberCardId: cardId,
      previousOrientation: result.previousOrientation, nextOrientation: result.nextOrientation,
      memberStateChangedEventIds: events.map((event) => event.eventId),
    }) }
  );
  const playerAfterWait = getPlayerById(stateWithTriggers.gameState, playerId);
  if (!playerAfterWait || playerAfterWait.hand.cardIds.length === 0) return game;
  const abilityId = PL_N_BP3_004_ACTIVATED_WAIT_SELF_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID;
  return addAction({ ...stateWithTriggers.gameState, activeEffect: {
    id: `${abilityId}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
    abilityId, sourceCardId: cardId, controllerId: playerId,
    effectText: getAbilityEffectText(abilityId), stepId: DISCARD_STEP_ID,
    stepText: '请选择1张手牌放置入休息室。之后从自己的休息室将1张『虹咲』的LIVE卡加入手牌。',
    awaitingPlayerId: playerId, selectableCardIds: playerAfterWait.hand.cardIds,
    selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    selectionLabel: '选择要放置入休息室的手牌', confirmSelectionLabel: '放置入休息室',
    canSkipSelection: false,
    metadata: { sourceSlot, memberStateChangedEventIds: stateWithTriggers.memberStateChangedEvents.map((e) => e.eventId) },
  } }, 'RESOLVE_ABILITY', playerId, { abilityId, sourceCardId: cardId, sourceSlot, step: 'START_DISCARD_COST' });
}

function finishDiscard(
  game: GameState,
  selectedCardId: string | null,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || effect.stepId !== DISCARD_STEP_ID || !player || !selectedCardId ||
      effect.selectableCardIds?.includes(selectedCardId) !== true ||
      !player.hand.cardIds.includes(selectedCardId)) return game;
  const discarded = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game, player.id, selectedCardId, { candidateCardIds: effect.selectableCardIds ?? [] },
    deps.enqueueTriggeredCardEffects
  );
  if (!discarded) return game;
  const paid = recordAbilityUseForContext(addAction(discarded.gameState, 'PAY_COST', player.id, {
    abilityId: effect.abilityId, sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot ?? null,
    discardedCardId: selectedCardId, discardedCardIds: discarded.discardedCardIds,
    enterWaitingRoomEventId: discarded.enterWaitingRoomEvent?.eventId ?? null,
  }), player.id, { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId });
  const selectableCardIds = selectWaitingRoomCardIds(paid, player.id, nijigasakiLiveSelector);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(addAction({ ...paid, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId, sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null, step: 'PAID_COST_NO_TARGET',
      waitedMemberCardId: effect.sourceCardId, discardedCardIds: discarded.discardedCardIds,
      recoveredCardIds: [], memberStateChangedEventIds: effect.metadata?.memberStateChangedEventIds,
      enterWaitingRoomEventId: discarded.enterWaitingRoomEvent?.eventId ?? null,
    }), false);
  }
  return addAction({ ...paid, activeEffect: createWaitingRoomToHandEffectState({
    id: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId,
    controllerId: player.id, effectText: effect.effectText, stepId: RECOVER_STEP_ID,
    stepText: "请选择自己休息室中1张『虹咲』的LIVE卡加入手牌。",
    awaitingPlayerId: player.id, selectableCardIds,
    selectionLabel: "选择要加入手牌的『虹咲』LIVE卡", confirmSelectionLabel: '加入手牌',
    canSkipSelection: false,
    metadata: { ...effect.metadata, discardedCardIds: discarded.discardedCardIds,
      enterWaitingRoomEventId: discarded.enterWaitingRoomEvent?.eventId ?? null },
    zoneSelection: createWaitingRoomToHandSelectionConfig({ minCount: 1, maxCount: 1, optional: false }),
  }) }, 'RESOLVE_ABILITY', player.id, {
    abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'START_RECOVERY',
    discardedCardIds: discarded.discardedCardIds, selectableCardIds,
  });
}

function finishRecovery(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || effect.stepId !== RECOVER_STEP_ID || !player || !selectedCardId ||
      effect.selectableCardIds?.includes(selectedCardId) !== true ||
      !selectWaitingRoomCardIds(game, player.id, nijigasakiLiveSelector).includes(selectedCardId)) return game;
  const recovered = recoverCardsFromWaitingRoomToHandForPlayer(game, player.id, [selectedCardId], {
    candidateCardIds: effect.selectableCardIds ?? [], exactCount: 1,
  });
  if (!recovered) return game;
  return continuePendingCardEffects(addAction({ ...recovered.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
    abilityId: effect.abilityId, sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot ?? null, step: 'RECOVER_NIJIGASAKI_LIVE',
    waitedMemberCardId: effect.sourceCardId, discardedCardIds: effect.metadata?.discardedCardIds,
    recoveredCardIds: recovered.movedCardIds,
    memberStateChangedEventIds: effect.metadata?.memberStateChangedEventIds,
    enterWaitingRoomEventId: effect.metadata?.enterWaitingRoomEventId ?? null,
  }), false);
}
