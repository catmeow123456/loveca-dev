export const DECK_POINT_TABLE_TIME_ZONE = 'Asia/Shanghai' as const;

export const DECK_POINT_TABLE_LIFECYCLES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'RETIRED'] as const;

export type DeckPointTableLifecycle = (typeof DECK_POINT_TABLE_LIFECYCLES)[number];

export interface DeckPointTableEntry {
  readonly baseCardCode: string;
  readonly points: number;
}

/**
 * A frozen rules snapshot consumed by deck validation. Callers must obtain this
 * value from the authoritative point-table resolver instead of relying on a
 * process-global mutable map.
 */
export interface DeckPointTableRules {
  readonly version: string;
  readonly pointLimit: number;
  readonly effectiveFrom: string;
  readonly entries: Readonly<Record<string, number>>;
}

export interface DeckPointValidationFacts {
  readonly pointTableVersion: string;
  readonly pointTotal: number;
  readonly pointLimit: number;
}

export interface DeckPointTableEntryChange {
  readonly baseCardCode: string;
  readonly before: number;
  readonly after: number;
}

export interface DeckPointTableDiff {
  readonly pointLimitBefore: number;
  readonly pointLimitAfter: number;
  readonly entries: readonly DeckPointTableEntryChange[];
}

export interface DeckPointTableValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly entries: readonly DeckPointTableEntry[];
}

const BASE_CARD_CODE_PATTERN = /^[A-Za-z!]+-(?:[A-Za-z]+\d*|PR|E)-\d{3}$/;

export function validateDeckPointTableEntries(
  entries: readonly DeckPointTableEntry[],
  knownBaseCardCodes?: ReadonlySet<string>
): DeckPointTableValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  const normalizedEntries: DeckPointTableEntry[] = [];

  for (const [index, entry] of entries.entries()) {
    const baseCardCode = entry.baseCardCode.trim().replace(/＋/g, '+');
    if (!BASE_CARD_CODE_PATTERN.test(baseCardCode)) {
      errors.push(`第 ${index + 1} 项基础编号格式非法: ${entry.baseCardCode}`);
      continue;
    }
    if (seen.has(baseCardCode)) {
      errors.push(`基础编号重复: ${baseCardCode}`);
      continue;
    }
    seen.add(baseCardCode);

    if (!Number.isSafeInteger(entry.points) || entry.points < 1 || entry.points > 99) {
      errors.push(`基础编号 ${baseCardCode} 的点数必须是 1-99 的整数`);
      continue;
    }
    if (knownBaseCardCodes && !knownBaseCardCodes.has(baseCardCode)) {
      errors.push(`基础编号不存在或没有已发布卡牌: ${baseCardCode}`);
      continue;
    }

    normalizedEntries.push({ baseCardCode, points: entry.points });
  }

  normalizedEntries.sort(
    (left, right) =>
      right.points - left.points || left.baseCardCode.localeCompare(right.baseCardCode, 'en')
  );
  return { valid: errors.length === 0, errors, entries: normalizedEntries };
}

export function toDeckPointTableRules(input: {
  readonly version: string;
  readonly pointLimit: number;
  readonly effectiveFrom: string;
  readonly entries: readonly DeckPointTableEntry[];
}): DeckPointTableRules {
  return Object.freeze({
    version: input.version,
    pointLimit: input.pointLimit,
    effectiveFrom: input.effectiveFrom,
    entries: Object.freeze(
      Object.fromEntries(input.entries.map((entry) => [entry.baseCardCode, entry.points]))
    ),
  });
}

export function diffDeckPointTables(
  before: Pick<DeckPointTableRules, 'pointLimit' | 'entries'>,
  after: Pick<DeckPointTableRules, 'pointLimit' | 'entries'>
): DeckPointTableDiff {
  const codes = new Set([...Object.keys(before.entries), ...Object.keys(after.entries)]);
  const entries = [...codes]
    .sort((left, right) => left.localeCompare(right, 'en'))
    .flatMap((baseCardCode) => {
      const beforePoints = before.entries[baseCardCode] ?? 0;
      const afterPoints = after.entries[baseCardCode] ?? 0;
      return beforePoints === afterPoints
        ? []
        : [{ baseCardCode, before: beforePoints, after: afterPoints }];
    });
  return {
    pointLimitBefore: before.pointLimit,
    pointLimitAfter: after.pointLimit,
    entries,
  };
}

/** Convert a second-precision Beijing wall-clock value to an unambiguous UTC instant. */
export function shanghaiEffectiveDateTimeToInstant(effectiveDateTime: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(effectiveDateTime)) {
    throw new Error('生效时间必须使用 YYYY-MM-DDTHH:mm:ss 格式');
  }
  const instant = new Date(`${effectiveDateTime}+08:00`);
  if (
    Number.isNaN(instant.getTime()) ||
    formatShanghaiEffectiveDateTime(instant) !== effectiveDateTime
  ) {
    throw new Error('生效时间非法');
  }
  return instant;
}

export function formatShanghaiEffectiveDateTime(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DECK_POINT_TABLE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}`;
}
