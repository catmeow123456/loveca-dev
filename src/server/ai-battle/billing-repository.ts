import type { AiBillingRecord } from '../../online/ai-battle-billing-types.js';
import type { MatchRecorderQueryClient } from '../services/match-recorder-service.js';
import type { AiBillingPersistence } from './billing.js';

export class AiBillingRepository implements AiBillingPersistence {
  constructor(
    private readonly queryClient: MatchRecorderQueryClient = {
      query: async <T = unknown>(text: string, values?: readonly unknown[]) => {
        const { pool } = await import('../db/pool.js');
        const result = await pool.query(text, values ? [...values] : undefined);
        return { rows: result.rows as T[], rowCount: result.rowCount };
      },
    }
  ) {}

  async save(matchId: string, record: AiBillingRecord): Promise<void> {
    const result = await this.queryClient.query<{ match_id: string }>(
      `UPDATE match_records SET
        ai_billing = CASE WHEN ai_billing IS NULL OR (ai_billing->>'revision')::bigint < $3
          THEN $2::jsonb ELSE ai_billing END,
        updated_at = now()
      WHERE match_id = $1 AND origin_kind = 'AI_DEBUG'
      RETURNING match_id`,
      [matchId, JSON.stringify(record), record.revision]
    );
    if (result.rows.length !== 1) throw new Error('AI 对局计费记录不存在');
  }

  async readOwned(
    matchId: string,
    ownerUserId: string
  ): Promise<AiBillingRecord | null | undefined> {
    const result = await this.queryClient.query<{ ai_billing: AiBillingRecord | null }>(
      `SELECT ai_billing FROM match_records
       WHERE match_id = $1 AND origin_kind = 'AI_DEBUG'
         AND (first_user_id = $2 OR second_user_id = $2)`,
      [matchId, ownerUserId]
    );
    return result.rows[0]?.ai_billing;
  }
}
