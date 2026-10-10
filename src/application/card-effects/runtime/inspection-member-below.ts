import { isMemberCardData } from '../../../domain/entities/card.js';
import {
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
} from '../../../domain/entities/game.js';
import { findMemberSlot } from '../../../domain/entities/player.js';
import { addMemberBelowMember } from '../../../domain/entities/zone.js';
import { ZoneType } from '../../../shared/types/enums.js';
import { clearInspectionCards } from '../../effects/look-top.js';

/** Moves one already revealed inspected member directly beneath its current stage host. */
export function stackInspectedMemberBelowStageMember(
  game: GameState,
  playerId: string,
  movedCardId: string,
  hostCardId: string
): { readonly gameState: GameState; readonly movedCardId: string } | null {
  const player = getPlayerById(game, playerId);
  const member = getCardById(game, movedCardId);
  const host = getCardById(game, hostCardId);
  const slot = player ? findMemberSlot(player, hostCardId) : null;
  if (
    !player ||
    !member ||
    !host ||
    slot === null ||
    member.ownerId !== playerId ||
    host.ownerId !== playerId ||
    !isMemberCardData(member.data) ||
    !isMemberCardData(host.data) ||
    game.inspectionContext?.ownerPlayerId !== playerId ||
    game.inspectionContext.sourceZone !== ZoneType.MAIN_DECK ||
    !game.inspectionZone.cardIds.includes(movedCardId) ||
    !game.inspectionZone.revealedCardIds.includes(movedCardId) ||
    Object.values(player.memberSlots.memberBelow).flat().includes(movedCardId)
  )
    return null;

  const stacked = updatePlayer(game, playerId, (current) => ({
    ...current,
    memberSlots: addMemberBelowMember(current.memberSlots, slot, movedCardId),
  }));
  return { gameState: clearInspectionCards(stacked, [movedCardId]), movedCardId };
}
