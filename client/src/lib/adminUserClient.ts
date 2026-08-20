import type { UserRole } from '@game/shared/auth/permissions';
import { apiClient, toApiClientError } from './apiClient';

export interface AdminUserSummary {
  readonly id: string;
  readonly username: string;
  readonly display_name: string | null;
  readonly email: string;
  readonly email_verified: boolean;
  readonly role: UserRole;
  readonly deck_count: number;
  readonly created_at: string;
}

export interface AdminUserPage {
  readonly users: readonly AdminUserSummary[];
  readonly total: number;
}

export interface ChangeAdminUserRoleResult {
  readonly changed: boolean;
  readonly user: AdminUserSummary;
}

export async function listAdminUsers(input: {
  readonly query?: string;
  readonly role?: UserRole;
  readonly limit: number;
  readonly offset: number;
}): Promise<AdminUserPage> {
  const params = new URLSearchParams({
    limit: String(input.limit),
    offset: String(input.offset),
  });
  if (input.query) params.set('q', input.query);
  if (input.role) params.set('role', input.role);

  const response = await apiClient.get<readonly AdminUserSummary[]>(
    `/api/admin/users?${params.toString()}`
  );
  if (!response.data) {
    throw toApiClientError(response, '读取用户列表失败');
  }
  return { users: response.data, total: response.total ?? 0 };
}

export async function changeAdminUserRole(input: {
  readonly userId: string;
  readonly role: UserRole;
  readonly expectedRole: UserRole;
}): Promise<ChangeAdminUserRoleResult> {
  const response = await apiClient.put<ChangeAdminUserRoleResult>(
    `/api/admin/users/${encodeURIComponent(input.userId)}/role`,
    {
      role: input.role,
      expectedRole: input.expectedRole,
    }
  );
  if (!response.data) {
    throw toApiClientError(response, '修改用户角色失败');
  }
  return response.data;
}
