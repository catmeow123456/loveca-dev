import type { OpeningRpsGesture } from '../../online/release-types.js';

/**
 * Shared opening rock-paper-scissors rule used by both USER rooms and
 * controlled SYSTEM pregame resolution.
 */
export function resolveOpeningRpsWinner<T>(
  left: { readonly participantId: T; readonly gesture: OpeningRpsGesture },
  right: { readonly participantId: T; readonly gesture: OpeningRpsGesture }
): T | null {
  if (left.gesture === right.gesture) {
    return null;
  }
  if (
    (left.gesture === 'ROCK' && right.gesture === 'SCISSORS') ||
    (left.gesture === 'SCISSORS' && right.gesture === 'PAPER') ||
    (left.gesture === 'PAPER' && right.gesture === 'ROCK')
  ) {
    return left.participantId;
  }
  return right.participantId;
}
