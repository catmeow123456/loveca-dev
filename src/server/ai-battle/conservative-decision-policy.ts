import {
  getAiDecisionWitness,
  type AiDecisionCandidate,
  type AiDecisionContract,
  type AiDecisionSelection,
  type AiLiveSetAction,
  type AiMainPhaseAction,
} from '../../application/ai-decisions/index.js';
import { SlotPosition } from '../../shared/types/enums.js';

export const AI_CONSERVATIVE_POLICY_VERSION = 'ai-battle.conservative-policy/v1' as const;

export type ConservativeDecisionResult =
  | {
      readonly ok: true;
      readonly policyVersion: typeof AI_CONSERVATIVE_POLICY_VERSION;
      readonly selection: AiDecisionSelection;
    }
  | {
      readonly ok: false;
      readonly reason: 'NO_LEGAL_SELECTION';
      readonly detail: string;
    };

/**
 * Deterministic production fallback frozen by the Phase 0 policy matrix.
 *
 * The policy consumes contract-local IDs only. It never reads authority card
 * IDs, interprets card text, or constructs GameCommand payloads.
 */
export function selectConservativeDecision(
  contract: AiDecisionContract
): ConservativeDecisionResult {
  const selection = selectByContract(contract);
  if (!selection) {
    return {
      ok: false,
      reason: 'NO_LEGAL_SELECTION',
      detail: `保守策略无法处理 ${contract.kind} 契约`,
    };
  }
  return {
    ok: true,
    policyVersion: AI_CONSERVATIVE_POLICY_VERSION,
    selection,
  };
}

function selectByContract(contract: AiDecisionContract): AiDecisionSelection | null {
  switch (contract.kind) {
    case 'MULLIGAN':
      return { kind: 'MULLIGAN', candidateIds: [] };
    case 'COST_PAYMENT':
    case 'JUDGMENT_CONFIRMATION':
    case 'SCORE_CONFIRMATION':
    case 'PHASE_CONFIRMATION':
    case 'ACTIVE_EFFECT':
      return getAiDecisionWitness({ contract });
    case 'SUCCESS_LIVE_SELECTION': {
      const candidate = [...contract.candidates].sort(compareCandidate)[0];
      return candidate ? { kind: 'SELECT_SUCCESS_LIVE', candidateId: candidate.candidateId } : null;
    }
    case 'MAIN_PHASE': {
      const candidateById = new Map(
        contract.candidates.map((candidate) => [candidate.candidateId, candidate])
      );
      const memberPlay = contract.actions
        .filter(
          (action): action is AiMainPhaseAction & { readonly kind: 'PLAY_MEMBER' } =>
            action.kind === 'PLAY_MEMBER'
        )
        .sort((left, right) => compareMainMemberPlay(left, right, candidateById))[0];
      const selected =
        memberPlay ?? contract.actions.find((action) => action.kind === 'END_MAIN_PHASE');
      return selected ? { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: selected.actionId } : null;
    }
    case 'LIVE_SET': {
      const handCandidateById = new Map(
        contract.handCandidates.map((candidate) => [candidate.candidateId, candidate])
      );
      const liveCardAction = contract.actions
        .filter(
          (
            action
          ): action is AiLiveSetAction & {
            readonly kind: 'SET_LIVE';
            readonly candidateId: string;
          } =>
            action.kind === 'SET_LIVE' &&
            action.isLiveCard === true &&
            typeof action.candidateId === 'string'
        )
        .sort((left, right) => compareLiveSetAction(left, right, handCandidateById))[0];
      const confirm = contract.actions.find((action) => action.kind === 'CONFIRM_LIVE_SET');
      const fallbackSet = contract.actions
        .filter(
          (
            action
          ): action is AiLiveSetAction & {
            readonly kind: 'SET_LIVE';
            readonly candidateId: string;
          } => action.kind === 'SET_LIVE' && typeof action.candidateId === 'string'
        )
        .sort((left, right) => compareLiveSetAction(left, right, handCandidateById))[0];
      const selected = liveCardAction ?? confirm ?? fallbackSet;
      return selected ? { kind: 'SELECT_LIVE_SET_ACTION', actionId: selected.actionId } : null;
    }
    case 'SPECIAL_MEMBER_PLAY':
      return { kind: 'CANCEL_SPECIAL_MEMBER_PLAY' };
  }
}

function compareMainMemberPlay(
  left: AiMainPhaseAction & { readonly kind: 'PLAY_MEMBER' },
  right: AiMainPhaseAction & { readonly kind: 'PLAY_MEMBER' },
  candidateById: ReadonlyMap<string, AiDecisionCandidate>
): number {
  const costDelta = compareNumber(
    left.paymentPreview?.energyCost ?? Number.POSITIVE_INFINITY,
    right.paymentPreview?.energyCost ?? Number.POSITIVE_INFINITY
  );
  if (costDelta !== 0) return costDelta;
  const candidateDelta = compareCandidate(
    candidateById.get(left.sourceCandidateId ?? '') ?? fallbackCandidate(left),
    candidateById.get(right.sourceCandidateId ?? '') ?? fallbackCandidate(right)
  );
  if (candidateDelta !== 0) return candidateDelta;
  const slotDelta = compareNumber(slotOrder(left.targetSlot), slotOrder(right.targetSlot));
  if (slotDelta !== 0) return slotDelta;
  return compareText(left.actionId, right.actionId);
}

function compareLiveSetAction(
  left: AiLiveSetAction & { readonly candidateId: string },
  right: AiLiveSetAction & { readonly candidateId: string },
  candidateById: ReadonlyMap<string, AiDecisionCandidate>
): number {
  return compareCandidate(
    candidateById.get(left.candidateId) ?? fallbackCandidate(left),
    candidateById.get(right.candidateId) ?? fallbackCandidate(right)
  );
}

function compareCandidate(left: AiDecisionCandidate, right: AiDecisionCandidate): number {
  return (
    compareNumber(left.projectedIndex, right.projectedIndex) ||
    compareText(left.candidateId, right.candidateId)
  );
}

function fallbackCandidate(input: {
  readonly actionId: string;
  readonly candidateId?: string;
  readonly sourceCandidateId?: string;
}): AiDecisionCandidate {
  return {
    candidateId: input.candidateId ?? input.sourceCandidateId ?? input.actionId,
    projectedIndex: Number.POSITIVE_INFINITY,
  };
}

function slotOrder(slot: SlotPosition | undefined): number {
  switch (slot) {
    case SlotPosition.LEFT:
      return 0;
    case SlotPosition.CENTER:
      return 1;
    case SlotPosition.RIGHT:
      return 2;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function compareNumber(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
