import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { GamePhase, OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
  SP_BP5_020_LIVE_SUCCESS_PAY_ENERGY_DRAW_ONE_ABILITY_ID,
} from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const LIVE_SUCCESS_PAY_DECISION_STEP_ID = 'SP_BP5_020_LIVE_SUCCESS_PAY_DECISION';
const PAY_OPTION_ID = 'pay';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5020NatsumiWorkflowHandlers(): void {
  registerActivatedAbilityHandler(
    SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
    (game, playerId, cardId) => resolveActivatedDraw(game, playerId, cardId)
  );
  registerPendingAbilityStarterHandler(
    SP_BP5_020_LIVE_SUCCESS_PAY_ENERGY_DRAW_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveSuccessPayDecision(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP5_020_LIVE_SUCCESS_PAY_ENERGY_DRAW_ONE_ABILITY_ID,
    LIVE_SUCCESS_PAY_DECISION_STEP_ID,
    (game, input, context) =>
      finishLiveSuccessPayDecision(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function resolveActivatedDraw(game: GameState, playerId: string, cardId: string): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  if (activePlayerId !== playerId || !player || !sourceIsOwnStageBp5020(game, playerId, cardId)) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!costPayment) {
    return game;
  }

  let state = recordPayCostAction(costPayment.gameState, player.id, {
    abilityId: SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
    sourceCardId: cardId,
  });
  const drawResult = drawCardsForPlayer(state, player.id, 1);
  state = drawResult?.gameState ?? state;

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID,
    sourceCardId: cardId,
    effectText: getAbilityEffectText(SP_BP5_020_ACTIVATED_PAY_TWO_ENERGY_DRAW_ONE_ABILITY_ID),
    step: 'PAY_TWO_ENERGY_DRAW_ONE',
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
    drawnCardIds: drawResult?.drawnCardIds ?? [],
  });
}

function startLiveSuccessPayDecision(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !sourceIsOwnStageBp5020(game, player.id, ability.sourceCardId)) {
    return consumeLiveSuccessPending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
    });
  }

  if (countActiveEnergy(player) < 1) {
    return consumeLiveSuccessPending(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_ACTIVE_ENERGY',
    });
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
      stepId: LIVE_SUCCESS_PAY_DECISION_STEP_ID,
      stepText: '可以支付1张能量抽1张卡。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: PAY_OPTION_ID, label: '支付1张能量' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_LIVE_SUCCESS_PAY_DECISION',
    },
  });
}

function finishLiveSuccessPayDecision(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP5_020_LIVE_SUCCESS_PAY_ENERGY_DRAW_ONE_ABILITY_ID ||
    effect.stepId !== LIVE_SUCCESS_PAY_DECISION_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedOptionId !== PAY_OPTION_ID) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_PAY_ENERGY',
        paidEnergyCardIds: [],
        drawnCardIds: [],
      }),
      orderedResolution
    );
  }

  if (!sourceIsOwnStageBp5020(game, player.id, effect.sourceCardId)) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SOURCE_NOT_ON_STAGE_AFTER_CHOICE',
        paidEnergyCardIds: [],
        drawnCardIds: [],
      }),
      orderedResolution
    );
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_ACTIVE_ENERGY_AFTER_CHOICE',
        paidEnergyCardIds: [],
        drawnCardIds: [],
      }),
      orderedResolution
    );
  }

  let state = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const drawResult = drawCardsForPlayer(state, player.id, 1);
  state = drawResult?.gameState ?? state;

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_DRAW_ONE',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    orderedResolution
  );
}

function consumeLiveSuccessPending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (!player) {
    return continuePendingCardEffects(stateWithoutPending, orderedResolution);
  }
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      paidEnergyCardIds: [],
      drawnCardIds: [],
      ...payload,
    }),
    orderedResolution
  );
}

function sourceIsOwnStageBp5020(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp5-020')
  ) {
    return false;
  }
  return [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].some(
    (slot) => player.memberSlots.slots[slot] === sourceCardId
  );
}

function countActiveEnergy(player: NonNullable<ReturnType<typeof getPlayerById>>): number {
  return player.energyZone.cardIds.filter(
    (energyCardId) =>
      player.energyZone.cardStates.get(energyCardId)?.orientation !== OrientationState.WAITING
  ).length;
}
