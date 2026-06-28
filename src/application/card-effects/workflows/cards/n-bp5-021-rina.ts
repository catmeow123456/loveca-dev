import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { moveTopDeckCardsToWaitingRoomWithRefresh } from '../../../effects/look-top.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { PL_N_BP5_021_ON_ENTER_MILL_TWO_OPTIONAL_INSERT_LIVE_FOURTH_FROM_TOP_ABILITY_ID } from '../../ability-ids.js';
import { moveWaitingRoomCardToDeckPositionForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_WAITING_ROOM_LIVE_STEP_ID = 'PL_N_BP5_021_SELECT_WAITING_ROOM_LIVE_TO_DECK_FOURTH';
const MILL_COUNT = 2;
const DECK_POSITION_FROM_TOP = 4;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5021RinaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP5_021_ON_ENTER_MILL_TWO_OPTIONAL_INSERT_LIVE_FOURTH_FROM_TOP_ABILITY_ID,
    (game, ability, options, context) =>
      startRinaOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP5_021_ON_ENTER_MILL_TWO_OPTIONAL_INSERT_LIVE_FOURTH_FROM_TOP_ABILITY_ID,
    SELECT_WAITING_ROOM_LIVE_STEP_ID,
    (game, input, context) =>
      finishRinaWaitingRoomLiveSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startRinaOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const millResult = moveTopDeckCardsToWaitingRoomWithRefresh(game, player.id, MILL_COUNT);
  if (!millResult) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...millResult.gameState,
    pendingAbilities: millResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  const selectableCardIds = selectWaitingRoomCardIds(
    stateWithoutPending,
    player.id,
    typeIs(CardType.LIVE)
  );

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'MILL_TWO_NO_WAITING_ROOM_LIVE',
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
        stepId: SELECT_WAITING_ROOM_LIVE_STEP_ID,
        stepText: '可以选择自己休息室1张LIVE卡，放置于自己卡组顶第4张。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择要放入卡组的LIVE',
        confirmSelectionLabel: '放入卡组',
        canSkipSelection: true,
        metadata: {
          orderedResolution,
          sourceZone: ZoneType.WAITING_ROOM,
          destination: ZoneType.MAIN_DECK,
          milledCardIds: millResult.movedCardIds,
          refreshCount: millResult.refreshCount,
          positionFromTop: DECK_POSITION_FROM_TOP,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'MILL_TWO_SELECT_WAITING_ROOM_LIVE',
      milledCardIds: millResult.movedCardIds,
      refreshCount: millResult.refreshCount,
      selectableCardIds,
    }
  );
}

function finishRinaWaitingRoomLiveSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP5_021_ON_ENTER_MILL_TWO_OPTIONAL_INSERT_LIVE_FOURTH_FROM_TOP_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_ROOM_LIVE_STEP_ID
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
        step: 'DECLINE_INSERT_WAITING_ROOM_LIVE',
        milledCardIds: getStringArrayMetadata(effect.metadata?.milledCardIds),
        refreshCount: getNumberMetadata(effect.metadata?.refreshCount) ?? 0,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const selectedCard = getCardById(game, selectedCardId);
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !selectedCard ||
    selectedCard.ownerId !== player.id ||
    !isLiveCardData(selectedCard.data) ||
    !player.waitingRoom.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const moveResult = moveWaitingRoomCardToDeckPositionForPlayer(game, player.id, selectedCardId, {
    candidateCardIds: effect.selectableCardIds,
    positionFromTop: DECK_POSITION_FROM_TOP,
  });
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'INSERT_WAITING_ROOM_LIVE_TO_DECK_FOURTH',
      selectedCardId,
      insertIndex: moveResult.insertIndex,
      positionFromTop: moveResult.positionFromTop,
      milledCardIds: getStringArrayMetadata(effect.metadata?.milledCardIds),
      refreshCount: getNumberMetadata(effect.metadata?.refreshCount) ?? 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function getNumberMetadata(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
