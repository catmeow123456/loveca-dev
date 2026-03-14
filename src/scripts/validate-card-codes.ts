/**
 * 卡牌编号验证脚本
 *
 * 检查数据库和/或 llocg_db 数据源中所有 card_code 是否符合 data-spec 规范。
 *
 * 使用方法:
 *   # 验证数据库中的 cards 表和 decks 表
 *   DATABASE_URL=postgresql://... npx tsx src/scripts/validate-card-codes.ts --source=db
 *
 *   # 验证 llocg_db JSON 文件（标准化后）
 *   npx tsx src/scripts/validate-card-codes.ts --source=llocg
 *
 *   # 同时验证两者
 *   DATABASE_URL=postgresql://... npx tsx src/scripts/validate-card-codes.ts --source=all
 *
 *   # 仅显示不合规的条目（默认显示全部）
 *   npx tsx src/scripts/validate-card-codes.ts --source=llocg --errors-only
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import {
  normalizeCardCode,
  validateCardCode,
  type CardCodeValidationResult,
} from '../shared/utils/card-code';

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
// 验证结果聚合
// ============================================

interface ValidationEntry {
  cardCode: string;
  origin: string; // e.g. "cards table", "decks.main_deck (deck_id=xxx)", "llocg JP", "llocg CN"
  result: CardCodeValidationResult;
  normalized?: string; // 标准化前的原始值（如果不同）
}

function printReport(entries: ValidationEntry[], errorsOnly: boolean, sectionTitle: string) {
  const valid = entries.filter((e) => e.result.valid);
  const invalid = entries.filter((e) => !e.result.valid);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${sectionTitle}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  总计: ${entries.length} | 合规: ${valid.length} | 不合规: ${invalid.length}`);

  if (invalid.length > 0) {
    console.log(`\n  ❌ 不合规的 card_code:`);
    for (const entry of invalid) {
      const normNote = entry.normalized ? ` (原始: "${entry.normalized}")` : '';
      console.log(`    ${entry.cardCode}${normNote}`);
      console.log(`      来源: ${entry.origin}`);
      for (const err of entry.result.errors) {
        console.log(`      - ${err}`);
      }
    }
  }

  if (!errorsOnly && valid.length > 0 && valid.length <= 20) {
    console.log(`\n  ✅ 合规的 card_code (${valid.length}):`);
    for (const entry of valid) {
      console.log(`    ${entry.cardCode} [${entry.origin}]`);
    }
  } else if (!errorsOnly && valid.length > 20) {
    console.log(`\n  ✅ 合规的 card_code: ${valid.length} 条（省略详情）`);
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
    // 1. 验证 cards 表
    console.log('\n📋 正在检查 cards 表...');
    const { rows: cardRows } = await pool.query<{ card_code: string; status: string }>(
      'SELECT card_code, status FROM cards ORDER BY card_code'
    );

    const cardEntries: ValidationEntry[] = cardRows.map((row) => ({
      cardCode: row.card_code,
      origin: `cards 表 (status=${row.status})`,
      result: validateCardCode(row.card_code),
    }));

    // 检查是否有全角+（标准化问题）
    const fullWidthCards = cardRows.filter((r) => r.card_code.includes('＋'));
    if (fullWidthCards.length > 0) {
      console.log(`\n  ⚠️  发现 ${fullWidthCards.length} 条含全角＋的 card_code（需标准化）:`);
      for (const c of fullWidthCards) {
        console.log(`    ${c.card_code} → ${normalizeCardCode(c.card_code)}`);
      }
    }

    // 检查标准化后是否会产生冲突
    const normalizedMap = new Map<string, string[]>();
    for (const row of cardRows) {
      const norm = normalizeCardCode(row.card_code);
      const existing = normalizedMap.get(norm) ?? [];
      existing.push(row.card_code);
      normalizedMap.set(norm, existing);
    }
    const conflicts = [...normalizedMap.entries()].filter(([, codes]) => codes.length > 1);
    if (conflicts.length > 0) {
      console.log(`\n  ⚠️  标准化后会产生 ${conflicts.length} 组冲突:`);
      for (const [norm, codes] of conflicts) {
        console.log(`    ${norm} ← [${codes.join(', ')}]`);
      }
    }

    printReport(cardEntries, errorsOnly, 'Cards 表 card_code 验证');

    // 2. 验证 decks 表
    console.log('\n📋 正在检查 decks 表...');
    const { rows: deckRows } = await pool.query<{
      id: string;
      name: string;
      main_deck: { card_code: string; count: number }[];
      energy_deck: { card_code: string; count: number }[];
    }>('SELECT id, name, main_deck, energy_deck FROM decks');

    const deckEntries: ValidationEntry[] = [];
    const cardCodesInCards = new Set(cardRows.map((r) => r.card_code));
    let missingFromCards = 0;

    for (const deck of deckRows) {
      const allEntries = [
        ...(deck.main_deck || []).map((e) => ({ ...e, section: 'main_deck' })),
        ...(deck.energy_deck || []).map((e) => ({ ...e, section: 'energy_deck' })),
      ];

      for (const entry of allEntries) {
        const result = validateCardCode(entry.card_code);
        deckEntries.push({
          cardCode: entry.card_code,
          origin: `decks.${entry.section} (deck="${deck.name}", id=${deck.id.substring(0, 8)})`,
          result,
        });

        // 检查 deck 中的 card_code 是否存在于 cards 表
        if (!cardCodesInCards.has(entry.card_code)) {
          missingFromCards++;
          if (!errorsOnly) {
            console.log(`  ⚠️  deck "${deck.name}" 中的 ${entry.card_code} 不存在于 cards 表`);
          }
        }
      }
    }

    // 去重统计
    const uniqueDeckCodes = new Set(deckEntries.map((e) => e.cardCode));
    console.log(
      `  共 ${deckRows.length} 个 deck，${deckEntries.length} 条引用（${uniqueDeckCodes.size} 个唯一 card_code）`
    );
    if (missingFromCards > 0) {
      console.log(`  ⚠️  ${missingFromCards} 条引用不存在于 cards 表中`);
    }

    printReport(deckEntries, errorsOnly, 'Decks 表 card_code 验证');
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
    const jpData = JSON.parse(fs.readFileSync(jpPath, 'utf-8')) as Record<string, unknown>;
    const jpEntries: ValidationEntry[] = [];

    for (const rawCode of Object.keys(jpData)) {
      const normalized = normalizeCardCode(rawCode);
      const result = validateCardCode(normalized);
      jpEntries.push({
        cardCode: normalized,
        origin: 'llocg JP (cards.json)',
        result,
        normalized: rawCode !== normalized ? rawCode : undefined,
      });
    }

    // 统计需要标准化的数量
    const needNormalize = jpEntries.filter((e) => e.normalized);
    if (needNormalize.length > 0) {
      console.log(`  ℹ️  ${needNormalize.length} 条需要标准化（全角＋→半角+）`);
    }

    printReport(jpEntries, errorsOnly, 'llocg_db JP card_no 验证（标准化后）');
  }

  // CN
  console.log('\n📋 正在检查 llocg_db CN (cards_cn.json)...');
  if (!fs.existsSync(cnPath)) {
    console.error(`  Error: ${cnPath} not found. Run: git submodule update --init`);
  } else {
    const cnData = JSON.parse(fs.readFileSync(cnPath, 'utf-8')) as Record<string, unknown>;
    const cnEntries: ValidationEntry[] = [];

    for (const rawCode of Object.keys(cnData)) {
      const normalized = normalizeCardCode(rawCode);
      const result = validateCardCode(normalized);
      cnEntries.push({
        cardCode: normalized,
        origin: 'llocg CN (cards_cn.json)',
        result,
        normalized: rawCode !== normalized ? rawCode : undefined,
      });
    }

    printReport(cnEntries, errorsOnly, 'llocg_db CN card_no 验证（标准化后）');
  }
}

// ============================================
// 主流程
// ============================================

async function main() {
  const { source, errorsOnly } = parseArgs();

  console.log('🔍 卡牌编号验证工具');
  console.log(`   数据源: ${source} | 模式: ${errorsOnly ? '仅错误' : '全部'}\n`);

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
