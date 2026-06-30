import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getFirstPlayer,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, hasScoreBladeHeart, typeIs } from '../../../effects/card-selectors.js';
import { SP_PB2_004_LIVE_SUCCESS_SCORE_CONDITION_DRAW_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { maybeStartConfirmablePendingAbilityConfirmation } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2004SumireWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_004_LIVE_SUCCESS_SCORE_CONDITION_DRAW_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options);
      if (confirmation) {
        return confirmation;
      }
      return resolveSpPb2004SumireLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function resolveSpPb2004SumireLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const higherScoreLiveCardIds = getOwnLiveZoneHigherThanOriginalScoreLiveCardIds(
    game,
    player.id
  );
  const scoreCheerLiveCardIds = getOwnCheerRevealedScoreLiveCardIds(game, player.id);
  const conditionMet = higherScoreLiveCardIds.length > 0 || scoreCheerLiveCardIds.length > 0;
  const drawResult = conditionMet ? drawCardsForPlayer(game, player.id, 1) : null;
  const stateAfterDraw = drawResult?.gameState ?? game;
  const stateWithoutPending: GameState = {
    ...stateAfterDraw,
    pendingAbilities: stateAfterDraw.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SCORE_CONDITION_DRAW',
      conditionMet,
      higherScoreLiveCardIds,
      scoreCheerLiveCardIds,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    orderedResolution
  );
}

function getOwnLiveZoneHigherThanOriginalScoreLiveCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return player.liveZone.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    if (!card || card.ownerId !== playerId || !isLiveCardData(card.data)) {
      return false;
    }

    const scoreDelta = game.liveResolution.liveModifiers.reduce((total, modifier) => {
      if (
        modifier.kind === 'SCORE' &&
        modifier.playerId === playerId &&
        modifier.liveCardId === cardId
      ) {
        return total + modifier.countDelta;
      }
      return total;
    }, 0);
    return card.data.score + scoreDelta > card.data.score;
  });
}

function getOwnCheerRevealedScoreLiveCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const firstPlayer = getFirstPlayer(game);
  const cheerCardIds =
    player.id === firstPlayer.id
      ? game.liveResolution.firstPlayerCheerCardIds
      : game.liveResolution.secondPlayerCheerCardIds;
  const isScoreLive = and(typeIs(CardType.LIVE), hasScoreBladeHeart());
  return cheerCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && isScoreLive(card);
  });
}
