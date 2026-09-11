/** Run against the local FAKE HTTP harness and its isolated, fully migrated database. */
import pg from 'pg';
import { expect, it } from 'vitest';
import { AiBillingRepository } from '../../src/server/ai-battle/billing-repository';
import { addAiTokenUsage, projectAiBilling } from '../../src/server/ai-battle/billing';
import type {
  AiBillingRecord,
  AiRecordedBillingResponse,
} from '../../src/online/ai-battle-billing-types';
import type { AiBattleSessionView, CreateAiBattleResult } from '../../src/online/ai-battle-types';

const api = process.env.AI_BATTLE_QA_API_URL;
const databaseUrl = process.env.AI_BATTLE_QA_DATABASE_URL;
const data = async <T>(response: Response): Promise<T> =>
  ((await response.json()) as { data: T }).data;

it.skipIf(!api || !databaseUrl)(
  'persists HTTP usage, survives reconnect, and keeps totals after sealing and retention',
  async () => {
    const database = new URL(databaseUrl!);
    expect(['127.0.0.1', 'localhost']).toContain(database.hostname);
    expect(database.pathname).toMatch(/^\/loveca_ai_qa_/u);
    expect(['127.0.0.1', 'localhost']).toContain(new URL(api!).hostname);
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const login = await globalThis.fetch(`${api}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernameOrEmail: 'test_admin', password: 'test_admin_password' }),
    });
    expect(login.status).toBe(200);
    const headers = {
      Authorization: `Bearer ${(await data<{ accessToken: string }>(login)).accessToken}`,
      'content-type': 'application/json',
    };
    const request = (path: string, body?: unknown) =>
      globalThis.fetch(`${api}/api/admin/ai-battle${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    let matchId: string | undefined;
    try {
      const created = await request('/sessions', {
        model: 'qwen3.8-flash',
        humanPresetId: 'muse-starter',
        aiPresetId: 'muse-starter',
        handbookId: 'muse-balanced',
        humanSeat: 'SECOND',
      });
      expect(created.status).toBe(201);
      matchId = (await data<CreateAiBattleResult>(created)).session.matchId;
      await expect
        .poll(
          async () =>
            (await data<AiBattleSessionView>(await request(`/sessions/${matchId}`))).matchBilling
              .reportedAttempts
        )
        .toBe(1);
      expect((await request(`/sessions/${matchId}/end`, {})).status).toBe(200);
      const billing = (
        await data<AiRecordedBillingResponse>(await request(`/records/${matchId}/billing`))
      ).matchBilling;
      expect(billing).toMatchObject({
        model: 'qwen3.8-flash',
        estimatedCny: '0.02579710',
        attempts: 1,
        reportedAttempts: 1,
        usage: {
          inputTokens: 29797,
          implicitCachedTokens: 17408,
          explicitCachedTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 81,
        },
      });
      const root = await pool.query<{
        status: string;
        second_user_id: string;
        ai_billing: AiBillingRecord;
      }>(
        'SELECT first_user_id, second_user_id, status, ai_billing FROM match_records WHERE match_id = $1',
        [matchId]
      );
      expect(root.rows[0]!.status).toBe('INTERRUPTED');
      expect(projectAiBilling(root.rows[0]!.ai_billing)).toEqual(billing);
      const owner = root.rows[0]!.second_user_id;
      const client = await pool.connect();
      const repository = new AiBillingRepository({
        query: async <T>(text: string, values?: readonly unknown[]) => {
          const result = await client.query(text, values ? [...values] : undefined);
          return { rows: result.rows as T[], rowCount: result.rowCount };
        },
      });
      try {
        await client.query('BEGIN');
        const first = root.rows[0]!.ai_billing;
        const late = {
          ...first,
          revision: first.revision + 1,
          attempts: 2,
          reportedAttempts: 2,
          usage: addAiTokenUsage(first.usage, first.usage),
        };
        // Late usage can update a sealed root. Repeated/older writes cannot double or undo it.
        await repository.save(matchId!, late);
        await repository.save(matchId!, late);
        await repository.save(matchId!, first);
        await client.query(
          "UPDATE match_records SET completeness = 'METADATA_ONLY' WHERE match_id = $1",
          [matchId]
        );
        expect(projectAiBilling((await repository.readOwned(matchId!, owner))!).estimatedCny).toBe(
          '0.05159420'
        );
        expect(
          await repository.readOwned(matchId!, '00000000-0000-0000-0000-000000000000')
        ).toBeUndefined();
        // NULL means a pre-billing record, not a zero-cost record.
        await client.query('UPDATE match_records SET ai_billing = NULL WHERE match_id = $1', [
          matchId,
        ]);
        expect(await repository.readOwned(matchId!, owner)).toBeNull();
        await repository.save(matchId!, first);
        await expect(
          client.query("UPDATE match_records SET origin_kind = 'SOLITAIRE' WHERE match_id = $1", [
            matchId,
          ])
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'match_records_ai_billing_origin_check',
        });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      const reconnected = new pg.Client({ connectionString: databaseUrl });
      await reconnected.connect();
      try {
        const result = await reconnected.query<{ ai_billing: AiBillingRecord }>(
          'SELECT ai_billing FROM match_records WHERE match_id = $1',
          [matchId]
        );
        expect(projectAiBilling(result.rows[0]!.ai_billing)).toEqual(billing);
      } finally {
        await reconnected.end();
      }
    } finally {
      if (matchId) await request(`/sessions/${matchId}/end`, {});
      await pool.end();
    }
  },
  30_000
);
