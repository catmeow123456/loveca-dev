import { describe, expect, it } from 'vitest';
import {
  assertRuleConditionsInCatalog,
  assertTemplateCardsInCatalog,
  buildDeckClassifierCardCatalog,
} from '../../src/server/services/deck-classifier-card-catalog';

describe('deck classifier authoritative card catalog', () => {
  const catalog = buildDeckClassifierCardCatalog([
    { card_code: 'PL!N-bp1-001-P', card_type: 'MEMBER' },
    { card_code: 'PL!N-bp1-001-SEC', card_type: 'MEMBER' },
    { card_code: 'PL!N-bp1-101-L', card_type: 'LIVE' },
  ]);

  it('collapses rarity variants and accepts matching template and rule references', () => {
    expect(catalog.get('PL!N-bp1-001')).toBe('MEMBER');
    expect(() =>
      assertTemplateCardsInCatalog(
        [
          { baseCardCode: 'PL!N-bp1-001', cardType: 'MEMBER', count: 4 },
          { baseCardCode: 'PL!N-bp1-101', cardType: 'LIVE', count: 4 },
        ],
        catalog,
        '测试样板'
      )
    ).not.toThrow();
    expect(() =>
      assertRuleConditionsInCatalog(
        {
          includeAll: [{ baseCardCode: 'PL!N-bp1-001', cardType: 'MEMBER', minCount: 2 }],
          countSums: [{ baseCardCodes: ['PL!N-bp1-101'], cardType: 'LIVE', minCount: 2 }],
        },
        catalog,
        '测试规则'
      )
    ).not.toThrow();
  });

  it('rejects missing card codes and authoritative type mismatches', () => {
    expect(() =>
      assertTemplateCardsInCatalog(
        [{ baseCardCode: 'PL!N-bp9-999', cardType: 'MEMBER', count: 4 }],
        catalog,
        '测试样板'
      )
    ).toThrow('不存在于卡牌目录');
    expect(() =>
      assertTemplateCardsInCatalog(
        [{ baseCardCode: 'PL!N-bp1-101', cardType: 'MEMBER', count: 4 }],
        catalog,
        '测试样板'
      )
    ).toThrow('填写为 MEMBER，卡牌目录为 LIVE');
    expect(() =>
      assertRuleConditionsInCatalog(
        {
          includeAny: [{ baseCardCode: 'PL!N-bp1-001', cardType: 'LIVE' }],
        },
        catalog,
        '测试规则'
      )
    ).toThrow('填写为 LIVE，卡牌目录为 MEMBER');
  });

  it('rejects an internally inconsistent authoritative catalog', () => {
    expect(() =>
      buildDeckClassifierCardCatalog([
        { card_code: 'PL!N-bp1-001-P', card_type: 'MEMBER' },
        { card_code: 'PL!N-bp1-001-L', card_type: 'LIVE' },
      ])
    ).toThrow('同时存在 MEMBER 与 LIVE 类型');
  });
});
