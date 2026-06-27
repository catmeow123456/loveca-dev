import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const HS_BP6_011_SELECT_DISCARD_STEP_ID = 'HS_BP6_011_SELECT_DISCARD_AFTER_DRAW';

type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerHsBp6011RurinoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
    (game, playerId, cardId) => startHsBp6011WaitSelfDrawDiscard(game, playerId, cardId, deps)
  );
  registerActiveEffectStepHandler(
    HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
    HS_BP6_011_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishDrawThenDiscardCardsWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

export function startHsBp6011WaitSelfDrawDiscard(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
  }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!HS-bp6-011') ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE
  ) {
    return game;
  }

  const waitResult = setMemberOrientation(game, player.id, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId: player.id,
    sourceCardId: cardId,
    abilityId: HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction(stateAfterWait, 'PAY_COST', player.id, {
          abilityId: HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return startDrawThenDiscardCardsWorkflow(stateWithMemberStateTriggers.gameState, {
    ability: {
      id: `${HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID}:${cardId}:turn-${stateWithMemberStateTriggers.gameState.turnCount}:action-${stateWithMemberStateTriggers.gameState.actionHistory.length}`,
      abilityId: HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: player.id,
      sourceSlot,
    },
    effectText: getAbilityEffectText(
      HS_BP6_011_ACTIVATED_WAIT_SELF_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    ),
    drawCount: 1,
    discardCount: 1,
    stepId: HS_BP6_011_SELECT_DISCARD_STEP_ID,
    orderedResolution: false,
    recordAbilityUseOnStart: true,
  });
}
