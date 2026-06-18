import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

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
