import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import {
  SP_BP4_005_ON_ENTER_LIELLA_RELAY_ENERGY_SEVEN_PLACE_TWO_WAITING_ENERGY_ABILITY_ID,
  SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP5_021_ACTIVATED_SELF_SACRIFICE_ENERGY_SIX_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { isDirectOrRenGrantedActivatedAbilitySource } from '../../runtime/granted-activated-abilities.js';
import {
  paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers,
  type EnqueueTriggeredCardEffectsForLeaveStage,
} from '../../runtime/leave-stage-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForLeaveStage &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

const BP5_021_ENERGY_THRESHOLD = 6;
const BP4_005_ENERGY_THRESHOLD = 7;

export function registerStageMemberWaitingEnergyPlacementWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    SP_BP5_021_ACTIVATED_SELF_SACRIFICE_ENERGY_SIX_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, playerId, cardId) => startBp5021SelfSacrificeEnergyPlacement(game, playerId, cardId, deps)
  );
  registerActivatedAbilityHandler(
    SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, playerId, cardId) => startBp4010PayEnergyWaitSelfPlaceEnergy(game, playerId, cardId, deps)
  );
  registerPendingAbilityStarterHandler(
    SP_BP4_005_ON_ENTER_LIELLA_RELAY_ENERGY_SEVEN_PLACE_TWO_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveBp4005RelayEnergyPlacement(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function startBp5021SelfSacrificeEnergyPlacement(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isDirectOrRenGrantedActivatedAbilitySource(game, playerId, cardId, SP_BP5_021_ACTIVATED_SELF_SACRIFICE_ENERGY_SIX_PLACE_WAITING_ENERGY_ABILITY_ID, ['PL!SP-bp5-021']) ||
    !isMemberCardData(sourceCard.data) ||
    findMemberSlot(player, cardId) === null
  ) {
    return game;
  }

  let state = recordAbilityUseForContext(game, player.id, {
    abilityId: SP_BP5_021_ACTIVATED_SELF_SACRIFICE_ENERGY_SIX_PLACE_WAITING_ENERGY_ABILITY_ID,
    sourceCardId: cardId,
  });
  const costPayment = paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    state,
    player.id,
    cardId,
    deps.enqueueTriggeredCardEffects
  );
  if (!costPayment) {
    return game;
  }

  state = costPayment.gameState;
  const energyCountAfterCost = getPlayerById(state, player.id)?.energyZone.cardIds.length ?? 0;
  const conditionMet = energyCountAfterCost >= BP5_021_ENERGY_THRESHOLD;
  const energyPlacement = conditionMet
    ? placeEnergyFromDeckToZoneByCardEffect(state, player.id, 1, OrientationState.WAITING, {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: cardId,
        abilityId: SP_BP5_021_ACTIVATED_SELF_SACRIFICE_ENERGY_SIX_PLACE_WAITING_ENERGY_ABILITY_ID,
      })
    : null;
  state = energyPlacement?.gameState ?? state;

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: SP_BP5_021_ACTIVATED_SELF_SACRIFICE_ENERGY_SIX_PLACE_WAITING_ENERGY_ABILITY_ID,
    sourceCardId: cardId,
    step: 'SELF_SACRIFICE_PLACE_WAITING_ENERGY',
    movedToWaitingRoomCardIds: costPayment.movedToWaitingRoomCardIds,
    leaveStageEventIds: costPayment.leaveStageEvents.map((event) => event.eventId),
    energyCountAfterCost,
    conditionMet,
    placedEnergyCardIds: energyPlacement?.placedEnergyCardIds ?? [],
  });
}

function startBp4010PayEnergyWaitSelfPlaceEnergy(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = player ? findMemberSlot(player, cardId) : null;
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp4-010') ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE
  ) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return game;
  }
  const waitResult = setMemberOrientation(
    costPayment.gameState,
    player.id,
    cardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: cardId,
      abilityId: SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID,
    }
  );
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const stateWithStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    costPayment.gameState,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        recordPayCostAction(stateAfterWait, player.id, {
          abilityId: SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot,
          energyCardIds: costPayment.paidEnergyCardIds,
          amount: costPayment.paidEnergyCardIds.length,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  let state = recordAbilityUseForContext(stateWithStateTriggers.gameState, player.id, {
    abilityId: SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID,
    sourceCardId: cardId,
  });
  const energyPlacement = placeEnergyFromDeckToZoneByCardEffect(
    state,
    player.id,
    1,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: cardId,
      abilityId: SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID,
    }
  );
  state = energyPlacement?.gameState ?? state;

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: SP_BP4_010_ACTIVATED_PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY_ABILITY_ID,
    sourceCardId: cardId,
    step: 'PAY_ENERGY_WAIT_SELF_PLACE_WAITING_ENERGY',
    sourceSlot,
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
    waitedMemberCardId: cardId,
    memberStateChangedEventIds: stateWithStateTriggers.memberStateChangedEvents.map(
      (event) => event.eventId
    ),
    placedEnergyCardIds: energyPlacement?.placedEnergyCardIds ?? [],
  });
}

function resolveBp4005RelayEnergyPlacement(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const relayReplacementCardIds = getRelayReplacementCardIds(ability.metadata?.relayReplacements);
  const validLiellaReplacementCardIds = getValidLiellaRelayReplacementCardIds(
    game,
    player.id,
    relayReplacementCardIds
  );
  const energyCount = player.energyZone.cardIds.length;
  const conditionMet =
    validLiellaReplacementCardIds.length > 0 && energyCount >= BP4_005_ENERGY_THRESHOLD;
  const energyPlacement = conditionMet
    ? placeEnergyFromDeckToZoneByCardEffect(game, player.id, 2, OrientationState.WAITING, {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      })
    : null;
  const state = {
    ...(energyPlacement?.gameState ?? game),
    pendingAbilities: (energyPlacement?.gameState ?? game).pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LIELLA_RELAY_ENERGY_SEVEN_PLACE_WAITING_ENERGY',
      relayReplacementCardIds,
      validLiellaReplacementCardIds,
      energyCount,
      conditionMet,
      placedEnergyCardIds: energyPlacement?.placedEnergyCardIds ?? [],
    }),
    orderedResolution
  );
}

function getValidLiellaRelayReplacementCardIds(
  game: GameState,
  playerId: string,
  relayReplacementCardIds: readonly string[]
): readonly string[] {
  const player = getPlayerById(game, playerId);
  const isLiella = groupAliasIs('Liella!');
  if (!player) {
    return [];
  }
  return relayReplacementCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === playerId &&
      player.waitingRoom.cardIds.includes(cardId) &&
      isMemberCardData(card.data) &&
      isLiella(card)
    );
  });
}

function getRelayReplacementCardIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): string[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const cardId = (entry as { readonly cardId?: unknown }).cardId;
    return typeof cardId === 'string' ? [cardId] : [];
  });
}
