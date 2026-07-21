import {
  addAction,
  getCardById,
  getPlayerById,
  type DelegatedAbilitySequenceState,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import { getStageMemberDelegatableOnEnterDefinitions } from './delegatable-definitions.js';
import {
  hasPendingAbilityStarterHandler,
  type DelegatePendingAbility,
} from './starter-registry.js';
import { GamePhase } from '../../../shared/types/enums.js';

export interface StartDelegatedAbilitySequenceOptions {
  readonly id: string;
  readonly controllerId: string;
  readonly parentAbilityId: string;
  readonly parentSourceCardId: string;
  readonly parentEffectId: string;
  readonly orderedResolution: boolean;
  readonly abilities: readonly PendingAbilityState[];
}

export function startDelegatedAbilitySequence(
  game: GameState,
  options: StartDelegatedAbilitySequenceOptions,
  delegatePendingAbility: DelegatePendingAbility
): GameState {
  if (game.activeEffect || game.delegatedAbilitySequence || options.abilities.length === 0) {
    return game;
  }
  const sequence: DelegatedAbilitySequenceState = {
    id: options.id,
    controllerId: options.controllerId,
    parentAbilityId: options.parentAbilityId,
    parentSourceCardId: options.parentSourceCardId,
    parentEffectId: options.parentEffectId,
    orderedResolution: options.orderedResolution,
    remainingAbilities: options.abilities,
    resolvedPendingAbilityIds: [],
    resolvedAbilityIds: [],
    skippedPendingAbilityIds: [],
    skippedAbilityIds: [],
  };
  return advanceDelegatedAbilitySequence(
    { ...game, delegatedAbilitySequence: sequence },
    delegatePendingAbility
  ) ?? game;
}

/**
 * Advances one forced child before any global trigger enqueue/check-timing work.
 * Returns null when no sequence is active.
 */
export function advanceDelegatedAbilitySequence(
  game: GameState,
  delegatePendingAbility: DelegatePendingAbility
): GameState | null {
  const sequence = game.delegatedAbilitySequence;
  if (!sequence || game.activeEffect) return null;

  const next = sequence.remainingAbilities[0];
  if (!next) {
    return addAction(
      { ...game, delegatedAbilitySequence: null },
      'RESOLVE_ABILITY',
      sequence.controllerId,
      {
        pendingAbilityId: sequence.parentEffectId,
        abilityId: sequence.parentAbilityId,
        sourceCardId: sequence.parentSourceCardId,
        step: 'DELEGATED_ABILITY_SEQUENCE_COMPLETE',
        sequenceId: sequence.id,
        resolvedPendingAbilityIds: sequence.resolvedPendingAbilityIds,
        resolvedAbilityIds: sequence.resolvedAbilityIds,
        skippedPendingAbilityIds: sequence.skippedPendingAbilityIds,
        skippedAbilityIds: sequence.skippedAbilityIds,
      }
    );
  }

  const remainingAbilities = sequence.remainingAbilities.slice(1);
  if (!isDelegatedStageOnEnterStillAvailable(game, next)) {
    const state = addAction(
      {
        ...game,
        delegatedAbilitySequence: {
          ...sequence,
          remainingAbilities,
          skippedPendingAbilityIds: [...sequence.skippedPendingAbilityIds, next.id],
          skippedAbilityIds: [...sequence.skippedAbilityIds, next.abilityId],
        },
      },
      'RESOLVE_ABILITY',
      sequence.controllerId,
      {
        pendingAbilityId: sequence.parentEffectId,
        abilityId: sequence.parentAbilityId,
        sourceCardId: sequence.parentSourceCardId,
        step: 'DELEGATED_ABILITY_NO_LONGER_AVAILABLE',
        sequenceId: sequence.id,
        delegatedPendingAbilityId: next.id,
        delegatedAbilityId: next.abilityId,
        delegatedSourceCardId: next.sourceCardId,
      }
    );
    return advanceDelegatedAbilitySequence(state, delegatePendingAbility) ?? state;
  }

  if (!hasPendingAbilityStarterHandler(next.abilityId)) {
    return skipDelegatedAbility(
      game,
      sequence,
      next,
      remainingAbilities,
      'DELEGATED_ABILITY_STARTER_MISSING',
      delegatePendingAbility
    );
  }

  const stateBeforeChild: GameState = {
    ...game,
    delegatedAbilitySequence: {
      ...sequence,
      remainingAbilities,
      resolvedPendingAbilityIds: [...sequence.resolvedPendingAbilityIds, next.id],
      resolvedAbilityIds: [...sequence.resolvedAbilityIds, next.abilityId],
    },
  };
  const delegated = delegatePendingAbility(stateBeforeChild, next, {
    orderedResolution: false,
    skipManualConfirmation: true,
  });
  if (hasDelegatedAbilityProgressed(stateBeforeChild, delegated)) {
    return delegated;
  }
  return skipDelegatedAbility(
    game,
    sequence,
    next,
    remainingAbilities,
    'DELEGATED_ABILITY_NO_PROGRESS',
    delegatePendingAbility
  );
}

function skipDelegatedAbility(
  game: GameState,
  sequence: DelegatedAbilitySequenceState,
  ability: PendingAbilityState,
  remainingAbilities: readonly PendingAbilityState[],
  step: string,
  delegatePendingAbility: DelegatePendingAbility
): GameState {
  const state = addAction(
    {
      ...game,
      delegatedAbilitySequence: {
        ...sequence,
        remainingAbilities,
        skippedPendingAbilityIds: [...sequence.skippedPendingAbilityIds, ability.id],
        skippedAbilityIds: [...sequence.skippedAbilityIds, ability.abilityId],
      },
    },
    'RESOLVE_ABILITY',
    sequence.controllerId,
    {
      pendingAbilityId: sequence.parentEffectId,
      abilityId: sequence.parentAbilityId,
      sourceCardId: sequence.parentSourceCardId,
      step,
      sequenceId: sequence.id,
      delegatedPendingAbilityId: ability.id,
      delegatedAbilityId: ability.abilityId,
      delegatedSourceCardId: ability.sourceCardId,
    }
  );
  return advanceDelegatedAbilitySequence(state, delegatePendingAbility) ?? state;
}

function hasDelegatedAbilityProgressed(before: GameState, after: GameState): boolean {
  if (after.currentPhase === GamePhase.GAME_END || after.activeEffect !== null) {
    return true;
  }
  const beforeSequence = before.delegatedAbilitySequence;
  const afterSequence = after.delegatedAbilitySequence;
  if (!beforeSequence || !afterSequence) {
    return !afterSequence;
  }
  if (afterSequence.id !== beforeSequence.id) {
    return true;
  }
  return (
    afterSequence.remainingAbilities.length < beforeSequence.remainingAbilities.length ||
    afterSequence.resolvedPendingAbilityIds.length >
      beforeSequence.resolvedPendingAbilityIds.length ||
    afterSequence.skippedPendingAbilityIds.length >
      beforeSequence.skippedPendingAbilityIds.length
  );
}

function isDelegatedStageOnEnterStillAvailable(
  game: GameState,
  ability: PendingAbilityState
): boolean {
  const player = getPlayerById(game, ability.controllerId);
  const card = getCardById(game, ability.sourceCardId);
  const sourceSlot = ability.sourceSlot;
  if (
    !player ||
    !card ||
    sourceSlot === undefined ||
    player.memberSlots.slots[sourceSlot] !== ability.sourceCardId
  ) {
    return false;
  }
  return getStageMemberDelegatableOnEnterDefinitions(
    card.data.cardCode,
    sourceSlot
  ).some((definition) => definition.abilityId === ability.abilityId);
}
