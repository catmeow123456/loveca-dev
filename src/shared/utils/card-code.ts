/**
 * 卡牌编号工具函数
 *
 * 提供 card_code 的标准化、验证和基础编号提取功能。
 * 本模块为前后端共享，所有涉及 card_code 的代码应引用此模块。
 *
 * card_code 格式规范（data-spec.md）:
 *   {系列前缀}-{商品代号}-{序号}-{稀有度}
 *   示例: PL!SP-bp2-009-R+, LL-E-001-SD
 *
 * @module shared/utils/card-code
 */

// ============================================
// 常量定义
// ============================================

/** 有效的系列前缀 */
export const VALID_PREFIXES = [
  'PL!',
  'PL!S',
  'PL!N',
  'PL!SP',
  'PL!HS',
  'PL!SIM',
  'LL',
  'PYHN',
] as const;

/** 有效的商品代号 */
export const VALID_PRODUCTS = [
  'sd1',
  'sd2',
  'bp1',
  'bp2',
  'bp3',
  'bp4',
  'bp5',
  'pb1',
  'PR',
  'E',
] as const;

/** 有效的稀有度 */
export const VALID_RARITIES = [
  'SD',
  'N',
  'R',
  'R+',
  'P',
  'P+',
  'AR',
  'L',
  'L+',
  'SEC',
  'SEC+',
  'SECL',
  'SECE',
  'PR',
  'PR+',
  'PE',
  'PE+',
  'RE',
  'SRE',
  'RM',
  'LLE',
] as const;

// ============================================
// 标准化
// ============================================

/** 非标准稀有度 → 标准稀有度的映射 */
const RARITY_FIXES: Record<string, string> = {
  PR2: 'PR+',
  PRproteinbar: 'PR',
  'PRLoveLive!Days': 'PR',
};

/**
 * 标准化 card_code：
 * 1. 全角＋ → 半角+
 * 2. 非标准稀有度 → 标准稀有度（PR2→PR+, PRproteinbar→PR 等）
 *
 * llocg_db 日文数据使用全角 ＋（如 LL-bp1-001-R＋），
 * 标准规范统一使用半角 +（如 LL-bp1-001-R+）。
 *
 * @param cardCode 原始 card_code
 * @returns 标准化后的 card_code
 */
export function normalizeCardCode(cardCode: string): string {
  let result = cardCode.replace(/＋/g, '+');

  // 修复非标准稀有度
  const lastDash = result.lastIndexOf('-');
  if (lastDash > 0) {
    const rarity = result.substring(lastDash + 1);
    const fix = RARITY_FIXES[rarity];
    if (fix) {
      result = result.substring(0, lastDash + 1) + fix;
    }
  }

  return result;
}

// ============================================
// 验证
// ============================================

/** 验证结果 */
export interface CardCodeValidationResult {
  /** 是否合规 */
  valid: boolean;
  /** 错误列表（为空时表示合规） */
  errors: string[];
}

/**
 * 解析 card_code 为 4 段结构。
 *
 * card_code 格式: {系列前缀}-{商品代号}-{序号}-{稀有度}
 * 其中系列前缀可能包含 `!`（如 PL!SP），但不包含 `-`。
 * 稀有度可能包含 `+`（如 R+、SEC+），但不包含 `-`。
 *
 * 因此直接按 `-` 分割：
 * - parts[0] = 系列前缀
 * - parts[1] = 商品代号
 * - parts[2] = 序号
 * - parts[3] = 稀有度（可能含 +）
 *
 * @returns 解析后的 4 段，或 null（段数不为 4）
 */
export function parseCardCode(cardCode: string): {
  prefix: string;
  product: string;
  seq: string;
  rarity: string;
} | null {
  const parts = cardCode.split('-');
  if (parts.length !== 4) return null;
  return {
    prefix: parts[0],
    product: parts[1],
    seq: parts[2],
    rarity: parts[3],
  };
}

/**
 * 验证 card_code 是否符合 data-spec 规范。
 *
 * 检查项：
 * 1. 不含全角 ＋
 * 2. 格式为 4 段连字符分隔
 * 3. 系列前缀在有效列表中
 * 4. 商品代号在有效列表中
 * 5. 序号为 3 位数字
 * 6. 稀有度在有效列表中
 *
 * @param cardCode 要验证的 card_code
 * @returns 验证结果
 */
export function validateCardCode(cardCode: string): CardCodeValidationResult {
  const errors: string[] = [];

  // 1. 不含全角＋
  if (cardCode.includes('＋')) {
    errors.push('包含全角＋，应使用半角+');
  }

  // 2. 解析 4 段
  const parsed = parseCardCode(cardCode);
  if (!parsed) {
    errors.push(
      `格式不正确，应为 {前缀}-{商品}-{序号}-{稀有度}（4段），` +
        `实际: "${cardCode}"（${cardCode.split('-').length}段）`
    );
    return { valid: false, errors };
  }

  // 3. 系列前缀
  if (!(VALID_PREFIXES as readonly string[]).includes(parsed.prefix)) {
    errors.push(`未知系列前缀: "${parsed.prefix}"`);
  }

  // 4. 商品代号
  if (!(VALID_PRODUCTS as readonly string[]).includes(parsed.product)) {
    errors.push(`未知商品代号: "${parsed.product}"`);
  }

  // 5. 序号格式：3位纯数字（如 001）或 E+数字（如 E01，能量卡变体）
  if (!/^\d{3}$/.test(parsed.seq) && !/^E\d{2,}$/.test(parsed.seq)) {
    errors.push(`序号格式不正确: "${parsed.seq}"（应为3位数字如001，或能量卡格式如E01）`);
  }

  // 6. 稀有度
  if (!(VALID_RARITIES as readonly string[]).includes(parsed.rarity)) {
    errors.push(`未知稀有度: "${parsed.rarity}"`);
  }

  return { valid: errors.length === 0, errors };
}

// ============================================
// 基础编号
// ============================================

/**
 * 获取基础编号（去除末尾稀有度后缀）。
 *
 * 不同稀有度但基础编号相同的卡视为同一张卡（用于卡组构筑"同编号最多4张"规则）。
 *
 * 示例:
 *   PL!-bp3-017-N  → PL!-bp3-017
 *   LL-bp1-001-R+  → LL-bp1-001
 *   PL!SP-bp2-009-R+ → PL!SP-bp2-009
 *
 * @param cardCode 完整 card_code
 * @returns 基础编号（去除最后一个 - 及之后的稀有度）
 */
export function getBaseCardCode(cardCode: string): string {
  const lastDash = cardCode.lastIndexOf('-');
  return lastDash > 0 ? cardCode.substring(0, lastDash) : cardCode;
}
