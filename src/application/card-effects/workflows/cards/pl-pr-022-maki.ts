import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { cardNameAliasIs } from '../../../effects/card-selectors.js';
import { hasStageMemberMatching } from '../../../effects/conditions.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const BASE_CARD_CODE = 'PL!-PR-022';
const SELECT_DISCARD_STEP_ID = 'PL_PR_022_SELECT_DISCARD_AFTER_DRAW';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerPlPr022MakiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID,
    (game, playerId, cardId) => startPlPr022MakiActivated(game, playerId, cardId, deps)
  );
  registerActiveEffectStepHandler(
    PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishPlPr022MakiActivated(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        deps
      )
  );
}

export function startPlPr022MakiActivated(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE
  ) {
    return game;
  }

  const waitResult = setMemberOrientation(game, playerId, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId,
    sourceCardId: cardId,
    abilityId: PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const stateWithWaitTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction(stateAfterWait, 'PAY_COST', playerId, {
          abilityId: PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  const namePresence = getRinHanayoStagePresence(stateWithWaitTriggers.gameState, playerId);
  if (!namePresence.hasRin && !namePresence.hasHanayo) {
    const stateAfterUse = recordAbilityUseForContext(
      stateWithWaitTriggers.gameState,
      playerId,
      {
        abilityId: PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID,
        sourceCardId: cardId,
      }
    );
    return addAction(stateAfterUse, 'RESOLVE_ABILITY', playerId, {
      abilityId: PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot,
      step: 'PAID_COST_STAGE_NAME_CONDITION_NOT_MET',
      hasRin: false,
      hasHanayo: false,
      memberStateChangedEventIds: stateWithWaitTriggers.memberStateChangedEvents.map(
        (event) => event.eventId
      ),
    });
  }

  return startDrawThenDiscardCardsWorkflow(stateWithWaitTriggers.gameState, {
    ability: {
      id: `${PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID}:${cardId}:turn-${stateWithWaitTriggers.gameState.turnCount}:action-${stateWithWaitTriggers.gameState.actionHistory.length}`,
      abilityId: PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: playerId,
      sourceSlot,
    },
    effectText: getAbilityEffectText(
      PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID
    ),
    drawCount: 2,
    discardCount: 1,
    stepId: SELECT_DISCARD_STEP_ID,
    orderedResolution: false,
    recordAbilityUseOnStart: true,
  });
}

function finishPlPr022MakiActivated(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID
  ) {
    return game;
  }

  return finishDrawThenDiscardCardsWorkflow(
    game,
    selectedCardId,
    selectedCardIds,
    (stateAfterDrawDiscard, orderedResolution) =>
      activateSourceWhenBothNamesArePresent(
        stateAfterDrawDiscard,
        effect.controllerId,
        effect.sourceCardId,
        orderedResolution,
        continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    deps.enqueueTriggeredCardEffects
  );
}

function activateSourceWhenBothNamesArePresent(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const presence = getRinHanayoStagePresence(game, playerId);
  if (!presence.hasRin || !presence.hasHanayo) {
    return continuePendingCardEffects(game, orderedResolution);
  }

  const activateResult = setMemberOrientation(
    game,
    playerId,
    sourceCardId,
    OrientationState.ACTIVE,
    {
      kind: 'CARD_EFFECT',
      playerId,
      sourceCardId,
      abilityId: PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID,
    }
  );
  if (!activateResult || activateResult.previousOrientation !== OrientationState.WAITING) {
    return continuePendingCardEffects(game, orderedResolution);
  }

  const stateWithActivateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    activateResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterActivate, result, memberStateChangedEvents) =>
        addAction(stateAfterActivate, 'RESOLVE_ABILITY', playerId, {
          abilityId: PL_PR_022_ACTIVATED_WAIT_SELF_RIN_HANAYO_DRAW_DISCARD_ABILITY_ID,
          sourceCardId,
          step: 'ACTIVATE_SOURCE_AFTER_DRAW_DISCARD',
          hasRin: true,
          hasHanayo: true,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  return continuePendingCardEffects(stateWithActivateTriggers.gameState, orderedResolution);
}

function getRinHanayoStagePresence(game: GameState, playerId: string): {
  readonly hasRin: boolean;
  readonly hasHanayo: boolean;
} {
  return {
    hasRin: hasStageMemberMatching(game, playerId, cardNameAliasIs('星空凛')),
    hasHanayo: hasStageMemberMatching(game, playerId, cardNameAliasIs('小泉花陽')),
  };
}
