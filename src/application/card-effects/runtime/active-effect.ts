import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import type { EffectCostDefinition } from '../../effects/effect-costs.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL = '请选择要放置入休息室的卡牌';
const DISCARD_HAND_TO_ACTIVATE_STEP_TEXT = '请选择要放置入休息室的手牌。也可以选择不发动此效果。';
const DECLINE_OPTION_LABEL = '不发动';

export const CONFIRM_ONLY_PENDING_ABILITY_STEP_ID = 'CONFIRM_ONLY_EFFECT';

export interface StartConfirmOnlyPendingAbilityEffectConfig {
  readonly ability: Pick<
    PendingAbilityState,
    'id' | 'abilityId' | 'sourceCardId' | 'controllerId'
  >;
  readonly effectText: string;
  readonly orderedResolution: boolean;
}

export interface ContinueConfirmOnlyPendingAbilityOptions {
  readonly orderedResolution: boolean;
  readonly skipManualConfirmation: true;
}

export type ContinueConfirmOnlyPendingAbility = (
  game: GameState,
  ability: PendingAbilityState,
  options: ContinueConfirmOnlyPendingAbilityOptions
) => GameState;

export interface FinishSkippedActiveEffectOptions {
  readonly step?: string;
}

export interface StartPendingActiveEffectConfig {
  readonly ability: Pick<PendingAbilityState, 'id' | 'abilityId'>;
  readonly activeEffect: ActiveEffectState;
  readonly playerId: string;
  readonly actionPayload: Readonly<Record<string, unknown>>;
}

export interface StartConfirmOnlyActiveEffectConfig {
  readonly ability: Pick<
    PendingAbilityState,
    'id' | 'abilityId' | 'sourceCardId' | 'controllerId'
  >;
  readonly playerId: string;
  readonly effectText: string;
  readonly stepId: string;
  readonly stepText: string;
  readonly orderedResolution: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly actionPayload?: Readonly<Record<string, unknown>>;
}

export interface CreateOptionalDiscardHandToWaitingRoomActiveEffectConfig {
  readonly ability: Pick<
    PendingAbilityState,
    'id' | 'abilityId' | 'sourceCardId' | 'controllerId'
  >;
  readonly playerId: string;
  readonly effectText: string;
  readonly stepId: string;
  readonly selectableCardIds: readonly string[];
  readonly orderedResolution: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly stepText?: string;
  readonly selectionLabel?: string;
  readonly skipSelectionLabel?: string;
}

export interface RevealHandCardForActiveEffectOptions {
  readonly effect: ActiveEffectState;
  readonly playerId: string;
  readonly selectedCardId: string | null | undefined;
  readonly nextStepId: string;
  readonly nextStepText: string;
  readonly actionStep: string;
  readonly actionPayload?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly selectableCardIds?: readonly string[];
  readonly selectableCardVisibility?: ActiveEffectState['selectableCardVisibility'];
  readonly selectionLabel?: string;
  readonly confirmSelectionLabel?: string;
  readonly canSkipSelection?: boolean;
  readonly skipSelectionLabel?: string;
}

export function startPendingActiveEffect(
  game: GameState,
  config: StartPendingActiveEffectConfig
): GameState {
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
      activeEffect: config.activeEffect,
    },
    'RESOLVE_ABILITY',
    config.playerId,
    {
      pendingAbilityId: config.ability.id,
      abilityId: config.ability.abilityId,
      ...config.actionPayload,
    }
  );
}

export function startConfirmOnlyActiveEffect(
  game: GameState,
  config: StartConfirmOnlyActiveEffectConfig
): GameState {
  return startPendingActiveEffect(game, {
    ability: config.ability,
    playerId: config.playerId,
    activeEffect: {
      id: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      controllerId: config.ability.controllerId,
      effectText: config.effectText,
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: config.playerId,
      metadata: {
        ...config.metadata,
        orderedResolution: config.orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: config.ability.sourceCardId,
      step: 'START_CONFIRM',
      ...config.actionPayload,
    },
  });
}

export function createOptionalDiscardHandToWaitingRoomActiveEffect(
  config: CreateOptionalDiscardHandToWaitingRoomActiveEffectConfig
): ActiveEffectState {
  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 1,
    maxCount: 1,
    optional: true,
  };

  return {
    id: config.ability.id,
    abilityId: config.ability.abilityId,
    sourceCardId: config.ability.sourceCardId,
    controllerId: config.ability.controllerId,
    effectText: config.effectText,
    stepId: config.stepId,
    stepText: config.stepText ?? DISCARD_HAND_TO_ACTIVATE_STEP_TEXT,
    awaitingPlayerId: config.playerId,
    selectableCardIds: config.selectableCardIds,
    selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    selectionLabel: config.selectionLabel ?? DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL,
    canSkipSelection: true,
    skipSelectionLabel: config.skipSelectionLabel ?? DECLINE_OPTION_LABEL,
    metadata: {
      ...config.metadata,
      orderedResolution: config.orderedResolution,
      effectCosts: [discardCost],
      handToWaitingRoomCost: {
        minCount: discardCost.minCount,
        maxCount: discardCost.maxCount,
        optional: discardCost.optional,
      },
    },
  };
}

export function revealHandCardForActiveEffect(
  game: GameState,
  options: RevealHandCardForActiveEffectOptions
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.id !== options.effect.id ||
    effect.abilityId !== options.effect.abilityId ||
    options.selectedCardId === null ||
    options.selectedCardId === undefined ||
    effect.selectableCardIds?.includes(options.selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, options.playerId);
  if (!player || !player.hand.cardIds.includes(options.selectedCardId)) {
    return game;
  }

  const revealedCardIds = Array.from(
    new Set([...(effect.revealedCardIds ?? []), options.selectedCardId])
  );

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: options.nextStepId,
        stepText: options.nextStepText,
        revealedCardIds,
        selectableCardIds: options.selectableCardIds,
        selectableCardVisibility: options.selectableCardVisibility ?? 'PUBLIC',
        selectionLabel: options.selectionLabel,
        confirmSelectionLabel: options.confirmSelectionLabel,
        canSkipSelection: options.canSkipSelection,
        skipSelectionLabel: options.skipSelectionLabel,
        metadata: {
          ...effect.metadata,
          ...options.metadata,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: options.actionStep,
      ...options.actionPayload,
    }
  );
}

export function startConfirmOnlyPendingAbilityEffect(
  game: GameState,
  config: StartConfirmOnlyPendingAbilityEffectConfig
): GameState {
  return {
    ...game,
    activeEffect: {
      id: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      controllerId: config.ability.controllerId,
      effectText: config.effectText,
      stepId: CONFIRM_ONLY_PENDING_ABILITY_STEP_ID,
      stepText: '确认后继续处理此效果。',
      awaitingPlayerId: config.ability.controllerId,
      metadata: {
        confirmOnlyPendingAbility: true,
        orderedResolution: config.orderedResolution,
      },
    },
  };
}

export function finishConfirmOnlyPendingAbilityEffect(
  game: GameState,
  continuePendingAbility: ContinueConfirmOnlyPendingAbility
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.metadata?.confirmOnlyPendingAbility !== true) {
    return game;
  }
  const pendingAbility = game.pendingAbilities.find(
    (ability) =>
      ability.id === effect.id &&
      ability.abilityId === effect.abilityId &&
      ability.sourceCardId === effect.sourceCardId
  );
  if (!pendingAbility) {
    return game;
  }
  return continuePendingAbility({ ...game, activeEffect: null }, pendingAbility, {
    orderedResolution: effect.metadata.orderedResolution === true,
    skipManualConfirmation: true,
  });
}

export function finishSkippedActiveEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  options: FinishSkippedActiveEffectOptions = {}
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const state = { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: options.step ?? 'SKIP',
    }),
    effect.metadata?.orderedResolution === true
  );
}
