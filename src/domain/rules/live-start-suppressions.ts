import type { GameState, LiveStartSuppressionState } from '../entities/game.js';

export interface AddMemberLiveStartSuppressionOptions {
  readonly playerId: string;
  readonly suppressedMemberCardId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
}

export function addMemberLiveStartSuppressionUntilLiveEnd(
  game: GameState,
  options: AddMemberLiveStartSuppressionOptions
): GameState {
  const suppression: LiveStartSuppressionState = {
    playerId: options.playerId,
    suppressedMemberCardId: options.suppressedMemberCardId,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
    expiresAt: 'LIVE_END',
  };

  return {
    ...game,
    liveStartSuppressions: [
      ...game.liveStartSuppressions.filter(
        (candidate) =>
          !(
            candidate.playerId === suppression.playerId &&
            candidate.suppressedMemberCardId === suppression.suppressedMemberCardId &&
            candidate.sourceCardId === suppression.sourceCardId &&
            candidate.abilityId === suppression.abilityId
          )
      ),
      suppression,
    ],
  };
}

export function isMemberLiveStartSuppressed(
  game: GameState,
  playerId: string,
  memberCardId: string
): boolean {
  return game.liveStartSuppressions.some(
    (suppression) =>
      suppression.playerId === playerId &&
      suppression.suppressedMemberCardId === memberCardId
  );
}

export function clearLiveStartSuppressionsUntilLiveEnd(game: GameState): GameState {
  if (game.liveStartSuppressions.length === 0) {
    return game;
  }
  return {
    ...game,
    liveStartSuppressions: game.liveStartSuppressions.filter(
      (suppression) => suppression.expiresAt !== 'LIVE_END'
    ),
  };
}
