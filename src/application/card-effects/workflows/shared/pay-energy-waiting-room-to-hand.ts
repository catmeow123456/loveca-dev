import {
  isLiveCardData,
  isMemberCardData,
  type CardInstance,
} from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType, GamePhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
  HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
  HS_BP2_001_ACTIVATED_PAY_TWO_ENERGY_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
  PL_N_BP1_012_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID,
  SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID,
  SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
  type ZoneCardSelectionConfig,
} from '../../../effects/zone-selection.js';
import { finishWaitingRoomToHandWorkflow } from './waiting-room-to-hand.js';

const HS_BP1_003_SELECT_WAITING_ROOM_MEMBER_STEP_ID =
  'HS_BP1_003_SELECT_WAITING_ROOM_LOW_COST_MEMBER';
const HS_BP1_004_SELECT_WAITING_ROOM_LIVE_STEP_ID =
  'HS_BP1_004_SELECT_HASUNOSORA_LIVE_FROM_WAITING_ROOM';
const HS_BP2_001_SELECT_WAITING_ROOM_LIVE_STEP_ID =
  'HS_BP2_001_SELECT_LOW_SCORE_HASUNOSORA_LIVE_FROM_WAITING_ROOM';
const SP_SD1_005_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'SP_SD1_005_SELECT_WAITING_ROOM_LIVE';
const SP_SD1_007_PAY_ENERGY_STEP_ID = 'SP_SD1_007_PAY_ENERGY_FOR_LIELLA_MEMBER_RECOVERY';
const SP_SD1_007_SELECT_WAITING_ROOM_MEMBER_STEP_ID =
  'SP_SD1_007_SELECT_LIELLA_MEMBER_FROM_WAITING_ROOM';
const SP_SD1_007_ENERGY_COST = 2;
const SP_SD1_007_LIELLA_MEMBER_SELECTOR = and(
  typeIs(CardType.MEMBER),
  groupAliasIs('Liella!')
);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface PayEnergyWaitingRoomToHandWorkflowConfig {
  readonly abilityId: string;
  readonly expectedBaseCardCodes: readonly string[];
  readonly energyCost: number;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel?: string;
  readonly confirmSelectionLabel?: string;
  readonly selector: (card: CardInstance) => boolean;
  readonly zoneSelection: ZoneCardSelectionConfig;
  readonly canSkipSelection?: boolean;
  readonly actionStep: string;
}

const PAY_ENERGY_WAITING_ROOM_TO_HAND_WORKFLOWS: readonly PayEnergyWaitingRoomToHandWorkflowConfig[] =
  [
    {
      abilityId: HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
      expectedBaseCardCodes: ['PL!HS-bp1-003'],
      energyCost: 1,
      stepId: HS_BP1_003_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
      stepText: '请选择自己的休息室中1张费用小于等于4的『莲之空』成员卡加入手牌。',
      selector: and(typeIs(CardType.MEMBER), costLte(4), groupAliasIs('蓮ノ空')),
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
      canSkipSelection: false,
      actionStep: 'PAY_COST_SELECT_WAITING_ROOM_MEMBER',
    },
    {
      abilityId: HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
      expectedBaseCardCodes: ['PL!HS-bp1-004'],
      energyCost: 3,
      stepId: HS_BP1_004_SELECT_WAITING_ROOM_LIVE_STEP_ID,
      stepText: '请选择自己的休息室中1张『莲之空』的LIVE卡加入手牌。',
      selector: and(typeIs(CardType.LIVE), groupAliasIs('蓮ノ空')),
      zoneSelection: createWaitingRoomToHandSelectionConfig(),
      actionStep: 'PAY_COST_SELECT_WAITING_ROOM_LIVE',
    },
    {
      abilityId: HS_BP2_001_ACTIVATED_PAY_TWO_ENERGY_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
      expectedBaseCardCodes: ['PL!HS-bp2-001'],
      energyCost: 2,
      stepId: HS_BP2_001_SELECT_WAITING_ROOM_LIVE_STEP_ID,
      stepText: '请选择自己的休息室中1张分数小于等于3的『莲之空』LIVE卡加入手牌。',
      selector: and(
        typeIs(CardType.LIVE),
        groupAliasIs('蓮ノ空'),
        (card) => isLiveCardData(card.data) && card.data.score <= 3
      ),
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
      canSkipSelection: false,
      actionStep: 'PAY_COST_SELECT_LOW_SCORE_HASUNOSORA_LIVE',
    },
    {
      abilityId: PL_N_BP1_012_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID,
      expectedBaseCardCodes: ['PL!N-bp1-012'],
      energyCost: 3,
      stepId: 'PL_N_BP1_012_SELECT_WAITING_ROOM_LIVE',
      stepText: '请选择自己的休息室中1张LIVE卡加入手牌。',
      selector: typeIs(CardType.LIVE),
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
      canSkipSelection: false,
      actionStep: 'PAY_COST_SELECT_WAITING_ROOM_LIVE',
    },
    {
      abilityId: SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID,
      expectedBaseCardCodes: ['PL!SP-sd1-005'],
      energyCost: 3,
      stepId: SP_SD1_005_SELECT_WAITING_ROOM_LIVE_STEP_ID,
      stepText: '请选择自己的休息室中1张LIVE卡加入手牌。',
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      selector: typeIs(CardType.LIVE),
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
      canSkipSelection: false,
      actionStep: 'PAY_COST_SELECT_WAITING_ROOM_LIVE',
    },
  ];

export function registerPayEnergyWaitingRoomToHandWorkflowHandlers(): void {
  for (const config of PAY_ENERGY_WAITING_ROOM_TO_HAND_WORKFLOWS) {
    registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) =>
      startPayEnergyWaitingRoomToHandWorkflow(game, playerId, cardId, config)
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
    );
  }
  registerSpSd1007OnEnterOptionalPaymentHandlers();
}

function registerSpSd1007OnEnterOptionalPaymentHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startSpSd1007OnEnterOptionalPayment(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
    SP_SD1_007_PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishSpSd1007Payment(game, context.continuePendingCardEffects)
        : finishSpSd1007Decline(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
    SP_SD1_007_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    (game, input, context) => {
      const effect = game.activeEffect;
      const currentCandidateCardIds = effect
        ? selectSpSd1007WaitingRoomMemberCardIds(game, effect.controllerId)
        : [];
      return finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        { currentCandidateCardIds }
      );
    }
  );
}

function startSpSd1007OnEnterOptionalPayment(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  const selectableCardIds = selectSpSd1007WaitingRoomMemberCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return consumeSpSd1007Pending(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_LIELLA_MEMBER_TARGET'
    );
  }

  const activeEnergyCardIds = getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY');
  const canPay = activeEnergyCardIds.length >= SP_SD1_007_ENERGY_COST;
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SP_SD1_007_PAY_ENERGY_STEP_ID,
      stepText: canPay
        ? '可以支付[E][E]；如此做时，从自己的休息室将1张『Liella!』的成员卡加入手牌。'
        : '当前活跃能量不足，无法支付[E][E]，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay ? [{ id: 'pay', label: '支付[E][E]' }] : [],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_OPTIONAL_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER',
      selectableCardIds,
      activeEnergyCardIds,
    },
  });
}

function finishSpSd1007Decline(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID ||
    effect.stepId !== SP_SD1_007_PAY_ENERGY_STEP_ID
  ) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DECLINE_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER',
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishSpSd1007Payment(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID ||
    effect.stepId !== SP_SD1_007_PAY_ENERGY_STEP_ID
  ) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: SP_SD1_007_ENERGY_COST },
  ]);
  if (!costPayment) return game;

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const selectableCardIds = selectSpSd1007WaitingRoomMemberCardIds(stateAfterCost, player.id);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_LIELLA_MEMBER_TARGET_AFTER_COST',
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
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
        stepId: SP_SD1_007_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
        stepText: '请选择自己的休息室中1张『Liella!』的成员卡加入手牌。',
        selectionLabel: '选择要加入手牌的卡',
        confirmSelectionLabel: '加入手牌',
        awaitingPlayerId: player.id,
        selectableCardIds,
        canSkipSelection: false,
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
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
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_TWO_ENERGY_SELECT_LIELLA_MEMBER',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
    }
  );
}

function consumeSpSd1007Pending(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'NO_OP_OPTIONAL_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER',
      reason,
    }),
    orderedResolution
  );
}

function selectSpSd1007WaitingRoomMemberCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, SP_SD1_007_LIELLA_MEMBER_SELECTOR);
}

function startPayEnergyWaitingRoomToHandWorkflow(
  game: GameState,
  playerId: string,
  cardId: string,
  config: PayEnergyWaitingRoomToHandWorkflowConfig
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
    !findMemberSlot(player, cardId)
  ) {
    return game;
  }

  const selectableCardIds = selectWaitingRoomCardIds(game, player.id, config.selector);
  if (selectableCardIds.length === 0) {
    return game;
  }

  let state = recordAbilityUseForContext(game, player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
  });
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: config.energyCost },
  ]);
  if (!costPayment) {
    return game;
  }
  state = addAction(costPayment.gameState, 'PAY_COST', player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  state = {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: `${config.abilityId}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: config.abilityId,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.stepId,
      stepText: config.stepText,
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel: config.confirmSelectionLabel,
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: config.canSkipSelection,
      metadata: {
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
      },
      zoneSelection: config.zoneSelection,
    }),
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
    step: config.actionStep,
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
    selectableCardIds,
  });
}
