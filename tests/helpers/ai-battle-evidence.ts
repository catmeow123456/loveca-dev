import type {
  AiEvidenceEntry,
  AiEvidenceRepository,
} from '../../src/server/ai-battle/evidence-repository';

export function createMemoryAiEvidence(): AiEvidenceRepository {
  const records = new Map<string, AiEvidenceEntry[]>();
  let nextId = 0;
  return {
    append: (matchId, entry) => {
      const rows = records.get(matchId) ?? [];
      rows.push({ id: String(++nextId), entry: structuredClone(entry) });
      records.set(matchId, rows);
      return Promise.resolve();
    },
    exists: (matchId) => Promise.resolve(records.has(matchId)),
    latest: (matchId) => Promise.resolve(records.get(matchId)?.at(-1) ?? null),
    listAfter: (matchId, afterId, limit) =>
      Promise.resolve(
        (records.get(matchId) ?? [])
          .filter((row) => BigInt(row.id) > BigInt(afterId))
          .slice(0, limit)
      ),
  };
}
