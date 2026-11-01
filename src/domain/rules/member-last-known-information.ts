import { getCardById, getPlayerById, type GameState } from '../entities/game.js';
import { isMemberCardData } from '../entities/card.js';
import { findMemberSlot } from '../entities/player.js';
import type { MemberLastKnownInformation } from '../events/game-events.js';
import { getMemberEffectiveBladeCount } from './live-modifiers.js';
import { getMemberEffectiveCost } from './member-effective-cost.js';

/** Rule 9.11: capture while the old member and all its modifiers still exist. */
export function captureMemberLastKnownInformation(
  game: GameState,
  controllerId: string,
  memberCardId: string
): MemberLastKnownInformation | undefined {
  const player = getPlayerById(game, controllerId);
  const card = getCardById(game, memberCardId);
  if (
    !player ||
    !card ||
    !isMemberCardData(card.data) ||
    findMemberSlot(player, memberCardId) === null
  )
    return undefined;
  return {
    effectiveBlade: getMemberEffectiveBladeCount(game, controllerId, memberCardId),
    effectiveCost: getMemberEffectiveCost(game, controllerId, memberCardId),
  };
}
