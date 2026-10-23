import { describe, expect, it } from 'vitest';
import { normalizeDeckRecordPayload } from '../../src/domain/card-data/deck-record-utils';
import { toDeckPointTableRules } from '../../src/domain/rules/deck-point-table';
import { revalidateRuntimeDeckPointSnapshot } from '../../src/server/services/deck-point-snapshot-validation';
import { CardType } from '../../src/shared/types/enums';

const rules = toDeckPointTableRules({
  version: 'test',
  effectiveFrom: '2026-01-01T00:00:00Z',
  pointLimit: 9,
  entries: [{ baseCardCode: 'LL-bp1-000', points: 5 }],
});
function deck() {
  return {
    name: '测试构筑',
    main_deck: [
      ...Array.from({ length: 12 }, (_, i) => ({
        card_code: `LL-bp1-${String(i).padStart(3, '0')}-R`,
        count: 4,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        card_code: `PL!-bp1-${String(i).padStart(3, '0')}-R`,
        count: 4,
      })),
    ],
    energy_deck: [{ card_code: 'LL-E-000-SD', count: 12 }],
  };
}
const resolveType = (code: string) =>
  code.startsWith('LL-bp1-')
    ? CardType.MEMBER
    : code.startsWith('PL!-bp1-')
      ? CardType.LIVE
      : code.startsWith('LL-E-')
        ? CardType.ENERGY
        : undefined;

describe('casual PT construction rules', () => {
  it('admits the same over-PT construction only under unlimited rules, retaining its real points', () => {
    expect(normalizeDeckRecordPayload(deck(), resolveType, rules).validation.valid).toBe(false);
    expect(
      normalizeDeckRecordPayload(deck(), resolveType, rules, 'UNLIMITED').validation
    ).toMatchObject({ valid: true, stats: { pointTotal: 20 } });
  });
  it('retains counts, base-number copy limits, card types and published-card checks', () => {
    const incomplete = deck();
    incomplete.main_deck[0].count = 3;
    expect(
      normalizeDeckRecordPayload(incomplete, resolveType, rules, 'UNLIMITED').validation.valid
    ).toBe(false);
    const duplicates = deck();
    duplicates.main_deck[1].card_code = 'LL-bp1-000-P';
    expect(
      normalizeDeckRecordPayload(duplicates, resolveType, rules, 'UNLIMITED').validation.valid
    ).toBe(false);
    const unknown = deck();
    unknown.main_deck[0].card_code = 'UNKNOWN';
    expect(
      normalizeDeckRecordPayload(unknown, resolveType, rules, 'UNLIMITED').sourceErrors
    ).not.toEqual([]);
    const wrongType = deck();
    wrongType.energy_deck[0].card_code = 'LL-bp1-000-R';
    expect(
      normalizeDeckRecordPayload(wrongType, resolveType, rules, 'UNLIMITED').sourceErrors
    ).not.toEqual([]);
  });
  it('recalculates frozen snapshot points without applying a normal limit to entertainment', () => {
    const frozen = {
      mainDeck: ['LL-bp1-000-R', 'LL-bp1-000-P'].map((cardCode) => ({
        cardCode,
        name: '测试成员',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 1,
        hearts: [],
      })),
      energyDeck: [],
    };
    const previous = { pointTableVersion: 'old', pointTotal: 0, pointLimit: 9 };
    expect(revalidateRuntimeDeckPointSnapshot(frozen, previous, rules).valid).toBe(false);
    expect(revalidateRuntimeDeckPointSnapshot(frozen, previous, rules, 'UNLIMITED')).toMatchObject({
      valid: true,
      changed: true,
      facts: { pointTotal: 10 },
    });
  });
});
