import type { AiDecisionInput } from './protocol.js';
import { liveProbabilityQuerySchema } from './live-probability-query.js';

/** Wire schema only. Full group/uniqueness/skip constraints still go to the model in input
 * and are enforced by the original response parser and authority chain, not this adapter. */
export function codexResponseSchema(input: AiDecisionInput): Record<string, unknown> {
  void input; // Stable wire format; current-window legality remains in the authoritative parser.
  return {
    type: 'object',
    additionalProperties: false,
    required: ['selection', 'tradeoff'],
    properties: {
      selection: {
        anyOf: [
          liveProbabilityQuerySchema,
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'actionRef'],
            properties: {
              kind: { type: 'string', enum: ['ACTION'] },
              actionRef: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'cardRefs'],
            properties: {
              kind: { type: 'string', enum: ['CARDS'] },
              cardRefs: { type: 'array', items: { type: 'string' } },
            },
          },
        ],
      },
      tradeoff: { type: 'string', maxLength: 300 },
    },
  };
}
