import { addAction, getCardById, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import type { LeaveStageEvent } from '../../../../domain/events/game-events.js';
import { TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { placeEnergyFromEnergyDeckBelowStageMember } from '../../../effects/energy-below.js';
import { N_BP7_019_AUTO_RELAY_NIJIGASAKI_PLACE_ENERGY_BELOW_REPLACEMENT_ABILITY_ID } from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp7019SetsunaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_BP7_019_AUTO_RELAY_NIJIGASAKI_PLACE_ENERGY_BELOW_REPLACEMENT_ABILITY_ID,
    (game, ability, options, context) => resolve(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
}

function resolve(game: GameState, ability: PendingAbilityState, ordered: boolean, next: Continue): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const event = getLeaveStageEvent(game, ability);
  const replacementCardId = event?.replacingCardId ?? null;
  const replacement = replacementCardId ? getCardById(game, replacementCardId) : null;
  const replacementSlot = player && replacementCardId ? getSourceMemberSlot(game, player.id, replacementCardId) : null;
  const valid =
    player !== null && event?.cardInstanceId === ability.sourceCardId &&
    event.toZone === ZoneType.WAITING_ROOM && replacementCardId !== null && replacement !== null &&
    replacement.ownerId === player.id && groupAliasIs('虹ヶ咲')(replacement) && replacementSlot !== null &&
    player.memberSlots.slots[replacementSlot] === replacementCardId;
  const placement = valid
    ? placeEnergyFromEnergyDeckBelowStageMember(game, player.id, replacementCardId, 1)
    : null;
  const resolvedState = placement?.gameState ?? game;
  const state = { ...resolvedState, pendingAbilities: resolvedState.pendingAbilities.filter((item) => item.id !== ability.id) };
  return next(addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
    pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId,
    step: placement ? 'PLACE_ENERGY_BELOW_RELAY_REPLACEMENT' : 'RELAY_REPLACEMENT_NOT_AVAILABLE',
    leaveStageEventId: event?.eventId ?? null, replacingCardId: replacementCardId,
    targetSlot: placement?.targetSlot ?? replacementSlot,
    placedEnergyCardIds: placement?.placedEnergyCardIds ?? [],
  }), ordered);
}

function getLeaveStageEvent(game: GameState, ability: PendingAbilityState): LeaveStageEvent | null {
  for (const eventId of ability.eventIds) {
    const event = game.eventLog.find((entry) => entry.event.eventId === eventId)?.event;
    if (event?.eventType === TriggerCondition.ON_LEAVE_STAGE && 'fromSlot' in event) return event as LeaveStageEvent;
  }
  return null;
}
