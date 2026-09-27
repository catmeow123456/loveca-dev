import { GameCommandType } from '../../application/game-commands.js';
import { findAiCardSelection } from './protocol.js';
import {
  validateSelection,
  type AiDecision,
  type AiDecisionSpace,
  type AiSelection,
} from './decision.js';

/** Only forced choices bypass the model; unaffordable development alone is not sufficient. */
export function getAiMechanicalSelection(decision: AiDecision): AiSelection | null {
  if (decision.input.purpose === 'MAIN') {
    const space = decision.input.space;
    if (space.kind !== 'ACTION' || space.candidates.length !== 1) return null;
    const selection: AiSelection = { kind: 'ACTION', actionRef: space.candidates[0]!.ref };
    return decision.toCommand(selection, 0).type === GameCommandType.END_PHASE ? selection : null;
  }
  if (decision.input.purpose === 'SUCCESS_LIVE') {
    const candidates = decision.input.space.candidates;
    return candidates.length === 1 ? { kind: 'ACTION', actionRef: candidates[0]!.ref } : null;
  }
  if (decision.input.purpose === 'EFFECT') {
    const space = decision.input.space;
    if (space.kind === 'ACTION')
      return space.candidates.length === 1
        ? { kind: 'ACTION', actionRef: space.candidates[0]!.ref }
        : null;
    // Shortcuts must satisfy the same grouped constraints as a model answer; an
    // unverifiable shortcut defers to the fallback search instead of failing later.
    const verified = (selection: AiSelection): AiSelection | null => {
      try {
        validateSelection(space, selection);
        return selection;
      } catch {
        return null;
      }
    };
    if (space.candidates.length === 0 && (space.canSkip || space.min === 0))
      return verified({ kind: 'CARDS', cardRefs: [] });
    if (space.canSkip) return null;
    if (
      space.min === space.max &&
      space.min === space.candidates.length &&
      (!space.ordered || space.candidates.length <= 1)
    ) {
      return verified({
        kind: 'CARDS',
        cardRefs: space.candidates.map((candidate) => candidate.ref),
      });
    }
    return null;
  }
  if (
    decision.input.purpose !== 'PUBLIC_DISPLAY' &&
    decision.input.purpose !== 'EFFECT_CONFIRM' &&
    decision.input.purpose !== 'RULE_CONFIRM'
  )
    return null;
  const candidate = decision.input.space.candidates[0];
  if (!candidate || decision.input.space.candidates.length !== 1)
    throw new Error('Invalid public-display decision');
  const selection: AiSelection = { kind: 'ACTION', actionRef: candidate.ref };
  validateSelection(decision.input.space, selection);
  return selection;
}

/**
 * One deterministic, complete fallback for the currently supported windows. Never trial-executes.
 * `invalidSelection` carries a model answer that failed strict validation; LIVE_SET repairs its
 * recognizable intent instead of discarding the whole plan (an empty set forfeits performance
 * and the replenishment draw). Other windows keep their existing deterministic policy.
 */
export function getAiFallbackSelection(
  decision: AiDecision,
  invalidSelection?: AiSelection | null
): AiSelection {
  const mechanical = getAiMechanicalSelection(decision);
  if (mechanical) return mechanical;
  if (decision.input.purpose === 'MULLIGAN') {
    const selection: AiSelection = { kind: 'CARDS', cardRefs: [] };
    validateSelection(decision.input.space, selection);
    return selection;
  }
  if (decision.input.purpose === 'LIVE_SET') {
    if (decision.input.space.kind !== 'CARDS') throw new Error('Invalid LIVE set decision space');
    const repaired = repairAiLiveSetSelection(decision.input.space, invalidSelection);
    if (repaired) return repaired;
    const setObjectIds = new Set(decision.input.liveSet?.setCardObjectIds ?? []);
    const selection: AiSelection = {
      kind: 'CARDS',
      cardRefs: decision.input.space.candidates
        .filter((candidate) => candidate.objectId && setObjectIds.has(candidate.objectId))
        .map((candidate) => candidate.ref),
    };
    validateSelection(decision.input.space, selection);
    return selection;
  }
  if (
    decision.input.purpose === 'EFFECT' ||
    decision.input.purpose === 'PENDING_ORDER' ||
    decision.input.purpose === 'SUCCESS_LIVE'
  ) {
    const space = decision.input.space;
    if (space.kind === 'CARDS') {
      const selection = findAiCardSelection(space);
      validateSelection(space, selection);
      return selection;
    }
    const selections = space.candidates.map((candidate): AiSelection => ({
      kind: 'ACTION',
      actionRef: candidate.ref,
    }));
    const skip = selections.find((selection) => {
      const command = decision.toCommand(selection, 0);
      return (
        command.type === GameCommandType.CONFIRM_EFFECT_STEP && command.selectedCardId === null
      );
    });
    const selection = skip ?? selections[0];
    if (!selection) throw new Error('No complete effect fallback');
    validateSelection(space, selection);
    return selection;
  }
  const commandType =
    decision.input.purpose === 'MAIN' ? GameCommandType.END_PHASE : GameCommandType.CONFIRM_STEP;
  for (const candidate of decision.input.space.candidates) {
    const selection: AiSelection = { kind: 'ACTION', actionRef: candidate.ref };
    // Mapping is pure and does not submit; the real caller supplies its clock at conditional submission.
    if (decision.toCommand(selection, 0).type === commandType) return selection;
  }
  throw new Error('No complete fallback for this decision');
}

/**
 * Bounded repair of an invalid model LIVE_SET answer. Keeps only recognizable candidate refs
 * (deduplicated), ranks performable LIVE targets (stage alone meets the base requirement, higher
 * score first) above other LIVE above cycling cards, preserves the model's own order within equal
 * ranks, then truncates to the authoritative set limit. Returns null when nothing is recognizable
 * so the caller keeps its existing keep-set fallback. Never invents refs the model did not send.
 */
function repairAiLiveSetSelection(
  space: Extract<AiDecisionSpace, { kind: 'CARDS' }>,
  attempted: AiSelection | null | undefined
): AiSelection | null {
  if (!attempted || attempted.kind !== 'CARDS') return null;
  const known = new Map(space.candidates.map((candidate) => [candidate.ref, candidate]));
  const seen = new Set<string>();
  const recognized = attempted.cardRefs.filter((ref) => {
    if (!known.has(ref) || seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });
  if (recognized.length === 0) return null;
  const rank = (ref: string): number => {
    const budget = known.get(ref)?.liveBaseBudget;
    if (!budget) return 0;
    return budget.stageAloneMeetsBaseRequirement ? 2 : 1;
  };
  const score = (ref: string): number => known.get(ref)?.liveBaseBudget?.score ?? 0;
  // Array.prototype.sort is stable, so equal-ranked refs keep the model's order.
  const ranked = [...recognized].sort((a, b) => rank(b) - rank(a) || score(b) - score(a));
  const selection: AiSelection = { kind: 'CARDS', cardRefs: ranked.slice(0, space.max) };
  validateSelection(space, selection);
  return selection;
}
