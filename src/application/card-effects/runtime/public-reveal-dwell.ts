import type { ActiveEffectState, GameState } from '../../../domain/entities/game.js';
import { EnergySelectionRequiredError } from '../../effects/energy-selection.js';
import { createActiveEffectEnergySelectionWindow } from './energy-operation-selection.js';
import type {
  ActiveEffectStepHandlerContext,
  ActiveEffectStepHandlerInput,
} from './step-registry.js';

export const PUBLIC_REVEAL_DWELL_STEP_ID = 'COMMON_PUBLIC_REVEAL_DWELL';
export const PUBLIC_REVEAL_BASE_DISPLAY_DURATION_MS = 2_000;
export const PUBLIC_REVEAL_PER_ADDITIONAL_CARD_DURATION_MS = 300;
export const PUBLIC_REVEAL_MAX_DISPLAY_DURATION_MS = 3_500;

const PUBLIC_REVEAL_DWELL_CONTINUATION_METADATA_KEY = 'publicRevealDwellContinuation';

type PublicRevealDwellContinuation =
  | {
      readonly mode: 'RESOLVE_CURRENT_STEP';
      readonly effect: ActiveEffectState;
    }
  | {
      readonly mode: 'RESTORE_NEXT_EFFECT';
      readonly effect: ActiveEffectState;
    };

export interface PublicRevealDwellBeforeNextEffectOptions {
  /** 本次确实向双方公开的卡牌；不得传入完整 inspectionCardIds。 */
  readonly revealedCardIds: readonly string[];
  /** 公共展示阶段的说明；默认使用稳定通用文案。 */
  readonly stepText?: string;
  /** 需要覆盖下一交互卡文时显式传入；默认沿用 nextEffect。 */
  readonly effectText?: string;
}

export interface PublicRevealAutoAdvanceMetadata {
  readonly autoAdvanceAt: number;
  readonly generation: string;
}

export type PublicRevealDwellActiveEffect = ActiveEffectState & {
  readonly stepId: typeof PUBLIC_REVEAL_DWELL_STEP_ID;
};

type ResolveRestoredActiveEffectStep = (
  game: GameState,
  effect: ActiveEffectState,
  input: ActiveEffectStepHandlerInput,
  context: ActiveEffectStepHandlerContext
) => GameState | null;

/**
 * 将一个“当前步骤仅需无输入确认”的公开结果包装成双方公共展示。
 *
 * deadline 到期后会恢复原步骤，并以空输入调用原 handler。这个 helper
 * 不适用于仍需玩家选择的步骤；此类流程应使用
 * createPublicRevealDwellBeforeNextEffect。
 */
export function withPublicRevealDwell(
  effect: ActiveEffectState,
  revealedCardIdsForThisDwell: readonly string[] = effect.revealedCardIds ?? []
): ActiveEffectState {
  if (isAnyTimedPublicConfirmationEffect(effect)) return effect;
  const revealedCardIds = uniqueCardIds(revealedCardIdsForThisDwell);
  if (revealedCardIds.length === 0) return effect;
  return createPublicRevealDwellEffect(
    effect,
    revealedCardIds,
    normalizePublicRevealDwellStepText(effect.stepText),
    {
      mode: 'RESOLVE_CURRENT_STEP',
      effect: withoutPublicRevealAuthorityFields(effect),
    }
  );
}

/**
 * 在已经公开结果与真实下一交互之间插入公共展示。
 *
 * deadline 到期后只恢复 nextEffect，不会替等待玩家提交任何选择。
 */
export function createPublicRevealDwellBeforeNextEffect(
  game: GameState,
  nextEffect: ActiveEffectState,
  options: PublicRevealDwellBeforeNextEffectOptions
): GameState {
  if (isPublicRevealDwellEffect(nextEffect)) {
    return {
      ...game,
      activeEffect: withPublicRevealEffectText(
        nextEffect,
        options.effectText ?? nextEffect.effectText
      ),
    };
  }
  const overriddenNextEffect: ActiveEffectState = {
    ...nextEffect,
    effectText: options.effectText ?? nextEffect.effectText,
  };
  if (isSpecializedTimedPublicConfirmationEffect(overriddenNextEffect)) {
    return {
      ...game,
      activeEffect: withoutPublicRevealAuthorityFields(overriddenNextEffect),
    };
  }
  const restoredNextEffect = withoutPublicRevealAuthorityFields(overriddenNextEffect);
  const revealedCardIds = uniqueCardIds(options.revealedCardIds);
  if (revealedCardIds.length === 0) {
    return {
      ...game,
      activeEffect: restoredNextEffect,
    };
  }
  return {
    ...game,
    activeEffect: createPublicRevealDwellEffect(
      restoredNextEffect,
      revealedCardIds,
      normalizePublicRevealDwellStepText(
        options.stepText ??
          `已公开${revealedCardIds.length}张卡牌，正在向双方展示。展示结束后继续处理。`
      ),
      {
        mode: 'RESTORE_NEXT_EFFECT',
        effect: restoredNextEffect,
      }
    ),
  };
}

export function isPublicRevealDwellEffect(
  effect: ActiveEffectState | null | undefined
): effect is PublicRevealDwellActiveEffect {
  return (
    effect?.stepId === PUBLIC_REVEAL_DWELL_STEP_ID &&
    readPublicRevealDwellContinuation(effect) !== null
  );
}

export function getPublicRevealAutoAdvanceMetadata(
  effect: ActiveEffectState | null | undefined
): PublicRevealAutoAdvanceMetadata | null {
  if (!isPublicRevealDwellEffect(effect)) return null;
  if (
    typeof effect.publicRevealAutoAdvanceAt !== 'number' ||
    !Number.isFinite(effect.publicRevealAutoAdvanceAt) ||
    typeof effect.publicRevealGeneration !== 'string' ||
    effect.publicRevealGeneration.length === 0
  ) {
    return null;
  }
  return {
    autoAdvanceAt: effect.publicRevealAutoAdvanceAt,
    generation: effect.publicRevealGeneration,
  };
}

/**
 * 只允许 GameSession 的权威状态提交边界调用。既有完整 deadline/generation
 * 会原样保留，因此快照投影、重连及恢复不会重新开始展示。
 */
export function attachPublicRevealAutoAdvanceAuthority(
  game: GameState,
  now: number,
  createGeneration: () => string
): GameState {
  const effect = game.activeEffect;
  if (!isPublicRevealDwellEffect(effect)) return game;
  if (getPublicRevealAutoAdvanceMetadata(effect)) return game;

  const generation = createGeneration();
  if (generation.length === 0) {
    throw new Error('公开卡牌展示 generation 不能为空');
  }
  return {
    ...game,
    activeEffect: {
      ...effect,
      publicRevealAutoAdvanceAt:
        now + getPublicRevealDisplayDurationMs(effect.revealedCardIds?.length ?? 1),
      publicRevealGeneration: generation,
    },
  };
}

export function getPublicRevealDisplayDurationMs(revealedCardCount: number): number {
  const additionalCardCount = Math.max(0, revealedCardCount - 1);
  return Math.min(
    PUBLIC_REVEAL_MAX_DISPLAY_DURATION_MS,
    PUBLIC_REVEAL_BASE_DISPLAY_DURATION_MS +
      additionalCardCount * PUBLIC_REVEAL_PER_ADDITIONAL_CARD_DURATION_MS
  );
}

export function normalizePublicRevealDwellStepText(stepText: string): string {
  return stepText
    .replaceAll('确认公开结果后', '展示结束后')
    .replaceAll('确认后', '展示结束后')
    .replaceAll('继续处理后', '展示结束后');
}

export function resolvePublicRevealDwellStep(
  game: GameState,
  context: ActiveEffectStepHandlerContext,
  resolveRestoredActiveEffectStep: ResolveRestoredActiveEffectStep
): GameState {
  const continuation = readPublicRevealDwellContinuation(game.activeEffect);
  if (!continuation) return game;

  const restoredEffect = continuation.effect;
  const restoredGame = {
    ...game,
    activeEffect: restoredEffect,
  };
  if (continuation.mode === 'RESTORE_NEXT_EFFECT') {
    return restoredGame;
  }

  const emptyInput: ActiveEffectStepHandlerInput = {};
  try {
    return (
      resolveRestoredActiveEffectStep(restoredGame, restoredEffect, emptyInput, context) ?? game
    );
  } catch (error) {
    if (!(error instanceof EnergySelectionRequiredError)) throw error;
    return createActiveEffectEnergySelectionWindow(restoredGame, restoredEffect, emptyInput, error);
  }
}

function createPublicRevealDwellEffect(
  displayEffect: ActiveEffectState,
  revealedCardIds: readonly string[],
  stepText: string,
  continuation: PublicRevealDwellContinuation
): ActiveEffectState {
  return {
    id: displayEffect.id,
    abilityId: displayEffect.abilityId,
    sourceCardId: displayEffect.sourceCardId,
    sourceCardDisplayCode: displayEffect.sourceCardDisplayCode,
    sourceLifecycleId: displayEffect.sourceLifecycleId,
    controllerId: displayEffect.controllerId,
    effectText: displayEffect.effectText,
    stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
    stepText,
    awaitingPlayerId: displayEffect.awaitingPlayerId,
    revealedCardIds,
    metadata: {
      [PUBLIC_REVEAL_DWELL_CONTINUATION_METADATA_KEY]: continuation,
    },
  };
}

function readPublicRevealDwellContinuation(
  effect: ActiveEffectState | null | undefined
): PublicRevealDwellContinuation | null {
  const value = effect?.metadata?.[PUBLIC_REVEAL_DWELL_CONTINUATION_METADATA_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<PublicRevealDwellContinuation>;
  if (
    (candidate.mode !== 'RESOLVE_CURRENT_STEP' && candidate.mode !== 'RESTORE_NEXT_EFFECT') ||
    !isActiveEffectStateLike(candidate.effect)
  ) {
    return null;
  }
  return candidate as PublicRevealDwellContinuation;
}

function withoutPublicRevealAuthorityFields(effect: ActiveEffectState): ActiveEffectState {
  const { publicRevealAutoAdvanceAt, publicRevealGeneration, ...cleanEffect } = effect;
  void publicRevealAutoAdvanceAt;
  void publicRevealGeneration;
  return cleanEffect;
}

function uniqueCardIds(cardIds: readonly string[]): readonly string[] {
  return [...new Set(cardIds)];
}

function isAnyTimedPublicConfirmationEffect(effect: ActiveEffectState): boolean {
  return isPublicRevealDwellEffect(effect) || isSpecializedTimedPublicConfirmationEffect(effect);
}

function isSpecializedTimedPublicConfirmationEffect(effect: ActiveEffectState): boolean {
  return (
    effect.stepId === 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION' ||
    effect.stepId === 'COMMON_PUBLIC_EFFECT_CHOICE_CONFIRMATION'
  );
}

function withPublicRevealEffectText(
  effect: PublicRevealDwellActiveEffect,
  effectText: string
): ActiveEffectState {
  const continuation = readPublicRevealDwellContinuation(effect);
  if (!continuation || effect.effectText === effectText) return effect;
  return {
    ...effect,
    effectText,
    metadata: {
      ...effect.metadata,
      [PUBLIC_REVEAL_DWELL_CONTINUATION_METADATA_KEY]: {
        ...continuation,
        effect: {
          ...continuation.effect,
          effectText,
        },
      },
    },
  };
}

function isActiveEffectStateLike(value: unknown): value is ActiveEffectState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<ActiveEffectState>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.abilityId === 'string' &&
    typeof candidate.sourceCardId === 'string' &&
    typeof candidate.controllerId === 'string' &&
    typeof candidate.stepId === 'string'
  );
}
