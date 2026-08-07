import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  diffDeckPointTables,
  formatShanghaiEffectiveDateTime,
  shanghaiEffectiveDateTimeToInstant,
  toDeckPointTableRules,
  validateDeckPointTableEntries,
} from '../../src/domain/rules/deck-point-table';
import { calculateDeckPointTotal, getCardPoint } from '../../src/domain/rules/deck-construction';
import { revalidateRuntimeDeckPointSnapshot } from '../../src/server/services/deck-point-snapshot-validation';

const OLD_RULES = toDeckPointTableRules({
  version: '2026-04-03',
  pointLimit: 9,
  effectiveFrom: '2026-04-02T16:00:00.000Z',
  entries: [
    { baseCardCode: 'LL-bp2-001', points: 3 },
    { baseCardCode: 'PL!SP-bp2-024', points: 1 },
  ],
});

const NEW_RULES = toDeckPointTableRules({
  version: '2026-08-08',
  pointLimit: 9,
  effectiveFrom: '2026-08-07T16:00:00.000Z',
  entries: [
    { baseCardCode: 'LL-bp2-001', points: 5 },
    { baseCardCode: 'PL!N-pb1-011', points: 2 },
    { baseCardCode: 'PL!N-bp3-030', points: 1 },
    { baseCardCode: 'PL!N-bp4-030', points: 1 },
  ],
});

describe('versioned deck point table', () => {
  it('uses an unambiguous second-precision Asia/Shanghai effective boundary', () => {
    const instant = shanghaiEffectiveDateTimeToInstant('2026-08-08T00:00:00');
    expect(instant.toISOString()).toBe('2026-08-07T16:00:00.000Z');
    expect(formatShanghaiEffectiveDateTime(instant)).toBe('2026-08-08T00:00:00');
    expect(() => shanghaiEffectiveDateTimeToInstant('2026-02-30T00:00:00')).toThrow('生效时间非法');
    expect(() => shanghaiEffectiveDateTimeToInstant('2026-08-08T00:00')).toThrow(
      'YYYY-MM-DDTHH:mm:ss'
    );
  });

  it('validates unique known base codes and positive integer points', () => {
    const known = new Set(['PL!N-pb1-011']);
    expect(
      validateDeckPointTableEntries([{ baseCardCode: 'PL!N-pb1-011', points: 2 }], known)
    ).toMatchObject({ valid: true });
    expect(
      validateDeckPointTableEntries(
        [
          { baseCardCode: 'PL!N-pb1-011', points: 2 },
          { baseCardCode: 'PL!N-pb1-011', points: 1 },
          { baseCardCode: 'PL!N-bp1-011', points: 2 },
          { baseCardCode: 'PL!N-bp3-030', points: 0 },
        ],
        known
      ).errors
    ).toEqual([
      '基础编号重复: PL!N-pb1-011',
      '基础编号不存在或没有已发布卡牌: PL!N-bp1-011',
      '基础编号 PL!N-bp3-030 的点数必须是 1-99 的整数',
    ]);
  });

  it('normalizes entries by points descending and base code ascending for equal points', () => {
    const known = new Set(['PL!N-pb1-011', 'PL!N-bp3-030', 'LL-bp2-001']);
    expect(
      validateDeckPointTableEntries(
        [
          { baseCardCode: 'PL!N-pb1-011', points: 2 },
          { baseCardCode: 'PL!N-bp3-030', points: 5 },
          { baseCardCode: 'LL-bp2-001', points: 5 },
        ],
        known
      ).entries
    ).toEqual([
      { baseCardCode: 'LL-bp2-001', points: 5 },
      { baseCardCode: 'PL!N-bp3-030', points: 5 },
      { baseCardCode: 'PL!N-pb1-011', points: 2 },
    ]);
  });

  it('applies one point value to every rarity under the base code', () => {
    expect(getCardPoint('PL!N-pb1-011-P+', NEW_RULES)).toBe(2);
    expect(getCardPoint('PL!N-pb1-011-R', NEW_RULES)).toBe(2);
    expect(getCardPoint('PL!N-bp1-011-R', NEW_RULES)).toBe(0);
    expect(
      calculateDeckPointTotal(
        [
          { card_code: 'LL-bp2-001-R+', count: 1 },
          { card_code: 'PL!N-pb1-011-P+', count: 2 },
        ],
        NEW_RULES
      )
    ).toBe(9);
  });

  it('revalidates a locked runtime snapshot against the newly active table', () => {
    const review = revalidateRuntimeDeckPointSnapshot(
      {
        mainDeck: [{ cardCode: 'LL-bp2-001-R' }, { cardCode: 'LL-bp2-001-R+' }],
        energyDeck: [],
      } as never,
      { pointTableVersion: OLD_RULES.version, pointTotal: 6, pointLimit: 9 },
      { ...NEW_RULES, pointLimit: 9 }
    );

    expect(review).toEqual({
      valid: false,
      changed: true,
      facts: { pointTableVersion: '2026-08-08', pointTotal: 10, pointLimit: 9 },
    });
  });

  it('previews additions, removals and changed values without requiring the target to be published', () => {
    expect(diffDeckPointTables(OLD_RULES, NEW_RULES)).toEqual({
      pointLimitBefore: 9,
      pointLimitAfter: 9,
      entries: [
        { baseCardCode: 'LL-bp2-001', before: 3, after: 5 },
        { baseCardCode: 'PL!N-bp3-030', before: 0, after: 1 },
        { baseCardCode: 'PL!N-bp4-030', before: 0, after: 1 },
        { baseCardCode: 'PL!N-pb1-011', before: 0, after: 2 },
        { baseCardCode: 'PL!SP-bp2-024', before: 1, after: 0 },
      ],
    });
  });

  it('seeds the confirmed old/new tables and never substitutes bp1 for Mia pb1', () => {
    const sql = readFileSync('drizzle/0012_add_deck_point_tables.sql', 'utf8');
    expect(sql).toContain("'2026-04-03'");
    expect(sql).toContain("TIMESTAMPTZ '2026-04-02 16:00:00+00'");
    expect(sql).toContain("'2026-08-08'");
    expect(sql).toContain("TIMESTAMPTZ '2026-08-07 16:00:00+00'");
    expect(sql).toContain('"platformTimeZone":"Asia/Shanghai"');
    const entrySection = sql.match(
      /INSERT INTO "deck_point_table_entries"[\s\S]*?VALUES([\s\S]*?);--> statement-breakpoint/
    )?.[1];
    expect(entrySection).toBeTruthy();
    const readEntries = (tableId: string) =>
      [...(entrySection ?? '').matchAll(new RegExp(`\\('${tableId}', '([^']+)', (\\d+)\\)`, 'g'))]
        .map((match) => [match[1], Number(match[2])] as const)
        .sort(([left], [right]) => left.localeCompare(right, 'en'));

    expect(readEntries('11b9d4ab-7e88-4bf4-b72e-7ebdd236d40a')).toEqual([
      ['LL-bp2-001', 3],
      ['PL!HS-bp2-014', 2],
      ['PL!N-bp1-002', 2],
      ['PL!N-bp1-003', 4],
      ['PL!N-bp1-012', 3],
      ['PL!N-bp1-029', 1],
      ['PL!N-sd1-008', 2],
      ['PL!SP-bp1-005', 1],
      ['PL!SP-bp2-024', 1],
      ['PL!SP-pb1-014', 1],
      ['PL!SP-sd1-019', 1],
      ['PL!SP-sd1-020', 1],
    ]);
    const newEntries = readEntries('7a81104d-947d-46e6-89f5-80ee1124b174');
    expect(newEntries).toEqual([
      ['LL-bp2-001', 5],
      ['PL!HS-bp2-014', 2],
      ['PL!N-bp1-002', 2],
      ['PL!N-bp1-003', 4],
      ['PL!N-bp1-012', 3],
      ['PL!N-bp1-029', 1],
      ['PL!N-bp3-030', 1],
      ['PL!N-bp4-030', 1],
      ['PL!N-pb1-011', 2],
      ['PL!N-sd1-008', 2],
      ['PL!SP-bp1-005', 1],
      ['PL!SP-pb1-014', 1],
      ['PL!SP-sd1-019', 1],
      ['PL!SP-sd1-020', 1],
    ]);
    expect(newEntries).toContainEqual(['PL!N-pb1-011', 2]);
    expect(newEntries.some(([baseCardCode]) => baseCardCode === 'PL!N-bp1-011')).toBe(false);
    expect(newEntries.some(([baseCardCode]) => baseCardCode === 'PL!SP-bp2-024')).toBe(false);
  });

  it('backfills historical snapshot facts from the old table and the locked runtime deck', () => {
    const sql = readFileSync('drizzle/0013_add_deck_point_snapshot_facts.sql', 'utf8');
    expect(sql).toContain('jsonb_array_elements_text(snapshot."main_deck")');
    expect(sql).toContain("jsonb_array_elements(ticket.runtime_deck->'mainDeck')");
    expect(sql).toContain('"point_table_version" = \'2026-04-03\'');
  });

  it('migrates flexible administrator control without weakening the single-active index', () => {
    const sql = readFileSync('drizzle/0016_allow_deck_point_table_admin_control.sql', 'utf8');
    expect(sql).toContain("'MANUALLY_DISCARDED'");
    expect(sql).toContain("'TABLE_UPDATED'");
    expect(sql).toContain("'ACTIVATED_AS_REPLACEMENT'");
    expect(sql).toContain('ON DELETE cascade');
    expect(sql).toContain('OR "deck_point_tables"."lifecycle" = \'RETIRED\'');
    expect(sql).toContain('"retirement_reason" IS NOT NULL');

    const initialSql = readFileSync('drizzle/0012_add_deck_point_tables.sql', 'utf8');
    expect(initialSql).toContain('CREATE UNIQUE INDEX "uq_deck_point_tables_active"');
  });
});
