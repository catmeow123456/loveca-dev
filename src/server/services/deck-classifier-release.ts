import { createHash } from 'node:crypto';
import type {
  DeckArchetypeRule,
  DeckArchetypeRuleConditions,
  DeckArchetypeTemplate,
  DeckCardInput,
  DeckClassifierSnapshot,
} from './deck-classifier-engine.js';
import {
  DEFAULT_LIVE_DISTANCE_WEIGHT,
  DEFAULT_MAX_DECK_DISTANCE,
  DEFAULT_MEMBER_DISTANCE_WEIGHT,
  DEFAULT_MIN_DECK_MARGIN,
  DECK_FINGERPRINT_VERSION,
  normalizeDeck,
} from './deck-classifier-engine.js';
import { stableJsonStringify } from './replay-payload-serialization.js';

export const DECK_CLASSIFIER_SNAPSHOT_SCHEMA_VERSION = 1;
export const DECK_CLASSIFIER_ALGORITHM_VERSION = 'loveca-deck-classifier-v1';

export interface DeckClassifierReleaseArchetype {
  readonly id: string;
  readonly archetypeKey: string;
  readonly name: string;
  readonly groupName: string;
  readonly description: string;
  readonly sortOrder: number;
}

export interface StoredDeckClassifierSnapshot extends DeckClassifierSnapshot {
  readonly schemaVersion: typeof DECK_CLASSIFIER_SNAPSHOT_SCHEMA_VERSION;
  readonly releaseVersion: number;
  readonly fingerprintVersion: typeof DECK_FINGERPRINT_VERSION;
  readonly archetypes: readonly DeckClassifierReleaseArchetype[];
  readonly templates: readonly DeckArchetypeTemplate[];
  readonly rules: readonly DeckArchetypeRule[];
}

export interface DraftArchetypeRow {
  readonly id: string;
  readonly archetype_key: string;
  readonly name: string;
  readonly group_name: string;
  readonly description: string;
  readonly sort_order: number;
}

export interface DraftTemplateRow {
  readonly id: string;
  readonly archetype_id: string;
  readonly cards: unknown;
}

export interface DraftRuleRow {
  readonly id: string;
  readonly archetype_id: string;
  readonly priority: number;
  readonly definition: unknown;
}

export function buildDeckClassifierSnapshot(input: {
  readonly releaseVersion: number;
  readonly archetypes: readonly DraftArchetypeRow[];
  readonly templates: readonly DraftTemplateRow[];
  readonly rules: readonly DraftRuleRow[];
}): StoredDeckClassifierSnapshot {
  if (!Number.isSafeInteger(input.releaseVersion) || input.releaseVersion <= 0) {
    throw new Error('卡组分类发布版本无效');
  }
  const archetypeIds = new Set(input.archetypes.map((row) => row.id));
  if (archetypeIds.size === 0 || archetypeIds.size !== input.archetypes.length) {
    throw new Error('至少需要一个有效且唯一的卡组分类名称');
  }

  const archetypes = input.archetypes
    .map((row): DeckClassifierReleaseArchetype => ({
      id: requireString(row.id, '卡组分类 ID'),
      archetypeKey: requireString(row.archetype_key, '卡组分类 key'),
      name: requireString(row.name, '卡组分类名称'),
      groupName: requireString(row.group_name, '卡组分类分组'),
      description: row.description,
      sortOrder: requireInteger(row.sort_order, '卡组分类顺序'),
    }))
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.archetypeKey.localeCompare(right.archetypeKey)
    );
  const templates = input.templates.map((row): DeckArchetypeTemplate => {
    if (!archetypeIds.has(row.archetype_id)) {
      throw new Error(`样板 ${row.id} 指向未启用的卡组分类`);
    }
    const cards = readTemplateCards(row.cards);
    const normalized = normalizeDeck(cards);
    if (!normalized.valid) {
      throw new Error(`样板 ${row.id} 不是合法的 48 MEMBER + 12 LIVE 构筑`);
    }
    return {
      templateId: requireString(row.id, '样板 ID'),
      archetypeId: row.archetype_id,
      cards,
      active: true,
    };
  });
  if (templates.length === 0) {
    throw new Error('至少需要一个启用的合法卡组样板');
  }
  const rules = input.rules.map((row): DeckArchetypeRule => {
    if (!archetypeIds.has(row.archetype_id)) {
      throw new Error(`规则 ${row.id} 指向未启用的卡组分类`);
    }
    return {
      ruleId: requireString(row.id, '规则 ID'),
      archetypeId: row.archetype_id,
      priority: requireInteger(row.priority, '规则优先级'),
      enabled: true,
      conditions: readRuleConditions(row.definition),
    };
  });

  return {
    schemaVersion: DECK_CLASSIFIER_SNAPSHOT_SCHEMA_VERSION,
    releaseVersion: input.releaseVersion,
    classifierVersion: DECK_CLASSIFIER_ALGORITHM_VERSION,
    fingerprintVersion: DECK_FINGERPRINT_VERSION,
    archetypes,
    templates,
    rules,
    memberDistanceWeight: DEFAULT_MEMBER_DISTANCE_WEIGHT,
    liveDistanceWeight: DEFAULT_LIVE_DISTANCE_WEIGHT,
    maxDistance: DEFAULT_MAX_DECK_DISTANCE,
    minMargin: DEFAULT_MIN_DECK_MARGIN,
  };
}

export function readDeckClassifierSnapshot(value: unknown): StoredDeckClassifierSnapshot {
  if (!isRecord(value) || value.schemaVersion !== DECK_CLASSIFIER_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error('卡组分类发布快照格式无效');
  }
  const releaseVersion = requirePositiveInteger(value.releaseVersion, '卡组分类发布版本');
  if (value.classifierVersion !== DECK_CLASSIFIER_ALGORITHM_VERSION) {
    throw new Error('卡组分类发布快照使用了当前服务不支持的分类算法版本');
  }
  if (value.fingerprintVersion !== DECK_FINGERPRINT_VERSION) {
    throw new Error('卡组分类发布快照使用了当前服务不支持的指纹版本');
  }
  if (
    !Array.isArray(value.archetypes) ||
    !Array.isArray(value.templates) ||
    !Array.isArray(value.rules)
  ) {
    throw new Error('卡组分类发布快照缺少名称、样板或规则');
  }
  const sanitized = buildDeckClassifierSnapshot({
    releaseVersion,
    archetypes: value.archetypes.map(readSnapshotArchetype),
    templates: value.templates.map(readSnapshotTemplate),
    rules: value.rules.map(readSnapshotRule),
  });
  return {
    ...sanitized,
    classifierVersion: DECK_CLASSIFIER_ALGORITHM_VERSION,
    fingerprintVersion: DECK_FINGERPRINT_VERSION,
    memberDistanceWeight: requirePositiveFiniteNumber(
      value.memberDistanceWeight,
      'MEMBER 距离权重'
    ),
    liveDistanceWeight: requirePositiveFiniteNumber(value.liveDistanceWeight, 'LIVE 距离权重'),
    maxDistance: requireNonNegativeFiniteNumber(value.maxDistance, '最大距离阈值'),
    minMargin: requireNonNegativeFiniteNumber(value.minMargin, '最小间隔阈值'),
  };
}

export function hashDeckClassifierSnapshot(snapshot: StoredDeckClassifierSnapshot): string {
  return `sha256:${createHash('sha256').update(stableJsonStringify(snapshot), 'utf8').digest('hex')}`;
}

export function readTemplateCards(value: unknown): readonly DeckCardInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('卡组样板必须包含卡牌');
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`卡组样板第 ${index + 1} 项格式无效`);
    }
    const cardType = entry.cardType;
    if (cardType !== 'MEMBER' && cardType !== 'LIVE') {
      throw new Error(`卡组样板第 ${index + 1} 项类型无效`);
    }
    return {
      baseCardCode: requireString(entry.baseCardCode, `卡组样板第 ${index + 1} 项卡号`),
      cardType,
      count: requirePositiveInteger(entry.count, `卡组样板第 ${index + 1} 项数量`),
    };
  });
}

export function readRuleConditions(value: unknown): DeckArchetypeRuleConditions {
  if (!isRecord(value)) {
    throw new Error('卡组识别规则定义必须是对象');
  }
  const result: DeckArchetypeRuleConditions = {
    includeAll: readOptionalConstraints(value.includeAll, '全部包含'),
    includeAny: readOptionalConstraints(value.includeAny, '任一包含'),
    forbidAny: readOptionalConstraints(value.forbidAny, '禁止包含'),
    countSums: readOptionalCountSums(value.countSums),
  };
  const conditionCount =
    (result.includeAll?.length ?? 0) +
    (result.includeAny?.length ?? 0) +
    (result.forbidAny?.length ?? 0) +
    (result.countSums?.length ?? 0);
  if (conditionCount === 0) {
    throw new Error('卡组识别规则至少需要一个条件');
  }
  return result;
}

function readSnapshotArchetype(value: unknown): DraftArchetypeRow {
  if (!isRecord(value)) throw new Error('卡组分类发布快照中的名称无效');
  return {
    id: requireString(value.id, '卡组分类 ID'),
    archetype_key: requireString(value.archetypeKey, '卡组分类 key'),
    name: requireString(value.name, '卡组分类名称'),
    group_name: requireString(value.groupName, '卡组分类分组'),
    description: typeof value.description === 'string' ? value.description : '',
    sort_order: requireInteger(value.sortOrder, '卡组分类顺序'),
  };
}

function readSnapshotTemplate(value: unknown): DraftTemplateRow {
  if (!isRecord(value)) throw new Error('卡组分类发布快照中的样板无效');
  return {
    id: requireString(value.templateId, '样板 ID'),
    archetype_id: requireString(value.archetypeId, '样板卡组分类 ID'),
    cards: value.cards,
  };
}

function readSnapshotRule(value: unknown): DraftRuleRow {
  if (!isRecord(value)) throw new Error('卡组分类发布快照中的规则无效');
  return {
    id: requireString(value.ruleId, '规则 ID'),
    archetype_id: requireString(value.archetypeId, '规则卡组分类 ID'),
    priority: typeof value.priority === 'number' ? value.priority : 100,
    definition: value.conditions,
  };
}

function readOptionalConstraints(value: unknown, label: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label}条件必须是数组`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${label}第 ${index + 1} 项格式无效`);
    const cardType = readOptionalCardType(entry.cardType, `${label}第 ${index + 1} 项`);
    const minCount = readOptionalNonNegativeInteger(entry.minCount, `${label}最少数量`);
    const maxCount = readOptionalNonNegativeInteger(entry.maxCount, `${label}最多数量`);
    if (minCount !== undefined && maxCount !== undefined && minCount > maxCount) {
      throw new Error(`${label}第 ${index + 1} 项最少数量不能大于最多数量`);
    }
    return {
      baseCardCode: requireString(entry.baseCardCode, `${label}第 ${index + 1} 项卡号`),
      ...(cardType ? { cardType } : {}),
      ...(minCount === undefined ? {} : { minCount }),
      ...(maxCount === undefined ? {} : { maxCount }),
    };
  });
}

function readOptionalCountSums(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('合计数量条件必须是数组');
  return value.map((entry, index) => {
    if (
      !isRecord(entry) ||
      !Array.isArray(entry.baseCardCodes) ||
      entry.baseCardCodes.length === 0
    ) {
      throw new Error(`合计数量第 ${index + 1} 项格式无效`);
    }
    const cardType = readOptionalCardType(entry.cardType, `合计数量第 ${index + 1} 项`);
    const minCount = readOptionalNonNegativeInteger(entry.minCount, '合计最少数量');
    const maxCount = readOptionalNonNegativeInteger(entry.maxCount, '合计最多数量');
    if (minCount === undefined && maxCount === undefined) {
      throw new Error(`合计数量第 ${index + 1} 项至少需要最少或最多数量`);
    }
    if (minCount !== undefined && maxCount !== undefined && minCount > maxCount) {
      throw new Error(`合计数量第 ${index + 1} 项最少数量不能大于最多数量`);
    }
    const baseCardCodes = entry.baseCardCodes.map((cardCode, cardIndex) =>
      requireString(cardCode, `合计数量第 ${index + 1} 项第 ${cardIndex + 1} 个卡号`)
    );
    if (new Set(baseCardCodes).size !== baseCardCodes.length) {
      throw new Error(`合计数量第 ${index + 1} 项包含重复卡号`);
    }
    return {
      baseCardCodes,
      ...(cardType ? { cardType } : {}),
      ...(minCount === undefined ? {} : { minCount }),
      ...(maxCount === undefined ? {} : { maxCount }),
    };
  });
}

function readOptionalCardType(value: unknown, label: string): 'MEMBER' | 'LIVE' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'MEMBER' && value !== 'LIVE') throw new Error(`${label}卡牌类型无效`);
  return value;
}

function readOptionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  const result = requireInteger(value, label);
  if (result < 0) throw new Error(`${label}不能为负数`);
  return result;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const result = requireInteger(value, label);
  if (result <= 0) throw new Error(`${label}必须为正整数`);
  return result;
}

function requirePositiveFiniteNumber(value: unknown, label: string): number {
  const result = requireNonNegativeFiniteNumber(value, label);
  if (result <= 0) throw new Error(`${label}必须大于零`);
  return result;
}

function requireNonNegativeFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label}无效`);
  }
  return value;
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${label}无效`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label}不能为空`);
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
