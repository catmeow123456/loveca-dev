import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  and,
  liveRequiresPrintedHeartColorAtLeast,
  typeIs,
} from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const DISCARD_COUNT = 2;
const SELECT_DISCARD_STEP_ID = 'BP5_009_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const SELECT_LIVE_STEP_ID = 'BP5_009_SELECT_PURPLE_REQUIREMENT_LIVE_FROM_WAITING_ROOM';

const purpleRequirementLiveSelector = and(
  typeIs(CardType.LIVE),
  liveRequiresPrintedHeartColorAtLeast(HeartColor.PURPLE, 3)
);

export function registerBp5009NicoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID,
    startBp5009NicoActivated
  );
  registerActiveEffectStepHandler(
    BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishBp5009NicoDiscardCost(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID,
    SELECT_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startBp5009NicoActivated(game: GameState, playerId: string, cardId: string): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!-bp5-009') ||
    sourceSlot === null ||
    player.hand.cardIds.length < DISCARD_COUNT
  ) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID
        ),
        stepId: SELECT_DISCARD_STEP_ID,
        stepText:
          '请选择2张手牌放置入休息室。之后，从自己的休息室回收1张必要[紫ハート]3个以上的LIVE卡。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: DISCARD_COUNT,
        maxSelectableCards: DISCARD_COUNT,
        selectionLabel: '选择要放置入休息室的2张手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: {
          sourceSlot,
          effectCosts: [
            {
              kind: 'DISCARD_HAND_TO_WAITING_ROOM',
              minCount: DISCARD_COUNT,
              maxCount: DISCARD_COUNT,
              optional: false,
            },
          ],
          handToWaitingRoomCost: {
            minCount: DISCARD_COUNT,
            maxCount: DISCARD_COUNT,
            optional: false,
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot,
      step: 'START_SELECT_TWO_HAND_DISCARD',
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function finishBp5009NicoDiscardCost(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== DISCARD_COUNT ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true && player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: DISCARD_COUNT,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  let state = recordPayCostAction(discardResult.gameState, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    discardedHandCardIds: discardResult.discardedCardIds,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });

  const selectableCardIds = selectWaitingRoomCardIds(
    state,
    player.id,
    purpleRequirementLiveSelector
  );
  if (selectableCardIds.length === 0) {
    return addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'PAY_COST_NO_PURPLE_REQUIREMENT_LIVE_TARGET',
      discardedHandCardIds: discardResult.discardedCardIds,
    });
  }

  return addAction(
    {
      ...state,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: SELECT_LIVE_STEP_ID,
        stepText: '请选择自己休息室1张必要[紫ハート]3个以上的LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        canSkipSelection: false,
        metadata: {
          sourceSlot: effect.metadata?.sourceSlot,
          discardedHandCardIds: discardResult.discardedCardIds,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'PAY_COST_SELECT_PURPLE_REQUIREMENT_LIVE',
      discardedHandCardIds: discardResult.discardedCardIds,
      selectableCardIds,
    }
  );
}
