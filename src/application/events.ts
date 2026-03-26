/**
 * 游戏内部事件类型
 *
 * 用于 processAction 的事件派发循环。
 * 与 TriggerCondition（游戏规则触发条件）不同，这些是引擎内部的流程控制事件。
 */

export enum GameEventType {
  /** 推进到下一个主阶段 */
  ADVANCE_PHASE = 'ADVANCE_PHASE',
  /** 完成 Live 结算 */
  FINALIZE_LIVE_RESULT = 'FINALIZE_LIVE_RESULT',
  /** 执行规则检查（checkTiming） */
  RUN_CHECK_TIMING = 'RUN_CHECK_TIMING',
}
