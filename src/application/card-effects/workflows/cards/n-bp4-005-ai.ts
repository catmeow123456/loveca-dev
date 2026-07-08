import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
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
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID } from '../../ability-ids.js';

const SELECT_DISCARD_STEP_ID = 'PL_N_BP4_005_SELECT_DISCARD_COST';
const SELECT_OPPONENT_MEMBERS_STEP_ID = 'PL_N_BP4_005_SELECT_OPPONENT_LOW_COST_MEMBERS';
const MAX_TARGET_COUNT = 2;
const MAX_TARGET_COST = 4;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerNBp4005AiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
    (game, ability, options, context) =>
      startAiOnEnterDiscardCost(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId === null
        ? finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_DISCARD_COST',
          })
        : finishAiDiscardCost(
            game,
            input.selectedCardId ?? null,
            deps.enqueueTriggeredCardEffects,
            context.continuePendingCardEffects
          )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
    SELECT_OPPONENT_MEMBERS_STEP_ID,
    (game, input, context) =>
      finishAiWaitOpponentMembers(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startAiOnEnterDiscardCost(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (
    !player ||
    !isAiSourceOnOwnStage(game, player.id, ability.sourceCardId) ||
    sourceSlot === null ||
    player.hand.cardIds.length === 0
  ) {
    return continuePendingCardEffects(
      addAction(consumePendingAbility(game, ability), 'RESOLVE_ABILITY', ability.controllerId, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot,
        step: !player
          ? 'NO_CONTROLLER'
          : sourceSlot === null
            ? 'SOURCE_NOT_ON_STAGE'
            : 'NO_HAND_TO_DISCARD',
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
      metadata: { sourceSlot },
      stepText:
        '可以选择1张手牌放置入休息室。如此做时，将对方舞台上费用4以下的成员至多2人变为待机状态。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'START_SELECT_DISCARD_COST',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishAiDiscardCost(
  game: GameState,
  selectedCardId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID ||
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

  const state = recordPayCostAction(discardResult.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot ?? null,
    discardedCardId: selectedCardId,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId ?? null,
  });
  const selectableCardIds = getOpponentLowCostMemberTargetIds(state, player.id);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot ?? null,
        step: 'DISCARD_COST_NO_LOW_COST_TARGETS',
        discardedCardIds: discardResult.discardedCardIds,
        waitedMemberCardIds: [],
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: SELECT_OPPONENT_MEMBERS_STEP_ID,
        stepText: '请选择对方舞台上费用4以下的成员至多2人变为待机状态。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: MAX_TARGET_COUNT,
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
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      step: 'DISCARD_COST_SELECT_LOW_COST_TARGETS',
      discardedCardIds: discardResult.discardedCardIds,
      selectableCardIds,
    }
  );
}

function finishAiWaitOpponentMembers(
  game: GameState,
  selectedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID ||
    effect.stepId !== SELECT_OPPONENT_MEMBERS_STEP_ID ||
    !player
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

  let state = game;
  const waitedMemberCardIds: string[] = [];
  const memberStateChangedEventIds: string[] = [];
  const opponent = getOpponent(game, player.id);
  if (!opponent) {
    return game;
  }

  for (const cardId of uniqueSelectedCardIds) {
    const orientationResult = setMemberOrientation(
      state,
      opponent.id,
      cardId,
      OrientationState.WAITING,
      {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
      }
    );
    if (!orientationResult || orientationResult.previousOrientation === OrientationState.WAITING) {
      return game;
    }
    const triggerResult = enqueueMemberStateChangedTriggersFromOrientationResult(
      state,
      orientationResult,
      enqueueTriggeredCardEffects
    );
    state = triggerResult.gameState;
    waitedMemberCardIds.push(cardId);
    memberStateChangedEventIds.push(
      ...triggerResult.memberStateChangedEvents.map((event) => event.eventId)
    );
  }

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot ?? null,
      step: waitedMemberCardIds.length > 0 ? 'WAIT_OPPONENT_LOW_COST_MEMBERS' : 'NO_TARGET_SELECTED',
      discardedCardIds: getStringArrayMetadata(effect.metadata, 'discardedCardIds'),
      waitedMemberCardIds,
      memberStateChangedEventIds,
    }),
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
    const state = opponent.memberSlots.cardStates.get(cardId);
    return (
      card !== null &&
      isMemberCardData(card.data) &&
      state?.orientation !== OrientationState.WAITING &&
      getMemberEffectiveCost(game, opponent.id, cardId) <= MAX_TARGET_COST
    );
  });
}

function isAiSourceOnOwnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const card = getCardById(game, sourceCardId);
  return (
    card !== null &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!N-bp4-005') &&
    getSourceMemberSlot(game, playerId, sourceCardId) !== null
  );
}

function consumePendingAbility(game: GameState, ability: PendingAbilityState): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
}

function getStringArrayMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string
): readonly string[] {
  const value = metadata?.[key];
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}
