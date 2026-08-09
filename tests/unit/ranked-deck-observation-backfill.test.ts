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

function createHarness(options: { readonly metadataOnly?: boolean } = {}) {
  const calls: string[] = [];
  const observations = new Map<string, StoredObservation>();
  const firstDeck = createDeckFixture('PL!N-bp1');
  const secondDeck = createDeckFixture('PL!HS-bp1');
  const startedAt = new Date('2026-08-01T12:00:00.000Z');

  const inspectionRows = [
    {
      match_id: 'match-1',
      first_user_id: FIRST_USER_ID,
      second_user_id: SECOND_USER_ID,
      completeness: options.metadataOnly ? 'METADATA_ONLY' : 'FULL',
      started_at: startedAt,
      seat: 'FIRST' as const,
      snapshot_user_id: FIRST_USER_ID,
      main_deck: options.metadataOnly ? [] : firstDeck.mainDeck,
      card_summaries: options.metadataOnly ? {} : firstDeck.cardSummaries,
    },
    {
      match_id: 'match-1',
      first_user_id: FIRST_USER_ID,
      second_user_id: SECOND_USER_ID,
      completeness: options.metadataOnly ? 'METADATA_ONLY' : 'FULL',
      started_at: startedAt,
      seat: 'SECOND' as const,
      snapshot_user_id: SECOND_USER_ID,
      main_deck: options.metadataOnly ? [] : secondDeck.mainDeck,
      card_summaries: options.metadataOnly ? {} : secondDeck.cardSummaries,
    },
  ];

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
        return { rows: inspectionRows as T[] };
      }
      if (text.includes('WHERE season_id = $1')) {
        return { rows: [...observations.values()] as T[] };
      }
      if (text.includes('FROM match_deck_snapshots AS snapshot')) {
        return {
          rows: inspectionRows.map((row) => ({
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
    });
    expect(() =>
      parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`, '--apply'])
    ).toThrow('--apply requires --yes');
    expect(() =>
      parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`, '--apply', '--yes'])
    ).toThrow('--apply requires --expected-ledger-revision');
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
      matchCount: 1,
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

  it('blocks snapshots that were already reduced to metadata-only', async () => {
    const harness = createHarness({ metadataOnly: true });
    const args = parseRankedDeckObservationBackfillArgs([`--season-key=${SEASON_KEY}`]);

    const report = await runRankedDeckObservationBackfill(harness.client, args);

    expect(report.blockers).toEqual(['match-1：历史卡组明细已清理，无法回填']);
    expect(report.backfillableMatchCount).toBe(0);
    expect(report.wouldInsertObservationCount).toBe(0);
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
