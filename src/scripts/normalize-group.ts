/**
 * 数据库 work_names 标准化迁移脚本
 *
 * 将数据库中所有 work_names 内误写成团体名的值转换为作品名：
 *   μ's → ラブライブ！
 *   Aqours → ラブライブ！サンシャイン!!
 *   虹ヶ咲学園スクールアイドル同好会 → ラブライブ！虹ヶ咲学園スクールアイドル同好会
 *   Liella! → ラブライブ！スーパースター!!
 *   蓮ノ空女学院スクールアイドルクラブ → 蓮ノ空女学院スクールアイドルクラブ（不变）
 *   いきづらい部！ → イキヅライブ！LOVELIVE!BLUEBIRD
 *
 * 使用方法:
 *   # 预览模式（不修改数据库）
 *   DATABASE_URL=postgres://... npx tsx src/scripts/normalize-group.ts --dry-run
 *
 *   # 正式执行
 *   DATABASE_URL=postgres://... npx tsx src/scripts/normalize-group.ts
 */

import { Pool, type PoolClient } from 'pg';

// ============================================
// 配置
// ============================================

const DATABASE_URL = process.env.DATABASE_URL!;
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * 小组名 → 作品名映射
 *
 * work_names 只保存作品名数组；真实团体另存 group_names。
 */
const GROUP_TO_SERIES_MAP: Record<string, string> = {
  "μ's": 'ラブライブ！',
  Aqours: 'ラブライブ！サンシャイン!!',
  虹ヶ咲学園スクールアイドル同好会: 'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
  'Liella!': 'ラブライブ！スーパースター!!',
  蓮ノ空女学院スクールアイドルクラブ: '蓮ノ空女学院スクールアイドルクラブ',
  'いきづらい部！': 'イキヅライブ！LOVELIVE!BLUEBIRD',
  'いきづらい部!': 'イキヅライブ！LOVELIVE!BLUEBIRD',
  其他: '其他',
};

/** 有效的作品名列表 */
const VALID_SERIES_NAMES = [
  'ラブライブ！',
  'ラブライブ！サンシャイン!!',
  'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
  'ラブライブ！スーパースター!!',
  '蓮ノ空女学院スクールアイドルクラブ',
  'イキヅライブ！LOVELIVE!BLUEBIRD',
  '其他',
];

// ============================================
// 类型
// ============================================

interface CardRow {
  id: string;
  card_code: string;
  name_jp: string | null;
  name_cn: string | null;
  work_names: string[] | null;
  status: string;
}

interface MigrationReport {
  cards: {
    total: number;
    needNormalize: number;
    updated: number;
    skipped: number;
    unknown: { card_code: string; name: string; work_names: string[] }[];
  };
}

// ============================================
// 主逻辑
// ============================================

async function main() {
  console.log(`🔧 work_names 标准化迁移${DRY_RUN ? ' (DRY RUN - 不修改数据库)' : ''}\n`);

  if (!DATABASE_URL) {
    console.error('Error: DATABASE_URL is required');
    console.log('Usage: DATABASE_URL=postgres://... npx tsx src/scripts/normalize-group.ts');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const report: MigrationReport = {
    cards: { total: 0, needNormalize: 0, updated: 0, skipped: 0, unknown: [] },
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
// 核心转换逻辑
// ============================================

/**
 * 标准化 work_names 数组
 *
 * @param workNames 原始 work_names（可能包含小组名）
 * @returns 标准化后的作品名，如果无需转换则返回原值，如果无法识别返回 null
 */
function normalizeWorkNames(workNames: readonly string[] | null): {
  normalized: string[] | null;
  changed: boolean;
  unknown: boolean;
} {
  if (workNames === null || workNames.length === 0) {
    return { normalized: null, changed: false, unknown: false };
  }

  const normalizedParts: string[] = [];
  let anyChanged = false;
  let anyUnknown = false;

  for (const item of workNames) {
    const parts = item
      .replace(/[,、]/g, '\n')
      .split('\n')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length !== 1 || parts[0] !== item) {
      anyChanged = true;
    }
    for (const part of parts) {
      const result = normalizeSingleGroup(part);
      if (result.unknown) {
        anyUnknown = true;
        normalizedParts.push(part);
      } else {
        if (result.changed) anyChanged = true;
        normalizedParts.push(result.normalized!);
      }
    }
  }

  return {
    normalized: [...new Set(normalizedParts)],
    changed: anyChanged,
    unknown: anyUnknown,
  };
}

/**
 * 标准化单个小组名/作品名
 */
function normalizeSingleGroup(value: string): {
  normalized: string | null;
  changed: boolean;
  unknown: boolean;
} {
  // 已经是有效的作品名
  if (VALID_SERIES_NAMES.includes(value)) {
    return { normalized: value, changed: false, unknown: false };
  }

  // 查找映射
  const mapped = GROUP_TO_SERIES_MAP[value];
  if (mapped) {
    return { normalized: mapped, changed: true, unknown: false };
  }

  // 未知的值
  return { normalized: value, changed: false, unknown: true };
}

function displayName(card: Pick<CardRow, 'card_code' | 'name_cn' | 'name_jp'>): string {
  return card.name_cn?.trim() || card.name_jp?.trim() || card.card_code;
}

// ============================================
// 预览模式
// ============================================

async function previewChanges(pool: Pool, report: MigrationReport) {
  console.log('📋 Step 1: 分析 cards 表...');

  const { rows: cards } = await pool.query<CardRow>(
    'SELECT id, card_code, name_jp, name_cn, work_names, status FROM cards ORDER BY card_code'
  );
  report.cards.total = cards.length;

  const needNormalize: CardRow[] = [];
  const unknown: { card_code: string; name: string; work_names: string[] }[] = [];

  for (const card of cards) {
    const result = normalizeWorkNames(card.work_names);
    if (result.changed) {
      needNormalize.push(card);
    }
    if (result.unknown) {
      unknown.push({
        card_code: card.card_code,
        name: displayName(card),
        work_names: card.work_names ?? [],
      });
    }
  }

  report.cards.needNormalize = needNormalize.length;
  report.cards.unknown = unknown;
  report.cards.skipped = cards.length - needNormalize.length;

  if (needNormalize.length > 0) {
    console.log(`  发现 ${needNormalize.length} 条需要标准化的 work_names:`);
    for (const c of needNormalize) {
      const result = normalizeWorkNames(c.work_names);
      console.log(
        `    ${c.card_code} "${displayName(c)}": ${JSON.stringify(c.work_names)} → ${JSON.stringify(result.normalized)} (status=${c.status})`
      );
    }
  } else {
    console.log('  ✅ cards 表无需标准化');
  }

  if (unknown.length > 0) {
    console.log(`\n  ⚠️  发现 ${unknown.length} 条未知的 work_names 值（不会被修改）:`);
    for (const u of unknown) {
      console.log(`    ${u.card_code} "${u.name}": ${JSON.stringify(u.work_names)}`);
    }
  }
}

// ============================================
// 正式迁移
// ============================================

async function migrateCards(client: PoolClient, report: MigrationReport) {
  console.log('📋 Step 1: 标准化 cards 表...');

  const { rows: cards } = await client.query<CardRow>(
    'SELECT id, card_code, name_jp, name_cn, work_names, status FROM cards ORDER BY card_code'
  );
  report.cards.total = cards.length;

  const needNormalize: { card: CardRow; normalized: string[] | null }[] = [];
  const unknown: { card_code: string; name: string; work_names: string[] }[] = [];

  for (const card of cards) {
    const result = normalizeWorkNames(card.work_names);
    if (result.changed && result.normalized !== null) {
      needNormalize.push({ card, normalized: result.normalized });
    }
    if (result.unknown) {
      unknown.push({
        card_code: card.card_code,
        name: displayName(card),
        work_names: card.work_names ?? [],
      });
    }
  }

  report.cards.needNormalize = needNormalize.length;
  report.cards.unknown = unknown;
  report.cards.skipped = cards.length - needNormalize.length;

  // 执行更新
  for (const { card, normalized } of needNormalize) {
    await client.query('UPDATE cards SET work_names = $1, updated_at = now() WHERE id = $2', [
      normalized == null ? null : JSON.stringify(normalized),
      card.id,
    ]);
    report.cards.updated++;
    console.log(
      `  更新: ${card.card_code} "${displayName(card)}": ${JSON.stringify(card.work_names)} → ${JSON.stringify(normalized)}`
    );
  }

  if (report.cards.updated === 0) {
    console.log('  ✅ cards 表无需变更');
  }

  if (unknown.length > 0) {
    console.log(`\n  ⚠️  跳过 ${unknown.length} 条未知的 work_names 值:`);
    for (const u of unknown.slice(0, 10)) {
      console.log(`    ${u.card_code} "${u.name}": ${JSON.stringify(u.work_names)}`);
    }
    if (unknown.length > 10) {
      console.log(`    ... 还有 ${unknown.length - 10} 条`);
    }
  }
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
  console.log(`    跳过: ${report.cards.skipped}`);
  if (report.cards.unknown.length > 0) {
    console.log(`    未知值: ${report.cards.unknown.length}`);
  }

  console.log('\n' + '='.repeat(60));

  if (DRY_RUN) {
    console.log('\n📌 这是预览模式，未修改数据库。');
    console.log('   移除 --dry-run 参数以执行实际迁移。');
  }
}

// ============================================
// 入口
// ============================================

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
