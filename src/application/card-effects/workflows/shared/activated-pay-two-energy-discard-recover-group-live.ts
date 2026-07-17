import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById, type ActiveEffectState, type GameState } from '../../../../domain/entities/game.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  N_SD1_009_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
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
import { finishWaitingRoomToHandWorkflow } from './waiting-room-to-hand.js';

const ENERGY_COST = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface ActivatedDiscardRecoverGroupLiveConfig {
  readonly abilityId: string;
  readonly baseCardCode: string;
  readonly groupAlias: string;
  readonly discardCopy: {
    readonly stepText: string;
    readonly selectionLabel: string;
    readonly confirmSelectionLabel: string;
  };
  readonly recoveryCopy: {
    readonly stepText: string;
    readonly selectionLabel?: string;
    readonly confirmSelectionLabel?: string;
  };
  readonly discardStepId: string;
  readonly recoveryStepId: string;
  readonly startActionStep: string;
  readonly selectRecoveryActionStep: string;
  readonly noTargetActionStep: string;
}

const CONFIGS: readonly ActivatedDiscardRecoverGroupLiveConfig[] = [
  {
    abilityId: N_BP5_014_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    baseCardCode: 'PL!N-bp5-014',
    groupAlias: '虹ヶ咲',
    discardCopy: {
      stepText: '请选择1张手牌放置入休息室。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '支付费用',
    },
    recoveryCopy: {
      stepText: '请选择自己休息室1张「虹ヶ咲」LIVE卡加入手牌。',
      selectionLabel: '选择加入手牌的虹咲LIVE',
      confirmSelectionLabel: '加入手牌',
    },
    discardStepId: 'N_BP5_014_SELECT_HAND_CARD_TO_DISCARD',
    recoveryStepId: 'N_BP5_014_SELECT_NIJIGASAKI_LIVE_TO_HAND',
    startActionStep: 'START_SELECT_DISCARD_COST',
    selectRecoveryActionStep: 'PAY_COST_SELECT_NIJIGASAKI_LIVE',
    noTargetActionStep: 'PAY_COST_NO_NIJIGASAKI_LIVE_TARGET',
  },
  {
    abilityId: SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
    baseCardCode: 'PL!SP-sd2-006',
    groupAlias: 'Liella!',
    discardCopy: {
      stepText: '支付[E][E]，并选择1张手牌放置入休息室。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '支付费用',
    },
    recoveryCopy: {
      stepText: '请选择自己的休息室中1张『Liella!』LIVE卡加入手牌。',
    },
    discardStepId: 'SP_SD2_006_SELECT_HAND_CARD_TO_DISCARD',
    recoveryStepId: 'SP_SD2_006_SELECT_WAITING_ROOM_LIELLA_LIVE',
    startActionStep: 'START_PAY_ENERGY_SELECT_DISCARD',
    selectRecoveryActionStep: 'SELECT_WAITING_ROOM_LIELLA_LIVE',
    noTargetActionStep: 'NO_LIELLA_LIVE_TARGET_AFTER_COST',
  },
  {
    abilityId: N_SD1_009_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    baseCardCode: 'PL!N-sd1-009',
    groupAlias: '虹ヶ咲',
    discardCopy: {
      stepText: '支付[E][E]，并选择1张手牌放置入休息室。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '支付费用',
    },
    recoveryCopy: {
      stepText: '请选择自己的休息室中1张『虹咲』LIVE卡加入手牌。',
      selectionLabel: '选择要加入手牌的虹咲LIVE',
      confirmSelectionLabel: '加入手牌',
    },
    discardStepId: 'N_SD1_009_SELECT_HAND_CARD_TO_DISCARD',
    recoveryStepId: 'N_SD1_009_SELECT_WAITING_ROOM_NIJIGASAKI_LIVE',
    startActionStep: 'START_PAY_ENERGY_SELECT_DISCARD',
    selectRecoveryActionStep: 'SELECT_WAITING_ROOM_NIJIGASAKI_LIVE',
    noTargetActionStep: 'NO_NIJIGASAKI_LIVE_TARGET_AFTER_COST',
  },
];

export function registerActivatedPayTwoEnergyDiscardRecoverGroupLiveWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of CONFIGS) {
    registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) =>
      startWorkflow(game, playerId, cardId, config)
    );
    registerActiveEffectStepHandler(config.abilityId, config.discardStepId, (game, input, context) =>
      input.selectedCardId
        ? finishCost(
            game,
            input.selectedCardId,
            config,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : game
    );
    registerActiveEffectStepHandler(config.abilityId, config.recoveryStepId, (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        {
          currentCandidateCardIds: selectGroupLiveCardIds(game, game.activeEffect?.controllerId ?? '', config),
        }
      )
    );
  }
}

function startWorkflow(
  game: GameState,
  playerId: string,
  cardId: string,
  config: ActivatedDiscardRecoverGroupLiveConfig
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) return game;
  const player = getPlayerById(game, playerId);
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !sourceIsValid(game, playerId, cardId, config) ||
    player.hand.cardIds.length === 0 ||
    getActiveEnergyCardIds(game, playerId).length < ENERGY_COST
  ) {
    return game;
  }
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (sourceSlot === null) return game;

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${config.abilityId}:${cardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: config.abilityId,
        sourceCardId: cardId,
        controllerId: playerId,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: config.discardStepId,
        stepText: config.discardCopy.stepText,
        awaitingPlayerId: playerId,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: config.discardCopy.selectionLabel,
        confirmSelectionLabel: config.discardCopy.confirmSelectionLabel,
        canSkipSelection: false,
        metadata: {
          effectCosts: [
            { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
            { kind: 'DISCARD_HAND_TO_WAITING_ROOM', minCount: 1, maxCount: 1, optional: false },
          ],
          handToWaitingRoomCost: { minCount: 1, maxCount: 1, optional: false },
        },
      },
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      abilityId: config.abilityId,
      sourceCardId: cardId,
      sourceSlot,
      step: config.startActionStep,
      selectableCardIds: player.hand.cardIds,
      activeEnergyCardIds: getActiveEnergyCardIds(game, playerId),
    }
  );
}

function finishCost(
  game: GameState,
  discardCardId: string,
  config: ActivatedDiscardRecoverGroupLiveConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.discardStepId ||
    effect.selectableCardIds?.includes(discardCardId) !== true ||
    !sourceIsValid(game, effect.controllerId, effect.sourceCardId, config)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) return game;

  const energyPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
  ]);
  if (!energyPayment) return game;

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    energyPayment.gameState,
    player.id,
    discardCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) return game;

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

  const selectableCardIds = selectGroupLiveCardIds(state, player.id, config);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: config.noTargetActionStep,
        discardCardId: discardResult.discardedCardIds[0] ?? null,
        paidEnergyCardIds: energyPayment.paidEnergyCardIds,
        discardedHandCardIds: discardResult.discardedCardIds,
      }),
      false
    );
  }

  return startRecovery(state, effect, config, selectableCardIds, {
    paidEnergyCardIds: energyPayment.paidEnergyCardIds,
    discardedHandCardIds: discardResult.discardedCardIds,
  });
}

function startRecovery(
  game: GameState,
  effect: ActiveEffectState,
  config: ActivatedDiscardRecoverGroupLiveConfig,
  selectableCardIds: readonly string[],
  costMetadata: {
    readonly paidEnergyCardIds: readonly string[];
    readonly discardedHandCardIds: readonly string[];
  }
): GameState {
  return addAction(
    {
      ...game,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: effect.effectText,
        stepId: config.recoveryStepId,
        stepText: config.recoveryCopy.stepText,
        awaitingPlayerId: effect.controllerId,
        selectableCardIds,
        selectionLabel: config.recoveryCopy.selectionLabel,
        confirmSelectionLabel: config.recoveryCopy.confirmSelectionLabel,
        canSkipSelection: false,
        metadata: costMetadata,
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.selectRecoveryActionStep,
      selectableCardIds,
      ...costMetadata,
    }
  );
}

function sourceIsValid(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  config: ActivatedDiscardRecoverGroupLiveConfig
): boolean {
  const sourceCard = getCardById(game, sourceCardId);
  return (
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    isMemberCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, config.baseCardCode) &&
    getSourceMemberSlot(game, playerId, sourceCardId) !== null
  );
}

function selectGroupLiveCardIds(
  game: GameState,
  playerId: string,
  config: ActivatedDiscardRecoverGroupLiveConfig
): readonly string[] {
  return selectWaitingRoomCardIds(
    game,
    playerId,
    and(typeIs(CardType.LIVE), groupAliasIs(config.groupAlias))
  );
}

function getActiveEnergyCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return (
    player?.energyZone.cardIds.filter(
      (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
    ) ?? []
  );
}
