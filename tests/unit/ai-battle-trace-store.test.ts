import { describe, expect, it } from 'vitest';
import { AI_TRACE_LIMITS, AiBattleTraceStore } from '../../src/server/ai-battle/trace-store';
import type { AiTraceExport } from '../../src/online/ai-battle-observation-types';

const source = {
  id: 'rules',
  title: '规则',
  source: 'assets/ai-battle/rules.md',
  sha256: 'ignored',
  content: 'frozen rules',
};
const identity = (id: string) => ({
  id,
  revision: 5,
  windowKey: 'MAIN',
  seat: 'SECOND',
  purpose: 'MAIN',
});
function referencesAreResolvable(bundle: AiTraceExport) {
  const ids = bundle.materials.map((item) => item.id);
  for (const decision of bundle.decisions) {
    for (const id of [
      ...decision.sourceMaterialIds,
      ...decision.events.map((event) => event.materialId),
    ])
      expect(ids).toContain(id);
  }
  expect(bundle.incompleteMaterialIds).toEqual(
    bundle.materials.filter((item) => item.status !== 'COMPLETE').map((item) => item.id)
  );
}

describe('bounded AI observation evidence', () => {
  it('projects submission sources from retained SUBMIT evidence without changing capture or export', () => {
    const store = new AiBattleTraceStore(AI_TRACE_LIMITS, () => 100);
    store.open('m', []);
    for (const source of ['MODEL', 'MECHANICAL', 'FALLBACK', 'UNKNOWN']) {
      store.begin('m', identity(source));
      store.append('m', source, 'PREPARED', { source: 'MECHANICAL' });
      expect(store.list('m')!.decisions.at(-1)!.submissionSource).toBeNull();
      store.append('m', source, 'SUBMIT', { selection: { source } });
      store.append('m', source, 'AUTHORITY_RESULT', { success: false }, { status: 'STOPPED' });
      const usage = store.usage();
      const before = store.export('m');
      expect(store.list('m')!.decisions.at(-1)!.submissionSource).toBe(
        source === 'UNKNOWN' ? null : source
      );
      expect(store.export('m')).toEqual(before);
      expect(store.usage()).toEqual(usage);
      expect(before!.decisions.at(-1)).not.toHaveProperty('submissionSource');
    }
  });

  it('leaves source unknown when SUBMIT material is trimmed, missing or has no selection', () => {
    for (const payload of [
      { selection: { source: 'MECHANICAL' }, text: 'x'.repeat(500) },
      {
        toJSON() {
          throw new Error('capture failed');
        },
      },
      null,
    ]) {
      const store = new AiBattleTraceStore({ ...AI_TRACE_LIMITS, itemBytes: 100 });
      store.open('m', []);
      store.begin('m', { ...identity('1'), purpose: 'PUBLIC_DISPLAY' });
      store.append('m', '1', 'SUBMIT', payload, { status: 'ACCEPTED' });
      expect(store.list('m')!.decisions[0]!.submissionSource).toBeNull();
      referencesAreResolvable(store.export('m')!);
    }
  });

  it('freezes sources, snapshots reads and includes actual referenced evidence in a standalone export', () => {
    const store = new AiBattleTraceStore();
    const mutableSource = { ...source };
    expect(store.open('m', [mutableSource])).toBe(true);
    store.begin('m', identity('1'));
    const input = { messages: [{ role: 'user', content: 'actual input' }] };
    store.append('m', '1', 'REQUEST', input, { attemptStarted: 0, status: 'REQUESTING' });
    mutableSource.content = 'new rules';
    input.messages[0]!.content = 'new request';
    const first = store.export('m', '1')!;
    store.append(
      'm',
      '1',
      'RESPONSE',
      { text: 'actual output' },
      { attemptFinished: 0, status: 'ACCEPTED' }
    );
    expect(first.decisions[0]!.pendingAttempts).toEqual([0]);
    expect(first.materials[0]!.content).toBe('frozen rules');
    expect(first.materials.some((item) => item.content?.includes('actual input'))).toBe(true);
    const final = store.export('m')!;
    expect(final.revision).toBeGreaterThan(first.revision);
    expect(final.decisions[0]!.pendingAttempts).toEqual([]);
    expect(final.decisions[0]!.status).toBe('ACCEPTED');
    referencesAreResolvable(JSON.parse(JSON.stringify(final)) as AiTraceExport);
    expect(store.list('m')!.decisions[0]).not.toHaveProperty('events');
    expect(store.export('m', 'other')).toBeNull();
  });

  it('bounds UTF-8 material bytes and honestly identifies capture trimming', () => {
    const store = new AiBattleTraceStore({ ...AI_TRACE_LIMITS, itemBytes: 5 });
    expect(store.open('m', [{ ...source, content: '中文中文' }])).toBe(true);
    store.begin('m', identity('1'));
    store.append('m', '1', 'RESPONSE', { text: '中文中文' });
    const bundle = store.export('m')!;
    for (const item of bundle.materials) {
      expect(item.status).toBe('TRUNCATED');
      expect(item.reason).toBe('ITEM_LIMIT');
      expect(item.retainedBytes).toBeLessThanOrEqual(5);
      expect(Buffer.byteLength(item.content!)).toBe(item.retainedBytes);
      expect(item.content).not.toContain('\uFFFD');
      expect(item.originalBytes).toBeGreaterThan(item.retainedBytes);
    }
    referencesAreResolvable(bundle);
  });

  it('retains unfinished attempts, evicts terminal decisions, and never resurrects a late update', () => {
    const store = new AiBattleTraceStore({ ...AI_TRACE_LIMITS, decisions: 2 });
    store.open('m', [source]);
    store.begin('m', identity('1'));
    store.append('m', '1', 'REQUEST', {}, { attemptStarted: 0, status: 'REQUESTING' });
    store.begin('m', identity('2'));
    store.append('m', '2', 'SUBMIT', {}, { status: 'ACCEPTED' });
    store.begin('m', identity('3'));
    expect(store.list('m')!.decisions.map((decision) => decision.id)).toEqual(['1', '3']);
    store.append('m', '2', 'LATE_RESPONSE', { large: 'ignored' });
    store.begin('m', identity('4'));
    const listing = store.list('m')!;
    expect(listing.evictedDecisions).toBe(1);
    expect(listing.discardedLateUpdates).toBe(1);
    expect(listing.omittedDecisions).toBe(1);
    store.append('m', '1', 'LATE_RESPONSE', {}, { attemptFinished: 0, status: 'STALE' });
    store.begin('m', identity('5'));
    expect(store.list('m')!.decisions.map((decision) => decision.id)).toEqual(['3', '5']);
    referencesAreResolvable(store.export('m')!);
  });

  it('caps events, preserves terminal status, and reports serialization failures without throwing', () => {
    const store = new AiBattleTraceStore({ ...AI_TRACE_LIMITS, eventsPerDecision: 2 });
    store.open('m', []);
    store.begin('m', identity('1'));
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => store.append('m', '1', 'FAILED_CAPTURE', circular)).not.toThrow();
    store.append('m', '1', 'REQUEST', {}, { attemptStarted: 0 });
    store.append('m', '1', 'ACCEPTED', {}, { attemptFinished: 0, status: 'ACCEPTED' });
    const bundle = store.export('m')!;
    expect(bundle.captureFailures).toBe(1);
    expect(bundle.decisions[0]!.events).toHaveLength(2);
    expect(bundle.decisions[0]!.omittedEvents).toBe(1);
    expect(bundle.decisions[0]!.status).toBe('ACCEPTED');
    expect(bundle.decisions[0]!.pendingAttempts).toEqual([]);
    expect(bundle.materials[0]!.reason).toBe('CAPTURE_FAILED');
    referencesAreResolvable(bundle);
  });

  it('enforces combined process and per-session accounting including metadata', () => {
    const limits = {
      ...AI_TRACE_LIMITS,
      sessionBytes: 40_000,
      processBytes: 55_000,
      itemBytes: 24_000,
    };
    const store = new AiBattleTraceStore(limits);
    expect(store.open('a', [])).toBe(true);
    expect(store.open('b', [])).toBe(true);
    for (const match of ['a', 'b']) {
      store.begin(match, identity('1'));
      for (let i = 0; i < 10; i++) store.append(match, '1', 'DATA', { data: 'x'.repeat(24_000) });
      referencesAreResolvable(store.export(match)!);
    }
    expect(store.usage().reservedBytes).toBeLessThanOrEqual(limits.processBytes);
    const a = store.export('a')!;
    expect(a.incompleteMaterialIds.length + a.decisions[0]!.omittedEvents).toBeGreaterThan(0);
    const b = store.export('b')!;
    expect(b.incompleteMaterialIds.length + b.decisions[0]!.omittedEvents).toBeGreaterThan(0);
  });

  it('reclaims terminal text before trimming a new retained decision', () => {
    const store = new AiBattleTraceStore({
      ...AI_TRACE_LIMITS,
      sessionBytes: 45_000,
      itemBytes: 20_000,
    });
    store.open('m', [source]);
    for (const id of ['1', '2']) {
      store.begin('m', identity(id));
      store.append('m', id, 'DATA', { data: 'x'.repeat(12_000) }, { status: 'ACCEPTED' });
    }
    const bundle = store.export('m')!;
    expect(bundle.evictedDecisions).toBe(1);
    expect(bundle.decisions.map((decision) => decision.id)).toEqual(['2']);
    expect(bundle.incompleteMaterialIds).toEqual([]);
    referencesAreResolvable(bundle);
  });

  it('expires ended sessions without reads advancing the revision and frees capacity on cleanup', () => {
    let now = 0;
    const store = new AiBattleTraceStore(
      { ...AI_TRACE_LIMITS, sessions: 1, endedTtlMs: 100 },
      () => now
    );
    store.open('m', [source]);
    store.begin('m', identity('1'));
    const revision = store.list('m')!.revision;
    store.export('m');
    store.list('m');
    expect(store.list('m')!.revision).toBe(revision);
    store.end('m');
    store.end('m', 50);
    now = 99;
    expect(store.export('m')!.endedAt).toBe(0);
    now = 100;
    expect(store.list('m')).toBeNull();
    store.append('m', '1', 'LATE_RESPONSE', {});
    expect(store.open('new', [])).toBe(true);
    expect(store.usage()).toEqual({ reservedBytes: 1024, sessions: 1 });
  });
});
