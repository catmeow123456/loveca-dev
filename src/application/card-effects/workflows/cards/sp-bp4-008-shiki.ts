import type { MemberSlotMovedEvent } from '../../../../domain/events/game-events.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import {
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import {
  SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
  SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { moveMemberBetweenSlotsAndEnqueueTriggers } from '../../runtime/member-slot-moved-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';

export const SHIKI_RIGHT_ACTIVATE_ENERGY_STEP_ID = 'SHIKI_RIGHT_ACTIVATE_ENERGY';
export const SHIKI_LIVE_START_POSITION_CHANGE_STEP_ID = 'SHIKI_LIVE_START_POSITION_CHANGE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly memberSlotMovedEvents?: readonly MemberSlotMovedEvent[];
  }
) => GameState;

export function registerShikiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
    (game, ability, options) =>
      startShikiOnEnterRightActivateEnergy(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
    SHIKI_RIGHT_ACTIVATE_ENERGY_STEP_ID,
    (game, _input, context) =>
      finishShikiOnEnterRightActivateEnergy(game, context.continuePendingCardEffects)
  );

  registerPendingAbilityStarterHandler(
    SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
    (game, ability, options, context) =>
      startShikiLiveStartPositionChange(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
    SHIKI_LIVE_START_POSITION_CHANGE_STEP_ID,
    (game, input, context) =>
      finishShikiLiveStartPositionChange(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startShikiOnEnterRightActivateEnergy(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  );
  const maxActivateCount = Math.min(2, waitingEnergyCardIds.length);
  const stepText = `确认后将至多2张待机能量变为活跃状态。（当前可变为活跃：${maxActivateCount}张）`;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID),
      stepId: SHIKI_RIGHT_ACTIVATE_ENERGY_STEP_ID,
      stepText,
      awaitingPlayerId: player.id,
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        fromOrientation: OrientationState.WAITING,
        nextOrientation: OrientationState.ACTIVE,
        maxActivateCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
      sourceSlot: ability.sourceSlot,
      waitingEnergyCardIds,
      maxActivateCount,
    },
  });
}

function finishShikiOnEnterRightActivateEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount = Math.min(2, waitingEnergyCount);
  const orientationChange = activateWaitingEnergyCardsForPlayer(
    game,
    player.id,
    activationCount
  );
  if (!orientationChange) {
    return game;
  }

  const state = {
    ...orientationChange.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'ACTIVATE_ENERGY',
      sourceSlot: effect.metadata?.sourceSlot,
      activatedEnergyCardIds: orientationChange.activatedEnergyCardIds,
      previousOrientations: orientationChange.previousOrientations,
      nextOrientation: orientationChange.nextOrientation,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startShikiLiveStartPositionChange(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = ability.sourceSlot ?? findMemberSlot(player, ability.sourceCardId);
  if (!sourceSlot) {
    return continuePendingCardEffects(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      orderedResolution
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID),
      stepId: SHIKI_LIVE_START_POSITION_CHANGE_STEP_ID,
      stepText: '请选择若菜四季要移动到的成员区。也可以选择不进行站位变换。',
      awaitingPlayerId: player.id,
      selectableSlots: Object.values(SlotPosition).filter((slot) => slot !== sourceSlot),
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot,
        optional: true,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_POSITION_CHANGE',
      sourceSlot,
      optional: true,
    },
  });
}

function finishShikiLiveStartPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (!selectedSlot) {
    if (effect.canSkipSelection !== true) {
      return game;
    }

    const state = {
      ...game,
      activeEffect: null,
    };

    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'POSITION_CHANGE_SKIPPED',
        sourceSlot: effect.metadata?.sourceSlot,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (!effect.selectableSlots?.includes(selectedSlot)) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceSlot || sourceSlot === selectedSlot) {
    return game;
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    player.id,
    effect.sourceCardId,
    selectedSlot,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'POSITION_CHANGE',
            fromSlot: result.fromSlot,
            toSlot: result.toSlot,
            swappedCardId: result.swappedCardId,
          }
        ),
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    moveResult.gameState,
    effect.metadata?.orderedResolution === true
  );
}
