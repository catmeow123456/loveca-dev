import { describe, it, expect } from 'vitest';

describe('示例测试', () => {
  it('应该正确执行基本断言', () => {
    expect(1 + 1).toBe(2);
  });

  it('应该支持字符串断言', () => {
    expect('loveca').toContain('love');
  });

  it('应该支持数组断言', () => {
    const arr = [1, 2, 3];
    expect(arr).toHaveLength(3);
    expect(arr).toContain(2);
  });
});
