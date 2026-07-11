import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, SlotPosition } from '../../../../shared/types/enums.js';
import {
  cardBelongsToGroup,
  selectDifferentNamedCards,
} from '../../../../shared/utils/card-identity.js';
import {
  S_BP2_008_GRANTED_LIVE_SUCCESS_CHEER_LIVE_SCORE_ABILITY_ID,
  S_BP2_008_ON_ENTER_WAITING_ROOM_LIVE_TO_DECK_BOTTOM_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { moveWaitingRoomCardsToDeckBottomForPlayer } from '../../runtime/actions.js';
import { registerLiveSuccessAbilityAvailabilityGate } from '../../runtime/live-success-ability-availability-gates.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ON_ENTER_ABILITY_ID = S_BP2_008_ON_ENTER_WAITING_ROOM_LIVE_TO_DECK_BOTTOM_ABILITY_ID;
const GRANTED_LIVE_SUCCESS_ABILITY_ID = S_BP2_008_GRANTED_LIVE_SUCCESS_CHEER_LIVE_SCORE_ABILITY_ID;
const SELECT_WAITING_ROOM_LIVE_STEP_ID = 'S_BP2_008_SELECT_WAITING_ROOM_LIVE_TO_DECK_BOTTOM';
const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp2008MariWorkflowHandlers(): void {
  registerLiveSuccessAbilityAvailabilityGate(GRANTED_LIVE_SUCCESS_ABILITY_ID, (context) =>
    hasFullDistinctAqoursStage(context.game, context.controllerId)
  );
  registerPendingAbilityStarterHandler(ON_ENTER_ABILITY_ID, (game, ability, options, context) =>
    startWaitingRoomLiveSelection(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ON_ENTER_ABILITY_ID, SELECT_WAITING_ROOM_LIVE_STEP_ID, (game, input, context) =>
    finishWaitingRoomLiveSelection(
      game,
      input.selectedCardIds ?? [],
      context.continuePendingCardEffects
    )
  );
}

function startWaitingRoomLiveSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const candidateCardIds = player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && isLiveCardData(card.data);
  });
  if (candidateCardIds.length === 0) {
    return consumePending(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_WAITING_ROOM_LIVE',
      candidateCardIds,
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
      stepId: SELECT_WAITING_ROOM_LIVE_STEP_ID,
      stepText: '请选择自己休息室中至多1张LIVE卡放置到卡组底。也可以选择不放置。',
      awaitingPlayerId: player.id,
      selectableCardIds: candidateCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 1,
      selectionLabel: '选择要放置到卡组底的LIVE',
      confirmSelectionLabel: '放置到卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
      metadata: { orderedResolution, candidateCardIds },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_WAITING_ROOM_LIVE_TO_DECK_BOTTOM',
      candidateCardIds,
    },
  });
}

function finishWaitingRoomLiveSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ON_ENTER_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_ROOM_LIVE_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const candidateCardIds = getCandidateCardIds(effect.metadata);
  const selectedSet = new Set(selectedCardIds);
  if (
    !player ||
    selectedSet.size !== selectedCardIds.length ||
    selectedCardIds.length > 1 ||
    selectedCardIds.some((cardId) => !candidateCardIds.includes(cardId))
  ) {
    return game;
  }

  if (selectedCardIds.length === 0) {
    return finishSelection(game, effect, player.id, [], [], continuePendingCardEffects, 'SKIP_WAITING_ROOM_LIVE');
  }

  if (selectedCardIds.some((cardId) => !player.waitingRoom.cardIds.includes(cardId))) {
    return finishSelection(
      game,
      effect,
      player.id,
      selectedCardIds,
      [],
      continuePendingCardEffects,
      'STALE_WAITING_ROOM_LIVE'
    );
  }

  const moveResult = moveWaitingRoomCardsToDeckBottomForPlayer(
    { ...game, activeEffect: null },
    player.id,
    selectedCardIds,
    { candidateCardIds, minCount: 0, maxCount: 1 }
  );
  if (!moveResult) {
    return game;
  }
  return continuePendingCardEffects(
    addAction(moveResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_WAITING_ROOM_LIVE_TO_DECK_BOTTOM',
      selectedCardIds: moveResult.selectedCardIds,
      movedCardIds: moveResult.movedCardIds,
      remainingCandidateIds: moveResult.remainingCandidateIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishSelection(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  selectedCardIds: readonly string[],
  movedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      selectedCardIds,
      movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePending(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getCandidateCardIds(
  metadata: Readonly<Record<string, unknown>> | undefined
): readonly string[] {
  return Array.isArray(metadata?.candidateCardIds)
    ? metadata.candidateCardIds.filter((cardId): cardId is string => typeof cardId === 'string')
    : [];
}

function hasFullDistinctAqoursStage(game: GameState, playerId: string): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }
  const stageMemberCardIds = STAGE_SLOTS.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return cardId &&
      card !== null &&
      card.ownerId === player.id &&
      isMemberCardData(card.data) &&
      cardBelongsToGroup(card.data, 'Aqours')
      ? [cardId]
      : [];
  });
  return (
    stageMemberCardIds.length === STAGE_SLOTS.length &&
    selectDifferentNamedCards(
      stageMemberCardIds,
      (cardId) => getCardById(game, cardId)?.data ?? null,
      { groupName: 'Aqours', minCount: STAGE_SLOTS.length, maxCount: STAGE_SLOTS.length }
    ).length === STAGE_SLOTS.length
  );
}
