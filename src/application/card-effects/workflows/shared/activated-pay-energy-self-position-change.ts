import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase, SlotPosition } from '../../../../shared/types/enums.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { isDirectOrRenGrantedActivatedAbilitySource } from '../../runtime/granted-activated-abilities.js';
import type { EnqueueTriggeredCardEffectsForMemberSlotMoved } from '../../runtime/member-slot-moved-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import {
  createMandatoryActivatedSelfPositionChangeActiveEffect,
  finishMandatoryActivatedSelfPositionChange,
} from './activated-self-position-change.js';
import {
  SP_BP2_008_ACTIVATED_PAY_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
  SP_SD2_002_ACTIVATED_PAY_TWO_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
} from '../../ability-ids.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface ActivatedPayEnergySelfPositionChangeConfig {
  readonly abilityId: string;
  readonly baseCardCodes: readonly string[];
  readonly energyCostCount: number;
  readonly stepId: string;
  readonly actionStep: string;
  readonly payloadLabel: string;
}

const ACTIVATED_PAY_ENERGY_SELF_POSITION_CHANGE_CONFIGS: readonly ActivatedPayEnergySelfPositionChangeConfig[] =
  [
    {
      abilityId: SP_BP2_008_ACTIVATED_PAY_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      baseCardCodes: ['PL!SP-bp2-008'],
      energyCostCount: 1,
      stepId: 'SP_BP2_008_SELF_POSITION_CHANGE',
      actionStep: 'PAY_ENERGY_SELF_POSITION_CHANGE',
      payloadLabel: 'energyCostCardIds',
    },
    {
      abilityId: SP_SD2_002_ACTIVATED_PAY_TWO_ENERGY_SELF_POSITION_CHANGE_ABILITY_ID,
      baseCardCodes: ['PL!SP-sd2-002'],
      energyCostCount: 2,
      stepId: 'SP_SD2_002_SELF_POSITION_CHANGE',
      actionStep: 'PAY_TWO_ENERGY_SELF_POSITION_CHANGE',
      payloadLabel: 'energyCostCardIds',
    },
  ];

export function registerActivatedPayEnergySelfPositionChangeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  for (const config of ACTIVATED_PAY_ENERGY_SELF_POSITION_CHANGE_CONFIGS) {
    registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) =>
      startActivatedPayEnergySelfPositionChange(game, playerId, cardId, config)
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishActivatedPayEnergySelfPositionChange(
        game,
        input.selectedSlot ?? null,
        config,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function startActivatedPayEnergySelfPositionChange(
  game: GameState,
  playerId: string,
  cardId: string,
  config: ActivatedPayEnergySelfPositionChangeConfig
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = player ? findMemberSlot(player, cardId) : null;
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isDirectOrRenGrantedActivatedAbilitySource(
      game,
      playerId,
      cardId,
      config.abilityId,
      config.baseCardCodes
    ) ||
    sourceSlot === null
  ) {
    return game;
  }

  if (
    getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY').length <
    config.energyCostCount
  ) {
    return game;
  }

  let state = recordAbilityUseForContext(game, player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
  });
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: config.energyCostCount },
  ]);
  if (!costPayment) {
    return game;
  }
  state = recordPayCostAction(costPayment.gameState, player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  return addAction(
    {
      ...state,
      activeEffect: createMandatoryActivatedSelfPositionChangeActiveEffect({
        id: `${config.abilityId}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: config.abilityId,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: config.stepId,
        sourceSlot,
        metadata: {
          energyCostCount: config.energyCostCount,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
        },
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: config.abilityId,
      sourceCardId: cardId,
      step: config.actionStep,
      sourceSlot,
      energyCostCount: config.energyCostCount,
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      [config.payloadLabel]: costPayment.paidEnergyCardIds,
    }
  );
}

function finishActivatedPayEnergySelfPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  config: ActivatedPayEnergySelfPositionChangeConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  return finishMandatoryActivatedSelfPositionChange(
    game,
    selectedSlot,
    {
      abilityId: config.abilityId,
      baseCardCodes: config.baseCardCodes,
      stepId: config.stepId,
    },
    continuePendingCardEffects,
    enqueueTriggeredCardEffects
  );
}
