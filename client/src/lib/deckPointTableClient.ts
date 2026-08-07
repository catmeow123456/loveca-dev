import type { DeckPointTableRules } from '@game/domain/rules/deck-point-table';
import { apiClient, toApiClientError } from '@/lib/apiClient';

export interface CurrentDeckPointTableEntryView {
  readonly baseCardCode: string;
  readonly points: number;
}

/** Public, player-readable projection returned by GET /api/deck-point-tables/current. */
export interface CurrentDeckPointTableView {
  readonly version: string;
  readonly displayName: string;
  readonly pointLimit: number;
  readonly effectiveFrom: string | null;
  readonly platformTimeZone: 'Asia/Shanghai';
  readonly entries: readonly CurrentDeckPointTableEntryView[];
}

const BUILT_IN_POINT_TABLES: readonly DeckPointTableRules[] = [
  createBuiltInRules({
    version: '2026-04-03',
    effectiveFrom: '2026-04-02T16:00:00.000Z',
    pointLimit: 9,
    entries: {
      'LL-bp2-001': 3,
      'PL!N-bp1-002': 2,
      'PL!N-bp1-003': 4,
      'PL!N-bp1-012': 3,
      'PL!N-bp1-029': 1,
      'PL!N-sd1-008': 2,
      'PL!HS-bp2-014': 2,
      'PL!SP-bp1-005': 1,
      'PL!SP-bp2-024': 1,
      'PL!SP-pb1-014': 1,
      'PL!SP-sd1-019': 1,
      'PL!SP-sd1-020': 1,
    },
  }),
  createBuiltInRules({
    version: '2026-08-08',
    effectiveFrom: '2026-08-07T16:00:00.000Z',
    pointLimit: 9,
    entries: {
      'LL-bp2-001': 5,
      'PL!N-bp1-002': 2,
      'PL!N-bp1-003': 4,
      'PL!N-bp1-012': 3,
      'PL!N-bp1-029': 1,
      'PL!N-bp3-030': 1,
      'PL!N-bp4-030': 1,
      'PL!N-pb1-011': 2,
      'PL!N-sd1-008': 2,
      'PL!HS-bp2-014': 2,
      'PL!SP-bp1-005': 1,
      'PL!SP-pb1-014': 1,
      'PL!SP-sd1-019': 1,
      'PL!SP-sd1-020': 1,
    },
  }),
];

function createBuiltInRules(input: DeckPointTableRules): DeckPointTableRules {
  return Object.freeze({
    ...input,
    entries: Object.freeze({ ...input.entries }),
  });
}

/**
 * Last-resort display rules for true offline use or an unavailable startup API.
 * Online save and match admission remain server-authoritative and never trust this snapshot.
 */
export function resolveBuiltInDeckPointTableRules(now: Date = new Date()): DeckPointTableRules {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error('PT限制表解析时间非法');
  }
  return (
    [...BUILT_IN_POINT_TABLES]
      .reverse()
      .find((table) => Date.parse(table.effectiveFrom) <= timestamp) ?? BUILT_IN_POINT_TABLES[0]
  );
}

export function getNextBuiltInDeckPointTableEffectiveAt(now: Date = new Date()): Date | null {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error('PT限制表解析时间非法');
  }
  const next = BUILT_IN_POINT_TABLES.find((table) => Date.parse(table.effectiveFrom) > timestamp);
  return next ? new Date(next.effectiveFrom) : null;
}

export function deckPointTableViewToRules(view: CurrentDeckPointTableView): DeckPointTableRules {
  if (!view.version.trim()) {
    throw new Error('服务端返回的PT限制表缺少版本');
  }
  if (!Number.isSafeInteger(view.pointLimit) || view.pointLimit < 1) {
    throw new Error('服务端返回的PT上限非法');
  }
  if (!view.effectiveFrom || !Number.isFinite(Date.parse(view.effectiveFrom))) {
    throw new Error('服务端返回的PT限制表生效时间非法');
  }

  const entries: Record<string, number> = {};
  for (const entry of view.entries) {
    const baseCardCode = entry.baseCardCode.trim();
    if (!baseCardCode || baseCardCode in entries) {
      throw new Error(`服务端返回的PT基础编号重复或为空: ${entry.baseCardCode}`);
    }
    if (!Number.isSafeInteger(entry.points) || entry.points < 1) {
      throw new Error(`服务端返回的PT点数非法: ${baseCardCode}`);
    }
    entries[baseCardCode] = entry.points;
  }

  return Object.freeze({
    version: view.version,
    pointLimit: view.pointLimit,
    effectiveFrom: view.effectiveFrom,
    entries: Object.freeze(entries),
  });
}

export async function fetchCurrentDeckPointTableRules(): Promise<DeckPointTableRules> {
  const response = await apiClient.get<CurrentDeckPointTableView>('/api/deck-point-tables/current');
  if (response.error || !response.data) {
    throw toApiClientError(response, '读取当前PT限制表失败');
  }
  return deckPointTableViewToRules(response.data);
}
