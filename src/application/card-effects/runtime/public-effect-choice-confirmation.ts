import type { ActiveEffectState, GameState } from '../../../domain/entities/game.js';
import { EnergySelectionRequiredError } from '../../effects/energy-selection.js';
import { createActiveEffectEnergySelectionWindow } from './energy-operation-selection.js';
import type {
  ActiveEffectStepHandlerContext,
  ActiveEffectStepHandlerInput,
} from './step-registry.js';

export const PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID = 'COMMON_PUBLIC_EFFECT_CHOICE_CONFIRMATION';
export const PUBLIC_EFFECT_CHOICE_DISPLAY_DURATION_MS = 1_500;
export const PUBLIC_EFFECT_CHOICE_RETRY_EFFECT_METADATA_KEY = 'publicEffectChoiceRetryEffect';

interface PublicEffectChoiceConfirmationContinuation {
  readonly originalEffect: ActiveEffectState;
  readonly originalInput: ActiveEffectStepHandlerInput;
  readonly selectedOptionIds: readonly string[];
}

export interface PublicEffectChoiceAutoAdvanceMetadata {
  readonly autoAdvanceAt: number;
}

type ResolveRestoredActiveEffectStep = (
  game: GameState,
  effect: ActiveEffectState,
  input: ActiveEffectStepHandlerInput,
  context: ActiveEffectStepHandlerContext
) => GameState | null;

/**
 * 校验结构化效果选项，并按服务端选项（卡文）顺序归一化。
 * 客户端只提交 ID，不提交或覆盖玩家可见文本。
 */
export function getStructuredEffectChoiceSelection(
  effect: ActiveEffectState,
  input: ActiveEffectStepHandlerInput
): readonly string[] | null {
  const choice = effect.effectChoice;
  const selectedOptionIds =
    input.selectedEffectOptionIds ??
    (choice?.mode === 'SINGLE' && input.selectedOptionId ? [input.selectedOptionId] : undefined);
  if (!choice || !selectedOptionIds) return null;
  if (
    !Number.isInteger(choice.minSelections) ||
    !Number.isInteger(choice.maxSelections) ||
    choice.minSelections < 0 ||
    choice.maxSelections < choice.minSelections ||
    choice.maxSelections > choice.options.length ||
    (choice.mode === 'SINGLE' && (choice.minSelections !== 1 || choice.maxSelections !== 1))
  ) {
    return null;
  }
  const optionIds = choice.options.map((option) => option.id);
  if (new Set(optionIds).size !== optionIds.length) return null;
  if (
    selectedOptionIds.length < choice.minSelections ||
    selectedOptionIds.length > choice.maxSelections ||
    new Set(selectedOptionIds).size !== selectedOptionIds.length
  ) {
    return null;
  }
  const selectedIdSet = new Set(selectedOptionIds);
  if (
    choice.options.some((option) => selectedIdSet.has(option.id) && option.selectable === false) ||
    selectedOptionIds.some((optionId) => !optionIds.includes(optionId))
  ) {
    return null;
  }
  return choice.options.filter((option) => selectedIdSet.has(option.id)).map((option) => option.id);
}

export function createPublicEffectChoiceConfirmationWindow(
  game: GameState,
  originalEffect: ActiveEffectState,
  originalInput: ActiveEffectStepHandlerInput,
  selectedOptionIds: readonly string[]
): GameState {
  const continuation: PublicEffectChoiceConfirmationContinuation = {
    originalEffect,
    originalInput: {
      ...originalInput,
      selectedEffectOptionIds: selectedOptionIds,
    },
    selectedOptionIds,
  };
  return {
    ...game,
    activeEffect: {
      id: originalEffect.id,
      abilityId: originalEffect.abilityId,
      sourceCardId: originalEffect.sourceCardId,
      controllerId: originalEffect.controllerId,
      effectText: originalEffect.effectText,
      stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
      stepText: '已选择的效果已向双方公开，即将继续结算。',
      awaitingPlayerId: originalEffect.awaitingPlayerId,
      effectChoice: {
        ...originalEffect.effectChoice!,
        selectedOptionIds,
      },
      metadata: {
        publicEffectChoiceConfirmationContinuation: continuation,
      },
    },
  };
}

export function isPublicEffectChoiceAutoAdvanceEffect(
  effect: ActiveEffectState | null | undefined
): effect is ActiveEffectState {
  return (
    effect?.stepId === PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID &&
    effect.metadata?.publicEffectChoiceConfirmationContinuation !== undefined
  );
}

export function getPublicEffectChoiceAutoAdvanceMetadata(
  effect: ActiveEffectState | null | undefined
): PublicEffectChoiceAutoAdvanceMetadata | null {
  if (!isPublicEffectChoiceAutoAdvanceEffect(effect)) return null;
  if (
    typeof effect.publicEffectChoiceAutoAdvanceAt !== 'number' ||
    !Number.isFinite(effect.publicEffectChoiceAutoAdvanceAt)
  ) {
    return null;
  }
  return { autoAdvanceAt: effect.publicEffectChoiceAutoAdvanceAt };
}

export function attachPublicEffectChoiceAutoAdvanceDeadline(
  game: GameState,
  now: number
): GameState {
  const effect = game.activeEffect;
  if (!isPublicEffectChoiceAutoAdvanceEffect(effect)) return game;
  if (getPublicEffectChoiceAutoAdvanceMetadata(effect)) return game;
  return {
    ...game,
    activeEffect: {
      ...effect,
      publicEffectChoiceAutoAdvanceAt: now + PUBLIC_EFFECT_CHOICE_DISPLAY_DURATION_MS,
    },
  };
}

export function resolvePublicEffectChoiceConfirmationStep(
  game: GameState,
  context: ActiveEffectStepHandlerContext,
  resolveRestoredActiveEffectStep: ResolveRestoredActiveEffectStep
): GameState {
  const continuation = game.activeEffect?.metadata?.publicEffectChoiceConfirmationContinuation as
    PublicEffectChoiceConfirmationContinuation | undefined;
  if (!continuation) return game;
  const selectedOptionId =
    continuation.originalEffect.effectChoice?.mode === 'SINGLE'
      ? (continuation.selectedOptionIds[0] ?? null)
      : continuation.originalInput.selectedOptionId;
  const restoredEffect: ActiveEffectState = {
    ...continuation.originalEffect,
    effectChoice: undefined,
    metadata: {
      ...continuation.originalEffect.metadata,
      [PUBLIC_EFFECT_CHOICE_RETRY_EFFECT_METADATA_KEY]: continuation.originalEffect,
    },
  };
  const restoredInput: ActiveEffectStepHandlerInput = {
    ...continuation.originalInput,
    selectedOptionId,
    selectedEffectOptionIds: continuation.selectedOptionIds,
  };
  const restoredGame = { ...game, activeEffect: restoredEffect };
  try {
    return (
      resolveRestoredActiveEffectStep(restoredGame, restoredEffect, restoredInput, context) ?? game
    );
  } catch (error) {
    if (!(error instanceof EnergySelectionRequiredError)) throw error;
    return createActiveEffectEnergySelectionWindow(
      restoredGame,
      restoredEffect,
      restoredInput,
      error
    );
  }
}
