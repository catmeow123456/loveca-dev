import {
  addAction,
  type GameState,
  PendingAbilityState,
  QueuedAbilityState,
} from '../../../domain/entities/game.js';
import { isCardAbilitySuppressedByDarkHextech } from '../../../domain/hextech/suppression.js';
import { TriggerCondition } from '../../../shared/types/enums.js';

/** Check suppression at trigger creation only; an existing queue entry is independent of its source. */
export function appendTriggeredAbility(
  game: GameState,
  ability: PendingAbilityState
): readonly QueuedAbilityState[] {
  const records = game.eventLog.filter((record) => ability.eventIds.includes(record.event.eventId));
  const observed = records.flatMap((record) => {
    const event = record.event;
    if (
      event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
      event.cardInstanceId === ability.sourceCardId &&
      'memberLastKnownInformation' in event &&
      event.memberLastKnownInformation
    )
      return [event.memberLastKnownInformation.abilitiesSuppressed === true];
    const source = record.stageMembersAfterEvent?.find(
      (entry) => entry.sourceCardId === ability.sourceCardId
    );
    return source ? [source.abilitiesSuppressed === true] : [];
  });
  const suppressed = observed.length
    ? observed.every(Boolean)
    : isCardAbilitySuppressedByDarkHextech(game, ability.sourceCardId);
  return suppressed ? game.pendingAbilities : [...game.pendingAbilities, ability];
}

/** Suppressed observations are deduplicated without spending trigger-based usage limits. */
export function recordTriggeredAbility(...args: Parameters<typeof addAction>): GameState {
  const [game, type, playerId, payload] = args;
  const queued = game.pendingAbilities.some((entry) => entry.id === payload.pendingAbilityId);
  return addAction(game, queued ? type : 'SUPPRESS_ABILITY', playerId, payload);
}
