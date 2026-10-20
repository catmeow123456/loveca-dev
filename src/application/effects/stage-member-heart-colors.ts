import type { GameState } from '../../domain/entities/game.js';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
} from '../../domain/rules/live-modifiers.js';
import type { HeartColor } from '../../shared/types/enums.js';
import { getStageMemberCardIdsMatching } from './stage-targets.js';

/** Positive, effective ordinary Heart colors of the selected own top-level stage members. */
export function collectEffectiveStageMemberHeartColors(
  game: GameState,
  playerId: string,
  options: {
    readonly memberCardIds?: readonly string[];
    readonly includedColors?: readonly HeartColor[];
  } = {}
): ReadonlySet<HeartColor> {
  const selectedIds = options.memberCardIds ? new Set(options.memberCardIds) : null;
  const includedColors = options.includedColors ? new Set(options.includedColors) : null;
  const modifiers = collectLiveModifiers(game);
  const colors = new Set<HeartColor>();
  for (const memberId of getStageMemberCardIdsMatching(
    game,
    playerId,
    (card) => card.ownerId === playerId
  )) {
    if (selectedIds && !selectedIds.has(memberId)) continue;
    for (const heart of getMemberEffectiveHeartIcons(game, playerId, memberId, modifiers)) {
      if (heart.count > 0 && (!includedColors || includedColors.has(heart.color)))
        colors.add(heart.color);
    }
  }
  return colors;
}
