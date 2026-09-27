import { describe, expect, it } from 'vitest';
import {
  CODEX_OBSERVED_HISTORY_MAX_BYTES,
  CodexObservedHistory,
  CodexObservedHistoryCapacityError,
} from '../../src/server/ai-battle/codex-observed-history';
import type { AiDecisionInput } from '../../src/server/ai-battle/protocol';
import type { PublicEvent } from '../../src/online/types';
const input = (seqs: number[], through = Math.max(...seqs)) =>
  ({
    state: { selfSeat: 'FIRST', objects: { forbidden: 'DO_NOT_COPY_SNAPSHOT' } },
    history: {
      throughPublicSeq: through,
      omittedEventCount: 99,
      selection: 'LAST_12_PUBLIC_EVENTS',
      events: seqs.map((seq) => ({
        type: 'PlayerDeclared',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        matchId: 'm',
        seq,
        eventId: `m:${seq}`,
        timestamp: seq,
        declarationType: 'OBSERVED_PUBLIC_FIXTURE',
      })),
    },
  }) as unknown as AiDecisionInput;
const withEvents = (sample: AiDecisionInput, events: readonly PublicEvent[]): AiDecisionInput => ({
  ...sample,
  history: { ...sample.history!, events },
});
describe('Codex observed public history handover', () => {
  it('unions only received events with explicit gaps and no complete snapshots', () => {
    const memory = new CodexObservedHistory();
    const first = input([1, 2]);
    memory.observe(first);
    (first.history!.events[0] as { timestamp: number }).timestamp = 99;
    memory.observe(input([2, 5], 6));
    const result = memory.handover();
    expect(result).toMatchObject({
      complete: false,
      observedRanges: [
        [1, 2],
        [5, 5],
      ],
      unobservedEventCount: 3,
    });
    expect(result.events[0]!.timestamp).toBe(1);
    expect(JSON.stringify(result)).not.toContain('DO_NOT_COPY_SNAPSHOT');
    result.events.length = 0;
    expect(memory.handover().events).toHaveLength(3);
  });
  it.each(['seat', 'match', 'rewind', 'changed', 'future', 'missing'])(
    'rejects %s rather than inventing or merging history',
    (kind) => {
      const memory = new CodexObservedHistory();
      memory.observe(input([1, 2]));
      let next = input([2, 3]);
      if (kind === 'seat') next = { ...next, state: { ...next.state, selfSeat: 'SECOND' } };
      if (kind === 'match')
        next = withEvents(
          next,
          next.history!.events.map((e) => ({ ...e, matchId: 'other' }))
        );
      if (kind === 'rewind') next = { ...next, history: { ...next.history!, throughPublicSeq: 1 } };
      if (kind === 'changed')
        next = withEvents(
          next,
          next.history!.events.map((e) => ({ ...e, timestamp: 88 }))
        );
      if (kind === 'future')
        next = withEvents(
          next,
          next.history!.events.map((e) => ({ ...e, seq: 4 }))
        );
      if (kind === 'missing') next = { ...next, history: undefined };
      expect(() => memory.observe(next)).toThrow();
    }
  );
  it('retains a long game beyond the old 128 KiB cap, including the earliest facts and gaps', () => {
    const memory = new CodexObservedHistory();
    const base = input(
      Array.from({ length: 400 }, (_, i) => i * 2 + 1),
      800
    );
    const first = withEvents(
      base,
      base.history!.events.map((event) => ({
        ...event,
        publicValue: '既有公开事实'.repeat(12),
      }))
    );
    const bytes = first.history!.events.reduce(
      (sum, event) => sum + Buffer.byteLength(JSON.stringify(event)),
      0
    );
    expect(bytes).toBeGreaterThan(128 * 1024);
    expect(bytes).toBeLessThan(CODEX_OBSERVED_HISTORY_MAX_BYTES);
    memory.observe(first);
    memory.observe(first); // Repeated samples must not consume capacity again.
    memory.observe(input([801], 803));
    const handover = memory.handover();
    expect(handover.events).toEqual([...first.history!.events, ...input([801]).history!.events]);
    expect(handover.unobservedEventCount).toBe(402);
    expect(handover.observedRanges).toHaveLength(401);
  });
  it('accepts the exact byte limit but rejects one byte more without losing evidence', () => {
    let next = input([1]);
    const event = { ...next.history!.events[0]!, publicValue: '' };
    const padding = CODEX_OBSERVED_HISTORY_MAX_BYTES - Buffer.byteLength(JSON.stringify(event));
    event.publicValue = 'x'.repeat(padding);
    next = withEvents(next, [event]);
    const memory = new CodexObservedHistory();
    memory.observe(next);
    memory.observe(next);
    expect(memory.handover().events).toEqual([event]);
    const over = new CodexObservedHistory();
    next = withEvents(next, [{ ...event, publicValue: event.publicValue + 'x' }]);
    let thrown: unknown;
    try {
      over.observe(next);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CodexObservedHistoryCapacityError);
    expect(thrown).toHaveProperty('attemptedBytes', CODEX_OBSERVED_HISTORY_MAX_BYTES + 1);
    expect(thrown).toHaveProperty('limitBytes', CODEX_OBSERVED_HISTORY_MAX_BYTES);
    expect(over.handover().events).toEqual([]);
  });
  it('rejects an overflowing batch atomically without poisoning byte accounting or pruning evidence', () => {
    const memory = new CodexObservedHistory();
    memory.observe(input([1]));
    const before = memory.handover();
    const base = input([2, 3]);
    const next = withEvents(base, [
      base.history!.events[0]!,
      { ...base.history!.events[1]!, publicValue: 'x'.repeat(CODEX_OBSERVED_HISTORY_MAX_BYTES) },
    ]);
    expect(() => memory.observe(next)).toThrow('capacity');
    expect(memory.handover()).toEqual(before);
    memory.observe(input([2, 3]));
    expect(memory.handover().events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
  it('rejects conflicting events in a batch without partially retaining its earlier events', () => {
    const memory = new CodexObservedHistory();
    memory.observe(input([1]));
    const base = input([2, 3, 3]);
    const next = withEvents(
      base,
      base.history!.events.map((event, i) => ({ ...event, timestamp: i }))
    );
    const before = memory.handover();
    expect(() => memory.observe(next)).toThrow('Public history changed');
    expect(memory.handover()).toEqual(before);
    memory.observe(input([2, 3]));
    expect(memory.handover().events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});
