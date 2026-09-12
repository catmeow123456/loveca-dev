import { GameCommandType } from '../../application/game-commands.js';
import { findAiCardSelection } from './protocol.js';
import { validateSelection, type AiDecision, type AiSelection } from './decision.js';

/** Strategic phase completion remains a model decision even when no development is affordable. */
export function getAiMechanicalSelection(decision: AiDecision): AiSelection | null {
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
      return verified({ kind: 'CARDS', cardRefs: space.candidates.map((candidate) => candidate.ref) });
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

/** One deterministic, complete fallback for the currently supported windows. Never trial-executes. */
export function getAiFallbackSelection(decision: AiDecision): AiSelection {
  const mechanical = getAiMechanicalSelection(decision);
  if (mechanical) return mechanical;
  if (decision.input.purpose === 'MULLIGAN') {
    const selection: AiSelection = { kind: 'CARDS', cardRefs: [] };
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
