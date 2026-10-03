import type { AiDecisionInput } from './protocol.js';
import { liveProbabilityQuerySchema } from './live-probability-query.js';
import { liveSetPlanSchema } from './live-set-budget.js';

/** Per-turn wire constraints; grouped choices still pass the original parser and authority. */
export function codexResponseSchema(
  input: AiDecisionInput,
  allowQuery = true
): Record<string, unknown> {
  const space = input.space;
  const refs = space.candidates.map((candidate) => candidate.ref);
  const selection = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', space.kind === 'ACTION' ? 'actionRef' : 'cardRefs'],
    properties:
      space.kind === 'ACTION'
        ? { kind: { type: 'string', enum: ['ACTION'] }, actionRef: { type: 'string', enum: refs } }
        : {
            kind: { type: 'string', enum: ['CARDS'] },
            cardRefs: {
              type: 'array',
              minItems: space.canSkip ? 0 : space.min,
              maxItems: Math.min(space.max, refs.length),
              // Structured Outputs does not support uniqueItems; validateSelection rejects duplicates.
              items: { type: 'string', ...(refs.length ? { enum: refs } : {}) },
            },
          },
  };
  const liveSet = input.purpose === 'LIVE_SET';
  const canQuery = liveSet && allowQuery;
  return {
    type: 'object',
    additionalProperties: false,
    required: liveSet ? ['selection', 'tradeoff', 'liveSetPlan'] : ['selection', 'tradeoff'],
    properties: {
      selection: canQuery ? { anyOf: [selection, liveProbabilityQuerySchema] } : selection,
      tradeoff: { type: 'string', maxLength: 300 },
      ...(liveSet
        ? {
            liveSetPlan: canQuery
              ? { anyOf: [liveSetPlanSchema(space), { type: 'null' }] }
              : liveSetPlanSchema(space),
          }
        : {}),
    },
  };
}
