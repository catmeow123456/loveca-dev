import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const SP_BP5_006_POSITION_CHANGE_STEP_ID = 'SP_BP5_006_SELF_POSITION_CHANGE';
const MILL_COST_COUNT = 3;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberSlotMoved;

export function registerSpBp5006KinakoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID,
    (game, playerId, cardId) =>
      startSpBp5006KinakoActivated(game, playerId, cardId, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(
    SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID,
    SP_BP5_006_POSITION_CHANGE_STEP_ID,
    (game, input, context) =>
      finishSpBp5006KinakoPositionChange(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startSpBp5006KinakoActivated(
  game: GameState,
  playerId: string,
  cardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = player ? findMemberSlot(player, cardId) : null;
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp5-006') ||
    sourceSlot === null ||
    player.mainDeck.cardIds.length < MILL_COST_COUNT
  ) {
    return game;
  }

  let state = recordAbilityUseForContext(game, player.id, {
    abilityId: SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID,
    sourceCardId: cardId,
  });
  const millResult = moveTopDeckCardsToWaitingRoomAndEnqueueTriggers(
    state,
    player.id,
    MILL_COST_COUNT,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (gameState, movedCardIds) =>
        recordPayCostAction(gameState, player.id, {
          abilityId: SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID,
          sourceCardId: cardId,
          milledCardIds: movedCardIds,
          count: movedCardIds.length,
        }),
    }
  );
  if (!millResult || millResult.movedCardIds.length !== MILL_COST_COUNT) {
    return game;
  }
  state = millResult.gameState;

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID
        ),
        stepId: SP_BP5_006_POSITION_CHANGE_STEP_ID,
        stepText: '请选择此成员要移动到的成员区。',
        awaitingPlayerId: player.id,
        selectableSlots: Object.values(SlotPosition).filter((slot) => slot !== sourceSlot),
        canSkipSelection: false,
        selectionLabel: '选择移动区域',
        confirmSelectionLabel: '站位变换',
        metadata: {
          sourceSlot,
          milledCardIds: millResult.movedCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID,
      sourceCardId: cardId,
      step: 'MILL_THREE_SELF_POSITION_CHANGE',
      sourceSlot,
      milledCardIds: millResult.movedCardIds,
      count: millResult.movedCardIds.length,
    }
  );
}

function finishSpBp5006KinakoPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID ||
    effect.stepId !== SP_BP5_006_POSITION_CHANGE_STEP_ID ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
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
            milledCardIds: effect.metadata?.milledCardIds,
          }
        ),
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(moveResult.gameState, false);
}
