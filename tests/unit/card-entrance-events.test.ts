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
  it('keeps Hime, Lanzhu and old portraits in order, excluding the SECE energy reference', () => {
    for (const suffix of ['', '-SD', '-FUTURE'])
      expect(getCardEntranceProfile(`PL!HS-sd1-006${suffix}`)?.id).toBe('hime');
    for (const suffix of ['', '-P', '-P+', '-R+', '-SEC', '-FUTURE'])
      expect(getCardEntranceProfile(`PL!N-bp1-012${suffix}`)?.id).toBe('lanzhu');
    expect(getCardEntranceProfile('PL!N-bp1-033-SECE')).toBeUndefined();
    const codes = ['PL!HS-sd1-006-SD', 'PL!N-bp1-033-SECE', 'PL!N-bp1-012-SEC', 'PL!N-bp7-006-SEC'];
    const events = codes.map((cardCode, i) =>
      event(11 + i, { card: { publicObjectId: `new_${i}`, cardCode } })
    );
    const result = collectCardEntrances(init(), input(14, events));
    expect(result.entrances.map((e) => e.objectId)).toEqual(['new_0', 'new_2', 'new_3']);
    expect(collectCardEntrances(result.cursor, input(14, events)).entrances).toEqual([]);
  });
  it('keeps Eli N and Honoka R/PP identities in a mixed queue without replay', () => {
    const codes = [
      'PL!-pb2-020-N',
      'PL!HS-sd1-006-SD',
      'PL!-pb2-001-R',
      'PL!N-bp1-012-SEC',
      'PL!-pb2-001-PP',
    ];
    expect(codes.map((code) => getCardEntranceProfile(code)?.id)).toEqual([
      'eli',
      'hime',
      'honoka',
      'lanzhu',
      'honoka',
    ]);
    const events = codes.map((cardCode, i) =>
      event(11 + i, { card: { publicObjectId: `mixed_${i}`, cardCode } })
    );
    const result = collectCardEntrances(init(), input(15, events));
    expect(result.entrances.map((e) => e.objectId)).toEqual(codes.map((_, i) => `mixed_${i}`));
    expect(collectCardEntrances(result.cursor, input(15, events)).entrances).toEqual([]);
    for (const code of ['PL!-pb2-0200-N', 'PL!-pb2-001-R-extra'])
      expect(getCardEntranceProfile(code)).toBeUndefined();
  });
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
  it('maps Shiki R/PP and keeps all three portraits associated with their public objects', () => {
    for (const suffix of ['', '-R', '-PP'])
      expect(getCardEntranceProfile(`PL!SP-pb2-008${suffix}`)?.id).toBe('shiki');
    for (const code of ['PL!SP-pb2-0080-PP', 'PL!SP-pb2-008-', 'PL!SP-pb2-008-PP-extra'])
      expect(getCardEntranceProfile(code)).toBeUndefined();
    const codes = ['PL!SP-pb2-008-PP', 'PL!SP-pb2-005-R', 'PL!N-bp7-006-SEC'];
    const events = codes.map((cardCode, i) =>
      event(11 + i, { card: { publicObjectId: `obj_${i}`, cardCode } })
    );
    const result = collectCardEntrances(init(), input(13, events));
    expect(result.entrances.map((e) => e.objectId)).toEqual(['obj_0', 'obj_1', 'obj_2']);
    expect(collectCardEntrances(result.cursor, input(13, events)).entrances).toEqual([]);
  });
  it('triggers the trio member once but never its reference RE energy print', () => {
    for (const code of ['LL-bp2-001', 'LL-bp2-001-R+', 'LL-bp2-001-R＋'])
      expect(getCardEntranceProfile(code)?.id).toBe('next-step-trio');
    for (const code of ['LL-bp2-E01-RE', 'LL-bp2-0010-R+', 'LL-bp2-001-', 'LL-bp2-001-R+-extra'])
      expect(getCardEntranceProfile(code)).toBeUndefined();
    const events = [
      event(11, { card: { publicObjectId: 'trio', cardCode: 'LL-bp2-001-R+' } }),
      event(12, { card: { publicObjectId: 'reference', cardCode: 'LL-bp2-E01-RE' } }),
      event(13, { card: { publicObjectId: 'shiki', cardCode: 'PL!SP-pb2-008-PP' } }),
    ];
    const result = collectCardEntrances(init(), input(13, events));
    expect(result.entrances).toEqual([
      { id: 'e11', objectId: 'trio' },
      { id: 'e13', objectId: 'shiki' },
    ]);
    expect(collectCardEntrances(result.cursor, input(13, events)).entrances).toEqual([]);
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
