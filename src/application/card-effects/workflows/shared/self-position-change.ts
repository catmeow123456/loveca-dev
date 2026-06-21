import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELF_POSITION_CHANGE_STEP_ID = 'SELF_POSITION_CHANGE';
const SELF_POSITION_CHANGE_ABILITY_IDS = [
  GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID,
] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSelfPositionChangeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  for (const abilityId of SELF_POSITION_CHANGE_ABILITY_IDS) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startSelfPositionChangeWorkflow(game, ability, {
        orderedResolution: options.orderedResolution === true,
        continuePendingCardEffects: context.continuePendingCardEffects,
      })
    );
    registerActiveEffectStepHandler(abilityId, SELF_POSITION_CHANGE_STEP_ID, (game, input, context) =>
      finishSelfPositionChangeWorkflow(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function startSelfPositionChangeWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution: boolean;
    readonly continuePendingCardEffects: ContinuePendingCardEffects;
  }
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = ability.sourceSlot ?? findMemberSlot(player, ability.sourceCardId);
  if (!sourceSlot) {
    return options.continuePendingCardEffects(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      options.orderedResolution
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
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELF_POSITION_CHANGE_STEP_ID,
      stepText: '请选择此成员要移动到的成员区。也可以选择不进行站位变换。',
      awaitingPlayerId: player.id,
      selectableSlots: Object.values(SlotPosition).filter((slot) => slot !== sourceSlot),
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution: options.orderedResolution,
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

function finishSelfPositionChangeWorkflow(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
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
