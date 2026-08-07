import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../client/src/lib/apiClient';
import {
  cancelAdminDeckPointTableSchedule,
  deleteAdminDeckPointTable,
  discardAdminDeckPointTable,
  publishAdminDeckPointTable,
  updateAdminDeckPointTable,
  type AdminDeckPointTable,
} from '../../client/src/lib/deckPointTableAdminClient';

const table = {
  id: 'table-1',
  version: 'v1',
  displayName: '测试表',
  lifecycle: 'SCHEDULED',
  pointLimit: 9,
  effectiveFrom: '2026-08-07T16:00:00.000Z',
  publishedAt: '2026-08-01T00:00:00.000Z',
  retirementReason: null,
  platformTimeZone: 'Asia/Shanghai',
  entries: [],
  revision: 3,
  createdBy: 'admin',
  updatedBy: 'admin',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
} satisfies AdminDeckPointTable;

afterEach(() => vi.restoreAllMocks());

describe('deck point table admin client', () => {
  it('updates any lifecycle table with a second-level Beijing effective datetime', async () => {
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: table, error: null });
    await updateAdminDeckPointTable(table.id, {
      version: 'v2',
      displayName: '新表',
      pointLimit: 9,
      effectiveDateTime: '2026-08-08T00:00:03',
      entries: [],
      expectedRevision: 3,
    });
    expect(put).toHaveBeenCalledWith('/api/admin/deck-point-tables/table-1', {
      version: 'v2',
      displayName: '新表',
      pointLimit: 9,
      effectiveDateTime: '2026-08-08T00:00:03',
      entries: [],
      expectedRevision: 3,
    });
  });

  it('publishes a scheduled table with effectiveDateTime rather than a date-only field', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: table, error: null });
    await publishAdminDeckPointTable(table.id, {
      mode: 'SCHEDULED',
      effectiveDateTime: '2026-08-08T00:00:03',
      expectedRevision: 3,
      expectedActiveTableId: 'active-1',
    });
    expect(post).toHaveBeenCalledWith('/api/admin/deck-point-tables/table-1/publish', {
      mode: 'SCHEDULED',
      effectiveDateTime: '2026-08-08T00:00:03',
      expectedRevision: 3,
      expectedActiveTableId: 'active-1',
    });
  });

  it('sends both revisions when discarding ACTIVE through an atomic replacement', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: table, error: null });
    await discardAdminDeckPointTable('active-1', {
      expectedRevision: 4,
      replacementTableId: 'table-1',
      replacementExpectedRevision: 3,
    });
    expect(post).toHaveBeenCalledWith('/api/admin/deck-point-tables/active-1/discard', {
      expectedRevision: 4,
      replacementTableId: 'table-1',
      replacementExpectedRevision: 3,
    });
  });

  it('sends expectedRevision in the RETIRED delete body', async () => {
    const remove = vi
      .spyOn(apiClient, 'delete')
      .mockResolvedValue({ data: { id: 'retired-1', deleted: true as const }, error: null });
    await deleteAdminDeckPointTable('retired-1', 7);
    expect(remove).toHaveBeenCalledWith('/api/admin/deck-point-tables/retired-1', {
      expectedRevision: 7,
    });
  });

  it('keeps the dedicated scheduled cancellation route and revision guard', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: table, error: null });
    await cancelAdminDeckPointTableSchedule(table.id, 3);
    expect(post).toHaveBeenCalledWith('/api/admin/deck-point-tables/table-1/cancel-schedule', {
      expectedRevision: 3,
    });
  });
});
