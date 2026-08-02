import { describe, expect, it } from 'vitest';
import { createHeartIcon, type MemberCardData } from '../../src/domain/entities/card';
import { CardType, HeartColor } from '../../src/shared/types/enums';
import {
  GLICKO1_PER_MATCH_SHADOW_V2,
  GLICKO1_PER_MATCH_V2,
  GLICKO1_PER_MATCH_V3,
  type Glicko1Config,
} from '../../src/server/rating/glicko';
import {
  buildRankedCardCatalogIdentity,
  buildRankedCompetitiveEnvironmentIdentity,
} from '../../src/server/rating/ranked-environment';
import {
  materializeRankedRatingLedger,
  resolveEffectiveRankedResults,
  type RankedRatingEvent,
} from '../../src/server/rating/ranked-ledger';

const CONFIG: Glicko1Config = {
  ...GLICKO1_PER_MATCH_SHADOW_V2,
  algorithmVersion: 'GLICKO1_PER_MATCH_TEST_V1',
};

function event(
  overrides: Partial<RankedRatingEvent> & Pick<RankedRatingEvent, 'eventId' | 'eventSequence'>
): RankedRatingEvent {
  return {
    eventType: 'SETTLEMENT',
    matchId: `match-${overrides.eventSequence}`,
    targetEventId: null,
    firstUserId: 'alice',
    secondUserId: 'bob',
    winnerSeat: 'FIRST',
    resultType: 'NORMAL',
    ratedAt: new Date(`2026-08-0${overrides.eventSequence}T00:00:00.000Z`),
    algorithmVersion: CONFIG.algorithmVersion,
    ...overrides,
  };
}

function memberCard(overrides: Partial<MemberCardData> = {}): MemberCardData {
  return {
    cardCode: 'TEST-001',
    cardType: CardType.MEMBER,
    name: '测试成员',
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    cardText: '登场：抽 1 张牌。',
    imageFilename: 'test-001.webp',
    ...overrides,
  };
}

describe('ranked rating ledger materialization', () => {
  it('starts replay from a season soft-reset seed', () => {
    const firstUserId = 'player-a';
    const secondUserId = 'player-b';
    const materialization = materializeRankedRatingLedger(
      [
        event({
          eventId: 'seeded-match',
          eventSequence: 1,
          matchId: 'match-seeded',
          firstUserId,
          secondUserId,
          winnerSeat: 'FIRST',
          ratedAt: new Date('2026-08-01T12:00:00.000Z'),
        }),
      ],
      CONFIG,
      new Map([
        [
          firstUserId,
          {
            rating: 1700,
            ratingDeviation: 200,
            ratedMatchCount: 0,
            lastRatedAt: null,
          },
        ],
      ])
    );

    expect(materialization.steps[0]?.firstBefore).toMatchObject({
      rating: 1700,
      ratingDeviation: 200,
      ratedMatchCount: 0,
    });
  });

  it('replays effective results deterministically from event sequence and match time', () => {
    const events = [
      event({
        eventId: 'event-2',
        eventSequence: 2,
        matchId: 'match-2',
        secondUserId: 'carol',
        ratedAt: new Date('2026-08-02T00:00:00.000Z'),
      }),
      event({
        eventId: 'event-1',
        eventSequence: 1,
        matchId: 'match-1',
        ratedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ];

    const materialization = materializeRankedRatingLedger(events, CONFIG);

    expect(materialization.steps.map((step) => step.matchId)).toEqual(['match-1', 'match-2']);
    expect(materialization.players.get('alice')?.ratedMatchCount).toBe(2);
    expect(materialization.players.get('bob')?.ratedMatchCount).toBe(1);
    expect(materialization.players.get('carol')?.ratedMatchCount).toBe(1);
    expect(materialization.steps[1]?.firstBefore).toEqual(materialization.steps[0]?.firstAfter);
  });

  it('voids and replaces a result through an append-only correction chain', () => {
    const initial = [
      event({
        eventId: 'event-1',
        eventSequence: 1,
        matchId: 'match-1',
        ratedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
      event({
        eventId: 'event-2',
        eventSequence: 2,
        matchId: 'match-2',
        secondUserId: 'carol',
        ratedAt: new Date('2026-08-02T00:00:00.000Z'),
      }),
    ];
    const voidEvent = event({
      eventId: 'event-3',
      eventSequence: 3,
      eventType: 'VOID',
      matchId: 'match-1',
      targetEventId: 'event-1',
      winnerSeat: null,
      resultType: 'PLATFORM_NO_CONTEST',
      ratedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const afterVoid = materializeRankedRatingLedger([...initial, voidEvent], CONFIG);

    expect(afterVoid.steps.map((step) => step.matchId)).toEqual(['match-2']);
    expect(afterVoid.players.has('bob')).toBe(false);
    expect(afterVoid.players.get('alice')?.ratedMatchCount).toBe(1);

    const replacement = event({
      eventId: 'event-4',
      eventSequence: 4,
      eventType: 'REPLACEMENT',
      matchId: 'match-1',
      targetEventId: 'event-3',
      winnerSeat: 'SECOND',
      ratedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const afterReplacement = materializeRankedRatingLedger(
      [...initial, voidEvent, replacement],
      CONFIG
    );

    expect(afterReplacement.steps.map((step) => step.matchId)).toEqual(['match-1', 'match-2']);
    expect(afterReplacement.steps[0]?.winnerSeat).toBe('SECOND');
    expect(afterReplacement.players.get('bob')?.ratedMatchCount).toBe(1);
  });

  it('rejects a correction that branches from a stale event', () => {
    const initial = event({
      eventId: 'event-1',
      eventSequence: 1,
      matchId: 'match-1',
    });
    const voidEvent = event({
      eventId: 'event-2',
      eventSequence: 2,
      eventType: 'VOID',
      matchId: 'match-1',
      targetEventId: 'event-1',
      winnerSeat: null,
      resultType: 'PLATFORM_NO_CONTEST',
      ratedAt: initial.ratedAt,
    });
    const staleReplacement = event({
      eventId: 'event-3',
      eventSequence: 3,
      eventType: 'REPLACEMENT',
      matchId: 'match-1',
      targetEventId: 'event-1',
      winnerSeat: 'SECOND',
      ratedAt: initial.ratedAt,
    });

    expect(() =>
      resolveEffectiveRankedResults([initial, voidEvent, staleReplacement], CONFIG)
    ).toThrow('correction must target the latest event');
  });

  it('allows mixed history only when every old directive is superseded by V3', () => {
    const oldSettlement = event({
      eventId: 'old-v2',
      eventSequence: 1,
      algorithmVersion: GLICKO1_PER_MATCH_V2.algorithmVersion,
    });
    const migrated = event({
      eventId: 'migration-v3',
      eventSequence: 2,
      eventType: 'REPLACEMENT',
      matchId: oldSettlement.matchId,
      targetEventId: oldSettlement.eventId,
      ratedAt: oldSettlement.ratedAt,
      algorithmVersion: GLICKO1_PER_MATCH_V3.algorithmVersion,
    });

    expect(() => materializeRankedRatingLedger([oldSettlement], GLICKO1_PER_MATCH_V3)).toThrow(
      'latest rating directive must use GLICKO1_PER_MATCH_V3'
    );
    const materialized = materializeRankedRatingLedger(
      [oldSettlement, migrated],
      GLICKO1_PER_MATCH_V3
    );
    expect(materialized.effectiveResults).toEqual([migrated]);
    expect(materialized.steps[0]?.sourceResultEventId).toBe(migrated.eventId);
  });
});

describe('ranked competitive environment identity', () => {
  it('is stable across card order and ignores image-only changes', () => {
    const first = memberCard();
    const second = memberCard({
      cardCode: 'TEST-002',
      name: '第二名成员',
    });
    const baseline = buildRankedCardCatalogIdentity([first, second]);
    const reordered = buildRankedCardCatalogIdentity([
      { ...second, imageFilename: 'new-image.webp' },
      { ...first, imageSourceUri: 'https://example.invalid/new.webp' },
    ]);

    expect(reordered).toEqual(baseline);
  });

  it('changes when a rule-relevant card field or rating configuration changes', () => {
    const baselineCatalog = buildRankedCardCatalogIdentity([memberCard()]);
    const changedCatalog = buildRankedCardCatalogIdentity([memberCard({ cost: 6 })]);
    const baselineEnvironment = buildRankedCompetitiveEnvironmentIdentity(baselineCatalog, CONFIG);
    const changedEnvironment = buildRankedCompetitiveEnvironmentIdentity(baselineCatalog, {
      ...CONFIG,
      placementMatchCount: 11,
    });

    expect(changedCatalog.cardCatalogHash).not.toBe(baselineCatalog.cardCatalogHash);
    expect(changedEnvironment.competitiveEnvironmentId).not.toBe(
      baselineEnvironment.competitiveEnvironmentId
    );
    expect(baselineCatalog.cardCatalogHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
