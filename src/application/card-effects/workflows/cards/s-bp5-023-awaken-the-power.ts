import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { CardType } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { S_BP5_023_LIVE_START_STAGE_AQOURS_SAINTSNOW_COST_STACK_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { moveWaitingRoomCardsToDeckTopForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_WAITING_ROOM_LIVE_STEP_ID = 'S_BP5_023_SELECT_WAITING_ROOM_LIVE_TO_DECK_TOP';
const MAX_STACKED_LIVE_CARDS = 4;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface StageConditionContext {
  readonly sourceIsCurrentLive: boolean;
  readonly aqoursMemberCardIds: readonly string[];
  readonly saintSnowMemberCardIds: readonly string[];
  readonly relevantMemberCardIds: readonly string[];
  readonly relevantEffectiveCostTotal: number;
  readonly conditionMet: boolean;
}

export function registerSBp5023AwakenThePowerWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_BP5_023_LIVE_START_STAGE_AQOURS_SAINTSNOW_COST_STACK_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startSBp5023AwakenThePowerLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP5_023_LIVE_START_STAGE_AQOURS_SAINTSNOW_COST_STACK_LIVE_ABILITY_ID,
    SELECT_WAITING_ROOM_LIVE_STEP_ID,
    (game, input, context) =>
      finishSBp5023AwakenThePowerSelection(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
      )
  );
}

function startSBp5023AwakenThePowerLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const condition = evaluateStageCondition(game, player.id, ability.sourceCardId);
  if (!condition.conditionMet) {
    return resolveNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'CONDITION_NOT_MET',
      ...condition,
    });
  }

  const selectableCardIds = selectWaitingRoomAqoursOrSaintSnowLiveCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return resolveNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_WAITING_ROOM_LIVE_TARGET',
      ...condition,
    });
  }

  const maxSelectableCards = Math.min(MAX_STACKED_LIVE_CARDS, selectableCardIds.length);
  return addAction(
    {
      ...removePendingAbility(game, ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_WAITING_ROOM_LIVE_STEP_ID,
        stepText:
          '请选择自己休息室中至多4张『Aqours』或『SaintSnow』LIVE卡，按放置到卡组顶的顺序选择。也可以不选择。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards,
        selectionLabel: '选择放置到卡组顶的LIVE卡',
        confirmSelectionLabel: '放置到卡组顶',
        canSkipSelection: true,
        skipSelectionLabel: '不放置',
        metadata: {
          orderedResolution,
          aqoursMemberCardIds: condition.aqoursMemberCardIds,
          saintSnowMemberCardIds: condition.saintSnowMemberCardIds,
          relevantMemberCardIds: condition.relevantMemberCardIds,
          relevantEffectiveCostTotal: condition.relevantEffectiveCostTotal,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_WAITING_ROOM_LIVE_TO_DECK_TOP',
      selectableCardIds,
      maxSelectableCards,
      ...condition,
    }
  );
}

function finishSBp5023AwakenThePowerSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP5_023_LIVE_START_STAGE_AQOURS_SAINTSNOW_COST_STACK_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_ROOM_LIVE_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const condition = evaluateStageCondition(game, player.id, effect.sourceCardId);
  if (!condition.sourceIsCurrentLive) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SOURCE_NOT_IN_LIVE_ZONE',
        ...condition,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const maxSelectableCards = effect.maxSelectableCards ?? MAX_STACKED_LIVE_CARDS;
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > maxSelectableCards ||
    !uniqueSelectedCardIds.every((cardId) => effect.selectableCardIds?.includes(cardId) === true)
  ) {
    return game;
  }

  if (uniqueSelectedCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_WAITING_ROOM_LIVE_SELECTION',
        ...condition,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const currentCandidateIds = selectWaitingRoomAqoursOrSaintSnowLiveCardIds(game, player.id);
  const moveResult = moveWaitingRoomCardsToDeckTopForPlayer(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      candidateCardIds: currentCandidateIds.filter(
        (cardId) => effect.selectableCardIds?.includes(cardId) === true
      ),
      minCount: 0,
      maxCount: MAX_STACKED_LIVE_CARDS,
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_WAITING_ROOM_LIVE_TO_DECK_TOP',
      selectedCardIds: moveResult.selectedCardIds,
      movedCardIds: moveResult.movedCardIds,
      ...condition,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function resolveNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Record<string, unknown>
): GameState {
  const state = removePendingAbility(game, ability.id);
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

function evaluateStageCondition(
  game: GameState,
  playerId: string,
  sourceCardId: string
): StageConditionContext {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return {
      sourceIsCurrentLive: false,
      aqoursMemberCardIds: [],
      saintSnowMemberCardIds: [],
      relevantMemberCardIds: [],
      relevantEffectiveCostTotal: 0,
      conditionMet: false,
    };
  }

  const sourceIsCurrentLive = player.liveZone.cardIds.includes(sourceCardId);
  const stageMemberCardIds = getAllMemberCardIds(player.memberSlots);
  const aqoursMemberCardIds: string[] = [];
  const saintSnowMemberCardIds: string[] = [];
  const relevantMemberCardIds: string[] = [];
  let relevantEffectiveCostTotal = 0;

  for (const cardId of stageMemberCardIds) {
    const card = getCardById(game, cardId);
    if (!card || !isMemberCardData(card.data)) {
      continue;
    }
    const isAqours = cardBelongsToGroup(card.data, 'Aqours');
    const isSaintSnow = cardBelongsToGroup(card.data, 'SaintSnow');
    if (isAqours) {
      aqoursMemberCardIds.push(cardId);
    }
    if (isSaintSnow) {
      saintSnowMemberCardIds.push(cardId);
    }
    if (isAqours || isSaintSnow) {
      relevantMemberCardIds.push(cardId);
      relevantEffectiveCostTotal += getMemberEffectiveCost(game, playerId, cardId);
    }
  }

  return {
    sourceIsCurrentLive,
    aqoursMemberCardIds,
    saintSnowMemberCardIds,
    relevantMemberCardIds,
    relevantEffectiveCostTotal,
    conditionMet:
      sourceIsCurrentLive &&
      aqoursMemberCardIds.length > 0 &&
      saintSnowMemberCardIds.length > 0 &&
      relevantEffectiveCostTotal >= 20,
  };
}

function selectWaitingRoomAqoursOrSaintSnowLiveCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === playerId &&
      isLiveCardData(card.data) &&
      card.data.cardType === CardType.LIVE &&
      (cardBelongsToGroup(card.data, 'Aqours') || cardBelongsToGroup(card.data, 'SaintSnow'))
    );
  });
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}
