import { getCardEntranceProfile } from '../../client/src/lib/cardEntranceProfiles';
import { describe, expect, it } from 'vitest';
import type { CardMovedPublicEvent } from '../../src/online/types';
import { ZoneType } from '../../src/shared/types/enums';
import { collectCardEntrances, emptyEntranceCursor } from '../../client/src/lib/cardEntranceEvents';
const event = (seq: number, changes: Partial<CardMovedPublicEvent> = {}): CardMovedPublicEvent => ({
  type: 'CardMovedPublic',
  eventId: `e${seq}`,
  matchId: 'm',
  seq,
  timestamp: 0,
  source: 'PLAYER',
  card: { publicObjectId: 'obj_k', cardCode: 'PL!N-bp7-006-SEC' },
  from: { zone: ZoneType.HAND, ownerSeat: 'FIRST' },
  to: { zone: ZoneType.MEMBER_SLOT, slot: 'LEFT', ownerSeat: 'FIRST' },
  ...changes,
});
const input = (seq: number, events: CardMovedPublicEvent[] = []) => ({
  matchId: 'm',
  epoch: 0,
  seq,
  events,
});
const init = () => collectCardEntrances(emptyEntranceCursor(), input(10)).cursor;
describe('local card entrance presentation', () => {
  it('covers all member rarities but never the reference energy or similar numbers', () => {
    for (const rarity of ['R', 'R+', 'P', 'P+', 'SEC', 'NEW'])
      expect(getCardEntranceProfile(`PL!N-bp7-006-${rarity}`)?.id).toBe('kanata');
    for (const code of ['PL!N-bp7-E02-SECE', 'PL!N-bp7-0060-SEC', 'PL!N-bp7-007-R'])
      expect(getCardEntranceProfile(code)).toBeUndefined();
  });
  it('maps Ren rarities and preserves mixed-character event order without replay', () => {
    for (const suffix of ['', '-R', '-PP', '-NEW'])
      expect(getCardEntranceProfile(`PL!SP-pb2-005${suffix}`)?.name).toBe('叶月恋');
    for (const code of ['PL!SP-pb2-0050-PP', 'PL!SP-pb2-005-', 'PL!SP-pb2-005-PP-extra'])
      expect(getCardEntranceProfile(code)).toBeUndefined();
    const events = [
      event(12, { card: { publicObjectId: 'obj_ren', cardCode: 'PL!SP-pb2-005-PP' } }),
      event(11),
    ];
    const result = collectCardEntrances(init(), input(12, events));
    expect(result.entrances).toEqual([
      { id: 'e11', objectId: 'obj_k' },
      { id: 'e12', objectId: 'obj_ren' },
    ]);
    expect(collectCardEntrances(result.cursor, input(12, events)).entrances).toEqual([]);
  });
  it('skips initial history, reconnect epochs, match changes and sequence rewind', () => {
    expect(collectCardEntrances(emptyEntranceCursor(), input(11, [event(11)])).entrances).toEqual(
      []
    );
    for (const changed of [
      { ...input(11, [event(11)]), epoch: 1 },
      { ...input(11, [event(11)]), matchId: 'other' },
      input(9, [event(9)]),
    ]) {
      expect(collectCardEntrances(init(), changed)).toMatchObject({ reset: true, entrances: [] });
    }
  });
  it('plays fresh public entrance once, accepts delayed event pages, and allows reentry', () => {
    const first = collectCardEntrances(init(), input(12, [event(12)]));
    expect(first.entrances).toEqual([{ id: 'e12', objectId: 'obj_k' }]);
    const next = collectCardEntrances(first.cursor, input(12, [event(11), event(12)]));
    expect(next.entrances.map((e) => e.id)).toEqual(['e11']);
    expect(collectCardEntrances(next.cursor, input(12, [event(11), event(12)])).entrances).toEqual(
      []
    );
    expect(collectCardEntrances(next.cursor, input(14, [event(14)])).entrances).toHaveLength(1);
  });
  it('never reveals count-only moves, staged repositioning, overlays or unrelated cards', () => {
    const invalid = [
      event(11, { card: undefined }),
      event(12, { from: { zone: ZoneType.MEMBER_SLOT } }),
      event(13, { to: { zone: ZoneType.MEMBER_SLOT, overlayIndex: 0 } }),
      event(14, { to: { zone: ZoneType.WAITING_ROOM } }),
      event(15, { card: { publicObjectId: 'x', cardCode: 'PL!N-bp7-005-R' } }),
      event(16, { matchId: 'other' }),
    ];
    expect(collectCardEntrances(init(), input(16, invalid)).entrances).toEqual([]);
  });
  it('accepts both seats and retains deduplication after identity eviction', () => {
    let cursor = init();
    for (let seq = 11; seq < 280; seq++) {
      const result = collectCardEntrances(
        cursor,
        input(seq, [event(seq, { to: { zone: ZoneType.MEMBER_SLOT, ownerSeat: 'SECOND' } })])
      );
      expect(result.entrances).toHaveLength(1);
      cursor = result.cursor;
    }
    expect(collectCardEntrances(cursor, input(279, [event(11), event(279)])).entrances).toEqual([]);
  });
});
