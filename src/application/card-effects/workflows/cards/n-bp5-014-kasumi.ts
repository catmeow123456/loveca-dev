import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID } from '../../ability-ids.js';
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

const SELECT_DISCARD_STEP_ID = 'N_BP5_014_SELECT_HAND_CARD_TO_DISCARD';
const SELECT_RECOVERY_STEP_ID = 'N_BP5_014_SELECT_NIJIGASAKI_LIVE_TO_HAND';
const ENERGY_COST = 2;

const nijigasakiLiveSelector = and(typeIs(CardType.LIVE), groupAliasIs('虹ヶ咲'));

export function registerNBp5014KasumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    startKasumiPayEnergyDiscardRecoverLive
  );
  registerActiveEffectStepHandler(
    N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input) =>
      input.selectedCardId
        ? finishKasumiCost(game, input.selectedCardId, deps.enqueueTriggeredCardEffects)
        : game
  );
  registerActiveEffectStepHandler(
    N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    SELECT_RECOVERY_STEP_ID,
    (game, input) => finishKasumiRecovery(game, input.selectedCardId ?? null)
  );
}

function startKasumiPayEnergyDiscardRecoverLive(
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
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-bp5-014') ||
    sourceSlot === null ||
    player.hand.cardIds.length === 0 ||
    getActiveEnergyCardIds(game, player.id).length < ENERGY_COST
  ) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
        ),
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '支付费用',
        canSkipSelection: false,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
      sourceCardId: cardId,
      sourceSlot,
      step: 'START_SELECT_DISCARD_COST',
      selectableCardIds: player.hand.cardIds,
      activeEnergyCardIds: getActiveEnergyCardIds(game, player.id),
    }
  );
}

function finishKasumiCost(
  game: GameState,
  discardCardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const energyPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
  ]);
  if (!energyPayment) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    energyPayment.gameState,
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

  let state = recordPayCostAction(discardResult.gameState, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: energyPayment.paidEnergyCardIds,
    amount: energyPayment.paidEnergyCardIds.length,
    discardedHandCardIds: discardResult.discardedCardIds,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });

  const selectableLiveCardIds = selectWaitingRoomCardIds(
    state,
    player.id,
    nijigasakiLiveSelector
  );
  if (selectableLiveCardIds.length === 0) {
    return addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_COST_NO_NIJIGASAKI_LIVE_TARGET',
      paidEnergyCardIds: energyPayment.paidEnergyCardIds,
      discardedHandCardIds: discardResult.discardedCardIds,
    });
  }

  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: SELECT_RECOVERY_STEP_ID,
        stepText: '请选择自己休息室1张「虹ヶ咲」LIVE卡加入手牌。',
        selectableCardIds: selectableLiveCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择加入手牌的虹咲LIVE',
        confirmSelectionLabel: '加入手牌',
        metadata: {
          publicCardSelectionConfirmation: { destination: 'HAND' },
          paidEnergyCardIds: energyPayment.paidEnergyCardIds,
          discardedHandCardIds: discardResult.discardedCardIds,
          recoveryCandidateCardIds: selectableLiveCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_COST_SELECT_NIJIGASAKI_LIVE',
      paidEnergyCardIds: energyPayment.paidEnergyCardIds,
      discardedHandCardIds: discardResult.discardedCardIds,
      selectableCardIds: selectableLiveCardIds,
    }
  );
}

function finishKasumiRecovery(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_RECOVERY_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const candidateCardIds = getStringArrayMetadata(effect, 'recoveryCandidateCardIds');
  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds,
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  return addAction({ ...recoveryResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'RECOVER_NIJIGASAKI_LIVE',
    selectedCardId,
    movedCardIds: recoveryResult.movedCardIds,
    paidEnergyCardIds: getStringArrayMetadata(effect, 'paidEnergyCardIds'),
    discardedHandCardIds: getStringArrayMetadata(effect, 'discardedHandCardIds'),
  });
}

function getActiveEnergyCardIds(game: GameState, playerId: string): string[] {
  const player = getPlayerById(game, playerId);
  return (
    player?.energyZone.cardIds.filter(
      (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
    ) ?? []
  );
}

function getStringArrayMetadata(
  effect: NonNullable<GameState['activeEffect']>,
  key: string
): readonly string[] {
  const value = effect.metadata?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}
