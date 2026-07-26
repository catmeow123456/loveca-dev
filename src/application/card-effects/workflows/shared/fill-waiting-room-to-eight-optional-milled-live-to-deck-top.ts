import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { PR_FILL_WAITING_ROOM_TO_EIGHT_OPTIONAL_MILLED_LIVE_TO_DECK_TOP_ABILITY_ID } from '../../ability-ids.js';
import { moveWaitingRoomCardsToDeckTopAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const WAITING_ROOM_TARGET_COUNT = 8;
const SELECT_MILLED_LIVE_TO_DECK_TOP_STEP_ID =
  'PR_FILL_WAITING_ROOM_TO_EIGHT_SELECT_MILLED_LIVE_TO_DECK_TOP';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerFillWaitingRoomToEightOptionalMilledLiveToDeckTopWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PR_FILL_WAITING_ROOM_TO_EIGHT_OPTIONAL_MILLED_LIVE_TO_DECK_TOP_ABILITY_ID,
    (game, ability, options, context) =>
      startFillWaitingRoomToEightOptionalMilledLiveToDeckTop(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PR_FILL_WAITING_ROOM_TO_EIGHT_OPTIONAL_MILLED_LIVE_TO_DECK_TOP_ABILITY_ID,
    SELECT_MILLED_LIVE_TO_DECK_TOP_STEP_ID,
    (game, input, context) =>
      finishMilledLiveToDeckTopSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startFillWaitingRoomToEightOptionalMilledLiveToDeckTop(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  // The printed difference is fixed before the first move. A refresh may change the
  // waiting-room size while this direct mill resolves, but must not start another loop.
  const initialWaitingRoomCount = player.waitingRoom.cardIds.length;
  const fillCount = Math.max(0, WAITING_ROOM_TARGET_COUNT - initialWaitingRoomCount);
  if (fillCount === 0) {
    return finishWithoutSelection(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'WAITING_ROOM_ALREADY_AT_LEAST_EIGHT',
      initialWaitingRoomCount,
      fillCount,
      milledCardIds: [],
      refreshCount: 0,
    });
  }

  const millResult = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    player.id,
    fillCount,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      },
    }
  );
  if (!millResult) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...millResult.gameState,
    pendingAbilities: millResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  const currentWaitingRoomCardIdSet = new Set(
    getPlayerById(stateWithoutPending, player.id)?.waitingRoom.cardIds ?? []
  );
  const selectableCardIds = [...new Set(millResult.movedCardIds)].filter((cardId) => {
    const card = getCardById(stateWithoutPending, cardId);
    return (
      currentWaitingRoomCardIdSet.has(cardId) &&
      card?.ownerId === player.id &&
      isLiveCardData(card.data)
    );
  });

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'FILL_WAITING_ROOM_NO_MILLED_LIVE',
        initialWaitingRoomCount,
        fillCount,
        milledCardIds: millResult.movedCardIds,
        refreshCount: millResult.refreshCount,
      }),
      orderedResolution
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
        stepId: SELECT_MILLED_LIVE_TO_DECK_TOP_STEP_ID,
        stepText: '可以从因此放置入休息室的卡片中，选择1张LIVE卡放置于卡组顶。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择要放置于卡组顶的LIVE卡',
        confirmSelectionLabel: '放置于卡组顶',
        canSkipSelection: true,
        skipSelectionLabel: '不放置',
        metadata: {
          publicCardSelectionConfirmation: { destination: 'MAIN_DECK_TOP' },
          orderedResolution,
          sourceZone: ZoneType.WAITING_ROOM,
          destination: ZoneType.MAIN_DECK,
          initialWaitingRoomCount,
          fillCount,
          milledCardIds: millResult.movedCardIds,
          refreshCount: millResult.refreshCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'FILL_WAITING_ROOM_SELECT_MILLED_LIVE',
      initialWaitingRoomCount,
      fillCount,
      milledCardIds: millResult.movedCardIds,
      refreshCount: millResult.refreshCount,
      selectableCardIds,
    }
  );
}

function finishMilledLiveToDeckTopSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PR_FILL_WAITING_ROOM_TO_EIGHT_OPTIONAL_MILLED_LIVE_TO_DECK_TOP_ABILITY_ID ||
    effect.stepId !== SELECT_MILLED_LIVE_TO_DECK_TOP_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const orderedResolution = effect.metadata?.orderedResolution === true;
  const milledCardIds = getStringArrayMetadata(effect.metadata?.milledCardIds);

  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_MILLED_LIVE_TO_DECK_TOP',
        initialWaitingRoomCount: getNumberMetadata(effect.metadata?.initialWaitingRoomCount) ?? 0,
        fillCount: getNumberMetadata(effect.metadata?.fillCount) ?? 0,
        milledCardIds,
        refreshCount: getNumberMetadata(effect.metadata?.refreshCount) ?? 0,
      }),
      orderedResolution
    );
  }

  const selectedCard = getCardById(game, selectedCardId);
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !milledCardIds.includes(selectedCardId) ||
    !selectedCard ||
    selectedCard.ownerId !== player.id ||
    !isLiveCardData(selectedCard.data) ||
    !player.waitingRoom.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const moveResult = moveWaitingRoomCardsToDeckTopAndEnqueueTriggers(game, player.id, [selectedCardId], {
    candidateCardIds: effect.selectableCardIds,
    minCount: 1,
    maxCount: 1,
    cause: {
      kind: 'CARD_EFFECT',
      playerId: effect.controllerId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    },
  });
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_MILLED_LIVE_TO_DECK_TOP',
      selectedCardId,
      movedCardIds: moveResult.movedCardIds,
      initialWaitingRoomCount: getNumberMetadata(effect.metadata?.initialWaitingRoomCount) ?? 0,
      fillCount: getNumberMetadata(effect.metadata?.fillCount) ?? 0,
      milledCardIds,
      refreshCount: getNumberMetadata(effect.metadata?.refreshCount) ?? 0,
    }),
    orderedResolution
  );
}

function finishWithoutSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function getNumberMetadata(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
