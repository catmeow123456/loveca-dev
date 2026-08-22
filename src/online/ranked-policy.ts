export interface BattleTimeoutConfig {
  readonly playerActionTimeoutSeconds: number;
  readonly reconnectGracePeriodSeconds: number;
}

export const DEFAULT_BATTLE_TIMEOUT_CONFIG: BattleTimeoutConfig = {
  playerActionTimeoutSeconds: 3 * 60,
  reconnectGracePeriodSeconds: 60,
};

export const RANKED_RECONNECT_GRACE_PERIOD_MS =
  DEFAULT_BATTLE_TIMEOUT_CONFIG.reconnectGracePeriodSeconds * 1000;

export const RANKED_DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_MS = 5 * 1000;

export const RANKED_STALL_TIMEOUT_MS =
  DEFAULT_BATTLE_TIMEOUT_CONFIG.playerActionTimeoutSeconds * 1000;

export const RANKED_STALL_NOTICE_AFTER_MS = 2 * 60 * 1000;

export const RANKED_RECONNECT_GRACE_PERIOD_SECONDS = RANKED_RECONNECT_GRACE_PERIOD_MS / 1000;

export const RANKED_DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS =
  RANKED_DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_MS / 1000;

export const RANKED_STALL_TIMEOUT_SECONDS = RANKED_STALL_TIMEOUT_MS / 1000;

export const RANKED_RECONNECT_GRACE_PERIOD_LABEL = `${RANKED_RECONNECT_GRACE_PERIOD_SECONDS / 60} 分钟`;

export const RANKED_DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_LABEL = `${RANKED_DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS} 秒`;

export const RANKED_STALL_TIMEOUT_LABEL = `${RANKED_STALL_TIMEOUT_SECONDS / 60} 分钟`;

export const RANKED_RATING_ALGORITHM_NOTICE = {
  name: 'Glicko-1',
  summary: '每局根据胜负、双方积分和积分可信度计算变化。',
} as const;

export function formatBattleTimeoutSeconds(seconds: number): string {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`;
}

export function buildRankedSeasonDisconnectNotice(config: BattleTimeoutConfig): {
  readonly title: string;
  readonly summary: string;
} {
  const reconnectLabel = formatBattleTimeoutSeconds(config.reconnectGracePeriodSeconds);
  const actionLabel = formatBattleTimeoutSeconds(config.playerActionTimeoutSeconds);
  return {
    title: '断线、重连与操作超时裁定',
    summary: `断线后可在 ${reconnectLabel}内重连。单方断线超时由超时方判负；双方都超时，最后在线相差不超过 ${RANKED_DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_LABEL}时本局无结果、不计胜者与积分，超过 ${RANKED_DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_LABEL}时较早离线方判负。对局明确等待一名玩家操作时，连续 ${actionLabel}没有成功操作也会判负。`,
  };
}

export const RANKED_SEASON_DISCONNECT_NOTICE = buildRankedSeasonDisconnectNotice(
  DEFAULT_BATTLE_TIMEOUT_CONFIG
);
