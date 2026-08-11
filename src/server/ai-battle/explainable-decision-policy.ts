import type { AiDecisionSelection } from '../../application/ai-decisions/index.js';
import { getBaseCardCode } from '../../shared/utils/card-code.js';
import type {
  AiObservedAction,
  AiObservedCandidate,
  AiObservedDecision,
} from './ai-observation.js';
import type { AiStrategyContext } from './strategy-context.js';

export const AI_EXPLAINABLE_DECISION_POLICY_VERSION = 'ai-battle.explainable-policy/v1' as const;

export type AiStrategyTier = 'RULE_FORCED' | 'DETERMINISTIC' | 'HEURISTIC';

export type ExplainableDecisionResult =
  | {
      readonly ok: true;
      readonly policyVersion: typeof AI_EXPLAINABLE_DECISION_POLICY_VERSION;
      readonly tier: AiStrategyTier;
      readonly reasonCode: string;
      readonly summary: string;
      readonly selection: AiDecisionSelection;
      readonly consideredIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'NO_LEGAL_SELECTION';
      readonly detail: string;
    };

/**
 * Phase 2 no-LLM policy.
 *
 * This policy consumes only the strategy context envelope. Its explanations
 * are short decision audit facts, not private reasoning traces.
 */
export function selectExplainableDecision(context: AiStrategyContext): ExplainableDecisionResult {
  const decision = context.observation.decision;

  switch (decision.kind) {
    case 'JUDGMENT_CONFIRMATION':
      return selected(
        'RULE_FORCED',
        'CONFIRM_AUTHORITY_JUDGMENT',
        'Confirm the authority-prepared judgment.',
        { kind: 'CONFIRM_JUDGMENT' }
      );
    case 'SCORE_CONFIRMATION':
      return selected(
        'RULE_FORCED',
        'CONFIRM_AUTHORITY_SCORE',
        'Confirm the authority-computed LIVE score.',
        { kind: 'CONFIRM_SCORE' }
      );
    case 'PHASE_CONFIRMATION':
      return selected('RULE_FORCED', 'CONFIRM_PHASE_PROGRESS', 'Confirm the current phase step.', {
        kind: 'CONFIRM_PHASE',
      });
    case 'COST_PAYMENT':
      return selectCostPayment(decision);
    case 'MULLIGAN':
      return selectMulligan(decision);
    case 'SUCCESS_LIVE_SELECTION':
      return selectSuccessLive(decision);
    case 'MAIN_PHASE':
      return selectMainPhase(context, decision);
    case 'LIVE_SET':
      return selectLiveSet(decision);
    case 'SPECIAL_MEMBER_PLAY':
      return selected(
        'HEURISTIC',
        'EVALUATE_SPECIAL_MEMBER_PLAY',
        'Expose the complete special-member-play choice to the model; cancellation is only the conservative witness.',
        { kind: 'CANCEL_SPECIAL_MEMBER_PLAY' }
      );
    case 'ACTIVE_EFFECT':
      return selectActiveEffect(decision);
  }
}

function selectCostPayment(decision: AiObservedDecision): ExplainableDecisionResult {
  const requiredCount = decision.input?.requiredCount;
  if (requiredCount === undefined || decision.candidates.length < requiredCount) {
    return noSelection('The cost-payment observation has no complete legal candidate set.');
  }
  const candidateIds = decision.candidates
    .slice(0, requiredCount)
    .map((candidate) => candidate.candidateId);
  return selected(
    'RULE_FORCED',
    'PAY_REQUIRED_COST',
    'Pay the exact required cost with the stable candidate order.',
    { kind: 'PAY_COST', candidateIds },
    candidateIds
  );
}

function selectMulligan(decision: AiObservedDecision): ExplainableDecisionResult {
  const visible = decision.candidates.filter(
    (
      candidate
    ): candidate is AiObservedCandidate & { readonly card: NonNullable<typeof candidate.card> } =>
      candidate.card !== undefined
  );
  const liveCandidates = visible
    .filter((candidate) => candidate.card.cardType === 'LIVE')
    .sort(compareLiveCandidate);
  const keptLiveId = liveCandidates[0]?.candidateId;
  const candidateIds = visible
    .filter((candidate) => {
      if (candidate.card.cardType === 'LIVE') {
        return candidate.candidateId !== keptLiveId;
      }
      return candidate.card.cardType === 'MEMBER' && (candidate.card.cost ?? 0) >= 11;
    })
    .map((candidate) => candidate.candidateId)
    .slice(0, decision.input?.maxSelections ?? decision.candidates.length);

  return selected(
    'HEURISTIC',
    'MULLIGAN_FOR_EARLY_CURVE',
    'Keep early members and one achievable LIVE; return redundant LIVE and top-end cards.',
    { kind: 'MULLIGAN', candidateIds },
    visible.map((candidate) => candidate.candidateId)
  );
}

function selectSuccessLive(decision: AiObservedDecision): ExplainableDecisionResult {
  const candidate = [...decision.candidates].sort((left, right) => {
    const scoreDelta = (right.card?.score ?? 0) - (left.card?.score ?? 0);
    return scoreDelta || compareText(left.candidateId, right.candidateId);
  })[0];
  return candidate
    ? selected(
        'HEURISTIC',
        'SELECT_HIGHEST_SCORE_SUCCESS_LIVE',
        'Place the highest-score eligible LIVE into the success zone.',
        { kind: 'SELECT_SUCCESS_LIVE', candidateId: candidate.candidateId },
        decision.candidates.map((item) => item.candidateId)
      )
    : noSelection('The success-LIVE decision has no candidate.');
}

function selectMainPhase(
  context: AiStrategyContext,
  decision: AiObservedDecision
): ExplainableDecisionResult {
  const candidateById = new Map(
    decision.candidates.map((candidate) => [candidate.candidateId, candidate])
  );
  const waitingRoomCount =
    context.observation.seats[context.observation.viewerSeat].zones.find(
      (zone) => zone.zoneKey === 'WAITING_ROOM'
    )?.count ?? 0;
  const emptyStageSlots = new Set(
    context.observation.seats[context.observation.viewerSeat].zones
      .filter((zone) => zone.zoneKey.startsWith('MEMBER_') && zone.count === 0)
      .map((zone) => zone.zoneKey.replace('MEMBER_', ''))
  );
  const roleByBaseCode = new Map(
    context.knowledge.deckPlaybook.cardRoles.map((role) => [getBaseCardCode(role.cardCode), role])
  );
  const ranked = decision.actions
    .map((action) => {
      const candidate = action.candidateId ? candidateById.get(action.candidateId) : undefined;
      const role = candidate?.card
        ? roleByBaseCode.get(getBaseCardCode(candidate.card.cardCode))
        : undefined;
      let score = 0;
      if (action.kind === 'PLAY_MEMBER') {
        score = 10_000 - (action.paymentPreview?.energyCost ?? 99) * 100;
        if (action.targetSlot && emptyStageSlots.has(action.targetSlot)) score += 1_000;
        if (action.targetSlot === 'CENTER' && role?.roleTags.includes('CENTER_PAYOFF')) {
          score += 3_000;
        }
      } else if (action.kind === 'BEGIN_SPECIAL_MEMBER_PLAY') {
        // Keep cancellation as the conservative fallback witness. The model
        // receives the complete legal special-play path and decides whether its
        // card text and resulting board are worth entering the next window.
        score = -1;
      } else if (
        action.kind === 'ACTIVATE_ABILITY' &&
        waitingRoomCount > 0 &&
        role?.roleTags.some((item) => item.includes('RECOVERY'))
      ) {
        score = 8_500;
      } else if (action.kind === 'ACTIVATE_ABILITY') {
        score = 2_000;
      }
      return { action, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score || compareText(left.action.actionId, right.action.actionId)
    );
  const chosen = ranked[0]?.action;
  const hasSpecialMemberPlay = decision.actions.some(
    (action) => action.kind === 'BEGIN_SPECIAL_MEMBER_PLAY'
  );
  return chosen
    ? selected(
        chosen.kind === 'END_MAIN_PHASE' && !hasSpecialMemberPlay ? 'DETERMINISTIC' : 'HEURISTIC',
        chosen.kind === 'END_MAIN_PHASE' && hasSpecialMemberPlay
          ? 'EVALUATE_SPECIAL_MEMBER_PLAY'
          : chosen.kind === 'END_MAIN_PHASE'
            ? 'END_MAIN_PHASE_WITHOUT_HIGHER_VALUE_ACTION'
            : chosen.kind === 'PLAY_MEMBER'
              ? 'PLAY_HIGHEST_RANKED_MEMBER'
              : chosen.kind === 'ACTIVATE_ABILITY'
                ? 'ACTIVATE_HIGHEST_RANKED_ABILITY'
                : 'SELECT_HIGHEST_RANKED_MAIN_ACTION',
        chosen.kind === 'END_MAIN_PHASE' && hasSpecialMemberPlay
          ? 'Expose the complete special-member-play choice to the model; ending is only the conservative witness.'
          : chosen.kind === 'END_MAIN_PHASE'
            ? 'End the main phase because no higher-value certified action remains.'
            : 'Choose the highest-ranked legal main-phase action from the current playbook context.',
        { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: chosen.actionId },
        ranked.map((item) => item.action.actionId)
      )
    : noSelection('The main-phase decision has no action.');
}

function selectLiveSet(decision: AiObservedDecision): ExplainableDecisionResult {
  const candidateById = new Map(
    decision.candidates.map((candidate) => [candidate.candidateId, candidate])
  );
  const setActions = decision.actions
    .filter(
      (action): action is AiObservedAction & { readonly candidateId: string } =>
        action.kind === 'SET_LIVE' && action.candidateId !== undefined
    )
    .filter((action) => candidateById.get(action.candidateId)?.card?.cardType === 'LIVE')
    .sort((left, right) => {
      const candidateDelta = compareLiveCandidate(
        candidateById.get(left.candidateId)!,
        candidateById.get(right.candidateId)!
      );
      return candidateDelta || compareText(left.actionId, right.actionId);
    });
  const setAction = setActions[0];
  if (setAction) {
    return selected(
      'HEURISTIC',
      'SET_HIGHEST_RANKED_LIVE',
      'Set the highest-ranked visible LIVE candidate before confirming.',
      { kind: 'SELECT_LIVE_SET_ACTION', actionId: setAction.actionId },
      setActions.map((action) => action.actionId)
    );
  }
  const confirm = decision.actions.find((action) => action.kind === 'CONFIRM_LIVE_SET');
  return confirm
    ? selected(
        'DETERMINISTIC',
        'CONFIRM_LIVE_SET',
        'Confirm because no visible legal LIVE candidate remains to set.',
        { kind: 'SELECT_LIVE_SET_ACTION', actionId: confirm.actionId },
        decision.actions.map((action) => action.actionId)
      )
    : noSelection('The LIVE-set decision has neither a LIVE candidate nor confirmation.');
}

function selectActiveEffect(decision: AiObservedDecision): ExplainableDecisionResult {
  const input = decision.input;
  if (!input) return noSelection('The active-effect decision has no input description.');
  switch (input.kind) {
    case 'CONFIRM':
      return selected(
        'RULE_FORCED',
        'CONFIRM_EFFECT',
        'Confirm the effect step without additional input.',
        { kind: 'CONFIRM_EFFECT' }
      );
    case 'DEADLINE_CONFIRMATION':
      return selected(
        'RULE_FORCED',
        'CONFIRM_EXPIRED_PUBLIC_DEADLINE',
        'Advance the expired public display deadline.',
        { kind: 'CONFIRM_DEADLINE' }
      );
    case 'CARD_SELECTION': {
      if (input.canSkip) {
        return selected(
          'HEURISTIC',
          'EVALUATE_OPTIONAL_CARD_SELECTION',
          'Expose the optional card-selection tradeoff to the model; skipping is only the conservative witness.',
          { kind: 'SELECT_EFFECT_CARDS', candidateIds: [] }
        );
      }
      const candidateIds = buildGroupedSelection(
        decision.candidates.map((candidate) => candidate.candidateId),
        input.minSelections ?? input.requiredCount ?? 0,
        input.maxSelections ?? input.requiredCount ?? decision.candidates.length,
        input.groups ?? []
      );
      return candidateIds
        ? selected(
            'RULE_FORCED',
            'SELECT_MANDATORY_EFFECT_CARDS',
            'Use stable candidate order to satisfy mandatory selection constraints.',
            { kind: 'SELECT_EFFECT_CARDS', candidateIds },
            decision.candidates.map((candidate) => candidate.candidateId)
          )
        : noSelection('Mandatory card-selection constraints are not satisfiable.');
    }
    case 'OPTION_SELECTION': {
      if (input.canSkip) {
        return selected(
          'HEURISTIC',
          'EVALUATE_OPTIONAL_EFFECT_OPTION',
          'Expose the optional effect options to the model; skipping is only the conservative witness.',
          { kind: 'SELECT_EFFECT_OPTIONS', optionIds: [] }
        );
      }
      const optionIds = decision.options
        .slice(0, input.minSelections ?? 0)
        .map((option) => option.optionId);
      return optionIds.length >= (input.minSelections ?? 0)
        ? selected(
            'RULE_FORCED',
            'SELECT_MANDATORY_EFFECT_OPTIONS',
            'Use stable option order to satisfy the mandatory option count.',
            { kind: 'SELECT_EFFECT_OPTIONS', optionIds },
            decision.options.map((option) => option.optionId)
          )
        : noSelection('Mandatory option-selection constraints are not satisfiable.');
    }
    case 'SLOT_SELECTION':
      if (input.canSkip) {
        return selected(
          'HEURISTIC',
          'EVALUATE_OPTIONAL_SLOT_SELECTION',
          'Expose the optional slot choice to the model; skipping is only the conservative witness.',
          { kind: 'CONFIRM_EFFECT' }
        );
      }
      return input.slots?.[0]
        ? selected(
            'RULE_FORCED',
            'SELECT_MANDATORY_SLOT',
            'Choose the first stable legal slot.',
            { kind: 'SELECT_EFFECT_SLOT', slot: input.slots[0] },
            input.slots
          )
        : noSelection('Mandatory slot selection has no slot.');
    case 'NUMBER_INPUT': {
      const value = input.min ?? (input.max !== undefined && input.max < 0 ? input.max : 0);
      return selected(
        'RULE_FORCED',
        'SELECT_MANDATORY_NUMBER',
        'Choose the minimum stable legal numeric value.',
        {
          kind: 'SELECT_EFFECT_NUMBER',
          value: input.integerOnly ? Math.ceil(value) : value,
        }
      );
    }
    case 'STAGE_FORMATION':
      if (input.canSkip) {
        return selected(
          'HEURISTIC',
          'EVALUATE_OPTIONAL_STAGE_FORMATION',
          'Expose the optional formation change to the model; keeping the formation is only the conservative witness.',
          { kind: 'CONFIRM_EFFECT' }
        );
      }
      return selected(
        'RULE_FORCED',
        'PRESERVE_MANDATORY_STAGE_FORMATION',
        'Submit every member in its original slot as a stable legal formation.',
        {
          kind: 'SET_STAGE_FORMATION',
          placements: (input.members ?? []).map((member) => ({
            candidateId: member.candidateId,
            toSlot: member.originalSlot,
          })),
        },
        (input.members ?? []).map((member) => member.candidateId)
      );
    case 'ABILITY_ORDER':
      if (input.canResolveInOrder) {
        return selected(
          'DETERMINISTIC',
          'RESOLVE_ABILITIES_IN_STABLE_ORDER',
          'Resolve the pending abilities in the authority-provided order.',
          { kind: 'RESOLVE_ABILITIES_IN_ORDER' }
        );
      }
      if (decision.options[0]) {
        return selected(
          'RULE_FORCED',
          'SELECT_FIRST_MANDATORY_ABILITY_OPTION',
          'Choose the first stable pending ability option.',
          { kind: 'SELECT_EFFECT_OPTIONS', optionIds: [decision.options[0].optionId] },
          decision.options.map((option) => option.optionId)
        );
      }
      return decision.candidates[0]
        ? selected(
            'RULE_FORCED',
            'SELECT_FIRST_MANDATORY_ABILITY_SOURCE',
            'Choose the first stable pending ability source.',
            {
              kind: 'SELECT_EFFECT_CARDS',
              candidateIds: [decision.candidates[0].candidateId],
            },
            decision.candidates.map((candidate) => candidate.candidateId)
          )
        : noSelection('Ability-order selection has no option or source candidate.');
  }
}

function buildGroupedSelection(
  candidateIds: readonly string[],
  minSelections: number,
  maxSelections: number,
  groups: readonly {
    readonly candidateIds: readonly string[];
    readonly minCount: number;
    readonly maxCount: number;
  }[]
): readonly string[] | null {
  const selectedIds: string[] = [];
  const canAdd = (candidateId: string) =>
    groups.every((group) => {
      if (!group.candidateIds.includes(candidateId)) return true;
      return (
        selectedIds.filter((selectedId) => group.candidateIds.includes(selectedId)).length <
        group.maxCount
      );
    });

  for (const group of groups) {
    while (
      selectedIds.filter((candidateId) => group.candidateIds.includes(candidateId)).length <
      group.minCount
    ) {
      const next = group.candidateIds.find(
        (candidateId) =>
          candidateIds.includes(candidateId) &&
          !selectedIds.includes(candidateId) &&
          canAdd(candidateId)
      );
      if (!next) return null;
      selectedIds.push(next);
    }
  }
  for (const candidateId of candidateIds) {
    if (selectedIds.length >= minSelections) break;
    if (!selectedIds.includes(candidateId) && canAdd(candidateId)) {
      selectedIds.push(candidateId);
    }
  }
  if (selectedIds.length < minSelections || selectedIds.length > maxSelections) return null;
  return groups.every((group) => {
    const count = selectedIds.filter((candidateId) =>
      group.candidateIds.includes(candidateId)
    ).length;
    return count >= group.minCount && count <= group.maxCount;
  })
    ? selectedIds
    : null;
}

function compareLiveCandidate(left: AiObservedCandidate, right: AiObservedCandidate): number {
  const leftRequirement = left.card?.requiredHearts?.totalRequired ?? Number.POSITIVE_INFINITY;
  const rightRequirement = right.card?.requiredHearts?.totalRequired ?? Number.POSITIVE_INFINITY;
  const requirementDelta = leftRequirement - rightRequirement;
  if (requirementDelta !== 0) return requirementDelta;
  const scoreDelta = (right.card?.score ?? 0) - (left.card?.score ?? 0);
  return scoreDelta || compareText(left.candidateId, right.candidateId);
}

function selected(
  tier: AiStrategyTier,
  reasonCode: string,
  summary: string,
  selection: AiDecisionSelection,
  consideredIds: readonly string[] = []
): ExplainableDecisionResult {
  return {
    ok: true,
    policyVersion: AI_EXPLAINABLE_DECISION_POLICY_VERSION,
    tier,
    reasonCode,
    summary,
    selection,
    consideredIds,
  };
}

function noSelection(detail: string): ExplainableDecisionResult {
  return { ok: false, reason: 'NO_LEGAL_SELECTION', detail };
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
