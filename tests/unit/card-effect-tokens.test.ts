import { describe, expect, it } from 'vitest';
import { parseCardEffectText } from '../../client/src/lib/cardEffectTokens';

describe('parseCardEffectText', () => {
  it('parses Loveca timing and modifier placeholders', () => {
    const parts = parseCardEffectText('【LIVE开始时】可以支付[E]：获得[紫ハート][ブレード]。');

    expect(parts).toEqual([
      {
        kind: 'ability',
        raw: '【LIVE开始时】',
        label: 'LIVE开始时',
      },
      { kind: 'text', text: '可以支付' },
      {
        kind: 'cost',
        raw: '[E]',
        label: 'E',
        icon: 'cost',
      },
      { kind: 'text', text: '：获得' },
      {
        kind: 'heart',
        raw: '[紫ハート]',
        label: '紫ハート',
        icon: 'heart_purple',
      },
      {
        kind: 'blade',
        raw: '[ブレード]',
        label: 'ブレード',
        icon: 'blade',
      },
      { kind: 'text', text: '。' },
    ]);
  });

  it('keeps unknown bracket text unchanged', () => {
    expect(parseCardEffectText('公开[Aqours]的LIVE卡。')).toEqual([
      { kind: 'text', text: '公开' },
      { kind: 'text', text: '[Aqours]' },
      { kind: 'text', text: '的LIVE卡。' },
    ]);
  });

  it('normalizes known typo variants without rewriting source text', () => {
    expect(parseCardEffectText('【自动】【1回合1 次】抽1张。')).toEqual([
      { kind: 'ability', raw: '【自动】', label: '自动' },
      { kind: 'limit', raw: '【1回合1 次】', label: '1回合1次' },
      { kind: 'text', text: '抽1张。' },
    ]);
  });
});
