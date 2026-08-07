import { apiClient, toApiClientError } from '@/lib/apiClient';

export type DeckPointTableLifecycle = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'RETIRED';

export interface DeckPointTableEntry {
  baseCardCode: string;
  points: number;
}

export interface DeckPointTableEntryView extends DeckPointTableEntry {
  cardCode?: string;
  cardNameCn?: string;
  cardNameJp?: string;
  cardType?: string;
  cost?: number;
  score?: number;
}

export interface AdminDeckPointTable {
  id: string;
  version: string;
  displayName: string;
  lifecycle: DeckPointTableLifecycle;
  pointLimit: number;
  effectiveFrom: string | null;
  publishedAt: string | null;
  retirementReason: 'REPLACED' | 'SCHEDULE_CANCELLED' | 'MANUALLY_DISCARDED' | null;
  platformTimeZone: 'Asia/Shanghai';
  entries: readonly DeckPointTableEntryView[];
  revision: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeckPointTableDraftInput {
  version: string;
  displayName: string;
  pointLimit: number;
  entries: readonly DeckPointTableEntry[];
}

export interface DeckPointTableUpdateInput extends DeckPointTableDraftInput {
  effectiveDateTime?: string;
  expectedRevision: number;
}

export interface DeckPointTableDiffEntry {
  baseCardCode: string;
  before: number;
  after: number;
}

export interface DeckPointTableDiffPreview {
  activeTable: Pick<AdminDeckPointTable, 'id' | 'version' | 'revision'>;
  before: Pick<AdminDeckPointTable, 'id' | 'version' | 'displayName'>;
  after: Pick<AdminDeckPointTable, 'id' | 'version' | 'displayName'>;
  diff: {
    pointLimitBefore: number;
    pointLimitAfter: number;
    entries: readonly DeckPointTableDiffEntry[];
  };
}

async function requireData<T>(
  request: Promise<{
    data: T | null;
    error: { code: string; message: string } | null;
    status?: number;
    retryAfterMs?: number;
  }>,
  fallbackMessage: string
): Promise<T> {
  const response = await request;
  if (!response.data) {
    throw toApiClientError(response, fallbackMessage);
  }
  return response.data;
}

const ADMIN_BASE_PATH = '/api/admin/deck-point-tables';

export const fetchAdminDeckPointTables = () =>
  requireData<AdminDeckPointTable[]>(
    apiClient.get<AdminDeckPointTable[]>(ADMIN_BASE_PATH),
    '读取PT限制表失败'
  );

export const fetchAdminDeckPointTable = (tableId: string) =>
  requireData<AdminDeckPointTable>(
    apiClient.get<AdminDeckPointTable>(`${ADMIN_BASE_PATH}/${encodeURIComponent(tableId)}`),
    '读取PT限制表详情失败'
  );

export const createAdminDeckPointTableDraft = (input: DeckPointTableDraftInput) =>
  requireData<AdminDeckPointTable>(
    apiClient.post<AdminDeckPointTable>(ADMIN_BASE_PATH, input),
    '创建PT限制表草稿失败'
  );

export const updateAdminDeckPointTable = (tableId: string, input: DeckPointTableUpdateInput) =>
  requireData<AdminDeckPointTable>(
    apiClient.put<AdminDeckPointTable>(`${ADMIN_BASE_PATH}/${encodeURIComponent(tableId)}`, input),
    '保存PT限制表失败'
  );

export const previewAdminDeckPointTableDiff = (tableId: string, compareToId?: string) =>
  requireData<DeckPointTableDiffPreview>(
    apiClient.post<DeckPointTableDiffPreview>(
      `${ADMIN_BASE_PATH}/${encodeURIComponent(tableId)}/diff`,
      compareToId ? { compareToId } : {}
    ),
    '生成PT限制表差异失败'
  );

export const publishAdminDeckPointTable = (
  tableId: string,
  input:
    | {
        mode: 'IMMEDIATE';
        expectedRevision: number;
        expectedActiveTableId: string;
      }
    | {
        mode: 'SCHEDULED';
        effectiveDateTime: string;
        expectedRevision: number;
        expectedActiveTableId: string;
      }
) =>
  requireData<AdminDeckPointTable>(
    apiClient.post<AdminDeckPointTable>(
      `${ADMIN_BASE_PATH}/${encodeURIComponent(tableId)}/publish`,
      input
    ),
    '发布PT限制表失败'
  );

export const discardAdminDeckPointTable = (
  tableId: string,
  input: {
    expectedRevision: number;
    replacementTableId?: string;
    replacementExpectedRevision?: number;
  }
) =>
  requireData<AdminDeckPointTable>(
    apiClient.post<AdminDeckPointTable>(
      `${ADMIN_BASE_PATH}/${encodeURIComponent(tableId)}/discard`,
      input
    ),
    '废弃PT限制表失败'
  );

export const cancelAdminDeckPointTableSchedule = (tableId: string, expectedRevision: number) =>
  requireData<AdminDeckPointTable>(
    apiClient.post<AdminDeckPointTable>(
      `${ADMIN_BASE_PATH}/${encodeURIComponent(tableId)}/cancel-schedule`,
      { expectedRevision }
    ),
    '取消PT限制表排期失败'
  );

export const deleteAdminDeckPointTable = (tableId: string, expectedRevision: number) =>
  requireData<{ id: string; deleted: true }>(
    apiClient.delete<{ id: string; deleted: true }>(
      `${ADMIN_BASE_PATH}/${encodeURIComponent(tableId)}`,
      { expectedRevision }
    ),
    '删除PT限制表失败'
  );

export const copyAdminDeckPointTableToDraft = (
  sourceTableId: string,
  input: { version: string; displayName: string }
) =>
  requireData<AdminDeckPointTable>(
    apiClient.post<AdminDeckPointTable>(
      `${ADMIN_BASE_PATH}/${encodeURIComponent(sourceTableId)}/rollback-draft`,
      input
    ),
    '复制PT限制表为草稿失败'
  );
