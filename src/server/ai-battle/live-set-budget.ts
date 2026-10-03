import type { AiCandidate, AiDecisionInput, AiDecisionSpace, AiSelection } from './protocol.js';
import { HeartColor } from '../../shared/types/enums.js';

/** Provider response accounting, never a rule legality or probability claim. */
export interface AiLiveSetPlan {
  readonly liveCardRefs: readonly string[];
  readonly memberCardRefs: readonly string[];
  readonly baseRequiredHeartTotal: number;
}

export function summarizeAiLiveSetSelection(input: AiDecisionInput, cardRefs: readonly string[]) {
  const candidates = new Map(input.space.candidates.map((candidate) => [candidate.ref, candidate]));
  const liveCardRefs: string[] = [];
  const memberCardRefs: string[] = [];
  const colorRequirements: Partial<Record<HeartColor, number>> = {};
  let baseRequiredHeartTotal = 0;
  let printedScoreTotal = 0;
  for (const ref of cardRefs) {
    const candidate = candidates.get(ref);
    if (!candidate) throw new Error('Unknown LIVE set reference');
    const budget = candidate.liveBaseBudget;
    if (!budget) {
      memberCardRefs.push(ref);
      continue;
    }
    liveCardRefs.push(ref);
    baseRequiredHeartTotal += budget.requiredHearts.totalRequired;
    printedScoreTotal += budget.score ?? 0;
    for (const [color, count] of Object.entries(budget.requiredHearts.colorRequirements)) {
      const key = color as HeartColor;
      colorRequirements[key] = (colorRequirements[key] ?? 0) + count;
    }
  }
  return {
    liveCardRefs,
    memberCardRefs,
    baseRequiredHeartTotal,
    colorRequirements,
    printedScoreTotal,
  };
}

export function createAiLiveSetPlan(input: AiDecisionInput, selection: AiSelection): AiLiveSetPlan {
  if (input.purpose !== 'LIVE_SET' || selection.kind !== 'CARDS')
    throw new Error('LIVE set plan requires a LIVE_SET card selection');
  const { liveCardRefs, memberCardRefs, baseRequiredHeartTotal } = summarizeAiLiveSetSelection(
    input,
    selection.cardRefs
  );
  return { liveCardRefs, memberCardRefs, baseRequiredHeartTotal };
}

export function liveSetPlanSchema(space: AiDecisionSpace) {
  if (space.kind !== 'CARDS') throw new Error('Invalid LIVE set space');
  const refs = (candidates: readonly AiCandidate[]) => ({
    type: 'array',
    // Shared with Codex Structured Outputs; duplicate references are checked by the parser.
    minItems: 0,
    maxItems: Math.min(space.max, candidates.length),
    items: { type: 'string', ...(candidates.length ? { enum: candidates.map((c) => c.ref) } : {}) },
  });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['liveCardRefs', 'memberCardRefs', 'baseRequiredHeartTotal'],
    properties: {
      liveCardRefs: refs(space.candidates.filter((c) => c.liveBaseBudget)),
      memberCardRefs: refs(space.candidates.filter((c) => !c.liveBaseBudget)),
      baseRequiredHeartTotal: { type: 'integer', minimum: 0 },
    },
  };
}
