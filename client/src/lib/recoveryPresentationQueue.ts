import type { BattleAnimationEvent, BattleAnimationSeat } from './battleAnimationEvents';

export const RECOVERY_PRESENTATION_MAX_WAIT_MS = 5000;
export const DISCARD_EXIT_DURATION_MS = 50;

export interface PendingRecoveryPresentation {
  readonly event: Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }>;
  readonly receivedAt: number;
}

/** Visual ordering only. Rules have already resolved and the final hand is already projected. */
export function drainRecoveryPresentations(
  pending: readonly PendingRecoveryPresentation[],
  {
    now,
    publicLogCaughtUp,
    discardSeats,
  }: {
    now: number;
    publicLogCaughtUp: boolean;
    discardSeats: ReadonlySet<BattleAnimationSeat>;
  }
) {
  const waiting: PendingRecoveryPresentation[] = [];
  const ready: BattleAnimationEvent[] = [];
  const expired: BattleAnimationEvent[] = [];
  for (const entry of pending) {
    if (now - entry.receivedAt >= RECOVERY_PRESENTATION_MAX_WAIT_MS) {
      expired.push(entry.event);
    } else if (!publicLogCaughtUp || (entry.event.toSeat && discardSeats.has(entry.event.toSeat))) {
      waiting.push(entry);
    } else {
      ready.push(entry.event);
    }
  }
  return { waiting, ready, expired };
}
