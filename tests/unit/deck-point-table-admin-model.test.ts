import { describe, expect, it } from 'vitest';
import {
  buildDeckPointTableInput,
  formatBeijingDateTime,
  formatBeijingDateTimeLocal,
  groupDeckPointTables,
  makeCopyDraftDefaults,
  requireEffectiveDateTime,
  toDeckPointTableForm,
} from '../../client/src/components/admin/deck-point-table-model';
import type { AdminDeckPointTable } from '../../client/src/lib/deckPointTableAdminClient';

function table(
  id: string,
  lifecycle: AdminDeckPointTable['lifecycle'],
  overrides: Partial<AdminDeckPointTable> = {}
): AdminDeckPointTable {
  return {
    id,
    version: id,
    displayName: `版本 ${id}`,
    lifecycle,
    pointLimit: 9,
    effectiveFrom: lifecycle === 'DRAFT' ? null : '2026-04-02T16:00:00.000Z',
    publishedAt: lifecycle === 'DRAFT' ? null : '2026-04-01T00:00:00.000Z',
    retirementReason: lifecycle === 'RETIRED' ? 'REPLACED' : null,
    platformTimeZone: 'Asia/Shanghai',
    entries: [{ baseCardCode: 'PL!N-bp1-003', points: 4 }],
    revision: 1,
    createdBy: 'admin-1',
    updatedBy: 'admin-1',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('deck point table admin model', () => {
  it('groups active, scheduled, draft and historical tables without mixing ownership', () => {
    const active = table('2026-04-03', 'ACTIVE');
    const scheduled = table('2026-08-08', 'SCHEDULED');
    const olderDraft = table('draft-a', 'DRAFT', {
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const newerDraft = table('draft-b', 'DRAFT', {
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
    const history = table('legacy', 'RETIRED');

    const groups = groupDeckPointTables([olderDraft, history, scheduled, active, newerDraft]);

    expect(groups.active).toBe(active);
    expect(groups.scheduled).toBe(scheduled);
    expect(groups.drafts.map((item) => item.id)).toEqual(['draft-b', 'draft-a']);
    expect(groups.history).toEqual([history]);
  });

  it('normalizes the editable form to the authoritative draft payload', () => {
    const source = table('draft', 'DRAFT', {
      entries: [
        { baseCardCode: 'PL!N-pb1-011', points: 2 },
        { baseCardCode: 'PL!N-bp3-030', points: 1 },
      ],
    });
    const form = toDeckPointTableForm(source);

    expect(
      buildDeckPointTableInput({
        ...form,
        version: ' 2026-08-08 ',
        displayName: ' 8月8日PT限制表 ',
      })
    ).toEqual({
      version: '2026-08-08',
      displayName: '8月8日PT限制表',
      pointLimit: 9,
      entries: [
        { baseCardCode: 'PL!N-pb1-011', points: 2 },
        { baseCardCode: 'PL!N-bp3-030', points: 1 },
      ],
    });
  });

  it('rejects duplicate base codes and invalid integer point values before sending', () => {
    expect(() =>
      buildDeckPointTableInput({
        version: 'draft-v1',
        displayName: '草稿',
        pointLimit: '9',
        effectiveDateTime: '',
        entries: [
          { baseCardCode: 'PL!N-bp1-003', points: '4' },
          { baseCardCode: 'PL!N-bp1-003', points: '3' },
        ],
      })
    ).toThrow('基础编号重复：PL!N-bp1-003');

    expect(() =>
      buildDeckPointTableInput({
        version: 'draft-v1',
        displayName: '草稿',
        pointLimit: '9',
        effectiveDateTime: '',
        entries: [{ baseCardCode: 'PL!N-bp1-003', points: '1.5' }],
      })
    ).toThrow('PL!N-bp1-003 的点数必须是1-99的整数');
  });

  it('creates an explicit new identity and formats exact Beijing local timestamps', () => {
    const source = table('2026-04-03', 'ACTIVE', {
      version: '2026-04-03',
      displayName: '2026年4月PT限制表',
    });

    expect(makeCopyDraftDefaults(source)).toEqual({
      version: '2026-04-03-copy',
      displayName: '2026年4月PT限制表副本',
    });
    expect(formatBeijingDateTimeLocal('2026-08-07T16:00:03.000Z')).toBe('2026-08-08T00:00:03');
    expect(formatBeijingDateTime('2026-08-07T16:00:03.000Z')).toContain('00:00:03');
  });

  it('sorts entries by points descending then base code ascending for edit and payload', () => {
    const source = table('draft', 'DRAFT', {
      entries: [
        { baseCardCode: 'PL!N-bp3-030', points: 1 },
        { baseCardCode: 'LL-bp2-001', points: 5 },
        { baseCardCode: 'PL!N-bp1-002', points: 2 },
        { baseCardCode: 'PL!N-pb1-011', points: 2 },
      ],
    });

    const form = toDeckPointTableForm(source);
    expect(form.entries.map((entry) => entry.baseCardCode)).toEqual([
      'LL-bp2-001',
      'PL!N-bp1-002',
      'PL!N-pb1-011',
      'PL!N-bp3-030',
    ]);
    expect(buildDeckPointTableInput(form).entries.map((entry) => entry.baseCardCode)).toEqual([
      'LL-bp2-001',
      'PL!N-bp1-002',
      'PL!N-pb1-011',
      'PL!N-bp3-030',
    ]);
  });

  it('normalizes browser-zero-seconds and accepts exact Beijing datetime-local values', () => {
    const form = {
      ...toDeckPointTableForm(table('active', 'ACTIVE')),
      effectiveDateTime: '2026-08-08T00:00:03',
    };
    expect(requireEffectiveDateTime(form)).toBe('2026-08-08T00:00:03');
    expect(requireEffectiveDateTime({ ...form, effectiveDateTime: '2026-08-08T00:00' })).toBe(
      '2026-08-08T00:00:00'
    );
    expect(() => requireEffectiveDateTime({ ...form, effectiveDateTime: '2026-08-08' })).toThrow(
      '精确到秒'
    );
    expect(() =>
      requireEffectiveDateTime({ ...form, effectiveDateTime: '2026-02-30T00:00:00' })
    ).toThrow('不是有效');
  });
});
