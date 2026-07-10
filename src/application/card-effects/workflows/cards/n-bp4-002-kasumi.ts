import {
  addAction,
  getOpponent,
  getPlayerById,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { clearInspectionCards, inspectTopCards } from '../../../effects/look-top.js';
import { PL_N_BP4_002_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_OPTIONAL_WAITING_ROOM_ABILITY_ID } from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveInspectedCardsToWaitingRoomAndEnqueueTriggers } from '../../runtime/inspection-waiting-room-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const CHOOSE_DECK_OWNER_STEP_ID = 'N_BP4_002_CHOOSE_DECK_OWNER';
const LOOK_TOP_OPTION_STEP_ID = 'N_BP4_002_LOOK_TOP_OPTIONAL_WAITING_ROOM';
const PLACE_WAITING_ROOM_OPTION_ID = 'place-waiting-room';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp4002KasumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_002_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_OPTIONAL_WAITING_ROOM_ABILITY_ID,
    (game, ability, options, context) =>
      startKasumiChooseDeckOwner(game, ability, options, context.continuePendingCardEffects)
  );

  registerActiveEffectStepHandler(
    PL_N_BP4_002_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_OPTIONAL_WAITING_ROOM_ABILITY_ID,
    CHOOSE_DECK_OWNER_STEP_ID,
    (game, input, context) =>
      finishKasumiDeckOwnerSelection(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );

  registerActiveEffectStepHandler(
    PL_N_BP4_002_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_OPTIONAL_WAITING_ROOM_ABILITY_ID,
    LOOK_TOP_OPTION_STEP_ID,
    (game, input, context) =>
      finishKasumiLookTopOption(
        game,
        input.selectedOptionId ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startKasumiChooseDeckOwner(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const controller = getPlayerById(game, ability.controllerId);
  if (!controller) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (!isSourceOnOwnStage(stateWithoutPending, controller.id, ability.sourceCardId)) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', controller.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: ability.sourceSlot,
        step: 'SOURCE_NOT_ON_STAGE',
      }),
      options.orderedResolution === true
    );
  }

  return addAction(
    {
      ...stateWithoutPending,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: CHOOSE_DECK_OWNER_STEP_ID,
        stepText: '选择要查看卡组顶的玩家。',
        awaitingPlayerId: controller.id,
        selectableOptions: [
          { id: 'self', label: '自己' },
          { id: 'opponent', label: '对方' },
        ],
        metadata: {
          orderedResolution: options.orderedResolution === true,
          sourceSlot: ability.sourceSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    controller.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_CHOOSE_DECK_OWNER',
    }
  );
}

function finishKasumiDeckOwnerSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getKasumiActiveEffect(game, CHOOSE_DECK_OWNER_STEP_ID);
  if (!effect || (selectedOptionId !== 'self' && selectedOptionId !== 'opponent')) {
    return game;
  }

  const controller = getPlayerById(game, effect.controllerId);
  if (!controller) {
    return game;
  }

  const deckOwner = selectedOptionId === 'self' ? controller : getOpponent(game, controller.id);
  if (!deckOwner) {
    return game;
  }

  if (!isSourceOnOwnStage(game, controller.id, effect.sourceCardId)) {
    return resolveKasumiNoOp(game, {
      effect,
      playerId: controller.id,
      continuePendingCardEffects,
      step: 'SOURCE_NOT_ON_STAGE',
      payload: { selectedDeckOwnerId: deckOwner.id },
    });
  }

  const inspection = inspectTopCards(
    { ...game, activeEffect: null },
    deckOwner.id,
    selectedOptionId === 'opponent' ? { count: 1, viewerPlayerId: controller.id } : { count: 1 }
  );
  const inspectedCardId = inspection?.inspectedCardIds[0] ?? null;
  if (!inspection || !inspectedCardId) {
    return resolveKasumiNoOp(game, {
      effect,
      playerId: controller.id,
      continuePendingCardEffects,
      step: 'NO_TOP_CARD_TO_LOOK',
      payload: { selectedDeckOwnerId: deckOwner.id },
    });
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
        stepId: LOOK_TOP_OPTION_STEP_ID,
        stepText: '查看所选玩家卡组顶1张卡。可以将该卡放置入休息室。',
        awaitingPlayerId: controller.id,
        inspectionCardIds: inspection.inspectedCardIds,
        selectableOptions: [{ id: PLACE_WAITING_ROOM_OPTION_ID, label: '放置入休息室' }],
        canSkipSelection: true,
        skipSelectionLabel: '不放置',
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          deckOwnerId: deckOwner.id,
          sourceSlot: effect.metadata?.sourceSlot,
        },
      },
    },
    'RESOLVE_ABILITY',
    controller.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'START_LOOK_TOP_ONE_OPTIONAL_WAITING_ROOM',
      selectedDeckOwnerId: deckOwner.id,
      inspectedCardIds: inspection.inspectedCardIds,
    }
  );
}

function finishKasumiLookTopOption(
  game: GameState,
  selectedOptionId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getKasumiActiveEffect(game, LOOK_TOP_OPTION_STEP_ID);
  if (!effect) {
    return game;
  }

  const controller = getPlayerById(game, effect.controllerId);
  const deckOwnerId = typeof effect.metadata?.deckOwnerId === 'string' ? effect.metadata.deckOwnerId : null;
  const inspectedCardId = effect.inspectionCardIds?.[0] ?? null;
  if (
    !controller ||
    !deckOwnerId ||
    !inspectedCardId ||
    !game.inspectionZone.cardIds.includes(inspectedCardId)
  ) {
    return game;
  }

  const placeInWaitingRoom = selectedOptionId === PLACE_WAITING_ROOM_OPTION_ID;
  if (selectedOptionId !== null && !placeInWaitingRoom) {
    return game;
  }

  const stateAfterMove = placeInWaitingRoom
    ? (moveInspectedCardsToWaitingRoomAndEnqueueTriggers(
        game,
        deckOwnerId,
        [inspectedCardId],
        enqueueTriggeredCardEffects
      )?.gameState ?? null)
    : returnInspectedTopCardToDeckTop(game, deckOwnerId, inspectedCardId);
  if (!stateAfterMove) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...stateAfterMove, activeEffect: null }, 'RESOLVE_ABILITY', controller.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: placeInWaitingRoom ? 'PLACE_INSPECTED_TOP_CARD_TO_WAITING_ROOM' : 'KEEP_TOP_CARD',
      deckOwnerId,
      inspectedCardId,
      waitingRoomCardIds: placeInWaitingRoom ? [inspectedCardId] : [],
      returnedToDeckTop: !placeInWaitingRoom,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getKasumiActiveEffect(game: GameState, stepId: string) {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP4_002_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_OPTIONAL_WAITING_ROOM_ABILITY_ID ||
    effect.stepId !== stepId
  ) {
    return null;
  }
  return effect;
}

function resolveKasumiNoOp(
  game: GameState,
  config: {
    readonly effect: NonNullable<GameState['activeEffect']>;
    readonly playerId: string;
    readonly continuePendingCardEffects: ContinuePendingCardEffects;
    readonly step: string;
    readonly payload?: Readonly<Record<string, unknown>>;
  }
): GameState {
  return config.continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', config.playerId, {
      pendingAbilityId: config.effect.id,
      abilityId: config.effect.abilityId,
      sourceCardId: config.effect.sourceCardId,
      sourceSlot: config.effect.metadata?.sourceSlot,
      step: config.step,
      ...(config.payload ?? {}),
    }),
    config.effect.metadata?.orderedResolution === true
  );
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

function isSourceOnOwnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }

  return Object.values(player.memberSlots.slots).includes(sourceCardId);
}
