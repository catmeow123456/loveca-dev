import {
  addAction,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, costLte, typeIs } from '../../../effects/card-selectors.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_PR_005_006_008_ON_ENTER_CHOOSE_DRAW_DISCARD_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from './draw-then-discard.js';

const CHOOSE_EFFECT_STEP_ID = 'PL_PR_005_006_008_CHOOSE_EFFECT';
const SELECT_DISCARD_STEP_ID = 'PL_PR_005_006_008_SELECT_DISCARD';

const DRAW_DISCARD_OPTION_ID = 'draw_discard';
const WAIT_OPPONENT_LOW_COST_OPTION_ID = 'wait_opponent_low_cost';

const EFFECT_OPTIONS = [
  { id: DRAW_DISCARD_OPTION_ID, label: '抽1张卡，将1张手牌放置入休息室' },
  {
    id: WAIT_OPPONENT_LOW_COST_OPTION_ID,
    label: '将对方所有费用小于等于2的成员变为待机状态',
  },
] as const;

const lowCostMemberSelector = and(typeIs(CardType.MEMBER), costLte(2));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerPrOnEnterChooseDrawDiscardOrWaitOpponentLowCostWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    PL_PR_005_006_008_ON_ENTER_CHOOSE_DRAW_DISCARD_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    (game, ability, options, context) =>
      startChooseEffect(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_PR_005_006_008_ON_ENTER_CHOOSE_DRAW_DISCARD_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    CHOOSE_EFFECT_STEP_ID,
    (game, input, context) =>
      finishChooseEffect(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_PR_005_006_008_ON_ENTER_CHOOSE_DRAW_DISCARD_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
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

function startChooseEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  _continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: CHOOSE_EFFECT_STEP_ID,
      stepText: '请选择要执行的效果。',
      awaitingPlayerId: player.id,
      selectableOptions: EFFECT_OPTIONS,
      selectionLabel: '选择要执行的效果',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_CHOOSE_EFFECT',
      selectableOptionIds: EFFECT_OPTIONS.map((option) => option.id),
    },
  });
}

function finishChooseEffect(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = getActiveEffectForStep(game, CHOOSE_EFFECT_STEP_ID);
  if (
    !effect ||
    selectedOptionId === null ||
    !EFFECT_OPTIONS.some((option) => option.id === selectedOptionId)
  ) {
    return game;
  }

  if (selectedOptionId === DRAW_DISCARD_OPTION_ID) {
    return startDrawThenDiscardCardsWorkflow(game, {
      ability: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
      },
      effectText: effect.effectText,
      drawCount: 1,
      discardCount: 1,
      stepId: SELECT_DISCARD_STEP_ID,
      orderedResolution: effect.metadata?.orderedResolution === true,
      continuePendingCardEffects,
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
    });
  }

  return resolveWaitOpponentLowCostBranch(
    game,
    effect,
    continuePendingCardEffects,
    enqueueTriggeredCardEffects
  );
}

function resolveWaitOpponentLowCostBranch(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const matchedTargetCardIds = getStageMemberCardIdsMatching(
    game,
    opponent.id,
    lowCostMemberSelector
  );
  const stateWithoutActiveEffect: GameState = { ...game, activeEffect: null };
  const orientationResult = setMembersOrientation(
    stateWithoutActiveEffect,
    opponent.id,
    matchedTargetCardIds,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!orientationResult) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    stateWithoutActiveEffect,
    orientationResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result, memberStateChangedEvents) =>
        addAction(state, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'WAIT_OPPONENT_LOW_COST_MEMBERS',
          matchedTargetCardIds,
          actualWaitingTargetCardIds: result.updatedMemberCardIds,
          previousOrientations: result.previousOrientations,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function getActiveEffectForStep(
  game: GameState,
  stepId: string
): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
      PL_PR_005_006_008_ON_ENTER_CHOOSE_DRAW_DISCARD_OR_WAIT_OPPONENT_LOW_COST_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}
