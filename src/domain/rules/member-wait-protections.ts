import { isMemberCardData } from '../entities/card.js';
import {
  getCardById,
  getPlayerById,
  type GameState,
  type MemberWaitProtectionState,
} from '../entities/game.js';
import type { MemberStateChangeCause } from '../events/game-events.js';
import { cardBelongsToGroup, cardNameAliasMatches } from '../../shared/utils/card-identity.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';

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

/** The bp8 Izumi's own continuous protection, shared by rule resolution and public status. */
export function hasIzumiOpponentWaitProtection(
  game: GameState,
  playerId: string,
  memberCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, memberCardId);
  return !!(
    player &&
    card?.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!HS-bp8-008') &&
    Object.values(player.memberSlots.slots).includes(memberCardId) &&
    Object.values(player.memberSlots.slots).some((id) => {
      const partner = id ? getCardById(game, id) : null;
      return (
        partner?.ownerId === playerId &&
        isMemberCardData(partner.data) &&
        cardNameAliasMatches(partner.data, 'セラス 柳田 リリエンフェルト')
      );
    })
  );
}

export function isMemberWaitProtectedFromChange(
  game: GameState,
  affectedPlayerId: string,
  memberCardId: string,
  cause: MemberStateChangeCause | undefined
): boolean {
  if (cause?.kind !== 'CARD_EFFECT' || cause.playerId === affectedPlayerId) {
    return false;
  }
  const protections = (game.memberWaitProtections ?? []).filter(
    (candidate) => candidate.affectedPlayerId === affectedPlayerId
  );
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

  if (hasIzumiOpponentWaitProtection(game, affectedPlayerId, memberCardId)) return true;

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
