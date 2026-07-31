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
        calls.push(text);
        if (text.includes('SELECT record.match_id')) {
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
        return { rows: [{ count: '1' }] as T[] };
      },
    };

    const report = await runPurgeReplayMigration(client, parseArgs(['--dry-run']));

    expect(report.candidateMatchCount).toBe(1);
    expect(report.replayRows).toBe(12);
    expect(report.metadataRowsUpdated).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls.join('\n')).not.toContain('DELETE FROM');
  });

  it('deletes replay children and marks metadata in batches', async () => {
    const calls: string[] = [];
    let idBatchRead = false;
    const client: PurgeReplayQueryClient = {
      async query<T>(text: string) {
        calls.push(text);
        if (text.includes('SELECT record.match_id')) return { rows: [] as T[] };
        if (text.includes('WITH selected')) return { rows: [{ count: 1 }] as T[] };
        if (text.includes('SELECT match_id FROM match_records')) {
          if (idBatchRead) return { rows: [] as T[] };
          idBatchRead = true;
          return { rows: [{ match_id: 'old-match' }] as T[] };
        }
        if (text === 'BEGIN' || text === 'COMMIT') return { rows: [] as T[] };
        throw new Error(`unexpected query: ${text}`);
      },
    };

    const report = await runPurgeReplayMigration(client, parseArgs(['--apply', '--yes']));

    expect(report.metadataRowsUpdated).toBe(1);
    expect(calls.some((call) => call.includes('DELETE FROM match_checkpoints'))).toBe(true);
    expect(calls.some((call) => call.includes("completeness = 'METADATA_ONLY'"))).toBe(true);
    expect(calls).toContain('COMMIT');
  });
});
