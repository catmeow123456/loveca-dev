/**
 * 数据库 card_code 标准化迁移脚本
 *
 * 将数据库中所有 card_code 标准化为符合 data-spec 规范的格式：
 * 1. cards 表：全角＋→半角+，非标准稀有度修复（PR2→PR+, PRproteinbar→PR 等）
 *    同时同步修复 rare 字段
 * 2. decks 表：main_deck 和 energy_deck JSONB 中的 card_code 标准化
 * 3. 添加 CHECK 约束防止未来不合规数据入库
 *
 * 使用方法:
 *   # 预览模式（不修改数据库）
 *   DATABASE_URL=postgres://... npx tsx src/scripts/normalize-card-codes.ts --dry-run
 *
 *   # 正式执行
 *   DATABASE_URL=postgres://... npx tsx src/scripts/normalize-card-codes.ts
 */

import { Pool, type PoolClient } from 'pg';
import { normalizeCardCode, parseCardCode } from '../shared/utils/card-code';

// ============================================
// 配置
// ============================================

const DATABASE_URL = process.env.DATABASE_URL!;
const DRY_RUN = process.argv.includes('--dry-run');

// ============================================
// 类型
// ============================================

interface CardRow {
  id: string;
  card_code: string;
  rare: string | null;
  status: string;
  updated_at: string;
}

interface DeckRow {
  id: string;
  name: string;
  main_deck: { card_code: string; count: number; card_type?: string }[];
  energy_deck: { card_code: string; count: number }[];
}

interface MigrationReport {
  cards: {
    total: number;
    needNormalize: number;
    updated: number;
    deletedDuplicates: number;
    conflicts: { normalized: string; kept: string; deleted: string[] }[];
  };
  decks: {
    total: number;
    modified: number;
    entriesFixed: number;
  };
  constraintAdded: boolean;
}

// ============================================
// 主逻辑
// ============================================

async function main() {
  console.log(`🔧 card_code 标准化迁移${DRY_RUN ? ' (DRY RUN - 不修改数据库)' : ''}\n`);

  if (!DATABASE_URL) {
    console.error('Error: DATABASE_URL is required');
    console.log('Usage: DATABASE_URL=postgres://... npx tsx src/scripts/normalize-card-codes.ts');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const report: MigrationReport = {
    cards: { total: 0, needNormalize: 0, updated: 0, deletedDuplicates: 0, conflicts: [] },
    decks: { total: 0, modified: 0, entriesFixed: 0 },
    constraintAdded: false,
  };

  try {
    if (DRY_RUN) {
      // 预览模式：只读查询
      await previewChanges(pool, report);
    } else {
      // 正式执行：在事务中修改
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await migrateCards(client, report);
        await migrateDecks(client, report);
        await addConstraint(client, report);
        await client.query('COMMIT');
        console.log('\n✅ 事务已提交');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('\n❌ 事务已回滚:', err);
        throw err;
      } finally {
        client.release();
      }
    }

    // 输出报告
    printReport(report);
  } finally {
    await pool.end();
  }
}

// ============================================
// 预览模式
// ============================================

async function previewChanges(pool: Pool, report: MigrationReport) {
  // 1. Cards
  console.log('📋 Step 1: 分析 cards 表...');
  const { rows: cards } = await pool.query<CardRow>(
    'SELECT id, card_code, rare, status, updated_at FROM cards ORDER BY card_code'
  );
  report.cards.total = cards.length;

  const needNormalize = cards.filter((c) => c.card_code !== normalizeCardCode(c.card_code));
  report.cards.needNormalize = needNormalize.length;

  if (needNormalize.length > 0) {
    console.log(`  发现 ${needNormalize.length} 条需要标准化的 card_code:`);
    for (const c of needNormalize) {
      console.log(`    ${c.card_code} → ${normalizeCardCode(c.card_code)} (status=${c.status})`);
    }
  } else {
    console.log('  ✅ cards 表无需标准化');
  }

  // 检查冲突
  const normalizedMap = new Map<string, CardRow[]>();
  for (const card of cards) {
    const norm = normalizeCardCode(card.card_code);
    const list = normalizedMap.get(norm) ?? [];
    list.push(card);
    normalizedMap.set(norm, list);
  }

  const conflicts = [...normalizedMap.entries()].filter(([, rows]) => rows.length > 1);
  if (conflicts.length > 0) {
    console.log(`\n  ⚠️  标准化后 ${conflicts.length} 组冲突（将删除重复记录）:`);
    for (const [norm, rows] of conflicts) {
      const kept = chooseKeptRecord(rows);
      const deleted = rows.filter((r) => r.id !== kept.id);
      report.cards.conflicts.push({
        normalized: norm,
        kept: kept.card_code,
        deleted: deleted.map((d) => d.card_code),
      });
      console.log(`    ${norm}:`);
      console.log(`      保留: ${kept.card_code} (status=${kept.status})`);
      for (const d of deleted) {
        console.log(`      删除: ${d.card_code} (status=${d.status})`);
      }
    }
    report.cards.deletedDuplicates = conflicts.reduce((sum, [, rows]) => sum + rows.length - 1, 0);
  }

  // 2. Decks
  console.log('\n📋 Step 2: 分析 decks 表...');
  const { rows: decks } = await pool.query<DeckRow>(
    'SELECT id, name, main_deck, energy_deck FROM decks'
  );
  report.decks.total = decks.length;

  for (const deck of decks) {
    const { modified, entriesFixed } = analyzeDeck(deck);
    if (modified) {
      report.decks.modified++;
      report.decks.entriesFixed += entriesFixed;
      console.log(
        `  deck "${deck.name}" (${deck.id.substring(0, 8)}): ${entriesFixed} 条 card_code 需标准化`
      );
    }
  }

  if (report.decks.modified === 0) {
    console.log('  ✅ decks 表无需标准化');
  }

  // 3. Constraint
  console.log('\n📋 Step 3: CHECK 约束...');
  const { rows: constraintRows } = await pool.query(
    `SELECT constraint_name FROM information_schema.table_constraints 
     WHERE table_name = 'cards' AND constraint_name = 'card_code_no_fullwidth_plus'`
  );
  if (constraintRows.length > 0) {
    console.log('  ✅ 约束已存在');
  } else {
    console.log("  将添加 CHECK 约束: card_code NOT LIKE '%＋%'");
  }
}

// ============================================
// 正式迁移
// ============================================

async function migrateCards(client: PoolClient, report: MigrationReport) {
  console.log('📋 Step 1: 标准化 cards 表...');

  const { rows: cards } = await client.query<CardRow>(
    'SELECT id, card_code, rare, status, updated_at FROM cards ORDER BY card_code'
  );
  report.cards.total = cards.length;

  // 构建标准化映射，检测冲突
  const normalizedMap = new Map<string, CardRow[]>();
  for (const card of cards) {
    const norm = normalizeCardCode(card.card_code);
    const list = normalizedMap.get(norm) ?? [];
    list.push(card);
    normalizedMap.set(norm, list);
  }

  // 处理冲突：先删除重复记录
  const conflicts = [...normalizedMap.entries()].filter(([, rows]) => rows.length > 1);
  for (const [norm, rows] of conflicts) {
    const kept = chooseKeptRecord(rows);
    const toDelete = rows.filter((r) => r.id !== kept.id);

    for (const d of toDelete) {
      await client.query('DELETE FROM cards WHERE id = $1', [d.id]);
      report.cards.deletedDuplicates++;
      console.log(
        `  删除重复: ${d.card_code} (status=${d.status})，保留 ${kept.card_code} (status=${kept.status})`
      );
    }

    report.cards.conflicts.push({
      normalized: norm,
      kept: kept.card_code,
      deleted: toDelete.map((d) => d.card_code),
    });
  }

  // 标准化需要更新的记录
  const needNormalize = cards.filter((c) => c.card_code !== normalizeCardCode(c.card_code));
  report.cards.needNormalize = needNormalize.length;

  // 过滤掉已被删除的记录
  const deletedIds = new Set(
    conflicts.flatMap(([, rows]) => {
      const kept = chooseKeptRecord(rows);
      return rows.filter((r) => r.id !== kept.id).map((r) => r.id);
    })
  );

  for (const card of needNormalize) {
    if (deletedIds.has(card.id)) continue; // 已删除，跳过

    const newCode = normalizeCardCode(card.card_code);

    // 如果稀有度也被修复了，同步更新 rare 字段
    const newParsed = parseCardCode(newCode);
    const oldParsed = parseCardCode(card.card_code);
    const rarityChanged = newParsed && oldParsed && newParsed.rarity !== oldParsed.rarity;

    if (rarityChanged) {
      await client.query(
        'UPDATE cards SET card_code = $1, rare = $2, updated_at = now() WHERE id = $3',
        [newCode, newParsed.rarity, card.id]
      );
      console.log(
        `  更新: ${card.card_code} → ${newCode} (rare: ${card.rare} → ${newParsed.rarity})`
      );
    } else {
      await client.query('UPDATE cards SET card_code = $1, updated_at = now() WHERE id = $2', [
        newCode,
        card.id,
      ]);
      console.log(`  更新: ${card.card_code} → ${newCode}`);
    }
    report.cards.updated++;
  }

  if (report.cards.updated === 0 && report.cards.deletedDuplicates === 0) {
    console.log('  ✅ cards 表无需变更');
  }
}

async function migrateDecks(client: PoolClient, report: MigrationReport) {
  console.log('\n📋 Step 2: 标准化 decks 表...');

  const { rows: decks } = await client.query<DeckRow>(
    'SELECT id, name, main_deck, energy_deck FROM decks'
  );
  report.decks.total = decks.length;

  for (const deck of decks) {
    const { modified, newMainDeck, newEnergyDeck, entriesFixed } = normalizeDeck(deck);
    if (modified) {
      await client.query(
        'UPDATE decks SET main_deck = $1, energy_deck = $2, updated_at = now() WHERE id = $3',
        [JSON.stringify(newMainDeck), JSON.stringify(newEnergyDeck), deck.id]
      );
      report.decks.modified++;
      report.decks.entriesFixed += entriesFixed;
      console.log(`  更新 deck "${deck.name}": ${entriesFixed} 条 card_code 已标准化`);
    }
  }

  if (report.decks.modified === 0) {
    console.log('  ✅ decks 表无需变更');
  }
}

async function addConstraint(client: PoolClient, report: MigrationReport) {
  console.log('\n📋 Step 3: 添加 CHECK 约束...');

  // 检查约束是否已存在
  const { rows } = await client.query(
    `SELECT constraint_name FROM information_schema.table_constraints 
     WHERE table_name = 'cards' AND constraint_name = 'card_code_no_fullwidth_plus'`
  );

  if (rows.length > 0) {
    console.log('  ✅ 约束已存在，跳过');
    return;
  }

  await client.query(
    `ALTER TABLE cards ADD CONSTRAINT card_code_no_fullwidth_plus CHECK (card_code NOT LIKE '%＋%')`
  );
  report.constraintAdded = true;
  console.log('  ✅ 已添加 CHECK 约束: card_code_no_fullwidth_plus');
}

// ============================================
// 辅助函数
// ============================================

/**
 * 当多条记录标准化后冲突时，选择保留的记录。
 * 优先级：PUBLISHED > DRAFT，同级别选 updated_at 较新的。
 */
function chooseKeptRecord(rows: CardRow[]): CardRow {
  const sorted = [...rows].sort((a, b) => {
    // PUBLISHED 优先
    if (a.status === 'PUBLISHED' && b.status !== 'PUBLISHED') return -1;
    if (b.status === 'PUBLISHED' && a.status !== 'PUBLISHED') return 1;
    // 同状态选更新时间晚的
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
  return sorted[0];
}

/**
 * 分析 deck 是否需要标准化（预览模式用）
 */
function analyzeDeck(deck: DeckRow): { modified: boolean; entriesFixed: number } {
  let entriesFixed = 0;
  const allEntries = [...(deck.main_deck || []), ...(deck.energy_deck || [])];
  for (const entry of allEntries) {
    if (entry.card_code !== normalizeCardCode(entry.card_code)) {
      entriesFixed++;
    }
  }
  return { modified: entriesFixed > 0, entriesFixed };
}

/**
 * 标准化 deck 中的所有 card_code
 */
function normalizeDeck(deck: DeckRow): {
  modified: boolean;
  newMainDeck: DeckRow['main_deck'];
  newEnergyDeck: DeckRow['energy_deck'];
  entriesFixed: number;
} {
  let entriesFixed = 0;

  const newMainDeck = (deck.main_deck || []).map((entry) => {
    const normalized = normalizeCardCode(entry.card_code);
    if (normalized !== entry.card_code) entriesFixed++;
    return { ...entry, card_code: normalized };
  });

  const newEnergyDeck = (deck.energy_deck || []).map((entry) => {
    const normalized = normalizeCardCode(entry.card_code);
    if (normalized !== entry.card_code) entriesFixed++;
    return { ...entry, card_code: normalized };
  });

  return {
    modified: entriesFixed > 0,
    newMainDeck,
    newEnergyDeck,
    entriesFixed,
  };
}

// ============================================
// 报告
// ============================================

function printReport(report: MigrationReport) {
  console.log('\n' + '='.repeat(60));
  console.log('  迁移报告');
  console.log('='.repeat(60));

  console.log('\n  Cards 表:');
  console.log(`    总记录: ${report.cards.total}`);
  console.log(`    需标准化: ${report.cards.needNormalize}`);
  console.log(`    已更新: ${report.cards.updated}`);
  console.log(`    冲突删除: ${report.cards.deletedDuplicates}`);
  if (report.cards.conflicts.length > 0) {
    console.log('    冲突详情:');
    for (const c of report.cards.conflicts) {
      console.log(`      ${c.normalized}: 保留 ${c.kept}, 删除 [${c.deleted.join(', ')}]`);
    }
  }

  console.log('\n  Decks 表:');
  console.log(`    总记录: ${report.decks.total}`);
  console.log(`    已修改: ${report.decks.modified}`);
  console.log(`    修复条目: ${report.decks.entriesFixed}`);

  console.log(`\n  CHECK 约束: ${report.constraintAdded ? '已添加' : '已存在/未变更'}`);

  console.log('\n' + '='.repeat(60));
}

// ============================================
// 入口
// ============================================

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
