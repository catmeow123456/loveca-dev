import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { SP_BP5_222_LIVE_START_PAY_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const PAY_DECISION_STEP_ID = 'SP_BP5_222_PAY_ENERGY_PLACE_WAITING_ENERGY_DECISION';
const PAY_OPTION_ID = 'pay';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5222YuunaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP5_222_LIVE_START_PAY_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      startPayEnergyDecision(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP5_222_LIVE_START_PAY_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
    PAY_DECISION_STEP_ID,
    (game, input, context) =>
      finishPayEnergyDecision(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startPayEnergyDecision(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !sourceIsOwnStageBp5222(game, ability.controllerId, ability.sourceCardId)) {
    return consumePendingNoop(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
      paidEnergyCardIds: [],
      placedEnergyCardIds: [],
    });
  }
  if (countActiveEnergy(player) < 1) {
    return consumePendingNoop(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_ACTIVE_ENERGY',
      paidEnergyCardIds: [],
      placedEnergyCardIds: [],
    });
  }
  if (player.energyDeck.cardIds.length === 0) {
    return consumePendingNoop(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_ENERGY_DECK_CANDIDATE',
      paidEnergyCardIds: [],
      placedEnergyCardIds: [],
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
      stepId: PAY_DECISION_STEP_ID,
      stepText: '可以支付[E]，从能量卡组放置1张待机能量。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: PAY_OPTION_ID, label: '支付[E]' },
      ],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_PLACE_WAITING_ENERGY',
    },
  });
}

function finishPayEnergyDecision(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP5_222_LIVE_START_PAY_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID ||
    effect.stepId !== PAY_DECISION_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  if (selectedOptionId !== PAY_OPTION_ID) {
    return finishActiveEffectNoop(game, player.id, effect, continuePendingCardEffects, {
      step: 'DECLINE_PAY_ENERGY',
      paidEnergyCardIds: [],
      placedEnergyCardIds: [],
    });
  }
  if (!sourceIsOwnStageBp5222(game, player.id, effect.sourceCardId)) {
    return finishActiveEffectNoop(game, player.id, effect, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE_AFTER_CHOICE',
      paidEnergyCardIds: [],
      placedEnergyCardIds: [],
    });
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return finishActiveEffectNoop(game, player.id, effect, continuePendingCardEffects, {
      step: 'NO_ACTIVE_ENERGY_AFTER_CHOICE',
      paidEnergyCardIds: [],
      placedEnergyCardIds: [],
    });
  }

  let state = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const energyResult = placeEnergyFromDeckToZoneByCardEffect(
    state,
    player.id,
    1,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  state = energyResult?.gameState ?? state;

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step:
        energyResult && energyResult.placedEnergyCardIds.length > 0
          ? 'PAY_ENERGY_PLACE_WAITING_ENERGY'
          : 'PAY_ENERGY_NO_ENERGY_DECK_CANDIDATE',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      placedEnergyCardIds: energyResult?.placedEnergyCardIds ?? [],
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingNoop(
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
      ...payload,
    }),
    orderedResolution
  );
}

function finishActiveEffectNoop(
  game: GameState,
  playerId: string,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function sourceIsOwnStageBp5222(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp5-222')
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
