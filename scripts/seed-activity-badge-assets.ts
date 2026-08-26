import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/server/db/pool.js';
import { normalizeActivityBadgeImage } from '../src/server/services/activity-badge-image-service.js';
import {
  ensureBucket,
  objectExists,
  uploadPublicImmutableObject,
} from '../src/server/services/minio-service.js';

const FIRST_BADGE_KEY = 'ranked-first-season-qualified';
const EXPECTED_OBJECT_KEY = 'activity-badges/1f16f56b-3d54-4b10-a0e5-034e26cd4bf5/badge.webp';
const EXPECTED_SHA256 = '1662921b3edf6f56cd1449f5bb6f1000229ef46a72fabd6adb87d499eb42e768';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--yes')) {
    throw new Error('实际上传需要同时传入 --apply --yes');
  }
  const assetPath = fileURLToPath(
    new URL('../assets/badges/first-ranked-season.png', import.meta.url)
  );
  const processed = await normalizeActivityBadgeImage(await readFile(assetPath));
  const sha256 = createHash('sha256').update(processed.buffer).digest('hex');
  if (sha256 !== EXPECTED_SHA256) {
    throw new Error(`首届徽章规范化结果哈希不一致：${sha256}`);
  }

  const rule = await pool.query<{
    readonly image_object_key: string;
    readonly image_sha256: string;
  }>(
    `SELECT image_object_key, image_sha256
     FROM player_badge_rules
     WHERE badge_key = $1`,
    [FIRST_BADGE_KEY]
  );
  if (!rule.rows[0]) {
    process.stdout.write(
      `${JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', notApplicable: true }, null, 2)}\n`
    );
    return;
  }
  if (
    rule.rows[0].image_object_key !== EXPECTED_OBJECT_KEY ||
    rule.rows[0].image_sha256 !== EXPECTED_SHA256
  ) {
    throw new Error('数据库中的首届徽章对象引用与 0035 迁移不一致');
  }

  const exists = await objectExists(EXPECTED_OBJECT_KEY);
  const report = {
    mode: apply ? 'APPLY' : 'DRY_RUN',
    objectKey: EXPECTED_OBJECT_KEY,
    sha256,
    bytes: processed.buffer.length,
    alreadyExists: exists,
  };
  if (apply) {
    await ensureBucket();
    await uploadPublicImmutableObject(EXPECTED_OBJECT_KEY, processed.buffer);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
