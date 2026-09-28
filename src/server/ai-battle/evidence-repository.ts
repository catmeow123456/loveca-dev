import { serializeAiEvidence } from './redaction.js';
import type { AiDatabaseArchiveStatus } from '../../online/ai-battle-observation-types.js';

export interface AiEvidenceEntry {
  readonly id: string;
  readonly entry: Record<string, unknown>;
}

export interface AiEvidenceRepository {
  append(matchId: string, entry: Record<string, unknown>): Promise<void>;
  exists(matchId: string): Promise<boolean>;
  latest(matchId: string): Promise<AiEvidenceEntry | null>;
  listAfter(matchId: string, afterId: string, limit: number): Promise<readonly AiEvidenceEntry[]>;
}

/** The database knows only the match and append order; capture formats stay opaque JSON. */
export class PostgresAiEvidenceRepository implements AiEvidenceRepository {
  async append(matchId: string, entry: Record<string, unknown>): Promise<void> {
    const { pool } = await import('../db/pool.js');
    const result = await pool.query(
      `INSERT INTO ai_battle_evidence_entries (match_id, entry)
       SELECT match_id, $2::jsonb FROM match_records
       WHERE match_id = $1 AND origin_kind = 'AI_DEBUG'
       RETURNING id`,
      [matchId, JSON.stringify(entry)]
    );
    if (result.rowCount !== 1) throw new Error('AI 对局归档目标不存在');
  }

  async exists(matchId: string): Promise<boolean> {
    const { pool } = await import('../db/pool.js');
    const result = await pool.query(
      `SELECT 1 FROM match_records WHERE match_id = $1 AND origin_kind = 'AI_DEBUG'`,
      [matchId]
    );
    return result.rowCount === 1;
  }

  async latest(matchId: string): Promise<AiEvidenceEntry | null> {
    const { pool } = await import('../db/pool.js');
    const result = await pool.query<AiEvidenceEntry>(
      `SELECT id::text AS id, entry FROM ai_battle_evidence_entries
       WHERE match_id = $1 ORDER BY id DESC LIMIT 1`,
      [matchId]
    );
    return result.rows[0] ?? null;
  }

  async listAfter(
    matchId: string,
    afterId: string,
    limit: number
  ): Promise<readonly AiEvidenceEntry[]> {
    const { pool } = await import('../db/pool.js');
    const result = await pool.query<AiEvidenceEntry>(
      `SELECT id::text AS id, entry FROM ai_battle_evidence_entries
       WHERE match_id = $1 AND id > $2 ORDER BY id LIMIT $3`,
      [matchId, afterId, limit]
    );
    return result.rows;
  }
}

const MAX_QUEUED_BYTES = 16 * 1024 * 1024;

/** Ordered best-effort writes never stall the authority queue; a failed prefix stays visibly incomplete. */
export class AiDatabaseEvidenceArchive {
  private tail: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private failure?: AiDatabaseArchiveStatus['failure'];
  private ended = false;
  private writtenEntries = 0;

  constructor(
    private readonly repository: AiEvidenceRepository,
    private readonly matchId: string,
    private readonly now: () => number = Date.now
  ) {
    this.record('HEADER', { format: 'loveca-ai-evidence-v1', matchId });
  }

  record(kind: string, payload: unknown): void {
    if (this.failure) return;
    let entry: Record<string, unknown>;
    try {
      const serialized = serializeAiEvidence(payload);
      entry = {
        format: 'loveca-ai-evidence-v1',
        timestamp: this.now(),
        kind,
        redactionCount: serialized.count,
        payload: JSON.parse(serialized.text),
      };
    } catch {
      this.failure = 'CAPTURE_FAILED';
      return;
    }
    const bytes = Buffer.byteLength(JSON.stringify(entry));
    if (this.queuedBytes + bytes > MAX_QUEUED_BYTES) {
      this.failure = 'QUEUE_LIMIT';
      return;
    }
    this.queuedBytes += bytes;
    this.tail = this.tail.then(async () => {
      try {
        if (this.failure !== 'WRITE_FAILED') {
          await this.repository.append(this.matchId, entry);
          this.writtenEntries++;
        }
      } catch (error) {
        this.failure = 'WRITE_FAILED';
        console.error('[AiBattle] 数据库决定归档写入失败', {
          matchId: this.matchId,
          error: error instanceof Error ? error.name : 'UnknownError',
        });
      } finally {
        this.queuedBytes -= bytes;
      }
    });
  }

  markEnded(endedAt: number): void {
    if (this.ended) return;
    this.ended = true;
    this.record('END', { endedAt });
  }

  reportCaptureFailure(): void {
    this.record('CAPTURE_FAILURE', {});
  }

  status(): AiDatabaseArchiveStatus {
    return {
      state: this.failure ? 'FAILED' : this.ended ? 'ENDED' : 'RECORDING',
      queuedBytes: this.queuedBytes,
      writtenEntries: this.writtenEntries,
      ...(this.failure ? { failure: this.failure } : {}),
    };
  }

  async flush(): Promise<boolean> {
    await this.tail;
    return !this.failure;
  }
}
