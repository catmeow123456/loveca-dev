import type { CardInstance } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import {
  getCardById,
  getFirstPlayer,
  getPlayerById,
  updatePlayer,
  updateResolutionZone,
} from '../../domain/entities/game.js';
import { addCardToZone } from '../../domain/entities/zone.js';

export type CheerCardPredicate = (card: CardInstance) => boolean;
export type RevealedCheerCardDestination = 'HAND' | 'MAIN_DECK_TOP';

export interface MoveRevealedCheerCardsResult {
  readonly gameState: GameState;
  readonly movedCardIds: readonly string[];
}

export function selectRevealedCheerCardIds(
  game: GameState,
  playerId: string,
  predicate: CheerCardPredicate = () => true
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

  return cheerCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === player.id &&
      game.resolutionZone.cardIds.includes(cardId) &&
      game.resolutionZone.revealedCardIds.includes(cardId) &&
      predicate(card)
    );
  });
}

export function moveRevealedCheerCards(
  game: GameState,
  playerId: string,
  cardIds: readonly string[],
  destination: RevealedCheerCardDestination
): MoveRevealedCheerCardsResult | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }

  const uniqueCardIds = [...new Set(cardIds)];
  if (
    uniqueCardIds.length !== cardIds.length ||
    uniqueCardIds.some(
      (cardId) =>
        !game.resolutionZone.cardIds.includes(cardId) ||
        !game.resolutionZone.revealedCardIds.includes(cardId)
    )
  ) {
    return null;
  }

  let state = updateResolutionZone(game, (zone) => ({
    ...zone,
    cardIds: zone.cardIds.filter((cardId) => !uniqueCardIds.includes(cardId)),
    revealedCardIds: zone.revealedCardIds.filter((cardId) => !uniqueCardIds.includes(cardId)),
  }));

  state = updatePlayer(state, player.id, (currentPlayer) => {
    if (destination === 'HAND') {
      return {
        ...currentPlayer,
        hand: uniqueCardIds.reduce(
          (hand, cardId) => addCardToZone(hand, cardId),
          currentPlayer.hand
        ),
      };
    }

    return {
      ...currentPlayer,
      mainDeck: {
        ...currentPlayer.mainDeck,
        cardIds: [...uniqueCardIds, ...currentPlayer.mainDeck.cardIds],
      },
    };
  });

  return {
    gameState: state,
    movedCardIds: uniqueCardIds,
  };
}
