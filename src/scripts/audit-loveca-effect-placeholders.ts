/**
 * Loveca Excel card effect placeholder audit.
 *
 * This is a read-only companion to sync-cards-loveca-excel.ts. It scans the
 * bilingual effect columns and summarizes raw placeholder tokens such as
 * 【ライブ開始時】, 【LIVE开始时】, [紫ハート], [ブレード], and [E].
 */

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { normalizeCardCode } from '../shared/utils/card-code.js';

interface Args {
  readonly xlsxPath: string;
  readonly json: boolean;
}

type EffectLanguage = 'jp' | 'cn';

interface ExcelCardRow {
  readonly rowNumber: number;
  readonly cardCode: string;
  readonly nameJp: string | null;
  readonly nameCn: string | null;
  readonly effectJp: string | null;
  readonly effectCn: string | null;
}

interface PlaceholderExample {
  readonly rowNumber: number;
  readonly cardCode: string;
  readonly name: string | null;
  readonly language: EffectLanguage;
  readonly line: string;
}

interface PlaceholderStat {
  readonly token: string;
  readonly total: number;
  readonly jp: number;
  readonly cn: number;
  readonly kind: PlaceholderKind;
  readonly known: boolean;
  readonly examples: PlaceholderExample[];
}

type PlaceholderKind =
  | 'abilityTiming'
  | 'turnLimit'
  | 'slotCondition'
  | 'heart'
  | 'blade'
  | 'cost'
  | 'score'
  | 'other'
  | 'unknown';

const DEFAULT_XLSX_PATH = 'docs/card-data-sync/sources/loveca_20260626015115.xlsx';

const FIELD_NAMES = {
  cardCode: 'カード番号',
  nameJp: 'カード名',
  nameCn: '卡牌中文名',
  effectJp: '多行日文效果',
  effectCn: '多行中文效果',
} as const;

const BRACKET_TOKEN_PATTERN = /【[^】\r\n]+】|\[[^\]\r\n]+\]/g;

const KNOWN_TOKEN_KINDS = new Map<string, PlaceholderKind>([
  ['【登場】', 'abilityTiming'],
  ['【登场】', 'abilityTiming'],
  ['【ライブ開始時】', 'abilityTiming'],
  ['【LIVE开始时】', 'abilityTiming'],
  ['【ライブ成功時】', 'abilityTiming'],
  ['【LIVE成功时】', 'abilityTiming'],
  ['【起動】', 'abilityTiming'],
  ['【起动】', 'abilityTiming'],
  ['【常時】', 'abilityTiming'],
  ['【常时】', 'abilityTiming'],
  ['【自動】', 'abilityTiming'],
  ['【自动】', 'abilityTiming'],
  ['【ターン1回】', 'turnLimit'],
  ['【1回合1次】', 'turnLimit'],
  ['【1回合1 次】', 'turnLimit'],
  ['【ターン2回】', 'turnLimit'],
  ['【1回合2次】', 'turnLimit'],
  ['【センター】', 'slotCondition'],
  ['【中央】', 'slotCondition'],
  ['【左サイド】', 'slotCondition'],
  ['【左侧】', 'slotCondition'],
  ['【右サイド】', 'slotCondition'],
  ['【右侧】', 'slotCondition'],
  ['[E]', 'cost'],
  ['[スコア]', 'score'],
  ['[ブレード]', 'blade'],
  ['[ALLブレード]', 'blade'],
  ['[桃ブレード]', 'blade'],
  ['[赤ブレード]', 'blade'],
  ['[黄ブレード]', 'blade'],
  ['[緑ブレード]', 'blade'],
  ['[青ブレード]', 'blade'],
  ['[紫ブレード]', 'blade'],
  ['[桃ハート]', 'heart'],
  ['[赤ハート]', 'heart'],
  ['[黄ハート]', 'heart'],
  ['[緑ハート]', 'heart'],
  ['[青ハート]', 'heart'],
  ['[紫ハート]', 'heart'],
  ['[無ハート]', 'heart'],
  ['[ALLハート]', 'heart'],
]);

function parseArgs(argv: readonly string[]): Args {
  let xlsxPath = DEFAULT_XLSX_PATH;
  let json = false;

  for (const arg of argv) {
    if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--xlsx=')) {
      xlsxPath = arg.slice('--xlsx='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    xlsxPath: path.resolve(xlsxPath),
    json,
  };
}

function unzipText(xlsxPath: string, entryName: string): string {
  return execFileSync('unzip', ['-p', xlsxPath, entryName], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(parseInt(decimal, 10))
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function getAttribute(source: string, name: string): string | null {
  const match = source.match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? decodeXmlText(match[1]) : null;
}

function columnIndexFromCellRef(cellRef: string): number {
  const letters = cellRef.match(/^[A-Z]+/)?.[0];
  if (!letters) {
    throw new Error(`Invalid cell ref: ${cellRef}`);
  }

  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function extractTextNodes(xml: string): string {
  const parts: string[] = [];
  const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let match: RegExpExecArray | null;
  while ((match = textRegex.exec(xml)) !== null) {
    parts.push(decodeXmlText(match[1] ?? ''));
  }
  return parts.join('');
}

function parseSharedStrings(sharedStringsXml: string): string[] {
  const result: string[] = [];
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(sharedStringsXml)) !== null) {
    result.push(extractTextNodes(match[1] ?? ''));
  }
  return result;
}

function parseWorksheetRows(sheetXml: string, sharedStrings: readonly string[]): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowAttrs = rowMatch[1] ?? '';
    const rowNumber = Number(getAttribute(rowAttrs, 'r') ?? rows.length + 1);
    const row: string[] = [];
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowMatch[2] ?? '')) !== null) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      const cellRef = getAttribute(attrs, 'r');
      if (!cellRef) {
        continue;
      }

      const columnIndex = columnIndexFromCellRef(cellRef);
      const type = getAttribute(attrs, 't');
      let value = '';

      if (type === 'inlineStr') {
        value = extractTextNodes(body);
      } else {
        const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
        const decoded = decodeXmlText(rawValue);
        value = type === 's' ? (sharedStrings[Number(decoded)] ?? '') : decoded;
      }

      row[columnIndex] = value;
    }

    rows[rowNumber - 1] = row;
  }

  return rows;
}

function cleanString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readLovecaExcelRows(xlsxPath: string): ExcelCardRow[] {
  const sheetXml = unzipText(xlsxPath, 'xl/worksheets/sheet1.xml');
  let sharedStrings: string[] = [];
  try {
    sharedStrings = parseSharedStrings(unzipText(xlsxPath, 'xl/sharedStrings.xml'));
  } catch {
    sharedStrings = [];
  }

  const rows = parseWorksheetRows(sheetXml, sharedStrings);
  const headers = rows[0] ?? [];
  const cardCodeIndex = headers.indexOf(FIELD_NAMES.cardCode);
  const nameJpIndex = headers.indexOf(FIELD_NAMES.nameJp);
  const nameCnIndex = headers.indexOf(FIELD_NAMES.nameCn);
  const effectJpIndex = headers.indexOf(FIELD_NAMES.effectJp);
  const effectCnIndex = headers.indexOf(FIELD_NAMES.effectCn);

  for (const [label, index] of [
    [FIELD_NAMES.cardCode, cardCodeIndex],
    [FIELD_NAMES.nameJp, nameJpIndex],
    [FIELD_NAMES.nameCn, nameCnIndex],
    [FIELD_NAMES.effectJp, effectJpIndex],
    [FIELD_NAMES.effectCn, effectCnIndex],
  ] as const) {
    if (index < 0) {
      throw new Error(`Missing Excel column: ${label}`);
    }
  }

  const result: ExcelCardRow[] = [];
  for (let index = 1; index < rows.length; index++) {
    const rawRow = rows[index] ?? [];
    const rawCode = cleanString(rawRow[cardCodeIndex]);
    if (!rawCode) {
      continue;
    }

    result.push({
      rowNumber: index + 1,
      cardCode: normalizeCardCode(rawCode),
      nameJp: cleanString(rawRow[nameJpIndex]),
      nameCn: cleanString(rawRow[nameCnIndex]),
      effectJp: cleanString(rawRow[effectJpIndex]),
      effectCn: cleanString(rawRow[effectCnIndex]),
    });
  }

  return result;
}

function findTokenLine(text: string, token: string): string {
  const line = text
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.includes(token));
  return line ?? text.slice(0, 160);
}

function collectPlaceholderStats(rows: readonly ExcelCardRow[]): PlaceholderStat[] {
  const stats = new Map<string, PlaceholderStat>();

  for (const row of rows) {
    for (const [language, text] of [
      ['jp', row.effectJp],
      ['cn', row.effectCn],
    ] as const) {
      if (!text) {
        continue;
      }

      let match: RegExpExecArray | null;
      while ((match = BRACKET_TOKEN_PATTERN.exec(text)) !== null) {
        const token = match[0];
        const current =
          stats.get(token) ??
          ({
            token,
            total: 0,
            jp: 0,
            cn: 0,
            kind: KNOWN_TOKEN_KINDS.get(token) ?? 'unknown',
            known: KNOWN_TOKEN_KINDS.has(token),
            examples: [],
          } satisfies PlaceholderStat);
        const example: PlaceholderExample = {
          rowNumber: row.rowNumber,
          cardCode: row.cardCode,
          name: row.nameCn ?? row.nameJp,
          language,
          line: findTokenLine(text, token),
        };

        stats.set(token, {
          ...current,
          total: current.total + 1,
          jp: current.jp + (language === 'jp' ? 1 : 0),
          cn: current.cn + (language === 'cn' ? 1 : 0),
          examples: current.examples.length < 3 ? [...current.examples, example] : current.examples,
        });
      }
    }
  }

  return [...stats.values()].sort(
    (left, right) => right.total - left.total || left.token.localeCompare(right.token)
  );
}

function printTextReport(rows: readonly ExcelCardRow[], stats: readonly PlaceholderStat[]) {
  const withPlaceholders = new Set<number>();
  for (const row of rows) {
    if (BRACKET_TOKEN_PATTERN.test(`${row.effectJp ?? ''}\n${row.effectCn ?? ''}`)) {
      withPlaceholders.add(row.rowNumber);
    }
    BRACKET_TOKEN_PATTERN.lastIndex = 0;
  }

  const knownCount = stats.filter((stat) => stat.known).length;
  const unknownStats = stats.filter((stat) => !stat.known);

  console.log('Loveca Excel effect placeholder audit');
  console.log(`  Excel rows: ${rows.length}`);
  console.log(`  Rows with placeholders: ${withPlaceholders.size}`);
  console.log(`  Raw placeholder tokens: ${stats.length}`);
  console.log(`  Known tokens: ${knownCount}`);
  console.log(`  Unknown tokens: ${unknownStats.length}`);

  console.log('\nToken summary:');
  for (const stat of stats) {
    const knownLabel = stat.known ? stat.kind : 'unknown';
    console.log(
      `  ${stat.token}\t${stat.total}\tjp=${stat.jp}\tcn=${stat.cn}\t${knownLabel}`
    );
  }

  if (unknownStats.length > 0) {
    console.log('\nUnknown / suspicious tokens:');
    for (const stat of unknownStats) {
      const example = stat.examples[0];
      console.log(`  ${stat.token} (${stat.total})`);
      if (example) {
        console.log(
          `    e.g. row ${example.rowNumber} ${example.cardCode} ${example.name ?? ''} ${example.language}: ${example.line}`
        );
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = readLovecaExcelRows(args.xlsxPath);
  const stats = collectPlaceholderStats(rows);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          xlsxPath: args.xlsxPath,
          rowCount: rows.length,
          tokenCount: stats.length,
          stats,
        },
        null,
        2
      )
    );
    return;
  }

  printTextReport(rows, stats);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
