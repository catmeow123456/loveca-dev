import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { SlotPosition, ZoneType } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { PL_N_BP4_031_LIVE_START_NIJIGASAKI_STAGE_COST_DRAW_THREE_HAND_TO_TOP_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer, moveHandCardsToDeckTopForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_HAND_CARDS_TO_DECK_TOP_STEP_ID = 'PL_N_BP4_031_SELECT_HAND_CARDS_TO_DECK_TOP';
const DRAW_COUNT = 3;
const RETURN_COUNT = 3;
const MEMBER_SLOT_ORDER: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface StageConditionContext {
  readonly sourceIsCurrentLive: boolean;
  readonly nijigasakiMemberCardIds: readonly string[];
  readonly stageFilledWithNijigasaki: boolean;
  readonly nijigasakiEffectiveCostTotal: number;
  readonly conditionMet: boolean;
}

export function registerNBp4031NeoSkyNeoMapWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_031_LIVE_START_NIJIGASAKI_STAGE_COST_DRAW_THREE_HAND_TO_TOP_ABILITY_ID,
    (game, ability, options, context) =>
      startNBp4031NeoSkyNeoMapLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_031_LIVE_START_NIJIGASAKI_STAGE_COST_DRAW_THREE_HAND_TO_TOP_ABILITY_ID,
    SELECT_HAND_CARDS_TO_DECK_TOP_STEP_ID,
    (game, input, context) =>
      finishNBp4031NeoSkyNeoMapSelection(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
      )
  );
}

function startNBp4031NeoSkyNeoMapLiveStart(
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
      step: condition.sourceIsCurrentLive ? 'CONDITION_NOT_MET' : 'SOURCE_NOT_IN_LIVE_ZONE',
      ...condition,
    });
  }

  const drawResult = drawCardsForPlayer(game, player.id, DRAW_COUNT);
  if (!drawResult) {
    return resolveNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'DRAW_FAILED',
      ...condition,
    });
  }

  const stateWithoutPending = removePendingAbility(drawResult.gameState, ability.id);
  const playerAfterDraw = getPlayerById(stateWithoutPending, player.id);
  const selectableCardIds = playerAfterDraw?.hand.cardIds ?? [];
  if (selectableCardIds.length < RETURN_COUNT) {
    return continuePendingCardEffects(
      addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'DRAW_THREE_HAND_LESS_THAN_THREE',
        drawnCardIds: drawResult.drawnCardIds,
        selectableCardIds,
        ...condition,
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
        stepId: SELECT_HAND_CARDS_TO_DECK_TOP_STEP_ID,
        stepText: '已抽3张卡。请选择3张手牌，并按放置到卡组顶的顺序选择。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: RETURN_COUNT,
        maxSelectableCards: RETURN_COUNT,
        selectionLabel: '选择放置到卡组顶的手牌',
        confirmSelectionLabel: '放置到卡组顶',
        metadata: {
          orderedResolution,
          sourceZone: ZoneType.HAND,
          destination: ZoneType.MAIN_DECK,
          drawnCardIds: drawResult.drawnCardIds,
          nijigasakiMemberCardIds: condition.nijigasakiMemberCardIds,
          nijigasakiEffectiveCostTotal: condition.nijigasakiEffectiveCostTotal,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DRAW_THREE_SELECT_HAND_CARDS_TO_DECK_TOP',
      drawnCardIds: drawResult.drawnCardIds,
      selectableCardIds,
      ...condition,
    }
  );
}

function finishNBp4031NeoSkyNeoMapSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP4_031_LIVE_START_NIJIGASAKI_STAGE_COST_DRAW_THREE_HAND_TO_TOP_ABILITY_ID ||
    effect.stepId !== SELECT_HAND_CARDS_TO_DECK_TOP_STEP_ID
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
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    selectedCardIds.length !== RETURN_COUNT ||
    !selectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true && player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const moveResult = moveHandCardsToDeckTopForPlayer(game, player.id, selectedCardIds, {
    candidateCardIds: effect.selectableCardIds ?? [],
    exactCount: RETURN_COUNT,
  });
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'HAND_CARDS_TO_DECK_TOP',
      selectedCardIds: moveResult.selectedCardIds,
      movedCardIds: moveResult.movedCardIds,
      drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
      ...condition,
    }),
    effect.metadata?.orderedResolution === true
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
      nijigasakiMemberCardIds: [],
      stageFilledWithNijigasaki: false,
      nijigasakiEffectiveCostTotal: 0,
      conditionMet: false,
    };
  }

  const sourceIsCurrentLive = player.liveZone.cardIds.includes(sourceCardId);
  const nijigasakiMemberCardIds: string[] = [];
  let nijigasakiEffectiveCostTotal = 0;

  for (const slot of MEMBER_SLOT_ORDER) {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return {
        sourceIsCurrentLive,
        nijigasakiMemberCardIds,
        stageFilledWithNijigasaki: false,
        nijigasakiEffectiveCostTotal,
        conditionMet: false,
      };
    }
    const card = getCardById(game, cardId);
    if (
      !card ||
      card.ownerId !== playerId ||
      !isMemberCardData(card.data) ||
      !cardBelongsToGroup(card.data, '虹ヶ咲')
    ) {
      return {
        sourceIsCurrentLive,
        nijigasakiMemberCardIds,
        stageFilledWithNijigasaki: false,
        nijigasakiEffectiveCostTotal,
        conditionMet: false,
      };
    }
    nijigasakiMemberCardIds.push(cardId);
    nijigasakiEffectiveCostTotal += getMemberEffectiveCost(game, playerId, cardId);
  }

  const conditionMet = sourceIsCurrentLive && nijigasakiEffectiveCostTotal >= 20;
  return {
    sourceIsCurrentLive,
    nijigasakiMemberCardIds,
    stageFilledWithNijigasaki: true,
    nijigasakiEffectiveCostTotal,
    conditionMet,
  };
}

function resolveNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Record<string, unknown>
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}
