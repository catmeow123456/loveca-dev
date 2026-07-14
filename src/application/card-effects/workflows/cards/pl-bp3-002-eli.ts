import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
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

const SELECT_DISCARD_STEP_ID = 'PL_BP3_002_SELECT_DISCARD_COST';
const SELECT_OPPONENT_MEMBERS_STEP_ID = 'PL_BP3_002_SELECT_OPPONENT_LOW_COST_MEMBERS';
const MAX_TARGET_COUNT = 2;
const MAX_TARGET_COST = 4;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerPlBp3002EliWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
    (game, ability, options, context) =>
      startEliOnEnterDiscardCost(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId === null
        ? finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_DISCARD_COST',
          })
        : finishEliDiscardCost(
            game,
            input.selectedCardId ?? null,
            deps.enqueueTriggeredCardEffects,
            context.continuePendingCardEffects
          )
  );
  registerActiveEffectStepHandler(
    PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
    SELECT_OPPONENT_MEMBERS_STEP_ID,
    (game, input, context) =>
      finishEliWaitOpponentMembers(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startEliOnEnterDiscardCost(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || player.hand.cardIds.length === 0) {
    const stateWithoutPending = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: player ? 'NO_HAND_TO_DISCARD' : 'NO_CONTROLLER',
      }),
      orderedResolution
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      stepText:
        '可以选择1张手牌放置入休息室。如此做时，可以将对方舞台上费用4以下的成员至多2名变为待机状态。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_COST',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishEliDiscardCost(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(discardResult.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
  });
  const selectableCardIds = getOpponentLowCostMemberTargetIds(stateAfterCost, player.id);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_COST_NO_LOW_COST_TARGETS',
        discardedCardIds: discardResult.discardedCardIds,
        waitedMemberCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        ...effect,
        stepId: SELECT_OPPONENT_MEMBERS_STEP_ID,
        stepText: '可以选择对方舞台上费用4以下的成员至多2名变为待机状态。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: Math.min(MAX_TARGET_COUNT, selectableCardIds.length),
        selectionLabel: '选择要变为待机状态的成员',
        confirmSelectionLabel: '变为待机状态',
        canSkipSelection: true,
        skipSelectionLabel: '不选择目标',
        metadata: {
          ...effect.metadata,
          discardedCardIds: discardResult.discardedCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_COST_SELECT_LOW_COST_TARGETS',
      discardedCardIds: discardResult.discardedCardIds,
      selectableCardIds,
    }
  );
}

function finishEliWaitOpponentMembers(
  game: GameState,
  selectedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const opponent = player ? getOpponent(game, player.id) : null;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID ||
    effect.stepId !== SELECT_OPPONENT_MEMBERS_STEP_ID ||
    !player ||
    !opponent
  ) {
    return game;
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const currentCandidateIds = getOpponentLowCostMemberTargetIds(game, player.id);
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > MAX_TARGET_COUNT ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true ||
        !currentCandidateIds.includes(cardId)
    )
  ) {
    return game;
  }

  if (uniqueSelectedCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_TARGET_SELECTED',
        discardedCardIds: readStringArrayMetadata(effect.metadata, 'discardedCardIds'),
        waitedMemberCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const orientationResult = setMembersOrientation(
    game,
    opponent.id,
    uniqueSelectedCardIds,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );
  if (!orientationResult) {
    return game;
  }

  const triggerResult = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'WAIT_OPPONENT_LOW_COST_MEMBERS',
          discardedCardIds: readStringArrayMetadata(effect.metadata, 'discardedCardIds'),
          waitedMemberCardIds: result.updatedMemberCardIds,
          previousOrientations: result.previousOrientations,
          nextOrientation: result.nextOrientation,
        }),
    }
  );
  return continuePendingCardEffects(
    triggerResult.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function getOpponentLowCostMemberTargetIds(game: GameState, playerId: string): readonly string[] {
  const opponent = getOpponent(game, playerId);
  if (!opponent) {
    return [];
  }
  return Object.values(opponent.memberSlots.slots).filter((cardId): cardId is string => {
    if (!cardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      isMemberCardData(card.data) &&
      opponent.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING &&
      getMemberEffectiveCost(game, opponent.id, cardId) <= MAX_TARGET_COST
    );
  });
}

function readStringArrayMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string
): readonly string[] {
  const value = metadata?.[key];
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}
