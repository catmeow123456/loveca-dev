import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
    connect: mocks.poolConnect,
  },
}));

import {
  AdminUserService,
  AdminUserServiceError,
} from '../../src/server/services/admin-user-service';

const actorUserId = '11111111-1111-4111-8111-111111111111';
const targetUserId = '22222222-2222-4222-8222-222222222222';

function roleChangeInput() {
  return {
    actorUserId,
    targetUserId,
    nextRole: 'season_admin' as const,
    expectedRole: 'user' as const,
  };
}

function userSummary(role: 'user' | 'season_admin' | 'admin') {
  return {
    id: targetUserId,
    username: 'operator',
    display_name: '赛季运营',
    email: 'operator@example.com',
    email_verified: true,
    role,
    deck_count: 3,
    created_at: new Date('2026-08-01T00:00:00.000Z'),
  };
}

describe('AdminUserService', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.poolConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease,
    });
  });

  it('lists only the requested page with literal substring search and stable ordering', async () => {
    mocks.poolQuery
      .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [userSummary('user')], rowCount: 1 });

    const result = await new AdminUserService().listUsers({
      query: 'operator_%',
      role: 'user',
      limit: 50,
      offset: 100,
    });

    expect(result.total).toBe(1);
    expect(result.data).toEqual([userSummary('user')]);
    const listCall = mocks.poolQuery.mock.calls[1] as [string, unknown[]];
    expect(listCall[0]).toContain('ORDER BY u.created_at DESC, u.id ASC');
    expect(listCall[0]).toContain('LIMIT $3 OFFSET $4');
    expect(listCall[1]).toEqual(['%operator\\_\\%%', 'user', 50, 100]);
  });

  it('changes a role and revokes refresh tokens in one transaction', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ id: actorUserId }, { id: 'another-admin' }], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [{ id: targetUserId, role: 'user' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [userSummary('season_admin')], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    const result = await new AdminUserService().changeRole(roleChangeInput());

    expect(result).toEqual({ changed: true, user: userSummary('season_admin') });
    const queries = mocks.clientQuery.mock.calls.map((call) => call[0] as string);
    expect(queries[1]).toContain("WHERE role = 'admin'");
    expect(queries[1]).toContain('FOR UPDATE');
    expect(queries[3]).toContain('UPDATE profiles SET role');
    expect(queries[4]).toContain('DELETE FROM refresh_tokens');
    expect(queries.some((query) => query.includes('management_audit_logs'))).toBe(false);
    expect(queries.at(-1)).toBe('COMMIT');
    expect(mocks.clientRelease).toHaveBeenCalledOnce();
  });

  it('rejects a stale expected role without overwriting the newer value', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ id: actorUserId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: targetUserId, role: 'season_admin' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(new AdminUserService().changeRole(roleChangeInput())).rejects.toMatchObject<
      Partial<AdminUserServiceError>
    >({ code: 'ROLE_CONFLICT', statusCode: 409 });

    const queries = mocks.clientQuery.mock.calls.map((call) => String(call[0]));
    expect(queries.some((query) => query.includes('UPDATE profiles'))).toBe(false);
    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('returns a no-change result without revoking sessions', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ id: actorUserId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: targetUserId, role: 'user' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [userSummary('user')], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(
      new AdminUserService().changeRole({ ...roleChangeInput(), nextRole: 'user' })
    ).resolves.toEqual({ changed: false, user: userSummary('user') });

    const queries = mocks.clientQuery.mock.calls.map((call) => call[0] as string);
    expect(queries.some((query) => query.includes('DELETE FROM refresh_tokens'))).toBe(false);
    expect(queries.some((query) => query.includes('INSERT INTO management_audit_logs'))).toBe(
      false
    );
    expect(queries.at(-1)).toBe('COMMIT');
  });

  it('serializes and rejects demotion of the final platform administrator', async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: null })
      .mockResolvedValueOnce({ rows: [{ id: actorUserId }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: actorUserId, role: 'admin' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: null });

    await expect(
      new AdminUserService().changeRole({
        ...roleChangeInput(),
        targetUserId: actorUserId,
        expectedRole: 'admin',
        nextRole: 'user',
      })
    ).rejects.toMatchObject<Partial<AdminUserServiceError>>({
      code: 'LAST_ADMIN_REQUIRED',
      statusCode: 409,
    });

    expect(mocks.clientQuery.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
