import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { EnterStageEvent } from '../../../../domain/events/game-events.js';
import {
  CardType,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { PL_PB1_018_ON_ENTER_BOTH_PLAY_LOW_COST_MEMBERS_WAITING_ABILITY_ID } from '../../ability-ids.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { and, costLte, typeIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { playMembersFromWaitingRoomToEmptySlots } from '../../../effects/member-state.js';

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const NICO_SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'PL_PB1_018_SELECT_WAITING_ROOM_LOW_COST_MEMBER';
const NICO_SELECT_EMPTY_STAGE_SLOT_STEP_ID = 'PL_PB1_018_SELECT_EMPTY_STAGE_SLOT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
  }
) => GameState;

interface NicoWorkflowContext {
  readonly pendingAbilityId: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly orderedResolution: boolean;
}

export interface PlPb1018NicoWorkflowDependencies {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}

export function registerPlPb1018NicoWorkflowHandlers(
  dependencies: PlPb1018NicoWorkflowDependencies
): void {
  registerPendingAbilityStarterHandler(
    PL_PB1_018_ON_ENTER_BOTH_PLAY_LOW_COST_MEMBERS_WAITING_ABILITY_ID,
    (game, ability, options, context) =>
      startPlPb1018NicoOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        dependencies
      )
  );
  registerActiveEffectStepHandler(
    PL_PB1_018_ON_ENTER_BOTH_PLAY_LOW_COST_MEMBERS_WAITING_ABILITY_ID,
    NICO_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    (game, input, context) =>
      startPlPb1018NicoSelectEmptySlot(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        dependencies
      )
  );
  registerActiveEffectStepHandler(
    PL_PB1_018_ON_ENTER_BOTH_PLAY_LOW_COST_MEMBERS_WAITING_ABILITY_ID,
    NICO_SELECT_EMPTY_STAGE_SLOT_STEP_ID,
    (game, input, context) =>
      finishPlPb1018NicoSelectEmptySlot(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        dependencies
      )
  );
}

function startPlPb1018NicoOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  dependencies: PlPb1018NicoWorkflowDependencies
): GameState {
  const playerIds = getNicoProcessingPlayerIds(game, ability.controllerId);
  const workflow: NicoWorkflowContext = {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    controllerId: ability.controllerId,
    orderedResolution,
  };
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: null,
  };

  return processNextNicoPlayer(
    stateWithoutPending,
    workflow,
    playerIds,
    continuePendingCardEffects,
    dependencies
  );
}

function processNextNicoPlayer(
  game: GameState,
  workflow: NicoWorkflowContext,
  playerIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  dependencies: PlPb1018NicoWorkflowDependencies
): GameState {
  const [currentPlayerId, ...remainingPlayerIds] = playerIds;
  if (!currentPlayerId) {
    return continuePendingCardEffects(
      { ...game, activeEffect: null },
      workflow.orderedResolution
    );
  }

  const player = getPlayerById(game, currentPlayerId);
  if (!player) {
    return skipCurrentNicoPlayer(
      game,
      workflow,
      currentPlayerId,
      remainingPlayerIds,
      'PLAYER_NOT_FOUND',
      continuePendingCardEffects,
      dependencies
    );
  }

  const selectableCardIds = getNicoWaitingRoomCandidates(game, currentPlayerId);
  const emptySlots = getEmptyMemberSlots(game, currentPlayerId);
  if (selectableCardIds.length === 0 || emptySlots.length === 0) {
    return skipCurrentNicoPlayer(
      game,
      workflow,
      currentPlayerId,
      remainingPlayerIds,
      selectableCardIds.length === 0 ? 'NO_LOW_COST_MEMBER' : 'NO_EMPTY_STAGE_SLOT',
      continuePendingCardEffects,
      dependencies,
      { selectableCardIds, emptySlots }
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: workflow.pendingAbilityId,
        abilityId: workflow.abilityId,
        sourceCardId: workflow.sourceCardId,
        controllerId: workflow.controllerId,
        effectText: getAbilityEffectText(
          PL_PB1_018_ON_ENTER_BOTH_PLAY_LOW_COST_MEMBERS_WAITING_ABILITY_ID
        ),
        stepId: NICO_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
        stepText: '请选择自己的休息室中1张费用小于等于2的成员卡。',
        awaitingPlayerId: currentPlayerId,
        selectableCardIds,
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择要从休息室登场的成员',
        confirmSelectionLabel: '确认选择',
        canSkipSelection: false,
        metadata: {
          orderedResolution: workflow.orderedResolution,
          currentPlayerId,
          remainingPlayerIds,
          selectableCardIds,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    currentPlayerId,
    {
      pendingAbilityId: workflow.pendingAbilityId,
      abilityId: workflow.abilityId,
      sourceCardId: workflow.sourceCardId,
      step: 'SELECT_WAITING_ROOM_LOW_COST_MEMBER',
      currentPlayerId,
      remainingPlayerIds,
      selectableCardIds,
      emptySlots,
    }
  );
}

function startPlPb1018NicoSelectEmptySlot(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  dependencies: PlPb1018NicoWorkflowDependencies
): GameState {
  const effect = game.activeEffect;
  const workflow = getNicoWorkflowContextFromActiveEffect(game);
  const currentPlayerId = getNicoCurrentPlayerId(game);
  const remainingPlayerIds = getNicoRemainingPlayerIds(game);
  if (!effect || !workflow || !currentPlayerId) {
    return game;
  }

  const selectableCardIds = getNicoWaitingRoomCandidates(game, currentPlayerId);
  const selectedIsValid =
    selectedCardId !== null &&
    selectableCardIds.includes(selectedCardId) &&
    effect.selectableCardIds?.includes(selectedCardId) === true;
  if (!selectedIsValid) {
    return skipCurrentNicoPlayer(
      { ...game, activeEffect: null },
      workflow,
      currentPlayerId,
      remainingPlayerIds,
      selectableCardIds.length === 0 ? 'NO_TARGET' : 'TARGET_LOST',
      continuePendingCardEffects,
      dependencies,
      { selectedCardId, selectableCardIds }
    );
  }

  const emptySlots = getEmptyMemberSlots(game, currentPlayerId);
  if (emptySlots.length === 0) {
    return skipCurrentNicoPlayer(
      { ...game, activeEffect: null },
      workflow,
      currentPlayerId,
      remainingPlayerIds,
      'NO_EMPTY_STAGE_SLOT',
      continuePendingCardEffects,
      dependencies,
      { selectedCardId, selectableCardIds, emptySlots }
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: NICO_SELECT_EMPTY_STAGE_SLOT_STEP_ID,
        stepText: '请选择该成员要登场的空成员区。',
        awaitingPlayerId: currentPlayerId,
        selectableCardIds: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectableSlots: emptySlots,
        selectionLabel: '选择登场槽位',
        confirmSelectionLabel: '登场',
        metadata: {
          ...effect.metadata,
          currentPlayerId,
          remainingPlayerIds,
          selectedWaitingRoomCardId: selectedCardId,
          selectableCardIds,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    currentPlayerId,
    {
      pendingAbilityId: workflow.pendingAbilityId,
      abilityId: workflow.abilityId,
      sourceCardId: workflow.sourceCardId,
      step: 'SELECT_EMPTY_STAGE_SLOT',
      currentPlayerId,
      selectedCardId,
      emptySlots,
    }
  );
}

function finishPlPb1018NicoSelectEmptySlot(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  dependencies: PlPb1018NicoWorkflowDependencies
): GameState {
  const workflow = getNicoWorkflowContextFromActiveEffect(game);
  const currentPlayerId = getNicoCurrentPlayerId(game);
  const remainingPlayerIds = getNicoRemainingPlayerIds(game);
  const selectedCardId = getNicoSelectedWaitingRoomCardId(game);
  if (!workflow || !currentPlayerId) {
    return game;
  }
  if (selectedSlot === null) {
    return game;
  }

  const selectableCardIds = getNicoWaitingRoomCandidates(game, currentPlayerId);
  const emptySlots = getEmptyMemberSlots(game, currentPlayerId);
  const selectedCardStillValid =
    selectedCardId !== null && selectableCardIds.includes(selectedCardId);
  const selectedSlotStillValid = emptySlots.includes(selectedSlot);
  if (!selectedCardStillValid || !selectedSlotStillValid) {
    return skipCurrentNicoPlayer(
      { ...game, activeEffect: null },
      workflow,
      currentPlayerId,
      remainingPlayerIds,
      !selectedCardStillValid ? 'TARGET_LOST' : 'NO_EMPTY_STAGE_SLOT',
      continuePendingCardEffects,
      dependencies,
      { selectedCardId, selectedSlot, selectableCardIds, emptySlots }
    );
  }

  const playResult = playMembersFromWaitingRoomToEmptySlots(
    game,
    currentPlayerId,
    [{ cardId: selectedCardId, toSlot: selectedSlot }],
    OrientationState.WAITING
  );
  if (!playResult) {
    return skipCurrentNicoPlayer(
      { ...game, activeEffect: null },
      workflow,
      currentPlayerId,
      remainingPlayerIds,
      'PLAY_FAILED',
      continuePendingCardEffects,
      dependencies,
      { selectedCardId, selectedSlot, selectableCardIds, emptySlots }
    );
  }

  const state = addAction(playResult.gameState, 'RESOLVE_ABILITY', currentPlayerId, {
    pendingAbilityId: workflow.pendingAbilityId,
    abilityId: workflow.abilityId,
    sourceCardId: workflow.sourceCardId,
    step: 'PLAY_LOW_COST_MEMBER_FROM_WAITING_ROOM',
    currentPlayerId,
    playedCardId: selectedCardId,
    toSlot: selectedSlot,
  });
  const stateWithOnEnter = dependencies.enqueueTriggeredCardEffects(
    state,
    [TriggerCondition.ON_ENTER_STAGE],
    {
      enterStageEvents: getNewEnterStageEvents(game, state),
    }
  );

  return processNextNicoPlayer(
    { ...stateWithOnEnter, activeEffect: null },
    workflow,
    remainingPlayerIds,
    continuePendingCardEffects,
    dependencies
  );
}

function skipCurrentNicoPlayer(
  game: GameState,
  workflow: NicoWorkflowContext,
  currentPlayerId: string,
  remainingPlayerIds: readonly string[],
  reason: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  dependencies: PlPb1018NicoWorkflowDependencies,
  extraPayload: Readonly<Record<string, unknown>> = {}
): GameState {
  const state = addAction(
    { ...game, activeEffect: null },
    'RESOLVE_ABILITY',
    currentPlayerId,
    {
      pendingAbilityId: workflow.pendingAbilityId,
      abilityId: workflow.abilityId,
      sourceCardId: workflow.sourceCardId,
      step: 'SKIP_PLAYER',
      currentPlayerId,
      reason,
      ...extraPayload,
    }
  );
  return processNextNicoPlayer(
    state,
    workflow,
    remainingPlayerIds,
    continuePendingCardEffects,
    dependencies
  );
}

function getNicoProcessingPlayerIds(game: GameState, controllerId: string): readonly string[] {
  const playerIds = game.players.map((player) => player.id);
  return [
    controllerId,
    ...playerIds.filter((playerId) => playerId !== controllerId),
  ].filter((playerId, index, allPlayerIds) => allPlayerIds.indexOf(playerId) === index);
}

function getNicoWaitingRoomCandidates(game: GameState, playerId: string): readonly string[] {
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    and(typeIs(CardType.MEMBER), costLte(2))
  );
}

function getEmptyMemberSlots(game: GameState, playerId: string): SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}

function getNicoWorkflowContextFromActiveEffect(game: GameState): NicoWorkflowContext | null {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_PB1_018_ON_ENTER_BOTH_PLAY_LOW_COST_MEMBERS_WAITING_ABILITY_ID
  ) {
    return null;
  }
  return {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    orderedResolution: effect.metadata?.orderedResolution === true,
  };
}

function getNicoCurrentPlayerId(game: GameState): string | null {
  const playerId = game.activeEffect?.metadata?.currentPlayerId;
  return typeof playerId === 'string' ? playerId : null;
}

function getNicoSelectedWaitingRoomCardId(game: GameState): string | null {
  const cardId = game.activeEffect?.metadata?.selectedWaitingRoomCardId;
  return typeof cardId === 'string' ? cardId : null;
}

function getNicoRemainingPlayerIds(game: GameState): readonly string[] {
  const playerIds = game.activeEffect?.metadata?.remainingPlayerIds;
  return Array.isArray(playerIds)
    ? playerIds.filter((playerId): playerId is string => typeof playerId === 'string')
    : [];
}
