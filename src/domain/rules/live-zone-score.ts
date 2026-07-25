import { isLiveCardData } from '../entities/card.js';
import type { GameState } from '../entities/game.js';
import { getCardById, getPlayerById } from '../entities/game.js';
import { collectLiveModifiers, getLiveCardScoreModifier } from './live-modifiers.js';

export interface LiveZoneCardEffectiveScore {
  readonly cardId: string;
  readonly printedScore: number;
  readonly scoreModifier: number;
  readonly effectiveScore: number;
}

/**
 * Returns the effective score of each legal LIVE card in one player's LIVE zone.
 *
 * Only SCORE modifiers bound to the concrete LIVE-card instance are included.
 * Player-total SCORE modifiers, cheer results and mutable score drafts are
 * deliberately outside this query.
 */
export function getLiveZoneCardEffectiveScores(
  game: GameState,
  playerId: string
): readonly LiveZoneCardEffectiveScore[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const liveModifiers = collectLiveModifiers(game);
  return [...new Set(player.liveZone.cardIds)].flatMap((cardId) => {
    const card = getCardById(game, cardId);
    if (!card || card.ownerId !== playerId || !isLiveCardData(card.data)) {
      return [];
    }

    const scoreModifier = getLiveCardScoreModifier(game.liveResolution, cardId, liveModifiers);
    return [
      {
        cardId,
        printedScore: card.data.score,
        scoreModifier,
        effectiveScore: Math.max(0, card.data.score + scoreModifier),
      },
    ];
  });
}

export function sumLiveZoneCardEffectiveScore(game: GameState, playerId: string): number {
  return getLiveZoneCardEffectiveScores(game, playerId).reduce(
    (total, { effectiveScore }) => total + effectiveScore,
    0
  );
}
