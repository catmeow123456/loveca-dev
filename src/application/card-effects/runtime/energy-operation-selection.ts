import type {
  ActiveEffectState,
  GameState,
  PendingAbilityState,
} from '../../../domain/entities/game.js';
import {
  EnergySelectionRequiredError,
  withEnergySelectionResolutions,
  type EnergySelectionOperation,
  type EnergySelectionResolution,
} from '../../effects/energy-selection.js';
import type {
  ActiveEffectStepHandlerContext,
  ActiveEffectStepHandlerInput,
} from './step-registry.js';
import type { PendingAbilityStarterOptions } from './starter-registry.js';

export const ENERGY_OPERATION_SELECTION_STEP_ID = 'COMMON_ENERGY_OPERATION_SELECTION';

interface ActiveStepEnergySelectionContinuation {
  readonly kind: 'ACTIVE_EFFECT_STEP';
  readonly originalEffect: ActiveEffectState;
  readonly originalInput: ActiveEffectStepHandlerInput;
  readonly playerId: string;
  readonly operation: EnergySelectionOperation;
  readonly requiredCount: number;
  readonly priorResolutions: readonly EnergySelectionResolution[];
}

interface ActivatedAbilityEnergySelectionContinuation {
  readonly kind: 'ACTIVATED_ABILITY';
  readonly playerId: string;
  readonly cardId: string;
  readonly abilityId: string;
  readonly operation: EnergySelectionOperation;
  readonly requiredCount: number;
  readonly priorResolutions: readonly EnergySelectionResolution[];
}

interface PendingAbilityEnergySelectionContinuation {
  readonly kind: 'PENDING_ABILITY';
  readonly ability: PendingAbilityState;
  readonly options: PendingAbilityStarterOptions;
  readonly playerId: string;
  readonly operation: EnergySelectionOperation;
  readonly requiredCount: number;
  readonly priorResolutions: readonly EnergySelectionResolution[];
}

type EnergySelectionContinuation =
  | ActiveStepEnergySelectionContinuation
  | ActivatedAbilityEnergySelectionContinuation
  | PendingAbilityEnergySelectionContinuation;

type ResolveRestoredActiveEffectStep = (
  game: GameState,
  effect: ActiveEffectState,
  input: ActiveEffectStepHandlerInput,
  context: ActiveEffectStepHandlerContext,
  resolutions: readonly EnergySelectionResolution[]
) => GameState | null;

export function createActiveEffectEnergySelectionWindow(
  game: GameState,
  originalEffect: ActiveEffectState,
  originalInput: ActiveEffectStepHandlerInput,
  request: EnergySelectionRequiredError
): GameState {
  return createWindow(game, originalEffect, request, {
    kind: 'ACTIVE_EFFECT_STEP',
    originalEffect,
    originalInput,
    playerId: request.playerId,
    operation: request.operation,
    requiredCount: request.requiredCount,
    priorResolutions: request.priorResolutions,
  });
}

export function createActivatedAbilityEnergySelectionWindow(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string,
  effectText: string,
  request: EnergySelectionRequiredError
): GameState {
  return createWindow(
    game,
    {
      id: `${abilityId}:${cardId}:turn-${game.turnCount}:energy-selection`,
      abilityId,
      sourceCardId: cardId,
      controllerId: playerId,
      effectText,
      stepId: ENERGY_OPERATION_SELECTION_STEP_ID,
      stepText: '',
      awaitingPlayerId: playerId,
    },
    request,
    {
      kind: 'ACTIVATED_ABILITY',
      playerId,
      cardId,
      abilityId,
      operation: request.operation,
      requiredCount: request.requiredCount,
      priorResolutions: request.priorResolutions,
    }
  );
}

export function createPendingAbilityEnergySelectionWindow(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  effectText: string,
  request: EnergySelectionRequiredError
): GameState {
  return createWindow(
    game,
    {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText,
      stepId: ENERGY_OPERATION_SELECTION_STEP_ID,
      stepText: '',
      awaitingPlayerId: ability.controllerId,
    },
    request,
    {
      kind: 'PENDING_ABILITY',
      ability,
      options,
      playerId: request.playerId,
      operation: request.operation,
      requiredCount: request.requiredCount,
      priorResolutions: request.priorResolutions,
    }
  );
}

export function resolveEnergyOperationSelectionStep(
  game: GameState,
  input: ActiveEffectStepHandlerInput,
  context: ActiveEffectStepHandlerContext,
  resolveRestoredActiveEffectStep: ResolveRestoredActiveEffectStep
): GameState {
  const continuation = game.activeEffect?.metadata?.energySelectionContinuation as
    EnergySelectionContinuation | undefined;
  if (!continuation) return game;
  const selectedEnergyCardIds =
    input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []);
  if (
    selectedEnergyCardIds.length !== continuation.requiredCount ||
    new Set(selectedEnergyCardIds).size !== selectedEnergyCardIds.length ||
    selectedEnergyCardIds.some(
      (cardId) => game.activeEffect?.selectableCardIds?.includes(cardId) !== true
    )
  ) {
    return game;
  }

  const resolutions = [
    ...continuation.priorResolutions,
    {
      playerId: continuation.playerId,
      operation: continuation.operation,
      requiredCount: continuation.requiredCount,
      selectedEnergyCardIds,
    },
  ];
  const gameWithoutWindow = { ...game, activeEffect: null };
  if (continuation.kind === 'ACTIVATED_ABILITY') {
    return (
      withEnergySelectionResolutions(resolutions, () =>
        context.resolveActivatedAbility(
          gameWithoutWindow,
          continuation.playerId,
          continuation.cardId,
          continuation.abilityId
        )
      ) ?? game
    );
  }
  if (continuation.kind === 'PENDING_ABILITY') {
    return (
      withEnergySelectionResolutions(resolutions, () =>
        context.resolvePendingAbilityStarter(
          gameWithoutWindow,
          continuation.ability,
          continuation.options
        )
      ) ?? game
    );
  }

  const restoredGame = { ...game, activeEffect: continuation.originalEffect };
  try {
    return (
      resolveRestoredActiveEffectStep(
        restoredGame,
        continuation.originalEffect,
        continuation.originalInput,
        context,
        resolutions
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

function createWindow(
  game: GameState,
  effect: ActiveEffectState,
  request: EnergySelectionRequiredError,
  continuation: EnergySelectionContinuation
): GameState {
  const labels = getEnergySelectionLabels(request.operation, request.requiredCount);
  return {
    ...game,
    activeEffect: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      effectText: effect.effectText,
      stepId: ENERGY_OPERATION_SELECTION_STEP_ID,
      stepText: labels.stepText,
      awaitingPlayerId: request.playerId,
      selectableCardIds: request.candidateEnergyCardIds,
      selectableCardMode: request.requiredCount > 1 ? 'ORDERED_MULTI' : 'SINGLE',
      selectionLabel: labels.selectionLabel,
      minSelectableCards: request.requiredCount,
      maxSelectableCards: request.requiredCount,
      confirmSelectionLabel: labels.confirmLabel,
      canSkipSelection: false,
      metadata: { energySelectionContinuation: continuation },
    },
  };
}

function getEnergySelectionLabels(
  operation: EnergySelectionOperation,
  requiredCount: number
): {
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly confirmLabel: string;
} {
  switch (operation) {
    case 'TAP_ACTIVE_ENERGY':
      const paymentTokens = '[E]'.repeat(requiredCount);
      return {
        stepText: `请选择用于支付${paymentTokens}的活跃能量卡。`,
        selectionLabel: '选择用于支付费用的能量卡',
        confirmLabel: '支付费用',
      };
    case 'ACTIVATE_WAITING_ENERGY':
      return {
        stepText: '请选择要变为活跃状态的待机能量。',
        selectionLabel: '选择要变为活跃的能量',
        confirmLabel: '变为活跃',
      };
    case 'STACK_BELOW_MEMBER':
      return {
        stepText: '请选择要放到成员下方的能量。',
        selectionLabel: '选择要放到成员下方的能量',
        confirmLabel: '放到成员下方',
      };
    case 'RETURN_TO_ENERGY_DECK':
      return {
        stepText: '请选择要放回能量卡组的能量。',
        selectionLabel: '选择要放回能量卡组的能量',
        confirmLabel: '放回能量卡组',
      };
  }
}
