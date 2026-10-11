import { isLiveCardData } from '../../../domain/entities/card.js';
import {
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
} from '../../../domain/entities/game.js';
import { removeCardFromStatefulZone } from '../../../domain/entities/zone.js';
import { removeLiveCardBoundLiveModifiers } from '../../../domain/rules/live-modifiers.js';

/** Moves the current LIVE object; its old card-bound LIVE modifiers do not follow it. */
export function moveLiveZoneCardToDeckTopForPlayer(
  game: GameState,
  playerId: string,
  selectedCardId: string,
  options: { readonly candidateCardIds: readonly string[] }
): {
  readonly gameState: GameState;
  readonly movedCardId: string;
  readonly remainingCandidateIds: readonly string[];
} | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, selectedCardId);
  if (
    !options.candidateCardIds.includes(selectedCardId) ||
    !player?.liveZone.cardIds.includes(selectedCardId) ||
    !card ||
    card.ownerId !== playerId ||
    !isLiveCardData(card.data)
  )
    return null;
  const movedState = updatePlayer(game, playerId, (current) => ({
    ...current,
    liveZone: removeCardFromStatefulZone(current.liveZone, selectedCardId),
    mainDeck: { ...current.mainDeck, cardIds: [selectedCardId, ...current.mainDeck.cardIds] },
  }));
  return {
    gameState: removeLiveCardBoundLiveModifiers(movedState, [selectedCardId]),
    movedCardId: selectedCardId,
    remainingCandidateIds: options.candidateCardIds.filter((id) => id !== selectedCardId),
  };
}
