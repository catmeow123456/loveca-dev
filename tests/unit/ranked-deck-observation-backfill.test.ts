import { describe, expect, it } from 'vitest';
import {
  parseRankedDeckObservationBackfillArgs,
  runRankedDeckObservationBackfill,
  type RankedDeckObservationBackfillQueryClient,
} from '../../drizzle/data-migrations/backfill-ranked-deck-observations';

const SEASON_ID = '22222222-2222-4222-8222-222222222222';
const SEASON_KEY = 'season-v1';
const FIRST_USER_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_USER_ID = '33333333-3333-4333-8333-333333333333';

interface StoredObservation {
  readonly season_id: string;
  readonly match_id: string;
  readonly seat: 'FIRST' | 'SECOND';
  readonly user_id: string;
  readonly deck_fingerprint: string;
  readonly main_deck_cards: unknown;
  readonly observed_at: Date;
}

function createDeckFixture(prefix: string) {
  const mainDeck: string[] = [];
  const cardSummaries: Record<string, Record<string, unknown>> = {};
  for (let index = 1; index <= 15; index += 1) {
    const cardCode = `${prefix}-${String(index).padStart(3, '0')}-N`;
    mainDeck.push(cardCode, cardCode, cardCode, cardCode);
    cardSummaries[cardCode] = {
      cardCode,
      name: `测试卡 ${index}`,
      cardType: index % 3 === 0 ? 'LIVE' : 'MEMBER',
      imageFilename: `${cardCode}.webp`,
    };
  }
  return { mainDeck, cardSummaries };
}

function createHarness(
  options: {
    readonly metadataOnly?: boolean;
    readonly includeRecoverableMatch?: boolean;
    readonly changeIrrecoverableMatchAfterFirstInspection?: boolean;
  } = {}
) {
  const calls: string[] = [];
  const observations = new Map<string, StoredObservation>();
  const startedAt = new Date('2026-08-01T12:00:00.000Z');

  const createMatchRows = (
    matchId: string,
    completeness: 'FULL' | 'METADATA_ONLY',
    firstPrefix: string,
    secondPrefix: string
  ) => {
    const matchFirstDeck = createDeckFixture(firstPrefix);
    const matchSecondDeck = createDeckFixture(secondPrefix);
    const metadataOnly = completeness === 'METADATA_ONLY';
    return [
      {
        match_id: matchId,
        first_user_id: FIRST_USER_ID,
        second_user_id: SECOND_USER_ID,
        rating_status: 'SETTLED',
        completeness,
        started_at: startedAt,
        seat: 'FIRST' as const,
        snapshot_user_id: FIRST_USER_ID,
        main_deck: metadataOnly ? [] : matchFirstDeck.mainDeck,
        card_summaries: metadataOnly ? {} : matchFirstDeck.cardSummaries,
      },
      {
        match_id: matchId,
        first_user_id: FIRST_USER_ID,
        second_user_id: SECOND_USER_ID,
        rating_status: 'SETTLED',
        completeness,
        started_at: startedAt,
        seat: 'SECOND' as const,
        snapshot_user_id: SECOND_USER_ID,
        main_deck: metadataOnly ? [] : matchSecondDeck.mainDeck,
        card_summaries: metadataOnly ? {} : matchSecondDeck.cardSummaries,
      },
    ];
  };
  const inspectionRows = [
    ...createMatchRows(
      'match-1',
      options.metadataOnly ? 'METADATA_ONLY' : 'FULL',
      'PL!N-bp1',
      'PL!HS-bp1'
    ),
    ...(options.includeRecoverableMatch
      ? createMatchRows('match-2', 'FULL', 'PL!N-bp2', 'PL!HS-bp2')
      : []),
  ];
  let inspectionCount = 0;

  /*
    Keep the original fixtures separately so capture queries always see the rows for their
    requested match even when a test simulates the approved gap set changing before commit.
  */
  const captureRows = inspectionRows.map((row) => ({ ...row }));

  const client: RankedDeckObservationBackfillQueryClient = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      await Promise.resolve();
      calls.push(text);
      if (
        text === 'BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE' ||
        text === 'COMMIT' ||
        text === 'ROLLBACK'
      ) {
        return { rows: [] as T[] };
      }
      if (text.includes('FROM ranked_seasons')) {
        return {
          rows: [
            {
              id: SEASON_ID,
              season_key: SEASON_KEY,
              name: '第一赛季',
              lifecycle: 'ACTIVE',
              ledger_revision: 7,
            },
          ] as T[],
        };
      }
      if (text.includes('FROM ranked_matches AS ranked_match')) {
        inspectionCount += 1;
        const rows =
          options.changeIrrecoverableMatchAfterFirstInspection && inspectionCount > 1
            ? inspectionRows.map((row) =>
                row.match_id === 'match-1' && row.completeness === 'METADATA_ONLY'
                  ? { ...row, match_id: 'match-3' }
                  : row
              )
            : inspectionRows;
        return { rows: rows as T[] };
      }
      if (text.includes('WHERE season_id = $1')) {
        return { rows: [...observations.values()] as T[] };
      }
      if (text.includes('FROM match_deck_snapshots AS snapshot')) {
        return {
          rows: captureRows
            .filter((row) => row.match_id === values[0])
            .map((row) => ({
              seat: row.seat,
              user_id: row.snapshot_user_id,
              main_deck: row.main_deck,
              card_summaries: row.card_summaries,
              started_at: row.started_at,
            })) as T[],
        };
      }
      if (text.includes('INSERT INTO ranked_deck_observations')) {
        const row: StoredObservation = {
          season_id: String(values[0]),
          match_id: String(values[1]),
          seat: values[2] as 'FIRST' | 'SECOND',
          user_id: String(values[3]),
          deck_fingerprint: String(values[4]),
          main_deck_cards: JSON.parse(String(values[5])) as unknown,
          observed_at: values[6] as Date,
        };
        observations.set(`${row.match_id}:${row.seat}`, row);
        return { rows: [row] as T[] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };

  return { client, calls, observations };
}

describe('ranked deck observation backfill arguments', () => {
  it('defaults to dry-run and requires explicit apply confirmation and ledger revision', () => {
    expect(parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`])).toEqual({
      mode: 'dry-run',
      seasonKey: SEASON_KEY,
      expectedLedgerRevision: null,
      yes: false,
      allowIncompleteHistory: false,
      expectedIrrecoverableMatchCount: null,
      expectedIrrecoverableMatchHash: null,
    });
    expect(() =>
      parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`, '--apply'])
    ).toThrow('--apply requires --yes');
    expect(() =>
      parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`, '--apply', '--yes'])
    ).toThrow('--apply requires --expected-ledger-revision');
  });

  it('requires an exact approved count and hash for incomplete history', () => {
    const base = [`--season-key=${SEASON_KEY}`, '--apply', '--yes', '--expected-ledger-revision=7'];
    expect(() =>
      parseRankedDeckObservationBackfillArgs([...base, '--allow-incomplete-history'])
    ).toThrow('requires --expected-irrecoverable-match-count');
    expect(() =>
      parseRankedDeckObservationBackfillArgs([...base, `--expected-irrecoverable-match-count=1`])
    ).toThrow('require --allow-incomplete-history');
  });
});

describe('ranked deck observation backfill', () => {
  it('reports a complete dry-run without writing observations', async () => {
    const harness = createHarness();
    const args = parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`]);

    const report = await runRankedDeckObservationBackfill(harness.client, args);

    expect(report).toMatchObject({
      mode: 'dry-run',
      blockers: [],
      irrecoverableGaps: [],
      irrecoverableMatchCount: 0,
      incompleteHistoryAccepted: false,
      matchCount: 1,
      settledMatchCount: 1,
      projectedAnalyzedMatchCount: 1,
      projectedCoverageRate: 1,
      alreadyCompleteMatchCount: 0,
      backfillableMatchCount: 1,
      existingObservationCount: 0,
      wouldInsertObservationCount: 2,
      insertedObservationCount: 0,
      earliestObservedAt: '2026-08-01T12:00:00.000Z',
    });
    expect(harness.observations.size).toBe(0);
    expect(harness.calls).not.toContain('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  });

  it('reports metadata-only snapshots separately and blocks strict apply', async () => {
    const harness = createHarness({ metadataOnly: true });
    const args = parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`]);

    const report = await runRankedDeckObservationBackfill(harness.client, args);

    expect(report.blockers).toEqual([]);
    expect(report.irrecoverableGaps).toEqual([
      { matchId: 'match-1', reason: '历史卡组明细已清理，无法补齐双方观察事实' },
    ]);
    expect(report.irrecoverableMatchCount).toBe(1);
    expect(report.irrecoverableMatchHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(report.projectedCoverageRate).toBe(0);
    expect(report.backfillableMatchCount).toBe(0);
    expect(report.wouldInsertObservationCount).toBe(0);

    await expect(
      runRankedDeckObservationBackfill(
        harness.client,
        parseRankedDeckObservationBackfillArgs([
          `--season-key=${SEASON_KEY}`,
          '--apply',
          '--yes',
          '--expected-ledger-revision=7',
        ])
      )
    ).rejects.toThrow('irrecoverable historical matches');
    expect(harness.calls).toContain('ROLLBACK');
  });

  it('applies recoverable matches only after approving the exact historical gap set', async () => {
    const harness = createHarness({ metadataOnly: true, includeRecoverableMatch: true });
    const preview = await runRankedDeckObservationBackfill(
      harness.client,
      parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`])
    );
    const applied = await runRankedDeckObservationBackfill(
      harness.client,
      parseRankedDeckObservationBackfillArgs([
        `--season-key=${SEASON_KEY}`,
        '--apply',
        '--yes',
        '--expected-ledger-revision=7',
        '--allow-incomplete-history',
        `--expected-irrecoverable-match-count=${preview.irrecoverableMatchCount}`,
        `--expected-irrecoverable-match-hash=${preview.irrecoverableMatchHash}`,
      ])
    );

    expect(applied).toMatchObject({
      blockers: [],
      irrecoverableMatchCount: 1,
      irrecoverableMatchHash: preview.irrecoverableMatchHash,
      incompleteHistoryAccepted: true,
      matchCount: 2,
      settledMatchCount: 2,
      projectedAnalyzedMatchCount: 1,
      projectedCoverageRate: 0.5,
      alreadyCompleteMatchCount: 1,
      backfillableMatchCount: 0,
      wouldInsertObservationCount: 0,
      insertedObservationCount: 2,
    });
    expect(harness.observations.size).toBe(2);
    expect(harness.calls).toContain('COMMIT');
  });

  it('rolls back if the approved irrecoverable match set changes before commit', async () => {
    const previewHarness = createHarness({ metadataOnly: true, includeRecoverableMatch: true });
    const preview = await runRankedDeckObservationBackfill(
      previewHarness.client,
      parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`])
    );
    const harness = createHarness({
      metadataOnly: true,
      includeRecoverableMatch: true,
      changeIrrecoverableMatchAfterFirstInspection: true,
    });

    await expect(
      runRankedDeckObservationBackfill(
        harness.client,
        parseRankedDeckObservationBackfillArgs([
          `--season-key=${SEASON_KEY}`,
          '--apply',
          '--yes',
          '--expected-ledger-revision=7',
          '--allow-incomplete-history',
          `--expected-irrecoverable-match-count=${preview.irrecoverableMatchCount}`,
          `--expected-irrecoverable-match-hash=${preview.irrecoverableMatchHash}`,
        ])
      )
    ).rejects.toThrow('Irrecoverable match hash changed');
    expect(harness.calls).toContain('ROLLBACK');
    expect(harness.calls).not.toContain('COMMIT');
  });

  it('does not let incomplete-history approval bypass a conflicting observation', async () => {
    const harness = createHarness({ metadataOnly: true, includeRecoverableMatch: true });
    harness.observations.set('match-2:FIRST', {
      season_id: SEASON_ID,
      match_id: 'match-2',
      seat: 'FIRST',
      user_id: FIRST_USER_ID,
      deck_fingerprint: `sha256:${'f'.repeat(64)}`,
      main_deck_cards: [{ unexpected: true }],
      observed_at: new Date('2026-08-01T12:00:00.000Z'),
    });
    const preview = await runRankedDeckObservationBackfill(
      harness.client,
      parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`])
    );

    await expect(
      runRankedDeckObservationBackfill(
        harness.client,
        parseRankedDeckObservationBackfillArgs([
          `--season-key=${SEASON_KEY}`,
          '--apply',
          '--yes',
          '--expected-ledger-revision=7',
          '--allow-incomplete-history',
          `--expected-irrecoverable-match-count=${preview.irrecoverableMatchCount}`,
          `--expected-irrecoverable-match-hash=${preview.irrecoverableMatchHash}`,
        ])
      )
    ).rejects.toThrow('FIRST 席既有观察事实与卡组快照不一致');
    expect(harness.calls).toContain('ROLLBACK');
  });

  it('reports a conflicting partial observation during dry-run instead of failing only on apply', async () => {
    const harness = createHarness();
    harness.observations.set('match-1:FIRST', {
      season_id: SEASON_ID,
      match_id: 'match-1',
      seat: 'FIRST',
      user_id: FIRST_USER_ID,
      deck_fingerprint: `sha256:${'f'.repeat(64)}`,
      main_deck_cards: [{ unexpected: true }],
      observed_at: new Date('2026-08-01T12:00:00.000Z'),
    });

    const report = await runRankedDeckObservationBackfill(
      harness.client,
      parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`])
    );

    expect(report.blockers).toEqual(['match-1：FIRST 席既有观察事实与卡组快照不一致']);
    expect(report.backfillableMatchCount).toBe(0);
    expect(report.wouldInsertObservationCount).toBe(0);
  });

  it('applies both seats atomically and is idempotent on a second preview', async () => {
    const harness = createHarness();
    const applyArgs = parseRankedDeckObservationBackfillArgs([
      `--season-key=${SEASON_KEY}`,
      '--apply',
      '--yes',
      '--expected-ledger-revision=7',
    ]);

    const applied = await runRankedDeckObservationBackfill(harness.client, applyArgs);

    expect(applied).toMatchObject({
      blockers: [],
      irrecoverableMatchCount: 0,
      incompleteHistoryAccepted: false,
      matchCount: 1,
      alreadyCompleteMatchCount: 1,
      backfillableMatchCount: 0,
      existingObservationCount: 2,
      wouldInsertObservationCount: 0,
      insertedObservationCount: 2,
    });
    expect(harness.observations.size).toBe(2);
    expect(harness.calls).toContain('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    expect(harness.calls).toContain('COMMIT');
    expect(harness.calls).not.toContain('ROLLBACK');

    const preview = await runRankedDeckObservationBackfill(
      harness.client,
      parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`])
    );
    expect(preview).toMatchObject({
      blockers: [],
      alreadyCompleteMatchCount: 1,
      backfillableMatchCount: 0,
      wouldInsertObservationCount: 0,
    });
  });
});
