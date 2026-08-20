import { describe, expect, it } from 'vitest';
import {
  parseArgs,
  runPurgeReplayMigration,
  type PurgeReplayQueryClient,
} from '../../drizzle/data-migrations/purge-expired-match-replay-data';

describe('purge-expired-match-replay-data', () => {
  it('defaults to a ten-day dry-run and requires confirmation for apply', () => {
    const args = parseArgs([], new Date('2026-07-31T00:00:00.000Z'));
    expect(args.mode).toBe('dry-run');
    expect(args.retentionDays).toBe(10);
    expect(args.cutoff).toBe('2026-07-21T00:00:00.000Z');
    expect(() => parseArgs(['--apply'])).toThrow('--apply requires --yes');
  });

  it('keeps an explicit cutoff independent of argument order', () => {
    const cutoff = '2026-06-01T12:30:00.000Z';

    expect(parseArgs([`--cutoff=${cutoff}`, '--retention-days=30']).cutoff).toBe(cutoff);
    expect(parseArgs(['--retention-days=30', `--cutoff=${cutoff}`]).cutoff).toBe(cutoff);
  });

  it('reports replay rows without mutating in dry-run mode', async () => {
    const calls: string[] = [];
    const client: PurgeReplayQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        calls.push(text);
        if (text.includes('SELECT record.match_id,')) {
          return {
            rows: [
              {
                match_id: 'old-match',
                replay_rows: 12,
                checkpoint_rows: 4,
                event_rows: 7,
                decision_rows: 1,
              },
            ] as T[],
          };
        }
        if (text.includes('JOIN ranked_matches AS ranked_match')) {
          return { rows: [{ count: '0' }] as T[] };
        }
        return { rows: [{ count: '1' }] as T[] };
      },
    };

    const report = await runPurgeReplayMigration(client, parseArgs(['--dry-run']));

    expect(report.candidateMatchCount).toBe(1);
    expect(report.replayRows).toBe(12);
    expect(report.blockedRankedMatchCount).toBe(0);
    expect(report.metadataRowsUpdated).toBe(0);
    expect(calls).toHaveLength(3);
    expect(calls.join('\n')).not.toContain('DELETE FROM');
  });

  it('reports ranked candidates without two complete deck observations in dry-run mode', async () => {
    const client: PurgeReplayQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        if (text.includes('SELECT record.match_id,')) return { rows: [] as T[] };
        if (text.includes('JOIN ranked_matches AS ranked_match')) {
          return { rows: [{ count: '2' }] as T[] };
        }
        return { rows: [{ count: '2' }] as T[] };
      },
    };

    const report = await runPurgeReplayMigration(client, parseArgs(['--dry-run']));

    expect(report.candidateMatchCount).toBe(2);
    expect(report.blockedRankedMatchCount).toBe(2);
    expect(report.metadataRowsUpdated).toBe(0);
  });

  it('blocks apply before mutating when a ranked candidate lacks complete observations', async () => {
    const calls: string[] = [];
    const client: PurgeReplayQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        calls.push(text);
        if (text.includes('SELECT record.match_id,')) return { rows: [] as T[] };
        if (text.includes('JOIN ranked_matches AS ranked_match')) {
          return { rows: [{ count: '1' }] as T[] };
        }
        throw new Error(`unexpected query: ${text}`);
      },
    };

    await expect(runPurgeReplayMigration(client, parseArgs(['--apply', '--yes']))).rejects.toThrow(
      'do not have two complete deck observations'
    );

    expect(calls).not.toContain('BEGIN');
    expect(calls.join('\n')).not.toContain('UPDATE match_deck_snapshots');
  });

  it('deletes replay children and marks metadata in batches', async () => {
    const calls: string[] = [];
    let purgedBatch = false;
    const client: PurgeReplayQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        calls.push(text);
        if (text.includes('SELECT record.match_id,')) return { rows: [] as T[] };
        if (text.includes('JOIN ranked_matches AS ranked_match')) {
          return { rows: [{ count: '0' }] as T[] };
        }
        if (text.includes('WITH selected')) {
          if (purgedBatch) return { rows: [{ count: 0 }] as T[] };
          purgedBatch = true;
          return { rows: [{ count: 1 }] as T[] };
        }
        if (text === 'BEGIN' || text === 'COMMIT') return { rows: [] as T[] };
        throw new Error(`unexpected query: ${text}`);
      },
    };

    const report = await runPurgeReplayMigration(client, parseArgs(['--apply', '--yes']));

    expect(report.metadataRowsUpdated).toBe(1);
    expect(report.blockedRankedMatchCount).toBe(0);
    expect(calls.some((call) => call.includes('DELETE FROM match_checkpoints'))).toBe(true);
    expect(calls.some((call) => call.includes("completeness = 'METADATA_ONLY'"))).toBe(true);
    expect(calls.some((call) => call.includes('FROM ranked_deck_observations'))).toBe(true);
    expect(calls.some((call) => call.includes("first_observation.seat = 'FIRST'"))).toBe(true);
    expect(calls.some((call) => call.includes("second_observation.seat = 'SECOND'"))).toBe(true);
    expect(calls.some((call) => call.includes('FOR UPDATE OF record SKIP LOCKED'))).toBe(true);
    expect(calls).toContain('COMMIT');
  });
});
