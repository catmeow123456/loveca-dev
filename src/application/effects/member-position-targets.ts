import { isMemberCardData } from '../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../domain/entities/game.js';
import { SlotPosition } from '../../shared/types/enums.js';
import { groupAliasIs } from './card-selectors.js';

/** Other occupied stage areas whose current top member belongs to any requested group. */
export function getOtherStageMemberSlotsWithGroupMember(
  game: GameState,
  playerId: string,
  sourceSlot: SlotPosition,
  targetGroupAliases: readonly string[]
): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];

  return (Object.values(SlotPosition) as SlotPosition[]).filter((slot) => {
    if (slot === sourceSlot) return false;
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return (
      card !== null &&
      card.ownerId === playerId &&
      isMemberCardData(card.data) &&
      targetGroupAliases.some((groupName) => groupAliasIs(groupName)(card))
    );
  });
}
