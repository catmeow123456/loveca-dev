/**
 * 卡牌数据 Schema 定义
 * 使用 Zod 进行运行时验证
 *
 * 注意：前端卡牌数据主要通过 cardService 从数据库获取。
 * 此 Schema 用于验证从数据库返回的数据。
 */

import { z } from 'zod/v4';
import { HeartColor } from '../../shared/types/enums';

// ============================================
// 基础类型 Schema
// ============================================

/**
 * Heart 颜色枚举 Schema
 */
export const HeartColorSchema = z.enum([
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.YELLOW,
  HeartColor.PURPLE,
  HeartColor.RAINBOW,
]);

/**
 * Blade Heart 效果枚举 Schema
 * 效果类型：HEART (加心), DRAW (抽卡), SCORE (加分)
 */
export const BladeHeartEffectSchema = z.enum(['HEART', 'DRAW', 'SCORE']);

/**
 * Heart 图标 Schema
 */
export const HeartIconSchema = z.object({
  color: HeartColorSchema,
  count: z.number().int().positive(),
});

/**
 * Blade Heart 效果项 Schema
 * effect: 效果类型
 * heartColor: 仅当 effect 为 HEART 时需要
 */
export const BladeHeartItemSchema = z.object({
  effect: BladeHeartEffectSchema,
  heartColor: HeartColorSchema.optional(),
});

/**
 * Blade Heart 效果列表 Schema
 * 一个卡牌可以有多个效果
 */
export const BladeHeartsSchema = z.array(BladeHeartItemSchema);

/** @deprecated 使用 BladeHeartItemSchema 代替 */
export const BladeHeartSchema = BladeHeartItemSchema;

// ============================================
// 卡牌数据 Schema
// ============================================

/**
 * 成员卡数据 Schema
 */
export const MemberCardDataSchema = z.object({
  cardType: z.literal('MEMBER'),
  cardCode: z.string().min(1),
  name: z.string().min(1),
  groupName: z.string().nullable().optional(),
  unitName: z.string().nullable().optional(),
  cost: z.number().int().nonnegative(),
  blade: z.number().int().nonnegative(),
  hearts: z.array(HeartIconSchema),
  bladeHearts: BladeHeartsSchema.nullable().optional(),
  cardText: z.string().nullable().optional(),
});

/**
 * Live 卡数据 Schema
 *
 * bladeHearts 字段说明：
 * - Live 卡可以拥有 bladeHearts，表示完成 Live 后获得的效果列表
 * - effect 类型：HEART（获得心）、DRAW（抽卡）、SCORE（加分）
 * - heartColor：仅当 effect 为 HEART 时需要，指定心的颜色
 */
export const LiveCardDataSchema = z.object({
  cardType: z.literal('LIVE'),
  cardCode: z.string().min(1),
  name: z.string().min(1),
  groupName: z.string().nullable().optional(),
  unitName: z.string().nullable().optional(),
  score: z.number().int().positive(),
  requirements: z.array(HeartIconSchema),
  bladeHearts: BladeHeartsSchema.nullable().optional(),
  cardText: z.string().nullable().optional(),
});

/**
 * 能量卡数据 Schema
 */
export const EnergyCardDataSchema = z.object({
  cardType: z.literal('ENERGY'),
  cardCode: z.string().min(1),
  name: z.string().min(1),
});

/**
 * 任意卡牌数据 Schema（联合类型）
 */
export const AnyCardDataSchema = z.discriminatedUnion('cardType', [
  MemberCardDataSchema,
  LiveCardDataSchema,
  EnergyCardDataSchema,
]);

// ============================================
// 类型导出
// ============================================

/**
 * 从 Schema 推断的类型
 */
export type HeartIconJson = z.infer<typeof HeartIconSchema>;
export type BladeHeartJson = z.infer<typeof BladeHeartSchema>;
export type MemberCardDataJson = z.infer<typeof MemberCardDataSchema>;
export type LiveCardDataJson = z.infer<typeof LiveCardDataSchema>;
export type EnergyCardDataJson = z.infer<typeof EnergyCardDataSchema>;
export type AnyCardDataJson = z.infer<typeof AnyCardDataSchema>;
