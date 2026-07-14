import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import type { EnterStageEvent, EnterWaitingRoomEvent, LeaveStageEvent } from '../../../../domain/events/game-events.js';
import { OrientationState, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { and, cardNameAliasIs, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { clearPreviousStageMemberInstanceState, playMembersFromWaitingRoomToEmptySlots } from '../../../effects/member-state.js';
import { SP_PB1_011_ON_ENTER_REPLAY_OTHER_LIELLA_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../runtime/leave-stage-triggers.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { CardType } from '../../../../shared/types/enums.js';

const STEP = 'SP_PB1_011_SELECT_OTHER_LIELLA_MEMBER_COST';
const SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
type Continue = (game: GameState, ordered: boolean) => GameState;
type Enqueue = (game: GameState, triggers: readonly TriggerCondition[], options?: { enterStageEvents?: readonly EnterStageEvent[]; enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[]; leaveStageEvents?: readonly LeaveStageEvent[] }) => GameState;
const eligible = and(typeIs(CardType.MEMBER), groupAliasIs('Liella!'), (card) => !cardNameAliasIs('鬼塚冬毬')(card));

export function registerSpPb1011TomariWorkflowHandlers(deps: { enqueueTriggeredCardEffects: Enqueue }): void {
  registerPendingAbilityStarterHandler(SP_PB1_011_ON_ENTER_REPLAY_OTHER_LIELLA_MEMBER_ABILITY_ID, (game, ability, options, context) => start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects));
  registerActiveEffectStepHandler(SP_PB1_011_ON_ENTER_REPLAY_OTHER_LIELLA_MEMBER_ABILITY_ID, STEP, (game, input, context) => finish(game, input.selectedCardId ?? null, context.continuePendingCardEffects, deps.enqueueTriggeredCardEffects));
}

function targets(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  return SLOTS.flatMap((slot) => {
    const id = player.memberSlots.slots[slot];
    const card = id ? getCardById(game, id) : null;
    return id && card && card.ownerId === playerId && eligible(card) ? [id] : [];
  });
}

function start(game: GameState, ability: PendingAbilityState, ordered: boolean, next: Continue): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const selectable = targets(game, ability.controllerId);
  if (!player || selectable.length === 0) return consume(game, ability, ordered, next, 'NO_TARGET');
  return startPendingActiveEffect(game, { ability, playerId: player.id, activeEffect: {
    id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId), stepId: STEP,
    stepText: '可以将「鬼塚冬毬」以外的1名「Liella!」成员放置入休息室，再让该成员回到原区域。',
    awaitingPlayerId: player.id, selectableCardIds: selectable, selectableCardVisibility: 'PUBLIC',
    selectionLabel: '选择要用于支付费用的成员', confirmSelectionLabel: '放置入休息室',
    canSkipSelection: true, skipSelectionLabel: '不发动', metadata: { orderedResolution: ordered },
  }, actionPayload: { sourceCardId: ability.sourceCardId, step: 'SELECT_REPLAY_COST_MEMBER', selectableCardIds: selectable } });
}

function finish(game: GameState, selectedCardId: string | null, next: Continue, enqueue: Enqueue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== STEP) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (selectedCardId === null) return resolve({ ...game, activeEffect: null }, player.id, effect, next, { step: 'DECLINE' });
  if (!effect.selectableCardIds?.includes(selectedCardId) || !targets(game, player.id).includes(selectedCardId)) return game;
  const moved = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(game, player.id, selectedCardId, enqueue);
  if (!moved || moved.movedToWaitingRoomCardIds[0] !== selectedCardId) return game;
  let state = addAction(moved.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId,
    step: 'PAY_REPLAY_MEMBER_COST', targetCardId: selectedCardId, targetSlot: moved.sourceSlot,
    movedToWaitingRoomCardIds: moved.movedToWaitingRoomCardIds,
    enterWaitingRoomEventId: moved.enterWaitingRoomEvent.eventId,
    leaveStageEventIds: moved.leaveStageEvents.map((event) => event.eventId),
  });
  const current = getPlayerById(state, player.id);
  const exactCard = getCardById(state, selectedCardId);
  if (!current?.waitingRoom.cardIds.includes(selectedCardId) || current.memberSlots.slots[moved.sourceSlot] !== null || !exactCard || !isMemberCardData(exactCard.data)) {
    return resolve({ ...state, activeEffect: null }, player.id, effect, next, { step: 'REPLAY_TARGET_STALE', targetCardId: selectedCardId, targetSlot: moved.sourceSlot });
  }
  state = clearPreviousStageMemberInstanceState(state, player.id, selectedCardId);
  const played = playMembersFromWaitingRoomToEmptySlots(state, player.id, [{ cardId: selectedCardId, toSlot: moved.sourceSlot }], OrientationState.ACTIVE);
  if (!played) return resolve({ ...state, activeEffect: null }, player.id, effect, next, { step: 'REPLAY_FAILED', targetCardId: selectedCardId });
  state = addAction(played.gameState, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'REPLAY_EXACT_MEMBER', targetCardId: selectedCardId, targetSlot: moved.sourceSlot, playedCardId: selectedCardId });
  state = enqueue(state, [TriggerCondition.ON_ENTER_STAGE], { enterStageEvents: getNewEnterStageEvents(moved.gameState, state) });
  return next({ ...state, activeEffect: null }, effect.metadata?.orderedResolution === true);
}

function consume(game: GameState, ability: PendingAbilityState, ordered: boolean, next: Continue, step: string): GameState {
  const state = { ...game, pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id) };
  const player = getPlayerById(game, ability.controllerId);
  return player ? next(addAction(state, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, step }), ordered) : next(state, ordered);
}
function resolve(game: GameState, playerId: string, effect: NonNullable<GameState['activeEffect']>, next: Continue, payload: Record<string, unknown>): GameState {
  return next(addAction(game, 'RESOLVE_ABILITY', playerId, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, ...payload }), effect.metadata?.orderedResolution === true);
}
