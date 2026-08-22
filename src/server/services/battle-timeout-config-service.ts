import {
  DEFAULT_BATTLE_TIMEOUT_CONFIG,
  type BattleTimeoutConfig,
} from '../../online/ranked-policy.js';
import { pool } from '../db/pool.js';

const SITE_STATUS_CONFIG_ID = 'default';

interface BattleTimeoutConfigRow {
  readonly player_action_timeout_seconds: number;
  readonly reconnect_grace_period_seconds: number;
}

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
      `SELECT player_action_timeout_seconds, reconnect_grace_period_seconds
       FROM site_status_config
       WHERE id = $1
       LIMIT 1`,
      [SITE_STATUS_CONFIG_ID]
    );
    return mapRow(result.rows[0]);
  }

  async updateConfig(
    input: BattleTimeoutConfig,
    adminUserId: string
  ): Promise<BattleTimeoutConfig> {
    validateConfig(input);
    const result = await pool.query<BattleTimeoutConfigRow>(
      `INSERT INTO site_status_config (
         id,
         lifecycle,
         player_action_timeout_seconds,
         reconnect_grace_period_seconds,
         updated_by
       )
       VALUES ('default', 'NORMAL', $1, $2, $3)
       ON CONFLICT (id) DO UPDATE
       SET
         player_action_timeout_seconds = EXCLUDED.player_action_timeout_seconds,
         reconnect_grace_period_seconds = EXCLUDED.reconnect_grace_period_seconds,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING player_action_timeout_seconds, reconnect_grace_period_seconds`,
      [input.playerActionTimeoutSeconds, input.reconnectGracePeriodSeconds, adminUserId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new BattleTimeoutConfigServiceError(
        'BATTLE_TIMEOUT_CONFIG_UPDATE_FAILED',
        '对战时限配置保存失败',
        500
      );
    }
    return mapRow(row);
  }
}

function validateConfig(input: BattleTimeoutConfig): void {
  if (
    !Number.isInteger(input.playerActionTimeoutSeconds) ||
    input.playerActionTimeoutSeconds < 60 ||
    input.playerActionTimeoutSeconds > 900
  ) {
    throw new BattleTimeoutConfigServiceError(
      'BATTLE_TIMEOUT_CONFIG_INVALID',
      '玩家操作超时必须在 60 到 900 秒之间',
      400
    );
  }
  if (
    !Number.isInteger(input.reconnectGracePeriodSeconds) ||
    input.reconnectGracePeriodSeconds < 15 ||
    input.reconnectGracePeriodSeconds > 300
  ) {
    throw new BattleTimeoutConfigServiceError(
      'BATTLE_TIMEOUT_CONFIG_INVALID',
      '断线重连期限必须在 15 到 300 秒之间',
      400
    );
  }
}

function mapRow(row: BattleTimeoutConfigRow | undefined): BattleTimeoutConfig {
  return row
    ? {
        playerActionTimeoutSeconds: row.player_action_timeout_seconds,
        reconnectGracePeriodSeconds: row.reconnect_grace_period_seconds,
      }
    : DEFAULT_BATTLE_TIMEOUT_CONFIG;
}

export const battleTimeoutConfigService = new BattleTimeoutConfigService();
