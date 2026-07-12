import type { ActiveEffectState, GameState } from '../../../domain/entities/game.js';
import type {
  ActiveEffectStepHandlerContext,
  ActiveEffectStepHandlerInput,
} from './step-registry.js';
import { EnergySelectionRequiredError } from '../../effects/energy-selection.js';
import { createActiveEffectEnergySelectionWindow } from './energy-operation-selection.js';
import { selectRevealedCheerCardIds } from '../../effects/cheer-selection.js';

export const PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID =
  'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION';
const PUBLIC_CARD_SELECTION_BASE_DISPLAY_DURATION_MS = 2_000;
const PUBLIC_CARD_SELECTION_PER_ADDITIONAL_CARD_DURATION_MS = 300;
const PUBLIC_CARD_SELECTION_MAX_DISPLAY_DURATION_MS = 3_500;

export type PublicCardSelectionDestination =
  'HAND' | 'MAIN_DECK_TOP' | 'MAIN_DECK_BOTTOM' | 'MAIN_DECK_POSITION_4' | 'WAITING_ROOM';

export type PublicCardSelectionSource = 'WAITING_ROOM' | 'REVEALED_CHEER';

export interface PublicCardSelectionConfirmationConfig {
  readonly destination: PublicCardSelectionDestination;
  readonly source?: PublicCardSelectionSource;
  readonly ordered?: boolean;
  readonly sourcePlayerId?: string;
  readonly groups?: readonly {
    readonly candidateCardIds: readonly string[];
    readonly minCount: number;
    readonly maxCount: number;
  }[];
}

interface PublicCardSelectionConfirmationContinuation {
  readonly originalEffect: ActiveEffectState;
  readonly originalInput: ActiveEffectStepHandlerInput;
}

export interface PublicCardSelectionAutoAdvanceMetadata {
  readonly autoAdvanceAt: number;
  readonly ordered: boolean;
}

const PUBLIC_CARD_SELECTION_RESOLUTION_MARKER = 'publicCardSelectionResolutionCompleted';

export function wasRestoredAfterPublicCardSelectionConfirmation(
  effect: ActiveEffectState
): boolean {
  return effect.metadata?.[PUBLIC_CARD_SELECTION_RESOLUTION_MARKER] === true;
}

type ResolveRestoredActiveEffectStep = (
  game: GameState,
  effect: ActiveEffectState,
  input: ActiveEffectStepHandlerInput,
  context: ActiveEffectStepHandlerContext
) => GameState | null;

export function getPublicCardSelectionConfirmationConfig(
  effect: ActiveEffectState
): PublicCardSelectionConfirmationConfig | null {
  const value = effect.metadata?.publicCardSelectionConfirmation;
  if (!value || typeof value !== 'object' || !('destination' in value)) return null;
  const candidate = value as Record<string, unknown>;
  const destination = candidate.destination;
  const source = candidate.source;
  if (
    destination !== 'HAND' &&
    destination !== 'MAIN_DECK_TOP' &&
    destination !== 'MAIN_DECK_BOTTOM' &&
    destination !== 'MAIN_DECK_POSITION_4' &&
    destination !== 'WAITING_ROOM'
  ) {
    return null;
  }
  if (source !== undefined && source !== 'WAITING_ROOM' && source !== 'REVEALED_CHEER') {
    return null;
  }
  const groups = Array.isArray(candidate.groups)
    ? candidate.groups.flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const group = value as Record<string, unknown>;
        if (
          !Array.isArray(group.candidateCardIds) ||
          !group.candidateCardIds.every((cardId) => typeof cardId === 'string') ||
          typeof group.minCount !== 'number' ||
          typeof group.maxCount !== 'number'
        ) {
          return [];
        }
        return [
          {
            candidateCardIds: group.candidateCardIds as readonly string[],
            minCount: group.minCount,
            maxCount: group.maxCount,
          },
        ];
      })
    : undefined;
  return {
    destination,
    source: source ?? 'WAITING_ROOM',
    ordered: candidate.ordered === true,
    sourcePlayerId:
      typeof candidate.sourcePlayerId === 'string' ? candidate.sourcePlayerId : undefined,
    groups,
  };
}

export function createPublicCardSelectionConfirmationWindow(
  game: GameState,
  originalEffect: ActiveEffectState,
  originalInput: ActiveEffectStepHandlerInput,
  config: PublicCardSelectionConfirmationConfig
): GameState | null {
  const selectedCardIds = getSelectedCardIds(originalInput);
  if (selectedCardIds.length === 0) return null;
  const candidates = originalEffect.selectableCardIds ?? [];
  const minCount =
    originalEffect.selectableCardMode === 'ORDERED_MULTI'
      ? (originalEffect.minSelectableCards ?? 0)
      : 1;
  const maxCount =
    originalEffect.selectableCardMode === 'ORDERED_MULTI'
      ? (originalEffect.maxSelectableCards ?? candidates.length)
      : 1;
  if (
    selectedCardIds.length < minCount ||
    selectedCardIds.length > maxCount ||
    new Set(selectedCardIds).size !== selectedCardIds.length ||
    selectedCardIds.some((cardId) => !candidates.includes(cardId)) ||
    !selectedCardsRemainInConfiguredSource(game, originalEffect, selectedCardIds, config) ||
    !matchesSelectionGroups(selectedCardIds, config.groups)
  ) {
    return null;
  }

  return createPublicCardSelectionConfirmationWindowForCardIds(
    game,
    originalEffect,
    originalInput,
    config,
    selectedCardIds
  );
}

export function createPublicCardSelectionConfirmationWindowForCardIds(
  game: GameState,
  originalEffect: ActiveEffectState,
  originalInput: ActiveEffectStepHandlerInput,
  config: PublicCardSelectionConfirmationConfig,
  selectedCardIds: readonly string[]
): GameState | null {
  if (
    selectedCardIds.length === 0 ||
    new Set(selectedCardIds).size !== selectedCardIds.length ||
    !selectedCardsRemainInConfiguredSource(game, originalEffect, selectedCardIds, config)
  ) {
    return null;
  }
  const copy = getConfirmationCopy(config);
  const continuation: PublicCardSelectionConfirmationContinuation = {
    originalEffect,
    originalInput,
  };
  return {
    ...game,
    activeEffect: {
      id: originalEffect.id,
      abilityId: originalEffect.abilityId,
      sourceCardId: originalEffect.sourceCardId,
      controllerId: originalEffect.controllerId,
      effectText: originalEffect.effectText,
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      stepText: copy.stepText,
      awaitingPlayerId: originalEffect.awaitingPlayerId,
      revealedCardIds: selectedCardIds,
      publicCardSelectionOrdered: config.ordered === true,
      metadata: {
        publicCardSelectionConfirmationContinuation: continuation,
      },
    },
  };
}

function selectedCardsRemainInConfiguredSource(
  game: GameState,
  originalEffect: ActiveEffectState,
  selectedCardIds: readonly string[],
  config: PublicCardSelectionConfirmationConfig
): boolean {
  const sourcePlayerId = config.sourcePlayerId ?? originalEffect.controllerId;
  if ((config.source ?? 'WAITING_ROOM') === 'REVEALED_CHEER') {
    const movableCardIdSet = new Set(selectRevealedCheerCardIds(game, sourcePlayerId));
    return selectedCardIds.every((cardId) => movableCardIdSet.has(cardId));
  }
  const sourcePlayer = game.players.find((player) => player.id === sourcePlayerId);
  return selectedCardIds.every((cardId) => sourcePlayer?.waitingRoom.cardIds.includes(cardId));
}

export function isPublicCardSelectionAutoAdvanceEffect(
  effect: ActiveEffectState | null | undefined
): effect is ActiveEffectState {
  return (
    effect?.stepId === PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID &&
    effect.metadata?.publicCardSelectionConfirmationContinuation !== undefined
  );
}

export function getPublicCardSelectionAutoAdvanceMetadata(
  effect: ActiveEffectState | null | undefined
): PublicCardSelectionAutoAdvanceMetadata | null {
  if (!isPublicCardSelectionAutoAdvanceEffect(effect)) return null;
  if (
    typeof effect.publicCardSelectionAutoAdvanceAt !== 'number' ||
    !Number.isFinite(effect.publicCardSelectionAutoAdvanceAt)
  ) {
    return null;
  }
  return {
    autoAdvanceAt: effect.publicCardSelectionAutoAdvanceAt,
    ordered: effect.publicCardSelectionOrdered === true,
  };
}

export function attachPublicCardSelectionAutoAdvanceDeadline(
  game: GameState,
  now: number
): GameState {
  const effect = game.activeEffect;
  if (!isPublicCardSelectionAutoAdvanceEffect(effect)) return game;
  if (getPublicCardSelectionAutoAdvanceMetadata(effect)) return game;
  return {
    ...game,
    activeEffect: {
      ...effect,
      publicCardSelectionAutoAdvanceAt:
        now + getPublicCardSelectionDisplayDurationMs(effect.revealedCardIds?.length ?? 1),
    },
  };
}

export function getPublicCardSelectionDisplayDurationMs(selectedCardCount: number): number {
  const additionalCardCount = Math.max(0, selectedCardCount - 1);
  return Math.min(
    PUBLIC_CARD_SELECTION_MAX_DISPLAY_DURATION_MS,
    PUBLIC_CARD_SELECTION_BASE_DISPLAY_DURATION_MS +
      additionalCardCount * PUBLIC_CARD_SELECTION_PER_ADDITIONAL_CARD_DURATION_MS
  );
}

function matchesSelectionGroups(
  selectedCardIds: readonly string[],
  groups: PublicCardSelectionConfirmationConfig['groups']
): boolean {
  if (!groups) return true;
  if (
    selectedCardIds.some(
      (cardId) => !groups.some((group) => group.candidateCardIds.includes(cardId))
    )
  ) {
    return false;
  }
  return groups.every((group) => {
    const count = selectedCardIds.filter((cardId) =>
      group.candidateCardIds.includes(cardId)
    ).length;
    return count >= group.minCount && count <= group.maxCount;
  });
}

export function resolvePublicCardSelectionConfirmationStep(
  game: GameState,
  context: ActiveEffectStepHandlerContext,
  resolveRestoredActiveEffectStep: ResolveRestoredActiveEffectStep
): GameState {
  const continuation = game.activeEffect?.metadata?.publicCardSelectionConfirmationContinuation as
    PublicCardSelectionConfirmationContinuation | undefined;
  if (!continuation) return game;
  const restoredEffect: ActiveEffectState = {
    ...continuation.originalEffect,
    metadata: {
      ...continuation.originalEffect.metadata,
      [PUBLIC_CARD_SELECTION_RESOLUTION_MARKER]: true,
    },
  };
  const restoredGame = { ...game, activeEffect: restoredEffect };
  try {
    return (
      resolveRestoredActiveEffectStep(
        restoredGame,
        restoredEffect,
        continuation.originalInput,
        context
      ) ?? game
    );
  } catch (error) {
    if (!(error instanceof EnergySelectionRequiredError)) throw error;
    return createActiveEffectEnergySelectionWindow(
      restoredGame,
      continuation.originalEffect,
      continuation.originalInput,
      error
    );
  }
}

function getSelectedCardIds(input: ActiveEffectStepHandlerInput): readonly string[] {
  if (input.selectedCardIds) return input.selectedCardIds;
  return input.selectedCardId ? [input.selectedCardId] : [];
}

function getConfirmationCopy(config: PublicCardSelectionConfirmationConfig): {
  readonly stepText: string;
} {
  switch (config.destination) {
    case 'HAND':
      return {
        stepText: '已选择的卡牌已向双方公开，即将自动加入手牌。',
      };
    case 'MAIN_DECK_BOTTOM':
      return {
        stepText: config.ordered
          ? '已选择的卡牌及放置顺序已向双方公开。'
          : '已选择的卡牌已向双方公开。',
      };
    case 'MAIN_DECK_POSITION_4':
      return {
        stepText: '已选择的卡牌已向双方公开。',
      };
    case 'MAIN_DECK_TOP':
      return {
        stepText: config.ordered
          ? '已选择的卡牌及放置顺序已向双方公开。'
          : '已选择的卡牌已向双方公开。',
      };
    case 'WAITING_ROOM':
      return {
        stepText: '已选择的卡牌已向双方公开，即将自动放置入休息室。',
      };
  }
}
