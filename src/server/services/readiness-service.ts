import { pool } from '../db/pool.js';

export interface ApplicationReadiness {
  readonly ready: boolean;
  readonly checkedAt: string;
}

export class ApplicationReadinessError extends Error {
  constructor(message = 'API 或必要数据结构尚未就绪') {
    super(message);
    this.name = 'ApplicationReadinessError';
  }
}

const REQUIRED_TABLES = ['cards', 'profiles', 'site_status_config'] as const;

export async function checkApplicationReadiness(
  now: Date = new Date()
): Promise<ApplicationReadiness> {
  try {
    const result = await pool.query<{ relation_name: string | null }>(
      `SELECT unnest($1::text[]) AS relation_name
       WHERE NOT EXISTS (
         SELECT 1
         FROM unnest($1::text[]) AS required(name)
         WHERE to_regclass('public.' || required.name) IS NULL
       )`,
      [[...REQUIRED_TABLES]]
    );
    return { ready: result.rows.length > 0, checkedAt: now.toISOString() };
  } catch {
    return { ready: false, checkedAt: now.toISOString() };
  }
}

export async function assertApplicationReady(): Promise<void> {
  const result = await checkApplicationReadiness();
  if (!result.ready) {
    throw new ApplicationReadinessError();
  }
}
