import type {
  AdminDeckPointTable,
  DeckPointTableDraftInput,
  DeckPointTableEntry,
} from '@/lib/deckPointTableAdminClient';

export interface DeckPointTableGroups {
  active: AdminDeckPointTable | null;
  scheduled: AdminDeckPointTable | null;
  drafts: AdminDeckPointTable[];
  history: AdminDeckPointTable[];
}

export interface DeckPointTableForm {
  version: string;
  displayName: string;
  pointLimit: string;
  effectiveDateTime: string;
  entries: Array<{ baseCardCode: string; points: string }>;
}

export function groupDeckPointTables(tables: readonly AdminDeckPointTable[]): DeckPointTableGroups {
  const byUpdatedAtDesc = (left: AdminDeckPointTable, right: AdminDeckPointTable) =>
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  const byEffectiveAtDesc = (left: AdminDeckPointTable, right: AdminDeckPointTable) =>
    Date.parse(right.effectiveFrom ?? right.updatedAt) -
    Date.parse(left.effectiveFrom ?? left.updatedAt);

  return {
    active: tables.find((table) => table.lifecycle === 'ACTIVE') ?? null,
    scheduled: tables.find((table) => table.lifecycle === 'SCHEDULED') ?? null,
    drafts: tables.filter((table) => table.lifecycle === 'DRAFT').sort(byUpdatedAtDesc),
    history: tables.filter((table) => table.lifecycle === 'RETIRED').sort(byEffectiveAtDesc),
  };
}

export function sortDeckPointTableEntries<T extends { baseCardCode: string; points: number }>(
  entries: readonly T[]
): T[] {
  return [...entries].sort(
    (left, right) =>
      right.points - left.points || left.baseCardCode.localeCompare(right.baseCardCode, 'en')
  );
}

export function toDeckPointTableForm(table: AdminDeckPointTable): DeckPointTableForm {
  return {
    version: table.version,
    displayName: table.displayName,
    pointLimit: String(table.pointLimit),
    effectiveDateTime: formatBeijingDateTimeLocal(table.effectiveFrom),
    entries: sortDeckPointTableEntries(table.entries).map((entry) => ({
      baseCardCode: entry.baseCardCode,
      points: String(entry.points),
    })),
  };
}

export function buildDeckPointTableInput(form: DeckPointTableForm): DeckPointTableDraftInput {
  const version = form.version.trim();
  const displayName = form.displayName.trim();
  const pointLimit = Number(form.pointLimit);
  if (!version) throw new Error('请填写版本号');
  if (!displayName) throw new Error('请填写显示名称');
  if (!Number.isSafeInteger(pointLimit) || pointLimit < 1 || pointLimit > 99) {
    throw new Error('卡组PT上限必须是1-99的整数');
  }

  const seen = new Set<string>();
  const entries: DeckPointTableEntry[] = form.entries.map((entry, index) => {
    const baseCardCode = entry.baseCardCode.trim().replace(/＋/g, '+');
    const points = Number(entry.points);
    if (!baseCardCode) throw new Error(`第 ${index + 1} 项未填写基础编号`);
    if (seen.has(baseCardCode)) throw new Error(`基础编号重复：${baseCardCode}`);
    if (!Number.isSafeInteger(points) || points < 1 || points > 99) {
      throw new Error(`${baseCardCode} 的点数必须是1-99的整数`);
    }
    seen.add(baseCardCode);
    return { baseCardCode, points };
  });

  return {
    version,
    displayName,
    pointLimit,
    entries: sortDeckPointTableEntries(entries),
  };
}

export function requireEffectiveDateTime(form: DeckPointTableForm): string {
  const rawValue = form.effectiveDateTime.trim();
  const value = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rawValue) ? `${rawValue}:00` : rawValue;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    throw new Error('请填写精确到秒的北京时间');
  }
  const instant = new Date(`${value}+08:00`);
  if (
    !Number.isFinite(instant.getTime()) ||
    formatBeijingDateTimeLocal(instant.toISOString()) !== value
  ) {
    throw new Error('生效时间不是有效的北京时间');
  }
  return value;
}

export function makeCopyDraftDefaults(source: AdminDeckPointTable): {
  version: string;
  displayName: string;
} {
  return {
    version: `${source.version}-copy`,
    displayName: `${source.displayName}副本`,
  };
}

export function formatBeijingDateTime(value: string | null): string {
  if (!value) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function formatBeijingDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}
