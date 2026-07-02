import { describe, expect, it } from 'vitest';
import type { AnyCardData } from '../../src/domain/entities/card';
import { CardType, ZoneType } from '../../src/shared/types/enums';
import type { PublicEvent, PublicZoneRef, Seat } from '../../src/online/types';
import { formatPublicBattleLogEvents } from '../../client/src/lib/publicBattleLogFormatter';

const MATCH_ID = 'public-log-test';
const BASE_TIMESTAMP = Date.UTC(2026, 6, 2, 18, 30, 0);

const cardData = new Map<string, AnyCardData>();

for (const [cardCode, nameCn] of [
  ['PL!HS-bp5-008-R', '桂城泉'],
  ['PL!HS-sd1-006-SD', '安养寺姬芽'],
  ['PL!HS-bp1-003-SEC', '乙宗梢'],
  ['PL!HS-bp5-001-SEC', '日野下花帆'],
  ['PL!HS-bp5-019-L', '花结'],
] as const) {
  cardData.set(cardCode, {
    cardCode,
    name: nameCn,
    nameCn,
    cardType: CardType.MEMBER,
  } as AnyCardData);
}

function formatterOptions(viewerSeat: Seat | null = 'FIRST') {
  return {
    viewerSeat,
    getCardData: (cardCode: string) => cardData.get(cardCode),
    getSeatLabel: (seat: Seat) => (seat === 'FIRST' ? '测试管理员' : 'Test Player 1'),
  };
}

function fallbackFormatterOptions(viewerSeat: Seat | null = null) {
  return {
    viewerSeat,
    getCardData: (cardCode: string) => cardData.get(cardCode),
    getSeatLabel: (seat: Seat) => seat,
  };
}

function baseEvent(seq: number): Pick<PublicEvent, 'eventId' | 'matchId' | 'seq' | 'timestamp'> {
  return {
    eventId: `event-${seq}`,
    matchId: MATCH_ID,
    seq,
    timestamp: BASE_TIMESTAMP + seq * 100,
  };
}

function zone(zoneType: ZoneType, ownerSeat: Seat, index?: number): PublicZoneRef {
  return index === undefined ? { zone: zoneType, ownerSeat } : { zone: zoneType, ownerSeat, index };
}

function card(cardCode: string, publicObjectId = `obj-${cardCode}`) {
  return { cardCode, publicObjectId };
}

describe('public battle log formatter', () => {
  it('formats actor and zone owner labels from the viewer perspective', () => {
    const items = formatPublicBattleLogEvents(
      [
        {
          ...baseEvent(1),
          type: 'CardMovedPublic',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          card: card('PL!HS-sd1-006-SD'),
          from: zone(ZoneType.HAND, 'FIRST'),
          to: zone(ZoneType.WAITING_ROOM, 'FIRST'),
        },
      ],
      formatterOptions('FIRST')
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('测试管理员 将 1 张手牌放置入休息室');
    expect(items[0]?.detail).toBe('来源：你的手牌 -> 你的休息室');
    expect(items[0]?.title).not.toContain('FIRST');
    expect(items[0]?.detail).not.toContain('FIRST');
  });

  it('falls back to first or second seat labels instead of raw FIRST or SECOND', () => {
    const items = formatPublicBattleLogEvents(
      [
        {
          ...baseEvent(2),
          type: 'CardMovedPublic',
          source: 'SYSTEM',
          actorSeat: 'FIRST',
          count: 1,
          from: zone(ZoneType.ENERGY_DECK, 'FIRST'),
          to: zone(ZoneType.ENERGY_ZONE, 'FIRST'),
        },
      ],
      fallbackFormatterOptions(null)
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('规则处理：先攻放置 1 张能量');
    expect(items[0]?.detail).toBe('来源：先攻能量卡组 -> 先攻能量区');
    expect(items[0]?.title).not.toContain('FIRST');
    expect(items[0]?.detail).not.toContain('FIRST');
  });

  it('deduplicates adjacent revealed-and-moved plus derived public move events', () => {
    const from = zone(ZoneType.HAND, 'FIRST');
    const to = { ...zone(ZoneType.MEMBER_SLOT, 'FIRST'), slot: 'CENTER' };
    const revealedCard = card('PL!HS-bp5-008-R', 'obj-izumi');
    const items = formatPublicBattleLogEvents(
      [
        {
          ...baseEvent(18),
          type: 'CardRevealedAndMoved',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          card: revealedCard,
          from,
          to,
        },
        {
          ...baseEvent(19),
          type: 'CardMovedPublic',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          card: revealedCard,
          from,
          to,
        },
      ],
      formatterOptions('FIRST')
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.seqLabel).toBe('18');
    expect(items[0]?.title).toBe('测试管理员 登场「桂城泉」');
    expect(items[0]?.cards).toHaveLength(1);
  });

  it('folds private inspection movements and keeps interleaved public facts separate', () => {
    const inspectionMoves = [23, 25, 26, 27, 28].map((seq, index) => ({
      ...baseEvent(seq),
      type: 'CardMovedPublic' as const,
      source: 'PLAYER' as const,
      actorSeat: 'FIRST' as const,
      count: 1,
      from: zone(ZoneType.MAIN_DECK, 'FIRST', index),
      to: zone(ZoneType.INSPECTION_ZONE, 'FIRST', index),
    }));
    const items = formatPublicBattleLogEvents(
      [
        {
          ...baseEvent(22),
          type: 'CardsInspectedSummary',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          ownerSeat: 'FIRST',
          sourceZone: ZoneType.MAIN_DECK,
          count: 5,
        },
        inspectionMoves[0]!,
        {
          ...baseEvent(24),
          type: 'CardMovedPublic',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          card: card('PL!HS-sd1-006-SD', 'obj-hime'),
          from: zone(ZoneType.HAND, 'FIRST'),
          to: zone(ZoneType.WAITING_ROOM, 'FIRST'),
        },
        ...inspectionMoves.slice(1),
      ],
      formatterOptions('FIRST')
    );

    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe('测试管理员 检视卡组顶 5 张');
    expect(items[0]?.seqLabel).toBe('22-23/25-28');
    expect(items[0]?.hiddenCardCount).toBe(5);
    expect(items[0]?.cards).toHaveLength(0);
    expect(items[1]?.title).toBe('测试管理员 将 1 张手牌放置入休息室');
  });

  it('folds inspection result moves and groups duplicate card chips by card code', () => {
    const events: PublicEvent[] = [
      {
        ...baseEvent(31),
        type: 'CardRevealedAndMoved',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        card: card('PL!HS-bp1-003-SEC', 'obj-kaho-1'),
        from: zone(ZoneType.INSPECTION_ZONE, 'FIRST', 0),
        to: zone(ZoneType.HAND, 'FIRST'),
      },
      ...[
        ['PL!HS-bp5-001-SEC', 'obj-kaho-2'],
        ['PL!HS-bp5-001-SEC', 'obj-kaho-3'],
        ['PL!HS-bp5-019-L', 'obj-hanayui'],
        ['PL!HS-bp5-008-R', 'obj-izumi'],
      ].map(([cardCode, publicObjectId], offset) => ({
        ...baseEvent(32 + offset),
        type: 'CardMovedPublic' as const,
        source: 'PLAYER' as const,
        actorSeat: 'FIRST' as const,
        card: card(cardCode!, publicObjectId!),
        from: zone(ZoneType.INSPECTION_ZONE, 'FIRST', offset + 1),
        to: zone(ZoneType.WAITING_ROOM, 'FIRST'),
      })),
    ];

    const items = formatPublicBattleLogEvents(events, formatterOptions('FIRST'));

    expect(items).toHaveLength(1);
    expect(items[0]?.seqLabel).toBe('31-35');
    expect(items[0]?.title).toBe('测试管理员 处理检视结果');
    expect(items[0]?.detail).toBe('1 张加入手牌，4 张放置入休息室');
    expect(items[0]?.cards).toHaveLength(5);
    expect(
      items[0]?.cardGroups.find((group) => group.cardCode === 'PL!HS-bp5-001-SEC')?.count
    ).toBe(2);
  });

  it('keeps face-down live cards hidden while still showing the public count', () => {
    const items = formatPublicBattleLogEvents(
      [
        {
          ...baseEvent(59),
          type: 'CardMovedPublic',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          count: 2,
          from: zone(ZoneType.HAND, 'FIRST'),
          to: zone(ZoneType.LIVE_ZONE, 'FIRST'),
        },
      ],
      formatterOptions('FIRST')
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('测试管理员 盖放 2 张 LIVE');
    expect(items[0]?.cards).toHaveLength(0);
    expect(items[0]?.hiddenCardCount).toBe(2);
  });
});
