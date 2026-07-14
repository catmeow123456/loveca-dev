import type {
  ActiveEffectState,
  GameState,
  PendingAbilityState,
} from '../../../domain/entities/game.js';
import type { SlotPosition } from '../../../shared/types/enums.js';
import {
  EnergySelectionRequiredError,
  withEnergySelectionResolutions,
  type EnergySelectionResolution,
} from '../../effects/energy-selection.js';
import {
  createActiveEffectEnergySelectionWindow,
  ENERGY_OPERATION_SELECTION_STEP_ID,
  resolveEnergyOperationSelectionStep,
} from './energy-operation-selection.js';
import {
  createPublicCardSelectionConfirmationWindow,
  getPublicCardSelectionConfirmationConfig,
  PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
  resolvePublicCardSelectionConfirmationStep,
} from './public-card-selection-confirmation.js';
import type {
  DelegatePendingAbility,
  PendingAbilityStarterOptions,
} from './starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export interface ActiveEffectStepHandlerInput {
  readonly selectedCardId?: string | null;
  readonly selectedSlot?: SlotPosition | null;
  readonly resolveInOrder?: boolean;
  readonly selectedOptionId?: string | null;
  readonly selectedCardIds?: readonly string[];
  readonly selectedNumber?: number | null;
  readonly stageFormationMoveHistory?: readonly {
    readonly cardId: string;
    readonly toSlot: SlotPosition;
  }[];
  readonly stageFormationPlacements?: readonly {
    readonly cardId: string;
    readonly toSlot: SlotPosition;
  }[];
}

export interface ActiveEffectStepHandlerContext {
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
  readonly delegatePendingAbility: DelegatePendingAbility;
  readonly resolveActivatedAbility: (
    game: GameState,
    playerId: string,
    cardId: string,
    abilityId: string
  ) => GameState | null;
  readonly resolvePendingAbilityStarter: (
    game: GameState,
    ability: PendingAbilityState,
    options: PendingAbilityStarterOptions
  ) => GameState | null;
}

export type ActiveEffectStepHandler = (
  game: GameState,
  input: ActiveEffectStepHandlerInput,
  context: ActiveEffectStepHandlerContext
) => GameState;

const activeEffectStepHandlers = new Map<string, ActiveEffectStepHandler>();

export function registerActiveEffectStepHandler(
  abilityId: string,
  stepId: string,
  handler: ActiveEffectStepHandler
): void {
  activeEffectStepHandlers.set(getActiveEffectStepHandlerKey(abilityId, stepId), handler);
}

export function resolveActiveEffectStepWithRegistry(
  game: GameState,
  input: ActiveEffectStepHandlerInput,
  context: ActiveEffectStepHandlerContext
): GameState | null {
  const effect = game.activeEffect;
  if (!effect) return null;
  if (effect.stepId === ENERGY_OPERATION_SELECTION_STEP_ID) {
    return resolveEnergyOperationSelectionStep(
      game,
      input,
      context,
      resolveRestoredActiveEffectStep
    );
  }
  if (effect.stepId === PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID) {
    return resolvePublicCardSelectionConfirmationStep(
      game,
      context,
      (restoredGame, restoredEffect, restoredInput, restoredContext) =>
        resolveRestoredActiveEffectStep(
          restoredGame,
          restoredEffect,
          restoredInput,
          restoredContext,
          []
        )
    );
  }

  const handler = getActiveEffectStepHandler(effect);
  if (!handler) return null;
  const publicConfirmation = getPublicCardSelectionConfirmationConfig(effect);
  if (publicConfirmation) {
    const confirmationWindow = createPublicCardSelectionConfirmationWindow(
      game,
      effect,
      input,
      publicConfirmation
    );
    if (confirmationWindow) return confirmationWindow;
  }
  try {
    return handler(game, input, context);
  } catch (error) {
    if (!(error instanceof EnergySelectionRequiredError)) throw error;
    return createActiveEffectEnergySelectionWindow(game, effect, input, error);
  }
}

function resolveRestoredActiveEffectStep(
  game: GameState,
  effect: ActiveEffectState,
  input: ActiveEffectStepHandlerInput,
  context: ActiveEffectStepHandlerContext,
  resolutions: readonly EnergySelectionResolution[]
): GameState | null {
  const handler = getActiveEffectStepHandler(effect);
  return handler
    ? withEnergySelectionResolutions(resolutions, () => handler(game, input, context))
    : null;
}

function getActiveEffectStepHandler(effect: ActiveEffectState): ActiveEffectStepHandler | undefined {
  return activeEffectStepHandlers.get(
    getActiveEffectStepHandlerKey(effect.abilityId, effect.stepId)
  );
}

function getActiveEffectStepHandlerKey(abilityId: string, stepId: string): string {
  return `${abilityId}::${stepId}`;
}
