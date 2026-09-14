import type { AiCandidate, AiDecisionInput } from './protocol.js';
import { CardType } from '../../shared/types/enums.js';
import type { AiKnowledgeMaterial } from './presets.js';
import { summarizeAiLiveSetPlanning } from './live-set-planning.js';

const TEXT_KEYS = new Set(['cardText', 'cardTextCn', 'cardTextJp', 'effectText', 'text']);

/** Counts current visible hand instances, never slot alternatives, history or deck references. */
function decisionBrief(input: AiDecisionInput, ownDeck?: AiKnowledgeMaterial) {
  const resources = input.state.selfResources;
  const handMemberPrintedCosts: Record<string, number> = {};
  for (const card of resources.handCards) {
    if (card.cardType !== CardType.MEMBER) continue;
    const cost = card.printedCost ?? 'UNKNOWN';
    handMemberPrintedCosts[cost] = (handMemberPrintedCosts[cost] ?? 0) + 1;
  }
  return {
    basis: 'CURRENT_VISIBLE_RESOURCES',
    turn: input.state.turn,
    phase: input.state.phase,
    subPhase: input.state.subPhase,
    selfSeat: input.state.selfSeat,
    activeEnergyCount: resources.activeEnergyCount,
    handCardCount: resources.handCards.length,
    handMemberPrintedCosts,
    handLiveCount: resources.handLiveCount,
    ...(input.purpose === 'LIVE_SET'
      ? { liveSet: summarizeAiLiveSetPlanning(input, ownDeck) }
      : {}),
    stageMembers: resources.stageMembers.map((member) => ({
      slot: member.slot,
      name: member.name,
      printedCost: member.printedCost,
      enteredStageThisTurn: input.state.objects[member.objectId]?.enteredStageThisTurn,
    })),
    waitingRoomSummary: resources.waitingRoomSummary,
    successfulLiveCount: resources.successfulLiveCount,
  };
}

/** Share only exact common text segments; concatenation restores every original description. */
function commonDescriptionPrefix(candidates: readonly AiCandidate[]): string {
  let prefix = '';
  for (const part of candidates[0]!.description.split('；').slice(0, -1)) {
    const next = `${prefix}${part}；`;
    if (!candidates.every((candidate) => candidate.description.startsWith(next))) break;
    prefix = next;
  }
  return prefix;
}

/** Keep the flat selection refs/order; group only ordinary MAIN plays of the same hand instance. */
function organizeSpace(input: AiDecisionInput) {
  if (input.purpose !== 'MAIN' || input.space.kind !== 'ACTION') return input.space;
  const handMembers = new Set(
    input.state.selfResources.handCards
      .filter((card) => card.cardType === CardType.MEMBER)
      .map((card) => card.objectId)
  );
  const byInstance = new Map<string, AiCandidate[]>();
  for (const candidate of input.space.candidates) {
    if (!candidate.objectId || !candidate.targetSlot || !handMembers.has(candidate.objectId))
      continue;
    const group = byInstance.get(candidate.objectId) ?? [];
    group.push(candidate);
    byInstance.set(candidate.objectId, group);
  }
  const memberPlays: Record<
    string,
    {
      cardCount: 1;
      mutuallyExclusive: true;
      actionRefs: string[];
      common: Pick<AiCandidate, 'objectId' | 'effectText' | 'energyCost'>;
      descriptionPrefix: string;
    }
  > = {};
  const replacements = new Map<string, Record<string, unknown>>();
  for (const [objectId, candidates] of byInstance) {
    if (candidates.length < 2) continue;
    const groupRef = `m${Object.keys(memberPlays).length + 1}`;
    const common: Pick<AiCandidate, 'objectId' | 'effectText' | 'energyCost'> = {
      objectId,
      ...(candidates[0]!.effectText !== undefined &&
      candidates.every((candidate) => candidate.effectText === candidates[0]!.effectText)
        ? { effectText: candidates[0]!.effectText }
        : {}),
      ...(candidates[0]!.energyCost !== undefined &&
      candidates.every((candidate) => candidate.energyCost === candidates[0]!.energyCost)
        ? { energyCost: candidates[0]!.energyCost }
        : {}),
    };
    const descriptionPrefix = commonDescriptionPrefix(candidates);
    memberPlays[groupRef] = {
      cardCount: 1,
      mutuallyExclusive: true,
      actionRefs: candidates.map((candidate) => candidate.ref),
      common,
      descriptionPrefix,
    };
    for (const candidate of candidates) {
      const option: Record<string, unknown> = {
        ...candidate,
        memberPlayRef: groupRef,
        description: candidate.description.slice(descriptionPrefix.length),
      };
      for (const key of Object.keys(common)) delete option[key];
      replacements.set(candidate.ref, option);
    }
  }
  const { candidates: allCandidates, ...constraints } = input.space;
  return {
    ...constraints,
    ...(Object.keys(memberPlays).length ? { memberPlays } : {}),
    candidates: allCandidates.map((candidate) => replacements.get(candidate.ref) ?? candidate),
  };
}

function organizeContext(context: AiDecisionInput['context']) {
  if (!context) return undefined;
  const index = context.recentDecisions.length - 1;
  const duplicatesLatest =
    context.lastAction &&
    index >= 0 &&
    JSON.stringify(context.lastAction) === JSON.stringify(context.recentDecisions[index]);
  return {
    ...context,
    ...(duplicatesLatest ? { lastAction: { recentDecisionIndex: index } } : {}),
  };
}

/** Lossless wire normalization: exact front snapshots and repeated long text are sent once.
 * Effective and printed values with any difference retain different references, even for one code.
 * Candidate refs, ordering, object IDs and all legal/visibility facts remain intact.
 */
export function compactAiDecisionInput(
  input: AiDecisionInput,
  ownDeck?: AiKnowledgeMaterial
): Record<string, unknown> {
  const organized = {
    decisionBrief: decisionBrief(input, ownDeck),
    purpose: input.purpose,
    ...(input.liveSet ? { liveSet: input.liveSet } : {}),
    ...(input.effect ? { effect: input.effect } : {}),
    space: organizeSpace(input),
    responseSchema: input.responseSchema,
    ...(input.context ? { context: organizeContext(input.context) } : {}),
    ...(input.history ? { history: input.history } : {}),
    state: input.state,
  };
  const textCounts = new Map<string, number>();
  const count = (value: unknown, key = ''): void => {
    if (typeof value === 'string' && TEXT_KEYS.has(key) && value.length >= 64)
      textCounts.set(value, (textCounts.get(value) ?? 0) + 1);
    else if (Array.isArray(value)) value.forEach((item) => count(item));
    else if (value && typeof value === 'object')
      Object.entries(value).forEach(([k, v]) => count(v, k));
  };
  count(organized);
  const textRefs = new Map<string, string>();
  const frontRefs = new Map<string, string>();
  const texts: Record<string, string> = {};
  const cardFacts: Record<string, unknown> = {};
  const pack = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string' && TEXT_KEYS.has(key) && (textCounts.get(value) ?? 0) > 1) {
      let ref = textRefs.get(value);
      if (!ref) {
        ref = `t${textRefs.size + 1}`;
        textRefs.set(value, ref);
        texts[ref] = value;
      }
      return { textRef: ref };
    }
    if (Array.isArray(value)) return value.map((item) => pack(item));
    if (value && typeof value === 'object') {
      if (key === 'frontInfo') {
        const serialized = JSON.stringify(value);
        let ref = frontRefs.get(serialized);
        if (!ref) {
          ref = `f${frontRefs.size + 1}`;
          frontRefs.set(serialized, ref);
          cardFacts[ref] = pack(value);
        }
        return { cardFactsRef: ref };
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pack(v, k)]));
    }
    return value;
  };
  const compact = pack(organized) as Record<string, unknown>;
  return {
    ...compact,
    ...(frontRefs.size ? { cardFacts } : {}),
    ...(textRefs.size ? { texts } : {}),
  };
}
