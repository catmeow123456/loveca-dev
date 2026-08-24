import { describe, expect, it } from 'vitest';
import {
  commonRuleConditionsToDefinition,
  definitionToCommonRuleConditions,
  describeRuleDefinition,
} from './deckClassifierRuleEditor';

describe('deck classifier common rule editor', () => {
  it('round-trips supported single-card, sum and forbidden conditions', () => {
    const definition = {
      includeAll: [{ baseCardCode: 'PL!-bp4-021', cardType: 'LIVE' as const, minCount: 2 }],
      countSums: [
        {
          baseCardCodes: ['PL!-bp3-001', 'PL!-bp3-002'],
          cardType: 'MEMBER' as const,
          minCount: 5,
        },
      ],
      forbidAny: [{ baseCardCode: 'PL!-bp1-999' }],
    };

    const common = definitionToCommonRuleConditions(definition);
    expect(common).not.toBeNull();
    expect(commonRuleConditionsToDefinition(common!)).toEqual(definition);
    expect(describeRuleDefinition(definition)).toEqual([
      'LIVE 卡 PL!-bp4-021 ≥ 2 张',
      'MEMBER 卡 PL!-bp3-001、PL!-bp3-002 合计 ≥ 5 张',
      '不得包含 任意类型 卡 PL!-bp1-999',
    ]);
  });

  it('falls back to JSON for conditions the common editor cannot preserve', () => {
    expect(
      definitionToCommonRuleConditions({ includeAny: [{ baseCardCode: 'PL!-bp4-021' }] })
    ).toBeNull();
    expect(
      definitionToCommonRuleConditions({
        forbidAny: [{ baseCardCode: 'PL!-bp4-021', minCount: 2 }],
      })
    ).toBeNull();
  });

  it('rejects incomplete or invalid common conditions before sending them', () => {
    expect(() =>
      commonRuleConditionsToDefinition([
        { kind: 'COUNT_SUM', cardType: '', cardCodes: 'A、B', minCount: '', maxCount: '' },
      ])
    ).toThrow('至少要填写');
  });
});
