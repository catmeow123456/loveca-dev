import { describe, expect, it } from 'vitest';
import { CodexObservedHistory } from '../../src/server/ai-battle/codex-observed-history';
import type { AiDecisionInput } from '../../src/server/ai-battle/protocol';
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
describe('Codex observed public history handover', () => {
  it('unions only received events with explicit gaps and no complete snapshots', () => {
    const memory = new CodexObservedHistory();
    const first = input([1, 2]);
    memory.observe(first);
    (first.history!.events[0] as any).timestamp = 99;
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
      const next: any = input([2, 3]);
      if (kind === 'seat') next.state.selfSeat = 'SECOND';
      if (kind === 'match') next.history.events[0].matchId = 'other';
      if (kind === 'rewind') next.history.throughPublicSeq = 1;
      if (kind === 'changed') next.history.events[0].timestamp = 88;
      if (kind === 'future') next.history.events[1].seq = 4;
      if (kind === 'missing') delete next.history;
      expect(() => memory.observe(next)).toThrow();
    }
  );
  it('stops at the retention bound without silently pruning old evidence', () => {
    const memory = new CodexObservedHistory();
    memory.observe(input([1]));
    const next: any = input([2]);
    next.history.events[0].publicValue = 'x'.repeat(128 * 1024);
    expect(() => memory.observe(next)).toThrow('capacity');
    expect(memory.handover().events.map((e) => e.seq)).toEqual([1]);
  });
});
