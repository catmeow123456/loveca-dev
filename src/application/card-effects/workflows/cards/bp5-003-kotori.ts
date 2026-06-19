import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID } from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  discardOneHandCardToWaitingRoomForPlayer,
} from '../../runtime/actions.js';
import { typeIs } from '../../../effects/card-selectors.js';
import {
  payImmediateEffectCosts,
  type EffectCostDefinition,
} from '../../../effects/effect-costs.js';
import {
  clearInspectionCards,
  inspectTopCards,
} from '../../../effects/look-top.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const BP5_003_SELECT_DISCARD_STEP_ID = 'BP5_003_SELECT_HAND_CARD_TO_DISCARD';
const BP5_003_SELECT_TOP_TWO_STEP_ID = 'BP5_003_SELECT_TWO_FROM_TOP_FOUR';
const BP5_003_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'BP5_003_SELECT_WAITING_ROOM_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerBp5003KotoriWorkflowHandlers(): void {
  registerActivatedAbilityHandler(
    BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
    startBp5003KotoriActivatedEffect
  );
  registerActiveEffectStepHandler(
    BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
    BP5_003_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? startBp5003KotoriBranchAfterDiscard(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects
          )
        : game
  );
  registerActiveEffectStepHandler(
    BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
    BP5_003_SELECT_TOP_TWO_STEP_ID,
    (game, input, context) =>
      finishBp5003KotoriTakeTopCards(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
    BP5_003_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startBp5003KotoriActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string
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
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!-bp5-003') ||
    !isMemberCardData(sourceCard.data) ||
    getSourceMemberSlot(game, player.id, cardId) === null ||
    player.hand.cardIds.length === 0 ||
    getActiveEnergyCardIds(player).length < 2
  ) {
    return game;
  }

  const energyCost: EffectCostDefinition = { kind: 'TAP_ACTIVE_ENERGY', count: 2 };
  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 1,
    maxCount: 1,
    optional: false,
  };
  const state = recordAbilityUseForContext(game, player.id, {
    abilityId: BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
    sourceCardId: cardId,
  });

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID),
        stepId: BP5_003_SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '支付费用',
        canSkipSelection: false,
        metadata: {
          effectCosts: [energyCost, discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
      sourceCardId: cardId,
      step: 'START_PAY_ENERGY_SELECT_DISCARD',
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function startBp5003KotoriBranchAfterDiscard(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID ||
    effect.stepId !== BP5_003_SELECT_DISCARD_STEP_ID ||
    !effect.selectableCardIds?.includes(discardCardId)
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const discardedCard = getCardById(game, discardCardId);
  if (!player || !discardedCard || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }
  const discardedCardIsMuse = cardBelongsToGroup(discardedCard.data, "μ's");

  const energyPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!energyPayment) {
    return game;
  }
  const discardResult = discardOneHandCardToWaitingRoomForPlayer(
    energyPayment.gameState,
    player.id,
    discardCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    }
  );
  if (!discardResult) {
    return game;
  }
  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: energyPayment.paidEnergyCardIds,
    amount: energyPayment.paidEnergyCardIds.length,
    discardedHandCardIds: discardResult.discardedCardIds,
    discardedCardIsMuse,
  });

  if (discardedCardIsMuse) {
    return startBp5003KotoriLookTopFour(
      stateAfterCost,
      effect,
      player.id,
      {
        discardCardId,
        paidEnergyCardIds: energyPayment.paidEnergyCardIds,
      },
      continuePendingCardEffects
    );
  }

  return startBp5003KotoriRecoverLive(
    stateAfterCost,
    effect,
    player.id,
    {
      discardCardId,
      paidEnergyCardIds: energyPayment.paidEnergyCardIds,
    },
    continuePendingCardEffects
  );
}

function startBp5003KotoriLookTopFour(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  metadata: {
    readonly discardCardId: string;
    readonly paidEnergyCardIds: readonly string[];
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const inspection = inspectTopCards(game, playerId, { count: 4 });
  if (!inspection || inspection.inspectedCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_TOP_CARDS_TO_INSPECT',
        discardCardId: metadata.discardCardId,
        paidEnergyCardIds: metadata.paidEnergyCardIds,
      }),
      game.activeEffect?.metadata?.orderedResolution === true
    );
  }

  const requiredSelectionCount = Math.min(2, inspection.inspectedCardIds.length);
  return addAction(
    {
      ...inspection.gameState,
      activeEffect: {
        ...effect,
        stepId: BP5_003_SELECT_TOP_TWO_STEP_ID,
        stepText: `检视自己卡组顶的${inspection.inspectedCardIds.length}张卡，选择${requiredSelectionCount}张加入手牌。`,
        awaitingPlayerId: playerId,
        selectableCardIds: inspection.selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        inspectionCardIds: inspection.inspectedCardIds,
        minSelectableCards: requiredSelectionCount,
        maxSelectableCards: requiredSelectionCount,
        selectionLabel: '选择要加入手牌的卡',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          discardCardId: metadata.discardCardId,
          paidEnergyCardIds: metadata.paidEnergyCardIds,
          requiredTopSelectionCount: requiredSelectionCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_INSPECTION',
      inspectedCardIds: inspection.inspectedCardIds,
      selectableCardIds: inspection.selectableCardIds,
      requiredSelectionCount,
    }
  );
}

function finishBp5003KotoriTakeTopCards(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID ||
    effect.stepId !== BP5_003_SELECT_TOP_TWO_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const requiredSelectionCount =
    typeof effect.metadata?.requiredTopSelectionCount === 'number'
      ? effect.metadata.requiredTopSelectionCount
      : Math.min(2, inspectedCardIds.length);
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !player ||
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== requiredSelectionCount ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        inspectedCardIds.includes(cardId) && effect.selectableCardIds?.includes(cardId) === true
    )
  ) {
    return game;
  }

  const waitingRoomCardIds = inspectedCardIds.filter(
    (cardId) => !uniqueSelectedCardIds.includes(cardId)
  );
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: {
      ...currentPlayer.hand,
      cardIds: [...currentPlayer.hand.cardIds, ...uniqueSelectedCardIds],
    },
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: [...currentPlayer.waitingRoom.cardIds, ...waitingRoomCardIds],
    },
  }));
  state = clearInspectionCards({ ...state, activeEffect: null }, inspectedCardIds);

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'TAKE_TWO_FROM_TOP_FOUR',
      selectedCardIds: uniqueSelectedCardIds,
      waitingRoomCardIds,
      discardCardId: effect.metadata?.discardCardId,
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds,
    }),
    game.activeEffect?.metadata?.orderedResolution === true
  );
}

function startBp5003KotoriRecoverLive(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  metadata: {
    readonly discardCardId: string;
    readonly paidEnergyCardIds: readonly string[];
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const selectableCardIds = selectWaitingRoomCardIds(game, playerId, typeIs(CardType.LIVE));
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_NON_MUSE_NO_LIVE_TARGET',
        discardCardId: metadata.discardCardId,
        paidEnergyCardIds: metadata.paidEnergyCardIds,
      }),
      game.activeEffect?.metadata?.orderedResolution === true
    );
  }

  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: 1,
    maxCount: 1,
    optional: false,
  });
  return addAction(
    {
      ...game,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: effect.effectText,
        stepId: BP5_003_SELECT_WAITING_ROOM_LIVE_STEP_ID,
        stepText: '请选择自己的休息室中1张LIVE卡加入手牌。',
        awaitingPlayerId: playerId,
        selectableCardIds,
        metadata,
        zoneSelection,
      }),
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_WAITING_ROOM_LIVE',
      selectableCardIds,
    }
  );
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
