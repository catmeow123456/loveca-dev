/**
 * card-code 工具函数单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeCardCode,
  validateCardCode,
  getBaseCardCode,
  parseCardCode,
} from '../../src/shared/utils/card-code';

describe('normalizeCardCode', () => {
  it('将全角＋替换为半角+', () => {
    expect(normalizeCardCode('LL-bp1-001-R＋')).toBe('LL-bp1-001-R+');
    expect(normalizeCardCode('PL!-PR-010-PR＋')).toBe('PL!-PR-010-PR+');
  });

  it('多个全角＋都替换', () => {
    expect(normalizeCardCode('X＋Y＋Z')).toBe('X+Y+Z');
  });

  it('已经是半角+的不变', () => {
    expect(normalizeCardCode('LL-bp1-001-R+')).toBe('LL-bp1-001-R+');
  });

  it('无+的不变', () => {
    expect(normalizeCardCode('PL!-sd1-001-SD')).toBe('PL!-sd1-001-SD');
  });

  it('修复非标准稀有度 PR2 → PR+', () => {
    expect(normalizeCardCode('PL!S-PR-034-PR2')).toBe('PL!S-PR-034-PR+');
  });

  it('修复非标准稀有度 PRproteinbar → PR', () => {
    expect(normalizeCardCode('PL!N-bp1-014-PRproteinbar')).toBe('PL!N-bp1-014-PR');
  });

  it('修复非标准稀有度 PRLoveLive!Days → PR', () => {
    expect(normalizeCardCode('LL-PR-007-PRLoveLive!Days')).toBe('LL-PR-007-PR');
  });

  it('组合修复：全角＋ + 非标准稀有度', () => {
    // 只有全角＋的情况，稀有度标准化不应误触发
    expect(normalizeCardCode('LL-bp1-001-R＋')).toBe('LL-bp1-001-R+');
  });
});

describe('parseCardCode', () => {
  it('正确解析 4 段 card_code', () => {
    expect(parseCardCode('PL!SP-bp2-009-R+')).toEqual({
      prefix: 'PL!SP',
      product: 'bp2',
      seq: '009',
      rarity: 'R+',
    });
  });

  it('正确解析能量卡', () => {
    expect(parseCardCode('LL-E-001-SD')).toEqual({
      prefix: 'LL',
      product: 'E',
      seq: '001',
      rarity: 'SD',
    });
  });

  it('段数不为4返回null', () => {
    expect(parseCardCode('LL-bp1-001')).toBeNull();
    expect(parseCardCode('LL-bp1-001-R+-extra')).toBeNull();
    expect(parseCardCode('invalid')).toBeNull();
  });
});

describe('validateCardCode', () => {
  it('合法的 card_code 通过验证', () => {
    const cases = [
      'PL!-sd1-001-SD',
      'PL!SP-bp2-009-R+',
      'LL-E-001-SD',
      'LL-bp1-001-R+',
      'PL!N-bp3-032-PE+',
      'PL!HS-sd1-001-SD',
      'PYHN-bp1-001-N',
      'PL!S-PR-001-PR',
      'PL!-bp3-004-P+',
      'LL-bp4-001-SEC+',
    ];
    for (const code of cases) {
      const result = validateCardCode(code);
      expect(
        result.valid,
        `Expected "${code}" to be valid, got errors: ${result.errors.join(', ')}`
      ).toBe(true);
    }
  });

  it('含全角＋不通过', () => {
    const result = validateCardCode('LL-bp1-001-R＋');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('全角'))).toBe(true);
  });

  it('段数错误不通过', () => {
    const result = validateCardCode('LL-bp1-001');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('4段'))).toBe(true);
  });

  it('未知前缀不通过', () => {
    const result = validateCardCode('XX-bp1-001-N');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('前缀'))).toBe(true);
  });

  it('未知商品代号不通过', () => {
    const result = validateCardCode('LL-bp99-001-N');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('商品代号'))).toBe(true);
  });

  it('序号非3位数字不通过', () => {
    const result = validateCardCode('LL-bp1-01-N');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('序号格式不正确'))).toBe(true);
  });

  it('能量卡 E 序号格式通过', () => {
    expect(validateCardCode('PL!-bp5-E01-PE').valid).toBe(true);
    expect(validateCardCode('PL!N-bp5-E15-LLE').valid).toBe(true);
    expect(validateCardCode('LL-bp1-E01-RE').valid).toBe(true);
  });

  it('PL!SIM 前缀通过验证', () => {
    expect(validateCardCode('PL!SIM-bp5-E01-LLE').valid).toBe(true);
  });

  it('未知稀有度不通过', () => {
    const result = validateCardCode('LL-bp1-001-XX');
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('稀有度'))).toBe(true);
  });
});

describe('getBaseCardCode', () => {
  it('去除稀有度后缀', () => {
    expect(getBaseCardCode('PL!-bp3-017-N')).toBe('PL!-bp3-017');
    expect(getBaseCardCode('LL-bp1-001-R+')).toBe('LL-bp1-001');
    expect(getBaseCardCode('PL!SP-bp2-009-R+')).toBe('PL!SP-bp2-009');
    expect(getBaseCardCode('LL-E-001-SD')).toBe('LL-E-001');
  });

  it('不同稀有度的同一张卡返回相同基础编号', () => {
    expect(getBaseCardCode('LL-bp1-001-N')).toBe(getBaseCardCode('LL-bp1-001-R'));
    expect(getBaseCardCode('LL-bp1-001-R+')).toBe(getBaseCardCode('LL-bp1-001-SEC'));
    expect(getBaseCardCode('PL!-bp3-004-P+')).toBe(getBaseCardCode('PL!-bp3-004-R+'));
  });

  it('不去除系列前缀中的!', () => {
    expect(getBaseCardCode('PL!-bp3-017-N')).toBe('PL!-bp3-017');
    expect(getBaseCardCode('PL!S-bp1-001-N')).toBe('PL!S-bp1-001');
    expect(getBaseCardCode('PL!SP-bp2-009-R+')).toBe('PL!SP-bp2-009');
  });

  it('无-的字符串原样返回', () => {
    expect(getBaseCardCode('INVALID')).toBe('INVALID');
  });
});
