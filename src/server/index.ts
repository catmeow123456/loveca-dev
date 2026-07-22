import { assertSecurityConfiguration, config } from './config.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { ensureBucket } from './services/minio-service.js';
import { onlineMatchService } from './services/online-match-service.js';
import { onlineRoomService } from './services/online-room-service.js';

const TOKEN_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
const RUNTIME_CLEANUP_INTERVAL = readPositiveIntEnv('API_RUNTIME_CLEANUP_INTERVAL_MS', 60 * 1000);
const RUNTIME_STATS_LOG_INTERVAL = readPositiveIntEnv(
  'API_RUNTIME_STATS_LOG_INTERVAL_MS',
  60 * 1000
);

async function cleanupExpiredTokens() {
  try {
    const result = await pool.query<{ cleanup_expired_tokens: number }>(
      'SELECT cleanup_expired_tokens()'
    );
    const deleted = result.rows[0]?.cleanup_expired_tokens ?? 0;
    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} expired tokens`);
    }
  } catch (err) {
    console.error('Token cleanup failed:', err);
  }
}

async function cleanupExpiredRuntimeState() {
  try {
    const summary = await onlineRoomService.cleanupExpiredRuntimeState();
    console.log(
      JSON.stringify({
        event: 'api-runtime-cleanup',
        summary,
      })
    );
  } catch (err) {
    console.error('Runtime cleanup failed:', err);
  }
}

function logRuntimeStats() {
  try {
    console.log(
      JSON.stringify({
        event: 'api-runtime-stats',
        memory: process.memoryUsage(),
        matches: onlineMatchService.getRuntimeStats(),
      })
    );
  } catch (err) {
    console.error('Runtime stats logging failed:', err);
  }
}

async function main() {
  assertSecurityConfiguration();

  // Verify database connection
  try {
    await pool.query('SELECT 1');
    console.log('Database connected');
  } catch (err) {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  }

  // Ensure MinIO bucket exists
  try {
    await ensureBucket();
    console.log('MinIO bucket ready');
  } catch (err) {
    console.error('Failed to connect to MinIO:', err);
    console.warn('Image upload/delete will not work until MinIO is available');
  }

  // Schedule periodic token cleanup
  setInterval(() => void cleanupExpiredTokens(), TOKEN_CLEANUP_INTERVAL).unref();
  setInterval(() => void cleanupExpiredRuntimeState(), RUNTIME_CLEANUP_INTERVAL).unref();
  setInterval(logRuntimeStats, RUNTIME_STATS_LOG_INTERVAL).unref();

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`API server listening on port ${config.port} (${config.nodeEnv})`);
  });
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
