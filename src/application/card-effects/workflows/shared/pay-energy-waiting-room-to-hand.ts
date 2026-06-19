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
import {
  HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
  HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import {
  and,
  costLte,
  groupAliasIs,
  typeIs,
} from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
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

interface PayEnergyWaitingRoomToHandWorkflowConfig {
  readonly abilityId: string;
  readonly expectedBaseCardCodes: readonly string[];
  readonly energyCost: number;
  readonly stepId: string;
  readonly stepText: string;
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
