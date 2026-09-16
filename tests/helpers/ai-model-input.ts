import type { AiDecisionInput } from '../../src/server/ai-battle/protocol';

/** Test-only decoder for verifying that wire grouping has not removed any decision facts. */
export function expandAiDecisionInput(wire: Record<string, unknown>): AiDecisionInput {
  const { texts = {}, cardFacts = {}, ...input } = wire;
  delete input.decisionBrief;
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
  const expanded = visit(input) as Record<string, unknown>;
  const space = expanded.space as Record<string, unknown>;
  const groups = space.memberPlays as
    Record<string, { common: Record<string, unknown>; descriptionPrefix: string }> | undefined;
  if (groups) {
    space.candidates = (space.candidates as Record<string, unknown>[]).map((candidate) => {
      const { memberPlayRef, ...option } = candidate;
      if (typeof memberPlayRef !== 'string') return option;
      const group = groups[memberPlayRef]!;
      if (typeof option.description !== 'string')
        throw new Error('Expected a candidate description');
      return {
        ...group.common,
        ...option,
        description: group.descriptionPrefix + option.description,
      };
    });
    delete space.memberPlays;
  }
  const context = expanded.context as
    { recentDecisions: unknown[]; lastAction?: { recentDecisionIndex?: number } } | undefined;
  if (context?.lastAction?.recentDecisionIndex !== undefined)
    Object.assign(context, {
      lastAction: context.recentDecisions[context.lastAction.recentDecisionIndex],
    });
  return expanded as unknown as AiDecisionInput;
}
