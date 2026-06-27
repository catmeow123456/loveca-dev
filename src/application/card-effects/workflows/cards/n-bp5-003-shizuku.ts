import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';

const SELECT_DISCARD_STEP_ID = 'PL_N_BP5_003_SELECT_HAND_CARD_TO_DISCARD';
const SELECT_WAITING_ROOM_LIVE_STEP_ID = 'PL_N_BP5_003_SELECT_WAITING_ROOM_LIVE';
const PAY_OR_DECLINE_STEP_ID = 'PL_N_BP5_003_PAY_LIVE_SCORE_OR_DECLINE';

const PAY_OPTION_ID = 'pay';
const DECLINE_OPTION_ID = 'decline';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5003ShizukuWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID,
    startShizukuActivatedEffect
  );
  registerActiveEffectStepHandler(
    PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishShizukuDiscardCost(
            game,
            input.selectedCardId,
            deps.enqueueTriggeredCardEffects,
            context.continuePendingCardEffects
          )
        : game
  );
  registerActiveEffectStepHandler(
    PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID,
    SELECT_WAITING_ROOM_LIVE_STEP_ID,
    (game, input) => startShizukuPayOrDecline(game, input.selectedCardId ?? null)
  );
  registerActiveEffectStepHandler(
    PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID,
    PAY_OR_DECLINE_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === PAY_OPTION_ID
        ? finishShizukuPayAndRecover(game, context.continuePendingCardEffects)
        : finishShizukuDeclinePay(game, context.continuePendingCardEffects)
  );
}

function startShizukuActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
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
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-bp5-003') ||
    !isMemberCardData(sourceCard.data) ||
    getSourceMemberSlot(game, player.id, cardId) === null ||
    player.hand.cardIds.length === 0
  ) {
    return game;
  }

  const state = recordAbilityUseForContext(game, player.id, {
    abilityId: PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID,
    sourceCardId: cardId,
  });

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID
        ),
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
        metadata: {
          handToWaitingRoomCost: {
            minCount: 1,
            maxCount: 1,
            optional: false,
          },
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID,
      sourceCardId: cardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function finishShizukuDiscardCost(
  game: GameState,
  discardCardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
  });
  const selectableLiveCardIds = selectWaitingRoomCardIds(
    stateAfterCost,
    player.id,
    typeIs(CardType.LIVE)
  );
  if (selectableLiveCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_COST_NO_WAITING_ROOM_LIVE',
        discardedHandCardIds: discardResult.discardedCardIds,
      }),
      false
    );
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        ...effect,
        stepId: SELECT_WAITING_ROOM_LIVE_STEP_ID,
        stepText: '请选择自己的休息室中1张LIVE卡。',
        selectableCardIds: selectableLiveCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择休息室的LIVE卡',
        confirmSelectionLabel: '选择LIVE',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          discardedHandCardIds: discardResult.discardedCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_COST_SELECT_WAITING_ROOM_LIVE',
      discardedHandCardIds: discardResult.discardedCardIds,
      selectableCardIds: selectableLiveCardIds,
    }
  );
}

function startShizukuPayOrDecline(game: GameState, selectedLiveCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_ROOM_LIVE_STEP_ID ||
    !selectedLiveCardId ||
    effect.selectableCardIds?.includes(selectedLiveCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const selectedLiveCard = getCardById(game, selectedLiveCardId);
  if (
    !player ||
    !player.waitingRoom.cardIds.includes(selectedLiveCardId) ||
    !selectedLiveCard ||
    !isLiveCardData(selectedLiveCard.data)
  ) {
    return game;
  }

  const energyCost = selectedLiveCard.data.score;
  const canPay = getActiveEnergyCardIds(player).length >= energyCost;
  const selectableOptions = canPay
    ? [
        { id: PAY_OPTION_ID, label: `支付${energyCost}能量` },
        { id: DECLINE_OPTION_ID, label: '不支付' },
      ]
    : [{ id: DECLINE_OPTION_ID, label: '不支付' }];

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: PAY_OR_DECLINE_STEP_ID,
        stepText: canPay
          ? `可以支付${energyCost}张活跃能量，将选择的LIVE卡加入手牌。`
          : `活跃能量不足以支付${energyCost}，可以不支付。`,
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectionLabel: undefined,
        confirmSelectionLabel: '确定',
        selectableOptions,
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedLiveCardId,
          selectedLiveScore: energyCost,
          canPay,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_WAITING_ROOM_LIVE_PAY_OR_DECLINE',
      selectedLiveCardId,
      selectedLiveScore: energyCost,
      canPay,
    }
  );
}

function finishShizukuDeclinePay(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID ||
    effect.stepId !== PAY_OR_DECLINE_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DECLINE_PAY_SCORE_RECOVER_LIVE',
      selectedLiveCardId: getStringMetadata(effect, 'selectedLiveCardId'),
      selectedLiveScore: getNumberMetadata(effect, 'selectedLiveScore'),
      discardedHandCardIds: getStringArrayMetadata(effect, 'discardedHandCardIds'),
    }),
    false
  );
}

function finishShizukuPayAndRecover(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID ||
    effect.stepId !== PAY_OR_DECLINE_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedLiveCardId = getStringMetadata(effect, 'selectedLiveCardId');
  const energyCost = getNumberMetadata(effect, 'selectedLiveScore');
  if (!player || !selectedLiveCardId || energyCost === null) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: energyCost },
  ]);
  if (!costPayment) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
    selectedLiveCardId,
    selectedLiveScore: energyCost,
  });
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    stateAfterCost,
    player.id,
    [selectedLiveCardId],
    {
      candidateCardIds: [selectedLiveCardId],
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...recoveryResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_SCORE_RECOVER_LIVE',
      selectedLiveCardId,
      selectedLiveScore: energyCost,
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      movedCardIds: recoveryResult.movedCardIds,
      discardedHandCardIds: getStringArrayMetadata(effect, 'discardedHandCardIds'),
    }),
    false
  );
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function getStringMetadata(effect: ActiveEffectState, key: string): string | null {
  const value = effect.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function getNumberMetadata(effect: ActiveEffectState, key: string): number | null {
  const value = effect.metadata?.[key];
  return typeof value === 'number' ? value : null;
}

function getStringArrayMetadata(effect: ActiveEffectState, key: string): readonly string[] {
  const value = effect.metadata?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}
