import {
  DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS_MAX,
  DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS_MIN,
  DEFAULT_BATTLE_TIMEOUT_CONFIG,
  type BattleTimeoutConfig,
} from '../../online/ranked-policy.js';
import {
  CASUAL_CONFIRMATION_TTL_SECONDS_MAX,
  CASUAL_CONFIRMATION_TTL_SECONDS_MIN,
  CASUAL_HEARTBEAT_GRACE_SECONDS_MAX,
  CASUAL_HEARTBEAT_GRACE_SECONDS_MIN,
  DEFAULT_ROOM_LIFECYCLE_TIMEOUT_CONFIG,
  ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MAX,
  ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MIN,
  type AdminBattleTimeoutSettings,
  type RoomLifecycleTimeoutConfig,
} from '../../online/room-lifecycle-policy.js';
import { pool } from '../db/pool.js';

const SITE_STATUS_CONFIG_ID = 'default';

interface BattleTimeoutConfigRow {
  readonly player_action_timeout_seconds: number;
  readonly reconnect_grace_period_seconds: number;
  readonly double_disconnect_no_contest_window_seconds: number;
}

interface RoomLifecycleTimeoutConfigRow {
  readonly room_destroy_after_all_absent_seconds: number;
  readonly casual_heartbeat_grace_seconds: number;
  readonly casual_confirmation_ttl_seconds: number;
}

type AdminBattleTimeoutSettingsRow = BattleTimeoutConfigRow & RoomLifecycleTimeoutConfigRow;

export class BattleTimeoutConfigServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'BattleTimeoutConfigServiceError';
  }
}

export class BattleTimeoutConfigService {
  async getConfig(): Promise<BattleTimeoutConfig> {
    const result = await pool.query<BattleTimeoutConfigRow>(
      `SELECT player_action_timeout_seconds, reconnect_grace_period_seconds,
              double_disconnect_no_contest_window_seconds
       FROM site_status_config
       WHERE id = $1
       LIMIT 1`,
      [SITE_STATUS_CONFIG_ID]
    );
    return mapBattleTimeoutRow(result.rows[0]);
  }

  async getRoomLifecycleTimeoutConfig(): Promise<RoomLifecycleTimeoutConfig> {
    const result = await pool.query<RoomLifecycleTimeoutConfigRow>(
      `SELECT room_destroy_after_all_absent_seconds, casual_heartbeat_grace_seconds,
              casual_confirmation_ttl_seconds
       FROM site_status_config
       WHERE id = $1
       LIMIT 1`,
      [SITE_STATUS_CONFIG_ID]
    );
    return mapRoomLifecycleRow(result.rows[0]);
  }

  async getSettings(): Promise<AdminBattleTimeoutSettings> {
    const result = await pool.query<AdminBattleTimeoutSettingsRow>(
      `SELECT player_action_timeout_seconds, reconnect_grace_period_seconds,
              double_disconnect_no_contest_window_seconds,
              room_destroy_after_all_absent_seconds, casual_heartbeat_grace_seconds,
              casual_confirmation_ttl_seconds
       FROM site_status_config
       WHERE id = $1
       LIMIT 1`,
      [SITE_STATUS_CONFIG_ID]
    );
    const row = result.rows[0];
    return row
      ? {
          battleTimeouts: mapBattleTimeoutRow(row),
          roomLifecycle: mapRoomLifecycleRow(row),
        }
      : {
          battleTimeouts: DEFAULT_BATTLE_TIMEOUT_CONFIG,
          roomLifecycle: DEFAULT_ROOM_LIFECYCLE_TIMEOUT_CONFIG,
        };
  }

  async updateConfig(
    input: AdminBattleTimeoutSettings,
    adminUserId: string
  ): Promise<AdminBattleTimeoutSettings> {
    validateConfig(input);
    const result = await pool.query<AdminBattleTimeoutSettingsRow>(
      `INSERT INTO site_status_config (
         id,
         lifecycle,
         player_action_timeout_seconds,
         reconnect_grace_period_seconds,
         double_disconnect_no_contest_window_seconds,
         room_destroy_after_all_absent_seconds,
         casual_heartbeat_grace_seconds,
         casual_confirmation_ttl_seconds,
         updated_by
       )
       VALUES ('default', 'NORMAL', $1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
       SET
         player_action_timeout_seconds = EXCLUDED.player_action_timeout_seconds,
         reconnect_grace_period_seconds = EXCLUDED.reconnect_grace_period_seconds,
         double_disconnect_no_contest_window_seconds = EXCLUDED.double_disconnect_no_contest_window_seconds,
         room_destroy_after_all_absent_seconds = EXCLUDED.room_destroy_after_all_absent_seconds,
         casual_heartbeat_grace_seconds = EXCLUDED.casual_heartbeat_grace_seconds,
         casual_confirmation_ttl_seconds = EXCLUDED.casual_confirmation_ttl_seconds,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING player_action_timeout_seconds, reconnect_grace_period_seconds,
                 double_disconnect_no_contest_window_seconds,
                 room_destroy_after_all_absent_seconds, casual_heartbeat_grace_seconds,
                 casual_confirmation_ttl_seconds`,
      [
        input.battleTimeouts.playerActionTimeoutSeconds,
        input.battleTimeouts.reconnectGracePeriodSeconds,
        input.battleTimeouts.doubleDisconnectNoContestWindowSeconds,
        input.roomLifecycle.roomDestroyAfterAllAbsentSeconds,
        input.roomLifecycle.casualHeartbeatGraceSeconds,
        input.roomLifecycle.casualConfirmationTtlSeconds,
        adminUserId,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new BattleTimeoutConfigServiceError(
        'BATTLE_TIMEOUT_CONFIG_UPDATE_FAILED',
        '对战时限配置保存失败',
        500
      );
    }
    return {
      battleTimeouts: mapBattleTimeoutRow(row),
      roomLifecycle: mapRoomLifecycleRow(row),
    };
  }
}

function validateConfig(input: AdminBattleTimeoutSettings): void {
  const battle = input.battleTimeouts;
  if (
    !Number.isInteger(battle.playerActionTimeoutSeconds) ||
    battle.playerActionTimeoutSeconds < 60 ||
    battle.playerActionTimeoutSeconds > 900
  ) {
    throw new BattleTimeoutConfigServiceError(
      'BATTLE_TIMEOUT_CONFIG_INVALID',
      '玩家操作超时必须在 60 到 900 秒之间',
      400
    );
  }
  if (
    !Number.isInteger(battle.reconnectGracePeriodSeconds) ||
    battle.reconnectGracePeriodSeconds < 15 ||
    battle.reconnectGracePeriodSeconds > 300
  ) {
    throw new BattleTimeoutConfigServiceError(
      'BATTLE_TIMEOUT_CONFIG_INVALID',
      '断线重连期限必须在 15 到 300 秒之间',
      400
    );
  }
  if (
    !Number.isInteger(battle.doubleDisconnectNoContestWindowSeconds) ||
    battle.doubleDisconnectNoContestWindowSeconds < DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS_MIN ||
    battle.doubleDisconnectNoContestWindowSeconds > DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS_MAX
  ) {
    throw new BattleTimeoutConfigServiceError(
      'BATTLE_TIMEOUT_CONFIG_INVALID',
      `双方断线判定窗口必须在 ${DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS_MIN} 到 ${DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS_MAX} 秒之间`,
      400
    );
  }
  const lifecycle = input.roomLifecycle;
  if (
    !Number.isInteger(lifecycle.roomDestroyAfterAllAbsentSeconds) ||
    lifecycle.roomDestroyAfterAllAbsentSeconds < ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MIN ||
    lifecycle.roomDestroyAfterAllAbsentSeconds > ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MAX
  ) {
    throw new BattleTimeoutConfigServiceError(
      'BATTLE_TIMEOUT_CONFIG_INVALID',
      `全员离线销房期限必须在 ${ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MIN} 到 ${ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MAX} 秒之间`,
      400
    );
  }
  if (
    !Number.isInteger(lifecycle.casualHeartbeatGraceSeconds) ||
    lifecycle.casualHeartbeatGraceSeconds < CASUAL_HEARTBEAT_GRACE_SECONDS_MIN ||
    lifecycle.casualHeartbeatGraceSeconds > CASUAL_HEARTBEAT_GRACE_SECONDS_MAX
  ) {
    throw new BattleTimeoutConfigServiceError(
      'BATTLE_TIMEOUT_CONFIG_INVALID',
      `休闲房间心跳宽限必须在 ${CASUAL_HEARTBEAT_GRACE_SECONDS_MIN} 到 ${CASUAL_HEARTBEAT_GRACE_SECONDS_MAX} 秒之间`,
      400
    );
  }
  if (
    !Number.isInteger(lifecycle.casualConfirmationTtlSeconds) ||
    lifecycle.casualConfirmationTtlSeconds < CASUAL_CONFIRMATION_TTL_SECONDS_MIN ||
    lifecycle.casualConfirmationTtlSeconds > CASUAL_CONFIRMATION_TTL_SECONDS_MAX
  ) {
    throw new BattleTimeoutConfigServiceError(
      'BATTLE_TIMEOUT_CONFIG_INVALID',
      `休闲房间配对确认期限必须在 ${CASUAL_CONFIRMATION_TTL_SECONDS_MIN} 到 ${CASUAL_CONFIRMATION_TTL_SECONDS_MAX} 秒之间`,
      400
    );
  }
}

function mapBattleTimeoutRow(row: BattleTimeoutConfigRow | undefined): BattleTimeoutConfig {
  return row
    ? {
        playerActionTimeoutSeconds: row.player_action_timeout_seconds,
        reconnectGracePeriodSeconds: row.reconnect_grace_period_seconds,
        doubleDisconnectNoContestWindowSeconds: row.double_disconnect_no_contest_window_seconds,
      }
    : DEFAULT_BATTLE_TIMEOUT_CONFIG;
}

function mapRoomLifecycleRow(row: RoomLifecycleTimeoutConfigRow | undefined): RoomLifecycleTimeoutConfig {
  return row
    ? {
        roomDestroyAfterAllAbsentSeconds: row.room_destroy_after_all_absent_seconds,
        casualHeartbeatGraceSeconds: row.casual_heartbeat_grace_seconds,
        casualConfirmationTtlSeconds: row.casual_confirmation_ttl_seconds,
      }
    : DEFAULT_ROOM_LIFECYCLE_TIMEOUT_CONFIG;
}

export const battleTimeoutConfigService = new BattleTimeoutConfigService();
