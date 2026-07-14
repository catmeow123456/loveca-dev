import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import {
  payImmediateEffectCosts,
  type EffectCostDefinition,
} from '../../../effects/effect-costs.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { HS_PB1_007_ON_ENTER_PAY_TWO_ENERGY_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID } from '../../ability-ids.js';
import { finishSkippedActiveEffect } from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const ENERGY_COST = 2;
const DISCARD_COUNT = 1;
const SELECT_DISCARD_STEP_ID = 'HS_PB1_007_SELECT_HAND_CARD_TO_DISCARD';
const SELECT_HASUNOSORA_CARD_STEP_ID = 'HS_PB1_007_SELECT_HASUNOSORA_CARD_FROM_WAITING_ROOM';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsPb1007SerasWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_007_ON_ENTER_PAY_TWO_ENERGY_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1007SerasOnEnterPayDiscardRecover(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_007_ON_ENTER_PAY_TWO_ENERGY_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishHsPb1007SerasDiscardCost(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'SKIP_PAY_ENERGY_DISCARD_COST',
          })
  );
  registerActiveEffectStepHandler(
    HS_PB1_007_ON_ENTER_PAY_TWO_ENERGY_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID,
    SELECT_HASUNOSORA_CARD_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startHsPb1007SerasOnEnterPayDiscardRecover(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  if (activeEnergyCardIds.length < ENERGY_COST || player.hand.cardIds.length < DISCARD_COUNT) {
    return finishWithoutEffect(
      game,
      ability,
      options.orderedResolution === true,
      continuePendingCardEffects,
      activeEnergyCardIds.length < ENERGY_COST
        ? 'NOT_ENOUGH_ACTIVE_ENERGY'
        : 'NOT_ENOUGH_HAND_TO_DISCARD',
      activeEnergyCardIds
    );
  }

  const energyCost: EffectCostDefinition = { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST };
  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: DISCARD_COUNT,
    maxCount: DISCARD_COUNT,
    optional: true,
  };

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(
          HS_PB1_007_ON_ENTER_PAY_TWO_ENERGY_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID
        ),
        stepId: SELECT_DISCARD_STEP_ID,
        stepText: '可以支付[E][E]并将1张手牌放置入休息室。也可以选择不发动此效果。',
        awaitingPlayerId: player.id,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '支付费用',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution: options.orderedResolution === true,
          effectCosts: [energyCost, discardCost],
          handToWaitingRoomCost: {
            minCount: discardCost.minCount,
            maxCount: discardCost.maxCount,
            optional: discardCost.optional,
          },
          activeEnergyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_TWO_ENERGY_SELECT_DISCARD',
      selectableCardIds: player.hand.cardIds,
      activeEnergyCardIds,
    }
  );
}

function finishHsPb1007SerasDiscardCost(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_PB1_007_ON_ENTER_PAY_TWO_ENERGY_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID ||
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

  const selectableCardIds = selectWaitingRoomCardIds(
    discardResult.gameState,
    player.id,
    groupAliasIs('蓮ノ空')
  );
  const stateWithCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: energyPayment.paidEnergyCardIds,
    amount: energyPayment.paidEnergyCardIds.length,
    discardedHandCardIds: discardResult.discardedCardIds,
    selectableCardIds,
  });
  const orderedResolution = effect.metadata?.orderedResolution === true;

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateWithCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_COST_NO_HASUNOSORA_TARGET',
        energyCardIds: energyPayment.paidEnergyCardIds,
        discardedHandCardIds: discardResult.discardedCardIds,
      }),
      orderedResolution
    );
  }

  return {
    ...stateWithCost,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      effectText: effect.effectText,
      stepId: SELECT_HASUNOSORA_CARD_STEP_ID,
      stepText: '请选择自己的休息室中1张『莲之空』卡片加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        paidEnergyCardIds: energyPayment.paidEnergyCardIds,
        discardedHandCardIds: discardResult.discardedCardIds,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
}

function finishWithoutEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string,
  activeEnergyCardIds: readonly string[]
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: reason,
      conditionMet: false,
      reason,
      activeEnergyCardIds,
    }),
    orderedResolution
  );
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
