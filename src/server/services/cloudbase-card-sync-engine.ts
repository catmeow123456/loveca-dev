import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { minioClient } from './minio-service.js';
import {
  CARD_SYNC_POLICY,
  CardSyncEngineError,
  CardSyncLeaseLostError,
  CardSyncPreviewStaleError,
  type CardSyncEngine,
  type CardSyncEngineApplyInput,
  type CardSyncEngineApplyItem,
  type CardSyncEngineApplyResult,
  type CardSyncEngineBlockedItem,
  type CardSyncEngineConfigurationStatus,
  type CardSyncEnginePreview,
} from './card-sync-engine.js';
import { leaseIdentity, lockAndRenewCardSyncLease } from './card-sync-lease.js';
import {
  DEFAULT_CLOUDBASE_BATCH_SIZE,
  buildCloudbaseCardSnapshot,
  buildPreparedCandidates,
  createCloudbaseAppWithCredentials,
  processCandidateImage,
  readCloudbaseDocuments,
  reconcileCardImageReference,
  withVersionedImageReference,
  type CardInsertRecord,
  type CloudBaseApp,
  type ExistingCardRow,
  type ExistingImageMetadataIssue,
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

function readCredential(primary: string): string | null {
  const value = process.env[primary]?.trim();
  return value || null;
}

export function getCloudbaseCardSyncConfigurationStatus(): CardSyncEngineConfigurationStatus {
  const missing: string[] = [];
  if (!readCredential('CLOUDBASE_ENV_ID')) missing.push(CONFIGURATION_KEYS[0]);
  if (!readCredential('CLOUDBASE_SECRET_ID')) {
    missing.push(CONFIGURATION_KEYS[1]);
  }
  if (!readCredential('CLOUDBASE_SECRET_KEY')) {
    missing.push(CONFIGURATION_KEYS[2]);
  }
  return { configured: missing.length === 0, missing };
}

function createConfiguredCloudbase(): CloudBaseApp {
  const status = getCloudbaseCardSyncConfigurationStatus();
  if (!status.configured) {
    throw new CardSyncEngineError('NOT_CONFIGURED', `缺少服务端配置：${status.missing.join('、')}`);
  }
  return createCloudbaseAppWithCredentials({
    envId: readCredential('CLOUDBASE_ENV_ID')!,
    secretId: readCredential('CLOUDBASE_SECRET_ID')!,
    secretKey: readCredential('CLOUDBASE_SECRET_KEY')!,
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
  candidatesSkipped: ReturnType<typeof buildPreparedCandidates>['skipped'],
  existingImageMetadataIssues: readonly ExistingImageMetadataIssue[]
): CardSyncEngineBlockedItem[] {
  const blocked: CardSyncEngineBlockedItem[] = snapshot.invalidRows.map((row) => ({
    cardCode: null,
    code: row.reason === 'missing card_code' ? 'MISSING_CARD_CODE' : 'INVALID_CARD_CODE',
    message:
      row.reason === 'missing card_code'
        ? `上游第 ${row.rowNumber} 条记录缺少卡牌编号`
        : `上游第 ${row.rowNumber} 条记录的卡牌编号不符合规范`,
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
  for (const issue of existingImageMetadataIssues) {
    blocked.push({
      cardCode: issue.cardCode,
      code: 'EXISTING_IMAGE_METADATA_INVALID',
      message: `现有卡牌的版本化图片标记无效：${issue.reason}`,
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
    'SELECT card_code, image_filename, source_flags FROM cards ORDER BY card_code'
  );
  const planned = buildPreparedCandidates(snapshot.transforms, existingResult.rows);
  const blocked = blockedFromSnapshot(
    snapshot,
    planned.skipped,
    planned.existingImageMetadataIssues
  );
  const candidates: PreparedCandidate[] = [];

  for (const candidate of planned.existingImageMetadataIssues.length > 0 ? [] : planned.prepared) {
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
    readCredential('CLOUDBASE_SECRET_ID'),
    readCredential('CLOUDBASE_SECRET_KEY'),
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

async function cleanupUploadedKeys(
  keys: readonly string[],
  context: { readonly runId: string; readonly cardCode: string }
): Promise<string[]> {
  const failures: string[] = [];
  for (const key of keys) {
    try {
      await minioClient.removeObject(config.minio.bucket, key);
    } catch (error) {
      failures.push(key);
      console.error('[CardSync] Image cleanup failed', {
        ...context,
        objectKey: key,
        message: messageForFailure(error, '对象删除失败'),
      });
    }
  }
  return failures;
}

async function rollbackTransaction(client: PoolClient): Promise<boolean> {
  try {
    await client.query('ROLLBACK');
    return true;
  } catch {
    return false;
  }
}

async function applyCandidate(
  candidate: PreparedCandidate,
  cloudbase: CloudBaseApp,
  actorUserId: string,
  input: CardSyncEngineApplyInput
): Promise<CardSyncEngineApplyItem> {
  const cardCode = candidate.record.card_code;
  await input.execution.assertCurrent();
  const image = await processCandidateImage(
    candidate,
    cloudbase,
    { client: minioClient, bucket: config.minio.bucket },
    {
      overwriteImages: CARD_SYNC_POLICY.overwriteImages,
      imageObjectVersion: `${input.runId}:${input.execution.token}:${input.execution.generation}`,
      signal: input.execution.signal,
      assertCurrent: input.execution.assertCurrent,
    }
  );
  if (image.cleanupFailures.length > 0) {
    console.error('[CardSync] Image upload rollback was incomplete', {
      runId: input.runId,
      cardCode,
      objectKeys: image.cleanupFailures,
    });
  }
  await input.execution.assertCurrent();
  if (!image.ok) {
    return {
      cardCode,
      result: 'FAILED',
      message:
        image.cleanupFailures.length > 0
          ? '卡图处理失败，且部分对象清理失败，需要人工检查'
          : '卡图下载、处理或上传失败',
    };
  }
  if (!image.imageFilename) {
    throw new CardSyncEngineError('IMAGE_RESULT_INVALID', '卡图处理结果缺少版本化文件名');
  }
  if (!candidate.imagePlan.imageBaseName) {
    throw new CardSyncEngineError('IMAGE_PLAN_INVALID', '卡图计划缺少原始文件名');
  }
  const record = withVersionedImageReference(
    candidate.record,
    image.imageFilename,
    candidate.imagePlan.imageBaseName
  );

  const client = await pool.connect();
  let inserted = false;
  let commitAttempted = false;
  let destroyClient = false;
  try {
    await client.query('BEGIN');
    await lockAndRenewCardSyncLease(client, leaseIdentity(input.runId, input.execution));
    inserted = await insertCard(client, record, actorUserId);
    commitAttempted = true;
    await client.query('COMMIT');
    if (!inserted) {
      const cleanupFailures = await cleanupUploadedKeys(image.uploadedKeys, {
        runId: input.runId,
        cardCode,
      });
      return {
        cardCode,
        result: 'SKIPPED',
        message:
          cleanupFailures.length > 0
            ? '卡牌已存在；本任务未引用卡图清理失败，需要人工检查'
            : '卡牌已存在，未覆盖现有数据',
      };
    }
    return { cardCode, result: 'SUCCEEDED', message: null };
  } catch (error) {
    const rollbackConfirmed = await rollbackTransaction(client);
    destroyClient = !rollbackConfirmed;
    if (commitAttempted) {
      const reference = await reconcileCardImageReference(
        pool,
        cardCode,
        image.imageFilename,
        rollbackConfirmed
      );
      if (reference.status === 'REFERENCED') {
        return inserted
          ? { cardCode, result: 'SUCCEEDED', message: null }
          : { cardCode, result: 'SKIPPED', message: '卡牌已存在，未覆盖现有数据' };
      }
      if (reference.status === 'UNKNOWN') {
        console.error('[CardSync] Card commit outcome is unknown; task images were preserved', {
          runId: input.runId,
          cardCode,
          imageFilename: image.imageFilename,
          rollbackConfirmed,
          message: reference.error ?? messageForFailure(error, '数据库提交结果无法确认'),
        });
        return {
          cardCode,
          result: 'FAILED',
          message: '数据库提交结果无法确认；已保留本任务卡图，需要人工检查',
        };
      }
    }
    const cleanupFailures = await cleanupUploadedKeys(image.uploadedKeys, {
      runId: input.runId,
      cardCode,
    });
    if (error instanceof CardSyncLeaseLostError) throw error;
    return {
      cardCode,
      result: 'FAILED',
      message:
        cleanupFailures.length > 0
          ? '写入卡牌失败，且部分卡图清理失败，需要人工检查'
          : messageForFailure(error, '写入卡牌失败'),
    };
  } finally {
    client.release(destroyClient);
  }
}

export const cloudbaseCardSyncEngine: CardSyncEngine = {
  getConfigurationStatus: getCloudbaseCardSyncConfigurationStatus,

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
      await input.execution.assertCurrent();
      items.push(await applyCandidate(candidate, plan.cloudbase, input.actorUserId, input));
    }
    return { sourceHash: plan.sourceHash, items };
  },
};
