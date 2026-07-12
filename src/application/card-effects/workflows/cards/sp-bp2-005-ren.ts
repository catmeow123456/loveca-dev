import { getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID } from '../../ability-ids.js';
import { finishSkippedActiveEffect, startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import {
  finishRevealedLookTopSelectToHandWorkflow,
  resolveLookTopSelectToHandSelection,
  startLookTopSelectToHandWorkflow,
} from '../shared/look-top-select-to-hand.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const PAY_TWO_ENERGY_STEP_ID = 'SP_BP2_005_PAY_TWO_ENERGY';
const SELECT_LIELLA_CARD_STEP_ID = 'SP_BP2_005_SELECT_LIELLA_CARD_FROM_TOP_SEVEN';
const REVEAL_LIELLA_CARD_STEP_ID = 'SP_BP2_005_REVEAL_SELECTED_LIELLA_CARD';

export function registerSpBp2005RenWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID,
    (game, ability, options, context) =>
      startSpBp2005RenWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID,
    PAY_TWO_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? payAndStartInspection(
            game,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_PAY_TWO_ENERGY',
          })
  );
  registerActiveEffectStepHandler(
    SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID,
    SELECT_LIELLA_CARD_STEP_ID,
    (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        }
      )
  );
  registerActiveEffectStepHandler(
    SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID,
    REVEAL_LIELLA_CARD_STEP_ID,
    (game, _input, context) =>
      finishRevealedLookTopSelectToHandWorkflow(game, {
        continuePendingCardEffects: context.continuePendingCardEffects,
        enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
      })
  );
}

function startSpBp2005RenWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || findMemberSlot(player, ability.sourceCardId) === null) {
    return consumePendingAbility(game, ability, orderedResolution, continuePendingCardEffects);
  }
  const activeEnergyCardIds = player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
  );
  if (activeEnergyCardIds.length < 2) {
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
      stepText: '可以支付[E][E]：检视自己卡组顶的7张卡。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: 'pay', label: '支付[E][E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_TWO_ENERGY_OPTION',
    },
  });
}

function payAndStartInspection(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.stepId !== PAY_TWO_ENERGY_STEP_ID ||
    !player ||
    findMemberSlot(player, effect.sourceCardId) === null
  ) {
    return effect
      ? finishSkippedActiveEffect(game, continuePendingCardEffects, {
          step: 'PAY_TWO_ENERGY_SOURCE_INVALID',
        })
      : game;
  }

  const payment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!payment) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects, {
      step: 'PAY_TWO_ENERGY_FAILED',
    });
  }
  const stateAfterPayment = recordPayCostAction(payment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: payment.paidEnergyCardIds,
    amount: payment.paidEnergyCardIds.length,
  });

  return startLookTopSelectToHandWorkflow(
    { ...stateAfterPayment, activeEffect: null },
    effect,
    {
      effectText: effect.effectText,
      topCount: 7,
      selector: (card) => card.ownerId === player.id && groupAliasIs('Liella!')(card),
      countRule: { minCount: 0, maxCount: 1 },
      revealSelectedBeforeHand: true,
      selectStepId: SELECT_LIELLA_CARD_STEP_ID,
      revealStepId: REVEAL_LIELLA_CARD_STEP_ID,
      selectStepText:
        '请选择至多1张『Liella!』卡片公开并加入手牌。也可以不加入。',
      noTargetStepText:
        '没有可加入手牌的『Liella!』卡片。确认后其余卡片放置入休息室。',
      selectionLabel: '选择要公开并加入手牌的『Liella!』卡片',
      confirmSelectionLabel: '公开并加入手牌',
      skipSelectionLabel: '不加入',
      revealStepText:
        '选择的卡片已公开。确认后加入手牌，其余卡片放置入休息室。',
      startActionStep: 'START_LOOK_TOP_SEVEN_LIELLA_CARD',
      revealActionStep: 'REVEAL_SELECTED_LIELLA_CARD',
      finishActionStep: 'TAKE_LIELLA_CARD_REST_TO_WAITING_ROOM',
    },
    {
      orderedResolution: effect.metadata?.orderedResolution === true,
      continuePendingCardEffects,
      enqueueTriggeredCardEffects,
    }
  );
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
