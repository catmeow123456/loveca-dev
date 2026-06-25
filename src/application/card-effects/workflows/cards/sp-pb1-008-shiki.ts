import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { SP_PB1_008_ON_ENTER_DRAW_SELF_POSITION_CHANGE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SP_PB1_008_POSITION_CHANGE_STEP_ID = 'SP_PB1_008_SELF_POSITION_CHANGE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb1008ShikiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  registerPendingAbilityStarterHandler(
    SP_PB1_008_ON_ENTER_DRAW_SELF_POSITION_CHANGE_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPb1008ShikiOnEnter(game, ability, {
        orderedResolution: options.orderedResolution === true,
        continuePendingCardEffects: context.continuePendingCardEffects,
      })
  );
  registerActiveEffectStepHandler(
    SP_PB1_008_ON_ENTER_DRAW_SELF_POSITION_CHANGE_ABILITY_ID,
    SP_PB1_008_POSITION_CHANGE_STEP_ID,
    (game, input, context) =>
      finishSpPb1008ShikiPositionChange(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startSpPb1008ShikiOnEnter(
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

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawResult = drawCardsForPlayer(stateWithoutPending, player.id, 1);
  if (!drawResult) {
    return game;
  }

  const playerAfterDraw = getPlayerById(drawResult.gameState, player.id);
  const sourceSlot = playerAfterDraw ? findMemberSlot(playerAfterDraw, ability.sourceCardId) : null;
  if (!sourceSlot) {
    return options.continuePendingCardEffects(
      addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'DRAW_ONE_NO_SOURCE_MEMBER',
        drawnCardIds: drawResult.drawnCardIds,
      }),
      options.orderedResolution
    );
  }

  return startPendingActiveEffect(drawResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SP_PB1_008_POSITION_CHANGE_STEP_ID,
      stepText: '请选择此成员要移动到的成员区。',
      awaitingPlayerId: player.id,
      selectableSlots: Object.values(SlotPosition).filter((slot) => slot !== sourceSlot),
      canSkipSelection: false,
      selectionLabel: '选择移动区域',
      confirmSelectionLabel: '站位变换',
      metadata: {
        orderedResolution: options.orderedResolution,
        sourceSlot,
        drawnCardIds: drawResult.drawnCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'DRAW_ONE_START_SELF_POSITION_CHANGE',
      sourceSlot,
      drawnCardIds: drawResult.drawnCardIds,
    },
  });
}

function finishSpPb1008ShikiPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_PB1_008_ON_ENTER_DRAW_SELF_POSITION_CHANGE_ABILITY_ID ||
    effect.stepId !== SP_PB1_008_POSITION_CHANGE_STEP_ID ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
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
            drawnCardIds: effect.metadata?.drawnCardIds,
          }
        ),
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(moveResult.gameState, orderedResolution);
}
