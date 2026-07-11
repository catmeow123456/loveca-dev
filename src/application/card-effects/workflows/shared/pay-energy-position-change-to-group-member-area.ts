import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export interface PayEnergyPositionChangeToGroupMemberAreaConfig {
  readonly abilityId: string;
  readonly baseCardCode: string;
  readonly stepId: string;
  readonly targetGroupAliases: readonly string[];
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly confirmSelectionLabel: string;
}

export function registerPayEnergyPositionChangeToGroupMemberAreaWorkflowHandlers(
  config: PayEnergyPositionChangeToGroupMemberAreaConfig,
  deps: {
    readonly enqueueMemberSlotMovedCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
  }
): void {
  registerActivatedAbilityHandler(config.abilityId, (game, playerId, cardId) =>
    startPayEnergyPositionChangeToGroupMemberArea(
      game,
      playerId,
      cardId,
      config
    )
  );
  registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
    finishPayEnergyPositionChangeToGroupMemberArea(
      game,
      input.selectedSlot ?? null,
      config,
      context.continuePendingCardEffects,
      deps.enqueueMemberSlotMovedCardEffects
    )
  );
}

function startPayEnergyPositionChangeToGroupMemberArea(
  game: GameState,
  playerId: string,
  cardId: string,
  config: PayEnergyPositionChangeToGroupMemberAreaConfig
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
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, config.baseCardCode) ||
    sourceSlot === null
  ) {
    return game;
  }

  const targetSlots = getLegalPositionChangeTargetSlots(game, player.id, sourceSlot, config);
  if (targetSlots.length === 0) {
    return game;
  }

  if (getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY').length < 1) {
    return game;
  }

  let state = recordAbilityUseForContext(game, player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
  });
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
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
      activeEffect: {
        id: `${config.abilityId}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId: config.abilityId,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: config.stepId,
        stepText: config.stepText,
        awaitingPlayerId: player.id,
        selectableSlots: targetSlots,
        selectionLabel: config.selectionLabel,
        confirmSelectionLabel: config.confirmSelectionLabel,
        canSkipSelection: false,
        metadata: {
          sourceSlot,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: config.abilityId,
      sourceCardId: cardId,
      step: 'PAY_ENERGY_SELECT_POSITION_CHANGE_TARGET',
      sourceSlot,
      selectableSlots: targetSlots,
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
    }
  );
}

function finishPayEnergyPositionChangeToGroupMemberArea(
  game: GameState,
  selectedSlot: SlotPosition | null,
  config: PayEnergyPositionChangeToGroupMemberAreaConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueMemberSlotMovedCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.stepId ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? findMemberSlot(player, effect.sourceCardId) : null;
  if (
    !player ||
    sourceSlot === null ||
    sourceSlot === selectedSlot ||
    !getLegalPositionChangeTargetSlots(game, player.id, sourceSlot, config).includes(selectedSlot)
  ) {
    return game;
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    player.id,
    effect.sourceCardId,
    selectedSlot,
    enqueueMemberSlotMovedCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'POSITION_CHANGE',
            fromSlot: result.fromSlot,
            toSlot: result.toSlot,
            swappedCardId: result.swappedCardId,
            paidEnergyCardIds: effect.metadata?.paidEnergyCardIds,
          }
        ),
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(moveResult.gameState, false);
}

function getLegalPositionChangeTargetSlots(
  game: GameState,
  playerId: string,
  sourceSlot: SlotPosition,
  config: Pick<PayEnergyPositionChangeToGroupMemberAreaConfig, 'targetGroupAliases'>
): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return (Object.values(SlotPosition) as SlotPosition[]).filter((slot) => {
    if (slot === sourceSlot) {
      return false;
    }
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return (
      card !== null &&
      card.ownerId === playerId &&
      isMemberCardData(card.data) &&
      config.targetGroupAliases.some((groupName) => groupAliasIs(groupName)(card))
    );
  });
}
