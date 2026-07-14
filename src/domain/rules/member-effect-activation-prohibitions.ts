import type {
  GameState,
  MemberEffectActivationProhibitionState,
} from '../entities/game.js';

export interface AddMemberEffectActivationProhibitionOptions {
  readonly affectedPlayerIds: readonly string[];
  readonly sourceCardId: string;
  readonly abilityId: string;
}

export function addMemberEffectActivationProhibitionUntilTurnEnd(
  game: GameState,
  options: AddMemberEffectActivationProhibitionOptions
): GameState {
  const prohibition: MemberEffectActivationProhibitionState = {
    affectedPlayerIds: [...new Set(options.affectedPlayerIds)],
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
    createdTurnCount: game.turnCount,
    expiresAt: 'TURN_END',
  };
  const existing = game.memberEffectActivationProhibitions ?? [];
  return {
    ...game,
    memberEffectActivationProhibitions: [
      ...existing.filter(
        (candidate) =>
          !(
            candidate.sourceCardId === prohibition.sourceCardId &&
            candidate.abilityId === prohibition.abilityId &&
            candidate.createdTurnCount === prohibition.createdTurnCount
          )
      ),
      prohibition,
    ],
  };
}

export function isMemberEffectActivationProhibited(game: GameState, playerId: string): boolean {
  return (game.memberEffectActivationProhibitions ?? []).some(
    (prohibition) =>
      prohibition.createdTurnCount === game.turnCount &&
      prohibition.affectedPlayerIds.includes(playerId)
  );
}

export function clearExpiredMemberEffectActivationProhibitions(game: GameState): GameState {
  const existing = game.memberEffectActivationProhibitions ?? [];
  const active = existing.filter(
    (prohibition) => prohibition.createdTurnCount === game.turnCount
  );
  return active.length === existing.length
    ? game
    : { ...game, memberEffectActivationProhibitions: active };
}
