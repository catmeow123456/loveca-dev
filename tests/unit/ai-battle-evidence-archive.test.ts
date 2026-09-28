import { describe, expect, it } from 'vitest';
import {
  AiDatabaseEvidenceArchive,
  type AiEvidenceRepository,
} from '../../src/server/ai-battle/evidence-repository';
import { createMemoryAiEvidence } from '../helpers/ai-battle-evidence';

describe('AI database evidence archive', () => {
  it('writes ordered redacted entries before ending', async () => {
    const repository = createMemoryAiEvidence();
    const archive = new AiDatabaseEvidenceArchive(repository, 'match-1', () => 123);
    archive.record('REQUEST', { apiKey: 'private-value', text: 'model input' });
    archive.record('RESPONSE', { result: 'ok' });
    archive.markEnded(456);
    expect(await archive.flush()).toBe(true);
    expect(archive.status()).toMatchObject({ state: 'ENDED', writtenEntries: 4 });
    const rows = await repository.listAfter('match-1', '0', 10);
    expect(rows.map((row) => row.entry.kind)).toEqual(['HEADER', 'REQUEST', 'RESPONSE', 'END']);
    expect(JSON.stringify(rows)).not.toContain('private-value');
    expect(rows[1]!.entry.payload).toMatchObject({ text: 'model input' });
  });

  it('stops on a database write error and does not write a false END marker', async () => {
    const persisted = createMemoryAiEvidence();
    let count = 0;
    const repository: AiEvidenceRepository = {
      ...persisted,
      append: async (matchId, entry) => {
        if (++count === 2) throw new Error('database unavailable');
        await persisted.append(matchId, entry);
      },
    };
    const archive = new AiDatabaseEvidenceArchive(repository, 'match-2');
    expect(await archive.flush()).toBe(true);
    archive.record('BEGIN', { id: 'decision-1' });
    archive.markEnded(456);
    expect(await archive.flush()).toBe(false);
    expect(archive.status()).toMatchObject({ state: 'FAILED', failure: 'WRITE_FAILED' });
    expect((await repository.latest('match-2'))?.entry.kind).toBe('HEADER');
  });
});
