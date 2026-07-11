import { isLiveCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById, updateLiveResolution, type GameState, type LiveModifierState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { clearInspectionCards, inspectTopCards } from '../../../effects/look-top.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_N_BP3_028_LIVE_START_LOOK_TOP_PER_NIJIGASAKI_REVEAL_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveInspectedCardsToDeckTopRestToWaitingRoomAndEnqueueTriggers } from '../../runtime/inspection-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ARRANGE_STEP = 'PL_N_BP3_028_ARRANGE_INSPECTED';
const REVEAL_STEP = 'PL_N_BP3_028_CONFIRM_REVEALED_TOP';
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerNBp3028TsunagaruConnectWorkflowHandlers(deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom }): void {
  registerPendingAbilityStarterHandler(PL_N_BP3_028_LIVE_START_LOOK_TOP_PER_NIJIGASAKI_REVEAL_LIVE_SCORE_ABILITY_ID, (game, ability, options, context) => start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects));
  registerActiveEffectStepHandler(PL_N_BP3_028_LIVE_START_LOOK_TOP_PER_NIJIGASAKI_REVEAL_LIVE_SCORE_ABILITY_ID, ARRANGE_STEP, (game, input, context) => finishArrange(game, input.selectedCardIds ?? [], context.continuePendingCardEffects, deps.enqueueTriggeredCardEffects));
  registerActiveEffectStepHandler(PL_N_BP3_028_LIVE_START_LOOK_TOP_PER_NIJIGASAKI_REVEAL_LIVE_SCORE_ABILITY_ID, REVEAL_STEP, (game, _input, context) => finishReveal(game, context.continuePendingCardEffects, deps.enqueueTriggeredCardEffects));
}

function sourceValid(game: GameState, playerId: string, sourceCardId: string): boolean {
  return getPlayerById(game, playerId)?.liveZone.cardIds.includes(sourceCardId) === true;
}

function start(game: GameState, ability: PendingAbilityState, ordered: boolean, cont: Continue): GameState {
  if (!sourceValid(game, ability.controllerId, ability.sourceCardId)) return consume(game, ability, ordered, cont, 'SOURCE_LEFT_LIVE_ZONE');
  const count = getStageMemberCardIdsMatching(game, ability.controllerId, and(typeIs(CardType.MEMBER), groupAliasIs('虹ヶ咲'))).length;
  if (count === 0) return startReveal(game, ability, ordered, count, cont);
  const inspection = inspectTopCards(game, ability.controllerId, { count, viewerPlayerId: ability.controllerId });
  if (!inspection || inspection.inspectedCardIds.length === 0) return startReveal(game, ability, ordered, count, cont);
  return startPendingActiveEffect(inspection.gameState, { ability, playerId: ability.controllerId, activeEffect: {
    id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId), stepId: ARRANGE_STEP,
    stepText: `检视了卡组顶的${inspection.inspectedCardIds.length}张卡。请选择至多1张放回卡组顶，其余放置入休息室。`, awaitingPlayerId: ability.controllerId,
    inspectionCardIds: inspection.inspectedCardIds, selectableCardIds: inspection.inspectedCardIds, selectableCardVisibility: 'AWAITING_PLAYER_ONLY', selectableCardMode: 'ORDERED_MULTI',
    minSelectableCards: 1, maxSelectableCards: 1, selectionLabel: '选择要放置于卡组顶的卡', confirmSelectionLabel: '放置于卡组顶', canSkipSelection: true, skipSelectionLabel: '全部放置入休息室',
    metadata: { orderedResolution: ordered, nijigasakiMemberCount: count },
  }, actionPayload: { sourceCardId: ability.sourceCardId, step: 'INSPECT_TOP_PER_NIJIGASAKI_MEMBER', inspectedCardIds: inspection.inspectedCardIds, nijigasakiMemberCount: count } });
}

function finishArrange(game: GameState, selected: readonly string[], cont: Continue, enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== PL_N_BP3_028_LIVE_START_LOOK_TOP_PER_NIJIGASAKI_REVEAL_LIVE_SCORE_ABILITY_ID || effect.stepId !== ARRANGE_STEP) return game;
  const inspected = effect.inspectionCardIds ?? [];
  const validInspection = inspected.length > 0 && inspected.every((id) => game.inspectionZone.cardIds.includes(id));
  if (!sourceValid(game, effect.controllerId, effect.sourceCardId) || !validInspection) {
    const cleanup = safelyReturnCurrentInspectionCards(game, effect.controllerId, inspected, enqueue);
    return consumeEffect(cleanup, effect, cont, sourceValid(game, effect.controllerId, effect.sourceCardId) ? 'STALE_INSPECTION' : 'SOURCE_LEFT_DURING_INSPECTION');
  }
  if (selected.length > 1 || new Set(selected).size !== selected.length || selected.some((id) => !inspected.includes(id))) return game;
  const waiting = inspected.filter((id) => !selected.includes(id));
  const moved = moveInspectedCardsToDeckTopRestToWaitingRoomAndEnqueueTriggers({ ...game, activeEffect: null }, effect.controllerId, inspected, selected, waiting, enqueue);
  if (!moved) return game;
  const ability: PendingAbilityState = { id: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, controllerId: effect.controllerId, mandatory: true, timingId: effect.id, eventIds: [] };
  return startReveal(moved.gameState, ability, effect.metadata?.orderedResolution === true, Number(effect.metadata?.nijigasakiMemberCount ?? 0), cont);
}

function startReveal(game: GameState, ability: PendingAbilityState, ordered: boolean, count: number, cont: Continue): GameState {
  if (!sourceValid(game, ability.controllerId, ability.sourceCardId)) return consume(game, ability, ordered, cont, 'SOURCE_LEFT_BEFORE_REVEAL');
  const inspection = inspectTopCards(game, ability.controllerId, { count: 1, reveal: true });
  if (!inspection || inspection.inspectedCardIds.length === 0) return consume(game, ability, ordered, cont, 'NO_CARD_TO_REVEAL');
  return startPendingActiveEffect(inspection.gameState, { ability, playerId: ability.controllerId, activeEffect: {
    id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId), stepId: REVEAL_STEP, stepText: '已公开自己卡组顶的1张卡。确认后将其放回卡组顶并结算分数。', awaitingPlayerId: ability.controllerId,
    inspectionCardIds: inspection.inspectedCardIds, revealedCardIds: inspection.inspectedCardIds, selectableCardIds: [], selectableCardVisibility: 'PUBLIC', selectionLabel: '公开的卡片', confirmSelectionLabel: '确认公开结果', canSkipSelection: false,
    metadata: { orderedResolution: ordered, nijigasakiMemberCount: count },
  }, actionPayload: { sourceCardId: ability.sourceCardId, step: 'REVEAL_CURRENT_DECK_TOP', revealedCardIds: inspection.inspectedCardIds } });
}

function finishReveal(game: GameState, cont: Continue, enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== PL_N_BP3_028_LIVE_START_LOOK_TOP_PER_NIJIGASAKI_REVEAL_LIVE_SCORE_ABILITY_ID || effect.stepId !== REVEAL_STEP) return game;
  const revealed = effect.inspectionCardIds ?? [];
  if (revealed.length !== 1 || !game.inspectionZone.cardIds.includes(revealed[0])) {
    const cleanup = safelyReturnCurrentInspectionCards(game, effect.controllerId, revealed, enqueue);
    return consumeEffect(cleanup, effect, cont, 'STALE_REVEALED_CARD');
  }
  const revealedCard = getCardById(game, revealed[0]);
  const live = revealedCard !== null && isLiveCardData(revealedCard.data);
  const restored = moveInspectedCardsToDeckTopRestToWaitingRoomAndEnqueueTriggers({ ...game, activeEffect: null }, effect.controllerId, revealed, revealed, [], enqueue);
  if (!restored) return game;
  const valid = sourceValid(restored.gameState, effect.controllerId, effect.sourceCardId);
  const state = valid && live ? replaceSourceScore(restored.gameState, effect.controllerId, effect.sourceCardId, effect.abilityId, 1) : restored.gameState;
  return cont(addAction(state, 'RESOLVE_ABILITY', effect.controllerId, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: valid ? 'REVEAL_TOP_RESOLVED' : 'SOURCE_LEFT_DURING_REVEAL', revealedCardId: revealed[0], revealedLive: live, scoreBonus: valid && live ? 1 : 0 }), effect.metadata?.orderedResolution === true);
}

function replaceSourceScore(game: GameState, playerId: string, sourceCardId: string, abilityId: string, count: number): GameState {
  const previous = game.liveResolution.liveModifiers.filter((m) => m.kind === 'SCORE' && m.playerId === playerId && m.liveCardId === sourceCardId && m.sourceCardId === sourceCardId && m.abilityId === abilityId).reduce((n, m) => n + (m.kind === 'SCORE' ? m.countDelta : 0), 0);
  const replacement: Extract<LiveModifierState, { kind: 'SCORE' }> = { kind: 'SCORE', playerId, countDelta: count, liveCardId: sourceCardId, sourceCardId, abilityId };
  const state = replaceLiveModifier(game, { kind: 'SCORE', playerId, liveCardId: sourceCardId, sourceCardId, abilityId }, replacement);
  const delta = count - previous;
  return delta === 0 ? state : updateLiveResolution(state, (liveResolution) => { const scores = new Map(liveResolution.playerScores); scores.set(playerId, (scores.get(playerId) ?? 0) + delta); return { ...liveResolution, playerScores: scores }; });
}

function safelyReturnCurrentInspectionCards(
  game: GameState,
  playerId: string,
  originalCardIds: readonly string[],
  enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const remainingCardIds = originalCardIds.filter((cardId) =>
    game.inspectionZone.cardIds.includes(cardId)
  );
  const stateWithoutEffect = { ...game, activeEffect: null };
  if (remainingCardIds.length === 0) {
    return clearInspectionCards(stateWithoutEffect, originalCardIds);
  }
  const restored = moveInspectedCardsToDeckTopRestToWaitingRoomAndEnqueueTriggers(
    stateWithoutEffect,
    playerId,
    remainingCardIds,
    remainingCardIds,
    [],
    enqueue
  );
  return clearInspectionCards(restored?.gameState ?? stateWithoutEffect, originalCardIds);
}

function consume(game: GameState, ability: PendingAbilityState, ordered: boolean, cont: Continue, step: string): GameState { return cont(addAction({ ...game, pendingAbilities: game.pendingAbilities.filter((x) => x.id !== ability.id) }, 'RESOLVE_ABILITY', ability.controllerId, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, step }), ordered); }
function consumeEffect(game: GameState, effect: NonNullable<GameState['activeEffect']>, cont: Continue, step: string): GameState { return cont(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step }), effect.metadata?.orderedResolution === true); }
