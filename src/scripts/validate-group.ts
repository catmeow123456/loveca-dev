/**
 * group_name 验证脚本
 *
 * 检查数据库和/或 llocg_db 数据源中所有 group_name/series 字段是否符合规范。
 *
 * 使用方法:
 *   # 验证数据库中的 cards 表
 *   DATABASE_URL=postgresql://... npx tsx src/scripts/validate-group.ts --source=db
 *
 *   # 验证 llocg_db JSON 文件
 *   npx tsx src/scripts/validate-group.ts --source=llocg
 *
 *   # 同时验证两者
 *   DATABASE_URL=postgresql://... npx tsx src/scripts/validate-group.ts --source=all
 *
 *   # 仅显示不合规的条目（默认显示全部）
 *   npx tsx src/scripts/validate-group.ts --source=llocg --errors-only
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

// ============================================
// 配置
// ============================================

/** 有效的作品名列表 */
const VALID_SERIES_NAMES = [
  'ラブライブ！',
  'ラブライブ！サンシャイン!!',
  'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
  'ラブライブ！スーパースター!!',
  '蓮ノ空女学院スクールアイドルクラブ',
  '其他',
];

/** 小组名 → 作品名映射（用于提示标准化建议） */
const GROUP_TO_SERIES_MAP: Record<string, string> = {
  "μ's": 'ラブライブ！',
  Aqours: 'ラブライブ！サンシャイン!!',
  虹ヶ咲学園スクールアイドル同好会: 'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
  'Liella!': 'ラブライブ！スーパースター!!',
  蓮ノ空女学院スクールアイドルクラブ: '蓮ノ空女学院スクールアイドルクラブ',
  其他: '其他',
};

// ============================================
// CLI 参数解析
// ============================================

type Source = 'db' | 'llocg' | 'all';

function parseArgs(): { source: Source; errorsOnly: boolean } {
  const sourceArg = process.argv.find((a) => a.startsWith('--source='));
  const source = (sourceArg?.split('=')[1] ?? 'all') as Source;
  if (!['db', 'llocg', 'all'].includes(source)) {
    console.error(`Invalid --source value: ${source}. Use db, llocg, or all.`);
    process.exit(1);
  }
  const errorsOnly = process.argv.includes('--errors-only');
  return { source, errorsOnly };
}

// ============================================
// 类型
// ============================================

interface ValidationEntry {
  cardCode: string;
  name: string;
  groupName: string | null;
  origin: string;
  valid: boolean;
  errors: string[];
  suggestion?: string; // 标准化建议
}

// ============================================
// 验证逻辑
// ============================================

/**
 * 验证单个 group_name 值
 */
function validateGroupName(groupName: string | null): {
  valid: boolean;
  errors: string[];
  suggestion?: string;
} {
  if (groupName === null) {
    return { valid: true, errors: [] }; // null 是允许的
  }

  // 已经是有效的作品名
  if (VALID_SERIES_NAMES.includes(groupName)) {
    return { valid: true, errors: [] };
  }

  // 统一分隔符：将逗号(,)和顿号(、)替换为换行符进行检查
  let normalizedInput = groupName;
  let hasNonStandardSeparator = false;

  if (normalizedInput.includes(',') || normalizedInput.includes('、')) {
    normalizedInput = normalizedInput.replace(/[,、]/g, '\n');
    hasNonStandardSeparator = true;
  }

  // 检查是否是多系列（用 \n 分隔）
  if (normalizedInput.includes('\n')) {
    const parts = normalizedInput.split('\n');
    const invalidParts: string[] = [];
    const suggestions: string[] = [];

    for (const part of parts) {
      const trimmed = part.trim();
      if (!VALID_SERIES_NAMES.includes(trimmed)) {
        // 检查是否是可映射的小组名
        const mapped = GROUP_TO_SERIES_MAP[trimmed];
        if (mapped) {
          suggestions.push(`${trimmed} → ${mapped}`);
        } else {
          invalidParts.push(trimmed);
        }
      }
    }

    if (invalidParts.length === 0 && suggestions.length === 0 && !hasNonStandardSeparator) {
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];
    if (hasNonStandardSeparator) {
      errors.push(`多系列应使用换行符分隔，而非逗号或顿号`);
    }
    if (invalidParts.length > 0) {
      errors.push(`多系列中包含无效值: ${invalidParts.join(', ')}`);
    }
    if (suggestions.length > 0) {
      errors.push(`多系列中包含小组名（需标准化）: ${suggestions.join('; ')}`);
    }

    return { valid: false, errors };
  }

  // 检查是否是可映射的小组名
  const mapped = GROUP_TO_SERIES_MAP[groupName];
  if (mapped) {
    return {
      valid: false,
      errors: [`小组名 "${groupName}" 需标准化为作品名`],
      suggestion: mapped,
    };
  }

  // 未知的值
  return {
    valid: false,
    errors: [`未知的 group_name 值: "${groupName}"`],
  };
}

/**
 * 检查单个 series 值是否有效（用于值分布显示）
 */
function isSeriesValid(value: string): boolean {
  if (value === '(null)') return true;
  if (VALID_SERIES_NAMES.includes(value)) return true;
  // 多系列检查
  if (value.includes('\n')) {
    return value.split('\n').every((part) => VALID_SERIES_NAMES.includes(part.trim()));
  }
  return false;
}

// ============================================
// 报告输出
// ============================================

function printReport(entries: ValidationEntry[], errorsOnly: boolean, sectionTitle: string) {
  const valid = entries.filter((e) => e.valid);
  const invalid = entries.filter((e) => !e.valid);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${sectionTitle}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  总计: ${entries.length} | 合规: ${valid.length} | 不合规: ${invalid.length}`);

  if (invalid.length > 0) {
    console.log(`\n  ❌ 不合规的 group_name:`);
    for (const entry of invalid) {
      console.log(`    ${entry.cardCode} "${entry.name}"`);
      console.log(`      来源: ${entry.origin}`);
      console.log(`      当前值: "${entry.groupName}"`);
      for (const err of entry.errors) {
        console.log(`      - ${err}`);
      }
      if (entry.suggestion) {
        console.log(`      建议: → "${entry.suggestion}"`);
      }
    }
  }

  if (!errorsOnly && valid.length > 0 && valid.length <= 20) {
    console.log(`\n  ✅ 合规的 group_name (${valid.length}):`);
    for (const entry of valid) {
      const value = entry.groupName ?? 'null';
      console.log(`    ${entry.cardCode} "${entry.name}": ${value}`);
    }
  } else if (!errorsOnly && valid.length > 20) {
    console.log(`\n  ✅ 合规的 group_name: ${valid.length} 条（省略详情）`);
  }
}

// ============================================
// 数据库验证
// ============================================

async function validateDb(errorsOnly: boolean): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL is required for --source=db');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log('\n📋 正在检查 cards 表...');

    const { rows: cardRows } = await pool.query<{
      card_code: string;
      name: string;
      group_name: string | null;
      status: string;
    }>('SELECT card_code, name, group_name, status FROM cards ORDER BY card_code');

    const entries: ValidationEntry[] = cardRows.map((row) => {
      const result = validateGroupName(row.group_name);
      return {
        cardCode: row.card_code,
        name: row.name,
        groupName: row.group_name,
        origin: `cards 表 (status=${row.status})`,
        valid: result.valid,
        errors: result.errors,
        suggestion: result.suggestion,
      };
    });

    // 统计 group_name 值分布
    const valueCounts = new Map<string, number>();
    for (const row of cardRows) {
      const key = row.group_name ?? '(null)';
      valueCounts.set(key, (valueCounts.get(key) ?? 0) + 1);
    }

    console.log('\n  group_name 值分布:');
    const sortedValues = [...valueCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [value, count] of sortedValues) {
      const isValid = isSeriesValid(value);
      const marker = isValid ? '✅' : '❌';
      console.log(`    ${marker} "${value}": ${count}`);
    }

    printReport(entries, errorsOnly, 'Cards 表 group_name 验证');
  } finally {
    await pool.end();
  }
}

// ============================================
// llocg_db 验证
// ============================================

function validateLlocg(errorsOnly: boolean): void {
  const jpPath = path.resolve('llocg_db/json/cards.json');
  const cnPath = path.resolve('llocg_db/json/cards_cn.json');

  // JP
  console.log('\n📋 正在检查 llocg_db JP (cards.json)...');
  if (!fs.existsSync(jpPath)) {
    console.error(`  Error: ${jpPath} not found. Run: git submodule update --init`);
  } else {
    const jpData = JSON.parse(fs.readFileSync(jpPath, 'utf-8')) as Record<
      string,
      { name?: string; series?: string }
    >;

    const entries: ValidationEntry[] = [];
    for (const [cardCode, card] of Object.entries(jpData)) {
      const result = validateGroupName(card.series || null);
      entries.push({
        cardCode,
        name: card.name || cardCode,
        groupName: card.series || null,
        origin: 'llocg JP (cards.json)',
        valid: result.valid,
        errors: result.errors,
        suggestion: result.suggestion,
      });
    }

    // 统计 series 值分布
    const valueCounts = new Map<string, number>();
    for (const entry of entries) {
      const key = entry.groupName ?? '(null)';
      valueCounts.set(key, (valueCounts.get(key) ?? 0) + 1);
    }

    console.log('\n  series 值分布:');
    const sortedValues = [...valueCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [value, count] of sortedValues) {
      const isValid = isSeriesValid(value);
      const marker = isValid ? '✅' : '❌';
      console.log(`    ${marker} "${value}": ${count}`);
    }

    printReport(entries, errorsOnly, 'llocg_db JP series 验证');
  }

  // CN - 通常没有 series 字段，但检查一下
  console.log('\n📋 正在检查 llocg_db CN (cards_cn.json)...');
  if (!fs.existsSync(cnPath)) {
    console.error(`  Error: ${cnPath} not found. Run: git submodule update --init`);
  } else {
    const cnData = JSON.parse(fs.readFileSync(cnPath, 'utf-8')) as Record<
      string,
      { card_name_cn?: string; card_name_org?: string }
    >;

    // CN 数据通常没有 series 字段
    console.log(`  CN 数据共 ${Object.keys(cnData).length} 条，通常无 series 字段`);
    console.log('  ✅ 跳过 CN 数据验证');
  }
}

// ============================================
// 主流程
// ============================================

async function main() {
  const { source, errorsOnly } = parseArgs();

  console.log('🔍 group_name 验证工具');
  console.log(`   数据源: ${source} | 模式: ${errorsOnly ? '仅错误' : '全部'}\n`);

  console.log('有效的作品名:');
  for (const name of VALID_SERIES_NAMES) {
    console.log(`  - ${name}`);
  }

  if (source === 'db' || source === 'all') {
    await validateDb(errorsOnly);
  }

  if (source === 'llocg' || source === 'all') {
    validateLlocg(errorsOnly);
  }

  console.log('\n✅ 验证完成');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
