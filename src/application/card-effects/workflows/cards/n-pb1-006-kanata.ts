import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { getNewMemberStateChangedEvents } from '../../runtime/events.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerNPb1006KanataWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID,
    (game, playerId, cardId) => startKanataWaitSelfActivateEnergy(game, playerId, cardId, deps)
  );
}

export function startKanataWaitSelfActivateEnergy(
  game: GameState,
  playerId: string,
  cardId: string,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
  }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  const sourceState = player?.memberSlots.cardStates.get(cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-pb1-006') ||
    !isMemberCardData(sourceCard.data) ||
    sourceSlot === null ||
    sourceState?.orientation !== OrientationState.ACTIVE
  ) {
    return game;
  }

  const waitResult = setMemberOrientation(game, player.id, cardId, OrientationState.WAITING, {
    kind: 'CARD_EFFECT',
    playerId: player.id,
    sourceCardId: cardId,
    abilityId: PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID,
  });
  if (!waitResult || waitResult.previousOrientation !== OrientationState.ACTIVE) {
    return game;
  }

  const memberStateChangedEvents = getNewMemberStateChangedEvents(game, waitResult.gameState);
  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    deps.enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result) =>
        addAction(stateAfterWait, 'PAY_COST', player.id, {
          abilityId: PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID,
          sourceCardId: cardId,
          sourceSlot,
          waitedMemberCardId: cardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );
  let state = stateWithMemberStateTriggers.gameState;

  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    state,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount = Math.min(1, waitingEnergyCount);
  const energyActivation = activateWaitingEnergyCardsForPlayer(state, player.id, activationCount);
  if (!energyActivation) {
    return game;
  }
  state = energyActivation.gameState;

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID,
    sourceCardId: cardId,
    sourceSlot,
    effectText: getAbilityEffectText(
      PL_N_PB1_006_ACTIVATED_WAIT_SELF_ACTIVATE_ONE_ENERGY_ABILITY_ID
    ),
    step: 'WAIT_SELF_ACTIVATE_ENERGY',
    waitedMemberCardId: cardId,
    activatedEnergyCardIds: energyActivation.activatedEnergyCardIds,
    previousEnergyOrientations: energyActivation.previousOrientations,
    nextEnergyOrientation: energyActivation.nextOrientation,
  });
}
