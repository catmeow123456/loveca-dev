import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { SP_BP1_002_ON_ENTER_LEFT_PAY_TWO_ENERGY_DRAW_TWO_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const PAY_TWO_ENERGY_STEP_ID = 'SP_BP1_002_PAY_TWO_ENERGY';

export function registerSpBp1002KekeWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP1_002_ON_ENTER_LEFT_PAY_TWO_ENERGY_DRAW_TWO_ABILITY_ID,
    (game, ability, options, context) =>
      startSpBp1002KekeWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP1_002_ON_ENTER_LEFT_PAY_TWO_ENERGY_DRAW_TWO_ABILITY_ID,
    PAY_TWO_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? payAndDraw(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_PAY_TWO_ENERGY',
          })
  );
}

function startSpBp1002KekeWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const activeEnergyCount =
    player?.energyZone.cardIds.filter(
      (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
    ).length ?? 0;
  if (!player || ability.sourceSlot !== SlotPosition.LEFT || activeEnergyCount < 2) {
    return consumePendingAbility(game, ability, orderedResolution, continuePendingCardEffects);
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: PAY_TWO_ENERGY_STEP_ID,
      stepText: '可以支付[E][E]：若登场于舞台的左侧区域，则抽2张卡。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: 'pay', label: '支付[E][E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution, enteredSlot: ability.sourceSlot },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_PAY_TWO_ENERGY_OPTION',
    },
  });
}

function payAndDraw(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.stepId !== PAY_TWO_ENERGY_STEP_ID ||
    !player ||
    effect.metadata?.enteredSlot !== SlotPosition.LEFT
  ) {
    return game;
  }

  const payment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!payment) {
    return game;
  }
  const stateAfterPayment = recordPayCostAction(payment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: SlotPosition.LEFT,
    energyCardIds: payment.paidEnergyCardIds,
    amount: payment.paidEnergyCardIds.length,
  });
  const drawResult = drawCardsForPlayer(stateAfterPayment, player.id, 2);
  const resolved = addAction(
    { ...(drawResult?.gameState ?? stateAfterPayment), activeEffect: null },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: SlotPosition.LEFT,
      step: 'PAY_TWO_ENERGY_DRAW_TWO',
      energyCardIds: payment.paidEnergyCardIds,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }
  );
  return continuePendingCardEffects(resolved, effect.metadata?.orderedResolution === true);
}

function consumePendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    },
    orderedResolution
  );
}
