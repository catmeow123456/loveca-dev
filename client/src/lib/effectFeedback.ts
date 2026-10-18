import type { EffectFeedbackPublicEvent, EffectFeedbackTarget, PublicEvent } from '@game/online';

export const EFFECT_FEEDBACK_DURATION_MS = 1250;
export const EFFECT_FEEDBACK_MAX_BATCH = 8;

export interface EffectFeedbackCursor {
  readonly context: string;
  readonly floor: number;
  readonly latest: number;
  readonly seen: readonly { id: string; seq: number }[];
}

/** Public-event sequence only: never pass the remote state revision (view.match.seq).
 * Initial attachment, rollback, seat switch and recovery epochs establish a fresh floor. */
export function consumeEffectFeedback(
  cursor: EffectFeedbackCursor | null,
  input: {
    readonly context: string;
    readonly currentPublicSeq: number;
    readonly events: readonly PublicEvent[];
  }
): { cursor: EffectFeedbackCursor; events: readonly EffectFeedbackPublicEvent[]; reset: boolean } {
  if (!cursor || cursor.context !== input.context || input.currentPublicSeq < cursor.latest) {
    return {
      cursor: {
        context: input.context,
        floor: input.currentPublicSeq,
        latest: input.currentPublicSeq,
        seen: [],
      },
      events: [],
      reset: true,
    };
  }
  const seen = new Map(cursor.seen.map((entry) => [entry.id, entry.seq]));
  const events: EffectFeedbackPublicEvent[] = [];
  for (const event of [...input.events].sort((a, b) => a.seq - b.seq)) {
    if (
      event.type !== 'EffectFeedback' ||
      event.seq <= cursor.floor ||
      event.seq > input.currentPublicSeq ||
      seen.has(event.eventId)
    )
      continue;
    seen.set(event.eventId, event.seq);
    events.push(event);
  }
  const entries = [...seen].map(([id, seq]) => ({ id, seq })).sort((a, b) => a.seq - b.seq);
  const droppedFloor = entries.length > 256 ? entries[entries.length - 257]!.seq : cursor.floor;
  return {
    cursor: {
      ...cursor,
      floor: Math.max(cursor.floor, droppedFloor),
      latest: input.currentPublicSeq,
      seen: entries.slice(-256),
    },
    events: events.slice(-EFFECT_FEEDBACK_MAX_BATCH),
    reset: false,
  };
}

/** Pending abilities and payment state changes never use the benefit light. */
export function hasEffectFeedbackGlow(
  mode: EffectFeedbackPublicEvent['mode'],
  changes: EffectFeedbackTarget['changes']
): boolean {
  return (
    mode === 'APPLIED' &&
    changes.some(
      (change) =>
        (change.kind === 'HEART' ||
          change.kind === 'BLADE' ||
          change.kind === 'SCORE' ||
          change.kind === 'REQUIREMENT') &&
        change.delta !== 0
    )
  );
}
