/** Opt-in P5 verification. Uses real HTTP/auth/records and changes roles only in an isolated clone. */
import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { fromTransport } from '../../src/online/serde';
import type { CreateAiBattleResult } from '../../src/online/ai-battle-types';

const api = process.env.AI_BATTLE_QA_API_URL;
const databaseUrl = process.env.AI_BATTLE_QA_DATABASE_URL;

it.skipIf(!api || !databaseUrl)(
  'P5 real HTTP: current roles, ownership, generic bypasses and persisted origin constraint',
  async () => {
    const database = new URL(databaseUrl!);
    expect(['127.0.0.1', 'localhost']).toContain(database.hostname);
    expect(database.pathname).toMatch(/^\/loveca_ai_qa_/u);
    expect(['127.0.0.1', 'localhost']).toContain(new URL(api!).hostname);
    await mkdir('output/playwright/ai-battle', { recursive: true });
    const pool = new pg.Pool({ connectionString: databaseUrl });
    const savedRoles = await pool.query<{ id: string; role: string; username: string }>(
      "SELECT id, role, username FROM profiles WHERE username IN ('test_admin', 'test_player_1')"
    );
    expect(savedRoles.rows).toHaveLength(2);
    const owner = savedRoles.rows.find((r) => r.username === 'test_admin')!;
    const other = savedRoles.rows.find((r) => r.username === 'test_player_1')!;
    expect(owner.role).toBe('admin');
    expect(other.role).toBe('user');
    const request = (path: string, token?: string, body?: unknown) =>
      globalThis.fetch(`${api}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const login = async (usernameOrEmail: string, password: string) => {
      const response = await request('/api/auth/login', undefined, { usernameOrEmail, password });
      expect(response.status).toBe(200);
      return ((await response.json()) as { data: { accessToken: string } }).data.accessToken;
    };
    let matchId: string | null = null;
    let ownerToken: string | undefined;
    const evidence: { role: string; path: string; status: number }[] = [];
    const assertRequest = async (
      role: string,
      path: string,
      token: string | undefined,
      status: number,
      body?: unknown
    ) => {
      const response = await request(path, token, body);
      expect(response.status, `${role} ${path}`).toBe(status);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      evidence.push({ role, path, status });
      return response;
    };
    try {
      ownerToken = await login('test_admin', 'test_admin_password');
      const ordinaryToken = await login('test_player_1', 'test_password_1');
      let otherToken = ordinaryToken;
      const created = await request('/api/admin/ai-battle/sessions', ownerToken, {
        humanPresetId: 'muse-starter',
        aiPresetId: 'muse-starter',
        handbookId: 'muse-balanced',
        humanSeat: 'FIRST',
        model: 'qwen3.8-max',
      });
      expect(created.status).toBe(201);
      const data = fromTransport<{ data: CreateAiBattleResult }>(await created.json()).data;
      matchId = data.session.matchId;
      const own = `/api/admin/ai-battle/sessions/${matchId}`;
      const routes = [
        [`${own}/snapshot`, undefined],
        [`${own}/decisions`, undefined],
        [`${own}/export`, undefined],
        [`/api/admin/ai-battle/records/${matchId}/billing`, undefined],
        [`${own}/command`, { command: { type: 'MULLIGAN', cardIdsToMulligan: [] } }],
        [`${own}/advance`, {}],
        [`${own}/end`, {}],
        [`/api/online/matches/${matchId}/snapshot`, undefined],
        [`/api/online/matches/${matchId}/command`, { command: { type: 'SURRENDER' } }],
        [`/api/online/admin/matches/${matchId}/debug-replay/export`, {}],
        [
          `/api/online/admin/matches/${matchId}/spectator-links/player-view`,
          { viewerSeat: 'SECOND' },
        ],
      ] as const;
      for (const [path, body] of routes) {
        await assertRequest('anonymous', path, undefined, 401, body);
        await assertRequest('user', path, otherToken, 403, body);
      }
      for (const [role, expected] of [
        ['season_admin', 403],
        ['admin', 404],
      ] as const) {
        await pool.query('UPDATE profiles SET role = $1 WHERE id = $2', [role, other.id]);
        await assertRequest(
          'old-user-token-after-promotion',
          `${own}/snapshot`,
          ordinaryToken,
          403
        );
        otherToken = await login('test_player_1', 'test_password_1');
        for (const [path, body] of routes)
          await assertRequest(role, path, otherToken, expected, body);
      }
      // A still-valid admin JWT loses access immediately when its current role is revoked.
      await pool.query("UPDATE profiles SET role = 'user' WHERE id = $1", [owner.id]);
      for (const [path, body] of routes)
        await assertRequest('revoked-owner', path, ownerToken, 403, body);
      await pool.query("UPDATE profiles SET role = 'admin' WHERE id = $1", [owner.id]);
      await assertRequest('restored-owner', `${own}/snapshot`, ownerToken, 200);
      await assertRequest(
        'owner-spectator-link',
        `/api/online/admin/matches/${matchId}/spectator-links/player-view`,
        ownerToken,
        404,
        { viewerSeat: 'SECOND' }
      );
      await assertRequest('owner-end', `${own}/end`, ownerToken, 200, {});
      await assertRequest('owner-ended-export', `${own}/export`, ownerToken, 200);
      await assertRequest('other-admin-ended-export', `${own}/export`, otherToken, 404);
      const record = await request(`/api/battle/match-records/${matchId}`, ownerToken);
      expect(record.status).toBe(200);
      expect(await record.json()).toMatchObject({
        data: { originKind: 'AI_DEBUG', status: 'INTERRUPTED', winnerSeat: null },
      });
      for (const suffix of ['', '/replay', '/timeline']) {
        const denied = await request(`/api/battle/match-records/${matchId}${suffix}`, otherToken);
        expect(denied.status).toBe(404);
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Test the origin enum separately from the new billing-only-on-AI invariant.
        await client.query('UPDATE match_records SET ai_billing = NULL WHERE match_id = $1', [
          matchId,
        ]);
        for (const origin of ['ONLINE_ROOM', 'PUBLIC_TABLE', 'RANKED', 'SOLITAIRE', 'AI_DEBUG']) {
          // Use the actual migrated business table; all writes are rolled back below.
          await client.query('UPDATE match_records SET origin_kind = $1 WHERE match_id = $2', [
            origin,
            matchId,
          ]);
        }
        await expect(
          client.query("UPDATE match_records SET origin_kind = 'INVALID_QA' WHERE match_id = $1", [
            matchId,
          ])
        ).rejects.toMatchObject({ code: '23514', constraint: 'match_records_origin_kind_check' });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      const constraint = await pool.query<{ definition: string }>(
        "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'match_records_origin_kind_check'"
      );
      const persisted = await pool.query<{ origin_kind: string; status: string }>(
        'SELECT origin_kind, status FROM match_records WHERE match_id = $1',
        [matchId]
      );
      expect(persisted.rows).toEqual([{ origin_kind: 'AI_DEBUG', status: 'INTERRUPTED' }]);
      await writeFile(
        'output/playwright/ai-battle/full-env-permissions.json',
        JSON.stringify(
          { matchId, database: database.pathname.slice(1), evidence, constraint: constraint.rows },
          null,
          2
        )
      );
    } finally {
      for (const row of savedRoles.rows)
        await pool.query('UPDATE profiles SET role = $1 WHERE id = $2', [row.role, row.id]);
      if (matchId && ownerToken)
        await request(`/api/admin/ai-battle/sessions/${matchId}/end`, ownerToken, {});
      await pool.end();
    }
  },
  60_000
);
