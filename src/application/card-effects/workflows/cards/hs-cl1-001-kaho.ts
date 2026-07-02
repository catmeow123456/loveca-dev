import {
  addAction,
  emitGameEvent,
  getPlayerById,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { createEnterWaitingRoomEvent } from '../../../../domain/events/game-events.js';
import { TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { clearInspectionCards, inspectTopCards } from '../../../effects/look-top.js';
import { HS_CL1_001_LIVE_START_LOOK_TOP_ONE_OPTIONAL_WAITING_ROOM_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const LOOK_TOP_OPTION_STEP_ID = 'HS_CL1_001_LOOK_TOP_ONE_OPTIONAL_WAITING_ROOM';
const PLACE_WAITING_ROOM_OPTION_ID = 'place-waiting-room';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterWaitingRoomEvents?: readonly ReturnType<typeof createEnterWaitingRoomEvent>[];
  }
) => GameState;

export function registerHsCl1001KahoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    HS_CL1_001_LIVE_START_LOOK_TOP_ONE_OPTIONAL_WAITING_ROOM_ABILITY_ID,
    (game, ability, options, context) =>
      startHsCl1001KahoLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_CL1_001_LIVE_START_LOOK_TOP_ONE_OPTIONAL_WAITING_ROOM_ABILITY_ID,
    LOOK_TOP_OPTION_STEP_ID,
    (game, input, context) =>
      finishHsCl1001KahoLiveStart(
        game,
        input.selectedOptionId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startHsCl1001KahoLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const inspection = inspectTopCards(stateWithoutPending, player.id, { count: 1 });
  const inspectedCardId = inspection?.inspectedCardIds[0] ?? null;
  if (!inspection || !inspectedCardId) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: ability.sourceSlot,
        step: 'NO_TOP_CARD_TO_LOOK',
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...inspection.gameState,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: LOOK_TOP_OPTION_STEP_ID,
        stepText: '查看卡组顶1张卡。可以将该卡放置入休息室。',
        awaitingPlayerId: player.id,
        inspectionCardIds: inspection.inspectedCardIds,
        selectableOptions: [{ id: PLACE_WAITING_ROOM_OPTION_ID, label: '放置入休息室' }],
        canSkipSelection: true,
        skipSelectionLabel: '不放置',
        metadata: {
          orderedResolution,
          eventIds: ability.eventIds,
          timingId: ability.timingId,
          sourceSlot: ability.sourceSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_LOOK_TOP_ONE_OPTIONAL_WAITING_ROOM',
      inspectedCardIds: inspection.inspectedCardIds,
    }
  );
}

function finishHsCl1001KahoLiveStart(
  game: GameState,
  selectedOptionId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_CL1_001_LIVE_START_LOOK_TOP_ONE_OPTIONAL_WAITING_ROOM_ABILITY_ID ||
    effect.stepId !== LOOK_TOP_OPTION_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const inspectedCardId = effect.inspectionCardIds?.[0] ?? null;
  if (!player || !inspectedCardId || !game.inspectionZone.cardIds.includes(inspectedCardId)) {
    return game;
  }

  const placeInWaitingRoom = selectedOptionId === PLACE_WAITING_ROOM_OPTION_ID;
  if (selectedOptionId !== null && !placeInWaitingRoom) {
    return game;
  }

  const stateAfterMove = placeInWaitingRoom
    ? moveInspectedTopCardToWaitingRoom(game, player.id, inspectedCardId)
    : returnInspectedTopCardToDeckTop(game, player.id, inspectedCardId);
  if (!stateAfterMove) {
    return game;
  }

  const stateWithTriggers = placeInWaitingRoom
    ? enqueueEnterWaitingRoomTrigger(stateAfterMove, player.id, inspectedCardId, enqueueTriggeredCardEffects)
    : stateAfterMove;

  return continuePendingCardEffects(
    addAction({ ...stateWithTriggers, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: placeInWaitingRoom ? 'PLACE_INSPECTED_TOP_CARD_TO_WAITING_ROOM' : 'KEEP_TOP_CARD',
      inspectedCardId,
      waitingRoomCardIds: placeInWaitingRoom ? [inspectedCardId] : [],
      returnedToDeckTop: !placeInWaitingRoom,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function moveInspectedTopCardToWaitingRoom(
  game: GameState,
  playerId: string,
  cardId: string
): GameState | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }

  const state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, cardId],
    },
  }));
  return clearInspectionCards(state, [cardId]);
}

function returnInspectedTopCardToDeckTop(
  game: GameState,
  playerId: string,
  cardId: string
): GameState | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }

  const state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: [cardId, ...currentPlayer.mainDeck.cardIds],
    },
  }));
  return clearInspectionCards(state, [cardId]);
}

function enqueueEnterWaitingRoomTrigger(
  game: GameState,
  playerId: string,
  cardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const enterWaitingRoomEvent = createEnterWaitingRoomEvent(
    [cardId],
    ZoneType.MAIN_DECK,
    playerId,
    playerId
  );
  return enqueueTriggeredCardEffects(
    emitGameEvent(game, enterWaitingRoomEvent),
    [TriggerCondition.ON_ENTER_WAITING_ROOM],
    { enterWaitingRoomEvents: [enterWaitingRoomEvent] }
  );
}
