import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { UserRole } from '../../shared/auth/permissions.js';

export interface AdminUserSummary {
  readonly id: string;
  readonly username: string;
  readonly display_name: string | null;
  readonly email: string;
  readonly email_verified: boolean;
  readonly role: UserRole;
  readonly deck_count: number;
  readonly created_at: Date;
}

export interface AdminUserListInput {
  readonly query?: string;
  readonly role?: UserRole;
  readonly limit: number;
  readonly offset: number;
}

export interface AdminUserListResult {
  readonly data: readonly AdminUserSummary[];
  readonly total: number;
}

export interface ChangeUserRoleInput {
  readonly targetUserId: string;
  readonly actorUserId: string;
  readonly nextRole: UserRole;
  readonly expectedRole: UserRole;
}

export interface ChangeUserRoleResult {
  readonly changed: boolean;
  readonly user: AdminUserSummary;
}

interface CountRow {
  readonly total: string;
}

interface IdRow {
  readonly id: string;
}

interface RoleRow extends IdRow {
  readonly role: UserRole;
}

export class AdminUserServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'AdminUserServiceError';
  }
}

export class AdminUserService {
  async listUsers(input: AdminUserListInput): Promise<AdminUserListResult> {
    const values: unknown[] = [];
    const conditions: string[] = [];

    if (input.query) {
      values.push(`%${escapeLikePattern(input.query)}%`);
      const placeholder = `$${values.length}`;
      conditions.push(`(
        p.username ILIKE ${placeholder} ESCAPE E'\\\\'
        OR COALESCE(p.display_name, '') ILIKE ${placeholder} ESCAPE E'\\\\'
        OR u.email ILIKE ${placeholder} ESCAPE E'\\\\'
      )`);
    }

    if (input.role) {
      values.push(input.role);
      conditions.push(`p.role = $${values.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const [countResult, listResult] = await Promise.all([
      pool.query<CountRow>(
        `SELECT COUNT(*)::text AS total
         FROM users u
         JOIN profiles p ON p.id = u.id
         ${where}`,
        values
      ),
      pool.query<AdminUserSummary>(
        `SELECT u.id, p.username, p.display_name, u.email, u.email_verified,
                p.role, p.deck_count, u.created_at
         FROM users u
         JOIN profiles p ON p.id = u.id
         ${where}
         ORDER BY u.created_at DESC, u.id ASC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, input.limit, input.offset]
      ),
    ]);

    return {
      data: listResult.rows,
      total: Number.parseInt(countResult.rows[0]?.total ?? '0', 10),
    };
  }

  async changeRole(input: ChangeUserRoleInput): Promise<ChangeUserRoleResult> {
    const client = await pool.connect();
    let transactionOpen = false;

    try {
      await client.query('BEGIN');
      transactionOpen = true;

      // Lock the complete platform-admin set so two concurrent demotions cannot
      // both pass the final-admin check.
      const adminRows = await client.query<IdRow>(
        `SELECT id
         FROM profiles
         WHERE role = 'admin'
         ORDER BY id
         FOR UPDATE`
      );
      if (!adminRows.rows.some((row) => row.id === input.actorUserId)) {
        throw new AdminUserServiceError('AUTHORIZATION_STALE', '权限已变更，请重新登录', 403);
      }

      const targetResult = await client.query<RoleRow>(
        'SELECT id, role FROM profiles WHERE id = $1 FOR UPDATE',
        [input.targetUserId]
      );
      const target = targetResult.rows[0];
      if (!target) {
        throw new AdminUserServiceError('USER_NOT_FOUND', '用户不存在', 404);
      }

      if (target.role !== input.expectedRole) {
        throw new AdminUserServiceError(
          'ROLE_CONFLICT',
          '用户角色已被其他管理员修改，请刷新后重试',
          409
        );
      }

      if (target.role === input.nextRole) {
        const user = await readUserSummary(client, input.targetUserId);
        await client.query('COMMIT');
        transactionOpen = false;
        return { changed: false, user };
      }

      if (target.role === 'admin' && input.nextRole !== 'admin' && adminRows.rows.length === 1) {
        throw new AdminUserServiceError('LAST_ADMIN_REQUIRED', '不能降级最后一个平台管理员', 409);
      }

      await client.query('UPDATE profiles SET role = $1, updated_at = now() WHERE id = $2', [
        input.nextRole,
        input.targetUserId,
      ]);
      await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [input.targetUserId]);

      const user = await readUserSummary(client, input.targetUserId);
      await client.query('COMMIT');
      transactionOpen = false;
      return { changed: true, user };
    } catch (error) {
      if (transactionOpen) {
        await rollbackQuietly(client);
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

async function readUserSummary(
  client: Pick<PoolClient, 'query'>,
  userId: string
): Promise<AdminUserSummary> {
  const result = await client.query<AdminUserSummary>(
    `SELECT u.id, p.username, p.display_name, u.email, u.email_verified,
            p.role, p.deck_count, u.created_at
     FROM users u
     JOIN profiles p ON p.id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) {
    throw new AdminUserServiceError('USER_NOT_FOUND', '用户不存在', 404);
  }
  return user;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

async function rollbackQuietly(client: Pick<PoolClient, 'query'>): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original transaction error.
  }
}

export const adminUserService = new AdminUserService();
