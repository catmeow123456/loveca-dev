import { describe, expect, it, vi } from 'vitest';
import { GLICKO1_PER_MATCH_SHADOW_V2, type Glicko1Config } from '../../src/server/rating/glicko';
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
    const firstUserId = '11111111-1111-4111-8111-111111111111';
    const secondUserId = '22222222-2222-4222-8222-222222222222';
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
            first_user_id: firstUserId,
            second_user_id: secondUserId,
            match_rules_version: 'RULES_V1',
          },
        ];
      }
      if (text.includes('FROM ranked_matches') && !text.includes('FOR UPDATE')) {
        return [
          {
            season_id: 'season-1',
            match_id: 'match-1',
            first_user_id: firstUserId,
            second_user_id: secondUserId,
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
  });

  it('allows a pairing formed before season end to start while finalizing', async () => {
    const { service } = createHarness((text) => {
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
  });
});
