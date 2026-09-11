import { describe, expect, it } from 'vitest';
import { compactAiDecisionInput } from '../../src/server/ai-battle/model-input';
import { buildAiBattleDecision } from '../../src/server/ai-battle/decision';
import { createPlanningFixture } from '../helpers/ai-battle-planning-fixture';

function expand(wire: Record<string, unknown>): unknown {
  const { texts = {}, cardFacts = {}, ...input } = wire;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.textRef === 'string')
        return (texts as Record<string, string>)[record.textRef];
      if (typeof record.cardFactsRef === 'string')
        return visit((cardFacts as Record<string, unknown>)[record.cardFactsRef]);
      return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, visit(v)]));
    }
    return value;
  };
  return visit(input);
}

describe('AI request normalization preserves complete facts', () => {
  it.each(['111', '149', '151'])(
    'round-trips decision %s including selection refs, all targets and distinct effective values',
    (id) => {
      const f = createPlanningFixture(id);
      const query = buildAiBattleDecision(
        f.session.state!,
        'ai',
        f.session.getPlayerViewState('ai')!
      );
      if (query.kind !== 'DECISION') throw new Error('Expected decision');
      const before = JSON.stringify(query.decision.input);
      const wire = compactAiDecisionInput(query.decision.input);
      expect(JSON.stringify(expand(wire))).toBe(before);
      expect(JSON.stringify(query.decision.input)).toBe(before);
      expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThan(
        Buffer.byteLength(before) * 0.85
      );
      // Repeated copies collapse only when their entire front payload matches. The boosted opponent
      // and printed waiting-room versions of the same member must remain distinguishable.
      const expected = new Set(
        Object.values(query.decision.input.state.objects)
          .filter((o) => o.frontInfo)
          .map((o) => JSON.stringify(o.frontInfo))
      );
      expect(Object.keys(wire.cardFacts as object)).toHaveLength(expected.size);
    }
  );
});
