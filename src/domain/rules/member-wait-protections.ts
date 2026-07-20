import { isMemberCardData } from '../entities/card.js';
import {
  getCardById,
  getPlayerById,
  type GameState,
  type MemberWaitProtectionState,
} from '../entities/game.js';
import type { MemberStateChangeCause } from '../events/game-events.js';
import { cardBelongsToGroup } from '../../shared/utils/card-identity.js';

export function addMemberWaitProtectionUntilLiveEnd(
  game: GameState,
  protection: Omit<MemberWaitProtectionState, 'expiresAt' | 'memberGroupAlias' | 'maxPrintedBlade'>
): GameState {
  const next: MemberWaitProtectionState = {
    ...protection,
    expiresAt: 'LIVE_END',
    memberGroupAlias: 'Aqours',
    maxPrintedBlade: 3,
  };
  const remaining = (game.memberWaitProtections ?? []).filter(
    (candidate) =>
      candidate.affectedPlayerId !== next.affectedPlayerId ||
      candidate.sourceCardId !== next.sourceCardId ||
      candidate.abilityId !== next.abilityId
  );
  return { ...game, memberWaitProtections: [...remaining, next] };
}

export function isMemberWaitProtectedFromChange(
  game: GameState,
  affectedPlayerId: string,
  memberCardId: string,
  cause: MemberStateChangeCause | undefined
): boolean {
  if (
    cause?.kind !== 'CARD_EFFECT' ||
    cause.playerId === affectedPlayerId ||
    cause.selectionPlayerId === affectedPlayerId
  ) {
    return false;
  }
  const protections = (game.memberWaitProtections ?? []).filter(
    (candidate) => candidate.affectedPlayerId === affectedPlayerId
  );
  if (protections.length === 0) return false;

  const player = getPlayerById(game, affectedPlayerId);
  const card = getCardById(game, memberCardId);
  if (
    !player ||
    !card ||
    card.ownerId !== affectedPlayerId ||
    !isMemberCardData(card.data) ||
    !Object.values(player.memberSlots.slots).includes(memberCardId)
  ) {
    return false;
  }
  const memberData = card.data;

  return protections.some(
    (protection) =>
      cardBelongsToGroup(memberData, protection.memberGroupAlias) &&
      memberData.blade <= protection.maxPrintedBlade
  );
}

export function clearMemberWaitProtectionsUntilLiveEnd(game: GameState): GameState {
  const protections = game.memberWaitProtections ?? [];
  if (protections.length === 0) return game;
  return {
    ...game,
    memberWaitProtections: protections.filter((protection) => protection.expiresAt !== 'LIVE_END'),
  };
}
