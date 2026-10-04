import { getCardEntranceProfile } from './cardEntranceProfiles';
import type { PublicEvent } from '@game/online';
import { ZoneType } from '@game/shared/types/enums';

export interface EntranceCursor {
  matchId: string | null;
  epoch: number;
  floor: number;
  latest: number;
  seen: readonly string[];
}
export const emptyEntranceCursor = (): EntranceCursor => ({
  matchId: null,
  epoch: -1,
  floor: 0,
  latest: 0,
  seen: [],
});
export interface CardEntrance {
  id: string;
  objectId: string;
}

export function collectCardEntrances(
  cursor: EntranceCursor,
  input: {
    matchId: string | null;
    epoch: number;
    seq: number;
    events: readonly PublicEvent[];
  }
): { cursor: EntranceCursor; entrances: CardEntrance[]; reset: boolean } {
  if (
    cursor.matchId !== input.matchId ||
    cursor.epoch !== input.epoch ||
    input.seq < cursor.latest
  ) {
    return {
      cursor: {
        matchId: input.matchId,
        epoch: input.epoch,
        floor: input.seq,
        latest: input.seq,
        seen: [],
      },
      entrances: [],
      reset: true,
    };
  }
  const seen = new Set(cursor.seen);
  const entrances: CardEntrance[] = [];
  for (const event of [...input.events].sort((a, b) => a.seq - b.seq)) {
    if (
      event.matchId !== input.matchId ||
      event.seq <= cursor.floor ||
      event.seq > input.seq ||
      seen.has(event.eventId)
    )
      continue;
    if (event.type !== 'CardMovedPublic' && event.type !== 'CardRevealedAndMoved') continue;
    if (
      !event.card ||
      !getCardEntranceProfile(event.card.cardCode) ||
      !event.from ||
      event.from.zone === ZoneType.MEMBER_SLOT ||
      event.to?.zone !== ZoneType.MEMBER_SLOT ||
      event.to.overlayIndex !== undefined
    )
      continue;
    seen.add(event.eventId);
    entrances.push({ id: event.eventId, objectId: event.card.publicObjectId });
  }
  // Advancing the floor before evicting identities prevents old backfill from replaying.
  const ids = [...seen];
  const overflow = ids.length > 256;
  return {
    cursor: {
      ...cursor,
      latest: input.seq,
      floor: overflow ? input.seq : cursor.floor,
      seen: overflow ? [] : ids,
    },
    entrances,
    reset: false,
  };
}
