import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveProhibitionUntilLiveEnd } from '../../../../domain/rules/live-prohibitions.js';
import { HS_BP2_014_ON_ENTER_DRAW_CANNOT_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp2014RurinoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP2_014_ON_ENTER_DRAW_CANNOT_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsBp2014RurinoOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveHsBp2014RurinoOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawResult = drawCardsForPlayer(state, player.id, 1);
  if (!drawResult) {
    return game;
  }
  state = addLiveProhibitionUntilLiveEnd(drawResult.gameState, {
    playerId: player.id,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
  });

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DRAW_ONE_CANNOT_LIVE_UNTIL_LIVE_END',
      sourceSlot: ability.sourceSlot,
      drawnCardIds: drawResult.drawnCardIds,
      liveProhibitedPlayerId: player.id,
    }),
    orderedResolution
  );
}
