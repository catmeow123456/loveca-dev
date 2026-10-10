import { getPlayerById, type GameState } from '../../../domain/entities/game.js';
import { findMemberSlot } from '../../../domain/entities/player.js';
import type { SlotPosition } from '../../../shared/types/enums.js';
import { getStageMemberLifecycleId } from './ability-source-lifecycle.js';

export function getSourceMemberSlot(
  game: GameState,
  playerId: string,
  sourceCardId: string
): SlotPosition | null {
  const player = getPlayerById(game, playerId);
  return player ? findMemberSlot(player, sourceCardId) : null;
}

/** A captured invocation must not transfer self-actions to a re-entered rules object. */
export function isCurrentStageMemberAbilitySource(
  game: GameState,
  context: {
    readonly controllerId: string;
    readonly sourceCardId: string;
    readonly sourceLifecycleId?: string;
  }
): boolean {
  return (
    getSourceMemberSlot(game, context.controllerId, context.sourceCardId) !== null &&
    (context.sourceLifecycleId === undefined ||
      getStageMemberLifecycleId(game, context.sourceCardId) === context.sourceLifecycleId)
  );
}
