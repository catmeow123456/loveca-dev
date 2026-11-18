import type { GameState } from '../entities/game.js';
import { TriggerCondition, ZoneType } from '../../shared/types/enums.js';
const SOURCE_LIFECYCLE_PREFIX = 'source-lifecycle';

function getReferenceEventSequence(
  game: GameState,
  eventIds: readonly string[] | undefined
): number | undefined {
  if (!eventIds || eventIds.length === 0) {
    return undefined;
  }
  const eventIdSet = new Set(eventIds);
  const sequences = game.eventLog
    .filter((entry) => eventIdSet.has(entry.event.eventId))
    .map((entry) => entry.sequence);
  return sequences.length > 0 ? Math.min(...sequences) : undefined;
}

export function getCardLifecycleId(
  game: GameState,
  entryKind: 'STAGE_MEMBER' | 'LIVE_CARD' | null,
  sourceCardId: string,
  eventIds?: readonly string[]
): string {
  const referenceSequence = getReferenceEventSequence(game, eventIds);
  const entry = [...game.eventLog].reverse().find((candidate) => {
    if (referenceSequence !== undefined && candidate.sequence > referenceSequence) {
      return false;
    }
    const event = candidate.event;
    if (entryKind === 'STAGE_MEMBER') {
      return (
        event.eventType === TriggerCondition.ON_ENTER_STAGE &&
        event.cardInstanceId === sourceCardId &&
        event.fromZone !== ZoneType.MEMBER_SLOT
      );
    }
    if (entryKind === 'LIVE_CARD') {
      return (
        event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE &&
        event.cardInstanceId === sourceCardId &&
        event.fromZone !== ZoneType.LIVE_ZONE
      );
    }
    return false;
  });

  return entry
    ? `${SOURCE_LIFECYCLE_PREFIX}:event:${entry.event.eventId}`
    : `${SOURCE_LIFECYCLE_PREFIX}:initial:${entryKind ?? 'OTHER'}:${sourceCardId}`;
}

export function getStageMemberLifecycleId(game: GameState, cardId: string): string {
  return getCardLifecycleId(game, 'STAGE_MEMBER', cardId);
}
