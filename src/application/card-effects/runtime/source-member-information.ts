import type { GameState } from '../../../domain/entities/game.js';
import type { MemberLastKnownInformation } from '../../../domain/events/game-events.js';
import { captureMemberLastKnownInformation } from '../../../domain/rules/member-last-known-information.js';
import { TriggerCondition } from '../../../shared/types/enums.js';
import { getAbilitySourceLifecycleId } from './ability-source-lifecycle.js';
import { isCurrentStageMemberAbilitySource } from './source-member.js';

export interface AbilitySourceMemberInformationContext {
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly sourceLifecycleId: string;
}

/** Current rules object, or the exact old object's final information; never a later re-entry. */
export function queryAbilitySourceMemberInformation(
  game: GameState,
  context: AbilitySourceMemberInformationContext
): MemberLastKnownInformation | null {
  if (isCurrentStageMemberAbilitySource(game, context)) {
    return (
      captureMemberLastKnownInformation(game, context.controllerId, context.sourceCardId) ?? null
    );
  }
  for (const { event } of game.eventLog) {
    if (
      event.eventType !== TriggerCondition.ON_LEAVE_STAGE ||
      event.cardInstanceId !== context.sourceCardId ||
      event.controllerId !== context.controllerId
    )
      continue;
    const lifecycle = getAbilitySourceLifecycleId(game, context.abilityId, context.sourceCardId, [
      event.eventId,
    ]);
    if (lifecycle === context.sourceLifecycleId) {
      // Missing information is a diagnosable unavailable result, not printed/current data.
      return 'memberLastKnownInformation' in event
        ? (event.memberLastKnownInformation ?? null)
        : null;
    }
  }
  return null;
}
