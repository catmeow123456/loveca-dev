import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface CardRecord {
  readonly card_no: string;
  readonly name?: string;
  readonly type?: string;
  readonly rare?: string;
  readonly cost?: number;
  readonly score?: number;
  readonly ability?: string;
}

export interface AbilityDefinition {
  readonly abilityId: string;
  readonly baseCardCodes?: readonly string[];
  readonly cardCodes?: readonly string[];
  readonly category?: string;
  readonly sourceZone?: string;
  readonly triggerCondition?: string;
  readonly queued?: boolean;
  readonly implemented?: boolean;
  readonly effectText?: string;
}

export interface CardGroup {
  readonly baseCardCode: string;
  readonly prints: readonly CardRecord[];
  readonly representative: CardRecord;
  readonly definitions: readonly AbilityDefinition[];
}

export function findRepoRoot(startDirectory = process.cwd()): string {
  let current = resolve(startDirectory);
  while (true) {
    if (
      existsSync(join(current, 'package.json')) &&
      existsSync(join(current, 'src/application/card-effects/definitions/index.ts')) &&
      existsSync(join(current, 'llocg_db/json/cards.json'))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error('请从 loveca_battle 仓库内运行此工具。');
    }
    current = parent;
  }
}

export function getBaseCardCode(card: CardRecord): string {
  const suffix = card.rare ? `-${card.rare}` : '';
  return suffix && card.card_no.endsWith(suffix)
    ? card.card_no.slice(0, -suffix.length)
    : card.card_no.replace(/-[^-]+$/, '');
}

export function loadCards(repoRoot: string): readonly CardRecord[] {
  const data = JSON.parse(
    readFileSync(join(repoRoot, 'llocg_db/json/cards.json'), 'utf8')
  ) as Record<string, CardRecord>;
  return Object.values(data);
}

export async function loadDefinitions(repoRoot: string): Promise<readonly AbilityDefinition[]> {
  const moduleUrl = pathToFileURL(
    join(repoRoot, 'src/application/card-effects/definitions/index.ts')
  ).href;
  const definitionsModule = (await import(moduleUrl)) as {
    readonly CARD_ABILITY_DEFINITIONS: readonly AbilityDefinition[];
  };
  return definitionsModule.CARD_ABILITY_DEFINITIONS;
}

export async function selectCardGroups(
  repoRoot: string,
  scopes: readonly string[]
): Promise<readonly CardGroup[]> {
  if (scopes.length === 0) {
    throw new Error('请至少提供一个基础编号、完整卡号或卡号前缀。');
  }

  const cards = loadCards(repoRoot).filter((card) => card.card_no && card.type !== 'エネルギー');
  const definitions = await loadDefinitions(repoRoot);
  const groups = new Map<string, CardRecord[]>();
  for (const card of cards) {
    const baseCardCode = getBaseCardCode(card);
    const prints = groups.get(baseCardCode) ?? [];
    prints.push(card);
    groups.set(baseCardCode, prints);
  }

  const exactPrintToBase = new Map(cards.map((card) => [card.card_no, getBaseCardCode(card)]));
  const selectedBases = new Set<string>();
  for (const scope of scopes) {
    const exactBase = groups.has(scope) ? scope : exactPrintToBase.get(scope);
    if (exactBase) {
      selectedBases.add(exactBase);
      continue;
    }
    for (const baseCardCode of groups.keys()) {
      if (baseCardCode.startsWith(scope)) {
        selectedBases.add(baseCardCode);
      }
    }
  }

  if (selectedBases.size === 0) {
    throw new Error(`没有找到匹配卡牌：${scopes.join(', ')}`);
  }

  return [...selectedBases]
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((baseCardCode) => {
      const prints = (groups.get(baseCardCode) ?? []).sort((left, right) =>
        left.card_no.localeCompare(right.card_no, 'en')
      );
      const printCodes = new Set(prints.map((card) => card.card_no));
      const matchedDefinitions = definitions.filter(
        (definition) =>
          definition.baseCardCodes?.includes(baseCardCode) ||
          definition.cardCodes?.some((cardCode) => printCodes.has(cardCode))
      );
      return {
        baseCardCode,
        prints,
        representative: prints[0]!,
        definitions: matchedDefinitions,
      };
    });
}

export function hasCardAbilityText(card: CardRecord): boolean {
  const text = String(card.ability ?? '').trim();
  return text.length > 0 && !/^[-ー－—]+$/.test(text);
}

export function formatCardStat(card: CardRecord): string {
  if (typeof card.cost === 'number') return `费用${card.cost}`;
  if (typeof card.score === 'number') return `分数${card.score}`;
  return '费用/分数未登记';
}

export function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

export function listFilesRecursively(
  repoRoot: string,
  relativeRoots: readonly string[],
  extensions: readonly string[]
): string[] {
  const output: string[] = [];
  const visit = (absolutePath: string): void => {
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      const child = join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        visit(child);
      } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
        output.push(relative(repoRoot, child));
      }
    }
  };
  for (const relativeRoot of relativeRoots) {
    const absoluteRoot = join(repoRoot, relativeRoot);
    if (existsSync(absoluteRoot)) visit(absoluteRoot);
  }
  return output.sort();
}

export function parseScopeArguments(argv: readonly string[]): {
  readonly scopes: string[];
  readonly flags: Set<string>;
  readonly values: Map<string, string>;
} {
  const scopes: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith('--')) {
      scopes.push(argument);
      continue;
    }
    if (argument.includes('=')) {
      const separator = argument.indexOf('=');
      values.set(argument.slice(0, separator), argument.slice(separator + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith('--') && ['--title', '--api-base-url'].includes(argument)) {
      values.set(argument, next);
      index += 1;
    } else {
      flags.add(argument);
    }
  }
  return { scopes, flags, values };
}
