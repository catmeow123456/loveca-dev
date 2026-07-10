import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { costLte, typeIs } from '../../../effects/card-selectors.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_BP5_333_ON_ENTER_WAIT_SELF_WAIT_OPPONENT_LOW_COST_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const ERENA_OPTION_STEP_ID = 'PL_BP5_333_WAIT_SELF_OPTION';
const ERENA_SELECT_OPPONENT_MEMBER_STEP_ID = 'PL_BP5_333_WAIT_OPPONENT_COST_NINE_MEMBER';
const ERENA_PAY_OPTION_ID = 'pay-wait-self';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerBp5333ErenaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP5_333_ON_ENTER_WAIT_SELF_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    (game, ability, options, context) =>
      startErenaOnEnterWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP5_333_ON_ENTER_WAIT_SELF_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    ERENA_OPTION_STEP_ID,
    (game, input, context) => {
      if (input.selectedOptionId === ERENA_PAY_OPTION_ID) {
        return finishErenaPaySelfWait(
          game,
          deps.enqueueTriggeredCardEffects,
          context.continuePendingCardEffects
        );
      }
      return finishErenaDecline(game, context.continuePendingCardEffects);
    }
  );
  registerActiveEffectStepHandler(
    PL_BP5_333_ON_ENTER_WAIT_SELF_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
    ERENA_SELECT_OPPONENT_MEMBER_STEP_ID,
    (game, input, context) =>
      finishErenaWaitOpponentMember(
        game,
        input.selectedCardId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startErenaOnEnterWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceState = player?.memberSlots.cardStates.get(ability.sourceCardId);
  if (!player || !sourceState || sourceState.orientation === OrientationState.WAITING) {
    return finishErenaPendingNoop(
      game,
      ability,
      orderedResolution,
      {
        step: 'SOURCE_CANNOT_PAY_WAIT_SELF_COST',
        sourceOrientation: sourceState?.orientation ?? null,
      },
      continuePendingCardEffects
    );
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
      stepId: ERENA_OPTION_STEP_ID,
      stepText: '可以将此成员变为待机状态：将对方舞台上1名费用小于等于9的成员变为待机状态。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: ERENA_PAY_OPTION_ID, label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot ?? null,
      },
    },
    actionPayload: {
      step: 'START_WAIT_SELF_OPTION',
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot ?? null,
    },
  });
}

function finishErenaDecline(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_333_ON_ENTER_WAIT_SELF_WAIT_OPPONENT_LOW_COST_ABILITY_ID ||
    effect.stepId !== ERENA_OPTION_STEP_ID
  ) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DECLINE',
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishErenaPaySelfWait(
  game: GameState,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_333_ON_ENTER_WAIT_SELF_WAIT_OPPONENT_LOW_COST_ABILITY_ID ||
    effect.stepId !== ERENA_OPTION_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const selfWaitResult = setMemberOrientation(
    game,
    player.id,
    effect.sourceCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!selfWaitResult || selfWaitResult.previousOrientation === OrientationState.WAITING) {
    return finishErenaActiveNoop(
      game,
      effect,
      {
        step: 'SOURCE_CANNOT_PAY_WAIT_SELF_COST',
      },
      continuePendingCardEffects
    );
  }

  const stateWithSelfWaitTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    selfWaitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        recordPayCostAction(stateAfterWait, player.id, {
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot ?? null,
          waitedMemberCardId: effect.sourceCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  const opponent = getOpponent(stateWithSelfWaitTriggers.gameState, player.id);
  const opponentTargetIds = opponent
    ? getOpponentLowCostNonWaitingTargetIds(stateWithSelfWaitTriggers.gameState, opponent.id)
    : [];
  if (!opponent || opponentTargetIds.length === 0) {
    return continuePendingCardEffects(
      addAction(
        { ...stateWithSelfWaitTriggers.gameState, activeEffect: null },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'WAIT_SELF_NO_OPPONENT_TARGET',
          waitedMemberCardId: effect.sourceCardId,
          opponentTargetIds: [],
        }
      ),
      effect.metadata?.orderedResolution === true
    );
  }

  return {
    ...stateWithSelfWaitTriggers.gameState,
    activeEffect: {
      ...effect,
      stepId: ERENA_SELECT_OPPONENT_MEMBER_STEP_ID,
      stepText: '请选择对方舞台上1名费用小于等于9的成员变为待机状态。',
      selectableCardIds: opponentTargetIds,
      selectableCardVisibility: 'PUBLIC',
      selectableOptions: undefined,
      selectionLabel: '选择对方费用小于等于9的成员',
      confirmSelectionLabel: '变为待机状态',
      canSkipSelection: false,
      metadata: {
        ...effect.metadata,
        waitedMemberCardId: effect.sourceCardId,
      },
    },
  };
}

function finishErenaWaitOpponentMember(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP5_333_ON_ENTER_WAIT_SELF_WAIT_OPPONENT_LOW_COST_ABILITY_ID ||
    effect.stepId !== ERENA_SELECT_OPPONENT_MEMBER_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const currentTargets = opponent ? getOpponentLowCostNonWaitingTargetIds(game, opponent.id) : [];
  if (
    !player ||
    !opponent ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !currentTargets.includes(selectedCardId)
  ) {
    return finishErenaActiveNoop(
      game,
      effect,
      {
        step: 'OPPONENT_TARGET_UNAVAILABLE_AFTER_WAIT_SELF',
        selectedCardId,
        waitedMemberCardId: effect.metadata?.waitedMemberCardId ?? effect.sourceCardId,
      },
      continuePendingCardEffects
    );
  }

  const opponentWaitResult = setMemberOrientation(
    game,
    opponent.id,
    selectedCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!opponentWaitResult) {
    return finishErenaActiveNoop(
      game,
      effect,
      {
        step: 'OPPONENT_TARGET_UNAVAILABLE_AFTER_WAIT_SELF',
        selectedCardId,
        waitedMemberCardId: effect.metadata?.waitedMemberCardId ?? effect.sourceCardId,
      },
      continuePendingCardEffects
    );
  }

  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    opponentWaitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction({ ...stateAfterWait, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'WAIT_SELF_WAIT_OPPONENT_LOW_COST_MEMBER',
          waitedMemberCardId: effect.metadata?.waitedMemberCardId ?? effect.sourceCardId,
          targetPlayerId: opponent.id,
          targetCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return continuePendingCardEffects(
    stateWithTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishErenaPendingNoop(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  payload: Record<string, unknown>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function finishErenaActiveNoop(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  payload: Record<string, unknown>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getOpponentLowCostNonWaitingTargetIds(
  game: GameState,
  opponentPlayerId: string
): readonly string[] {
  const opponent = getPlayerById(game, opponentPlayerId);
  if (!opponent) {
    return [];
  }
  return getStageMemberCardIdsMatching(game, opponentPlayerId, (card) => {
    const orientation = opponent.memberSlots.cardStates.get(card.instanceId)?.orientation;
    return (
      orientation !== OrientationState.WAITING &&
      typeIs(CardType.MEMBER)(card) &&
      costLte(9)(card)
    );
  });
}
