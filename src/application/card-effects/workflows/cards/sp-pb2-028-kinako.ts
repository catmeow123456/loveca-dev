import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { MemberSlotMovedEvent } from '../../../../domain/events/game-events.js';
import { GamePhase, OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { SP_PB2_028_AUTO_MAIN_PHASE_ON_MOVE_ACTIVATE_TWO_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2028KinakoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_028_AUTO_MAIN_PHASE_ON_MOVE_ACTIVATE_TWO_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb2028KinakoOnMove(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpPb2028KinakoOnMove(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const moveEvent = getPendingMoveEvent(game, ability);
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const isOwnMainPhase = game.currentPhase === GamePhase.MAIN_PHASE && activePlayerId === player.id;
  const movedThisMember =
    moveEvent?.controllerId === player.id && moveEvent.cardInstanceId === ability.sourceCardId;
  const conditionMet = isOwnMainPhase && movedThisMember;

  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount = conditionMet ? Math.min(2, waitingEnergyCount) : 0;
  const activationResult = activateWaitingEnergyCardsForPlayer(game, player.id, activationCount);
  if (!activationResult) {
    return game;
  }

  const stateAfterUseRecord = conditionMet
    ? recordAbilityUseForContext(activationResult.gameState, player.id, {
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
      })
    : activationResult.gameState;
  const stateWithoutPending: GameState = {
    ...stateAfterUseRecord,
    pendingAbilities: stateAfterUseRecord.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'MAIN_PHASE_ON_MOVE_ACTIVATE_TWO_ENERGY' : 'CONDITION_NOT_MET',
      conditionMet,
      isOwnMainPhase,
      movedThisMember,
      moveEventId: moveEvent?.eventId ?? null,
      fromSlot: moveEvent?.fromSlot ?? null,
      toSlot: moveEvent?.toSlot ?? null,
      requestedActivationCount: conditionMet ? 2 : 0,
      activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
      previousOrientations: activationResult.previousOrientations,
      nextOrientation: activationResult.nextOrientation,
    }),
    orderedResolution
  );
}

function getPendingMoveEvent(
  game: GameState,
  ability: PendingAbilityState
): MemberSlotMovedEvent | null {
  const eventIds = new Set(ability.eventIds);
  for (const entry of game.eventLog) {
    const event = entry.event;
    if (
      event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
      'fromSlot' in event &&
      'toSlot' in event &&
      'cardInstanceId' in event &&
      eventIds.has(event.eventId)
    ) {
      return event as MemberSlotMovedEvent;
    }
  }
  return null;
}
