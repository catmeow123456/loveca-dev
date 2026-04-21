/**
 * Loveca 游戏核心枚举定义
 * 基于 detail_rules.md 规则书
 */

// ============================================
// 卡牌相关枚举
// ============================================

/**
 * 卡牌类型
 * 参考规则 2.2
 */
export enum CardType {
  /** 成员卡 - 用于 Live 判定 */
  MEMBER = 'MEMBER',
  /** Live 卡 - 进行成功判定、决定胜负 */
  LIVE = 'LIVE',
  /** 能量卡 - 用于支付成员费用 */
  ENERGY = 'ENERGY',
}

/**
 * Heart 颜色
 * 参考规则 2.1
 */
export enum HeartColor {
  /** 桃色 */
  PINK = 'PINK',
  /** 红色 */
  RED = 'RED',
  /** 黄色 */
  YELLOW = 'YELLOW',
  /** 绿色 */
  GREEN = 'GREEN',
  /** 蓝色 */
  BLUE = 'BLUE',
  /** 紫色 */
  PURPLE = 'PURPLE',
  /**
   * 万能色 - 可视为任意颜色
   * 参考规则 2.1.1.3 及 8.3.15.1.1
   */
  RAINBOW = 'RAINBOW',
}

/**
 * Blade Heart 效果类型
 * 参考规则 2.7
 *
 * 注意：bladeHeart 现在是一个列表，可以包含多个效果
 */
export enum BladeHeartEffect {
  /** 抽卡效果 */
  DRAW = 'DRAW',
  /** 增加指定颜色的 Heart（颜色由 heartColor 字段决定） */
  HEART = 'HEART',
  /** Live 分数 +1 */
  SCORE = 'SCORE',
}

// ============================================
// 区域相关枚举
// ============================================

/**
 * 区域类型
 * 参考规则第 4 章
 */
export enum ZoneType {
  /** 手牌 - 非公开区域 */
  HAND = 'HAND',
  /** 主卡组放置区 - 非公开、顺序管理 */
  MAIN_DECK = 'MAIN_DECK',
  /** 能量卡组放置区 - 非公开 */
  ENERGY_DECK = 'ENERGY_DECK',
  /** 成员区域（舞台） */
  MEMBER_SLOT = 'MEMBER_SLOT',
  /** 能量放置区 - 公开、有状态 */
  ENERGY_ZONE = 'ENERGY_ZONE',
  /** Live 卡放置区 */
  LIVE_ZONE = 'LIVE_ZONE',
  /** 成功 Live 卡放置区 */
  SUCCESS_ZONE = 'SUCCESS_ZONE',
  /** 休息室（控备室/弃牌堆） */
  WAITING_ROOM = 'WAITING_ROOM',
  /** 除外区域 */
  EXILE_ZONE = 'EXILE_ZONE',
  /** 解决区域 - 共享 */
  RESOLUTION_ZONE = 'RESOLUTION_ZONE',
  /** 检视区域 - 共享，检视者正面/对手背面 */
  INSPECTION_ZONE = 'INSPECTION_ZONE',
}

/**
 * 成员区域槽位位置
 * 参考规则 4.5.2
 */
export enum SlotPosition {
  /** 左侧区域 */
  LEFT = 'LEFT',
  /** 中央区域 */
  CENTER = 'CENTER',
  /** 右侧区域 */
  RIGHT = 'RIGHT',
}

/**
 * 区域可见性
 * 参考规则 4.1.2
 */
export enum ZoneVisibility {
  /** 公开区域 - 所有玩家可见 */
  PUBLIC = 'PUBLIC',
  /** 非公开区域 - 仅特定玩家可见 */
  PRIVATE = 'PRIVATE',
}

// ============================================
// 卡牌状态枚举
// ============================================

/**
 * 卡牌方向状态
 * 参考规则 4.3.2
 */
export enum OrientationState {
  /** 活跃状态 - 纵向正放 */
  ACTIVE = 'ACTIVE',
  /** 等待状态 - 横向放置 */
  WAITING = 'WAITING',
}

/**
 * 卡牌显示面状态
 * 参考规则 4.3.3
 */
export enum FaceState {
  /** 正面朝上 */
  FACE_UP = 'FACE_UP',
  /** 背面朝上 */
  FACE_DOWN = 'FACE_DOWN',
}

// ============================================
// 游戏流程枚举
// ============================================

/**
 * 游戏阶段
 * 参考规则第 7 章和第 8 章
 */
export enum GamePhase {
  // ---- 游戏准备 ----
  /** 游戏准备阶段 */
  SETUP = 'SETUP',
  /** 换牌阶段 - 玩家可选择换牌 */
  MULLIGAN_PHASE = 'MULLIGAN_PHASE',

  // ---- 通常阶段 ----
  /** 活跃阶段 - 恢复能量 */
  ACTIVE_PHASE = 'ACTIVE_PHASE',
  /** 能量阶段 - 补充能量 */
  ENERGY_PHASE = 'ENERGY_PHASE',
  /** 抽卡阶段 */
  DRAW_PHASE = 'DRAW_PHASE',
  /** 主要阶段 - 播放成员/能力 */
  MAIN_PHASE = 'MAIN_PHASE',

  // ---- Live 阶段 ----
  /** Live 卡放置阶段 */
  LIVE_SET_PHASE = 'LIVE_SET_PHASE',
  /** 表演阶段 */
  PERFORMANCE_PHASE = 'PERFORMANCE_PHASE',
  /** Live 胜负判定阶段 */
  LIVE_RESULT_PHASE = 'LIVE_RESULT_PHASE',

  // ---- 游戏结束 ----
  /** 游戏结束 */
  GAME_END = 'GAME_END',
}

/**
 * 玩家回合类型
 * 参考规则 7.1
 */
export enum TurnType {
  /** 先攻通常阶段 */
  FIRST_PLAYER_TURN = 'FIRST_PLAYER_TURN',
  /** 后攻通常阶段 */
  SECOND_PLAYER_TURN = 'SECOND_PLAYER_TURN',
  /** Live 阶段（双方共同） */
  LIVE_PHASE = 'LIVE_PHASE',
}

/**
 * 子阶段类型
 * 用于细化 Live 阶段的流程控制
 *
 * 核心设计原则：信任用户手动操作，不自动执行卡牌效果
 */
export enum SubPhase {
  /** 无子阶段（通常阶段使用） */
  NONE = 'NONE',

  // ---- 换牌阶段子阶段 ----
  /** 先攻玩家选择换牌 */
  MULLIGAN_FIRST_PLAYER = 'MULLIGAN_FIRST_PLAYER',
  /** 后攻玩家选择换牌 */
  MULLIGAN_SECOND_PLAYER = 'MULLIGAN_SECOND_PLAYER',

  // ---- Live 设置阶段子阶段 ----
  /** 先攻玩家盖牌 */
  LIVE_SET_FIRST_PLAYER = 'LIVE_SET_FIRST_PLAYER',
  /** 先攻玩家抽卡（自动） */
  LIVE_SET_FIRST_DRAW = 'LIVE_SET_FIRST_DRAW',
  /** 后攻玩家盖牌 */
  LIVE_SET_SECOND_PLAYER = 'LIVE_SET_SECOND_PLAYER',
  /** 后攻玩家抽卡（自动） */
  LIVE_SET_SECOND_DRAW = 'LIVE_SET_SECOND_DRAW',

  // ---- 演出阶段子阶段 ----
  /** 翻开 Live 卡 */
  PERFORMANCE_REVEAL = 'PERFORMANCE_REVEAL',
  /** "Live开始时"效果发动窗口 */
  PERFORMANCE_LIVE_START_EFFECTS = 'PERFORMANCE_LIVE_START_EFFECTS',
  /** Live 判定 - 含应援统计 + 成功/失败确认 */
  PERFORMANCE_JUDGMENT = 'PERFORMANCE_JUDGMENT',

  // ---- Live 胜败判定阶段子阶段 ----
  /** 先攻玩家 "Live成功时" 效果发动窗口 */
  RESULT_FIRST_SUCCESS_EFFECTS = 'RESULT_FIRST_SUCCESS_EFFECTS',
  /** 后攻玩家 "Live成功时" 效果发动窗口 */
  RESULT_SECOND_SUCCESS_EFFECTS = 'RESULT_SECOND_SUCCESS_EFFECTS',
  /** 双方确认 Live 分数 */
  RESULT_SCORE_CONFIRM = 'RESULT_SCORE_CONFIRM',
  /** 结算前胜者动画 */
  RESULT_ANIMATION = 'RESULT_ANIMATION',
  /** 胜者选择成功 Live 并确认结算 */
  RESULT_SETTLEMENT = 'RESULT_SETTLEMENT',
  /** 回合结束处理 */
  RESULT_TURN_END = 'RESULT_TURN_END',

  // ---- 通用子阶段 ----
  /** 检查时机处理中 */
  CHECK_TIMING = 'CHECK_TIMING',
  /** 效果发动窗口 */
  EFFECT_WINDOW = 'EFFECT_WINDOW',
  /** 用户自由操作窗口 */
  FREE_ACTION = 'FREE_ACTION',
}

/**
 * 效果发动窗口类型
 * 标识当前窗口可发动的效果类型
 */
export enum EffectWindowType {
  /** 无效果窗口 */
  NONE = 'NONE',
  /** Live 开始时效果 */
  LIVE_START = 'LIVE_START',
  /** Live 成功时效果 */
  LIVE_SUCCESS = 'LIVE_SUCCESS',
  /** 通用自动能力 */
  AUTO_ABILITY = 'AUTO_ABILITY',
}

// ============================================
// 能力相关枚举
// ============================================

/**
 * 能力类型
 * 参考规则 9.1
 */
export enum AbilityType {
  /** 触发能力 - 主动支付成本执行 */
  ACTIVATED = 'ACTIVATED',
  /** 自动能力 - 满足条件自动触发 */
  AUTO = 'AUTO',
  /** 常驻能力 - 持续生效 */
  STATIC = 'STATIC',
}

/**
 * 触发条件类型
 * 参考规则 9.7 及第 11 章
 */
export enum TriggerCondition {
  // ---- 阶段触发 ----
  /** 游戏开始时 */
  ON_GAME_START = 'ON_GAME_START',
  /** 回合开始时 */
  ON_TURN_START = 'ON_TURN_START',
  /** 回合结束时 */
  ON_TURN_END = 'ON_TURN_END',
  /** 活跃阶段开始时 */
  ON_ACTIVE_PHASE_START = 'ON_ACTIVE_PHASE_START',
  /** 能量阶段开始时 */
  ON_ENERGY_PHASE_START = 'ON_ENERGY_PHASE_START',
  /** 抽卡阶段开始时 */
  ON_DRAW_PHASE_START = 'ON_DRAW_PHASE_START',
  /** 主要阶段开始时 */
  ON_MAIN_PHASE_START = 'ON_MAIN_PHASE_START',
  /** Live 阶段开始时 */
  ON_LIVE_PHASE_START = 'ON_LIVE_PHASE_START',
  /** Live 卡放置阶段开始时 */
  ON_LIVE_SET_PHASE_START = 'ON_LIVE_SET_PHASE_START',
  /** 表演阶段开始时 */
  ON_PERFORMANCE_PHASE_START = 'ON_PERFORMANCE_PHASE_START',
  /** Live 判定阶段开始时 */
  ON_LIVE_RESULT_PHASE_START = 'ON_LIVE_RESULT_PHASE_START',

  // ---- 区域移动触发 (规则 9.7.4) ----
  /** 登场 - 成员进入舞台 */
  ON_ENTER_STAGE = 'ON_ENTER_STAGE',
  /** 离开舞台 */
  ON_LEAVE_STAGE = 'ON_LEAVE_STAGE',
  /** 进入手牌 */
  ON_ENTER_HAND = 'ON_ENTER_HAND',
  /** 进入休息室 */
  ON_ENTER_WAITING_ROOM = 'ON_ENTER_WAITING_ROOM',

  // ---- Live 相关触发 ----
  /** Live 开始时 */
  ON_LIVE_START = 'ON_LIVE_START',
  /** Live 成功时 */
  ON_LIVE_SUCCESS = 'ON_LIVE_SUCCESS',
  /** Live 失败时 */
  ON_LIVE_FAIL = 'ON_LIVE_FAIL',

  // ---- 动作触发 ----
  /** Cheer 时 */
  ON_CHEER = 'ON_CHEER',
  /** 接力传递时 */
  ON_RELAY = 'ON_RELAY',
  /** 抽卡时 */
  ON_DRAW = 'ON_DRAW',
  /** 支付费用时 */
  ON_PAY_COST = 'ON_PAY_COST',

  // ---- 状态触发 (规则 9.7.6) ----
  /** 手牌为空时 */
  ON_HAND_EMPTY = 'ON_HAND_EMPTY',
  /** 卡组为空时 */
  ON_DECK_EMPTY = 'ON_DECK_EMPTY',
}

/**
 * 效果类型
 * 参考规则 9.2
 */
export enum EffectType {
  /** 一次性效果 */
  ONE_TIME = 'ONE_TIME',
  /** 持续效果 */
  CONTINUOUS = 'CONTINUOUS',
  /** 替代效果 */
  REPLACEMENT = 'REPLACEMENT',
}

/**
 * 效果持续时间
 * 参考规则 9.9
 */
export enum EffectDuration {
  /** 本回合结束时 */
  UNTIL_TURN_END = 'UNTIL_TURN_END',
  /** 本游戏中 */
  UNTIL_GAME_END = 'UNTIL_GAME_END',
  /** 直到离开该区域 */
  UNTIL_LEAVE_ZONE = 'UNTIL_LEAVE_ZONE',
  /** 立即（一次性效果） */
  IMMEDIATE = 'IMMEDIATE',
}

// ============================================
// 游戏结果枚举
// ============================================

/**
 * 游戏结束原因
 * 参考规则 1.2
 */
export enum GameEndReason {
  /** 达成胜利条件（3张成功 Live） */
  VICTORY_CONDITION = 'VICTORY_CONDITION',
  /** 对手认输 */
  OPPONENT_SURRENDER = 'OPPONENT_SURRENDER',
  /** 双方平局 */
  DRAW = 'DRAW',
  /** 卡牌效果导致 */
  CARD_EFFECT = 'CARD_EFFECT',
  /** 无限循环判定平局 */
  INFINITE_LOOP = 'INFINITE_LOOP',
}

/**
 * Live 胜负结果
 * 参考规则 8.4
 */
export enum LiveResult {
  /** 获胜 */
  WIN = 'WIN',
  /** 失败 */
  LOSE = 'LOSE',
  /** 双方均获胜（分数相同） */
  BOTH_WIN = 'BOTH_WIN',
  /** 无人获胜（双方均无 Live 卡） */
  NO_WINNER = 'NO_WINNER',
}

// ============================================
// 游戏模式枚举
// ============================================

/**
 * 游戏模式
 * 控制游戏会话的流程行为和 UI 展示
 */
export enum GameMode {
  /** 调试模式 - 双人同设备，手动切换视角 */
  DEBUG = 'DEBUG',
  /** 对墙打模式 - 单人，系统自动处理对手 */
  SOLITAIRE = 'SOLITAIRE',
}

// ============================================
// 错误代码枚举
// ============================================

/**
 * 游戏错误代码
 */
export enum GameErrorCode {
  // ---- 非法操作 ----
  /** 非法动作 */
  INVALID_ACTION = 'INVALID_ACTION',
  /** 费用不足 */
  INSUFFICIENT_COST = 'INSUFFICIENT_COST',
  /** 目标非法 */
  INVALID_TARGET = 'INVALID_TARGET',
  /** 无法播放 */
  CANNOT_PLAY = 'CANNOT_PLAY',

  // ---- 状态错误 ----
  /** 阶段错误 */
  WRONG_PHASE = 'WRONG_PHASE',
  /** 不是你的回合 */
  NOT_YOUR_TURN = 'NOT_YOUR_TURN',
  /** 区域已满 */
  ZONE_FULL = 'ZONE_FULL',

  // ---- 系统错误 ----
  /** 状态损坏 */
  STATE_CORRUPTED = 'STATE_CORRUPTED',
  /** 检测到无限循环 */
  INFINITE_LOOP_DETECTED = 'INFINITE_LOOP_DETECTED',
  /** 未知错误 */
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}
