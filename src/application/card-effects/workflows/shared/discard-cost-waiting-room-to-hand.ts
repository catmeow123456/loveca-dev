import { isMemberCardData, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType, GamePhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID } from '../../ability-ids.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { and, groupIs, typeIs } from '../../../effects/card-selectors.js';
import { successLiveScoreAtLeast } from '../../../effects/conditions.js';
import { type EffectCostDefinition } from '../../../effects/effect-costs.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { finishWaitingRoomToHandWorkflow } from './waiting-room-to-hand.js';

const SELECT_WAITING_ROOM_CARD_STEP_ID = 'SELECT_WAITING_ROOM_CARD';
const BP4_002_SELECT_DISCARD_STEP_ID = 'BP4_002_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const BP4_002_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID = 'BP4_002_SELECT_WAITING_ROOM_MUSE_LIVE';

interface DiscardCostWaitingRoomToHandWorkflowConfig {
  readonly abilityId: string;
  readonly expectedBaseCardCodes: readonly string[];
  readonly discardStepId: string;
  readonly recoveryStepId: string;
  readonly discardCount: number;
  readonly recoverySelector: (card: CardInstance) => boolean;
  readonly recoveryStepText: string;
  readonly canActivate?: (game: GameState, playerId: string) => boolean;
  readonly recoverySelectionRequiredWhenHasTargets?: boolean;
}

const BP4_002_DISCARD_RECOVER_WORKFLOW: DiscardCostWaitingRoomToHandWorkflowConfig = {
  abilityId: BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
  expectedBaseCardCodes: ['PL!-bp4-002'],
  discardStepId: BP4_002_SELECT_DISCARD_STEP_ID,
  recoveryStepId: BP4_002_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID,
  discardCount: 2,
  recoverySelector: and(typeIs(CardType.LIVE), groupIs("μ's")),
  recoveryStepText: "请选择自己的休息室中1张『μ's』的LIVE卡加入手牌。",
  canActivate: (game, playerId) => successLiveScoreAtLeast(game, playerId, 6),
  recoverySelectionRequiredWhenHasTargets: true,
};

export function registerDiscardCostWaitingRoomToHandWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    BP4_002_DISCARD_RECOVER_WORKFLOW.abilityId,
    (game, playerId, cardId) =>
      startDiscardCostWaitingRoomToHandWorkflow(
        game,
        playerId,
        cardId,
        BP4_002_DISCARD_RECOVER_WORKFLOW
      )
  );
  registerActiveEffectStepHandler(
    BP4_002_DISCARD_RECOVER_WORKFLOW.abilityId,
    BP4_002_SELECT_DISCARD_STEP_ID,
    (game, input) =>
      input.selectedCardIds
        ? startDiscardCostWaitingRoomRecoveryAfterDiscard(
            game,
            input.selectedCardIds,
            BP4_002_DISCARD_RECOVER_WORKFLOW,
            deps.enqueueTriggeredCardEffects
          )
        : game
  );
  registerActiveEffectStepHandler(
    BP4_002_DISCARD_RECOVER_WORKFLOW.abilityId,
    BP4_002_SELECT_WAITING_ROOM_MUSE_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startDiscardCostWaitingRoomToHandWorkflow(
  game: GameState,
  playerId: string,
  cardId: string,
  config: DiscardCostWaitingRoomToHandWorkflowConfig
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !config.expectedBaseCardCodes.some((baseCardCode) =>
      cardCodeMatchesBase(sourceCard.data.cardCode, baseCardCode)
    ) ||
    !isMemberCardData(sourceCard.data) ||
    !findMemberSlot(player, cardId) ||
    player.hand.cardIds.length < config.discardCount ||
    config.canActivate?.(game, player.id) === false
  ) {
    return game;
  }

  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: config.discardCount,
    maxCount: config.discardCount,
    optional: false,
  };
  const state = recordAbilityUseForContext(game, player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
  });

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${config.abilityId}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: config.abilityId,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: config.discardStepId,
        stepText: `请选择${config.discardCount}张手牌放置入休息室。`,
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: config.discardCount,
        maxSelectableCards: config.discardCount,
        selectionLabel: `选择要放置入休息室的${config.discardCount}张手牌`,
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: {
          effectCosts: [discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
          discardCount: config.discardCount,
          recoveryStepId: config.recoveryStepId,
          recoverySelectionRequiredWhenHasTargets:
            config.recoverySelectionRequiredWhenHasTargets === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: config.abilityId,
      sourceCardId: cardId,
      step: 'START_SELECT_DISCARD',
      discardCount: config.discardCount,
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function startDiscardCostWaitingRoomRecoveryAfterDiscard(
  game: GameState,
  selectedCardIds: readonly string[],
  config: DiscardCostWaitingRoomToHandWorkflowConfig,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const discardCount =
    typeof effect.metadata?.discardCount === 'number' ? effect.metadata.discardCount : 0;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    discardCount <= 0 ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== discardCount ||
    !uniqueSelectedCardIds.every(
      (selectedCardId) =>
        effect.selectableCardIds?.includes(selectedCardId) === true &&
        player.hand.cardIds.includes(selectedCardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: discardCount,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const selectableCardIds = selectWaitingRoomCardIds(
    discardResult.gameState,
    player.id,
    config.recoverySelector
  );
  const selectionRequired =
    effect.metadata?.recoverySelectionRequiredWhenHasTargets === true &&
    selectableCardIds.length > 0;
  const recoveryStepId =
    typeof effect.metadata?.recoveryStepId === 'string'
      ? effect.metadata.recoveryStepId
      : SELECT_WAITING_ROOM_CARD_STEP_ID;
  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: selectionRequired ? 1 : 0,
    optional: !selectionRequired,
  });

  return addAction(
    {
      ...discardResult.gameState,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: recoveryStepId,
        stepText: config.recoveryStepText,
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          discardedHandCardIds: discardResult.discardedCardIds,
        },
        zoneSelection,
      }),
    },
    'PAY_COST',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      discardedHandCardIds: discardResult.discardedCardIds,
      selectableCardIds,
    }
  );
}
