/**
 * 游戏内部事件类型
 *
 * 用于 processAction 的事件派发循环。
 * 与 TriggerCondition（游戏规则触发条件）不同，这些是引擎内部的流程控制事件。
 */

export enum GameEventType {
  /** 计算并写入 Live 结算推荐分数/胜者 */
  CALCULATE_LIVE_RESULT = 'CALCULATE_LIVE_RESULT',
  /** 基于双方确认后的分数判定 Live 胜者 */
  RESOLVE_LIVE_WINNER = 'RESOLVE_LIVE_WINNER',
  /** 推进到下一个主阶段 */
  ADVANCE_PHASE = 'ADVANCE_PHASE',
  /** 完成 Live 结算 */
  FINALIZE_LIVE_RESULT = 'FINALIZE_LIVE_RESULT',
  /** 执行规则检查（checkTiming） */
  RUN_CHECK_TIMING = 'RUN_CHECK_TIMING',
}
