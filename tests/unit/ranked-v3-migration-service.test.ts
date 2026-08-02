import { describe, expect, it, vi } from 'vitest';
import {
  GLICKO1_PER_MATCH_V2,
  GLICKO1_PER_MATCH_V3,
  type Glicko1Config,
} from '../../src/server/rating/glicko';
import {
  materializeRankedRatingLedger,
  type RankedRatingEvent,
} from '../../src/server/rating/ranked-ledger';
import { buildRankedCompetitiveEnvironmentIdentity } from '../../src/server/rating/ranked-environment';
import {
  PostgresRankedV3MigrationRepository,
  RankedV3MigrationService,
  countRankedV3MigrationEnvironmentMismatches,
  type RankedV3MigrationFrozenEnvironment,
  type RankedV3MigrationMatchEnvironmentRecord,
  type RankedV3MigrationPlan,
  type RankedV3MigrationRepository,
  type RankedV3MigrationSnapshot,
} from '../../src/server/services/ranked-v3-migration-service';

const CATALOG = {
  cardCatalogVersion: 'CATALOG_V1',
  cardCatalogHash: `sha256:${'a'.repeat(64)}`,
  publishedCardCount: 100,
};

function settlement(algorithmVersion = GLICKO1_PER_MATCH_V2.algorithmVersion): RankedRatingEvent {
  return {
    eventId: 'event-v2',
    eventSequence: 1,
    eventType: 'SETTLEMENT',
    matchId: 'match-1',
    targetEventId: null,
    firstUserId: 'alice',
    secondUserId: 'bob',
    winnerSeat: 'FIRST',
    resultType: 'NORMAL',
    ratedAt: new Date('2026-08-01T00:00:00.000Z'),
    algorithmVersion,
  };
}

function snapshot(overrides: Partial<RankedV3MigrationSnapshot> = {}): RankedV3MigrationSnapshot {
  const events = overrides.events ?? [settlement()];
  const currentRatings =
    overrides.currentRatings ?? materializeRankedRatingLedger(events, GLICKO1_PER_MATCH_V2).players;
  return {
    season: {
      id: 'season-1',
      lifecycle: 'ACTIVE',
      queueAdmission: 'PAUSED',
      competitiveEnvironmentId: `sha256:${'b'.repeat(64)}`,
      rulesVersion: 'RULES_V1',
      cardCatalogVersion: CATALOG.cardCatalogVersion,
      cardCatalogHash: CATALOG.cardCatalogHash,
      deckPolicyVersion: 'DECK_V1',
      ratingAlgorithmVersion: GLICKO1_PER_MATCH_V2.algorithmVersion,
      ratingConfig: GLICKO1_PER_MATCH_V2,
      ledgerRevision: events.length,
    },
    blockers: {
      pendingMatches: 0,
      activeTickets: 0,
      activeReservations: 0,
      activeParticipations: 0,
      rankedMatchEnvironmentMismatches: 0,
      matchRecordRulesMismatches: 0,
    },
    events,
    seeds: new Map(),
    currentRatings,
    ...overrides,
  };
}

function harness(value: RankedV3MigrationSnapshot) {
  const applyPlan = vi.fn<(plan: RankedV3MigrationPlan) => Promise<void>>().mockResolvedValue();
  const loadSnapshot = vi
    .fn<(seasonId: string, lock: boolean) => Promise<RankedV3MigrationSnapshot>>()
    .mockResolvedValue(value);
  const repository: RankedV3MigrationRepository = {
    loadSnapshot,
    applyPlan,
  };
  const service = new RankedV3MigrationService({
    transaction: async (callback) => callback(repository),
    createId: () => 'event-v3',
  });
  return { service, loadSnapshot, applyPlan };
}

describe('RankedV3MigrationService', () => {
  it('dry-runs by default and does not mutate the repository', async () => {
    const current = snapshot();
    const { service, loadSnapshot, applyPlan } = harness(current);
    const report = await service.migrate({
      seasonId: current.season.id,
      cardCatalog: CATALOG,
      apply: false,
    });

    expect(loadSnapshot).toHaveBeenCalledWith(current.season.id, false);
    expect(applyPlan).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      mode: 'DRY_RUN',
      sourceLedgerRevision: 1,
      targetLedgerRevision: 2,
      appendedDirectiveCount: 1,
      materializedMatchCount: 1,
      alreadyApplied: false,
    });
    expect(current.events).toHaveLength(1);
  });

  it('applies only with the dry-run revision and appends a V3 replacement plan', async () => {
    const current = snapshot();
    const { service, loadSnapshot, applyPlan } = harness(current);
    const report = await service.migrate({
      seasonId: current.season.id,
      cardCatalog: CATALOG,
      apply: true,
      expectedLedgerRevision: 1,
      adminUserId: 'admin-1',
    });

    expect(loadSnapshot).toHaveBeenCalledWith(current.season.id, true);
    expect(applyPlan).toHaveBeenCalledOnce();
    const plan = applyPlan.mock.calls[0]![0];
    expect(plan.targetConfig).toMatchObject({
      algorithmVersion: GLICKO1_PER_MATCH_V3.algorithmVersion,
      ratingScale: 800,
      initialRatingDeviation: 300,
      placementMatchCount: GLICKO1_PER_MATCH_V2.placementMatchCount,
    });
    expect(plan.directives).toEqual([
      expect.objectContaining({
        eventType: 'REPLACEMENT',
        targetEventId: 'event-v2',
        algorithmVersion: GLICKO1_PER_MATCH_V3.algorithmVersion,
        winnerSeat: 'FIRST',
      }),
    ]);
    expect(report.mode).toBe('APPLY');
  });

  it('hydrates only the legacy V2 omission of ratingScale at the migration boundary', async () => {
    const legacyConfig = { ...GLICKO1_PER_MATCH_V2 } as Partial<Glicko1Config>;
    delete legacyConfig.ratingScale;
    const current = snapshot();
    const legacy = snapshot({
      season: { ...current.season, ratingConfig: legacyConfig as Glicko1Config },
    });
    const { service } = harness(legacy);

    await expect(
      service.migrate({ seasonId: 'season-1', cardCatalog: CATALOG, apply: false })
    ).resolves.toMatchObject({ appendedDirectiveCount: 1 });
  });

  it('blocks migration while any ranked runtime state remains active', async () => {
    const current = snapshot();
    const blocked = snapshot({
      blockers: { ...current.blockers, pendingMatches: 1 },
    });
    const { service, applyPlan } = harness(blocked);

    await expect(
      service.migrate({ seasonId: 'season-1', cardCatalog: CATALOG, apply: false })
    ).rejects.toMatchObject({ code: 'RANKED_V3_MIGRATION_BLOCKED' });
    expect(applyPlan).not.toHaveBeenCalled();
  });

  it('blocks migration when frozen match environment or record rules drift from the season', async () => {
    const current = snapshot();
    for (const blocker of [
      'rankedMatchEnvironmentMismatches',
      'matchRecordRulesMismatches',
    ] as const) {
      const blocked = snapshot({
        blockers: { ...current.blockers, [blocker]: 1 },
      });
      const { service, applyPlan } = harness(blocked);

      await expect(
        service.migrate({ seasonId: 'season-1', cardCatalog: CATALOG, apply: false })
      ).rejects.toMatchObject({ code: 'RANKED_V3_MIGRATION_BLOCKED' });
      expect(applyPlan).not.toHaveBeenCalled();
    }
  });

  it('keeps an already voided result voided through a V3 directive', async () => {
    const old = settlement();
    const voided: RankedRatingEvent = {
      ...old,
      eventId: 'event-void-v2',
      eventSequence: 2,
      eventType: 'VOID',
      targetEventId: old.eventId,
      winnerSeat: null,
      resultType: 'PLATFORM_NO_CONTEST',
    };
    const events = [old, voided];
    const baseline = snapshot({
      season: { ...snapshot().season, ledgerRevision: 2 },
      events,
      currentRatings: materializeRankedRatingLedger(events, GLICKO1_PER_MATCH_V2).players,
    });
    let nextId = 0;
    const { service, applyPlan } = harness(baseline);
    const serviceWithUniqueIds = new RankedV3MigrationService({
      transaction: async (callback) =>
        callback({ loadSnapshot: () => Promise.resolve(baseline), applyPlan }),
      createId: () => `event-v3-${++nextId}`,
    });

    await service.migrate({ seasonId: 'season-1', cardCatalog: CATALOG, apply: false });
    await serviceWithUniqueIds.migrate({
      seasonId: 'season-1',
      cardCatalog: CATALOG,
      apply: true,
      expectedLedgerRevision: 2,
      adminUserId: 'admin-1',
    });
    const plan = applyPlan.mock.calls[0]![0];
    expect(plan.directives.at(-1)).toMatchObject({
      eventType: 'VOID',
      targetEventId: voided.eventId,
      winnerSeat: null,
      resultType: 'PLATFORM_NO_CONTEST',
      algorithmVersion: GLICKO1_PER_MATCH_V3.algorithmVersion,
    });
    expect(plan.materialization.steps).toHaveLength(0);
  });

  it('is idempotent after every old result is covered by a latest V3 directive', async () => {
    const old = settlement();
    const migrated: RankedRatingEvent = {
      ...old,
      eventId: 'event-v3',
      eventSequence: 2,
      eventType: 'REPLACEMENT',
      targetEventId: old.eventId,
      algorithmVersion: GLICKO1_PER_MATCH_V3.algorithmVersion,
    };
    const events = [old, migrated];
    const v3Ratings = materializeRankedRatingLedger(events, GLICKO1_PER_MATCH_V3).players;
    const baseline = snapshot();
    const complete = snapshot({
      season: {
        ...baseline.season,
        competitiveEnvironmentId: buildRankedCompetitiveEnvironmentIdentity(
          CATALOG,
          GLICKO1_PER_MATCH_V3,
          {
            rulesVersion: baseline.season.rulesVersion,
            deckPolicyVersion: baseline.season.deckPolicyVersion,
          }
        ).competitiveEnvironmentId,
        ratingAlgorithmVersion: GLICKO1_PER_MATCH_V3.algorithmVersion,
        ratingConfig: GLICKO1_PER_MATCH_V3,
        ledgerRevision: 2,
      },
      events,
      currentRatings: v3Ratings,
    });
    const { service, applyPlan } = harness(complete);
    const report = await service.migrate({
      seasonId: 'season-1',
      cardCatalog: CATALOG,
      apply: true,
      expectedLedgerRevision: 2,
      adminUserId: 'admin-1',
    });

    expect(report.alreadyApplied).toBe(true);
    expect(report.appendedDirectiveCount).toBe(0);
    expect(applyPlan).not.toHaveBeenCalled();
  });
});

describe('countRankedV3MigrationEnvironmentMismatches', () => {
  const season: RankedV3MigrationFrozenEnvironment = {
    ratingAlgorithmVersion: GLICKO1_PER_MATCH_V2.algorithmVersion,
    rulesVersion: 'RULES_V1',
    cardCatalogVersion: 'CATALOG_V1',
    cardCatalogHash: `sha256:${'a'.repeat(64)}`,
    deckPolicyVersion: 'DECK_V1',
  };
  const matchingRecord: RankedV3MigrationMatchEnvironmentRecord = {
    ...season,
    matchRecordRulesVersion: season.rulesVersion,
  };

  it('accepts a match whose complete frozen environment matches its season', () => {
    expect(countRankedV3MigrationEnvironmentMismatches([matchingRecord], season)).toEqual({
      rankedMatchEnvironmentMismatches: 0,
      matchRecordRulesMismatches: 0,
    });
  });

  it.each([
    'ratingAlgorithmVersion',
    'rulesVersion',
    'cardCatalogVersion',
    'cardCatalogHash',
    'deckPolicyVersion',
  ] as const)('counts ranked_matches.%s drift as an environment blocker', (field) => {
    const mismatchingRecord = { ...matchingRecord, [field]: `${matchingRecord[field]}-DRIFT` };

    expect(countRankedV3MigrationEnvironmentMismatches([mismatchingRecord], season)).toEqual({
      rankedMatchEnvironmentMismatches: 1,
      matchRecordRulesMismatches: 0,
    });
  });

  it('counts match_records.rules_version drift as a separate blocker', () => {
    const mismatchingRecord = {
      ...matchingRecord,
      matchRecordRulesVersion: 'RULES_DRIFTED',
    };

    expect(countRankedV3MigrationEnvironmentMismatches([mismatchingRecord], season)).toEqual({
      rankedMatchEnvironmentMismatches: 0,
      matchRecordRulesMismatches: 1,
    });
  });
});

describe('PostgresRankedV3MigrationRepository', () => {
  it('loads every frozen match field and match record rules used by migration blockers', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'season-1',
            lifecycle: 'ACTIVE',
            queue_admission: 'PAUSED',
            competitive_environment_id: `sha256:${'b'.repeat(64)}`,
            rules_version: 'RULES_V1',
            card_catalog_version: CATALOG.cardCatalogVersion,
            card_catalog_hash: CATALOG.cardCatalogHash,
            deck_policy_version: 'DECK_V1',
            rating_algorithm_version: GLICKO1_PER_MATCH_V2.algorithmVersion,
            rating_config: GLICKO1_PER_MATCH_V2,
            ledger_revision: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            pending_matches: 0,
            active_tickets: 0,
            active_reservations: 0,
            active_participations: 0,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            rating_algorithm_version: GLICKO1_PER_MATCH_V2.algorithmVersion,
            rules_version: 'RULES_V1',
            card_catalog_version: CATALOG.cardCatalogVersion,
            card_catalog_hash: CATALOG.cardCatalogHash,
            deck_policy_version: 'DECK_V1',
            match_record_rules_version: 'RULES_V1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const repository = new PostgresRankedV3MigrationRepository({
      query,
    } as unknown as ConstructorParameters<typeof PostgresRankedV3MigrationRepository>[0]);

    const loaded = await repository.loadSnapshot('season-1', false);

    expect(loaded.blockers).toMatchObject({
      rankedMatchEnvironmentMismatches: 0,
      matchRecordRulesMismatches: 0,
    });
    const environmentSql = query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes('FROM ranked_matches AS ranked_match'));
    expect(environmentSql).toBeDefined();
    for (const projection of [
      'ranked_match.rating_algorithm_version',
      'ranked_match.rules_version',
      'ranked_match.card_catalog_version',
      'ranked_match.card_catalog_hash',
      'ranked_match.deck_policy_version',
      'record.rules_version AS match_record_rules_version',
    ]) {
      expect(environmentSql).toContain(projection);
    }
  });
});
