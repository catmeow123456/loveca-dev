import { addAction, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { getMemberEntryOrdinalForEvent } from '../../../../domain/rules/member-turn-state.js';
import { PL_N_BP3_005_AUTO_THIRD_MEMBER_ENTER_DRAW_TO_FIVE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp3005AiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP3_005_AUTO_THIRD_MEMBER_ENTER_DRAW_TO_FIVE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveDrawToFive(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
}

function resolveDrawToFive(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const handCountBefore = player.hand.cardIds.length;
  const requestedDrawCount = Math.max(0, 5 - handCountBefore);
  const drawResult = requestedDrawCount > 0
    ? drawCardsForPlayer(game, player.id, requestedDrawCount)
    : null;
  const drawnCardIds = drawResult?.drawnCardIds ?? [];
  const state = drawResult?.gameState ?? game;
  const enterStageEventId = ability.eventIds[0] ?? null;
  const stateWithoutPending = {
    ...state,
    pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    enterStageEventId,
    entryOrdinal: enterStageEventId
      ? getMemberEntryOrdinalForEvent(game, player.id, enterStageEventId)
      : null,
    handCountBefore,
    requestedDrawCount,
    drawnCardIds,
  }), orderedResolution);
}
