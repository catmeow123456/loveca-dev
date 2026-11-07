import { addAction, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, costLte, typeIs } from '../../../effects/card-selectors.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { HS_BP8_019_LIVE_START_PAY_ENERGY_RECYCLE_LOW_COST_MEMBERS_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import {
  startPendingActiveEffect,
  finishSkippedActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import { shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers } from '../../runtime/waiting-room-main-deck-triggers.js';

const PAY_STEP = 'HS_BP8_019_PAY_ENERGY_RECYCLE';
export function registerKimiToToshokanDeFushigiNaTabiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    if (!getPlayerById(game, ability.controllerId)) return game;
    if (
      getEnergySelectionCandidates(game, ability.controllerId, 'TAP_ACTIVE_ENERGY').length === 0
    ) {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: `${getAbilityEffectText(ABILITY_ID)}（当前无法支付[E]，实际不移动卡片。）`,
      });
      if (confirmation) return confirmation;
      return context.continuePendingCardEffects(
        addAction(
          {
            ...game,
            pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
          },
          'RESOLVE_ABILITY',
          ability.controllerId,
          {
            pendingAbilityId: ability.id,
            abilityId: ABILITY_ID,
            sourceCardId: ability.sourceCardId,
            step: 'NO_ACTIVE_ENERGY',
          }
        ),
        options.orderedResolution === true
      );
    }
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      actionPayload: { step: 'START_PAY_ENERGY_RECYCLE' },
      activeEffect: {
        id: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: PAY_STEP,
        stepText: '可以支付[E]，将休息室中所有费用小于等于9的成员混洗后放置于卡组底。',
        awaitingPlayerId: ability.controllerId,
        selectableOptions: [{ id: 'pay', label: '支付[E]' }],
        confirmSelectionLabel: '支付[E]',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: { orderedResolution: options.orderedResolution === true },
      },
    });
  });
  registerActiveEffectStepHandler(ABILITY_ID, PAY_STEP, (game, input, context) => {
    if (
      input.selectedOptionId === null ||
      input.selectedOptionId === undefined ||
      input.selectedOptionId === 'decline'
    ) {
      return finishSkippedActiveEffect(game, context.continuePendingCardEffects);
    }
    if (input.selectedOptionId !== 'pay') return game;
    const effect = game.activeEffect!;
    const payment = payImmediateEffectCosts(game, effect.controllerId, effect.sourceCardId, [
      { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
    ]);
    if (!payment) return finishSkippedActiveEffect(game, context.continuePendingCardEffects);
    const paid = recordPayCostAction(payment.gameState, effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      energyCardIds: payment.paidEnergyCardIds,
      amount: 1,
    });
    const cardIds = selectWaitingRoomCardIds(
      paid,
      effect.controllerId,
      and(typeIs(CardType.MEMBER), costLte(9))
    );
    const moved = shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
      paid,
      effect.controllerId,
      cardIds,
      {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: ABILITY_ID,
        pendingAbilityId: effect.id,
      }
    );
    if (!moved) return game;
    return context.continuePendingCardEffects(
      addAction(
        { ...moved.gameState, activeEffect: null },
        'RESOLVE_ABILITY',
        effect.controllerId,
        {
          pendingAbilityId: effect.id,
          abilityId: ABILITY_ID,
          sourceCardId: effect.sourceCardId,
          step: 'PAY_ENERGY_RECYCLE_LOW_COST_MEMBERS',
          paidEnergyCardIds: payment.paidEnergyCardIds,
          movedCardIds: moved.movedCardIds,
        }
      ),
      effect.metadata?.orderedResolution === true
    );
  });
}
