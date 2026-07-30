import type { GameState } from '../../src/domain/entities/game';
import { confirmActiveEffectStep as confirmActiveEffectStepOnce } from '../../src/application/card-effect-runner';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createAutoAdvancePublicEffectChoiceCommand,
  createAutoAdvancePublicRevealCommand,
} from '../../src/application/game-commands';
import type { GameSession } from '../../src/application/game-session';

export function confirmActiveEffectStepThroughPublicReveal(
  ...args: Parameters<typeof confirmActiveEffectStepOnce>
): GameState {
  const afterSelection = confirmActiveEffectStepOnce(...args);
  const playerId = args[1];
  const effectId = args[2];
  const afterEffectChoice =
    afterSelection.activeEffect?.stepId === PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID
      ? confirmActiveEffectStepOnce(afterSelection, playerId, effectId)
      : afterSelection;
  const afterCardSelection =
    afterEffectChoice.activeEffect?.stepId === PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID
      ? confirmActiveEffectStepOnce(afterEffectChoice, playerId, effectId)
      : afterEffectChoice;
  return afterCardSelection.activeEffect?.stepId === PUBLIC_REVEAL_DWELL_STEP_ID
    ? confirmActiveEffectStepOnce(afterCardSelection, playerId, effectId)
    : afterCardSelection;
}

export function confirmPublicSelectionIfNeeded(
  session: Pick<GameSession, 'state' | 'executeCommand'>,
  options: { readonly advancePublicRevealDwell?: boolean } = {}
): void {
  let effect = session.state?.activeEffect;
  if (effect?.stepId === PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID) {
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      activeEffect: { ...effect, publicEffectChoiceAutoAdvanceAt: 0 },
    };
    session.executeCommand(
      createAutoAdvancePublicEffectChoiceCommand(effect.awaitingPlayerId!, effect.id, 0)
    );
    effect = session.state?.activeEffect;
  }
  if (effect?.stepId === PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID) {
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      activeEffect: { ...effect, publicCardSelectionAutoAdvanceAt: 0 },
    };
    session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(effect.awaitingPlayerId!, effect.id, 0)
    );
    effect = session.state?.activeEffect;
  }
  if (effect?.stepId !== PUBLIC_REVEAL_DWELL_STEP_ID) return;
  if (options.advancePublicRevealDwell === false) return;
  advancePublicRevealDwellIfNeeded(session);
}

export function advancePublicRevealDwellIfNeeded(
  session: Pick<GameSession, 'state' | 'executeCommand'>
) {
  const effect = session.state?.activeEffect;
  if (effect?.stepId !== PUBLIC_REVEAL_DWELL_STEP_ID) return;
  const generation = effect.publicRevealGeneration ?? `test-public-reveal:${effect.id}`;
  (session as unknown as { authorityState: GameState }).authorityState = {
    ...session.state!,
    activeEffect: {
      ...effect,
      publicRevealAutoAdvanceAt: 0,
      publicRevealGeneration: generation,
    },
  };
  return session.executeCommand(
    createAutoAdvancePublicRevealCommand(effect.awaitingPlayerId!, effect.id, 0, generation)
  );
}
