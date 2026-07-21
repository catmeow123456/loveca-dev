import { isLiveCardData } from '../entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../entities/game.js';

export const CheerDeckEdge = {
  TOP: 'TOP',
  BOTTOM: 'BOTTOM',
} as const;

export type CheerDeckEdge = (typeof CheerDeckEdge)[keyof typeof CheerDeckEdge];

const BOTTOM_CHEER_LIVE_CARD_CODES = new Set(['PL!S-bp7-022-SECL']);

/** Returns the edge used by this player's next individual cheer reveal. */
export function getCheerDeckEdgeForPlayer(game: GameState, playerId: string): CheerDeckEdge {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return CheerDeckEdge.TOP;
  }

  const usesBottom = [...new Set(player.liveZone.cardIds)].some((liveCardId) => {
    const card = getCardById(game, liveCardId);
    return (
      card !== null &&
      card.ownerId === player.id &&
      isLiveCardData(card.data) &&
      BOTTOM_CHEER_LIVE_CARD_CODES.has(card.data.cardCode) &&
      player.liveZone.cardIds.includes(card.instanceId)
    );
  });

  return usesBottom ? CheerDeckEdge.BOTTOM : CheerDeckEdge.TOP;
}
