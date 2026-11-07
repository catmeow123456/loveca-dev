import { getCardById, getOpponent, type GameState } from '../../domain/entities/game.js';
import { getCanonicalMemberNameCandidates } from '../../shared/utils/card-identity.js';
import { getStageMemberCardIdsMatching } from './stage-targets.js';

/** Count opposing top-level members individually, comparing every structured member identity. */
export function countOpponentStageMembersWithDifferentName(
  game: GameState,
  playerId: string,
  targetMemberCardId: string
): number {
  const target = getCardById(game, targetMemberCardId);
  const opponent = getOpponent(game, playerId);
  if (!target || !opponent) return 0;
  const names = new Set(getCanonicalMemberNameCandidates(target.data));
  if (names.size === 0) return 0;
  return getStageMemberCardIdsMatching(
    game,
    opponent.id,
    (card) => card.ownerId === opponent.id
  ).filter((id) => {
    const card = getCardById(game, id);
    const otherNames = card ? getCanonicalMemberNameCandidates(card.data) : [];
    return otherNames.length > 0 && otherNames.every((name) => !names.has(name));
  }).length;
}
