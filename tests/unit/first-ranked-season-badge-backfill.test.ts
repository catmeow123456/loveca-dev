import { describe, expect, it } from 'vitest';
import {
  parseFirstRankedSeasonBadgeBackfillArgs,
  runFirstRankedSeasonBadgeBackfill,
  type FirstRankedSeasonBadgeBackfillQueryClient,
} from '../../drizzle/data-migrations/award-first-ranked-season-badge';

const SEASON = {
  id: '11111111-1111-4111-8111-111111111111',
  season_key: 'ranked-season-one',
  name: '第一赛季',
  lifecycle: 'ACTIVE' as const,
  starts_at: new Date('2026-08-01T00:00:00.000Z'),
  ledger_revision: 7,
};

function createClient() {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  let ruleConfigured = false;
  let badgeAwarded = false;
  const client: FirstRankedSeasonBadgeBackfillQueryClient = {
    async query<T>(text: string, values: readonly unknown[] = []) {
      await Promise.resolve();
      calls.push({ text, values });
      if (text.includes('INSERT INTO player_badge_rules')) {
        ruleConfigured = true;
        return { rows: [] as T[] };
      }
      if (text.includes('INSERT INTO player_badges')) {
        badgeAwarded = true;
        return {
          rows: [{ user_id: '22222222-2222-4222-8222-222222222222' }] as T[],
        };
      }
      if (text.includes('WHERE season_key = $1')) return { rows: [SEASON] as T[] };
      if (text.includes("WHERE lifecycle IN ('ACTIVE', 'FINALIZING', 'CLOSED')")) {
        return { rows: [SEASON] as T[] };
      }
      if (text.includes('FROM player_badge_rules')) {
        return {
          rows: (ruleConfigured
            ? [
                {
                  badge_key: 'ranked-first-season-qualified',
                  source_season_id: SEASON.id,
                  criteria_type: 'RANKED_RATED_MATCH_COUNT',
                  minimum_value: 3,
                  criteria_version: 'RANKED_FIRST_SEASON_THREE_MATCHES_V1',
                },
              ]
            : []) as T[],
        };
      }
      if (text.includes('FROM ranked_player_ratings AS rating')) {
        return {
          rows: [
            {
              user_id: '22222222-2222-4222-8222-222222222222',
              display_name: '玩家二',
              rated_match_count: 3,
              already_awarded: badgeAwarded,
            },
          ] as T[],
        };
      }
      return { rows: [] as T[] };
    },
  };
  return { calls, client };
}

describe('first ranked season badge backfill', () => {
  it('defaults to a read-only dry-run and requires an explicit season key', () => {
    expect(parseFirstRankedSeasonBadgeBackfillArgs(['--season-key=ranked-season-one'])).toEqual({
      mode: 'dry-run',
      seasonKey: 'ranked-season-one',
      expectedLedgerRevision: null,
      yes: false,
    });
    expect(() => parseFirstRankedSeasonBadgeBackfillArgs([])).toThrow('--season-key');
    expect(() =>
      parseFirstRankedSeasonBadgeBackfillArgs([
        '--season-key=ranked-season-one',
        '--apply',
        '--yes',
      ])
    ).toThrow('--expected-ledger-revision');
  });

  it('reports candidates without issuing writes in dry-run mode', async () => {
    const { calls, client } = createClient();
    const report = await runFirstRankedSeasonBadgeBackfill(client, {
      mode: 'dry-run',
      seasonKey: 'ranked-season-one',
      expectedLedgerRevision: null,
      yes: false,
    });

    expect(report).toMatchObject({
      blockers: [],
      minimumRatedMatchCount: 3,
      eligibleCount: 1,
      wouldAwardCount: 1,
      awardedCount: 0,
    });
    expect(calls.some((call) => /^BEGIN|^COMMIT|^ROLLBACK/.test(call.text))).toBe(false);
    expect(calls.some((call) => call.text.includes('INSERT INTO'))).toBe(false);
  });

  it('binds the reviewed season and awards in one serializable transaction', async () => {
    const { calls, client } = createClient();
    const report = await runFirstRankedSeasonBadgeBackfill(client, {
      mode: 'apply',
      seasonKey: 'ranked-season-one',
      expectedLedgerRevision: 7,
      yes: true,
    });

    expect(report.blockers).toEqual([]);
    expect(report.awardedCount).toBe(1);
    expect(calls[0]?.text).toBe('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    expect(calls.some((call) => call.text.includes('INSERT INTO player_badge_rules'))).toBe(true);
    expect(calls.some((call) => call.text.includes('INSERT INTO player_badges'))).toBe(true);
    expect(calls.at(-1)?.text).toBe('COMMIT');
  });
});
