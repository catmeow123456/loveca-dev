import { getBaseCardCode } from '../../shared/utils/card-code.js';

export interface BladeHeartInheritanceItem {
  readonly effect: string;
  readonly heartColor?: string;
  readonly value?: number;
}

export interface BladeHeartInheritanceRecord {
  readonly card_code: string;
  readonly card_type: string;
  readonly blade_hearts?: readonly BladeHeartInheritanceItem[] | null;
}

function hasBladeHearts(record: BladeHeartInheritanceRecord): boolean {
  return Array.isArray(record.blade_hearts) && record.blade_hearts.length > 0;
}

function cloneBladeHearts(
  bladeHearts: readonly BladeHeartInheritanceItem[]
): BladeHeartInheritanceItem[] {
  return bladeHearts.map((item) => ({ ...item }));
}

export function inheritMissingBladeHeartsByBase<T extends BladeHeartInheritanceRecord>(
  records: readonly T[]
): T[] {
  const sourceByBaseAndType = new Map<string, readonly BladeHeartInheritanceItem[]>();

  for (const record of records) {
    if (!hasBladeHearts(record)) {
      continue;
    }

    const key = `${record.card_type}:${getBaseCardCode(record.card_code)}`;
    if (!sourceByBaseAndType.has(key)) {
      sourceByBaseAndType.set(key, record.blade_hearts!);
    }
  }

  return records.map((record): T => {
    if (hasBladeHearts(record)) {
      return record;
    }

    const key = `${record.card_type}:${getBaseCardCode(record.card_code)}`;
    const inherited = sourceByBaseAndType.get(key);
    if (!inherited || inherited.length === 0) {
      return record;
    }

    return {
      ...record,
      blade_hearts: cloneBladeHearts(inherited),
    } as T;
  });
}
