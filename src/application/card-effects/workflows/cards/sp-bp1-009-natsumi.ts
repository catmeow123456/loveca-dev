import { isMemberCardData } from '../../../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase } from '../../../../shared/types/enums.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID } from '../../ability-ids.js';
import {
  doesCardAbilityDefinitionMatchCardCode,
  findCardAbilityDefinitionById,
} from '../../definitions/lookup.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const SELECT_DISCARD_AFTER_DRAW_STEP_ID = 'SP_BP1_009_SELECT_DISCARD_AFTER_DRAW';

export function registerSpBp1009NatsumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
    startSpBp1009NatsumiActivated
  );
  registerActiveEffectStepHandler(
    SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
    SELECT_DISCARD_AFTER_DRAW_STEP_ID,
    (game, input, context) =>
      finishDrawThenDiscardCardsWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startSpBp1009NatsumiActivated(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const definition = findCardAbilityDefinitionById(
    SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID
  );
  const sourceSlot = player ? findMemberSlot(player, cardId) : null;
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    !definition ||
    !doesCardAbilityDefinitionMatchCardCode(definition, sourceCard.data.cardCode)
  ) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    abilityId: SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
    sourceCardId: cardId,
    sourceSlot,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  return startDrawThenDiscardCardsWorkflow(stateAfterCost, {
    ability: {
      id: `${SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID}:${cardId}:turn-${stateAfterCost.turnCount}:action-${stateAfterCost.actionHistory.length}`,
      abilityId: SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: player.id,
      sourceSlot,
    },
    effectText: getAbilityEffectText(
      SP_BP1_009_ACTIVATED_PAY_ONE_ENERGY_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    ),
    drawCount: 1,
    discardCount: 1,
    stepId: SELECT_DISCARD_AFTER_DRAW_STEP_ID,
    orderedResolution: false,
    recordAbilityUseOnStart: true,
  });
}
