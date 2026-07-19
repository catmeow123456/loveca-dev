import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { LeaveStageEvent } from '../../../../domain/events/game-events.js';
import { TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { SP_BP7_001_AUTO_RELAY_STACK_SELF_BELOW_REPLACEMENT_ABILITY_ID } from '../../ability-ids.js';
import { stackMemberCardBelowStageMember } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp7001KanonWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP7_001_AUTO_RELAY_STACK_SELF_BELOW_REPLACEMENT_ABILITY_ID,
    (game, ability, options, context) =>
      resolveKanonRelayBelow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveKanonRelayBelow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const event = getLeaveStageEvent(game, ability);
  const replacementCardId = event?.replacingCardId ?? null;
  const replacementSlot =
    player && replacementCardId
      ? getSourceMemberSlot(game, player.id, replacementCardId)
      : null;
  const valid =
    player !== null &&
    event?.cardInstanceId === ability.sourceCardId &&
    event.toZone === ZoneType.WAITING_ROOM &&
    replacementCardId !== null &&
    replacementSlot !== null &&
    player.waitingRoom.cardIds.includes(ability.sourceCardId) &&
    player.memberSlots.slots[replacementSlot] === replacementCardId;

  const stackResult = valid
    ? stackMemberCardBelowStageMember(game, {
        playerId: player.id,
        sourceZone: ZoneType.WAITING_ROOM,
        movedCardId: ability.sourceCardId,
        hostCardId: replacementCardId,
        targetSlot: replacementSlot,
      })
    : null;
  const state = {
    ...(stackResult?.gameState ?? game),
    pendingAbilities: (stackResult?.gameState ?? game).pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player?.id ?? ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: stackResult ? 'STACK_SELF_BELOW_RELAY_REPLACEMENT' : 'RELAY_REPLACEMENT_NOT_AVAILABLE',
      leaveStageEventId: event?.eventId ?? null,
      leaveStageFromSlot: event?.fromSlot ?? null,
      replacingCardId: replacementCardId,
      targetSlot: replacementSlot,
      stackedCardId: stackResult?.movedCardId ?? null,
    }),
    orderedResolution
  );
}

function getLeaveStageEvent(
  game: GameState,
  ability: PendingAbilityState
): LeaveStageEvent | null {
  for (const eventId of ability.eventIds) {
    const event = game.eventLog.find((entry) => entry.event.eventId === eventId)?.event;
    if (event?.eventType === TriggerCondition.ON_LEAVE_STAGE && 'fromSlot' in event) {
      return event as LeaveStageEvent;
    }
  }
  return null;
}
