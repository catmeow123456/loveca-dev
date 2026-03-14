import { config } from './config.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { ensureBucket } from './services/minio-service.js';

const TOKEN_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

async function cleanupExpiredTokens() {
  try {
    const result = await pool.query('SELECT cleanup_expired_tokens()');
    const deleted = result.rows[0]?.cleanup_expired_tokens ?? 0;
    if (deleted > 0) {
      console.log(`Cleaned up ${deleted} expired tokens`);
    }
  } catch (err) {
    console.error('Token cleanup failed:', err);
  }
}

async function main() {
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
  setInterval(cleanupExpiredTokens, TOKEN_CLEANUP_INTERVAL);

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`API server listening on port ${config.port} (${config.nodeEnv})`);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
