import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../client/src/lib/apiClient';
import { changeAdminUserRole, listAdminUsers } from '../../client/src/lib/adminUserClient';

afterEach(() => vi.restoreAllMocks());

describe('admin user client', () => {
  it('requests one filtered server page without downloading the complete user list', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: [],
      total: 120,
      error: null,
    });

    await expect(
      listAdminUsers({ query: 'nico@example.com', role: 'season_admin', limit: 50, offset: 50 })
    ).resolves.toEqual({ users: [], total: 120 });

    expect(get).toHaveBeenCalledWith(
      '/api/admin/users?limit=50&offset=50&q=nico%40example.com&role=season_admin'
    );
  });

  it('sends the selected role with its optimistic concurrency guard', async () => {
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({
      data: {
        changed: true,
        user: { id: 'user-1', role: 'season_admin' },
      },
      error: null,
    });

    await changeAdminUserRole({
      userId: 'user/1',
      role: 'season_admin',
      expectedRole: 'user',
    });

    expect(put).toHaveBeenCalledWith('/api/admin/users/user%2F1/role', {
      role: 'season_admin',
      expectedRole: 'user',
    });
  });
});
