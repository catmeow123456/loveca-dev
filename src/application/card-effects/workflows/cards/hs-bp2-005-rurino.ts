import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  HS_BP2_005_LIVE_START_PAY_ENERGY_FULL_STAGE_GAIN_TWO_BLADE_ABILITY_ID,
  HS_BP2_005_ON_ENTER_DISCARD_RECOVER_MIRACRA_CARD_ABILITY_ID,
} from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const HS_BP2_005_SELECT_DISCARD_STEP_ID = 'HS_BP2_005_SELECT_DISCARD_FOR_MIRACRA_RECOVERY';
const HS_BP2_005_SELECT_RECOVERY_STEP_ID = 'HS_BP2_005_SELECT_MIRACRA_CARD_FROM_WAITING_ROOM';
const HS_BP2_005_PAY_ENERGY_STEP_ID = 'HS_BP2_005_LIVE_START_PAY_ENERGY';
const DECLINE_OPTION_LABEL = '不发动';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp2005RurinoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP2_005_ON_ENTER_DISCARD_RECOVER_MIRACRA_CARD_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp2005OnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP2_005_ON_ENTER_DISCARD_RECOVER_MIRACRA_CARD_ABILITY_ID,
    HS_BP2_005_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishHsBp2005DiscardForRecovery(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP2_005_ON_ENTER_DISCARD_RECOVER_MIRACRA_CARD_ABILITY_ID,
    HS_BP2_005_SELECT_RECOVERY_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    HS_BP2_005_LIVE_START_PAY_ENERGY_FULL_STAGE_GAIN_TWO_BLADE_ABILITY_ID,
    (game, ability, options) =>
      startHsBp2005LiveStart(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_BP2_005_LIVE_START_PAY_ENERGY_FULL_STAGE_GAIN_TWO_BLADE_ABILITY_ID,
    HS_BP2_005_PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishHsBp2005LiveStartPayEnergy(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startHsBp2005OnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.hand.cardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_HAND_FOR_MIRACRA_RECOVERY',
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(HS_BP2_005_ON_ENTER_DISCARD_RECOVER_MIRACRA_CARD_ABILITY_ID),
      stepId: HS_BP2_005_SELECT_DISCARD_STEP_ID,
      stepText: '请选择1张手牌放置入休息室。也可以选择不发动此效果。',
      selectionLabel: '选择要放置入休息室的手牌',
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
      metadata: {
        recoveryStepId: HS_BP2_005_SELECT_RECOVERY_STEP_ID,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_FOR_MIRACRA_RECOVERY',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishHsBp2005DiscardForRecovery(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== HS_BP2_005_ON_ENTER_DISCARD_RECOVER_MIRACRA_CARD_ABILITY_ID ||
    effect.stepId !== HS_BP2_005_SELECT_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(discardResult.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
  });
  const hasOtherMember = ownStageHasOtherMember(stateAfterCost, player.id, effect.sourceCardId);
  const selectableCardIds = hasOtherMember
    ? selectWaitingRoomCardIds(stateAfterCost, player.id, unitAliasIs('Mira-Cra Park!'))
    : [];

  if (selectableCardIds.length === 0) {
    return finishActiveEffect(
      {
        ...stateAfterCost,
        activeEffect: effect,
      },
      continuePendingCardEffects,
      {
        step: hasOtherMember
          ? 'DISCARD_RECOVER_MIRACRA_CARD_NO_TARGET'
          : 'DISCARD_RECOVER_MIRACRA_CARD_NO_OTHER_MEMBER',
        discardedCardIds: discardResult.discardedCardIds,
        selectableCardIds,
      }
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
        stepId: HS_BP2_005_SELECT_RECOVERY_STEP_ID,
        stepText: '请选择自己的休息室中1张『みらくらぱーく！』卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          ...effect.metadata,
          orderedResolution: effect.metadata?.orderedResolution === true,
          discardedHandCardIds: discardResult.discardedCardIds,
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
      step: 'DISCARD_SELECT_MIRACRA_CARD',
      discardedCardIds: discardResult.discardedCardIds,
      selectableCardIds,
    }
  );
}

function startHsBp2005LiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const canPay = activeEnergyCardIds.length >= 1;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(
        HS_BP2_005_LIVE_START_PAY_ENERGY_FULL_STAGE_GAIN_TWO_BLADE_ABILITY_ID
      ),
      stepId: HS_BP2_005_PAY_ENERGY_STEP_ID,
      stepText: canPay
        ? '可以支付1张活跃能量；支付后若三个舞台区域都有成员，则获得2个BLADE。'
        : '当前没有可支付的活跃能量，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay
        ? [
            { id: 'pay', label: '支付1能量' },
            { id: 'decline', label: DECLINE_OPTION_LABEL },
          ]
        : [{ id: 'decline', label: DECLINE_OPTION_LABEL }],
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
        energyCostCount: 1,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_FULL_STAGE_BLADE_OPTION',
      activeEnergyCardIds,
    },
  });
}

function finishHsBp2005LiveStartPayEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== HS_BP2_005_LIVE_START_PAY_ENERGY_FULL_STAGE_GAIN_TWO_BLADE_ABILITY_ID ||
    effect.stepId !== HS_BP2_005_PAY_ENERGY_STEP_ID
  ) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const fullStage = ownStageIsFull(stateAfterCost, player.id);
  let stateAfterModifier = stateAfterCost;
  if (fullStage) {
    const bladeResult = addBladeLiveModifierForSourceMember(stateAfterCost, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      amount: 2,
    });
    if (!bladeResult) {
      return game;
    }
    stateAfterModifier = bladeResult.gameState;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...stateAfterModifier,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_ENERGY_FULL_STAGE_GAIN_TWO_BLADE',
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
        fullStage,
        bladeBonus: fullStage ? 2 : 0,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function finishActiveEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        ...payload,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function ownStageHasOtherMember(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }

  return MEMBER_SLOT_ORDER.some((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId || cardId === sourceCardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card !== null && card.data.cardType === CardType.MEMBER;
  });
}

function ownStageIsFull(game: GameState, playerId: string): boolean {
  const player = getPlayerById(game, playerId);
  return player ? MEMBER_SLOT_ORDER.every((slot) => player.memberSlots.slots[slot] !== null) : false;
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
