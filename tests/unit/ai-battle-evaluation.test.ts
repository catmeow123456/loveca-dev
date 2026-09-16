import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prepareAiEvaluation } from '../helpers/ai-battle-evaluation';
import { AiBattleTraceStore } from '../../src/server/ai-battle/trace-store';

const material = (id: string, content = `frozen ${id}`) => ({
  id,
  title: id,
  source: `assets/${id}`,
  content,
  sha256: createHash('sha256').update(content).digest('hex'),
});
function fixture() {
  const sources = ['rules', 'tutorial', 'handbook-a', 'deck:muse-starter'].map((id) =>
    material(id)
  );
  const trace = new AiBattleTraceStore();
  trace.open('m', sources);
  trace.begin('m', { id: '1', revision: 1, windowKey: 'MAIN', seat: 'FIRST', purpose: 'MAIN' });
  const input = JSON.stringify({
    purpose: 'MAIN',
    state: { objects: { hidden: { face: 'BACK' }, own: { frontInfo: { name: 'Visible' } } } },
    space: { kind: 'ACTION', candidates: [{ ref: 'a2' }, { ref: 'a1' }] },
    responseSchema: { original: true },
  });
  const messages = [
    { role: 'system', content: 'Protocol control' },
    ...sources.map((source) => ({ role: 'user', content: `${source.title}\n${source.content}` })),
    { role: 'user', content: `本次决策；只使用本次引用\n${input}` },
  ];
  trace.append('m', '1', 'REQUEST', {
    body: JSON.stringify({ model: 'fixture-model', messages }),
    assembly: sources.map((source, index) => ({
      sourceId: source.id,
      sourceSha256: source.sha256,
      messageIndex: index + 1,
    })),
  });
  // Unrelated capture data must not enter the prepared prompts.
  trace.append('m', '1', 'TEST_ONLY_UNRELATED', { unrelated: 'not part of the model input' });
  return { bundle: trace.export('m')!, input, messages };
}

describe('offline AI fixed-input preparation', () => {
  it('keeps exact visible input, candidates, protocol and deck across four conditions and three repeats', () => {
    const { bundle, input, messages } = fixture();
    const before = JSON.stringify(bundle);
    const plan = prepareAiEvaluation(bundle, ['1'], material('handbook-b'));
    expect(plan.modelConfiguration).toBeNull();
    expect(plan.commandExecution).toBe('NONE');
    expect(plan.samples).toHaveLength(12);
    expect(new Set(plan.samples.map((sample) => sample.id)).size).toBe(12);
    const item = plan.cases[0]!;
    expect(item.inputJson).toBe(input);
    for (const comparison of item.comparisons) {
      expect(comparison.messages[0]).toEqual(messages[0]);
      expect(comparison.messages.at(-2)).toEqual(messages[4]);
      expect(comparison.messages.at(-1)).toEqual(messages[5]);
      expect(plan.samples.filter((sample) => sample.variant === comparison.variant)).toHaveLength(
        3
      );
    }
    expect(item.comparisons.map((entry) => entry.messages.length)).toEqual([4, 5, 6, 6]);
    expect(item.comparisons[2]!.messages).toEqual(messages);
    expect(item.comparisons[3]!.messages[3]!.content).toBe('handbook-b\nfrozen handbook-b');
    expect(JSON.stringify(plan)).not.toContain('not part of the model input');
    expect(JSON.stringify(bundle)).toBe(before);
  });

  it('requires retained actual requests and complete evidence instead of reconstructing missing prompts', () => {
    const { bundle } = fixture();
    const handbook = material('b');
    expect(() => prepareAiEvaluation(bundle, ['missing'], handbook)).toThrow('not retained');
    expect(() => prepareAiEvaluation(bundle, ['1', '1'], handbook)).toThrow('distinct');
    const missing = {
      ...bundle,
      materials: bundle.materials.filter((m) => m.source !== 'capture'),
    };
    expect(() => prepareAiEvaluation(missing, ['1'], handbook)).toThrow('complete');
    const truncated = {
      ...bundle,
      materials: bundle.materials.map((m) =>
        m.id === 'source:rules' ? { ...m, status: 'TRUNCATED' as const } : m
      ),
    };
    expect(() => prepareAiEvaluation(truncated, ['1'], handbook)).toThrow('complete');
  });

  it('rejects altered source text even if its own material hash is updated', () => {
    const { bundle } = fixture();
    const changed = material('rules', 'changed after the captured request');
    const altered = {
      ...bundle,
      materials: bundle.materials.map((m) =>
        m.id === 'source:rules' ? { ...m, content: changed.content, sha256: changed.sha256 } : m
      ),
    };
    expect(() => prepareAiEvaluation(altered, ['1'], material('b'))).toThrow('actual request');
  });
});
