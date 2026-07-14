import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { inspectTopCards } from '../../../effects/look-top.js';
import { PL_BP3_007_LIVE_START_DISCARD_TWO_PARTITION_TOP_THREE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  moveInspectedCardsToDeckTopRestToWaitingRoomAndEnqueueTriggers,
  partitionInspectedCardsToHandDeckTopWaitingRoomAndEnqueueTriggers,
} from '../../runtime/inspection-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const DISCARD_COUNT = 2;
const INSPECT_COUNT = 3;
const SELECT_DISCARD_STEP_ID = 'PL_BP3_007_SELECT_DISCARD_TWO';
const SELECT_HAND_DESTINATION_STEP_ID = 'PL_BP3_007_SELECT_INSPECTED_HAND_DESTINATION';
const SELECT_DECK_TOP_DESTINATION_STEP_ID = 'PL_BP3_007_SELECT_INSPECTED_DECK_TOP_DESTINATION';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp3007NozomiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_BP3_007_LIVE_START_DISCARD_TWO_PARTITION_TOP_THREE_ABILITY_ID,
    (game, ability, options, context) =>
      startNozomiLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_007_LIVE_START_DISCARD_TWO_PARTITION_TOP_THREE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishDiscardCost(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_BP3_007_LIVE_START_DISCARD_TWO_PARTITION_TOP_THREE_ABILITY_ID,
    SELECT_HAND_DESTINATION_STEP_ID,
    (game, input) => selectHandDestination(game, input.selectedCardId ?? null)
  );
  registerActiveEffectStepHandler(
    PL_BP3_007_LIVE_START_DISCARD_TWO_PARTITION_TOP_THREE_ABILITY_ID,
    SELECT_DECK_TOP_DESTINATION_STEP_ID,
    (game, input, context) =>
      finishPartition(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startNozomiLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (player.hand.cardIds.length < DISCARD_COUNT) {
    return consumePending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NOT_ENOUGH_HAND_TO_DISCARD',
      handCount: player.hand.cardIds.length,
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      stepText: '可以将2张手牌放置入休息室。如此做时，检视自己卡组顶的3张卡。',
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: DISCARD_COUNT,
      maxSelectableCards: DISCARD_COUNT,
      selectionLabel: '选择要放置入休息室的2张手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_TWO',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishDiscardCost(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getNozomiEffect(game, SELECT_DISCARD_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }
  if (selectedCardIds.length === 0 && effect.canSkipSelection === true) {
    return finishActiveEffect(game, effect, continuePendingCardEffects, {
      step: 'DECLINE_DISCARD_COST',
    });
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    uniqueSelectedCardIds.length !== DISCARD_COUNT ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    { count: DISCARD_COUNT, candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }
  const inspection = inspectTopCards(discardResult.gameState, player.id, {
    count: INSPECT_COUNT,
    viewerPlayerId: player.id,
  });
  if (!inspection) {
    return game;
  }

  if (inspection.inspectedCardIds.length !== INSPECT_COUNT) {
    const restoreResult = moveInspectedCardsToDeckTopRestToWaitingRoomAndEnqueueTriggers(
      inspection.gameState,
      player.id,
      inspection.inspectedCardIds,
      inspection.inspectedCardIds,
      [],
      enqueueTriggeredCardEffects
    );
    if (!restoreResult) {
      return game;
    }
    return finishActiveEffect(restoreResult.gameState, effect, continuePendingCardEffects, {
      step: 'INSUFFICIENT_CARDS_TO_INSPECT_THREE',
      discardedHandCardIds: discardResult.discardedCardIds,
      inspectedCardIds: inspection.inspectedCardIds,
      returnedToDeckTopCardIds: restoreResult.deckTopCardIds,
    });
  }

  return addAction(
    {
      ...inspection.gameState,
      activeEffect: {
        ...effect,
        stepId: SELECT_HAND_DESTINATION_STEP_ID,
        stepText: '请选择检视的3张卡片中的1张加入手牌。',
        inspectionCardIds: inspection.inspectedCardIds,
        selectableCardIds: inspection.inspectedCardIds,
        selectableCardMode: 'SINGLE',
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: '选择加入手牌的卡片',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedHandCardIds: discardResult.discardedCardIds,
        },
      },
    },
    'PAY_COST',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_TWO_START_INSPECTION',
      discardedHandCardIds: discardResult.discardedCardIds,
      inspectedCardIds: inspection.inspectedCardIds,
    }
  );
}

function selectHandDestination(game: GameState, selectedCardId: string | null): GameState {
  const effect = getNozomiEffect(game, SELECT_HAND_DESTINATION_STEP_ID);
  if (
    !effect ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !game.inspectionZone.cardIds.includes(selectedCardId)
  ) {
    return game;
  }
  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const remainingCardIds = inspectedCardIds.filter((cardId) => cardId !== selectedCardId);
  if (inspectedCardIds.length !== INSPECT_COUNT || remainingCardIds.length !== 2) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_DECK_TOP_DESTINATION_STEP_ID,
        stepText: '请选择剩余2张卡片中的1张放置于卡组顶；另一张放置入休息室。',
        selectableCardIds: remainingCardIds,
        selectionLabel: '选择放置于卡组顶的卡片',
        confirmSelectionLabel: '放置于卡组顶',
        metadata: { ...effect.metadata, handCardId: selectedCardId },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_HAND_DESTINATION',
      handCardId: selectedCardId,
      remainingCardIds,
    }
  );
}

function finishPartition(
  game: GameState,
  selectedDeckTopCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getNozomiEffect(game, SELECT_DECK_TOP_DESTINATION_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const handCardId =
    typeof effect?.metadata?.handCardId === 'string' ? effect.metadata.handCardId : null;
  const inspectedCardIds = effect?.inspectionCardIds ?? [];
  if (
    !effect ||
    !player ||
    !handCardId ||
    !selectedDeckTopCardId ||
    inspectedCardIds.length !== INSPECT_COUNT ||
    effect.selectableCardIds?.includes(selectedDeckTopCardId) !== true ||
    !inspectedCardIds.includes(handCardId) ||
    inspectedCardIds.some((cardId) => !game.inspectionZone.cardIds.includes(cardId))
  ) {
    return game;
  }
  const waitingRoomCardIds = inspectedCardIds.filter(
    (cardId) => cardId !== handCardId && cardId !== selectedDeckTopCardId
  );
  if (waitingRoomCardIds.length !== 1) {
    return game;
  }

  const partitionResult = partitionInspectedCardsToHandDeckTopWaitingRoomAndEnqueueTriggers(
    { ...game, activeEffect: null },
    player.id,
    inspectedCardIds,
    [handCardId],
    [selectedDeckTopCardId],
    waitingRoomCardIds,
    enqueueTriggeredCardEffects
  );
  if (!partitionResult) {
    return game;
  }
  return continuePendingCardEffects(
    addAction(partitionResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PARTITION_INSPECTED_TOP_THREE',
      discardedHandCardIds: getStringArrayMetadata(effect, 'discardedHandCardIds'),
      inspectedCardIds,
      handCardIds: partitionResult.handCardIds,
      deckTopCardIds: partitionResult.deckTopCardIds,
      waitingRoomCardIds: partitionResult.waitingRoomCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getNozomiEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId === PL_BP3_007_LIVE_START_DISCARD_TWO_PARTITION_TOP_THREE_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function finishActiveEffect(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
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

function consumePending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
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
      ...payload,
    }),
    orderedResolution
  );
}

function getStringArrayMetadata(effect: ActiveEffectState, key: string): readonly string[] {
  const value = effect.metadata?.[key];
  return Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string')
    ? value
    : [];
}
