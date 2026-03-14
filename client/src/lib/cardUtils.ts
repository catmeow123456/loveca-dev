/**
 * 获取基础编号（去除末尾稀有度后缀）。
 * 例如 "PL!-bp3-017-N" → "PL!-bp3-017"，"LL-bp1-001-R+" → "LL-bp1-001"
 *
 * 从共享模块 re-export，保持前端代码的引用路径不变。
 */
export { getBaseCardCode } from '../../../src/shared/utils/card-code';
