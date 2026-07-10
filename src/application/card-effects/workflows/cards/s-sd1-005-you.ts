import { isMemberCardData, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { S_SD1_005_ACTIVATED_PAY_ENERGY_DISCARD_RECOVER_AQOURS_LIVE_ABILITY_ID } from '../../ability-ids.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts, type EffectCostDefinition } from '../../../effects/effect-costs.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const ABILITY_ID = S_SD1_005_ACTIVATED_PAY_ENERGY_DISCARD_RECOVER_AQOURS_LIVE_ABILITY_ID;
const SELECT_DISCARD_STEP_ID = 'S_SD1_005_SELECT_DISCARD_FOR_AQOURS_LIVE_RECOVERY';
const SELECT_RECOVERY_STEP_ID = 'S_SD1_005_SELECT_AQOURS_LIVE_FROM_WAITING_ROOM';
const ENERGY_COST = 2;
const EXPECTED_BASE_CARD_CODE = 'PL!S-sd1-005';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSSd1005YouWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(ABILITY_ID, (game, playerId, cardId) =>
    startSSd1005YouWorkflow(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_DISCARD_STEP_ID, (game, input, context) =>
    input.selectedCardId
      ? finishSSd1005DiscardCost(
          game,
          input.selectedCardId,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
      : game
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_RECOVERY_STEP_ID, (game, input, context) =>
    finishWaitingRoomToHandWorkflow(
      game,
      input.selectedCardId ?? null,
      input.selectedCardIds,
      context.continuePendingCardEffects
    )
  );
}

function startSSd1005YouWorkflow(game: GameState, playerId: string, cardId: string): GameState {
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
    !cardCodeMatchesBase(sourceCard.data.cardCode, EXPECTED_BASE_CARD_CODE) ||
    !isMemberCardData(sourceCard.data) ||
    !findMemberSlot(player, cardId) ||
    player.hand.cardIds.length === 0 ||
    getActiveEnergyCount(player) < ENERGY_COST
  ) {
    return game;
  }

  const energyCost: EffectCostDefinition = { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST };
  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 1,
    maxCount: 1,
    optional: false,
  };
  const state = recordAbilityUseForContext(game, player.id, {
    abilityId: ABILITY_ID,
    sourceCardId: cardId,
  });

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: {
          effectCosts: [energyCost, discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
          energyCostCount: ENERGY_COST,
          recoveryStepId: SELECT_RECOVERY_STEP_ID,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: ABILITY_ID,
      sourceCardId: cardId,
      step: 'START_SELECT_DISCARD',
      energyCostCount: ENERGY_COST,
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function finishSSd1005DiscardCost(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
  ]);
  if (!costPayment) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    costPayment.gameState,
    player.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
    discardedHandCardIds: discardResult.discardedCardIds,
  });
  const selectableCardIds = selectWaitingRoomCardIds(
    stateAfterCost,
    player.id,
    aqoursLiveCard
  );

  if (selectableCardIds.length === 0) {
    return finishActiveEffect(stateAfterCost, effect, continuePendingCardEffects, {
      step: 'PAY_COST_NO_AQOURS_LIVE_TARGET',
      energyCardIds: costPayment.paidEnergyCardIds,
      discardedHandCardIds: discardResult.discardedCardIds,
      selectableCardIds,
      selectedCardIds: [],
    });
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: SELECT_RECOVERY_STEP_ID,
        stepText: '请选择自己的休息室中1张『Aqours』LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
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
      step: 'PAY_COST_SELECT_AQOURS_LIVE',
      energyCardIds: costPayment.paidEnergyCardIds,
      discardedHandCardIds: discardResult.discardedCardIds,
      selectableCardIds,
    }
  );
}

function finishActiveEffect(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        ...payload,
      }
    ),
    false
  );
}

function aqoursLiveCard(card: CardInstance): boolean {
  return and(typeIs(CardType.LIVE), groupAliasIs('Aqours'))(card);
}

function getActiveEnergyCount(player: NonNullable<ReturnType<typeof getPlayerById>>): number {
  return player.energyZone.cardIds.filter(
    (energyCardId) =>
      player.energyZone.cardStates.get(energyCardId)?.orientation !== OrientationState.WAITING
  ).length;
}
