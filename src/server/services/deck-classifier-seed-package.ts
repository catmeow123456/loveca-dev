import JSZip from 'jszip';
import type { DeckArchetypeRuleConditions, DeckCardInput } from './deck-classifier-engine.js';
import { fingerprintNormalizedDeck, normalizeDeck } from './deck-classifier-engine.js';

export interface DeckClassifierSeedArchetype {
  readonly archetypeKey: string;
  readonly name: string;
  readonly groupName: string;
  readonly description: string;
  readonly color: string;
  readonly sortOrder: number;
}

export interface DeckClassifierSeedTemplate {
  readonly deckFingerprint: string;
  readonly archetypeKey: string;
  readonly name: string;
  readonly cards: readonly DeckCardInput[];
  readonly enabled: boolean;
  readonly sourceNote: string;
}

export interface DeckClassifierSeedRule {
  readonly sourceKey: string;
  readonly archetypeKey: string;
  readonly name: string;
  readonly priority: number;
  readonly definition: DeckArchetypeRuleConditions;
  readonly enabled: boolean;
}

export interface DeckClassifierSeedPackage {
  readonly catalogVersion: string;
  readonly ruleVersion: string;
  readonly archetypes: readonly DeckClassifierSeedArchetype[];
  readonly templates: readonly DeckClassifierSeedTemplate[];
  readonly rules: readonly DeckClassifierSeedRule[];
  readonly activeTemplateCount: number;
  readonly provisionalTemplateCount: number;
  readonly ignoredSoftSignatureCount: number;
}

export async function readDeckClassifierSeedPackage(
  archive: Uint8Array
): Promise<DeckClassifierSeedPackage> {
  const zip = await JSZip.loadAsync(archive);
  const [archetypeText, templateText, ruleText] = await Promise.all([
    readRequiredEntry(zip, '02_archetypes.seed.json'),
    readRequiredEntry(zip, '04_deck_templates.seed.jsonl'),
    readRequiredEntry(zip, '05_special_rules.seed.json'),
  ]);
  const archetypeRoot = requireRecord(parseJson(archetypeText, '分类名称种子'), '分类名称种子');
  const ruleRoot = requireRecord(parseJson(ruleText, '特殊规则种子'), '特殊规则种子');
  const catalogVersion = requireText(archetypeRoot.catalogVersion, 'catalogVersion');
  const ruleVersion = requireText(ruleRoot.ruleVersion, 'ruleVersion');
  const rawArchetypes = requireArray(archetypeRoot.archetypes, 'archetypes');
  const archetypes = rawArchetypes.map((value, index): DeckClassifierSeedArchetype => {
    const row = requireRecord(value, `archetypes[${index}]`);
    const status = requireText(row.status, `archetypes[${index}].status`);
    return {
      archetypeKey: requireKey(row.archetypeId, `archetypes[${index}].archetypeId`),
      name: requireText(row.displayName, `archetypes[${index}].displayName`),
      groupName: requireText(row.group, `archetypes[${index}].group`),
      description: `种子可信度：${status}。${optionalText(row.notes)}`.trim(),
      color: colorForArchetype(index),
      sortOrder: (index + 1) * 10,
    };
  });
  requireUnique(
    archetypes.map((row) => row.archetypeKey),
    '分类 key'
  );
  const archetypeKeys = new Set(archetypes.map((row) => row.archetypeKey));

  const templateLines = templateText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const templates = templateLines.map((line, index): DeckClassifierSeedTemplate => {
    const row = requireRecord(parseJson(line, `样板第 ${index + 1} 行`), `样板第 ${index + 1} 行`);
    const archetypeKey = requireKey(row.archetypeId, `样板第 ${index + 1} 行 archetypeId`);
    if (!archetypeKeys.has(archetypeKey)) {
      throw new Error(`样板第 ${index + 1} 行指向未知分类 ${archetypeKey}`);
    }
    const memberCounts = readCountMap(row.memberCounts, `样板第 ${index + 1} 行 memberCounts`);
    const liveCounts = readCountMap(row.liveCounts, `样板第 ${index + 1} 行 liveCounts`);
    const cards: DeckCardInput[] = [
      ...memberCounts.map(([baseCardCode, count]) => ({
        baseCardCode,
        cardType: 'MEMBER' as const,
        count,
      })),
      ...liveCounts.map(([baseCardCode, count]) => ({
        baseCardCode,
        cardType: 'LIVE' as const,
        count,
      })),
    ];
    const normalized = normalizeDeck(cards);
    if (!normalized.valid) {
      throw new Error(`样板第 ${index + 1} 行不是 48 MEMBER + 12 LIVE 的合法构筑`);
    }
    const deckFingerprint = requireFingerprint(
      row.deckFingerprint,
      `样板第 ${index + 1} 行 deckFingerprint`
    );
    if (fingerprintNormalizedDeck(normalized.deck) !== deckFingerprint) {
      throw new Error(`样板第 ${index + 1} 行指纹与卡牌清单不一致`);
    }
    const displayName = requireText(row.displayName, `样板第 ${index + 1} 行 displayName`);
    const observationCount = requireNonNegativeInteger(
      row.observationCount,
      `样板第 ${index + 1} 行 observationCount`
    );
    const labelStatus = requireText(row.labelStatus, `样板第 ${index + 1} 行 labelStatus`);
    const enabled = row.activeTemplate === true;
    return {
      deckFingerprint,
      archetypeKey,
      name: `${displayName} · ${observationCount} 场 · ${deckFingerprint.slice(7, 15)}`,
      cards,
      enabled,
      sourceNote: `种子包 ${catalogVersion}；label=${labelStatus}；${enabled ? '启用样板' : 'provisional，待人工复核'}`,
    };
  });
  requireUnique(
    templates.map((row) => row.deckFingerprint),
    '样板指纹'
  );

  const rules = requireArray(ruleRoot.rules, 'rules').map(
    (value, index): DeckClassifierSeedRule => {
      const row = requireRecord(value, `rules[${index}]`);
      const sourceKey = requireKey(row.ruleId, `rules[${index}].ruleId`);
      const archetypeKey = requireKey(row.archetypeId, `rules[${index}].archetypeId`);
      if (!archetypeKeys.has(archetypeKey)) {
        throw new Error(`规则 ${sourceKey} 指向未知分类 ${archetypeKey}`);
      }
      const scope = requireRecord(row.scope, `rules[${index}].scope`);
      const cardType = readCardType(scope.cardType, `rules[${index}].scope.cardType`);
      const conditions = requireRecord(row.conditions, `rules[${index}].conditions`);
      const includeAll = requireArray(conditions.all, `rules[${index}].conditions.all`).map(
        (constraint, constraintIndex) => {
          const item = requireRecord(
            constraint,
            `rules[${index}].conditions.all[${constraintIndex}]`
          );
          return {
            baseCardCode: requireText(item.baseCardCode, '规则卡号'),
            cardType,
            minCount: requireNonNegativeInteger(item.minCount, '规则最少数量'),
          };
        }
      );
      const sumAtLeast = conditions.sumAtLeast;
      const countSums =
        sumAtLeast === undefined
          ? undefined
          : [
              (() => {
                const sum = requireRecord(sumAtLeast, `rules[${index}].conditions.sumAtLeast`);
                return {
                  baseCardCodes: requireArray(sum.baseCardCodes, '规则合计卡号').map((cardCode) =>
                    requireText(cardCode, '规则合计卡号')
                  ),
                  cardType,
                  minCount: requireNonNegativeInteger(sum.minCount, '规则合计最少数量'),
                };
              })(),
            ];
      return {
        sourceKey,
        archetypeKey,
        name: `[seed:${sourceKey}] ${requireText(row.displayName, `rules[${index}].displayName`)}`,
        priority: 100,
        definition: { includeAll, ...(countSums ? { countSums } : {}) },
        enabled: row.enabled === true,
      };
    }
  );
  requireUnique(
    rules.map((row) => row.sourceKey),
    '规则种子 key'
  );

  return {
    catalogVersion,
    ruleVersion,
    archetypes,
    templates,
    rules,
    activeTemplateCount: templates.filter((row) => row.enabled).length,
    provisionalTemplateCount: templates.filter((row) => !row.enabled).length,
    ignoredSoftSignatureCount: Array.isArray(ruleRoot.softSignatures)
      ? ruleRoot.softSignatures.length
      : 0,
  };
}

function colorForArchetype(index: number): string {
  const hue = (index * 137.508 + 218) % 360;
  const saturation = 0.62 + (index % 2) * 0.08;
  const lightness = [0.43, 0.5, 0.38][index % 3] ?? 0.43;
  return hslToHex(hue, saturation, lightness);
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = hue / 60;
  const secondary = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] =
    section < 1
      ? [chroma, secondary, 0]
      : section < 2
        ? [secondary, chroma, 0]
        : section < 3
          ? [0, chroma, secondary]
          : section < 4
            ? [0, secondary, chroma]
            : section < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const match = lightness - chroma / 2;
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round((channel + match) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`.toUpperCase();
}

async function readRequiredEntry(zip: JSZip, suffix: string): Promise<string> {
  const matches = Object.values(zip.files).filter(
    (entry) => !entry.dir && entry.name.endsWith(suffix)
  );
  if (matches.length !== 1 || !matches[0]) {
    throw new Error(`种子包必须且只能包含一个 ${suffix}`);
  }
  return matches[0].async('string');
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} JSON 格式无效`);
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 不能为空`);
  return value.trim();
}

function optionalText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireKey(value: unknown, label: string): string {
  const result = requireText(value, label);
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/u.test(result)) throw new Error(`${label} 格式无效`);
  return result;
}

function requireFingerprint(value: unknown, label: string): string {
  const result = requireText(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) throw new Error(`${label} 格式无效`);
  return result;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${label} 必须是非负整数`);
  return value as number;
}

function readCountMap(value: unknown, label: string): [string, number][] {
  const record = requireRecord(value, label);
  return Object.entries(record)
    .map(([baseCardCode, count]): [string, number] => [
      requireText(baseCardCode, `${label} 卡号`),
      requireNonNegativeInteger(count, `${label}.${baseCardCode}`),
    ])
    .filter((entry) => entry[1] > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));
}

function readCardType(value: unknown, label: string): 'MEMBER' | 'LIVE' {
  if (value !== 'MEMBER' && value !== 'LIVE') throw new Error(`${label} 格式无效`);
  return value;
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} 存在重复`);
}
