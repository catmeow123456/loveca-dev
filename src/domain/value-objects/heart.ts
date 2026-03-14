/**
 * Heart 值对象和 HeartPool 实现
 * 基于 detail_rules.md 第 2.1, 2.9, 2.11 章
 */

import { HeartColor } from '../../shared/types/enums';
import type { HeartIcon, HeartRequirement } from '../entities/card';

// ============================================
// Heart 计数器
// ============================================

/**
 * Heart 计数映射类型
 * 记录各颜色 Heart 的数量
 */
export type HeartCounts = Map<HeartColor, number>;

/**
 * 创建空的 Heart 计数
 */
export function createEmptyHeartCounts(): HeartCounts {
  return new Map<HeartColor, number>();
}

/**
 * 从 HeartIcon 数组创建 Heart 计数
 */
export function createHeartCountsFromIcons(icons: readonly HeartIcon[]): HeartCounts {
  const counts = new Map<HeartColor, number>();

  for (const icon of icons) {
    const current = counts.get(icon.color) ?? 0;
    counts.set(icon.color, current + icon.count);
  }

  return counts;
}

/**
 * 合并两个 Heart 计数
 */
export function mergeHeartCounts(a: HeartCounts, b: HeartCounts): HeartCounts {
  const result = new Map<HeartColor, number>(a);

  for (const [color, count] of b) {
    const current = result.get(color) ?? 0;
    result.set(color, current + count);
  }

  return result;
}

/**
 * 获取指定颜色的 Heart 数量
 */
export function getHeartCount(counts: HeartCounts, color: HeartColor): number {
  return counts.get(color) ?? 0;
}

/**
 * 计算 Heart 总数（不含 Rainbow）
 */
export function getTotalHeartCount(counts: HeartCounts): number {
  let total = 0;
  for (const [color, count] of counts) {
    if (color !== HeartColor.RAINBOW) {
      total += count;
    }
  }
  return total;
}

/**
 * 获取 Rainbow Heart 数量
 */
export function getRainbowCount(counts: HeartCounts): number {
  return counts.get(HeartColor.RAINBOW) ?? 0;
}

// ============================================
// HeartPool 类
// ============================================

/**
 * Heart 池
 * 用于管理 Live 判定时收集的所有 Heart
 * 支持 Rainbow Heart 的动态分配
 */
export class HeartPool {
  /** 各颜色 Heart 数量（不含 Rainbow） */
  private readonly _colorCounts: Map<HeartColor, number>;
  /** Rainbow Heart 数量 */
  private readonly _rainbowCount: number;

  constructor(heartCounts: HeartCounts) {
    this._colorCounts = new Map<HeartColor, number>();
    let rainbow = 0;

    for (const [color, count] of heartCounts) {
      if (color === HeartColor.RAINBOW) {
        rainbow = count;
      } else {
        this._colorCounts.set(color, count);
      }
    }

    this._rainbowCount = rainbow;
  }

  /**
   * 从 HeartIcon 数组创建 HeartPool
   */
  static fromHeartIcons(icons: readonly HeartIcon[]): HeartPool {
    return new HeartPool(createHeartCountsFromIcons(icons));
  }

  /**
   * 创建空的 HeartPool
   */
  static empty(): HeartPool {
    return new HeartPool(createEmptyHeartCounts());
  }

  /**
   * 获取指定颜色的 Heart 数量（不含 Rainbow）
   */
  getColorCount(color: HeartColor): number {
    if (color === HeartColor.RAINBOW) {
      return this._rainbowCount;
    }
    return this._colorCounts.get(color) ?? 0;
  }

  /**
   * 获取 Rainbow Heart 数量
   */
  getRainbowCount(): number {
    return this._rainbowCount;
  }

  /**
   * 获取总 Heart 数量（包含 Rainbow）
   */
  getTotalCount(): number {
    let total = this._rainbowCount;
    for (const count of this._colorCounts.values()) {
      total += count;
    }
    return total;
  }

  /**
   * 获取非 Rainbow Heart 的总数
   */
  getNonRainbowTotalCount(): number {
    let total = 0;
    for (const count of this._colorCounts.values()) {
      total += count;
    }
    return total;
  }

  /**
   * 检查是否满足 Heart 需求
   * 参考规则 2.11.3
   *
   * 判定条件：
   * 1. 对于每个非灰色心音符，提供的该颜色 Heart >= 需求数量
   * 2. 提供的 Heart 总数 >= 所有心音符需求数量总和
   *
   * Rainbow Heart 可以视为任意颜色
   */
  canSatisfy(requirement: HeartRequirement): boolean {
    const allocation = this.allocateForRequirement(requirement);
    return allocation !== null;
  }

  /**
   * 尝试为需求分配 Heart（包括 Rainbow Heart 的最优分配）
   * 返回分配方案，如果无法满足则返回 null
   *
   * @param requirement Heart 需求
   * @returns 分配方案（各颜色使用的 Heart 数量，包括 Rainbow 分配）或 null
   */
  allocateForRequirement(
    requirement: HeartRequirement
  ): Map<HeartColor, { normal: number; rainbow: number }> | null {
    // 计算每种颜色的缺口
    const deficits = new Map<HeartColor, number>();
    let totalDeficit = 0;

    for (const [color, required] of requirement.colorRequirements) {
      const available = this.getColorCount(color);
      const deficit = Math.max(0, required - available);
      if (deficit > 0) {
        deficits.set(color, deficit);
        totalDeficit += deficit;
      }
    }

    // 检查 Rainbow Heart 是否足够填补所有颜色缺口
    if (totalDeficit > this._rainbowCount) {
      return null;
    }

    // 检查总数是否满足
    if (this.getTotalCount() < requirement.totalRequired) {
      return null;
    }

    // 构建分配方案
    const allocation = new Map<HeartColor, { normal: number; rainbow: number }>();

    for (const [color, required] of requirement.colorRequirements) {
      const available = this.getColorCount(color);
      const deficit = deficits.get(color) ?? 0;

      // 分配该颜色：使用普通 Heart + Rainbow Heart 填补缺口
      const normalUsed = Math.min(available, required);
      const rainbowUsed = deficit;

      allocation.set(color, {
        normal: normalUsed,
        rainbow: rainbowUsed,
      });
    }

    return allocation;
  }

  /**
   * 消耗 Heart 来满足需求
   * 返回新的 HeartPool（消耗后的状态）
   *
   * @param requirement Heart 需求
   * @returns 消耗后的新 HeartPool，如果无法满足则返回 null
   */
  consume(requirement: HeartRequirement): HeartPool | null {
    const allocation = this.allocateForRequirement(requirement);
    if (allocation === null) {
      return null;
    }

    // 计算消耗后的数量
    const newCounts = new Map<HeartColor, number>();
    let totalRainbowUsed = 0;

    // 复制当前颜色计数
    for (const [color, count] of this._colorCounts) {
      newCounts.set(color, count);
    }

    // 扣除使用的 Heart
    for (const [color, usage] of allocation) {
      const current = newCounts.get(color) ?? 0;
      newCounts.set(color, current - usage.normal);
      totalRainbowUsed += usage.rainbow;
    }

    // 设置剩余的 Rainbow Heart
    newCounts.set(HeartColor.RAINBOW, this._rainbowCount - totalRainbowUsed);

    return new HeartPool(newCounts);
  }

  /**
   * 合并另一个 HeartPool
   */
  merge(other: HeartPool): HeartPool {
    const newCounts = new Map<HeartColor, number>();

    // 合并颜色计数
    for (const [color, count] of this._colorCounts) {
      newCounts.set(color, count);
    }
    for (const [color, count] of other._colorCounts) {
      const current = newCounts.get(color) ?? 0;
      newCounts.set(color, current + count);
    }

    // 合并 Rainbow
    newCounts.set(HeartColor.RAINBOW, this._rainbowCount + other._rainbowCount);

    return new HeartPool(newCounts);
  }

  /**
   * 添加 Heart
   */
  add(color: HeartColor, count: number = 1): HeartPool {
    const newCounts = new Map<HeartColor, number>(this._colorCounts);

    if (color === HeartColor.RAINBOW) {
      newCounts.set(HeartColor.RAINBOW, this._rainbowCount + count);
    } else {
      const current = newCounts.get(color) ?? 0;
      newCounts.set(color, current + count);
      newCounts.set(HeartColor.RAINBOW, this._rainbowCount);
    }

    return new HeartPool(newCounts);
  }

  /**
   * 转换为 HeartCounts
   */
  toHeartCounts(): HeartCounts {
    const result = new Map<HeartColor, number>(this._colorCounts);
    if (this._rainbowCount > 0) {
      result.set(HeartColor.RAINBOW, this._rainbowCount);
    }
    return result;
  }

  /**
   * 获取所有颜色及其数量的数组（用于调试/显示）
   */
  toArray(): Array<{ color: HeartColor; count: number }> {
    const result: Array<{ color: HeartColor; count: number }> = [];

    for (const [color, count] of this._colorCounts) {
      if (count > 0) {
        result.push({ color, count });
      }
    }

    if (this._rainbowCount > 0) {
      result.push({ color: HeartColor.RAINBOW, count: this._rainbowCount });
    }

    return result;
  }
}

// ============================================
// Heart 需求检查辅助函数
// ============================================

/**
 * 检查 HeartPool 是否满足多个 Live 卡的 Heart 需求
 * 按顺序检查并消耗 Heart
 *
 * @param pool 当前 Heart 池
 * @param requirements Live 卡需求数组（按判定顺序）
 * @returns 每个 Live 卡是否成功的数组
 */
export function checkMultipleLiveRequirements(
  pool: HeartPool,
  requirements: readonly HeartRequirement[]
): { results: boolean[]; remainingPool: HeartPool } {
  const results: boolean[] = [];
  let currentPool = pool;

  for (const requirement of requirements) {
    const newPool = currentPool.consume(requirement);

    if (newPool !== null) {
      results.push(true);
      currentPool = newPool;
    } else {
      results.push(false);
    }
  }

  return {
    results,
    remainingPool: currentPool,
  };
}

/**
 * 计算满足需求还需要多少 Heart
 * 返回各颜色的缺口
 */
export function calculateHeartDeficit(
  pool: HeartPool,
  requirement: HeartRequirement
): Map<HeartColor, number> {
  const deficits = new Map<HeartColor, number>();

  // 计算颜色缺口
  for (const [color, required] of requirement.colorRequirements) {
    const available = pool.getColorCount(color);
    const deficit = Math.max(0, required - available);
    if (deficit > 0) {
      deficits.set(color, deficit);
    }
  }

  // 考虑 Rainbow Heart 可以填补缺口
  let totalDeficit = 0;
  for (const deficit of deficits.values()) {
    totalDeficit += deficit;
  }

  // 检查总数缺口
  const totalRequired = requirement.totalRequired;
  const totalAvailable = pool.getTotalCount();
  const totalGap = Math.max(0, totalRequired - totalAvailable);

  if (totalGap > 0) {
    // 如果有总数缺口，添加到灰色需求（未指定颜色）
    deficits.set(HeartColor.RAINBOW, totalGap);
  }

  return deficits;
}
