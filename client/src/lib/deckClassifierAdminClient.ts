import type {
  DeckClassificationRunView,
  DeckClassifierArchetypeView,
  DeckClassifierDisplayMode,
  DeckClassifierOverviewView,
  DeckClassifierPreviewView,
  DeckClassifierRuleDefinitionView,
  DeckClassifierRuleView,
  DeckClassifierTemplateCardView,
  DeckClassifierTemplateView,
  DeckEnvironmentSection,
} from '@game/online/deck-classifier-types';
import { apiClient } from '@/lib/apiClient';

async function requireData<T>(
  request: Promise<{ data: T | null; error: { message: string } | null }>,
  fallback: string
): Promise<T> {
  const response = await request;
  if (!response.data) throw new Error(response.error?.message ?? fallback);
  return response.data;
}

export interface DeckClassifierArchetypeCreatePayload {
  readonly expectedDraftRevision: number;
  readonly archetypeKey: string;
  readonly name: string;
  readonly groupName: string;
  readonly description: string;
  readonly color: string;
  readonly representativeCardCode: string | null;
  readonly sortOrder: number;
  readonly reason: string;
}

export interface DeckClassifierRulePayload {
  readonly expectedDraftRevision: number;
  readonly archetypeId: string;
  readonly name: string;
  readonly priority: number;
  readonly definition: DeckClassifierRuleDefinitionView;
  readonly enabled: boolean;
  readonly reason: string;
}

export const fetchDeckClassifierOverview = () =>
  requireData<DeckClassifierOverviewView>(
    apiClient.get('/api/admin/deck-classifier/overview'),
    '读取卡组分类管理数据失败'
  );

export const fetchDeckClassificationRun = (runId: string) =>
  requireData<DeckClassificationRunView>(
    apiClient.get(`/api/admin/deck-classifier/runs/${runId}`),
    '读取卡组重分类任务状态失败'
  );

export async function waitForDeckClassificationRun(
  initialRun: DeckClassificationRunView,
  options: {
    readonly pollIntervalMs?: number;
    readonly timeoutMs?: number;
    readonly readRun?: (runId: string) => Promise<DeckClassificationRunView>;
  } = {}
): Promise<DeckClassificationRunView | null> {
  let current = initialRun;
  const readRun = options.readRun ?? fetchDeckClassificationRun;
  const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 500);
  const deadline = Date.now() + Math.max(0, options.timeoutMs ?? 30_000);
  while (current.status === 'QUEUED' || current.status === 'RUNNING') {
    if (Date.now() >= deadline) return null;
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    current = await readRun(current.id);
  }
  return current;
}

export const updateDeckClassifierDisplaySettings = (payload: {
  readonly displayMode: Exclude<DeckClassifierDisplayMode, 'HIDDEN'>;
  readonly visibleSections: readonly DeckEnvironmentSection[];
  readonly topRankedPlayerCount: number;
  readonly reason: string;
}) =>
  requireData<{
    readonly displayMode: DeckClassifierDisplayMode;
    readonly visibleSections: readonly DeckEnvironmentSection[];
    readonly topRankedPlayerCount: number;
  }>(apiClient.put('/api/admin/deck-classifier/settings', payload), '保存玩家展示设置失败');

export const createDeckClassifierArchetype = (payload: DeckClassifierArchetypeCreatePayload) =>
  requireData<DeckClassifierArchetypeView>(
    apiClient.post('/api/admin/deck-classifier/archetypes', payload),
    '创建卡组分类失败'
  );

export const updateDeckClassifierArchetype = (
  archetypeId: string,
  payload: {
    readonly expectedDraftRevision: number;
    readonly name: string;
    readonly groupName: string;
    readonly description: string;
    readonly sortOrder: number;
    readonly reason: string;
  }
) =>
  requireData<DeckClassifierArchetypeView>(
    apiClient.put(`/api/admin/deck-classifier/archetypes/${archetypeId}`, payload),
    '更新卡组分类失败'
  );

export const updateDeckClassifierArchetypeDisplay = (
  archetypeId: string,
  payload: {
    readonly color: string;
    readonly representativeCardCode: string | null;
    readonly reason: string;
  }
) =>
  requireData<DeckClassifierArchetypeView>(
    apiClient.put(`/api/admin/deck-classifier/archetypes/${archetypeId}/display`, payload),
    '更新卡组分类展示设置失败'
  );

export const archiveDeckClassifierArchetype = (
  archetypeId: string,
  expectedDraftRevision: number,
  reason: string
) =>
  requireData<{ archived: boolean }>(
    apiClient.post(`/api/admin/deck-classifier/archetypes/${archetypeId}/archive`, {
      expectedDraftRevision,
      reason,
    }),
    '归档卡组分类失败'
  );

export const importDeckClassifierTemplateFromMatch = (payload: {
  readonly expectedDraftRevision: number;
  readonly archetypeId: string;
  readonly matchId: string;
  readonly seat: 'FIRST' | 'SECOND';
  readonly name: string;
  readonly sourceNote: string;
  readonly reason: string;
}) =>
  requireData<DeckClassifierTemplateView>(
    apiClient.post('/api/admin/deck-classifier/templates/from-match', payload),
    '从排位对局导入样板失败'
  );

export const createDeckClassifierTemplateFromReview = (payload: {
  readonly expectedDraftRevision: number;
  readonly archetypeId: string;
  readonly deckFingerprint: string;
  readonly name: string;
  readonly sourceNote: string;
  readonly reason: string;
}) =>
  requireData<DeckClassifierTemplateView>(
    apiClient.post('/api/admin/deck-classifier/templates/from-review', payload),
    '从待处理队列加入样板失败'
  );

export const updateDeckClassifierTemplate = (
  templateId: string,
  payload: {
    readonly expectedDraftRevision: number;
    readonly archetypeId: string;
    readonly name: string;
    readonly cards: readonly DeckClassifierTemplateCardView[];
    readonly sourceNote: string;
    readonly enabled: boolean;
    readonly reason: string;
  }
) =>
  requireData<DeckClassifierTemplateView>(
    apiClient.put(`/api/admin/deck-classifier/templates/${templateId}`, payload),
    '更新卡组样板失败'
  );

export const deleteDeckClassifierTemplate = (
  templateId: string,
  expectedDraftRevision: number,
  reason: string
) =>
  requireData<{ deleted: boolean }>(
    apiClient.delete(`/api/admin/deck-classifier/templates/${templateId}`, {
      expectedDraftRevision,
      reason,
    }),
    '删除卡组样板失败'
  );

export const createDeckClassifierRule = (payload: DeckClassifierRulePayload) =>
  requireData<DeckClassifierRuleView>(
    apiClient.post('/api/admin/deck-classifier/rules', payload),
    '创建卡组识别规则失败'
  );

export const updateDeckClassifierRule = (ruleId: string, payload: DeckClassifierRulePayload) =>
  requireData<DeckClassifierRuleView>(
    apiClient.put(`/api/admin/deck-classifier/rules/${ruleId}`, payload),
    '更新卡组识别规则失败'
  );

export const deleteDeckClassifierRule = (
  ruleId: string,
  expectedDraftRevision: number,
  reason: string
) =>
  requireData<{ deleted: boolean }>(
    apiClient.delete(`/api/admin/deck-classifier/rules/${ruleId}`, {
      expectedDraftRevision,
      reason,
    }),
    '删除卡组识别规则失败'
  );

export const previewDeckClassifierRelease = (expectedDraftRevision: number) =>
  requireData<DeckClassifierPreviewView>(
    apiClient.post('/api/admin/deck-classifier/preview', { expectedDraftRevision }),
    '生成分类预览失败'
  );

export const publishDeckClassifierRelease = (
  expectedDraftRevision: number,
  reason: string,
  idempotencyKey = createIdempotencyKey('publish')
) =>
  requireData<{
    readonly release: DeckClassifierOverviewView['releases'][number];
    readonly run: DeckClassificationRunView;
  }>(
    apiClient.post('/api/admin/deck-classifier/releases', {
      expectedDraftRevision,
      reason,
      idempotencyKey,
    }),
    '发布卡组分类版本失败'
  );

export const reclassifyDecks = (
  seasonId: string | null,
  reason: string,
  idempotencyKey = createIdempotencyKey('reclassify')
) =>
  requireData<DeckClassificationRunView>(
    apiClient.post('/api/admin/deck-classifier/runs', {
      seasonId,
      reason,
      idempotencyKey,
    }),
    '创建重分类任务失败'
  );

export const setDeckClassificationOverride = (payload: {
  readonly deckFingerprint: string;
  readonly targetStatus: 'CLASSIFIED' | 'UNKNOWN' | 'EXCLUDED';
  readonly archetypeId: string | null;
  readonly appliesToFutureReleases: boolean;
  readonly reason: string;
  readonly idempotencyKey?: string;
}) =>
  requireData<DeckClassificationRunView>(
    apiClient.post('/api/admin/deck-classifier/overrides', {
      ...payload,
      idempotencyKey: payload.idempotencyKey ?? createIdempotencyKey('override'),
    }),
    '保存人工分类失败'
  );

export const revokeDeckClassificationOverride = (
  overrideId: string,
  reason: string,
  idempotencyKey = createIdempotencyKey('revoke')
) =>
  requireData<DeckClassificationRunView>(
    apiClient.post(`/api/admin/deck-classifier/overrides/${overrideId}/revoke`, {
      reason,
      idempotencyKey,
    }),
    '撤销人工分类失败'
  );

function createIdempotencyKey(prefix: string): string {
  return `deck-classifier:${prefix}:${crypto.randomUUID()}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
