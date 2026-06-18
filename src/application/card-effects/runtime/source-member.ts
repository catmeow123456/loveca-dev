import { getPlayerById, type GameState } from '../../../domain/entities/game.js';
import { findMemberSlot } from '../../../domain/entities/player.js';
import type { SlotPosition } from '../../../shared/types/enums.js';

export function getSourceMemberSlot(
  game: GameState,
  playerId: string,
  sourceCardId: string
): SlotPosition | null {
  const player = getPlayerById(game, playerId);
  return player ? findMemberSlot(player, sourceCardId) : null;
}
