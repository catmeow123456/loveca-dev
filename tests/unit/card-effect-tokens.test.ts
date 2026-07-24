import { describe, expect, it } from 'vitest';
import {
  getUnknownCardEffectPlaceholders,
  parseCardEffectText,
} from '../../client/src/lib/cardEffectTokens';

describe('parseCardEffectText', () => {
  it('maps the fixed pink Heart token used by PL!-bp4-013 Excel text and target copy', () => {
    const texts = [
      '【LIVE开始时】可以将1张手牌放置入休息室：LIVE结束时为止，1名存在于自己的舞台的此成员以外的成员，获得[桃ハート]。',
      '请选择自己舞台上此成员以外的1名成员获得[桃ハート]。',
      '选择获得[桃ハート]的成员',
      '获得[桃ハート]',
    ];
    expect(texts.map(getUnknownCardEffectPlaceholders)).toEqual([[], [], [], []]);
    expect(
      texts.map((text) => parseCardEffectText(text).filter((part) => part.kind === 'heart').length)
    ).toEqual([1, 1, 1, 1]);
  });

  it('maps every BLADE token used by PL!-bp4-014 and PL!-bp4-024 Excel text', () => {
    const texts = [
      '【LIVE开始时】自己的LIVE中的LIVE卡，存在不持有【LIVE开始时】能力与【LIVE成功时】能力的卡片的场合，LIVE结束时为止，1名存在于自己的舞台的此成员以外的成员，获得[ブレード][ブレード]。',
      "【LIVE开始时】LIVE结束时为止，存在于自己的舞台的1名『μ's』的成员，获得[ブレード]。",
    ];
    expect(texts.map(getUnknownCardEffectPlaceholders)).toEqual([[], []]);
    expect(
      texts.map((text) => parseCardEffectText(text).filter((part) => part.kind === 'blade').length)
    ).toEqual([2, 1]);
  });

  it('accepts the bp1-007 and PR-028 Chinese effect texts without unknown tokens', () => {
    expect(getUnknownCardEffectPlaceholders('【起动】【1回合1次】[E][E]：抽1张卡。')).toEqual([]);
    expect(
      getUnknownCardEffectPlaceholders(
        '【LIVE成功时】自己的舞台中，存在持有的HEART数量比原本持有的HEART数量多的成员的场合，抽1张卡。'
      )
    ).toEqual([]);
    expect(
      getUnknownCardEffectPlaceholders(
        '【常时】存在于自己的舞台的成员中，中央区域的成员持有最高费用的场合，获得[黄ハート]。'
      )
    ).toEqual([]);
  });

  it('maps the public BP7 Chinese per-turn limit tokens', () => {
    expect(getUnknownCardEffectPlaceholders('【起动】【每回合1次】[E]：检视卡组顶4张。')).toEqual(
      []
    );
    expect(getUnknownCardEffectPlaceholders('【起动】【每回合2次】获得[BLADE][BLADE]。')).toEqual(
      []
    );
  });

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

  it('parses standardized and legacy modifier aliases used by effect definitions', () => {
    const parts = parseCardEffectText(
      '获得[BLADE][ALLBLADE][ALLブレード][桃ブレード][赤ブレード][黄ブレード][緑ブレード][青ブレード][紫ブレード][虹ハート][黄HEART][红HEART][蓝HEART][紫HEART][无色HEART]。'
    );

    expect(parts).toEqual([
      { kind: 'text', text: '获得' },
      { kind: 'blade', raw: '[BLADE]', label: 'BLADE', icon: 'blade' },
      { kind: 'blade', raw: '[ALLBLADE]', label: 'ALLBLADE', icon: 'heart_all' },
      { kind: 'blade', raw: '[ALLブレード]', label: 'ALLブレード', icon: 'heart_all' },
      { kind: 'blade', raw: '[桃ブレード]', label: '桃ブレード', icon: 'heart_pink' },
      { kind: 'blade', raw: '[赤ブレード]', label: '赤ブレード', icon: 'heart_red' },
      { kind: 'blade', raw: '[黄ブレード]', label: '黄ブレード', icon: 'heart_yellow' },
      { kind: 'blade', raw: '[緑ブレード]', label: '緑ブレード', icon: 'heart_green' },
      { kind: 'blade', raw: '[青ブレード]', label: '青ブレード', icon: 'heart_blue' },
      { kind: 'blade', raw: '[紫ブレード]', label: '紫ブレード', icon: 'heart_purple' },
      { kind: 'heart', raw: '[虹ハート]', label: '虹ハート', icon: 'heart_all' },
      { kind: 'heart', raw: '[黄HEART]', label: '黄HEART', icon: 'heart_yellow' },
      { kind: 'heart', raw: '[红HEART]', label: '红HEART', icon: 'heart_red' },
      { kind: 'heart', raw: '[蓝HEART]', label: '蓝HEART', icon: 'heart_blue' },
      { kind: 'heart', raw: '[紫HEART]', label: '紫HEART', icon: 'heart_purple' },
      { kind: 'heart', raw: '[无色HEART]', label: '无色HEART', icon: 'heart_gray' },
      { kind: 'text', text: '。' },
    ]);
  });

  it('parses the Chinese center slot token', () => {
    expect(parseCardEffectText('【登场】【中央】抽1张。')).toEqual([
      { kind: 'ability', raw: '【登场】', label: '登场' },
      { kind: 'slot', raw: '【中央】', label: '中央' },
      { kind: 'text', text: '抽1张。' },
    ]);
  });

  it('reports unknown placeholders for governance checks', () => {
    expect(
      getUnknownCardEffectPlaceholders('获得[BLADE][桃ハート]，但不要写[桃Heart]或[blade]。')
    ).toEqual(['[桃Heart]', '[blade]']);
  });
});
