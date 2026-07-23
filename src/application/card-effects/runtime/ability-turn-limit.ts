import type { GameState } from '../../../domain/entities/game.js';
import { CardAbilityCategory } from '../ability-definition-types.js';
import { findCardAbilityDefinitionById } from '../definitions/lookup.js';
import {
  getAbilitySourceLifecycleId,
  getActiveEffectSourceLifecycleId,
  getPendingAbilitySourceLifecycleId,
} from './ability-source-lifecycle.js';

const ABILITY_USE_STEP = 'ABILITY_USE';
const ACTIVATED_ABILITY_USE_STEP = 'ACTIVATED_ABILITY_USE';

export interface AbilityTurnLimitStatus {
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly sourceLifecycleId: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
}

export type ActivatedAbilityLimitStatus = AbilityTurnLimitStatus;

export function getAbilityTurnLimitStatus(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): AbilityTurnLimitStatus | null {
  const definition = findCardAbilityDefinitionById(abilityId);
  if (definition?.implemented !== true) {
    return null;
  }
  const limit = definition.perTurnLimit;
  if (limit === undefined) {
    return null;
  }
  const countPendingAsTurnUse = definition.countPendingAsTurnUse !== false;
  const sourceLifecycleId = getAbilitySourceLifecycleId(game, abilityId, sourceCardId);

  const resolvedUses = game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.playerId === playerId &&
      action.payload.abilityId === abilityId &&
      action.payload.sourceCardId === sourceCardId &&
      action.payload.sourceLifecycleId === sourceLifecycleId &&
      (action.payload.step === ABILITY_USE_STEP ||
        action.payload.step === ACTIVATED_ABILITY_USE_STEP) &&
      action.payload.turnCount === game.turnCount
  ).length;
  const pendingUses = countPendingAsTurnUse
    ? game.pendingAbilities.filter(
        (ability) =>
          ability.controllerId === playerId &&
          ability.abilityId === abilityId &&
          ability.sourceCardId === sourceCardId &&
          getPendingAbilitySourceLifecycleId(game, ability) === sourceLifecycleId
      ).length
    : 0;
  const activeUse =
    countPendingAsTurnUse &&
    game.activeEffect?.controllerId === playerId &&
    game.activeEffect.abilityId === abilityId &&
    game.activeEffect.sourceCardId === sourceCardId &&
    getActiveEffectSourceLifecycleId(game, game.activeEffect) === sourceLifecycleId
      ? 1
      : 0;
  const used = resolvedUses + pendingUses + activeUse;

  return {
    abilityId,
    sourceCardId,
    sourceLifecycleId,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

export function getActivatedAbilityLimitStatus(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): ActivatedAbilityLimitStatus | null {
  const definition = findCardAbilityDefinitionById(abilityId);
  if (definition?.category !== CardAbilityCategory.ACTIVATED || !definition.implemented) {
    return null;
  }
  return getAbilityTurnLimitStatus(game, playerId, abilityId, sourceCardId);
}

export function canUseAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  const status = getAbilityTurnLimitStatus(game, playerId, abilityId, sourceCardId);
  return status === null || status.used < status.limit;
}

export function canUseActivatedAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  const status = getActivatedAbilityLimitStatus(game, playerId, abilityId, sourceCardId);
  return status === null || status.used < status.limit;
}
