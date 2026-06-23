import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { and, costLte, typeIs } from '../../../effects/card-selectors.js';
import { setMembersOrientation } from '../../../effects/member-state.js';
import { HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const DISCARD_COUNT = 1;
const MAX_WAIT_TARGETS = 2;
const SELECT_DISCARD_STEP_ID = 'HS_BP5_016_SELECT_HAND_CARD_TO_DISCARD';
const SELECT_OPPONENT_MEMBERS_STEP_ID = 'HS_BP5_016_SELECT_OPPONENT_LOW_COST_MEMBERS_TO_WAIT';
const MEMBER_SLOT_ORDER: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp5016IzumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffectsForEnterWaitingRoom: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
  readonly enqueueTriggeredCardEffectsForMemberStateChanged: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp5016IzumiOnEnterDiscard(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishHsBp5016IzumiDiscardCost(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffectsForEnterWaitingRoom
          )
        : finishSkipDiscardCost(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
    SELECT_OPPONENT_MEMBERS_STEP_ID,
    (game, input, context) =>
      finishHsBp5016IzumiWaitTargets(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffectsForMemberStateChanged
      )
  );
}

function startHsBp5016IzumiOnEnterDiscard(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.hand.cardIds.length < DISCARD_COUNT) {
    return finishWithoutEffect(
      game,
      ability,
      options.orderedResolution === true,
      continuePendingCardEffects,
      'NOT_ENOUGH_HAND_TO_DISCARD'
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
      effectText: getAbilityEffectText(
        HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID
      ),
      stepId: SELECT_DISCARD_STEP_ID,
      stepText: '可以将1张手牌放置入休息室，之后将对方至多2名低费用成员变为待机状态。',
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution: options.orderedResolution === true,
        effectCosts: [
          {
            kind: 'DISCARD_HAND_TO_WAITING_ROOM',
            minCount: DISCARD_COUNT,
            maxCount: DISCARD_COUNT,
            optional: true,
          },
        ],
        handToWaitingRoomCost: {
          minCount: DISCARD_COUNT,
          maxCount: DISCARD_COUNT,
          optional: true,
        },
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HAND_DISCARD',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishHsBp5016IzumiDiscardCost(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const targetCardIds = getOpponentLowCostActiveMemberCardIds(discardResult.gameState, player.id);
  const stateWithCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
    selectableCardIds: targetCardIds,
  });
  const orderedResolution = effect.metadata?.orderedResolution === true;

  if (targetCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateWithCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_OPPONENT_LOW_COST_ACTIVE_TARGET',
        discardedHandCardIds: discardResult.discardedCardIds,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...stateWithCost,
      activeEffect: {
        ...effect,
        stepId: SELECT_OPPONENT_MEMBERS_STEP_ID,
        stepText: '请选择对方舞台上至多2名费用小于等于4且非待机状态的成员变为待机状态。',
        selectableCardIds: targetCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: Math.min(MAX_WAIT_TARGETS, targetCardIds.length),
        selectionLabel: '选择要变为待机的对方成员',
        confirmSelectionLabel: '变为待机',
        canSkipSelection: true,
        skipSelectionLabel: '不放置',
        metadata: {
          ...effect.metadata,
          orderedResolution,
          discardedHandCardIds: discardResult.discardedCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_OPPONENT_LOW_COST_MEMBERS',
      selectableCardIds: targetCardIds,
      maxSelectableCards: Math.min(MAX_WAIT_TARGETS, targetCardIds.length),
    }
  );
}

function finishHsBp5016IzumiWaitTargets(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID ||
    effect.stepId !== SELECT_OPPONENT_MEMBERS_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const maxSelectableCards =
    typeof effect.maxSelectableCards === 'number' ? effect.maxSelectableCards : MAX_WAIT_TARGETS;
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > maxSelectableCards ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true &&
        getOpponentLowCostActiveMemberCardIds(game, player.id).includes(cardId)
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
        step: 'WAIT_NO_TARGET_SELECTED',
        waitedMemberCardIds: [],
        previousOrientations: [],
        nextOrientation: OrientationState.WAITING,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const orientationChange = setMembersOrientation(
    game,
    opponent.id,
    uniqueSelectedCardIds,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
    }
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
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
            step: 'WAIT_OPPONENT_LOW_COST_MEMBERS',
            targetPlayerId: opponent.id,
            waitedMemberCardIds: result.updatedMemberCardIds,
            previousOrientations: result.previousOrientations,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishSkipDiscardCost(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SKIP_DISCARD_COST',
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishWithoutEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: reason,
      conditionMet: false,
      reason,
    }),
    orderedResolution
  );
}

function getOpponentLowCostActiveMemberCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!opponent) {
    return [];
  }
  const selector = and(typeIs(CardType.MEMBER), costLte(4));

  const cardIds: string[] = [];
  for (const slot of MEMBER_SLOT_ORDER) {
    const cardId = opponent.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    const orientation = cardId
      ? opponent.memberSlots.cardStates.get(cardId)?.orientation
      : undefined;
    if (cardId && card !== null && selector(card) && orientation !== OrientationState.WAITING) {
      cardIds.push(cardId);
    }
  }
  return cardIds;
}
