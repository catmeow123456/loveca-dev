import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById, updateLiveResolution, type GameState, type LiveModifierState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForMember, replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { PL_N_BP3_009_LIVE_START_BOTTOM_TWO_WAITING_MEMBERS_COST_SUM_REWARD_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { drawCardsForPlayer, moveWaitingRoomCardsToDeckBottomForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_STEP_ID = 'PL_N_BP3_009_SELECT_TWO_WAITING_MEMBERS';
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerNBp3009RinaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(PL_N_BP3_009_LIVE_START_BOTTOM_TWO_WAITING_MEMBERS_COST_SUM_REWARD_ABILITY_ID, (game, ability, options, context) => start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects));
  registerActiveEffectStepHandler(PL_N_BP3_009_LIVE_START_BOTTOM_TWO_WAITING_MEMBERS_COST_SUM_REWARD_ABILITY_ID, SELECT_STEP_ID, (game, input, context) => finish(game, input.selectedCardIds ?? [], context.continuePendingCardEffects));
}

function candidates(game: GameState, playerId: string): string[] {
  const player = getPlayerById(game, playerId);
  return player?.waitingRoom.cardIds.filter((id) => {
    const card = getCardById(game, id);
    return card !== null && isMemberCardData(card.data);
  }) ?? [];
}

function sourceValid(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  return !!player && Object.values(player.memberSlots.slots).includes(sourceCardId);
}

function start(game: GameState, ability: PendingAbilityState, ordered: boolean, cont: Continue): GameState {
  const ids = candidates(game, ability.controllerId);
  if (!sourceValid(game, ability.controllerId, ability.sourceCardId) || ids.length < 2) return consume(game, ability, ordered, cont, 'NO_LEGAL_PAYMENT');
  return startPendingActiveEffect(game, { ability, playerId: ability.controllerId, activeEffect: {
    id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId), stepId: SELECT_STEP_ID,
    stepText: '可以从自己的休息室选择恰好2张成员卡，按选择顺序放置于卡组底。', awaitingPlayerId: ability.controllerId,
    selectableCardIds: ids, selectableCardVisibility: 'PUBLIC', selectableCardMode: 'ORDERED_MULTI', minSelectableCards: 2, maxSelectableCards: 2,
    selectionLabel: '选择要放置于卡组底的成员卡', confirmSelectionLabel: '按此顺序放置', canSkipSelection: true, skipSelectionLabel: '不发动',
    metadata: {
      publicCardSelectionConfirmation: { destination: 'MAIN_DECK_BOTTOM', ordered: true },
      orderedResolution: ordered,
      candidateCardIds: ids,
    },
  }, actionPayload: { sourceCardId: ability.sourceCardId, step: 'SELECT_TWO_WAITING_MEMBERS', selectableCardIds: ids } });
}

function finish(game: GameState, selected: readonly string[], cont: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== PL_N_BP3_009_LIVE_START_BOTTOM_TWO_WAITING_MEMBERS_COST_SUM_REWARD_ABILITY_ID || effect.stepId !== SELECT_STEP_ID) return game;
  const current = candidates(game, effect.controllerId);
  if (!sourceValid(game, effect.controllerId, effect.sourceCardId)) return consumeEffect(game, effect, cont, 'SOURCE_LEFT_STAGE');
  if (selected.length === 0) return consumeEffect(game, effect, cont, 'DECLINED');
  const legal = selected.length === 2 && new Set(selected).size === 2 && selected.every((id) => current.includes(id));
  if (!legal) {
    if (current.length < 2) return consumeEffect(game, effect, cont, 'STALE_NO_PAYMENT');
    const old = effect.metadata?.candidateCardIds;
    const stale = Array.isArray(old) && old.some((id) => typeof id === 'string' && !current.includes(id));
    return stale ? { ...game, activeEffect: { ...effect, selectableCardIds: current, metadata: { ...effect.metadata, candidateCardIds: current } } } : game;
  }
  const costs = selected.map((id) => getCardById(game, id)?.data).filter((data): data is NonNullable<typeof data> => data !== undefined).filter(isMemberCardData).map((data) => data.cost);
  if (costs.length !== 2) return game;
  const moved = moveWaitingRoomCardsToDeckBottomForPlayer({ ...game, activeEffect: null }, effect.controllerId, selected, { candidateCardIds: current, minCount: 2, maxCount: 2 });
  if (!moved) return game;
  const sum = costs[0] + costs[1];
  let state = moved.gameState;
  if (sum === 6) state = drawCardsForPlayer(state, effect.controllerId, 1)?.gameState ?? state;
  if (sum === 8) state = addHeartLiveModifierForMember(state, { playerId: effect.controllerId, memberCardId: effect.sourceCardId, hearts: [{ color: HeartColor.RAINBOW, count: 1 }], sourceCardId: effect.sourceCardId, abilityId: effect.abilityId })?.gameState ?? state;
  if (sum === 25) state = replacePlayerScore(state, effect.controllerId, effect.sourceCardId, effect.abilityId, 1);
  return cont(addAction(state, 'RESOLVE_ABILITY', effect.controllerId, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'BOTTOM_TWO_COST_SUM_REWARD', movedCardIds: selected, costSum: sum }), effect.metadata?.orderedResolution === true);
}

function replacePlayerScore(game: GameState, playerId: string, sourceCardId: string, abilityId: string, count: number): GameState {
  const previous = game.liveResolution.liveModifiers.filter((m) => m.kind === 'SCORE' && m.playerId === playerId && !m.liveCardId && m.sourceCardId === sourceCardId && m.abilityId === abilityId).reduce((n, m) => n + (m.kind === 'SCORE' ? m.countDelta : 0), 0);
  const replacement: Extract<LiveModifierState, { kind: 'SCORE' }> = { kind: 'SCORE', playerId, countDelta: count, sourceCardId, abilityId };
  const state = replaceLiveModifier(game, { kind: 'SCORE', playerId, sourceCardId, abilityId }, replacement);
  const delta = count - previous;
  return delta === 0 ? state : updateLiveResolution(state, (live) => { const scores = new Map(live.playerScores); scores.set(playerId, (scores.get(playerId) ?? 0) + delta); return { ...live, playerScores: scores }; });
}

function consume(game: GameState, ability: PendingAbilityState, ordered: boolean, cont: Continue, step: string): GameState {
  return cont(addAction({ ...game, pendingAbilities: game.pendingAbilities.filter((x) => x.id !== ability.id) }, 'RESOLVE_ABILITY', ability.controllerId, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, step }), ordered);
}
function consumeEffect(game: GameState, effect: NonNullable<GameState['activeEffect']>, cont: Continue, step: string): GameState {
  return cont(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step }), effect.metadata?.orderedResolution === true);
}
