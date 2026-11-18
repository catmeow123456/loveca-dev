import { getCardById, getOpponent, type GameState } from '../../domain/entities/game.js';
import {
  getCanonicalMemberNameCandidates,
  getCardNameCandidates,
  normalizeMemberName,
} from '../../shared/utils/card-identity.js';
import { getStageMemberCardIdsMatching } from './stage-targets.js';

export interface OpponentDifferentNameMemberCountChoice {
  readonly name: string;
  readonly normalizedName: string;
  readonly count: number;
}

/** Every possible target identity is held fixed for the entire opposing-stage count. */
export function getOpponentDifferentNameMemberCountChoices(
  game: GameState,
  playerId: string,
  targetMemberCardId: string
): readonly OpponentDifferentNameMemberCountChoice[] {
  const target = getCardById(game, targetMemberCardId);
  if (!target) return [];
  return [
    ...new Map(getCardNameCandidates(target.data).map((name) => [normalizeMemberName(name), name])),
  ]
    .filter(([normalizedName]) => normalizedName.length > 0)
    .map(([normalizedName, name]) => ({
      name,
      normalizedName,
      count: countOpponentStageMembersWithDifferentName(
        game,
        playerId,
        targetMemberCardId,
        normalizedName
      ),
    }));
}

/**
 * Count members individually; repeated opposing names still contribute separately.
 * Q331 fixes one reference identity for the selected target. Opposing cards retain
 * the existing structured "has this name" comparison, without choosing identities for them.
 */
export function countOpponentStageMembersWithDifferentName(
  game: GameState,
  playerId: string,
  targetMemberCardId: string,
  targetMemberName: string
): number {
  const target = getCardById(game, targetMemberCardId);
  const opponent = getOpponent(game, playerId);
  if (!target || !opponent) return 0;
  const name = normalizeMemberName(targetMemberName);
  if (!name || !getCanonicalMemberNameCandidates(target.data).includes(name)) return 0;
  return getStageMemberCardIdsMatching(
    game,
    opponent.id,
    (card) => card.ownerId === opponent.id
  ).filter((id) => {
    const card = getCardById(game, id);
    const otherNames = card ? getCanonicalMemberNameCandidates(card.data) : [];
    return otherNames.length > 0 && otherNames.every((otherName) => otherName !== name);
  }).length;
}
