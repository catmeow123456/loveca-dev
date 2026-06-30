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
} from './draw-then-discard.js';

export type ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects =
  EnqueueTriggeredCardEffectsForEnterWaitingRoom &
    EnqueueTriggeredCardEffectsForMemberStateChanged;

export interface ActivatedWaitSelfDrawDiscardWorkflowConfig {
  readonly abilityId: string;
  readonly baseCardCodes: readonly string[];
  readonly drawCount: number;
  readonly discardCount: number;
  readonly stepId: string;
}

export function registerActivatedWaitSelfDrawDiscardWorkflowHandlers(
  config: ActivatedWaitSelfDrawDiscardWorkflowConfig,
  deps: {
    readonly enqueueTriggeredCardEffects: ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects;
  }
): void {
  registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) =>
    startActivatedWaitSelfDrawDiscard(game, playerId, cardId, config, deps)
  );
  registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
    finishDrawThenDiscardCardsWorkflow(
      game,
      input.selectedCardId ?? null,
      input.selectedCardIds,
      context.continuePendingCardEffects,
      deps.enqueueTriggeredCardEffects
    )
  );
}

export function startActivatedWaitSelfDrawDiscard(
  game: GameState,
  playerId: string,
  cardId: string,
  config: ActivatedWaitSelfDrawDiscardWorkflowConfig,
  deps: {
    readonly enqueueTriggeredCardEffects: ActivatedWaitSelfDrawDiscardEnqueueTriggeredCardEffects;
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
    !config.baseCardCodes.some((baseCode) =>
      cardCodeMatchesBase(sourceCard.data.cardCode, baseCode)
    ) ||
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
    abilityId: config.abilityId,
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
          abilityId: config.abilityId,
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
      id: `${config.abilityId}:${cardId}:turn-${stateWithMemberStateTriggers.gameState.turnCount}:action-${stateWithMemberStateTriggers.gameState.actionHistory.length}`,
      abilityId: config.abilityId,
      sourceCardId: cardId,
      controllerId: player.id,
      sourceSlot,
    },
    effectText: getAbilityEffectText(config.abilityId),
    drawCount: config.drawCount,
    discardCount: config.discardCount,
    stepId: config.stepId,
    orderedResolution: false,
    recordAbilityUseOnStart: true,
  });
}
