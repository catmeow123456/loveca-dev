import type { GameState } from '../../../domain/entities/game.js';
import type { SlotPosition } from '../../../shared/types/enums.js';
import type { DelegatePendingAbility } from './starter-registry.js';

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
  if (!effect) {
    return null;
  }

  const handler = activeEffectStepHandlers.get(
    getActiveEffectStepHandlerKey(effect.abilityId, effect.stepId)
  );
  return handler ? handler(game, input, context) : null;
}

function getActiveEffectStepHandlerKey(abilityId: string, stepId: string): string {
  return `${abilityId}::${stepId}`;
}
