/**
 * llocg_db 卡牌数据同步脚本
 *
 * 从 llocg_db git submodule 读取完整卡牌数据并同步到 PostgreSQL cards 表
 * 包含游戏数据字段（cost, hearts, requirements 等）
 * 中文数据优先：有中文时 name/card_text 使用中文，否则 fallback 日文
 *
 * 同步策略:
 * - 新卡: INSERT (status=DRAFT)
 * - 已有卡: UPSERT (覆盖，包括 PUBLISHED 状态)
 *
 * 使用方法:
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts
 * DATABASE_URL=postgresql://... npx tsx src/scripts/sync-cards-llocg.ts --dry-run
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { normalizeCardCode } from '../shared/utils/card-code';

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
  name: string;
  card_text: string | null;
  image_filename: string | null;
  cost: number | null;
  blade: number | null;
  hearts: { color: string; count: number }[] | null;
  blade_hearts: { effect: string; heartColor?: string }[] | null;
  score: number | null;
  requirements: { color: string; count: number }[] | null;
  unit_name: string | null;
  group_name: string | null;
  rare: string | null;
  product: string | null;
  status: 'DRAFT';
}

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
  'メンバー': 'MEMBER',
  'ライブ': 'LIVE',
  'エネルギー': 'ENERGY',
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

function convertBladeHearts(bladeHeartObj: Record<string, number>): { effect: string; heartColor?: string }[] {
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

function convertSpecialHearts(specialObj: Record<string, number>): { effect: string; heartColor?: string }[] {
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

/** 从 JP 卡 + CN 数据构建入库记录 */
function transformJpCard(jp: LlocgJpCard, cn: LlocgCnCard | undefined): CardUpsertRecord {
  const cardType = JP_TYPE_MAP[jp.type];
  if (!cardType) {
    throw new Error(`Unknown type: "${jp.type}" for card ${jp.card_no}`);
  }

  const cnDetail = cn?.detail;

  // 中文优先，但对于能量卡需要特殊处理
  // CN 数据中能量卡的 card_name_cn 可能是"能量"（类型名）而非实际卡名
  let name: string;
  const cnName = cnDetail?.card_name_cn || cn?.card_name_cn;
  if (cnName && cnName !== '能量' && cnName !== 'エネルギー') {
    name = cnName;
  } else {
    name = jp.name; // fallback 到 JP 名称
  }
  const cardText = cnDetail?.ability || jp.ability || null;

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

  // normalize 小组名：统一加上「」符号
  let normalizedUnitName: string | null = jp.unit || null;
  if (normalizedUnitName && !normalizedUnitName.startsWith('「')) {
    normalizedUnitName = `「${normalizedUnitName}」`;
  }

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
    name,
    card_text: cardText,
    image_filename: imageFilename,
    cost: jp.cost ?? null,
    blade: jp.blade ?? null,
    hearts: hearts && hearts.length > 0 ? hearts : null,
    blade_hearts: bhItems.length > 0 ? bhItems : null,
    score: jp.score ?? null,
    requirements: requirements && requirements.length > 0 ? requirements : null,
    unit_name: normalizedUnitName,
    group_name: jp.series || null,
    rare: jp.rare || null,
    product: jp.product || null,
    status: 'DRAFT',
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
  const name = cnDetail?.card_name_cn || cn.card_name_cn || cnDetail?.card_name_org || cn.card_name_org || cardNo;
  const cardText = cnDetail?.ability || null;
  const imageFilename = cn._img ? cn._img.replace(/^.*\//, '') : null;

  return {
    card_code: normalizeCardCode(cardNo),
    card_type: cardType,
    name,
    card_text: cardText,
    image_filename: imageFilename,
    cost: cnDetail?.cost ?? null,
    blade: cnDetail?.trigger_count ?? null,
    hearts: null, // CN data doesn't have structured heart data
    blade_hearts: null,
    score: null,
    requirements: null,
    unit_name: null,
    group_name: null,
    rare: cnDetail?.rarity || null,
    product: null,
    status: 'DRAFT',
  };
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

  console.log(`  cards.json: ${jpCards.length} cards (MEMBER: ${memberCount}, LIVE: ${liveCount}, ENERGY: ${energyCount})`);
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

  const allCards = Array.from(cardMap.values());
  console.log(`  Total: ${allCards.length} cards (CN matched: ${cnMatchCount}, CN-only: ${cnOnlyCount}${transformErrors > 0 ? `, errors: ${transformErrors}` : ''})`);

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
      if (card.group_name) extras.push(`group=${card.group_name}`);
      if (card.product) extras.push(`product=${card.product}`);
      console.log(`  ${card.card_code} [${card.card_type}] ${card.name} ${extras.join(' ')}`);
    }
    if (allCards.length > 20) {
      console.log(`  ... and ${allCards.length - 20} more`);
    }

    // 专门显示能量卡的 group/product 统计
    const energyCards = allCards.filter(c => c.card_type === 'ENERGY');
    const energyWithGroup = energyCards.filter(c => c.group_name);
    const energyWithProduct = energyCards.filter(c => c.product);
    console.log(`\nEnergy cards analysis:`);
    console.log(`  Total ENERGY cards: ${energyCards.length}`);
    console.log(`  With group_name: ${energyWithGroup.length}`);
    console.log(`  With product: ${energyWithProduct.length}`);

    // 显示几个能量卡样本
    console.log('\nSample ENERGY cards:');
    for (const card of energyCards.slice(0, 5)) {
      console.log(`  ${card.card_code}: name=${card.name}, unit=${card.unit_name || 'NULL'}, group=${card.group_name || 'NULL'}, product=${card.product || 'NULL'}`);
    }

    console.log(`\nTotal: ${allCards.length} cards would be synced to DB.`);
    return;
  }

  // Step 3: 查询数据库已有卡牌
  console.log('\nStep 3: Checking existing cards in DB...');

  const pool = new Pool({ connectionString: CONFIG.databaseUrl });

  try {
    const { rows: existingRows } = await pool.query<{ card_code: string; status: string }>(
      'SELECT card_code, status FROM cards'
    );

    const publishedCodes = new Set<string>();
    const draftCodes = new Set<string>();
    for (const r of existingRows) {
      if (r.status === 'PUBLISHED') {
        publishedCodes.add(r.card_code);
      } else {
        draftCodes.add(r.card_code);
      }
    }
    console.log(`  Found ${publishedCodes.size} published + ${draftCodes.size} draft cards`);

    // Step 4: 分类 - 新卡插入，已有卡（包括 PUBLISHED）更新
    const newCards: CardUpsertRecord[] = [];
    const updateCards: CardUpsertRecord[] = [];

    for (const card of allCards) {
      if (publishedCodes.has(card.card_code) || draftCodes.has(card.card_code)) {
        updateCards.push(card);
      } else {
        newCards.push(card);
      }
    }

    console.log(`\nStep 4: Categorizing cards...`);
    console.log(`  New cards to insert: ${newCards.length}`);
    console.log(`  Existing cards to update (DRAFT + PUBLISHED): ${updateCards.length}`);

    if (newCards.length === 0 && updateCards.length === 0) {
      console.log('\nNo changes needed. Database is up to date.');
      return;
    }

    // Step 5: 同步
    let insertedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    if (newCards.length > 0) {
      console.log(`\nStep 5a: Inserting ${newCards.length} new cards...`);
      const totalBatches = Math.ceil(newCards.length / CONFIG.batchSize);

      for (let i = 0; i < newCards.length; i += CONFIG.batchSize) {
        const batchNum = Math.floor(i / CONFIG.batchSize) + 1;
        const batch = newCards.slice(i, i + CONFIG.batchSize);

        try {
          for (const card of batch) {
            await pool.query(`
              INSERT INTO cards (card_code, card_type, name, card_text, image_filename,
                cost, blade, hearts, blade_hearts, score, requirements,
                unit_name, group_name, rare, product, status)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            `, [
              card.card_code, card.card_type, card.name, card.card_text, card.image_filename,
              card.cost, card.blade, JSON.stringify(card.hearts), JSON.stringify(card.blade_hearts),
              card.score, JSON.stringify(card.requirements), card.unit_name, card.group_name,
              card.rare, card.product, card.status
            ]);
          }
          console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} cards... OK`);
          insertedCount += batch.length;
        } catch (err) {
          console.error(`  Batch ${batchNum}/${totalBatches}: FAILED`, err);
          failedCount += batch.length;
        }
      }
    }

    if (updateCards.length > 0) {
      console.log(`\nStep 5b: Updating ${updateCards.length} draft cards...`);
      const totalBatches = Math.ceil(updateCards.length / CONFIG.batchSize);

      for (let i = 0; i < updateCards.length; i += CONFIG.batchSize) {
        const batchNum = Math.floor(i / CONFIG.batchSize) + 1;
        const batch = updateCards.slice(i, i + CONFIG.batchSize);

        try {
          for (const card of batch) {
            await pool.query(`
              UPDATE cards SET
                card_type = $2, name = $3, card_text = $4, image_filename = $5,
                cost = $6, blade = $7, hearts = $8, blade_hearts = $9, score = $10,
                requirements = $11, unit_name = $12, group_name = $13, rare = $14,
                product = $15, status = $16, updated_at = now()
              WHERE card_code = $1
            `, [
              card.card_code, card.card_type, card.name, card.card_text, card.image_filename,
              card.cost, card.blade, JSON.stringify(card.hearts), JSON.stringify(card.blade_hearts),
              card.score, JSON.stringify(card.requirements), card.unit_name, card.group_name,
              card.rare, card.product, card.status
            ]);
          }
          console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} cards... OK`);
          updatedCount += batch.length;
        } catch (err) {
          console.error(`  Batch ${batchNum}/${totalBatches}: FAILED`, err);
          failedCount += batch.length;
        }
      }
    }

    // Summary
    console.log('\nSummary:');
    console.log(`  Read: ${allCards.length} (JP: ${jpCards.length}, CN matched: ${cnMatchCount}, CN-only: ${cnOnlyCount})`);
    console.log(`  Inserted: ${insertedCount}`);
    console.log(`  Updated: ${updatedCount}`);
    if (failedCount > 0) {
      console.log(`  Failed: ${failedCount}`);
    }

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

main().catch(console.error);
