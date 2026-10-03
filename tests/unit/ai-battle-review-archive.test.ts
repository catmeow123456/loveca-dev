import { describe, expect, it } from 'vitest';
// Offline diagnostic reader deliberately has no application or model dependencies.
import { parseEvidence } from '../../.agents/skills/loveca-ai-match-review/scripts/archive.mjs';

const rows = () =>
  [
    { kind: 'HEADER', payload: { format: 'loveca-ai-archive-v1', matchId: 'match' } },
    {
      kind: 'SOURCES',
      payload: { sources: [{ id: 'rules', title: 'rules', source: 'test', content: '规则' }] },
    },
    {
      kind: 'BEGIN',
      payload: {
        identity: {
          id: 'FIRST:1',
          seat: 'FIRST',
          revision: 1,
          windowKey: 'window',
          purpose: 'MAIN',
        },
      },
    },
    {
      kind: 'APPEND',
      payload: {
        decisionId: 'FIRST:1',
        stage: 'REQUEST',
        payload: { body: '请求' },
        options: { attemptStarted: 0 },
      },
    },
    {
      kind: 'APPEND',
      payload: {
        decisionId: 'FIRST:1',
        stage: 'RESPONSE',
        payload: { body: '回答' },
        options: { attemptFinished: 0, status: 'ACCEPTED' },
      },
    },
    { kind: 'END', payload: { endedAt: 10 } },
  ].map((row, index) => ({ ...row, sequence: index + 1, timestamp: index + 1, redactionCount: 0 }));
const encode = (values: readonly unknown[]) =>
  values.map((value) => JSON.stringify(value)).join('\n') + '\n';

describe('offline full-archive review input', () => {
  it('reconstructs all decision materials and pending state from local JSONL', () => {
    const exportData = parseEvidence(encode(rows()));
    expect(exportData.captureFailures).toBe(0);
    expect(exportData.decisions[0]).toMatchObject({
      id: 'FIRST:1',
      status: 'ACCEPTED',
      pendingAttempts: [],
      sourceMaterialIds: ['source:rules'],
    });
    expect(exportData.materials).toHaveLength(3);
    expect(JSON.parse(exportData.materials[2].content)).toEqual({ body: '回答' });
  });
  it('accepts database row sequences with gaps, as IDs are shared across matches', () => {
    const values = rows().map((row, index) => ({
      sequence: String(index * 5 + 10),
      entry: {
        ...row,
        ...(index === 0 ? { payload: { format: 'loveca-ai-evidence-v1', matchId: 'match' } } : {}),
      },
    }));
    expect(parseEvidence(encode(values)).captureFailures).toBe(0);
  });
  it('marks missing END or a failed export incomplete and rejects broken or out-of-order evidence', () => {
    expect(parseEvidence(encode(rows().slice(0, -1))).captureFailures).toBeGreaterThan(0);
    expect(
      parseEvidence(
        encode([{ kind: 'EXPORT', payload: { completeThroughExport: false } }, ...rows()])
      ).captureFailures
    ).toBeGreaterThan(0);
    expect(() => parseEvidence(encode(rows()) + '{broken')).toThrow('Invalid JSONL');
    const values = rows();
    values[4].sequence = 99;
    expect(() => parseEvidence(encode(values))).toThrow('sequence gap');
  });
});
