import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID } from '../../ability-ids.js';
import { moveWaitingRoomCardsToDeckTopForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_WAITING_ROOM_CARD_TO_DECK_TOP_STEP_ID =
  'PL_N_BP4_021_SELECT_WAITING_ROOM_CARD_TO_DECK_TOP';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp4021RinaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID,
    (game, ability, options, context) =>
      startRinaWaitingRoomCardToDeckTop(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID,
    SELECT_WAITING_ROOM_CARD_TO_DECK_TOP_STEP_ID,
    (game, input, context) =>
      finishRinaWaitingRoomCardToDeckTopSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startRinaWaitingRoomCardToDeckTop(
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
  const selectableCardIds = player.waitingRoom.cardIds;
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_WAITING_ROOM_CARD',
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
        stepId: SELECT_WAITING_ROOM_CARD_TO_DECK_TOP_STEP_ID,
        stepText: '可以选择自己休息室1张卡放置于卡组顶。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择放置到卡组顶的休息室卡',
        confirmSelectionLabel: '放置到卡组顶',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          publicCardSelectionConfirmation: { destination: 'MAIN_DECK_TOP' },
          orderedResolution,
          sourceZone: ZoneType.WAITING_ROOM,
          destination: ZoneType.MAIN_DECK,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_WAITING_ROOM_CARD_TO_DECK_TOP',
      selectableCardIds,
    }
  );
}

function finishRinaWaitingRoomCardToDeckTopSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_ROOM_CARD_TO_DECK_TOP_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_WAITING_ROOM_CARD_TO_DECK_TOP',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const selectedCard = getCardById(game, selectedCardId);
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !selectedCard ||
    selectedCard.ownerId !== player.id ||
    !player.waitingRoom.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const moveResult = moveWaitingRoomCardsToDeckTopForPlayer(game, player.id, [selectedCardId], {
    candidateCardIds: effect.selectableCardIds,
    minCount: 1,
    maxCount: 1,
  });
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'WAITING_ROOM_CARD_TO_DECK_TOP',
      selectedCardId,
      movedCardIds: moveResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}
