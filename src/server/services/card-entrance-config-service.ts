import { pool } from '../db/pool.js';

export interface CardEntranceConfig {
  readonly enabled: boolean;
}

/** Platform policy only; player opt-out remains a local preference. */
export class CardEntranceConfigService {
  private cached: { enabled: boolean; expiresAt: number } | null = null;
  private reading: Promise<boolean> | null = null;
  private generation = 0;
  async getConfig(): Promise<CardEntranceConfig> {
    const result = await pool.query<{ card_entrance_enabled: boolean }>(
      "SELECT card_entrance_enabled FROM site_status_config WHERE id = 'default' LIMIT 1"
    );
    return { enabled: result.rows[0]?.card_entrance_enabled ?? true };
  }

  async updateConfig(input: CardEntranceConfig, adminUserId: string): Promise<CardEntranceConfig> {
    if (typeof input?.enabled !== 'boolean') throw new Error('卡牌动效开关必须为布尔值');
    const result = await pool.query<{ card_entrance_enabled: boolean }>(
      `INSERT INTO site_status_config (id, lifecycle, card_entrance_enabled, updated_by)
       VALUES ('default', 'NORMAL', $1, $2)
       ON CONFLICT (id) DO UPDATE SET card_entrance_enabled = EXCLUDED.card_entrance_enabled,
       updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING card_entrance_enabled`,
      [input.enabled, adminUserId]
    );
    if (!result.rows[0]) throw new Error('卡牌动效配置保存失败');
    this.generation += 1;
    this.cached = { enabled: result.rows[0].card_entrance_enabled, expiresAt: Date.now() + 1000 };
    return { enabled: this.cached.enabled };
  }

  async isEnabled(): Promise<boolean> {
    // Cosmetic availability must not prevent rule processing when configuration is unavailable.
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.enabled;
    if (this.reading) return this.reading;
    const generation = this.generation;
    this.reading = this.getConfig()
      .then(
        (config) => config.enabled,
        () => false
      )
      .then((enabled) => {
        if (generation === this.generation) this.cached = { enabled, expiresAt: Date.now() + 1000 };
        return this.cached?.enabled ?? enabled;
      })
      .finally(() => {
        this.reading = null;
      });
    return this.reading;
  }
}
export const cardEntranceConfigService = new CardEntranceConfigService();
