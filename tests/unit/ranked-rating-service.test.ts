import { describe, expect, it, vi } from 'vitest';
import { GLICKO1_PER_MATCH_SHADOW_V2, type Glicko1Config } from '../../src/server/rating/glicko';
import { GLICKO1_PER_MATCH_V4, rateRankedHeadToHead } from '../../src/server/rating/ranked-rating';
import { RankedDeckObservationServiceError } from '../../src/server/services/ranked-deck-observation-service';
import {
  RankedRatingService,
  type RankedRatingQueryClient,
  type RankedRatingQueryResult,
} from '../../src/server/services/ranked-rating-service';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    connect: vi.fn(),
  },
}));

const CONFIG: Glicko1Config = {
  ...GLICKO1_PER_MATCH_SHADOW_V2,
  algorithmVersion: 'GLICKO1_PER_MATCH_TEST_V1',
};

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

const FIRST_USER_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_USER_ID = '22222222-2222-4222-8222-222222222222';

function rankedDeckSnapshotRows(): readonly Record<string, unknown>[] {
  return [
    buildRankedDeckSnapshotRow('FIRST', FIRST_USER_ID, 'FIRST'),
    buildRankedDeckSnapshotRow('SECOND', SECOND_USER_ID, 'SECOND'),
  ];
}

function buildRankedDeckSnapshotRow(
  seat: 'FIRST' | 'SECOND',
  userId: string,
  prefix: string
): Readonly<Record<string, unknown>> {
  const mainDeck: string[] = [];
  const cardSummaries: Record<string, unknown> = {};
  for (let index = 1; index <= 15; index += 1) {
    const cardCode = `PL!N-bp1-${String(index).padStart(3, '0')}-N`;
    mainDeck.push(cardCode, cardCode, cardCode, cardCode);
    cardSummaries[cardCode] = {
      cardCode,
      name: `${prefix} 卡 ${index}`,
      cardType: index % 3 === 0 ? 'LIVE' : 'MEMBER',
      imageFilename: `${cardCode}.webp`,
    };
  }
  return {
    seat,
    user_id: userId,
    main_deck: mainDeck,
    card_summaries: cardSummaries,
    started_at: new Date('2026-08-09T00:00:00.000Z'),
  };
}

function returnedObservation(values: readonly unknown[]): readonly Record<string, unknown>[] {
  return [
    {
      season_id: values[0],
      match_id: values[1],
      seat: values[2],
      user_id: values[3],
      deck_fingerprint: values[4],
      main_deck_cards: JSON.parse(String(values[5])),
      observed_at: values[6],
    },
  ];
}

function settlementContext(
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    season_id: 'season-1',
    lifecycle: 'ACTIVE',
    ledger_revision: 0,
    season_rules_version: 'RULES_V1',
    season_card_catalog_version: 'CATALOG_V1',
    season_card_catalog_hash: `sha256:${'a'.repeat(64)}`,
    season_deck_policy_version: 'DECK_POLICY_V1',
    season_algorithm_version: CONFIG.algorithmVersion,
    rating_config: CONFIG,
    match_id: 'match-1',
    rating_status: 'PENDING',
    first_user_id: '11111111-1111-4111-8111-111111111111',
    second_user_id: '22222222-2222-4222-8222-222222222222',
    ranked_rules_version: 'RULES_V1',
    ranked_card_catalog_version: 'CATALOG_V1',
    ranked_card_catalog_hash: `sha256:${'a'.repeat(64)}`,
    ranked_deck_policy_version: 'DECK_POLICY_V1',
    ranked_algorithm_version: CONFIG.algorithmVersion,
    ranked_result_type: null,
    record_status: 'COMPLETED',
    completeness: 'FULL',
    origin_kind: 'RANKED',
    record_first_user_id: '11111111-1111-4111-8111-111111111111',
    record_second_user_id: '22222222-2222-4222-8222-222222222222',
    winner_seat: 'FIRST',
    end_reason: 'VICTORY_CONDITION',
    ended_at: new Date('2026-08-01T12:00:00.000Z'),
    sealed_at: new Date('2026-08-01T12:00:01.000Z'),
    match_rules_version: 'RULES_V1',
    used_free: false,
    ...overrides,
  };
}

function createHarness(
  responder: (text: string, values: readonly unknown[]) => readonly Record<string, unknown>[]
) {
  const calls: QueryCall[] = [];
  const client: RankedRatingQueryClient = {
    async query<T = unknown>(
      text: string,
      values: readonly unknown[] = []
    ): Promise<RankedRatingQueryResult<T>> {
      await Promise.resolve();
      calls.push({ text, values });
      return { rows: responder(text, values) as T[] };
    },
  };
  const transaction = vi.fn(
    async <T>(callback: (queryClient: RankedRatingQueryClient) => Promise<T>) => callback(client)
  );
  const service = new RankedRatingService({
    transaction,
    createId: () => '33333333-3333-4333-8333-333333333333',
  });
  return { calls, service, transaction };
}

describe('RankedRatingService settlement', () => {
  it('binds only the frozen season environment to an authoritative ranked match', async () => {
    let existingFirstObservation: Readonly<Record<string, unknown>> | undefined;
    const { calls, service } = createHarness((text, values) => {
      if (text.includes('FROM ranked_seasons AS season')) {
        return [
          {
            season_id: 'season-1',
            lifecycle: 'ACTIVE',
            rules_version: 'RULES_V1',
            card_catalog_version: 'CATALOG_V1',
            card_catalog_hash: `sha256:${'a'.repeat(64)}`,
            deck_policy_version: 'DECK_POLICY_V1',
            rating_algorithm_version: CONFIG.algorithmVersion,
            match_id: 'match-1',
            match_status: 'IN_PROGRESS',
            completeness: 'FULL',
            origin_kind: 'RANKED',
            first_user_id: FIRST_USER_ID,
            second_user_id: SECOND_USER_ID,
            match_rules_version: 'RULES_V1',
          },
        ];
      }
      if (text.includes('FROM match_deck_snapshots AS snapshot')) {
        return rankedDeckSnapshotRows();
      }
      if (text.includes('INSERT INTO ranked_deck_observations')) {
        const returned = returnedObservation(values);
        if (values[2] === 'FIRST') {
          existingFirstObservation = returned[0];
          return [];
        }
        return returned;
      }
      if (text.includes('FROM ranked_deck_observations')) {
        return existingFirstObservation ? [existingFirstObservation] : [];
      }
      if (text.includes('FROM ranked_matches') && !text.includes('FOR UPDATE')) {
        return [
          {
            season_id: 'season-1',
            match_id: 'match-1',
            first_user_id: FIRST_USER_ID,
            second_user_id: SECOND_USER_ID,
            rating_status: 'PENDING',
          },
        ];
      }
      return [];
    });

    const result = await service.registerMatch({
      seasonId: 'season-1',
      matchId: 'match-1',
    });

    expect(result.ratingStatus).toBe('PENDING');
    const insert = calls.find((call) => call.text.includes('INSERT INTO ranked_matches'));
    expect(insert?.values).toContain(`sha256:${'a'.repeat(64)}`);
    expect(insert?.values).toContain(CONFIG.algorithmVersion);
    const observationInserts = calls.filter((call) =>
      call.text.includes('INSERT INTO ranked_deck_observations')
    );
    expect(observationInserts).toHaveLength(2);
    expect(observationInserts.map((call) => call.values[2])).toEqual(['FIRST', 'SECOND']);
    expect(JSON.parse(String(observationInserts[0]?.values[5]))).toHaveLength(15);
    expect(calls.some((call) => call.text.includes('FROM ranked_deck_observations'))).toBe(true);
  });

  it('allows a pairing formed before season end to start while finalizing', async () => {
    const { service } = createHarness((text, values) => {
      if (text.includes('FROM ranked_seasons AS season')) {
        return [
          {
            season_id: 'season-1',
            lifecycle: 'FINALIZING',
            rules_version: 'RULES_V1',
            card_catalog_version: 'CATALOG_V1',
            card_catalog_hash: `sha256:${'a'.repeat(64)}`,
            deck_policy_version: 'DECK_POLICY_V1',
            rating_algorithm_version: CONFIG.algorithmVersion,
            match_id: 'match-1',
            match_status: 'IN_PROGRESS',
            completeness: 'FULL',
            origin_kind: 'RANKED',
            first_user_id: '11111111-1111-4111-8111-111111111111',
            second_user_id: '22222222-2222-4222-8222-222222222222',
            match_rules_version: 'RULES_V1',
          },
        ];
      }
      if (text.includes('FROM match_deck_snapshots AS snapshot')) {
        return rankedDeckSnapshotRows();
      }
      if (text.includes('INSERT INTO ranked_deck_observations')) {
        return returnedObservation(values);
      }
      if (text.includes('FROM ranked_matches') && !text.includes('FOR UPDATE')) {
        return [
          {
            season_id: 'season-1',
            match_id: 'match-1',
            first_user_id: '11111111-1111-4111-8111-111111111111',
            second_user_id: '22222222-2222-4222-8222-222222222222',
            rating_status: 'PENDING',
          },
        ];
      }
      return [];
    });

    await expect(
      service.registerMatch({ seasonId: 'season-1', matchId: 'match-1' })
    ).resolves.toMatchObject({
      seasonId: 'season-1',
      matchId: 'match-1',
      ratingStatus: 'PENDING',
    });
  });

  it('在同一注册事务中因双方快照不完整而拒绝绑定', async () => {
    const { calls, service, transaction } = createHarness((text) => {
      if (text.includes('FROM ranked_seasons AS season')) {
        return [
          {
            season_id: 'season-1',
            lifecycle: 'ACTIVE',
            rules_version: 'RULES_V1',
            card_catalog_version: 'CATALOG_V1',
            card_catalog_hash: `sha256:${'a'.repeat(64)}`,
            deck_policy_version: 'DECK_POLICY_V1',
            rating_algorithm_version: CONFIG.algorithmVersion,
            match_id: 'match-1',
            match_status: 'IN_PROGRESS',
            completeness: 'FULL',
            origin_kind: 'RANKED',
            first_user_id: FIRST_USER_ID,
            second_user_id: SECOND_USER_ID,
            match_rules_version: 'RULES_V1',
          },
        ];
      }
      if (text.includes('FROM ranked_matches') && !text.includes('FOR UPDATE')) {
        return [
          {
            season_id: 'season-1',
            match_id: 'match-1',
            first_user_id: FIRST_USER_ID,
            second_user_id: SECOND_USER_ID,
            rating_status: 'PENDING',
          },
        ];
      }
      if (text.includes('FROM match_deck_snapshots AS snapshot')) {
        return rankedDeckSnapshotRows().slice(0, 1);
      }
      return [];
    });

    await expect(
      service.registerMatch({ seasonId: 'season-1', matchId: 'match-1' })
    ).rejects.toMatchObject<Partial<RankedDeckObservationServiceError>>({
      code: 'RANKED_DECK_SNAPSHOTS_INVALID',
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.text.includes('INSERT INTO ranked_deck_observations'))).toBe(
      false
    );
  });

  it('幂等重试时校验已存观察事实，不覆盖冲突记录', async () => {
    const { calls, service } = createHarness((text) => {
      if (text.includes('FROM ranked_seasons AS season')) {
        return [
          {
            season_id: 'season-1',
            lifecycle: 'ACTIVE',
            rules_version: 'RULES_V1',
            card_catalog_version: 'CATALOG_V1',
            card_catalog_hash: `sha256:${'a'.repeat(64)}`,
            deck_policy_version: 'DECK_POLICY_V1',
            rating_algorithm_version: CONFIG.algorithmVersion,
            match_id: 'match-1',
            match_status: 'IN_PROGRESS',
            completeness: 'FULL',
            origin_kind: 'RANKED',
            first_user_id: FIRST_USER_ID,
            second_user_id: SECOND_USER_ID,
            match_rules_version: 'RULES_V1',
          },
        ];
      }
      if (text.includes('FROM ranked_matches') && !text.includes('FOR UPDATE')) {
        return [
          {
            season_id: 'season-1',
            match_id: 'match-1',
            first_user_id: FIRST_USER_ID,
            second_user_id: SECOND_USER_ID,
            rating_status: 'PENDING',
          },
        ];
      }
      if (text.includes('FROM match_deck_snapshots AS snapshot')) {
        return rankedDeckSnapshotRows();
      }
      if (text.includes('FROM ranked_deck_observations')) {
        return [
          {
            season_id: 'season-1',
            match_id: 'match-1',
            seat: 'FIRST',
            user_id: FIRST_USER_ID,
            deck_fingerprint: `sha256:${'f'.repeat(64)}`,
            main_deck_cards: [],
            observed_at: new Date('2026-08-09T00:00:00.000Z'),
          },
        ];
      }
      return [];
    });

    await expect(
      service.registerMatch({ seasonId: 'season-1', matchId: 'match-1' })
    ).rejects.toMatchObject<Partial<RankedDeckObservationServiceError>>({
      code: 'RANKED_DECK_OBSERVATION_CONFLICT',
    });
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO ranked_deck_observations'))
    ).toHaveLength(1);
    expect(
      calls.some(
        (call) =>
          call.text.includes('INSERT INTO ranked_deck_observations') &&
          call.text.includes('ON CONFLICT (match_id, seat) DO NOTHING')
      )
    ).toBe(true);
  });

  it('atomically appends both player snapshots and updates the current projection', async () => {
    const { calls, service } = createHarness((text) => {
      if (text.includes('FROM ranked_matches AS ranked_match')) {
        return [settlementContext()];
      }
      if (text.includes('ORDER BY rated_at DESC, match_id DESC')) {
        return [];
      }
      if (text.includes('FROM ranked_player_ratings')) {
        return [];
      }
      return [];
    });

    const result = await service.settleMatch('match-1', CONFIG);

    expect(result).toEqual({
      seasonId: 'season-1',
      matchId: 'match-1',
      eventId: '33333333-3333-4333-8333-333333333333',
      eventType: 'SETTLEMENT',
      ledgerRevision: 1,
      alreadyApplied: false,
      materializedMatchCount: 1,
      affectedPlayerCount: 2,
    });
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO ranked_rating_events'))
    ).toHaveLength(1);
    const step = calls.find((call) => call.text.includes('INSERT INTO ranked_rating_event_steps'));
    expect(step?.values[10]).toBe(0);
    expect(step?.values[14]).toBe(1);
    expect(step?.values[18]).toBe(0);
    expect(step?.values[22]).toBe(1);
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO ranked_player_ratings'))
    ).toHaveLength(2);
    expect(
      calls.some(
        (call) =>
          call.text.includes('UPDATE ranked_seasons') && call.text.includes('ledger_revision = $2')
      )
    ).toBe(true);
    const ledgerRevisionIndex = calls.findIndex(
      (call) =>
        call.text.includes('UPDATE ranked_seasons') && call.text.includes('ledger_revision = $2')
    );
    const badgeAwardIndex = calls.findIndex((call) =>
      call.text.includes('INSERT INTO player_badges')
    );
    expect(badgeAwardIndex).toBeGreaterThan(ledgerRevisionIndex);
    expect(calls[badgeAwardIndex]?.values[1]).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(calls[badgeAwardIndex]?.text).toContain('rule.minimum_value');
  });

  it('applies V4 growth to the real-time settlement projection after placement', async () => {
    const lastRatedAt = new Date('2026-07-31T12:00:00.000Z');
    const firstBefore = {
      rating: 1600,
      ratingDeviation: 100,
      ratedMatchCount: 5,
      lastRatedAt,
    };
    const secondBefore = { ...firstBefore };
    const { calls, service } = createHarness((text) => {
      if (text.includes('FROM ranked_matches AS ranked_match')) {
        return [
          settlementContext({
            season_algorithm_version: GLICKO1_PER_MATCH_V4.algorithmVersion,
            rating_config: GLICKO1_PER_MATCH_V4,
            ranked_algorithm_version: GLICKO1_PER_MATCH_V4.algorithmVersion,
          }),
        ];
      }
      if (text.includes('ORDER BY rated_at DESC, match_id DESC')) {
        return [];
      }
      if (text.includes('FROM ranked_player_ratings')) {
        return [
          {
            user_id: '11111111-1111-4111-8111-111111111111',
            rating: firstBefore.rating,
            rating_deviation: firstBefore.ratingDeviation,
            rated_match_count: firstBefore.ratedMatchCount,
            last_rated_at: firstBefore.lastRatedAt,
          },
          {
            user_id: '22222222-2222-4222-8222-222222222222',
            rating: secondBefore.rating,
            rating_deviation: secondBefore.ratingDeviation,
            rated_match_count: secondBefore.ratedMatchCount,
            last_rated_at: secondBefore.lastRatedAt,
          },
        ];
      }
      return [];
    });

    await service.settleMatch('match-1', GLICKO1_PER_MATCH_V4);

    const expected = rateRankedHeadToHead(
      firstBefore,
      secondBefore,
      1,
      new Date('2026-08-01T12:00:00.000Z'),
      GLICKO1_PER_MATCH_V4
    );
    const step = calls.find((call) => call.text.includes('INSERT INTO ranked_rating_event_steps'));
    expect(step?.values[12]).toBeCloseTo(expected.first.rating, 12);
    expect(step?.values[20]).toBeCloseTo(expected.second.rating, 12);
  });

  it('保留断线判负分类并记录对局是否使用过 FREE 模式', async () => {
    const { calls, service } = createHarness((text) => {
      if (text.includes('FROM ranked_matches AS ranked_match')) {
        return [
          settlementContext({
            ranked_result_type: 'DISCONNECT_FORFEIT',
            record_status: 'SURRENDERED',
            end_reason: 'OPPONENT_SURRENDER',
            used_free: true,
          }),
        ];
      }
      if (text.includes('ORDER BY rated_at DESC, match_id DESC')) {
        return [];
      }
      if (text.includes('FROM ranked_player_ratings')) {
        return [];
      }
      return [];
    });

    await service.settleMatch('match-1', CONFIG);

    const update = calls.find(
      (call) =>
        call.text.includes('UPDATE ranked_matches') &&
        call.text.includes("rating_status = 'SETTLED'")
    );
    expect(update?.values).toEqual([
      'match-1',
      'FIRST',
      'DISCONNECT_FORFEIT',
      new Date('2026-08-01T12:00:00.000Z'),
      true,
    ]);
  });

  it('returns the existing initial event without applying rating twice', async () => {
    const { calls, service } = createHarness((text) => {
      if (text.includes('FROM ranked_matches AS ranked_match')) {
        return [settlementContext({ rating_status: 'SETTLED', ledger_revision: 4 })];
      }
      if (
        text.includes('FROM ranked_rating_events') &&
        text.includes("event_type = 'SETTLEMENT'")
      ) {
        return [
          {
            id: 'existing-event',
            event_type: 'SETTLEMENT',
            match_id: 'match-1',
            event_sequence: 1,
          },
        ];
      }
      return [];
    });

    const result = await service.settleMatch('match-1', CONFIG);

    expect(result.alreadyApplied).toBe(true);
    expect(result.eventId).toBe('existing-event');
    expect(calls.some((call) => call.text.includes('INSERT INTO ranked_rating_events'))).toBe(
      false
    );
    expect(calls.some((call) => call.text.includes('INSERT INTO ranked_player_ratings'))).toBe(
      false
    );
  });

  it('rebuilds the season projection when a delayed settlement belongs earlier in time', async () => {
    const firstUserId = '11111111-1111-4111-8111-111111111111';
    const thirdUserId = '44444444-4444-4444-8444-444444444444';
    const { calls, service } = createHarness((text) => {
      if (text.includes('FROM ranked_matches AS ranked_match')) {
        return [
          settlementContext({
            ledger_revision: 1,
            ended_at: new Date('2026-08-01T00:00:00.000Z'),
          }),
        ];
      }
      if (text.includes('ORDER BY rated_at DESC, match_id DESC')) {
        return [
          {
            rated_at: new Date('2026-08-02T00:00:00.000Z'),
            match_id: 'match-2',
          },
        ];
      }
      if (text.includes('FROM ranked_rating_events') && text.includes('ORDER BY event_sequence')) {
        return [
          {
            id: 'existing-event',
            event_sequence: 1,
            event_type: 'SETTLEMENT',
            match_id: 'match-2',
            target_event_id: null,
            first_user_id: firstUserId,
            second_user_id: thirdUserId,
            winner_seat: 'SECOND',
            rated_at: new Date('2026-08-02T00:00:00.000Z'),
            algorithm_version: CONFIG.algorithmVersion,
          },
        ];
      }
      return [];
    });

    const result = await service.settleMatch('match-1', CONFIG);

    expect(result).toMatchObject({
      ledgerRevision: 2,
      materializedMatchCount: 2,
      affectedPlayerCount: 3,
    });
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO ranked_rating_event_steps'))
    ).toHaveLength(2);
    expect(
      calls.filter((call) => call.text.includes('DELETE FROM ranked_player_ratings'))
    ).toHaveLength(1);
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO ranked_player_ratings'))
    ).toHaveLength(3);
    expect(calls.some((call) => call.text.includes('DELETE FROM ranked_rating_events'))).toBe(
      false
    );
    const badgeAward = calls.find((call) => call.text.includes('INSERT INTO player_badges'));
    expect(badgeAward?.values[1]).toEqual([
      firstUserId,
      '22222222-2222-4222-8222-222222222222',
      thirdUserId,
    ]);
  });

  it('rebuilds when equal settlement times require an earlier match-id order', async () => {
    const firstUserId = '11111111-1111-4111-8111-111111111111';
    const thirdUserId = '44444444-4444-4444-8444-444444444444';
    const ratedAt = new Date('2026-08-01T00:00:00.000Z');
    const { calls, service } = createHarness((text) => {
      if (text.includes('FROM ranked_matches AS ranked_match')) {
        return [
          settlementContext({
            ledger_revision: 1,
            match_id: 'match-1',
            ended_at: ratedAt,
          }),
        ];
      }
      if (text.includes('ORDER BY rated_at DESC, match_id DESC')) {
        return [{ rated_at: ratedAt, match_id: 'match-2' }];
      }
      if (text.includes('FROM ranked_rating_events') && text.includes('ORDER BY event_sequence')) {
        return [
          {
            id: 'existing-event',
            event_sequence: 1,
            event_type: 'SETTLEMENT',
            match_id: 'match-2',
            target_event_id: null,
            first_user_id: firstUserId,
            second_user_id: thirdUserId,
            winner_seat: 'SECOND',
            rated_at: ratedAt,
            algorithm_version: CONFIG.algorithmVersion,
          },
        ];
      }
      return [];
    });

    const result = await service.settleMatch('match-1', CONFIG);

    expect(result.materializedMatchCount).toBe(2);
    expect(
      calls.filter((call) => call.text.includes('DELETE FROM ranked_player_ratings'))
    ).toHaveLength(1);
  });

  it('refuses to persist a SHADOW algorithm version', async () => {
    const { service, transaction } = createHarness(() => []);

    await expect(service.settleMatch('match-1', GLICKO1_PER_MATCH_SHADOW_V2)).rejects.toMatchObject(
      {
        code: 'RANKED_PERSISTENT_ALGORITHM_INVALID',
      }
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('RankedRatingService corrections', () => {
  it('rejects reusing an idempotency key for a different correction request', async () => {
    const { service } = createHarness((text) => {
      if (text.includes('FROM ranked_seasons') && text.includes('FOR UPDATE')) {
        return [
          {
            season_id: 'season-1',
            lifecycle: 'ACTIVE',
            ledger_revision: 3,
            rating_algorithm_version: CONFIG.algorithmVersion,
            rating_config: CONFIG,
          },
        ];
      }
      if (text.includes('idempotency_key = $2')) {
        return [
          {
            id: 'existing-correction',
            event_type: 'VOID',
            match_id: 'match-2',
            event_sequence: 3,
            winner_seat: null,
            result_type: 'PLATFORM_NO_CONTEST',
            reason: '另一局的平台故障',
          },
        ];
      }
      return [];
    });

    await expect(
      service.correctMatch({
        seasonId: 'season-1',
        matchId: 'match-1',
        action: 'VOID',
        reason: '平台故障导致结果不可靠',
        adminUserId: '55555555-5555-4555-8555-555555555555',
        idempotencyKey: 'reused-correction-key',
        expectedLedgerRevision: 3,
        expectedTargetEventId: 'event-1',
      })
    ).rejects.toMatchObject({
      code: 'RANKED_CORRECTION_IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
  });

  it('treats a changed replacement result type as an idempotency conflict', async () => {
    const { service } = createHarness((text) => {
      if (text.includes('FROM ranked_seasons') && text.includes('FOR UPDATE')) {
        return [
          {
            season_id: 'season-1',
            lifecycle: 'ACTIVE',
            ledger_revision: 3,
            rating_algorithm_version: CONFIG.algorithmVersion,
            rating_config: CONFIG,
          },
        ];
      }
      if (text.includes('idempotency_key = $2')) {
        return [
          {
            id: 'existing-correction',
            event_type: 'REPLACEMENT',
            match_id: 'match-1',
            event_sequence: 3,
            winner_seat: 'SECOND',
            result_type: 'SURRENDER',
            reason: '裁定原胜方记录错误',
          },
        ];
      }
      return [];
    });

    await expect(
      service.correctMatch({
        seasonId: 'season-1',
        matchId: 'match-1',
        action: 'REPLACE',
        replacementWinnerSeat: 'SECOND',
        replacementResultType: 'NORMAL',
        reason: '裁定原胜方记录错误',
        adminUserId: '55555555-5555-4555-8555-555555555555',
        idempotencyKey: 'replace-match-1',
        expectedLedgerRevision: 3,
        expectedTargetEventId: 'event-2',
      })
    ).rejects.toMatchObject({
      code: 'RANKED_CORRECTION_IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
  });

  it('rejects execution when the ledger changed after the admin preview', async () => {
    const { calls, service } = createHarness((text) => {
      if (text.includes('FROM ranked_seasons') && text.includes('FOR UPDATE')) {
        return [
          {
            season_id: 'season-1',
            lifecycle: 'ACTIVE',
            ledger_revision: 3,
            rating_algorithm_version: CONFIG.algorithmVersion,
            rating_config: CONFIG,
          },
        ];
      }
      return [];
    });

    await expect(
      service.correctMatch({
        seasonId: 'season-1',
        matchId: 'match-1',
        action: 'VOID',
        reason: '平台故障导致结果不可靠',
        adminUserId: '55555555-5555-4555-8555-555555555555',
        idempotencyKey: 'void-match-1-stale',
        expectedLedgerRevision: 2,
        expectedTargetEventId: 'event-1',
      })
    ).rejects.toMatchObject({
      code: 'RANKED_CORRECTION_PREVIEW_STALE',
    });
    expect(
      calls.some(
        (call) => call.text.includes('FROM ranked_matches') && call.text.includes('FOR UPDATE')
      )
    ).toBe(false);
  });

  it('appends a VOID event and rebuilds only the derived player projection', async () => {
    const firstUserId = '11111111-1111-4111-8111-111111111111';
    const secondUserId = '22222222-2222-4222-8222-222222222222';
    const thirdUserId = '44444444-4444-4444-8444-444444444444';
    const { calls, service } = createHarness((text) => {
      if (text.includes('FROM ranked_seasons') && text.includes('FOR UPDATE')) {
        return [
          {
            season_id: 'season-1',
            lifecycle: 'ACTIVE',
            ledger_revision: 2,
            rating_algorithm_version: CONFIG.algorithmVersion,
            rating_config: CONFIG,
          },
        ];
      }
      if (text.includes('idempotency_key = $2')) {
        return [];
      }
      if (text.includes('FROM ranked_matches') && text.includes('FOR UPDATE')) {
        return [{ match_id: 'match-1', result_type: 'NORMAL' }];
      }
      if (text.includes('FROM ranked_rating_events') && text.includes('ORDER BY event_sequence')) {
        return [
          {
            id: 'event-1',
            event_sequence: 1,
            event_type: 'SETTLEMENT',
            match_id: 'match-1',
            target_event_id: null,
            first_user_id: firstUserId,
            second_user_id: secondUserId,
            winner_seat: 'FIRST',
            result_type: 'NORMAL',
            rated_at: new Date('2026-08-01T00:00:00.000Z'),
            algorithm_version: CONFIG.algorithmVersion,
          },
          {
            id: 'event-2',
            event_sequence: 2,
            event_type: 'SETTLEMENT',
            match_id: 'match-2',
            target_event_id: null,
            first_user_id: firstUserId,
            second_user_id: thirdUserId,
            winner_seat: 'SECOND',
            result_type: 'NORMAL',
            rated_at: new Date('2026-08-02T00:00:00.000Z'),
            algorithm_version: CONFIG.algorithmVersion,
          },
        ];
      }
      return [];
    });

    const result = await service.correctMatch(
      {
        seasonId: 'season-1',
        matchId: 'match-1',
        action: 'VOID',
        reason: '平台故障导致结果不可靠',
        adminUserId: '55555555-5555-4555-8555-555555555555',
        idempotencyKey: 'void-match-1-v1',
        expectedLedgerRevision: 2,
        expectedTargetEventId: 'event-1',
      },
      CONFIG
    );

    expect(result).toMatchObject({
      eventType: 'VOID',
      ledgerRevision: 3,
      materializedMatchCount: 1,
      affectedPlayerCount: 2,
    });
    expect(calls.some((call) => call.text.includes('DELETE FROM ranked_rating_events'))).toBe(
      false
    );
    expect(
      calls.filter((call) => call.text.includes('DELETE FROM ranked_player_ratings'))
    ).toHaveLength(1);
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO ranked_rating_event_steps'))
    ).toHaveLength(1);
    const correctionInsert = calls.find((call) =>
      call.text.includes('INSERT INTO ranked_rating_events')
    );
    expect(correctionInsert?.values).toContain('event-1');
    expect(correctionInsert?.values).toContain('平台故障导致结果不可靠');
    expect(calls.some((call) => call.text.includes('DELETE FROM player_badges'))).toBe(false);
    expect(calls.some((call) => call.text.includes('INSERT INTO player_badges'))).toBe(true);
  });
});
