import type { BattleTimeoutConfig } from './ranked-policy.js';

/**
 * 房间与配对回收时限（休闲房间，不含排位/主题候场票据队列）。
 *
 * 与排位裁定（BattleTimeoutConfig，开局冻结进 match 快照）不同：
 * 这组时限按清理周期实时读取，保存后立即对进行中的房间生效。
 */
export interface RoomLifecycleTimeoutConfig {
  /** 房间里所有人都离线后，再过多久回收房间、封存未完成对局。 */
  readonly roomDestroyAfterAllAbsentSeconds: number;
  /** 休闲配对准备心跳（客户端约 15 秒一次）中断多久后席位失效。 */
  readonly casualHeartbeatGraceSeconds: number;
  /** 休闲配对进入双方确认阶段后的确认期限。 */
  readonly casualConfirmationTtlSeconds: number;
}

export const DEFAULT_ROOM_LIFECYCLE_TIMEOUT_CONFIG: RoomLifecycleTimeoutConfig = {
  roomDestroyAfterAllAbsentSeconds: 60,
  casualHeartbeatGraceSeconds: 45,
  casualConfirmationTtlSeconds: 60,
};

/** 下限 30 秒兼作清理路径的懒加载预检界：时间差未满该值时无需读取配置。 */
export const ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MIN = 30;
export const ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MAX = 600;

/** 下限 45 秒保证至少覆盖客户端 15 秒心跳间隔的三次余量。 */
export const CASUAL_HEARTBEAT_GRACE_SECONDS_MIN = 45;
export const CASUAL_HEARTBEAT_GRACE_SECONDS_MAX = 300;

export const CASUAL_CONFIRMATION_TTL_SECONDS_MIN = 30;
export const CASUAL_CONFIRMATION_TTL_SECONDS_MAX = 300;

/** 平台管理页对战时限面板的完整设置（排位裁定 + 房间回收两组）。 */
export interface AdminBattleTimeoutSettings {
  readonly battleTimeouts: BattleTimeoutConfig;
  readonly roomLifecycle: RoomLifecycleTimeoutConfig;
}
