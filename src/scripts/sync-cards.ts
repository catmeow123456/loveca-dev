/**
 * 卡牌数据同步脚本
 *
 * 将爬虫输出的 JSON 数据同步到 PostgreSQL cards 表
 * 仅插入数据库中不存在的新卡牌
 *
 * 使用方法:
 * DATABASE_URL=postgres://... npx tsx src/scripts/sync-cards.ts
 * DATABASE_URL=postgres://... npx tsx src/scripts/sync-cards.ts --dry-run
 *
 * 环境变量:
 * - DATABASE_URL: PostgreSQL 连接字符串 (必需，dry-run 模式除外)
 */

import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';
import { normalizeCardCode } from '../shared/utils/card-code';

// ============================================
// 配置
// ============================================

const CONFIG = {
  databaseUrl: process.env.DATABASE_URL!,
  sources: {
    full: path.resolve('test/data/cards_full.json'),
    energy: path.resolve('test/data/cards_energy.json'),
  },
  batchSize: 100,
};

const DRY_RUN = process.argv.includes('--dry-run');

// ============================================
// 类型定义
// ============================================

interface CrawlerCard {
  id: number;
  card_number: string;
  card_kind: string;
  name: string;
  rare: string;
  img: string;
  blade: string;
  effect_text?: string;
  product?: string;
}

interface CardInsertRecord {
  card_code: string;
  card_type: 'MEMBER' | 'LIVE' | 'ENERGY';
  name: string;
  card_text: string | null;
  image_filename: string | null;
  blade: number | null;
  rare: string | null;
  product: string | null;
  status: 'DRAFT';
}

// ============================================
// 字段转换
// ============================================

const CARD_KIND_MAP: Record<string, 'MEMBER' | 'LIVE' | 'ENERGY'> = {
  M: 'MEMBER',
  L: 'LIVE',
  E: 'ENERGY',
};

function parseBlade(blade: string): number | null {
  if (!blade || blade === '-') return null;

  const numeric = parseInt(blade, 10);
  if (!isNaN(numeric)) return numeric;

  // "ALL1" or "[全ブレード]" - all-color blade
  if (blade.startsWith('ALL') || blade.includes('全ブレード')) {
    const num = blade.match(/(\d+)/);
    return num ? parseInt(num[1], 10) : 1;
  }

  // Color-prefixed: "桃1", "赤1", etc.
  const trailingNum = blade.match(/(\d+)$/);
  if (trailingNum) return parseInt(trailingNum[1], 10);

  console.warn(`  Warning: unknown blade format "${blade}", setting to null`);
  return null;
}

function transformCard(raw: CrawlerCard): CardInsertRecord {
  const cardType = CARD_KIND_MAP[raw.card_kind];
  if (!cardType) {
    throw new Error(`Unknown card_kind: "${raw.card_kind}" for card ${raw.card_number}`);
  }

  return {
    card_code: normalizeCardCode(raw.card_number),
    card_type: cardType,
    name: raw.name,
    card_text: raw.effect_text || null,
    image_filename: raw.img ? raw.img.replace(/^.*\//, '') : null,
    blade: parseBlade(raw.blade),
    rare: raw.rare || null,
    product: raw.product || null,
    status: 'DRAFT',
  };
}

// ============================================
// 主逻辑
// ============================================

async function main() {
  console.log(`Card Data Sync${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  // Step 1: 检查环境变量
  if (!CONFIG.databaseUrl && !DRY_RUN) {
    console.error('Error: DATABASE_URL is required');
    console.log('\nUsage:');
    console.log('DATABASE_URL=postgres://... npx tsx src/scripts/sync-cards.ts');
    console.log('DATABASE_URL=postgres://... npx tsx src/scripts/sync-cards.ts --dry-run');
    process.exit(1);
  }

  // Step 2: 读取 JSON 文件
  console.log('Step 1: Reading JSON sources...');

  const fullCards = readJsonFile<CrawlerCard[]>(CONFIG.sources.full, 'cards_full.json');
  const energyCards = readJsonFile<CrawlerCard[]>(CONFIG.sources.energy, 'cards_energy.json');

  const memberCount = fullCards.filter((c) => c.card_kind === 'M').length;
  const liveCount = fullCards.filter((c) => c.card_kind === 'L').length;
  console.log(
    `  cards_full.json: ${fullCards.length} cards (MEMBER: ${memberCount}, LIVE: ${liveCount})`
  );
  console.log(`  cards_energy.json: ${energyCards.length} cards`);

  // Step 3: 转换并去重
  console.log('\nStep 2: Transforming and deduplicating...');

  const cardMap = new Map<string, CardInsertRecord>();

  // Energy cards first, so full cards take priority on conflicts
  for (const raw of energyCards) {
    const record = transformCard(raw);
    cardMap.set(record.card_code, record);
  }
  for (const raw of fullCards) {
    const record = transformCard(raw);
    cardMap.set(record.card_code, record);
  }

  const allCards = Array.from(cardMap.values());
  const dupeCount = fullCards.length + energyCards.length - allCards.length;
  console.log(
    `  Total after dedup: ${allCards.length} cards${dupeCount > 0 ? ` (${dupeCount} duplicates removed)` : ''}`
  );

  // Dry run: 展示所有转换后的卡牌，无需连接数据库
  if (DRY_RUN) {
    console.log('\nDry run - all transformed cards:');
    for (const card of allCards) {
      console.log(
        `  ${card.card_code} [${card.card_type}] ${card.name}${card.blade != null ? ` blade=${card.blade}` : ''}`
      );
    }
    console.log(
      `\nTotal: ${allCards.length} cards would be checked against DB and new ones inserted.`
    );
    return;
  }

  // Step 4: 连接数据库并查询已有卡牌
  console.log('\nStep 3: Checking existing cards in DB...');

  const pool = new pg.Pool({ connectionString: CONFIG.databaseUrl });

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

    // Step 5: 分类卡牌
    const newCards: CardInsertRecord[] = [];
    const updateCards: CardInsertRecord[] = [];
    let skippedCount = 0;

    for (const card of allCards) {
      if (publishedCodes.has(card.card_code)) {
        skippedCount++;
      } else if (draftCodes.has(card.card_code)) {
        updateCards.push(card);
      } else {
        newCards.push(card);
      }
    }

    console.log(`\nStep 4: Categorizing cards...`);
    console.log(`  New cards to insert: ${newCards.length}`);
    console.log(`  Draft cards to update: ${updateCards.length}`);
    console.log(`  Skipped (published): ${skippedCount}`);

    if (newCards.length === 0 && updateCards.length === 0) {
      console.log('\nNo changes needed. Database is up to date.');
      return;
    }

    // Step 6a: 插入新卡
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
          await insertBatch(pool, batch);
          console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} cards... OK`);
          insertedCount += batch.length;
        } catch (err) {
          console.error(
            `  Batch ${batchNum}/${totalBatches}: FAILED (${err instanceof Error ? err.message : err})`
          );
          failedCount += batch.length;
        }
      }
    }

    // Step 6b: 覆盖 DRAFT 卡牌
    if (updateCards.length > 0) {
      console.log(`\nStep 5b: Updating ${updateCards.length} draft cards...`);
      const totalBatches = Math.ceil(updateCards.length / CONFIG.batchSize);

      for (let i = 0; i < updateCards.length; i += CONFIG.batchSize) {
        const batchNum = Math.floor(i / CONFIG.batchSize) + 1;
        const batch = updateCards.slice(i, i + CONFIG.batchSize);

        try {
          await upsertBatch(pool, batch);
          console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} cards... OK`);
          updatedCount += batch.length;
        } catch (err) {
          console.error(
            `  Batch ${batchNum}/${totalBatches}: FAILED (${err instanceof Error ? err.message : err})`
          );
          failedCount += batch.length;
        }
      }
    }

    // Summary
    console.log('\nSummary:');
    console.log(`  Read: ${allCards.length}`);
    console.log(`  Skipped (published): ${skippedCount}`);
    console.log(`  Inserted: ${insertedCount}`);
    console.log(`  Updated (draft): ${updatedCount}`);
    if (failedCount > 0) {
      console.log(`  Failed: ${failedCount}`);
    }
  } finally {
    await pool.end();
  }
}

// ============================================
// 数据库操作
// ============================================

async function insertBatch(pool: pg.Pool, cards: CardInsertRecord[]) {
  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < cards.length; i++) {
    const offset = i * 8;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`
    );
    const c = cards[i];
    values.push(
      c.card_code,
      c.card_type,
      c.name,
      c.card_text,
      c.image_filename,
      c.blade,
      c.rare,
      c.product
    );
  }

  await pool.query(
    `INSERT INTO cards (card_code, card_type, name, card_text, image_filename, blade, rare, product)
     VALUES ${placeholders.join(', ')}`,
    values
  );
}

async function upsertBatch(pool: pg.Pool, cards: CardInsertRecord[]) {
  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < cards.length; i++) {
    const offset = i * 8;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`
    );
    const c = cards[i];
    values.push(
      c.card_code,
      c.card_type,
      c.name,
      c.card_text,
      c.image_filename,
      c.blade,
      c.rare,
      c.product
    );
  }

  await pool.query(
    `INSERT INTO cards (card_code, card_type, name, card_text, image_filename, blade, rare, product)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (card_code) DO UPDATE SET
       card_type = EXCLUDED.card_type,
       name = EXCLUDED.name,
       card_text = EXCLUDED.card_text,
       image_filename = EXCLUDED.image_filename,
       blade = EXCLUDED.blade,
       rare = EXCLUDED.rare,
       product = EXCLUDED.product`,
    values
  );
}

// ============================================
// 辅助函数
// ============================================

function readJsonFile<T>(filePath: string, displayName: string): T {
  if (!fs.existsSync(filePath)) {
    console.error(`  Error: ${displayName} not found at ${filePath}`);
    console.log('  Please run the crawler first: cd test && python main.py all');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

// 运行主函数
main().catch(console.error);
