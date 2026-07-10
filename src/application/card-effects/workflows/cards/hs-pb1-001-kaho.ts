import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { EnterStageEvent } from '../../../../domain/events/game-events.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  HS_PB1_001_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY_ACTIVATE_TWO_ABILITY_ID,
  HS_PB1_001_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { activateWaitingEnergyCardsForPlayer, addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const AUTO_PAY_ENERGY_STEP_ID = 'HS_PB1_001_AUTO_PAY_ENERGY_ACTIVATE_TWO';
const LIVE_START_PAY_TWO_ENERGY_STEP_ID = 'HS_PB1_001_LIVE_START_PAY_TWO_ENERGY';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsPb1001KahoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_001_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY_ACTIVATE_TWO_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1001AutoOtherCeriseEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_001_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY_ACTIVATE_TWO_ABILITY_ID,
    AUTO_PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishHsPb1001AutoPayEnergy(game, context.continuePendingCardEffects)
        : finishHsPb1001Decline(game, context.continuePendingCardEffects, 'DECLINE_AUTO_PAY_ENERGY')
  );

  registerPendingAbilityStarterHandler(
    HS_PB1_001_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1001LiveStartPayEnergy(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_001_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
    LIVE_START_PAY_TWO_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishHsPb1001LiveStartPayEnergy(game, context.continuePendingCardEffects)
        : finishHsPb1001Decline(
            game,
            context.continuePendingCardEffects,
            'DECLINE_LIVE_START_PAY_TWO_ENERGY'
          )
  );
}

function startHsPb1001AutoOtherCeriseEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const enteredEvent = getEnteredStageEvent(game, ability);
  if (!player || !enteredEvent) {
    return game;
  }

  const enteredCard = getCardById(game, enteredEvent.cardInstanceId);
  const sourceOnStage = Object.values(player.memberSlots.slots).includes(ability.sourceCardId);
  const activeEnergyCardIds = getActiveEnergyCardIds(game, player.id);
  const isOtherOwnCeriseMember =
    enteredEvent.controllerId === player.id &&
    enteredEvent.cardInstanceId !== ability.sourceCardId &&
    enteredCard !== null &&
    isMemberCardData(enteredCard.data) &&
    unitAliasIs('Cerise Bouquet')(enteredCard);

  if (!sourceOnStage || !isOtherOwnCeriseMember || activeEnergyCardIds.length < 1) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'SKIP_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY',
        sourceOnStage,
        enteredCardId: enteredEvent.cardInstanceId,
        activeEnergyCardIds,
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: AUTO_PAY_ENERGY_STEP_ID,
      stepText: '可以支付1张活跃能量；如此做时，将2张能量变为活跃状态。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        enteredCardId: enteredEvent.cardInstanceId,
        activeEnergyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_AUTO_PAY_ENERGY_ACTIVATE_TWO',
      enteredCardId: enteredEvent.cardInstanceId,
      activeEnergyCardIds,
    },
  });
}

function startHsPb1001LiveStartPayEnergy(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const sourceOnStage = Object.values(player.memberSlots.slots).includes(ability.sourceCardId);
  const activeEnergyCardIds = getActiveEnergyCardIds(game, player.id);
  if (!sourceOnStage || activeEnergyCardIds.length < 2) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'SKIP_LIVE_START_PAY_TWO_ENERGY',
        sourceOnStage,
        activeEnergyCardIds,
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: LIVE_START_PAY_TWO_ENERGY_STEP_ID,
      stepText: '可以支付2张活跃能量；如此做时，LIVE结束时为止，获得[緑ハート][BLADE]。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: 'pay', label: '支付[E][E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_LIVE_START_PAY_TWO_ENERGY',
      activeEnergyCardIds,
    },
  });
}

function finishHsPb1001AutoPayEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player || effect.stepId !== AUTO_PAY_ENERGY_STEP_ID) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return game;
  }

  let state = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  const activationCount = Math.min(2, getWaitingEnergyCount(state, player.id));
  const activation = activateWaitingEnergyCardsForPlayer(state, player.id, activationCount);
  if (!activation) {
    return game;
  }
  state = activation.gameState;

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_ACTIVATE_TWO',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      activatedEnergyCardIds: activation.activatedEnergyCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishHsPb1001LiveStartPayEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player || effect.stepId !== LIVE_START_PAY_TWO_ENERGY_STEP_ID) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!costPayment) {
    return game;
  }

  let state = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const heartResult = addHeartLiveModifierForMember(state, {
    playerId: player.id,
    memberCardId: effect.sourceCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    hearts: [{ color: HeartColor.GREEN, count: 1 }],
  });
  if (!heartResult) {
    return game;
  }
  state = heartResult.gameState;
  const bladeResult = addBladeLiveModifierForSourceMember(state, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: 1,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...bladeResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_TWO_ENERGY_GAIN_GREEN_HEART_BLADE',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishHsPb1001Decline(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
    }),
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

function getEnteredStageEvent(game: GameState, ability: PendingAbilityState): EnterStageEvent | null {
  const eventIdSet = new Set(ability.eventIds);
  const entry = game.eventLog.find(
    (candidate) =>
      eventIdSet.has(candidate.event.eventId) &&
      candidate.event.eventType === TriggerCondition.ON_ENTER_STAGE
  );
  return (entry?.event as EnterStageEvent | undefined) ?? null;
}

function getActiveEnergyCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return (
    player?.energyZone.cardIds.filter(
      (cardId) =>
        player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
    ) ?? []
  );
}

function getWaitingEnergyCount(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  return (
    player?.energyZone.cardIds.filter(
      (cardId) =>
        player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.WAITING
    ).length ?? 0
  );
}
