import type { GameState, MemberActivePhaseSkipState } from '../entities/game.js';

export interface AddMemberActivePhaseSkipOptions {
  readonly playerId: string;
  readonly memberCardId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
}

export function addMemberActivePhaseSkip(
  game: GameState,
  options: AddMemberActivePhaseSkipOptions
): GameState {
  const skip: MemberActivePhaseSkipState = {
    playerId: options.playerId,
    memberCardId: options.memberCardId,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
  };

  return {
    ...game,
    memberActivePhaseSkips: [
      ...game.memberActivePhaseSkips.filter(
        (candidate) =>
          !(
            candidate.playerId === skip.playerId &&
            candidate.memberCardId === skip.memberCardId &&
            candidate.sourceCardId === skip.sourceCardId &&
            candidate.abilityId === skip.abilityId
          )
      ),
      skip,
    ],
  };
}

export function consumeMemberActivePhaseSkipsForPlayer(
  game: GameState,
  playerId: string
): {
  readonly gameState: GameState;
  readonly skippedMemberCardIds: readonly string[];
} {
  const skippedMemberCardIds = game.memberActivePhaseSkips
    .filter((skip) => skip.playerId === playerId)
    .map((skip) => skip.memberCardId);

  if (skippedMemberCardIds.length === 0) {
    return { gameState: game, skippedMemberCardIds };
  }

  return {
    gameState: {
      ...game,
      memberActivePhaseSkips: game.memberActivePhaseSkips.filter(
        (skip) => skip.playerId !== playerId
      ),
    },
    skippedMemberCardIds,
  };
}
