import {
  addAction,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import { findCardAbilityDefinitionById } from '../definitions/lookup.js';
import {
  getAbilitySourceLifecycleId,
  getActiveEffectSourceLifecycleId,
  getPendingAbilitySourceLifecycleId,
} from './ability-source-lifecycle.js';
import { startConfirmOnlyPendingAbilityEffect } from './active-effect.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from './starter-registry.js';

const ABILITY_USE_STEP = 'ABILITY_USE';

export interface AbilityUseContext {
  readonly abilityId: string;
  readonly abilityInstanceId?: string;
  readonly sourceCardId: string;
  readonly sourceLifecycleId?: string;
  readonly pendingAbilityId?: string;
}

export interface PayCostActionPayload {
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly pendingAbilityId?: string;
  readonly energyCardIds?: readonly string[];
  readonly amount?: number;
  readonly [key: string]: unknown;
}

export function getAbilityEffectText(abilityId: string): string {
  const effectText = findCardAbilityDefinitionById(abilityId)?.effectText;
  if (!effectText || effectText.trim().length === 0) {
    throw new Error(`Missing card ability effect text for abilityId: ${abilityId}`);
  }
  return effectText;
}

export function maybeStartManualPendingAbilityConfirmation(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>,
  options: PendingAbilityStarterOptions,
  config: {
    readonly effectText?: string;
    readonly stepText?: string;
  } = {}
): GameState | null {
  if (options.manualConfirmation !== true || options.skipManualConfirmation === true) {
    return null;
  }

  return startConfirmOnlyPendingAbilityEffect(game, {
    ability,
    effectText: config.effectText ?? getAbilityEffectText(ability.abilityId),
    orderedResolution: options.orderedResolution === true,
    stepText: config.stepText,
  });
}

export function maybeStartConfirmablePendingAbilityConfirmation(
  game: GameState,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'>,
  options: PendingAbilityStarterOptions,
  config: {
    readonly effectText?: string;
    readonly stepText?: string;
  } = {}
): GameState | null {
  const shouldConfirm =
    options.manualConfirmation === true || options.confirmBeforeResolution === true;
  if (!shouldConfirm || options.skipManualConfirmation === true) {
    return null;
  }

  return startConfirmOnlyPendingAbilityEffect(game, {
    ability,
    effectText: config.effectText ?? getAbilityEffectText(ability.abilityId),
    orderedResolution: options.orderedResolution === true,
    stepText: config.stepText,
  });
}

export function registerManualConfirmablePendingAbilityStarterHandler(
  abilityId: string,
  resolver: PendingAbilityStarterHandler,
  getConfirmationConfig?: (
    game: GameState,
    ability: PendingAbilityState
  ) => {
    readonly effectText?: string;
    readonly stepText?: string;
  }
): void {
  registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) => {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(
      game,
      ability,
      options,
      getConfirmationConfig?.(game, ability)
    );
    if (confirmation) {
      return confirmation;
    }

    return resolver(game, ability, options, context);
  });
}

export function recordAbilityUseForContext(
  game: GameState,
  playerId: string,
  context: AbilityUseContext
): GameState {
  const tracksSourceLifecycle =
    findCardAbilityDefinitionById(context.abilityId)?.perTurnLimit !== undefined;
  const activeLifecycleId =
    tracksSourceLifecycle &&
    game.activeEffect?.abilityId === context.abilityId &&
    game.activeEffect.sourceCardId === context.sourceCardId
      ? getActiveEffectSourceLifecycleId(game, game.activeEffect)
      : undefined;
  const activeAbilityInstanceId =
    game.activeEffect?.abilityId === context.abilityId &&
    game.activeEffect.sourceCardId === context.sourceCardId
      ? game.activeEffect.abilityInstanceId
      : undefined;
  const abilityInstanceId = context.abilityInstanceId ?? activeAbilityInstanceId;
  const pendingAbility = !tracksSourceLifecycle
    ? undefined
    : context.pendingAbilityId === undefined
      ? game.pendingAbilities.find(
          (ability) =>
            ability.abilityId === context.abilityId && ability.sourceCardId === context.sourceCardId
        )
      : game.pendingAbilities.find((ability) => ability.id === context.pendingAbilityId);
  const sourceLifecycleId = tracksSourceLifecycle
    ? (context.sourceLifecycleId ??
      activeLifecycleId ??
      (pendingAbility
        ? getPendingAbilitySourceLifecycleId(game, pendingAbility)
        : getAbilitySourceLifecycleId(game, context.abilityId, context.sourceCardId)))
    : undefined;
  return addAction(game, 'RESOLVE_ABILITY', playerId, {
    abilityId: context.abilityId,
    ...(abilityInstanceId ? { abilityInstanceId } : {}),
    sourceCardId: context.sourceCardId,
    ...(sourceLifecycleId ? { sourceLifecycleId } : {}),
    ...(context.pendingAbilityId ? { pendingAbilityId: context.pendingAbilityId } : {}),
    step: ABILITY_USE_STEP,
    turnCount: game.turnCount,
  });
}

export function recordPayCostAction(
  game: GameState,
  playerId: string,
  payload: PayCostActionPayload
): GameState {
  return addAction(game, 'PAY_COST', playerId, payload);
}
