import { createHash } from 'node:crypto';
import { normalizeCardCode, validateCardCode } from '../../shared/utils/card-code.js';
import {
  readCloudbaseIdentity,
  transformRow,
  type PreparedCandidate,
  type ExistingCardRow,
} from '../../scripts/sync-cards-cloudbase-new.js';
import type { CardSyncEngineBlockedItem, CardSyncForceImport } from './card-sync-engine.js';

export interface ReviewEntry {
  readonly sourceKey: string;
  readonly rawCode: string | null;
  readonly name: string | null;
  readonly candidate: PreparedCandidate;
  readonly issues: readonly string[];
  readonly imageIssue: boolean;
}

export function buildCardSyncReviewEntries(
  documents: readonly Record<string, unknown>[],
  existing: readonly ExistingCardRow[]
) {
  const identities = documents.map(readCloudbaseIdentity);
  const counts = new Map<string, number>();
  for (const identity of identities) {
    if (identity.cardCode) {
      const code = normalizeCardCode(identity.cardCode);
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  const existingCodes = new Set(existing.map((row) => row.card_code));
  let existingCount = 0;
  const entries: ReviewEntry[] = [];
  for (const [index, document] of documents.entries()) {
    const identity = identities[index]!;
    const sourceKey = `row:${index + 1}`;
    const rawCode = identity.cardCode;
    const cardCode = rawCode
      ? normalizeCardCode(rawCode)
      : `UPSTREAM-${createHash('sha256').update(JSON.stringify(document)).digest('hex').slice(0, 16)}`;
    if (existingCodes.has(cardCode)) {
      existingCount++;
      continue;
    }
    const row = {
      rowNumber: index + 1,
      document,
      cardCode,
      sourceId: typeof document._id === 'string' ? document._id : null,
    };
    const regular = transformRow(row, 'DRAFT');
    const force = regular.record
      ? regular
      : transformRow(row, 'DRAFT', {
          name: identity.name ?? '未命名卡牌',
          cardType: identity.cardType ?? 'MEMBER',
        });
    const issues = [
      ...(rawCode
        ? validateCardCode(cardCode).errors
        : ['上游未提供编号；可填写编号或使用建议编号']),
      ...(counts.get(cardCode)! > 1
        ? ['上游存在重复编号；请选择其中一条，或填写不同的导入编号']
        : []),
      ...regular.errors,
    ];
    if (!identity.name) issues.push('上游未提供名称；可填写名称，默认保存为未命名卡牌');
    if (!identity.cardType) issues.push('上游未提供有效类型；请确认导入类型，默认成员卡');
    const imageIssue =
      !regular.imagePlan.sourceUri ||
      /占位|待补|待更新|placeholder|暂未提供/i.test(identity.name ?? '');
    if (imageIssue)
      issues.push(
        !regular.imagePlan.sourceUri
          ? '上游未提供卡图；可强制导入无图草稿'
          : '名称含占位提示，请核对后决定是否导入'
      );
    // Object names are derived locally, so arbitrary card codes never become storage paths.
    const imageBaseName = `sync-${createHash('sha256').update(cardCode).update(sourceKey).digest('hex').slice(0, 24)}`;
    entries.push({
      sourceKey,
      rawCode,
      name: identity.name,
      issues,
      imageIssue,
      candidate: {
        transform: force,
        record: force.record!,
        imagePlan: { ...force.imagePlan, imageBaseName },
      },
    });
  }
  return { entries, existingCount };
}

export function reviewBlockedItem(entry: ReviewEntry, extra?: string): CardSyncEngineBlockedItem {
  return {
    sourceKey: entry.sourceKey,
    cardCode: entry.rawCode,
    name: entry.name,
    cardType: entry.candidate.record.card_type,
    suggestedCardCode: entry.candidate.record.card_code,
    code: 'REVIEW_REQUIRED',
    imageIssue: entry.imageIssue || !!extra,
    message: [...entry.issues, ...(extra ? [extra] : [])].join('；'),
  };
}

export function forceReviewCandidate(
  entry: ReviewEntry,
  choice: CardSyncForceImport
): PreparedCandidate {
  const transform = transformRow(
    { ...entry.candidate.transform.row, cardCode: choice.cardCode },
    'DRAFT',
    choice
  );
  return {
    ...entry.candidate,
    transform,
    record: {
      ...transform.record!,
      source_flags: {
        ...transform.record!.source_flags,
        forceImported: true,
        importIssues: entry.issues,
      },
    },
  };
}
