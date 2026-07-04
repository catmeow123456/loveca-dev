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
  ['PL!-sd1-002-SD', '绚濑绘里'],
  ['PL!-sd1-001-SD', '我们的 LIVE 与你的 LIFE'],
  ['PL!SP-bp2-007-R', '米女梅'],
  ['PL!SP-test-discard', '弃置成本'],
  ['PL!SP-test-member', '加入目标'],
  ['PL!-sd1-019-SD', 'START:DASH!!'],
  ['PL!-bp3-014-N', '星空凛'],
  ['PL!N-bp1-002-R＋', '中须霞'],
  ['PL!-bp6-016-N', '东条希'],
  ['PL!HS-test-top', '回顶目标'],
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

  it('prioritizes self-sacrifice recovery summaries in key mode while all mode keeps raw moves', () => {
    const source = card('PL!-sd1-002-SD', 'obj-eli');
    const recovered = card('PL!-sd1-001-SD', 'obj-live');
    const events: PublicEvent[] = [
      {
        ...baseEvent(71),
        type: 'CardMovedPublic',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        card: source,
        from: { ...zone(ZoneType.MEMBER_SLOT, 'FIRST'), slot: 'CENTER' },
        to: zone(ZoneType.WAITING_ROOM, 'FIRST'),
      },
      {
        ...baseEvent(72),
        type: 'CardEffectSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        abilityId: 'PL!-sd1-002-SD:activated-send-self-recover-member',
        effectKind: 'SELF_SACRIFICE_RECOVER_FROM_WAITING_ROOM',
        summaryStatus: 'COMPLETED',
        sourceCard: source,
        recoveredCards: [recovered],
        hiddenRecoveredCardCount: 0,
        noRecoveredCards: false,
      },
      {
        ...baseEvent(73),
        type: 'CardMovedPublic',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        card: recovered,
        from: zone(ZoneType.WAITING_ROOM, 'FIRST'),
        to: zone(ZoneType.HAND, 'FIRST'),
      },
    ];

    const keyItems = formatPublicBattleLogEvents(events, {
      ...formatterOptions('FIRST'),
      filter: 'KEY',
    });
    const allItems = formatPublicBattleLogEvents(events, {
      ...formatterOptions('FIRST'),
      filter: 'ALL',
    });

    expect(keyItems).toHaveLength(1);
    expect(keyItems[0]?.type).toBe('CardEffectSummary');
    expect(keyItems[0]?.title).toBe('测试管理员 起动');
    expect(keyItems[0]?.detail).toBe('回收 1 张卡');
    expect(keyItems[0]?.effectSummary?.sourceCard?.cardCode).toBe('PL!-sd1-002-SD');
    expect(keyItems[0]?.effectSummary?.recoveredCards[0]?.cardCode).toBe('PL!-sd1-001-SD');

    expect(allItems.map((item) => item.type)).toEqual([
      'CardMovedPublic',
      'CardEffectSummary',
      'CardMovedPublic',
    ]);
  });

  it('formats self-sacrifice recovery summaries with no recovered target', () => {
    const items = formatPublicBattleLogEvents(
      [
        {
          ...baseEvent(81),
          type: 'CardEffectSummary',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          abilityId: 'PL!-sd1-005-SD:activated-send-self-recover-live',
          effectKind: 'SELF_SACRIFICE_RECOVER_FROM_WAITING_ROOM',
          summaryStatus: 'COMPLETED',
          sourceCard: card('PL!-sd1-002-SD', 'obj-source'),
          recoveredCards: [],
          hiddenRecoveredCardCount: 0,
          noRecoveredCards: true,
        },
      ],
      formatterOptions('FIRST')
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('测试管理员 起动');
    expect(items[0]?.detail).toBe('未回收卡牌');
    expect(items[0]?.effectSummary?.noRecoveredCards).toBe(true);
    expect(items[0]?.effectSummary?.recoveredCards).toEqual([]);
  });

  it('prioritizes discard-look-top summaries in key mode while all mode keeps raw facts', () => {
    const source = card('PL!SP-bp2-007-R', 'obj-mei');
    const discardCost = card('PL!SP-test-discard', 'obj-cost');
    const selected = card('PL!SP-test-member', 'obj-selected');
    const events: PublicEvent[] = [
      {
        ...baseEvent(91),
        type: 'CardsInspectedSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        ownerSeat: 'FIRST',
        sourceZone: ZoneType.MAIN_DECK,
        count: 2,
      },
      {
        ...baseEvent(92),
        type: 'CardMovedPublic',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        count: 2,
        from: zone(ZoneType.MAIN_DECK, 'FIRST', 0),
        to: zone(ZoneType.INSPECTION_ZONE, 'FIRST', 0),
      },
      {
        ...baseEvent(93),
        type: 'CardMovedPublic',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        card: discardCost,
        from: zone(ZoneType.HAND, 'FIRST'),
        to: zone(ZoneType.WAITING_ROOM, 'FIRST'),
      },
      {
        ...baseEvent(94),
        type: 'CardsInspectedSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        ownerSeat: 'FIRST',
        sourceZone: ZoneType.MAIN_DECK,
        count: 3,
      },
      {
        ...baseEvent(95),
        type: 'CardMovedPublic',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        count: 3,
        from: zone(ZoneType.MAIN_DECK, 'FIRST', 2),
        to: zone(ZoneType.INSPECTION_ZONE, 'FIRST', 2),
      },
      {
        ...baseEvent(96),
        type: 'CardEffectSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        abilityId: 'generic:discard-look-top-select-to-hand',
        effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
        summaryStatus: 'COMPLETED',
        sourceCard: source,
        recoveredCards: [],
        hiddenRecoveredCardCount: 0,
        noRecoveredCards: false,
        discardedCostCards: [discardCost],
        hiddenDiscardedCostCardCount: 0,
        inspectSourceZone: ZoneType.MAIN_DECK,
        requestedInspectCount: 5,
        actualInspectedCount: 5,
        selectedCards: [selected],
        hiddenSelectedCardCount: 0,
        noSelectedCards: false,
        waitingRoomCardCount: 4,
      },
      {
        ...baseEvent(97),
        type: 'CardMovedPublic',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        card: selected,
        from: zone(ZoneType.INSPECTION_ZONE, 'FIRST', 2),
        to: zone(ZoneType.HAND, 'FIRST'),
      },
      {
        ...baseEvent(98),
        type: 'CardMovedPublic',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        count: 4,
        from: zone(ZoneType.INSPECTION_ZONE, 'FIRST'),
        to: zone(ZoneType.WAITING_ROOM, 'FIRST'),
      },
    ];

    const keyItems = formatPublicBattleLogEvents(events, {
      ...formatterOptions('FIRST'),
      filter: 'KEY',
    });
    const allItems = formatPublicBattleLogEvents(events, {
      ...formatterOptions('FIRST'),
      filter: 'ALL',
    });

    expect(keyItems).toHaveLength(1);
    expect(keyItems[0]?.type).toBe('CardEffectSummary');
    expect(keyItems[0]?.title).toBe('测试管理员 登场');
    expect(keyItems[0]?.detail).toBe('检视卡组顶 5 张，加入 1 张卡，余下 4 张放置入休息室');
    expect(keyItems[0]?.effectSummary?.sourceCard?.cardCode).toBe('PL!SP-bp2-007-R');
    expect(keyItems[0]?.effectSummary?.discardedCostCards[0]?.cardCode).toBe(
      'PL!SP-test-discard'
    );
    expect(keyItems[0]?.effectSummary?.selectedCards[0]?.cardCode).toBe('PL!SP-test-member');

    expect(allItems.length).toBeGreaterThan(1);
    expect(allItems.map((item) => item.type)).toContain('CardsInspectedSummary');
    expect(allItems.map((item) => item.type)).toContain('CardMovedPublic');
    expect(allItems.map((item) => item.type)).toContain('CardEffectSummary');
  });

  it('shows a discard-look-top started summary in key mode while hiding interim raw fragments', () => {
    const source = card('PL!SP-bp2-007-R', 'obj-mei-started');
    const discardCost = card('PL!SP-test-discard', 'obj-cost-started');
    const events: PublicEvent[] = [
      {
        ...baseEvent(111),
        type: 'CardEffectSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        abilityId: 'generic:discard-look-top-select-to-hand',
        effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
        summaryStatus: 'STARTED',
        sourceCard: source,
        sourceOrientationCost: 'WAITING',
        recoveredCards: [],
        hiddenRecoveredCardCount: 0,
        noRecoveredCards: false,
        discardedCostCards: [discardCost],
        hiddenDiscardedCostCardCount: 0,
        inspectSourceZone: ZoneType.MAIN_DECK,
        requestedInspectCount: 5,
        actualInspectedCount: 5,
        selectedCards: [],
        hiddenSelectedCardCount: 0,
        noSelectedCards: false,
        waitingRoomCardCount: 0,
      },
      {
        ...baseEvent(112),
        type: 'CardsInspectedSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        ownerSeat: 'FIRST',
        sourceZone: ZoneType.MAIN_DECK,
        count: 2,
      },
      {
        ...baseEvent(113),
        type: 'CardMovedPublic',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        count: 2,
        from: zone(ZoneType.MAIN_DECK, 'FIRST', 0),
        to: zone(ZoneType.INSPECTION_ZONE, 'FIRST', 0),
      },
      {
        ...baseEvent(114),
        type: 'CardMovedPublic',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        card: discardCost,
        from: zone(ZoneType.HAND, 'FIRST'),
        to: zone(ZoneType.WAITING_ROOM, 'FIRST'),
      },
      {
        ...baseEvent(115),
        type: 'CardsInspectedSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        ownerSeat: 'FIRST',
        sourceZone: ZoneType.MAIN_DECK,
        count: 3,
      },
      {
        ...baseEvent(116),
        type: 'CardMovedPublic',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        count: 3,
        from: zone(ZoneType.MAIN_DECK, 'FIRST', 2),
        to: zone(ZoneType.INSPECTION_ZONE, 'FIRST', 2),
      },
    ];

    const keyItems = formatPublicBattleLogEvents(events, {
      ...formatterOptions('FIRST'),
      filter: 'KEY',
    });
    const allItems = formatPublicBattleLogEvents(events, {
      ...formatterOptions('FIRST'),
      filter: 'ALL',
    });

    expect(keyItems).toHaveLength(1);
    expect(keyItems[0]?.type).toBe('CardEffectSummary');
    expect(keyItems[0]?.detail).toBe('检视卡组顶 5 张，处理中');
    expect(keyItems[0]?.detail).not.toContain('未加入');
    expect(keyItems[0]?.detail).not.toContain('余下 0 张');
    expect(keyItems[0]?.effectSummary?.summaryStatus).toBe('STARTED');
    expect(keyItems[0]?.effectSummary?.sourceOrientationCost).toBe('WAITING');
    expect(allItems.length).toBeGreaterThan(1);
  });

  it('keeps only the completed discard-look-top summary in key mode when both statuses exist', () => {
    const source = card('PL!SP-bp2-007-R', 'obj-mei-both');
    const discardCost = card('PL!SP-test-discard', 'obj-cost-both');
    const selected = card('PL!SP-test-member', 'obj-selected-both');
    const startedSummary: PublicEvent = {
      ...baseEvent(121),
      type: 'CardEffectSummary',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      abilityId: 'generic:discard-look-top-select-to-hand',
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      summaryStatus: 'STARTED',
      sourceCard: source,
      recoveredCards: [],
      hiddenRecoveredCardCount: 0,
      noRecoveredCards: false,
      discardedCostCards: [discardCost],
      hiddenDiscardedCostCardCount: 0,
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 5,
      actualInspectedCount: 5,
      selectedCards: [],
      hiddenSelectedCardCount: 0,
      noSelectedCards: false,
    };
    const completedSummary: PublicEvent = {
      ...baseEvent(125),
      type: 'CardEffectSummary',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      abilityId: 'generic:discard-look-top-select-to-hand',
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      summaryStatus: 'COMPLETED',
      sourceCard: source,
      recoveredCards: [],
      hiddenRecoveredCardCount: 0,
      noRecoveredCards: false,
      discardedCostCards: [discardCost],
      hiddenDiscardedCostCardCount: 0,
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 5,
      actualInspectedCount: 5,
      selectedCards: [selected],
      hiddenSelectedCardCount: 0,
      noSelectedCards: false,
      waitingRoomCardCount: 4,
    };

    const keyItems = formatPublicBattleLogEvents(
      [
        startedSummary,
        {
          ...baseEvent(122),
          type: 'CardsInspectedSummary',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          ownerSeat: 'FIRST',
          sourceZone: ZoneType.MAIN_DECK,
          count: 5,
        },
        {
          ...baseEvent(123),
          type: 'CardMovedPublic',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          card: discardCost,
          from: zone(ZoneType.HAND, 'FIRST'),
          to: zone(ZoneType.WAITING_ROOM, 'FIRST'),
        },
        completedSummary,
        {
          ...baseEvent(126),
          type: 'CardMovedPublic',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          card: selected,
          from: zone(ZoneType.INSPECTION_ZONE, 'FIRST'),
          to: zone(ZoneType.HAND, 'FIRST'),
        },
      ],
      { ...formatterOptions('FIRST'), filter: 'KEY' }
    );

    expect(keyItems).toHaveLength(1);
    expect(keyItems[0]?.type).toBe('CardEffectSummary');
    expect(keyItems[0]?.effectSummary?.summaryStatus).toBe('COMPLETED');
    expect(keyItems[0]?.detail).toBe('检视卡组顶 5 张，加入 1 张卡，余下 4 张放置入休息室');
  });

  it('does not hide unrelated nearby inspection facts after a started discard-look-top summary', () => {
    const source = card('PL!SP-bp2-007-R', 'obj-mei-budget');
    const discardCost = card('PL!SP-test-discard', 'obj-cost-budget');
    const events: PublicEvent[] = [
      {
        ...baseEvent(131),
        type: 'CardEffectSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        abilityId: 'generic:discard-look-top-select-to-hand',
        effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
        summaryStatus: 'STARTED',
        sourceCard: source,
        recoveredCards: [],
        hiddenRecoveredCardCount: 0,
        noRecoveredCards: false,
        discardedCostCards: [discardCost],
        hiddenDiscardedCostCardCount: 0,
        inspectSourceZone: ZoneType.MAIN_DECK,
        requestedInspectCount: 5,
        actualInspectedCount: 5,
        selectedCards: [],
        hiddenSelectedCardCount: 0,
        noSelectedCards: false,
      },
      {
        ...baseEvent(132),
        type: 'CardsInspectedSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        ownerSeat: 'FIRST',
        sourceZone: ZoneType.MAIN_DECK,
        count: 2,
      },
      {
        ...baseEvent(133),
        type: 'CardsInspectedSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        ownerSeat: 'FIRST',
        sourceZone: ZoneType.MAIN_DECK,
        count: 3,
      },
      {
        ...baseEvent(134),
        type: 'CardsInspectedSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        ownerSeat: 'FIRST',
        sourceZone: ZoneType.MAIN_DECK,
        count: 1,
      },
    ];

    const keyItems = formatPublicBattleLogEvents(events, {
      ...formatterOptions('FIRST'),
      filter: 'KEY',
    });

    expect(keyItems).toHaveLength(2);
    expect(keyItems[0]?.type).toBe('CardEffectSummary');
    expect(keyItems[1]?.type).toBe('CardsInspectedSummary');
    expect(keyItems[1]?.title).toBe('测试管理员 检视卡组顶 1 张');
  });

  it('formats discard-look-top summaries with no selected target', () => {
    const items = formatPublicBattleLogEvents(
      [
        {
          ...baseEvent(101),
          type: 'CardEffectSummary',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          abilityId: 'generic:discard-look-top-select-to-hand',
          effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
          summaryStatus: 'COMPLETED',
          sourceCard: card('PL!SP-bp2-007-R', 'obj-mei-no-select'),
          recoveredCards: [],
          hiddenRecoveredCardCount: 0,
          noRecoveredCards: false,
          discardedCostCards: [card('PL!SP-test-discard', 'obj-cost-no-select')],
          hiddenDiscardedCostCardCount: 0,
          inspectSourceZone: ZoneType.MAIN_DECK,
          requestedInspectCount: 5,
          actualInspectedCount: 5,
          selectedCards: [],
          hiddenSelectedCardCount: 0,
          noSelectedCards: true,
          waitingRoomCardCount: 5,
        },
      ],
      formatterOptions('FIRST')
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('测试管理员 登场');
    expect(items[0]?.detail).toBe('检视卡组顶 5 张，未加入，余下 5 张放置入休息室');
    expect(items[0]?.effectSummary?.selectedCards).toEqual([]);
    expect(items[0]?.effectSummary?.noSelectedCards).toBe(true);
  });

  it('hides hidden inspection-to-hand result moves covered by a completed summary in key mode', () => {
    const summary: PublicEvent = {
      ...baseEvent(141),
      type: 'CardEffectSummary',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      abilityId: 'LL-bp6-001:on-enter-look-top-six-take-two',
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      summaryStatus: 'COMPLETED',
      sourceCard: card('LL-bp6-001-R＋', 'obj-ll-source'),
      sourceActionLabel: '登场',
      recoveredCards: [],
      hiddenRecoveredCardCount: 0,
      noRecoveredCards: false,
      discardedCostCards: [],
      hiddenDiscardedCostCardCount: 0,
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 6,
      actualInspectedCount: 6,
      selectedCards: [],
      hiddenSelectedCardCount: 2,
      noSelectedCards: false,
      waitingRoomCardCount: 4,
    };
    const hiddenHandMoveA: PublicEvent = {
      ...baseEvent(142),
      type: 'CardMovedPublic',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      count: 1,
      from: zone(ZoneType.INSPECTION_ZONE, 'FIRST'),
      to: zone(ZoneType.HAND, 'FIRST'),
    };
    const hiddenHandMoveB: PublicEvent = {
      ...baseEvent(143),
      type: 'CardMovedPublic',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      count: 1,
      from: zone(ZoneType.INSPECTION_ZONE, 'FIRST'),
      to: zone(ZoneType.HAND, 'FIRST'),
    };

    const keyItems = formatPublicBattleLogEvents(
      [summary, hiddenHandMoveA, hiddenHandMoveB],
      { ...formatterOptions('FIRST'), filter: 'KEY' }
    );
    const allItems = formatPublicBattleLogEvents(
      [summary, hiddenHandMoveA, hiddenHandMoveB],
      { ...formatterOptions('FIRST'), filter: 'ALL' }
    );

    expect(keyItems).toHaveLength(1);
    expect(keyItems[0]?.type).toBe('CardEffectSummary');
    expect(keyItems[0]?.detail).toBe('检视卡组顶 6 张，加入 2 张卡，余下 4 张放置入休息室');
    expect(keyItems[0]?.hiddenCardCount).toBe(0);
    expect(keyItems[0]?.effectSummary?.selectedCards).toEqual([]);
    expect(keyItems[0]?.effectSummary?.hiddenSelectedCardCount).toBe(2);
    expect(allItems).toHaveLength(2);
    expect(allItems[1]?.type).toBe('PublicBattleLogGroup');
    expect(allItems[1]?.hiddenCardCount).toBe(2);
  });

  it('hides mixed public and hidden inspection-to-hand result moves by selected budget', () => {
    const selected = card('PL!SP-test-member', 'obj-selected-mixed');
    const summary: PublicEvent = {
      ...baseEvent(161),
      type: 'CardEffectSummary',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      abilityId: 'LL-bp6-001:on-enter-look-top-six-take-two',
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      summaryStatus: 'COMPLETED',
      sourceCard: card('LL-bp6-001-R＋', 'obj-ll-source-mixed'),
      sourceActionLabel: '登场',
      recoveredCards: [],
      hiddenRecoveredCardCount: 0,
      noRecoveredCards: false,
      discardedCostCards: [],
      hiddenDiscardedCostCardCount: 0,
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 6,
      actualInspectedCount: 6,
      selectedCards: [selected],
      hiddenSelectedCardCount: 1,
      noSelectedCards: false,
      waitingRoomCardCount: 4,
    };
    const publicHandMove: PublicEvent = {
      ...baseEvent(162),
      type: 'CardMovedPublic',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      card: selected,
      from: zone(ZoneType.INSPECTION_ZONE, 'FIRST'),
      to: zone(ZoneType.HAND, 'FIRST'),
    };
    const hiddenHandMove: PublicEvent = {
      ...baseEvent(163),
      type: 'CardMovedPublic',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      count: 1,
      from: zone(ZoneType.INSPECTION_ZONE, 'FIRST'),
      to: zone(ZoneType.HAND, 'FIRST'),
    };

    const keyItems = formatPublicBattleLogEvents(
      [summary, publicHandMove, hiddenHandMove],
      { ...formatterOptions('FIRST'), filter: 'KEY' }
    );

    expect(keyItems).toHaveLength(1);
    expect(keyItems[0]?.type).toBe('CardEffectSummary');
    expect(keyItems[0]?.detail).toBe('检视卡组顶 6 张，加入 2 张卡，余下 4 张放置入休息室');
    expect(keyItems[0]?.hiddenCardCount).toBe(0);
    expect(keyItems[0]?.effectSummary?.selectedCards).toEqual([
      expect.objectContaining({ publicObjectId: 'obj-selected-mixed' }),
    ]);
    expect(keyItems[0]?.effectSummary?.hiddenSelectedCardCount).toBe(1);
  });

  it('does not hide inspection-to-hand result moves beyond the selected budget', () => {
    const summary: PublicEvent = {
      ...baseEvent(171),
      type: 'CardEffectSummary',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      abilityId: 'LL-bp6-001:on-enter-look-top-six-take-two',
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      summaryStatus: 'COMPLETED',
      sourceCard: card('LL-bp6-001-R＋', 'obj-ll-source-budget'),
      sourceActionLabel: '登场',
      recoveredCards: [],
      hiddenRecoveredCardCount: 0,
      noRecoveredCards: false,
      discardedCostCards: [],
      hiddenDiscardedCostCardCount: 0,
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 6,
      actualInspectedCount: 6,
      selectedCards: [],
      hiddenSelectedCardCount: 1,
      noSelectedCards: false,
      waitingRoomCardCount: 5,
    };
    const coveredHandMove: PublicEvent = {
      ...baseEvent(172),
      type: 'CardMovedPublic',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      count: 1,
      from: zone(ZoneType.INSPECTION_ZONE, 'FIRST'),
      to: zone(ZoneType.HAND, 'FIRST'),
    };
    const unrelatedHandMove: PublicEvent = {
      ...baseEvent(173),
      type: 'CardMovedPublic',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      count: 1,
      from: zone(ZoneType.INSPECTION_ZONE, 'FIRST'),
      to: zone(ZoneType.HAND, 'FIRST'),
    };

    const keyItems = formatPublicBattleLogEvents(
      [summary, coveredHandMove, unrelatedHandMove],
      { ...formatterOptions('FIRST'), filter: 'KEY' }
    );

    expect(keyItems).toHaveLength(2);
    expect(keyItems[0]?.type).toBe('CardEffectSummary');
    expect(keyItems[1]?.type).toBe('PublicBattleLogGroup');
    expect(keyItems[1]?.title).toBe('测试管理员 从检视结果加入 1 张手牌');
  });

  it('formats no-cost look-top summaries with a source action label', () => {
    const source = card('PL!HS-bp2-013-N', 'obj-tsuzuri-leave');
    const selected = [
      card('PL!HS-test-live', 'obj-live-selected-a'),
      card('PL!HS-test-live', 'obj-live-selected-b'),
    ];
    const items = formatPublicBattleLogEvents(
      [
        {
          ...baseEvent(151),
          type: 'CardEffectSummary',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          abilityId: 'PL!HS-bp2-013-N:leave-stage-look-top-live',
          effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
          summaryStatus: 'COMPLETED',
          sourceCard: source,
          sourceActionLabel: '离场',
          recoveredCards: [],
          hiddenRecoveredCardCount: 0,
          noRecoveredCards: false,
          discardedCostCards: [],
          hiddenDiscardedCostCardCount: 0,
          inspectSourceZone: ZoneType.MAIN_DECK,
          requestedInspectCount: 5,
          actualInspectedCount: 5,
          selectedCards: selected,
          hiddenSelectedCardCount: 0,
          noSelectedCards: false,
          waitingRoomCardCount: 3,
        },
      ],
      formatterOptions('FIRST')
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('测试管理员 离场');
    expect(items[0]?.detail).toBe('检视卡组顶 5 张，加入 2 张卡，余下 3 张放置入休息室');
    expect(items[0]?.effectSummary?.sourceActionLabel).toBe('离场');
    expect(items[0]?.effectSummary?.sourceOrientationCost).toBeNull();
    expect(items[0]?.effectSummary?.discardedCostCards).toEqual([]);
    expect(items[0]?.effectSummary?.hiddenDiscardedCostCardCount).toBe(0);
    expect(items[0]?.effectSummary?.selectedCards).toHaveLength(2);
    expect(items[0]?.hiddenCardCount).toBe(0);
  });

  it('shows an arrange-inspected-deck-top started summary while hiding interim raw fragments in key mode', () => {
    const source = card('PL!-sd1-019-SD', 'obj-start-dash');
    const events: PublicEvent[] = [
      {
        ...baseEvent(201),
        type: 'CardEffectSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        abilityId: 'PL!-sd1-019-SD:live-success-start-dash',
        effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
        summaryStatus: 'STARTED',
        sourceCard: source,
        sourceActionLabel: 'LIVE开始',
        recoveredCards: [],
        hiddenRecoveredCardCount: 0,
        noRecoveredCards: false,
        discardedCostCards: [],
        hiddenDiscardedCostCardCount: 0,
        inspectSourceZone: ZoneType.MAIN_DECK,
        requestedInspectCount: 3,
        actualInspectedCount: 3,
        selectedCards: [],
        hiddenSelectedCardCount: 0,
        noSelectedCards: false,
        waitingRoomCardCount: 0,
      },
      {
        ...baseEvent(202),
        type: 'CardsInspectedSummary',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        ownerSeat: 'FIRST',
        sourceZone: ZoneType.MAIN_DECK,
        count: 3,
      },
      {
        ...baseEvent(203),
        type: 'CardMovedPublic',
        source: 'PLAYER',
        actorSeat: 'FIRST',
        count: 3,
        from: zone(ZoneType.MAIN_DECK, 'FIRST', 0),
        to: zone(ZoneType.INSPECTION_ZONE, 'FIRST', 0),
      },
    ];

    const keyItems = formatPublicBattleLogEvents(events, {
      ...formatterOptions('FIRST'),
      filter: 'KEY',
    });
    const allItems = formatPublicBattleLogEvents(events, {
      ...formatterOptions('FIRST'),
      filter: 'ALL',
    });

    expect(keyItems).toHaveLength(1);
    expect(keyItems[0]?.title).toBe('测试管理员 LIVE开始');
    expect(keyItems[0]?.detail).toBe('检视卡组顶 3 张，排序中');
    expect(keyItems[0]?.effectSummary?.kind).toBe('ARRANGE_INSPECTED_DECK_TOP');
    expect(keyItems[0]?.effectSummary?.sourceActionLabel).toBe('LIVE开始');
    expect(allItems.length).toBeGreaterThan(keyItems.length);
    expect(allItems.map((item) => item.type)).toContain('CardsInspectedSummary');
  });

  it('formats a completed arrange-inspected-deck-top summary with top deck and waiting room counts', () => {
    const topCard = card('PL!HS-test-top', 'obj-arrange-top');
    const summary: PublicEvent = {
      ...baseEvent(211),
      type: 'CardEffectSummary',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      abilityId: 'PL!N-bp1-002:on-enter-look-top-three-arrange-to-top',
      effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
      summaryStatus: 'COMPLETED',
      sourceCard: card('PL!-bp3-014-N', 'obj-rin-wait'),
      sourceActionLabel: '登场',
      sourceOrientationCost: 'WAITING',
      recoveredCards: [],
      hiddenRecoveredCardCount: 0,
      noRecoveredCards: false,
      discardedCostCards: [],
      hiddenDiscardedCostCardCount: 0,
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 3,
      actualInspectedCount: 3,
      selectedCards: [topCard],
      hiddenSelectedCardCount: 1,
      noSelectedCards: false,
      waitingRoomCardCount: 1,
    };
    const topMove: PublicEvent = {
      ...baseEvent(212),
      type: 'CardMovedPublic',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      count: 2,
      from: zone(ZoneType.INSPECTION_ZONE, 'FIRST'),
      to: zone(ZoneType.MAIN_DECK, 'FIRST', 0),
    };
    const waitingMove: PublicEvent = {
      ...baseEvent(213),
      type: 'CardMovedPublic',
      source: 'PLAYER',
      actorSeat: 'FIRST',
      count: 1,
      from: zone(ZoneType.INSPECTION_ZONE, 'FIRST'),
      to: zone(ZoneType.WAITING_ROOM, 'FIRST'),
    };

    const keyItems = formatPublicBattleLogEvents([summary, topMove, waitingMove], {
      ...formatterOptions('FIRST'),
      filter: 'KEY',
    });
    const allItems = formatPublicBattleLogEvents([summary, topMove, waitingMove], {
      ...formatterOptions('FIRST'),
      filter: 'ALL',
    });

    expect(keyItems).toHaveLength(1);
    expect(keyItems[0]?.detail).toBe(
      '检视卡组顶 3 张，按顺序放回卡组顶 2 张，余下 1 张放置入休息室'
    );
    expect(keyItems[0]?.effectSummary?.selectedCards).toEqual([
      expect.objectContaining({ publicObjectId: 'obj-arrange-top' }),
    ]);
    expect(keyItems[0]?.effectSummary?.hiddenSelectedCardCount).toBe(1);
    expect(keyItems[0]?.effectSummary?.sourceOrientationCost).toBe('WAITING');
    expect(keyItems[0]?.hiddenCardCount).toBe(0);
    expect(allItems.length).toBeGreaterThan(1);
  });

  it('formats an all-top arrange summary without a waiting room tail', () => {
    const items = formatPublicBattleLogEvents(
      [
        {
          ...baseEvent(221),
          type: 'CardEffectSummary',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          abilityId: 'PL!-bp6-016:live-success-look-top-three-arrange-all',
          effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
          summaryStatus: 'COMPLETED',
          sourceCard: card('PL!-bp6-016-N', 'obj-nozomi'),
          sourceActionLabel: 'LIVE成功',
          recoveredCards: [],
          hiddenRecoveredCardCount: 0,
          noRecoveredCards: false,
          discardedCostCards: [],
          hiddenDiscardedCostCardCount: 0,
          inspectSourceZone: ZoneType.MAIN_DECK,
          requestedInspectCount: 3,
          actualInspectedCount: 3,
          selectedCards: [],
          hiddenSelectedCardCount: 3,
          noSelectedCards: false,
          waitingRoomCardCount: 0,
        },
      ],
      formatterOptions('FIRST')
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('测试管理员 LIVE成功');
    expect(items[0]?.detail).toBe('检视卡组顶 3 张，按顺序放回卡组顶 3 张');
    expect(items[0]?.detail).not.toContain('休息室');
  });

  it('formats selecting zero cards back to deck top as all inspected cards entering waiting room', () => {
    const items = formatPublicBattleLogEvents(
      [
        {
          ...baseEvent(231),
          type: 'CardEffectSummary',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          abilityId: 'PL!-sd1-019-SD:live-success-start-dash',
          effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
          summaryStatus: 'COMPLETED',
          sourceCard: card('PL!-sd1-019-SD', 'obj-start-dash-zero'),
          sourceActionLabel: 'LIVE成功',
          recoveredCards: [],
          hiddenRecoveredCardCount: 0,
          noRecoveredCards: false,
          discardedCostCards: [],
          hiddenDiscardedCostCardCount: 0,
          inspectSourceZone: ZoneType.MAIN_DECK,
          requestedInspectCount: 3,
          actualInspectedCount: 3,
          selectedCards: [],
          hiddenSelectedCardCount: 0,
          noSelectedCards: true,
          waitingRoomCardCount: 3,
        },
      ],
      formatterOptions('FIRST')
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.detail).toBe(
      '检视卡组顶 3 张，未放回卡组顶，余下 3 张放置入休息室'
    );
  });

  it('keeps hidden arrange-inspected-deck-top card identities concealed', () => {
    const secretCard = card('PL!HS-test-top', 'obj-secret-top');
    const items = formatPublicBattleLogEvents(
      [
        {
          ...baseEvent(241),
          type: 'CardEffectSummary',
          source: 'PLAYER',
          actorSeat: 'FIRST',
          abilityId: 'PL!HS-bp6-001:on-enter-look-stage-plus-two',
          effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
          summaryStatus: 'COMPLETED',
          sourceCard: card('PL!N-bp1-002-R＋', 'obj-public-source'),
          sourceActionLabel: '登场',
          recoveredCards: [],
          hiddenRecoveredCardCount: 0,
          noRecoveredCards: false,
          discardedCostCards: [],
          hiddenDiscardedCostCardCount: 0,
          inspectSourceZone: ZoneType.MAIN_DECK,
          requestedInspectCount: 4,
          actualInspectedCount: 4,
          selectedCards: [],
          hiddenSelectedCardCount: 1,
          noSelectedCards: false,
          waitingRoomCardCount: 3,
        },
      ],
      formatterOptions('FIRST')
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.detail).toBe(
      '检视卡组顶 4 张，按顺序放回卡组顶 1 张，余下 3 张放置入休息室'
    );
    expect(items[0]?.cards).not.toContainEqual(expect.objectContaining(secretCard));
    expect(items[0]?.effectSummary?.selectedCards).toEqual([]);
    expect(items[0]?.effectSummary?.hiddenSelectedCardCount).toBe(1);
  });
});
