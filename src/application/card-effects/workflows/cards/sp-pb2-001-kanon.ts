import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  emitGameEvent,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  createEnterStageEvent,
  type EnterStageEvent,
  type EnterWaitingRoomEvent,
} from '../../../../domain/events/game-events.js';
import {
  CardType,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { inspectTopCards } from '../../../effects/look-top.js';
import {
  and,
  costLte,
  groupAliasIs,
  typeIs,
} from '../../../effects/card-selectors.js';
import { SP_PB2_001_ON_ENTER_DISCARD_LOOK_TOP_LOW_COST_LIELLA_MEMBER_PLAY_OR_HAND_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import {
  moveInspectedCardsToWaitingRoomAndEnqueueTriggers,
  moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers,
  moveInspectedSelectionToStageRestToWaitingRoomAndEnqueueTriggers,
} from '../../runtime/inspection-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID = 'SP_PB2_001_SELECT_DISCARD';
const SELECT_INSPECTED_MEMBER_STEP_ID = 'SP_PB2_001_SELECT_LOW_COST_LIELLA_MEMBER';
const SELECT_DESTINATION_STEP_ID = 'SP_PB2_001_SELECT_DESTINATION';
const SELECT_EMPTY_SLOT_STEP_ID = 'SP_PB2_001_SELECT_EMPTY_SLOT';

const DESTINATION_HAND_OPTION_ID = 'hand';
const DESTINATION_STAGE_OPTION_ID = 'stage';

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
  }
) => GameState;

const lowCostLiellaMemberSelector = and(
  typeIs(CardType.MEMBER),
  groupAliasIs('Liella!'),
  costLte(4)
);

export function registerSpPb2001KanonWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_001_ON_ENTER_DISCARD_LOOK_TOP_LOW_COST_LIELLA_MEMBER_PLAY_OR_HAND_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPb2001KanonOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_001_ON_ENTER_DISCARD_LOOK_TOP_LOW_COST_LIELLA_MEMBER_PLAY_OR_HAND_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? startInspectionAfterDiscard(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_DISCARD_LOOK_TOP',
          })
  );
  registerActiveEffectStepHandler(
    SP_PB2_001_ON_ENTER_DISCARD_LOOK_TOP_LOW_COST_LIELLA_MEMBER_PLAY_OR_HAND_ABILITY_ID,
    SELECT_INSPECTED_MEMBER_STEP_ID,
    (game, input, context) =>
      finishInspectedMemberSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_001_ON_ENTER_DISCARD_LOOK_TOP_LOW_COST_LIELLA_MEMBER_PLAY_OR_HAND_ABILITY_ID,
    SELECT_DESTINATION_STEP_ID,
    (game, input, context) =>
      finishDestinationSelection(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_001_ON_ENTER_DISCARD_LOOK_TOP_LOW_COST_LIELLA_MEMBER_PLAY_OR_HAND_ABILITY_ID,
    SELECT_EMPTY_SLOT_STEP_ID,
    (game, input, context) =>
      finishPlaySelectedMemberToSlot(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startSpPb2001KanonOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds.filter((cardId) => cardId !== ability.sourceCardId);
  if (selectableCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_OP_NO_HAND_TO_DISCARD',
      },
      continuePendingCardEffects
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
        ability,
        playerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_DISCARD_STEP_ID,
        selectableCardIds,
        orderedResolution,
        stepText: '可以将1张手牌放置入休息室。若如此做，检视自己卡组顶5张卡。',
        selectionLabel: '选择要放置入休息室的手牌',
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
    }
  );
}

function startInspectionAfterDiscard(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
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
    { candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const inspection = inspectTopCards(discardResult.gameState, player.id, {
    count: 5,
    selectablePredicate: lowCostLiellaMemberSelector,
  });
  if (!inspection) {
    return game;
  }

  if (inspection.inspectedCardIds.length === 0 || inspection.selectableCardIds.length === 0) {
    const moveResult = moveInspectedCardsToWaitingRoomAndEnqueueTriggers(
      inspection.gameState,
      player.id,
      inspection.inspectedCardIds,
      enqueueTriggeredCardEffects
    );
    if (!moveResult) {
      return game;
    }
    return continuePendingCardEffects(
      addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step:
          inspection.inspectedCardIds.length === 0
            ? 'NO_TOP_CARDS_AFTER_DISCARD'
            : 'NO_LOW_COST_LIELLA_MEMBER_TARGET',
        discardCardId,
        inspectedCardIds: inspection.inspectedCardIds,
        waitingRoomCardIds: moveResult.waitingRoomCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...inspection.gameState,
      activeEffect: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: effect.effectText,
        stepId: SELECT_INSPECTED_MEMBER_STEP_ID,
        stepText:
          '请选择至多1张费用4以下的『Liella!』成员卡公开。可以不公开，将检视的卡全部放置入休息室。',
        awaitingPlayerId: player.id,
        inspectionCardIds: inspection.inspectedCardIds,
        selectableCardIds: inspection.selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要公开的低费用 Liella! 成员',
        confirmSelectionLabel: '公开',
        canSkipSelection: true,
        skipSelectionLabel: '不公开',
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          discardCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_INSPECTION',
      discardCardId,
      inspectedCardIds: inspection.inspectedCardIds,
      selectableCardIds: inspection.selectableCardIds,
    }
  );
}

function finishInspectedMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_INSPECTED_MEMBER_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const inspectedCardIds = effect.inspectionCardIds ?? [];

  if (selectedCardId === null) {
    const moveResult = moveInspectedCardsToWaitingRoomAndEnqueueTriggers(
      game,
      player.id,
      inspectedCardIds,
      enqueueTriggeredCardEffects
    );
    if (!moveResult) {
      return game;
    }
    return continuePendingCardEffects(
      addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_SELECTION_MOVE_INSPECTED_TO_WAITING_ROOM',
        inspectedCardIds,
        waitingRoomCardIds: moveResult.waitingRoomCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const emptySlots = getEmptyMemberSlots(game, player.id);
  const revealedCardIds = game.inspectionZone.revealedCardIds.includes(selectedCardId)
    ? game.inspectionZone.revealedCardIds
    : [...game.inspectionZone.revealedCardIds, selectedCardId];
  if (emptySlots.length === 0) {
    return moveSelectedInspectedMemberToHandAndFinish(
      {
        ...game,
        inspectionZone: {
          ...game.inspectionZone,
          revealedCardIds,
        },
      },
      effect,
      player.id,
      selectedCardId,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
      'ADD_SELECTED_MEMBER_TO_HAND_NO_EMPTY_SLOT'
    );
  }

  return addAction(
    {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        revealedCardIds,
      },
      activeEffect: {
        ...effect,
        stepId: SELECT_DESTINATION_STEP_ID,
        stepText: '请选择将公开的成员登场到空成员区，或加入手牌。',
        selectableCardIds: [selectedCardId],
        selectableCardVisibility: 'PUBLIC',
        selectableOptions: [
          { id: DESTINATION_STAGE_OPTION_ID, label: '登场到空成员区' },
          { id: DESTINATION_HAND_OPTION_ID, label: '加入手牌' },
        ],
        selectionLabel: undefined,
        confirmSelectionLabel: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedCardId,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_SELECTED_LOW_COST_LIELLA_MEMBER',
      selectedCardId,
      emptySlots,
    }
  );
}

function finishDestinationSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_DESTINATION_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedCardId =
    typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
  if (
    !player ||
    !selectedCardId ||
    !selectedOptionId ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  if (selectedOptionId === DESTINATION_HAND_OPTION_ID) {
    return moveSelectedInspectedMemberToHandAndFinish(
      game,
      effect,
      player.id,
      selectedCardId,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
      'ADD_SELECTED_MEMBER_TO_HAND'
    );
  }

  if (selectedOptionId !== DESTINATION_STAGE_OPTION_ID) {
    return game;
  }

  const emptySlots = getEmptyMemberSlots(game, player.id);
  if (emptySlots.length === 0) {
    return moveSelectedInspectedMemberToHandAndFinish(
      game,
      effect,
      player.id,
      selectedCardId,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
      'ADD_SELECTED_MEMBER_TO_HAND_NO_EMPTY_SLOT'
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_EMPTY_SLOT_STEP_ID,
        stepText: '请选择要让公开的成员登场的空成员区。',
        selectableCardIds: [selectedCardId],
        selectableOptions: undefined,
        selectableSlots: emptySlots,
        selectionLabel: '选择空成员区',
        confirmSelectionLabel: '登场',
        metadata: {
          ...effect.metadata,
          selectedDestination: DESTINATION_STAGE_OPTION_ID,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_EMPTY_SLOT',
      selectedCardId,
      emptySlots,
    }
  );
}

function finishPlaySelectedMemberToSlot(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== SELECT_EMPTY_SLOT_STEP_ID ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedCardId =
    typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
  if (!player || !selectedCardId) {
    return game;
  }

  const playResult = playInspectedMemberToEmptySlot(
    game,
    player.id,
    selectedCardId,
    selectedSlot,
    enqueueTriggeredCardEffects
  );
  if (!playResult) {
    return game;
  }
  const stateWithResolve = addAction(
    {
      ...playResult.gameState,
      activeEffect: null,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLAY_SELECTED_MEMBER_TO_EMPTY_SLOT',
      selectedCardId,
      toSlot: selectedSlot,
      inspectedCardIds: effect.inspectionCardIds ?? [],
      waitingRoomCardIds: playResult.waitingRoomCardIds,
    }
  );
  const stateWithOnEnter = enqueueTriggeredCardEffects(
    stateWithResolve,
    [TriggerCondition.ON_ENTER_STAGE],
    {
      enterStageEvents: getNewEnterStageEvents(game, playResult.gameState),
    }
  );

  return continuePendingCardEffects(
    stateWithOnEnter,
    effect.metadata?.orderedResolution === true
  );
}

function moveSelectedInspectedMemberToHandAndFinish(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  step: string
): GameState {
  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const moveResult = moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers(
    game,
    playerId,
    inspectedCardIds,
    selectedCardId,
    enqueueTriggeredCardEffects
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      selectedCardId,
      inspectedCardIds,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function playInspectedMemberToEmptySlot(
  game: GameState,
  playerId: string,
  selectedCardId: string,
  selectedSlot: SlotPosition,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): { readonly gameState: GameState; readonly waitingRoomCardIds: readonly string[] } | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, selectedCardId);
  if (
    !player ||
    !card ||
    card.ownerId !== player.id ||
    !isMemberCardData(card.data) ||
    player.memberSlots.slots[selectedSlot] !== null ||
    !game.inspectionZone.cardIds.includes(selectedCardId)
  ) {
    return null;
  }

  const inspectedCardIds = game.activeEffect?.inspectionCardIds ?? [];
  if (!inspectedCardIds.includes(selectedCardId)) {
    return null;
  }
  const moveResult = moveInspectedSelectionToStageRestToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    inspectedCardIds,
    selectedCardId,
    selectedSlot,
    enqueueTriggeredCardEffects
  );
  if (!moveResult) {
    return null;
  }
  const state = emitGameEvent(
    moveResult.gameState,
    createEnterStageEvent(
      selectedCardId,
      ZoneType.INSPECTION_ZONE,
      selectedSlot,
      card.ownerId,
      player.id
    )
  );
  return { gameState: state, waitingRoomCardIds: moveResult.waitingRoomCardIds };
}

function getEmptyMemberSlots(game: GameState, playerId: string): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}
