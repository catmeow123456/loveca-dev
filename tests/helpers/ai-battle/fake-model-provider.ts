import type { AiDecisionSelection } from '../../../src/application/ai-decisions';
import { SlotPosition } from '../../../src/shared/types/enums';
import {
  AI_MODEL_ID,
  AI_MODEL_PROVIDER_PROFILE_VERSION,
  type AiModelProvider,
  type AiModelProviderRequest,
  type AiModelProviderUsage,
} from '../../../src/server/ai-battle/model-provider';
import type { AiModelStrategyContext } from '../../../src/server/ai-battle/model-protocol';

interface ParsedModelUserMessage {
  readonly strategyContext: AiModelStrategyContext;
}

export interface LegalAiModelProviderInvocation {
  readonly callNumber: number;
  readonly request: AiModelProviderRequest;
  readonly context: AiModelStrategyContext;
}

export interface CreateLegalAiModelProviderInput {
  readonly select?: (
    context: AiModelStrategyContext,
    invocation: LegalAiModelProviderInvocation
  ) => AiDecisionSelection;
  readonly onInvoke?: (invocation: LegalAiModelProviderInvocation) => void;
  readonly tradeoff?: string | null;
  readonly nextPlan?: string | null;
  readonly usage?: AiModelProviderUsage;
}

export function createLegalAiModelProvider(
  input: CreateLegalAiModelProviderInput = {}
): AiModelProvider {
  let callNumber = 0;
  return {
    providerId: 'ALIBABA_DASHSCOPE',
    profileVersion: AI_MODEL_PROVIDER_PROFILE_VERSION,
    modelId: AI_MODEL_ID,
    invoke(request, signal) {
      if (signal.aborted) {
        return Promise.resolve({ ok: false, code: 'ABORTED', retryable: false });
      }
      callNumber += 1;
      const payload = JSON.parse(request.userMessage) as ParsedModelUserMessage;
      const invocation = { callNumber, request, context: payload.strategyContext };
      input.onInvoke?.(invocation);
      const selection = (input.select ?? selectLegalAiModelDecision)(
        payload.strategyContext,
        invocation
      );
      return Promise.resolve({
        ok: true,
        rawOutput: JSON.stringify({
          selection,
          ...(input.tradeoff === null
            ? {}
            : {
                tradeoff: input.tradeoff ?? '选择当前语义上下文中资源收益最高的合法方案。',
              }),
          ...(input.nextPlan === null
            ? {}
            : { nextPlan: input.nextPlan ?? '权威执行后重新观察下一决定。' }),
        }),
        usage: input.usage ?? { inputTokens: 800, outputTokens: 60, totalTokens: 860 },
        providerRequestId: `legal-fake-provider-${String(callNumber)}`,
        finishReason: 'stop',
      });
    },
  };
}

export function selectLegalAiModelDecision(context: AiModelStrategyContext): AiDecisionSelection {
  const decision = context.semanticContext.currentDecision;
  const choices = decision.choices;
  const ids = (choiceKind: (typeof choices)[number]['choiceKind']): readonly string[] =>
    choices.filter((choice) => choice.choiceKind === choiceKind).map((choice) => choice.choiceId);
  const has = (choiceId: string): boolean => choices.some((choice) => choice.choiceId === choiceId);

  switch (decision.kind) {
    case 'MULLIGAN':
      return { kind: 'MULLIGAN', candidateIds: [] };
    case 'COST_PAYMENT':
      return {
        kind: 'PAY_COST',
        candidateIds: selectRequiredIds(decision.facts, ids('CANDIDATE')),
      };
    case 'JUDGMENT_CONFIRMATION':
      return { kind: 'CONFIRM_JUDGMENT' };
    case 'SCORE_CONFIRMATION':
      return { kind: 'CONFIRM_SCORE' };
    case 'SUCCESS_LIVE_SELECTION':
      return {
        kind: 'SELECT_SUCCESS_LIVE',
        candidateId: requireFirst(ids('CANDIDATE'), decision.kind),
      };
    case 'PHASE_CONFIRMATION':
      return { kind: 'CONFIRM_PHASE' };
    case 'MAIN_PHASE': {
      const action =
        choices.find(
          (choice) =>
            choice.choiceKind === 'ACTION' &&
            (choice.description.includes('登场') || choice.description.includes('发动'))
        ) ?? choices.find((choice) => choice.choiceKind === 'ACTION');
      return {
        kind: 'SELECT_MAIN_PHASE_ACTION',
        actionId: requireValue(action?.choiceId, decision.kind),
      };
    }
    case 'LIVE_SET': {
      const action =
        choices.find(
          (choice) => choice.choiceKind === 'ACTION' && choice.description.includes('盖放')
        ) ?? choices.find((choice) => choice.choiceKind === 'ACTION');
      return {
        kind: 'SELECT_LIVE_SET_ACTION',
        actionId: requireValue(action?.choiceId, decision.kind),
      };
    }
    case 'SPECIAL_MEMBER_PLAY':
      if (has('CANCEL_SPECIAL_MEMBER_PLAY')) return { kind: 'CANCEL_SPECIAL_MEMBER_PLAY' };
      return {
        kind: 'CONFIRM_SPECIAL_MEMBER_PLAY',
        candidateIds: selectRequiredIds(decision.facts, ids('CANDIDATE')),
      };
    case 'ACTIVE_EFFECT':
      return selectActiveEffectDecision(context);
  }
}

function selectActiveEffectDecision(context: AiModelStrategyContext): AiDecisionSelection {
  const decision = context.semanticContext.currentDecision;
  const choices = decision.choices;
  const byKind = (kind: (typeof choices)[number]['choiceKind']) =>
    choices.filter((choice) => choice.choiceKind === kind);
  const has = (choiceId: string): boolean => choices.some((choice) => choice.choiceId === choiceId);

  if (has('SKIP_EFFECT_CARDS')) return { kind: 'SELECT_EFFECT_CARDS', candidateIds: [] };
  if (has('SKIP_EFFECT_OPTIONS')) return { kind: 'SELECT_EFFECT_OPTIONS', optionIds: [] };
  if (has('CONFIRM_EFFECT')) return { kind: 'CONFIRM_EFFECT' };
  if (has('RESOLVE_ABILITIES_IN_ORDER')) return { kind: 'RESOLVE_ABILITIES_IN_ORDER' };
  if (has('CONFIRM_DEADLINE')) return { kind: 'CONFIRM_DEADLINE' };
  if (has('SELECT_EFFECT_NUMBER')) {
    return { kind: 'SELECT_EFFECT_NUMBER', value: selectLegalNumber(decision.facts) };
  }

  const placements = byKind('PLACEMENT');
  if (placements.length > 0) {
    return {
      kind: 'SET_STAGE_FORMATION',
      placements: selectLegalPlacements(placements.map((choice) => choice.choiceId)),
    };
  }
  const slots = byKind('SLOT');
  if (slots[0]) {
    return {
      kind: 'SELECT_EFFECT_SLOT',
      slot: parseSlot(slots[0].choiceId),
    };
  }
  const options = byKind('OPTION').map((choice) => choice.choiceId);
  if (options.length > 0) {
    return {
      kind: 'SELECT_EFFECT_OPTIONS',
      optionIds: selectRequiredIds(decision.facts, options),
    };
  }
  const candidates = byKind('CANDIDATE').map((choice) => choice.choiceId);
  if (candidates.length > 0) {
    return {
      kind: 'SELECT_EFFECT_CARDS',
      candidateIds: selectRequiredIds(decision.facts, candidates),
    };
  }
  throw new Error('The semantic ACTIVE_EFFECT fixture contains no selectable choice');
}

function selectRequiredIds(
  facts: readonly string[],
  candidateIds: readonly string[]
): readonly string[] {
  const { min, max } = parseSelectionRange(facts);
  const groups = parseSelectionGroups(facts);
  for (let target = min; target <= Math.min(max, candidateIds.length); target += 1) {
    const selected = findValidSubset(candidateIds, target, groups);
    if (selected) return selected;
  }
  throw new Error(
    `Cannot construct a legal semantic fixture selection: ${String(min)}-${String(max)} from ${String(candidateIds.length)} candidates`
  );
}

function parseSelectionRange(facts: readonly string[]): {
  readonly min: number;
  readonly max: number;
} {
  const joined = facts.join('\n');
  const match = joined.match(/最少选择\s+(\d+)\s+项，最多选择\s+(\d+)\s+项/u);
  if (!match) return { min: 1, max: 1 };
  return { min: Number(match[1]), max: Number(match[2]) };
}

interface SelectionGroupConstraint {
  readonly candidateIds: ReadonlySet<string>;
  readonly min: number;
  readonly max: number;
}

function parseSelectionGroups(facts: readonly string[]): readonly SelectionGroupConstraint[] {
  return facts.flatMap((text) => {
    const match = text.match(/^.+? 只能从 (.+) 中选择：最少 (\d+) 项、最多 (\d+) 项。/u);
    if (!match) return [];
    return [
      {
        candidateIds: new Set(match[1] === '空列表' ? [] : match[1].split('、')),
        min: Number(match[2]),
        max: Number(match[3]),
      },
    ];
  });
}

function findValidSubset(
  candidateIds: readonly string[],
  targetCount: number,
  groups: readonly SelectionGroupConstraint[]
): readonly string[] | null {
  const selected: string[] = [];
  let visited = 0;
  const search = (index: number): readonly string[] | null => {
    visited += 1;
    if (visited > 100_000) {
      throw new Error('Semantic fixture selection search exceeded its bounded node budget');
    }
    if (selected.length === targetCount) {
      return groups.every((group) => {
        const count = selected.filter((candidateId) => group.candidateIds.has(candidateId)).length;
        return count >= group.min && count <= group.max;
      })
        ? [...selected]
        : null;
    }
    if (
      index >= candidateIds.length ||
      selected.length + candidateIds.length - index < targetCount
    ) {
      return null;
    }
    const candidateId = candidateIds[index]!;
    const exceedsGroupMax = groups.some(
      (group) =>
        group.candidateIds.has(candidateId) &&
        selected.filter((selectedId) => group.candidateIds.has(selectedId)).length >= group.max
    );
    if (!exceedsGroupMax) {
      selected.push(candidateId);
      const included = search(index + 1);
      if (included) return included;
      selected.pop();
    }
    return search(index + 1);
  };
  return search(0);
}

function selectLegalNumber(facts: readonly string[]): number {
  const joined = facts.join('\n');
  const match = joined.match(
    /范围 (无下限|-?\d+(?:\.\d+)?) 至 (无上限|-?\d+(?:\.\d+)?)，(必须为整数|允许非整数)/u
  );
  if (!match) return 0;
  const min = match[1] === '无下限' ? null : Number(match[1]);
  const max = match[2] === '无上限' ? null : Number(match[2]);
  const value = min ?? (max !== null && max < 0 ? max : 0);
  return match[3] === '必须为整数' ? Math.ceil(value) : value;
}

function selectLegalPlacements(choiceIds: readonly string[]) {
  const byCandidate = new Map<string, SlotPosition[]>();
  for (const choiceId of choiceIds) {
    const separator = choiceId.lastIndexOf('@');
    if (separator <= 0) throw new Error(`Invalid semantic placement choice: ${choiceId}`);
    const candidateId = choiceId.slice(0, separator);
    const slot = parseSlot(choiceId.slice(separator + 1));
    const slots = byCandidate.get(candidateId) ?? [];
    slots.push(slot);
    byCandidate.set(candidateId, slots);
  }
  const used = new Set<SlotPosition>();
  return [...byCandidate.entries()].map(([candidateId, slots]) => {
    const toSlot = slots.find((slot) => !used.has(slot));
    if (!toSlot) throw new Error('Cannot construct unique stage formation fixture');
    used.add(toSlot);
    return { candidateId, toSlot };
  });
}

function parseSlot(value: string): SlotPosition {
  if (Object.values(SlotPosition).includes(value as SlotPosition)) return value as SlotPosition;
  throw new Error(`Invalid semantic slot fixture: ${value}`);
}

function requireFirst(values: readonly string[], decisionKind: string): string {
  return requireValue(values[0], decisionKind);
}

function requireValue(value: string | undefined, decisionKind: string): string {
  if (value) return value;
  throw new Error(`The semantic ${decisionKind} fixture contains no legal choice`);
}
