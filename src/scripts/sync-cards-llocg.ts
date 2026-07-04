/**
 * llocg_db 卡牌数据同步脚本
 *
 * 从 llocg_db git submodule 读取完整卡牌数据并同步到 PostgreSQL cards 表
 * 包含游戏数据字段（cost, hearts, requirements 等）
 * 中日字段分列：name_cn/name_jp、card_text_cn/card_text_jp 分别保存来源文本
 *
 * 同步策略:
 * - 新卡: INSERT (status=PUBLISHED)
 * - 已有卡: 保留 DB 中的名称/效果文本/product；仅比对规则/来源字段差异后进入交互审核
 * - 非 TTY 环境发现待更新卡时终止，避免无人值守覆盖
 *
 * 使用方法:
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts --dry-run
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline/promises';
import { Pool } from 'pg';
import { normalizeCardCode } from '../shared/utils/card-code';
import { inheritMissingBladeHeartsByBase } from '../domain/card-data/blade-heart-inheritance';

// ============================================
// 配置
// ============================================

const CONFIG = {
  databaseUrl: process.env.DATABASE_URL!,
  sources: {
    cardsJp: path.resolve('llocg_db/json/cards.json'),
    cardsCn: path.resolve('llocg_db/json/cards_cn.json'),
  },
  batchSize: 100,
};

const DRY_RUN = process.argv.includes('--dry-run');

// ============================================
// 类型定义
// ============================================

interface LlocgJpCard {
  card_no: string;
  name: string;
  type: string; // メンバー / ライブ / エネルギー
  series?: string;
  unit?: string;
  cost?: number;
  blade?: number;
  base_heart?: Record<string, number>;
  blade_heart?: Record<string, number>;
  score?: number;
  need_heart?: Record<string, number>;
  special_heart?: Record<string, number>;
  ability?: string;
  rare?: string;
  product?: string;
  _img?: string;
}

interface LlocgCnCard {
  card_name_org?: string;
  card_name_cn?: string;
  card_type?: number; // 13=MEMBER, 14=LIVE, 15=ENERGY
  _img?: string;
  detail?: {
    card_name_org?: string;
    card_name_cn?: string;
    card_number?: string;
    card_type?: number;
    ability?: string;
    cost?: number | null;
    trigger_count?: number | null;
    rarity?: string;
    display_attacks?: string;
  };
}

interface CardUpsertRecord {
  card_code: string;
  card_type: 'MEMBER' | 'LIVE' | 'ENERGY';
  name_jp: string | null;
  name_cn: string | null;
  card_text_jp: string | null;
  card_text_cn: string | null;
  image_filename: string | null;
  cost: number | null;
  blade: number | null;
  hearts: { color: string; count: number }[] | null;
  blade_hearts: { effect: string; heartColor?: string }[] | null;
  score: number | null;
  requirements: { color: string; count: number }[] | null;
  unit_name: string | null;
  work_names: string[] | null;
  rare: string | null;
  product: string | null;
  status: 'PUBLISHED';
}

interface ChangedCardSummary {
  card_code: string;
  name: string;
  action: 'INSERT' | 'UPDATE';
  changedFields?: string[];
}

interface ExistingCardRow {
  card_code: string;
  card_type: 'MEMBER' | 'LIVE' | 'ENERGY';
  name_jp: string | null;
  name_cn: string | null;
  card_text_jp: string | null;
  card_text_cn: string | null;
  image_filename: string | null;
  cost: number | null;
  blade: number | null;
  hearts: { color: string; count: number }[] | null;
  blade_hearts: { effect: string; heartColor?: string }[] | null;
  score: number | null;
  requirements: { color: string; count: number }[] | null;
  unit_name: string | null;
  work_names: string[] | null;
  rare: string | null;
  product: string | null;
  status: 'DRAFT' | 'PUBLISHED';
}

interface PendingUpdate {
  existing: ExistingCardRow;
  card: CardUpsertRecord;
  changedFields: string[];
}

const EXISTING_PRESERVED_FIELDS = [
  'name_jp',
  'name_cn',
  'card_text_jp',
  'card_text_cn',
  'product',
] as const;

// ============================================
// 常量映射
// ============================================

const HEART_COLOR_MAP: Record<string, string> = {
  heart01: 'PINK',
  heart02: 'RED',
  heart03: 'YELLOW',
  heart04: 'GREEN',
  heart05: 'BLUE',
  heart06: 'PURPLE',
  heart0: 'RAINBOW',
};

const BLADE_HEART_COLOR_MAP: Record<string, string> = {
  b_heart01: 'PINK',
  b_heart02: 'RED',
  b_heart03: 'YELLOW',
  b_heart04: 'GREEN',
  b_heart05: 'BLUE',
  b_heart06: 'PURPLE',
  b_all: 'RAINBOW',
};

const JP_TYPE_MAP: Record<string, 'MEMBER' | 'LIVE' | 'ENERGY'> = {
  メンバー: 'MEMBER',
  ライブ: 'LIVE',
  エネルギー: 'ENERGY',
};

const CN_TYPE_MAP: Record<number, 'MEMBER' | 'LIVE' | 'ENERGY'> = {
  13: 'MEMBER',
  14: 'LIVE',
  15: 'ENERGY',
};

// ============================================
// 字段转换
// ============================================

function convertHearts(heartObj: Record<string, number>): { color: string; count: number }[] {
  const result: { color: string; count: number }[] = [];
  for (const [key, count] of Object.entries(heartObj)) {
    const color = HEART_COLOR_MAP[key];
    if (color && count > 0) {
      result.push({ color, count });
    } else if (!color) {
      console.warn(`  Warning: unknown heart key "${key}"`);
    }
  }
  return result;
}

function convertBladeHearts(
  bladeHeartObj: Record<string, number>
): { effect: string; heartColor?: string }[] {
  const result: { effect: string; heartColor?: string }[] = [];
  for (const [key, count] of Object.entries(bladeHeartObj)) {
    const heartColor = BLADE_HEART_COLOR_MAP[key];
    if (heartColor) {
      for (let i = 0; i < count; i++) {
        result.push({ effect: 'HEART', heartColor });
      }
    } else {
      console.warn(`  Warning: unknown blade_heart key "${key}"`);
    }
  }
  return result;
}

function convertSpecialHearts(
  specialObj: Record<string, number>
): { effect: string; heartColor?: string }[] {
  const result: { effect: string; heartColor?: string }[] = [];
  for (const [key, count] of Object.entries(specialObj)) {
    const effect = key === 'draw' ? 'DRAW' : key === 'score' ? 'SCORE' : null;
    if (effect) {
      for (let i = 0; i < count; i++) {
        result.push({ effect });
      }
    } else {
      console.warn(`  Warning: unknown special_heart key "${key}"`);
    }
  }
  return result;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function formatValue(value: unknown): string {
  if (value == null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return JSON.stringify(value, null, 2);
}

function getChangedFields(existing: ExistingCardRow, next: CardUpsertRecord): string[] {
  const changedFields: string[] = [];

  if (existing.card_type !== next.card_type) changedFields.push('card_type');
  if (existing.name_jp !== next.name_jp) changedFields.push('name_jp');
  if (existing.name_cn !== next.name_cn) changedFields.push('name_cn');
  if (existing.card_text_jp !== next.card_text_jp) changedFields.push('card_text_jp');
  if (existing.card_text_cn !== next.card_text_cn) changedFields.push('card_text_cn');
  if (existing.image_filename !== next.image_filename) changedFields.push('image_filename');
  if (existing.cost !== next.cost) changedFields.push('cost');
  if (existing.blade !== next.blade) changedFields.push('blade');
  if (stableJson(existing.hearts) !== stableJson(next.hearts)) changedFields.push('hearts');
  if (stableJson(existing.blade_hearts) !== stableJson(next.blade_hearts)) {
    changedFields.push('blade_hearts');
  }
  if (existing.score !== next.score) changedFields.push('score');
  if (stableJson(existing.requirements) !== stableJson(next.requirements)) {
    changedFields.push('requirements');
  }
  if (existing.unit_name !== next.unit_name) changedFields.push('unit_name');
  if (stableJson(existing.work_names) !== stableJson(next.work_names))
    changedFields.push('work_names');
  if (existing.rare !== next.rare) changedFields.push('rare');
  if (existing.product !== next.product) changedFields.push('product');
  if (existing.status !== next.status) changedFields.push('status');

  return changedFields;
}

function getExistingPreservedChangedFields(
  existing: ExistingCardRow,
  next: CardUpsertRecord
): string[] {
  return EXISTING_PRESERVED_FIELDS.filter((field) => existing[field] !== next[field]);
}

function preserveExistingFields(
  existing: ExistingCardRow,
  next: CardUpsertRecord
): CardUpsertRecord {
  return {
    ...next,
    name_jp: existing.name_jp,
    name_cn: existing.name_cn,
    card_text_jp: existing.card_text_jp,
    card_text_cn: existing.card_text_cn,
    product: existing.product,
  };
}

function displayName(card: Pick<CardUpsertRecord, 'card_code' | 'name_cn' | 'name_jp'>): string {
  return card.name_cn?.trim() || card.name_jp?.trim() || card.card_code;
}

function splitLines(value: string | null | undefined): string[] | null {
  const items = value
    ?.split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : null;
}

/** 从 JP 卡 + CN 数据构建入库记录 */
function transformJpCard(jp: LlocgJpCard, cn: LlocgCnCard | undefined): CardUpsertRecord {
  const cardType = JP_TYPE_MAP[jp.type];
  if (!cardType) {
    throw new Error(`Unknown type: "${jp.type}" for card ${jp.card_no}`);
  }

  const cnDetail = cn?.detail;

  // CN 数据中能量卡的 card_name_cn 可能是"能量"（类型名）而非实际卡名
  const cnName = cnDetail?.card_name_cn || cn?.card_name_cn;
  const nameCn = cnName && cnName !== '能量' && cnName !== 'エネルギー' ? cnName : null;
  const nameJp = jp.name || (!nameCn && cnName ? cnName : null) || jp.card_no;
  const cardTextJp = jp.ability || null;
  const cardTextCn = cnDetail?.ability || null;

  // Hearts
  let hearts: { color: string; count: number }[] | null = null;
  if (jp.base_heart && Object.keys(jp.base_heart).length > 0) {
    hearts = convertHearts(jp.base_heart);
  }

  // Blade hearts + special hearts
  const bhItems: { effect: string; heartColor?: string }[] = [];
  if (jp.blade_heart && Object.keys(jp.blade_heart).length > 0) {
    bhItems.push(...convertBladeHearts(jp.blade_heart));
  }
  if (jp.special_heart && Object.keys(jp.special_heart).length > 0) {
    bhItems.push(...convertSpecialHearts(jp.special_heart));
  }

  // Requirements
  let requirements: { color: string; count: number }[] | null = null;
  if (jp.need_heart && Object.keys(jp.need_heart).length > 0) {
    requirements = convertHearts(jp.need_heart);
  }

  const imageFilename = jp._img ? jp._img.replace(/^.*\//, '') : null;

  const normalizedUnitName = normalizeUnitName(jp.unit);

  // 检查 group/unit 是否为空，输出警告
  if (!jp.series) {
    console.warn(`  Warning: ${jp.card_no} (${cardType}) missing group/series`);
  }
  if (!jp.unit && cardType !== 'LIVE') {
    // LIVE 卡通常没有 unit，所以只对 MEMBER 和 ENERGY 警告
    console.warn(`  Warning: ${jp.card_no} (${cardType}) missing unit`);
  }

  return {
    card_code: normalizeCardCode(jp.card_no),
    card_type: cardType,
    name_jp: nameJp,
    name_cn: nameCn,
    card_text_jp: cardTextJp,
    card_text_cn: cardTextCn,
    image_filename: imageFilename,
    cost: jp.cost ?? null,
    blade: jp.blade ?? null,
    hearts: hearts && hearts.length > 0 ? hearts : null,
    blade_hearts: bhItems.length > 0 ? bhItems : null,
    score: jp.score ?? null,
    requirements: requirements && requirements.length > 0 ? requirements : null,
    unit_name: normalizedUnitName,
    work_names: splitLines(jp.series),
    rare: jp.rare || null,
    product: jp.product || null,
    status: 'PUBLISHED',
  };
}

/** 从 CN-only 卡构建入库记录 */
function transformCnOnlyCard(cardNo: string, cn: LlocgCnCard): CardUpsertRecord {
  const cnType = cn.card_type ?? cn.detail?.card_type;
  const cardType = cnType != null ? CN_TYPE_MAP[cnType] : undefined;
  if (!cardType) {
    throw new Error(`Unknown CN card_type: ${cnType} for card ${cardNo}`);
  }

  const cnDetail = cn.detail;
  const name =
    cnDetail?.card_name_cn ||
    cn.card_name_cn ||
    cnDetail?.card_name_org ||
    cn.card_name_org ||
    cardNo;
  const imageFilename = cn._img ? cn._img.replace(/^.*\//, '') : null;

  return {
    card_code: normalizeCardCode(cardNo),
    card_type: cardType,
    name_jp: cnDetail?.card_name_org || cn.card_name_org || null,
    name_cn: name,
    card_text_jp: null,
    card_text_cn: cnDetail?.ability || null,
    image_filename: imageFilename,
    cost: cnDetail?.cost ?? null,
    blade: cnDetail?.trigger_count ?? null,
    hearts: null, // CN data doesn't have structured heart data
    blade_hearts: null,
    score: null,
    requirements: null,
    unit_name: null,
    work_names: null,
    rare: cnDetail?.rarity || null,
    product: null,
    status: 'PUBLISHED',
  };
}

function normalizeUnitName(unit: string | null | undefined): string | null {
  const rawUnit = unit?.trim();
  if (!rawUnit) {
    return null;
  }

  const unwrapped = rawUnit.replace(/^「/, '').replace(/」$/, '');
  const normalized = unwrapped === 'みらくらぱーく!' ? 'みらくらぱーく！' : unwrapped;
  return `「${normalized}」`;
}

// ============================================
// 主逻辑
// ============================================

async function main() {
  console.log(`llocg_db Card Data Sync${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  if (!CONFIG.databaseUrl && !DRY_RUN) {
    console.error('Error: DATABASE_URL is required');
    console.log('\nUsage:');
    console.log('DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts');
    console.log('DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts --dry-run');
    process.exit(1);
  }

  // Step 1: 读取
  console.log('Step 1: Reading llocg_db sources...');

  const jpData = readJsonFile<Record<string, LlocgJpCard>>(CONFIG.sources.cardsJp, 'cards.json');
  const cnData = readJsonFile<Record<string, LlocgCnCard>>(CONFIG.sources.cardsCn, 'cards_cn.json');

  const jpCards = Object.entries(jpData);
  const memberCount = jpCards.filter(([, c]) => c.type === 'メンバー').length;
  const liveCount = jpCards.filter(([, c]) => c.type === 'ライブ').length;
  const energyCount = jpCards.filter(([, c]) => c.type === 'エネルギー').length;

  console.log(
    `  cards.json: ${jpCards.length} cards (MEMBER: ${memberCount}, LIVE: ${liveCount}, ENERGY: ${energyCount})`
  );
  console.log(`  cards_cn.json: ${Object.keys(cnData).length} cards`);

  // 构建 CN 标准化索引
  const cnByNorm = new Map<string, LlocgCnCard>();
  for (const [code, card] of Object.entries(cnData)) {
    cnByNorm.set(normalizeCardCode(code), card);
  }

  // Step 2: 转换
  console.log('\nStep 2: Transforming cards...');

  const cardMap = new Map<string, CardUpsertRecord>();
  let cnMatchCount = 0;
  let transformErrors = 0;

  // JP cards (主数据源)
  for (const [jpCode, jp] of jpCards) {
    try {
      const normCode = normalizeCardCode(jpCode);
      const cn = cnByNorm.get(normCode);
      if (cn) cnMatchCount++;
      const record = transformJpCard(jp, cn);
      cardMap.set(normCode, record);
    } catch (e) {
      console.error(`  Error transforming JP ${jpCode}: ${e}`);
      transformErrors++;
    }
  }

  // CN-only cards
  let cnOnlyCount = 0;
  for (const [cnCode, cn] of Object.entries(cnData)) {
    const normCode = normalizeCardCode(cnCode);
    if (!cardMap.has(normCode)) {
      try {
        cardMap.set(normCode, transformCnOnlyCard(cnCode, cn));
        cnOnlyCount++;
      } catch (e) {
        console.error(`  Error transforming CN-only ${cnCode}: ${e}`);
        transformErrors++;
      }
    }
  }

  const allCards = inheritMissingBladeHeartsByBase(Array.from(cardMap.values()));
  console.log(
    `  Total: ${allCards.length} cards (CN matched: ${cnMatchCount}, CN-only: ${cnOnlyCount}${transformErrors > 0 ? `, errors: ${transformErrors}` : ''})`
  );

  // Dry run
  if (DRY_RUN) {
    console.log('\nDry run - sample transformed cards:');
    for (const card of allCards.slice(0, 20)) {
      const extras: string[] = [];
      if (card.cost != null) extras.push(`cost=${card.cost}`);
      if (card.blade != null) extras.push(`blade=${card.blade}`);
      if (card.score != null) extras.push(`score=${card.score}`);
      if (card.hearts) extras.push(`hearts=${card.hearts.length}`);
      if (card.requirements) extras.push(`req=${card.requirements.length}`);
      if (card.work_names) extras.push(`works=${card.work_names.join('/')}`);
      if (card.product) extras.push(`product=${card.product}`);
      console.log(
        `  ${card.card_code} [${card.card_type}] ${displayName(card)} ${extras.join(' ')}`
      );
    }
    if (allCards.length > 20) {
      console.log(`  ... and ${allCards.length - 20} more`);
    }

    // 专门显示能量卡的 group/product 统计
    const energyCards = allCards.filter((c) => c.card_type === 'ENERGY');
    const energyWithGroup = energyCards.filter((c) => c.work_names && c.work_names.length > 0);
    const energyWithProduct = energyCards.filter((c) => c.product);
    console.log(`\nEnergy cards analysis:`);
    console.log(`  Total ENERGY cards: ${energyCards.length}`);
    console.log(`  With work_names: ${energyWithGroup.length}`);
    console.log(`  With product: ${energyWithProduct.length}`);

    // 显示几个能量卡样本
    console.log('\nSample ENERGY cards:');
    for (const card of energyCards.slice(0, 5)) {
      console.log(
        `  ${card.card_code}: name=${displayName(card)}, unit=${card.unit_name || 'NULL'}, works=${card.work_names?.join('/') || 'NULL'}, product=${card.product || 'NULL'}`
      );
    }

    console.log(`\nTotal: ${allCards.length} cards would be synced to DB.`);
    return;
  }

  // Step 3: 查询数据库已有卡牌
  console.log('\nStep 3: Checking existing cards in DB...');

  const pool = new Pool({ connectionString: CONFIG.databaseUrl });

  try {
    const { rows: existingRows } = await pool.query<ExistingCardRow>(`
      SELECT
        card_code, card_type, name_jp, name_cn, card_text_jp, card_text_cn, image_filename,
        cost, blade, hearts, blade_hearts, score, requirements,
        unit_name, work_names, rare, product, status
      FROM cards
    `);

    const publishedCodes = new Set<string>();
    const draftCodes = new Set<string>();
    const existingByCode = new Map<string, ExistingCardRow>();
    for (const r of existingRows) {
      existingByCode.set(r.card_code, r);
      if (r.status === 'PUBLISHED') {
        publishedCodes.add(r.card_code);
      } else {
        draftCodes.add(r.card_code);
      }
    }
    console.log(`  Found ${publishedCodes.size} published + ${draftCodes.size} draft cards`);

    // Step 4: 分类 - 新卡插入，已有卡仅在字段有变化时更新
    const newCards: CardUpsertRecord[] = [];
    const updateCards: PendingUpdate[] = [];
    let unchangedCount = 0;
    let ignoredPreservedDiffCardCount = 0;
    const ignoredPreservedDiffFieldCounts = new Map<string, number>();

    for (const card of allCards) {
      const existing = existingByCode.get(card.card_code);
      if (existing) {
        const ignoredPreservedFields = getExistingPreservedChangedFields(existing, card);
        if (ignoredPreservedFields.length > 0) {
          ignoredPreservedDiffCardCount++;
          for (const field of ignoredPreservedFields) {
            ignoredPreservedDiffFieldCounts.set(
              field,
              (ignoredPreservedDiffFieldCounts.get(field) ?? 0) + 1
            );
          }
        }

        const cardForUpdate = preserveExistingFields(existing, card);
        const changedFields = getChangedFields(existing, cardForUpdate);
        if (changedFields.length > 0) {
          updateCards.push({ existing, card: cardForUpdate, changedFields });
        } else {
          unchangedCount++;
        }
      } else {
        newCards.push(card);
      }
    }

    console.log(`\nStep 4: Categorizing cards...`);
    console.log(`  New cards to insert: ${newCards.length}`);
    console.log(`  Existing cards to update (DRAFT + PUBLISHED): ${updateCards.length}`);
    console.log(`  Unchanged existing cards: ${unchangedCount}`);
    if (ignoredPreservedDiffCardCount > 0) {
      const fieldSummary = [...ignoredPreservedDiffFieldCounts.entries()]
        .map(([field, count]) => `${field}=${count}`)
        .join(', ');
      console.log(
        `  Existing name/effect/product diffs ignored: ${ignoredPreservedDiffCardCount} cards (${fieldSummary})`
      );
    }

    if (newCards.length === 0 && updateCards.length === 0) {
      console.log('\nNo changes needed. Database is up to date.');
      return;
    }

    let approvedUpdateCards = updateCards;
    let skippedUpdateCount = 0;

    if (updateCards.length > 0) {
      console.log('\nStep 5: Reviewing pending updates...');
      approvedUpdateCards = await promptUpdateDecisions(updateCards);
      skippedUpdateCount = updateCards.length - approvedUpdateCards.length;
      console.log(`  Approved updates: ${approvedUpdateCards.length}`);
      console.log(`  Skipped updates: ${skippedUpdateCount}`);
    }

    // Step 6: 同步
    let insertedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;
    const changedCards: ChangedCardSummary[] = [];

    if (newCards.length > 0) {
      console.log(`\nStep 6a: Inserting ${newCards.length} new cards...`);
      const totalBatches = Math.ceil(newCards.length / CONFIG.batchSize);

      for (let i = 0; i < newCards.length; i += CONFIG.batchSize) {
        const batchNum = Math.floor(i / CONFIG.batchSize) + 1;
        const batch = newCards.slice(i, i + CONFIG.batchSize);

        try {
          for (const card of batch) {
            await pool.query(
              `
              INSERT INTO cards (card_code, card_type, name_jp, name_cn, card_text_jp, card_text_cn, image_filename,
                cost, blade, hearts, blade_hearts, score, requirements,
                unit_name, work_names, rare, product, status)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            `,
              [
                card.card_code,
                card.card_type,
                card.name_jp,
                card.name_cn,
                card.card_text_jp,
                card.card_text_cn,
                card.image_filename,
                card.cost,
                card.blade,
                JSON.stringify(card.hearts),
                JSON.stringify(card.blade_hearts),
                card.score,
                JSON.stringify(card.requirements),
                card.unit_name,
                card.work_names == null ? null : JSON.stringify(card.work_names),
                card.rare,
                card.product,
                card.status,
              ]
            );
          }
          console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} cards... OK`);
          insertedCount += batch.length;
          changedCards.push(
            ...batch.map((card) => ({
              card_code: card.card_code,
              name: displayName(card),
              action: 'INSERT' as const,
            }))
          );
        } catch (err) {
          console.error(`  Batch ${batchNum}/${totalBatches}: FAILED`, err);
          failedCount += batch.length;
        }
      }
    }

    if (approvedUpdateCards.length > 0) {
      console.log(`\nStep 6b: Updating ${approvedUpdateCards.length} approved existing cards...`);
      const totalBatches = Math.ceil(approvedUpdateCards.length / CONFIG.batchSize);

      for (let i = 0; i < approvedUpdateCards.length; i += CONFIG.batchSize) {
        const batchNum = Math.floor(i / CONFIG.batchSize) + 1;
        const batch = approvedUpdateCards.slice(i, i + CONFIG.batchSize);

        try {
          for (const { card } of batch) {
            await pool.query(
              `
              UPDATE cards SET
                card_type = $2, image_filename = $3, cost = $4, blade = $5,
                hearts = $6, blade_hearts = $7, score = $8, requirements = $9,
                unit_name = $10, work_names = $11, rare = $12,
                status = $13, updated_at = now()
              WHERE card_code = $1
            `,
              [
                card.card_code,
                card.card_type,
                card.image_filename,
                card.cost,
                card.blade,
                JSON.stringify(card.hearts),
                JSON.stringify(card.blade_hearts),
                card.score,
                JSON.stringify(card.requirements),
                card.unit_name,
                card.work_names == null ? null : JSON.stringify(card.work_names),
                card.rare,
                card.status,
              ]
            );
          }
          console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} cards... OK`);
          updatedCount += batch.length;
          changedCards.push(
            ...batch.map(({ card, changedFields }) => ({
              card_code: card.card_code,
              name: displayName(card),
              action: 'UPDATE' as const,
              changedFields,
            }))
          );
        } catch (err) {
          console.error(`  Batch ${batchNum}/${totalBatches}: FAILED`, err);
          failedCount += batch.length;
        }
      }
    }

    // Summary
    console.log('\nSummary:');
    console.log(
      `  Read: ${allCards.length} (JP: ${jpCards.length}, CN matched: ${cnMatchCount}, CN-only: ${cnOnlyCount})`
    );
    console.log(`  Inserted: ${insertedCount}`);
    console.log(`  Updated: ${updatedCount}`);
    console.log(`  Unchanged: ${unchangedCount}`);
    console.log(`  Skipped after review: ${skippedUpdateCount}`);
    if (failedCount > 0) {
      console.log(`  Failed: ${failedCount}`);
    }
    printChangedCards(changedCards);
  } finally {
    await pool.end();
  }
}

// ============================================
// 辅助函数
// ============================================

function readJsonFile<T>(filePath: string, displayName: string): T {
  if (!fs.existsSync(filePath)) {
    console.error(`  Error: ${displayName} not found at ${filePath}`);
    console.log('  Please ensure llocg_db submodule is initialized: git submodule update --init');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function printChangedCards(changedCards: ChangedCardSummary[]) {
  if (changedCards.length === 0) {
    return;
  }

  console.log('\nChanged rows:');
  for (const card of changedCards) {
    const changedFields =
      card.action === 'UPDATE' && card.changedFields && card.changedFields.length > 0
        ? ` fields=${card.changedFields.join(',')}`
        : '';
    console.log(`  [${card.action}] ${card.card_code} ${card.name}${changedFields}`);
  }
}

function printPendingUpdateCodes(updateCards: PendingUpdate[]) {
  if (updateCards.length === 0) {
    return;
  }

  console.log('\nPending update card codes:');
  console.log(`  ${updateCards.map(({ card }) => card.card_code).join(', ')}`);
}

function printUpdateDiff(update: PendingUpdate, index: number, total: number) {
  console.log(
    `\n[${index}/${total}] ${update.card.card_code} ${displayName(update.card)} fields=${update.changedFields.join(',')}`
  );

  for (const field of update.changedFields) {
    const key = field as keyof ExistingCardRow & keyof CardUpsertRecord;
    console.log(`  ${field}:`);
    console.log(`    before: ${formatValue(update.existing[key])}`);
    console.log(`    after:  ${formatValue(update.card[key])}`);
  }
}

async function promptUpdateDecisions(updateCards: PendingUpdate[]): Promise<PendingUpdate[]> {
  if (updateCards.length === 0) {
    return [];
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive review requires a TTY terminal');
  }

  printPendingUpdateCodes(updateCards);
  console.log('\nReviewing pending updates one by one. Input y to apply, n to skip.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const approved: PendingUpdate[] = [];

  try {
    for (let i = 0; i < updateCards.length; i++) {
      const update = updateCards[i];
      printUpdateDiff(update, i + 1, updateCards.length);

      while (true) {
        const answer = (await rl.question('  Apply this update? [y/n] ')).trim().toLowerCase();
        if (answer === 'y') {
          approved.push(update);
          console.log('  Decision: apply');
          break;
        }
        if (answer === 'n') {
          console.log('  Decision: skip');
          break;
        }
        console.log('  Please input y or n.');
      }
    }
  } finally {
    rl.close();
  }

  return approved;
}

main().catch(console.error);
