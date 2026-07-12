import type { GameState } from '../../src/domain/entities/game';
import { confirmActiveEffectStep as confirmActiveEffectStepOnce } from '../../src/application/card-effect-runner';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import type { GameSession } from '../../src/application/game-session';

export function confirmActiveEffectStepThroughPublicReveal(
  ...args: Parameters<typeof confirmActiveEffectStepOnce>
): GameState {
  const afterSelection = confirmActiveEffectStepOnce(...args);
  const playerId = args[1];
  const effectId = args[2];
  return afterSelection.activeEffect?.stepId === PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID
    ? confirmActiveEffectStepOnce(afterSelection, playerId, effectId)
    : afterSelection;
}

export function confirmPublicSelectionIfNeeded(
  session: Pick<GameSession, 'state' | 'executeCommand'>
): void {
  const effect = session.state?.activeEffect;
  if (effect?.stepId !== PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID) return;
  session.executeCommand(
    createConfirmEffectStepCommand(effect.awaitingPlayerId!, effect.id)
  );
}
