import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { minioClient } from './minio-service.js';
import {
  CARD_SYNC_POLICY,
  CardSyncEngineError,
  CardSyncPreviewStaleError,
  type CardSyncEngine,
  type CardSyncEngineApplyInput,
  type CardSyncEngineApplyItem,
  type CardSyncEngineApplyResult,
  type CardSyncEngineBlockedItem,
  type CardSyncEngineConfigurationStatus,
  type CardSyncEnginePreview,
} from './card-sync-engine.js';
import {
  DEFAULT_CLOUDBASE_BATCH_SIZE,
  buildCloudbaseCardSnapshot,
  buildPreparedCandidates,
  createCloudbaseAppWithCredentials,
  processCandidateImage,
  readCloudbaseDocuments,
  type CardInsertRecord,
  type CloudBaseApp,
  type ExistingCardRow,
  type PreparedCandidate,
  type TransformResult,
} from '../../scripts/sync-cards-cloudbase-new.js';

const CONFIGURATION_KEYS = [
  'CLOUDBASE_ENV_ID',
  'CLOUDBASE_SECRET_ID',
  'CLOUDBASE_SECRET_KEY',
] as const;

interface SyncPlan {
  readonly cloudbase: CloudBaseApp;
  readonly sourceHash: string;
  readonly sourceCount: number;
  readonly existingCount: number;
  readonly candidates: readonly PreparedCandidate[];
  readonly blocked: readonly CardSyncEngineBlockedItem[];
}

function readCredential(primary: string, legacy?: string): string | null {
  const value = process.env[primary]?.trim() || (legacy ? process.env[legacy]?.trim() : '');
  return value || null;
}

function configurationStatus(): CardSyncEngineConfigurationStatus {
  const missing: string[] = [];
  if (!readCredential('CLOUDBASE_ENV_ID')) missing.push(CONFIGURATION_KEYS[0]);
  if (!readCredential('CLOUDBASE_SECRET_ID', 'CLOUDBASE_SECRETID')) {
    missing.push(CONFIGURATION_KEYS[1]);
  }
  if (!readCredential('CLOUDBASE_SECRET_KEY', 'CLOUDBASE_SECRETKEY')) {
    missing.push(CONFIGURATION_KEYS[2]);
  }
  return { configured: missing.length === 0, missing };
}

function createConfiguredCloudbase(): CloudBaseApp {
  const status = configurationStatus();
  if (!status.configured) {
    throw new CardSyncEngineError('NOT_CONFIGURED', `缺少服务端配置：${status.missing.join('、')}`);
  }
  return createCloudbaseAppWithCredentials({
    envId: readCredential('CLOUDBASE_ENV_ID')!,
    secretId: readCredential('CLOUDBASE_SECRET_ID', 'CLOUDBASE_SECRETID')!,
    secretKey: readCredential('CLOUDBASE_SECRET_KEY', 'CLOUDBASE_SECRETKEY')!,
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
}

function sourceHashFor(documents: readonly Record<string, unknown>[]): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(documents)))
    .digest('hex');
}

function nameFor(transform: TransformResult): string | null {
  return transform.record?.name_cn ?? transform.record?.name_jp ?? null;
}

function blockedFromSnapshot(
  snapshot: ReturnType<typeof buildCloudbaseCardSnapshot>,
  candidatesSkipped: ReturnType<typeof buildPreparedCandidates>['skipped']
): CardSyncEngineBlockedItem[] {
  const blocked: CardSyncEngineBlockedItem[] = snapshot.invalidRows.map((row) => ({
    cardCode: null,
    code: 'INVALID_SOURCE_ROW',
    message: `上游第 ${row.rowNumber} 条记录缺少卡牌编号`,
  }));

  for (const [cardCode] of snapshot.duplicateRows) {
    blocked.push({
      cardCode,
      code: 'DUPLICATE_CARD_CODE',
      message: '上游存在重复卡牌编号',
    });
  }

  for (const transform of snapshot.transforms) {
    if (transform.record) continue;
    blocked.push({
      cardCode: transform.row.cardCode,
      code: 'INVALID_CARD_DATA',
      message: transform.errors.length > 0 ? transform.errors.join('；') : '卡牌字段无法转换',
    });
  }

  for (const skipped of candidatesSkipped) {
    const code =
      skipped.reason === 'duplicateImageBaseName'
        ? 'DUPLICATE_IMAGE_NAME'
        : skipped.reason === 'imageBaseNameAlreadyUsed'
          ? 'IMAGE_NAME_CONFLICT'
          : 'CANDIDATE_BLOCKED';
    blocked.push({
      cardCode: skipped.cardCode,
      code,
      message:
        code === 'DUPLICATE_IMAGE_NAME'
          ? '多个上游新卡会写入相同的图片文件名'
          : code === 'IMAGE_NAME_CONFLICT'
            ? '图片文件名已被现有卡牌使用'
            : '该卡牌暂不能同步',
    });
  }
  return blocked;
}

async function buildSyncPlan(): Promise<SyncPlan> {
  const cloudbase = createConfiguredCloudbase();
  const documents = await readCloudbaseDocuments(
    cloudbase.database().collection(CARD_SYNC_POLICY.collection),
    null,
    DEFAULT_CLOUDBASE_BATCH_SIZE
  );
  const snapshot = buildCloudbaseCardSnapshot(documents, CARD_SYNC_POLICY.status);
  const existingResult = await pool.query<ExistingCardRow>(
    'SELECT card_code, image_filename FROM cards ORDER BY card_code'
  );
  const planned = buildPreparedCandidates(snapshot.transforms, existingResult.rows);
  const blocked = blockedFromSnapshot(snapshot, planned.skipped);
  const candidates: PreparedCandidate[] = [];

  for (const candidate of planned.prepared) {
    if (!candidate.imagePlan.sourceUri || !candidate.imagePlan.imageBaseName) {
      blocked.push({
        cardCode: candidate.record.card_code,
        code: 'MISSING_IMAGE',
        message: '上游未提供可同步的卡图',
      });
      continue;
    }
    candidates.push(candidate);
  }

  return {
    cloudbase,
    sourceHash: sourceHashFor(documents),
    sourceCount: documents.length,
    existingCount: planned.existingSkipped.length,
    candidates,
    blocked,
  };
}

function candidateCodes(plan: SyncPlan): string[] {
  return plan.candidates
    .map((candidate) => candidate.record.card_code)
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function messageForFailure(error: unknown, fallback: string): string {
  if (error instanceof CardSyncEngineError) return error.message;
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  const withoutUrls = error.message.replace(/(?:cloud|https?):\/\/\S+/giu, '[已隐藏地址]');
  let withoutSecrets = withoutUrls;
  for (const secret of [
    readCredential('CLOUDBASE_SECRET_ID', 'CLOUDBASE_SECRETID'),
    readCredential('CLOUDBASE_SECRET_KEY', 'CLOUDBASE_SECRETKEY'),
  ]) {
    if (secret) withoutSecrets = withoutSecrets.split(secret).join('[已隐藏凭据]');
  }
  return withoutSecrets.slice(0, 300);
}

async function insertCard(
  client: PoolClient,
  record: CardInsertRecord,
  actorUserId: string
): Promise<boolean> {
  const result = await client.query<{ card_code: string }>(
    `
      INSERT INTO cards (
        card_code, card_type, name_jp, name_cn,
        work_names, group_names, unit_name, unit_name_raw,
        cost, blade, hearts, blade_hearts, score, requirements,
        card_text_jp, card_text_cn, image_filename, image_source_uri,
        rare, product, product_code, source_external_id, source_flags, status, updated_by
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25
      )
      ON CONFLICT (card_code) DO NOTHING
      RETURNING card_code
    `,
    [
      record.card_code,
      record.card_type,
      record.name_jp,
      record.name_cn,
      record.work_names == null ? null : JSON.stringify(record.work_names),
      record.group_names == null ? null : JSON.stringify(record.group_names),
      record.unit_name,
      record.unit_name_raw,
      record.cost,
      record.blade,
      JSON.stringify(record.hearts ?? []),
      record.blade_hearts == null ? null : JSON.stringify(record.blade_hearts),
      record.score,
      JSON.stringify(record.requirements ?? []),
      record.card_text_jp,
      record.card_text_cn,
      record.image_filename,
      record.image_source_uri,
      record.rare,
      record.product,
      record.product_code,
      record.source_external_id,
      record.source_flags == null ? null : JSON.stringify(record.source_flags),
      record.status,
      actorUserId,
    ]
  );
  return result.rowCount === 1;
}

async function cleanupUploadedKeys(keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      await minioClient.removeObject(config.minio.bucket, key);
    } catch {
      // Best effort only. Failure details must not expose storage configuration.
    }
  }
}

async function applyCandidate(
  candidate: PreparedCandidate,
  cloudbase: CloudBaseApp,
  actorUserId: string
): Promise<CardSyncEngineApplyItem> {
  const cardCode = candidate.record.card_code;
  const image = await processCandidateImage(
    candidate,
    cloudbase,
    { client: minioClient, bucket: config.minio.bucket },
    { overwriteImages: CARD_SYNC_POLICY.overwriteImages }
  );
  if (!image.ok) {
    return { cardCode, result: 'FAILED', message: '卡图下载、处理或上传失败' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await insertCard(client, candidate.record, actorUserId);
    await client.query('COMMIT');
    if (!inserted) {
      // A concurrent importer may now own these immutable card image keys. Keep them intact.
      return { cardCode, result: 'SKIPPED', message: '卡牌已存在，未覆盖现有数据' };
    }
    return { cardCode, result: 'SUCCEEDED', message: null };
  } catch (error) {
    await client.query('ROLLBACK');
    await cleanupUploadedKeys(image.uploadedKeys);
    return { cardCode, result: 'FAILED', message: messageForFailure(error, '写入卡牌失败') };
  } finally {
    client.release();
  }
}

export const cloudbaseCardSyncEngine: CardSyncEngine = {
  getConfigurationStatus: configurationStatus,

  async preview(): Promise<CardSyncEnginePreview> {
    const plan = await buildSyncPlan();
    return {
      sourceHash: plan.sourceHash,
      generatedAt: new Date().toISOString(),
      counts: {
        source: plan.sourceCount,
        existing: plan.existingCount,
        candidates: plan.candidates.length,
        blocked: plan.blocked.length,
      },
      candidates: plan.candidates.map((candidate) => ({
        cardCode: candidate.record.card_code,
        name: nameFor(candidate.transform),
        cardType: candidate.record.card_type,
        imageFilename: candidate.record.image_filename,
        warnings: [...candidate.transform.warnings],
      })),
      blocked: plan.blocked,
    };
  },

  async apply(input: CardSyncEngineApplyInput): Promise<CardSyncEngineApplyResult> {
    const plan = await buildSyncPlan();
    const expectedCodes = [...input.expectedCandidateCardCodes].sort((a, b) =>
      a.localeCompare(b, 'en')
    );
    if (
      plan.sourceHash !== input.expectedSourceHash ||
      !sameStrings(candidateCodes(plan), expectedCodes)
    ) {
      throw new CardSyncPreviewStaleError();
    }

    const items: CardSyncEngineApplyItem[] = [];
    for (const candidate of plan.candidates) {
      items.push(await applyCandidate(candidate, plan.cloudbase, input.actorUserId));
    }
    return { sourceHash: plan.sourceHash, items };
  },
};
