import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

interface FrontendCardRecord {
  readonly card_code: string;
  readonly name_jp?: string | null;
  readonly name_cn?: string | null;
  readonly rare?: string | null;
  readonly cost?: number | null;
  readonly score?: number | null;
  readonly card_text_cn?: string | null;
  readonly card_text_jp?: string | null;
}

interface FrontendCardsResponse {
  readonly data?: readonly FrontendCardRecord[] | null;
  readonly error?: { readonly message?: string } | null;
}

interface ActivatedUiDefinition {
  readonly abilityId: string;
  readonly cardCodes?: readonly string[];
  readonly baseCardCodes?: readonly string[];
  readonly effectText: string;
  readonly activatedUi?: {
    readonly abilityId: string;
    readonly text: string;
    readonly title: string;
  };
}

type ApiTextField = 'card_text_cn' | 'card_text_jp';

interface KnownApiError {
  readonly baseCardCode: string;
  readonly abilityId: string;
  readonly field: ApiTextField;
  readonly affectedPrints: readonly string[];
  readonly erroneousValue: string;
  readonly correctValue: string;
  readonly evidence: string;
  readonly reason: string;
}

/**
 * Only confirmed, player-API-specific data errors belong here.
 *
 * Every entry must name the exact field and prints, preserve the erroneous API value,
 * and cite a concrete basis for the correction. Do not add broad prefixes or use this
 * list to waive mapping ambiguity.
 */
const KNOWN_API_ERRORS: readonly KnownApiError[] = [];

const DEFAULT_FRONTEND_API_BASE_URL = 'https://loveca.lovelivefun.xyz';
const ACTIVATED_PARAGRAPH_PATTERN = /^【(?:起动|起動)】/;
const ABILITY_PARAGRAPH_BOUNDARY =
  /\n[ \t]*\n(?=【(?:常时|常時|起动|起動|自动|自動|登场|登場|LIVE开始时?|LIVE開始時?|LIVE成功时?|LIVE成功時?)】)/u;

const CLASSIFICATIONS = [
  'THREE_LAYER_CONSISTENT',
  'SHARED_SUMMARY',
  'BUTTON_DRIFT',
  'API_MISSING',
  'RARITY_DRIFT',
  'AMBIGUOUS_SAME_TIMING_PARAGRAPHS',
  'KNOWN_API_ERROR',
] as const;

type Classification = (typeof CLASSIFICATIONS)[number];

interface ApiCardGroup {
  readonly baseCardCode: string;
  readonly prints: readonly FrontendCardRecord[];
}

interface AuditTarget {
  readonly baseCardCode: string;
  readonly definition: ActivatedUiDefinition;
  readonly unresolvedExactCardCode?: string;
}

interface AuditFinding {
  readonly classification: Classification;
  readonly baseCardCode: string;
  readonly cardCodes: readonly string[];
  readonly cardName: string;
  readonly stat: string;
  readonly abilityId: string;
  readonly effectText: string;
  readonly activatedUiText: string;
  readonly activatedUiTitle: string;
  readonly apiParagraph?: string;
  readonly apiTextField?: ApiTextField;
  readonly detail?: string;
}

interface AuditReport {
  readonly apiUrl: string;
  readonly scanned: {
    readonly apiCards: number;
    readonly activatedUiDefinitions: number;
    readonly baseCards: number;
    readonly abilityCardMappings: number;
  };
  readonly classificationCounts: Readonly<Record<Classification, number>>;
  readonly actionableViolationCount: number;
  readonly unresolvedCount: number;
  readonly findings: readonly AuditFinding[];
  readonly knownApiErrors: readonly KnownApiError[];
}

function findRepoRoot(startDirectory = process.cwd()): string {
  let current = resolve(startDirectory);
  while (true) {
    if (
      existsSync(join(current, 'package.json')) &&
      existsSync(join(current, 'src/application/card-effects/definitions/index.ts'))
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

function normalizeText(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\r\n?/g, '\n').trim();
  if (!normalized || /^[-ー－—]+$/.test(normalized)) return undefined;
  return normalized;
}

function normalizeCardCode(value: string): string {
  return value.replaceAll('＋', '+');
}

function normalizeApiBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('前端卡牌 API 地址不能为空。');
  return normalized;
}

function getApiBaseCardCode(card: FrontendCardRecord): string {
  const normalizedCode = normalizeCardCode(card.card_code);
  const normalizedRare = normalizeCardCode(card.rare?.trim() ?? '');
  const suffix = normalizedRare ? `-${normalizedRare}` : '';
  return suffix && normalizedCode.endsWith(suffix)
    ? normalizedCode.slice(0, -suffix.length)
    : normalizedCode.replace(/-[^-]+$/, '');
}

function getVisibleCardText(
  card: FrontendCardRecord
): { readonly field: ApiTextField; readonly text: string } | undefined {
  const chinese = normalizeText(card.card_text_cn);
  if (chinese) return { field: 'card_text_cn', text: chinese };
  const japanese = normalizeText(card.card_text_jp);
  if (japanese) return { field: 'card_text_jp', text: japanese };
  return undefined;
}

function splitAbilityParagraphs(cardText: string): readonly string[] {
  return cardText
    .split(ABILITY_PARAGRAPH_BOUNDARY)
    .map((paragraph) => normalizeText(paragraph))
    .filter((paragraph): paragraph is string => Boolean(paragraph));
}

async function loadDefinitions(repoRoot: string): Promise<readonly ActivatedUiDefinition[]> {
  const moduleUrl = pathToFileURL(
    join(repoRoot, 'src/application/card-effects/definitions/index.ts')
  ).href;
  const definitionsModule = (await import(moduleUrl)) as {
    readonly CARD_ABILITY_DEFINITIONS: readonly ActivatedUiDefinition[];
  };
  return definitionsModule.CARD_ABILITY_DEFINITIONS;
}

function findProperty(
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  name: string
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && candidate.name.getText(sourceFile) === name
  );
}

function findSourceDirectReuseViolations(
  repoRoot: string,
  definitions: readonly ActivatedUiDefinition[]
): ReadonlySet<string> {
  const definitionsPath = join(repoRoot, 'src/application/card-effects/definitions/index.ts');
  const source = readFileSync(definitionsPath, 'utf8');
  const sourceFile = ts.createSourceFile(
    definitionsPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const activatedObjects: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && findProperty(node, sourceFile, 'activatedUi')) {
      activatedObjects.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const activatedDefinitions = definitions.filter((definition) => definition.activatedUi);
  if (activatedObjects.length !== activatedDefinitions.length) {
    throw new Error(
      `definitions/index.ts 的 activatedUi 源码对象数 ${activatedObjects.length} 与运行时 definition 数 ${activatedDefinitions.length} 不一致。`
    );
  }

  const violations = new Set<string>();
  for (let index = 0; index < activatedDefinitions.length; index += 1) {
    const definition = activatedDefinitions[index]!;
    const object = activatedObjects[index]!;
    const effectText = findProperty(object, sourceFile, 'effectText');
    const activatedUi = findProperty(object, sourceFile, 'activatedUi');
    if (
      !effectText ||
      !activatedUi ||
      !ts.isIdentifier(effectText.initializer) ||
      !ts.isObjectLiteralExpression(activatedUi.initializer)
    ) {
      violations.add(definition.abilityId);
      continue;
    }
    const uiText = findProperty(activatedUi.initializer, sourceFile, 'text');
    if (uiText?.initializer.getText(sourceFile) !== effectText.initializer.text) {
      violations.add(definition.abilityId);
    }
  }
  return violations;
}

async function loadFrontendCards(apiUrl: string): Promise<readonly FrontendCardRecord[]> {
  let response: Response;
  try {
    response = await fetch(apiUrl, { headers: { accept: 'application/json' } });
  } catch (error) {
    throw new Error(
      `读取普通玩家卡牌 API 失败：${apiUrl}；${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!response.ok) {
    throw new Error(`读取普通玩家卡牌 API 失败：${apiUrl} 返回 HTTP ${response.status}。`);
  }
  const payload = (await response.json()) as FrontendCardsResponse;
  if (!payload.data) {
    throw new Error(
      `普通玩家卡牌 API 没有返回卡牌数据${
        payload.error?.message ? `：${payload.error.message}` : '。'
      }`
    );
  }
  return payload.data;
}

function groupApiCards(cards: readonly FrontendCardRecord[]): {
  readonly groups: ReadonlyMap<string, ApiCardGroup>;
  readonly exactPrintToBase: ReadonlyMap<string, string>;
} {
  const mutableGroups = new Map<string, FrontendCardRecord[]>();
  const exactPrintToBase = new Map<string, string>();
  for (const card of cards) {
    const baseCardCode = getApiBaseCardCode(card);
    const prints = mutableGroups.get(baseCardCode) ?? [];
    prints.push(card);
    mutableGroups.set(baseCardCode, prints);
    exactPrintToBase.set(normalizeCardCode(card.card_code), baseCardCode);
  }
  return {
    groups: new Map(
      [...mutableGroups].map(([baseCardCode, prints]) => [
        baseCardCode,
        {
          baseCardCode,
          prints: prints.sort((left, right) => left.card_code.localeCompare(right.card_code, 'en')),
        },
      ])
    ),
    exactPrintToBase,
  };
}

function buildAuditTargets(
  definitions: readonly ActivatedUiDefinition[],
  exactPrintToBase: ReadonlyMap<string, string>
): readonly AuditTarget[] {
  const targets: AuditTarget[] = [];
  for (const definition of definitions) {
    if (!definition.activatedUi) continue;
    for (const baseCardCode of definition.baseCardCodes ?? []) {
      targets.push({
        baseCardCode: normalizeCardCode(baseCardCode),
        definition,
      });
    }
    for (const rawCardCode of definition.cardCodes ?? []) {
      const cardCode = normalizeCardCode(rawCardCode);
      const baseCardCode = exactPrintToBase.get(cardCode);
      targets.push({
        baseCardCode: baseCardCode ?? cardCode,
        definition,
        ...(baseCardCode ? {} : { unresolvedExactCardCode: cardCode }),
      });
    }
  }
  return targets;
}

function cardDescriptor(group: ApiCardGroup | undefined): {
  readonly cardCodes: readonly string[];
  readonly cardName: string;
  readonly stat: string;
} {
  if (!group) {
    return { cardCodes: [], cardName: 'API未登记', stat: '费用/分数未登记' };
  }
  const representative = group.prints[0]!;
  const cardName = representative.name_cn?.trim() || representative.name_jp?.trim() || '未登记卡名';
  const stat =
    typeof representative.cost === 'number'
      ? `费用${representative.cost}`
      : typeof representative.score === 'number'
        ? `分数${representative.score}`
        : '费用/分数未登记';
  return {
    cardCodes: group.prints.map((card) => card.card_code),
    cardName,
    stat,
  };
}

function finding(
  target: AuditTarget,
  group: ApiCardGroup | undefined,
  classification: Classification,
  extras: Partial<Pick<AuditFinding, 'apiParagraph' | 'apiTextField' | 'detail'>> = {}
): AuditFinding {
  const descriptor = cardDescriptor(group);
  return {
    classification,
    baseCardCode: target.baseCardCode,
    ...descriptor,
    abilityId: target.definition.abilityId,
    effectText: target.definition.effectText,
    activatedUiText: target.definition.activatedUi!.text,
    activatedUiTitle: target.definition.activatedUi!.title,
    ...extras,
  };
}

function findKnownApiError(target: AuditTarget, group: ApiCardGroup): KnownApiError | undefined {
  const entry = KNOWN_API_ERRORS.find(
    (candidate) =>
      candidate.baseCardCode === target.baseCardCode &&
      candidate.abilityId === target.definition.abilityId
  );
  if (!entry) return undefined;

  for (const affectedPrint of entry.affectedPrints) {
    const card = group.prints.find(
      (candidate) => normalizeCardCode(candidate.card_code) === normalizeCardCode(affectedPrint)
    );
    if (!card) {
      throw new Error(`API错误例外已失效：${affectedPrint} 不在普通玩家 API 返回中。`);
    }
    const actualValue = normalizeText(card[entry.field]);
    if (actualValue !== normalizeText(entry.erroneousValue)) {
      throw new Error(
        `API错误例外已失效：${affectedPrint}.${entry.field} 当前值不再等于登记的错误值。`
      );
    }
  }
  return entry;
}

function auditTarget(
  target: AuditTarget,
  apiGroups: ReadonlyMap<string, ApiCardGroup>,
  sourceDirectReuseViolations: ReadonlySet<string>
): AuditFinding {
  const group = apiGroups.get(target.baseCardCode);
  if (!group || target.unresolvedExactCardCode) {
    return finding(target, group, 'API_MISSING', {
      detail: target.unresolvedExactCardCode
        ? `普通玩家 API 未返回 definition 的完整卡号 ${target.unresolvedExactCardCode}，无法确定基础编号。`
        : '普通玩家 API 未返回该基础编号。',
    });
  }

  const visibleTexts = group.prints.map((card) => ({
    card,
    visible: getVisibleCardText(card),
  }));
  const missingTextPrints = visibleTexts
    .filter((entry) => !entry.visible)
    .map((entry) => entry.card.card_code);
  if (missingTextPrints.length > 0) {
    return finding(target, group, 'API_MISSING', {
      detail: `以下罕度没有可用的 card_text_cn 或 card_text_jp：${missingTextPrints.join('、')}`,
    });
  }

  const knownApiError = findKnownApiError(target, group);
  if (knownApiError) {
    return finding(target, group, 'KNOWN_API_ERROR', {
      apiTextField: knownApiError.field,
      apiParagraph: knownApiError.correctValue,
      detail: `${knownApiError.reason}；正确依据：${knownApiError.evidence}`,
    });
  }

  const uniqueVisibleTexts = [...new Set(visibleTexts.map((entry) => entry.visible!.text))];
  if (uniqueVisibleTexts.length > 1) {
    return finding(target, group, 'RARITY_DRIFT', {
      detail: visibleTexts
        .map((entry) => `${entry.card.card_code}=${JSON.stringify(entry.visible!.text)}`)
        .join('；'),
    });
  }

  const visible = visibleTexts[0]!.visible!;
  const activatedParagraphs = splitAbilityParagraphs(visible.text).filter((paragraph) =>
    ACTIVATED_PARAGRAPH_PATTERN.test(paragraph)
  );
  const normalizedEffectText = normalizeText(target.definition.effectText)!;
  const exactParagraph = activatedParagraphs.find(
    (paragraph) => paragraph === normalizedEffectText
  );
  const apiParagraph =
    exactParagraph ?? (activatedParagraphs.length === 1 ? activatedParagraphs[0] : undefined);

  if (!apiParagraph) {
    return finding(target, group, 'AMBIGUOUS_SAME_TIMING_PARAGRAPHS', {
      apiTextField: visible.field,
      detail:
        activatedParagraphs.length === 0
          ? '玩家可见卡文中没有可识别的【起动】段落。'
          : `存在${activatedParagraphs.length}条【起动】段落，且 definition.effectText 未与其中任一段完全相等。`,
    });
  }

  const activatedUiText = normalizeText(target.definition.activatedUi!.text)!;
  if (
    activatedUiText !== normalizedEffectText ||
    sourceDirectReuseViolations.has(target.definition.abilityId)
  ) {
    return finding(target, group, 'BUTTON_DRIFT', {
      apiTextField: visible.field,
      apiParagraph,
      detail:
        activatedUiText === normalizedEffectText &&
        sourceDirectReuseViolations.has(target.definition.abilityId)
          ? 'activatedUi.text 与 effectText 的运行时值相同，但源码没有直接复用 effectText 常量。'
          : normalizedEffectText === apiParagraph
            ? 'definition.effectText 与玩家 API 一致，但 activatedUi.text 未直接复用 effectText。'
            : 'activatedUi.text 未直接复用 effectText，且 definition.effectText 也未与玩家 API 段落完全一致。',
    });
  }
  if (normalizedEffectText !== apiParagraph) {
    return finding(target, group, 'SHARED_SUMMARY', {
      apiTextField: visible.field,
      apiParagraph,
      detail:
        'definition.effectText 与 activatedUi.text 相同，但两者共同偏离普通玩家 API 的完整【起动】段落。',
    });
  }
  return finding(target, group, 'THREE_LAYER_CONSISTENT', {
    apiTextField: visible.field,
    apiParagraph,
  });
}

function buildReport(
  apiUrl: string,
  cards: readonly FrontendCardRecord[],
  definitions: readonly ActivatedUiDefinition[],
  sourceDirectReuseViolations: ReadonlySet<string>
): AuditReport {
  const { groups, exactPrintToBase } = groupApiCards(cards);
  const activatedUiDefinitions = definitions.filter((definition) => definition.activatedUi);
  const targets = buildAuditTargets(activatedUiDefinitions, exactPrintToBase);
  const findings = targets
    .map((target) => auditTarget(target, groups, sourceDirectReuseViolations))
    .sort(
      (left, right) =>
        left.baseCardCode.localeCompare(right.baseCardCode, 'en') ||
        left.abilityId.localeCompare(right.abilityId, 'en')
    );
  const classificationCounts = Object.fromEntries(
    CLASSIFICATIONS.map((classification) => [
      classification,
      findings.filter((finding) => finding.classification === classification).length,
    ])
  ) as Record<Classification, number>;
  return {
    apiUrl,
    scanned: {
      apiCards: cards.length,
      activatedUiDefinitions: activatedUiDefinitions.length,
      baseCards: new Set(targets.map((target) => target.baseCardCode)).size,
      abilityCardMappings: targets.length,
    },
    classificationCounts,
    actionableViolationCount:
      classificationCounts.SHARED_SUMMARY + classificationCounts.BUTTON_DRIFT,
    unresolvedCount:
      classificationCounts.API_MISSING +
      classificationCounts.RARITY_DRIFT +
      classificationCounts.AMBIGUOUS_SAME_TIMING_PARAGRAPHS,
    findings,
    knownApiErrors: KNOWN_API_ERRORS,
  };
}

function printHumanReport(report: AuditReport): void {
  console.log(`普通玩家卡牌 API：${report.apiUrl}`);
  console.log(
    `扫描：API卡牌${report.scanned.apiCards}张；activatedUi definition ${report.scanned.activatedUiDefinitions}条；基础编号${report.scanned.baseCards}张；卡牌-能力映射${report.scanned.abilityCardMappings}条。`
  );
  console.log('分类：');
  for (const classification of CLASSIFICATIONS) {
    console.log(`- ${classification}: ${report.classificationCounts[classification]}`);
  }
  console.log(
    `可确定违规：${report.actionableViolationCount}；API/映射未解决：${report.unresolvedCount}。`
  );

  for (const classification of CLASSIFICATIONS) {
    const matches = report.findings.filter((finding) => finding.classification === classification);
    if (matches.length === 0) continue;
    console.log('');
    console.log(`[${classification}]`);
    for (const match of matches) {
      console.log(`- ${match.baseCardCode} ${match.stat}「${match.cardName}」 ${match.abilityId}`);
      if (match.detail) console.log(`  ${match.detail}`);
      if (match.apiParagraph) console.log(`  API段落=${JSON.stringify(match.apiParagraph)}`);
      if (
        classification === 'SHARED_SUMMARY' ||
        classification === 'BUTTON_DRIFT' ||
        classification === 'AMBIGUOUS_SAME_TIMING_PARAGRAPHS'
      ) {
        console.log(`  effectText=${JSON.stringify(match.effectText)}`);
        console.log(`  activatedUi.text=${JSON.stringify(match.activatedUiText)}`);
      }
    }
  }
}

function readCliOptions(argv: readonly string[]): {
  readonly apiBaseUrl: string;
  readonly json: boolean;
} {
  let apiBaseUrl = process.env.LOVECA_CARD_API_BASE_URL ?? DEFAULT_FRONTEND_API_BASE_URL;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--json') {
      json = true;
      continue;
    }
    if (argument === '--api-base-url') {
      const value = argv[index + 1];
      if (!value) throw new Error('--api-base-url 缺少值。');
      apiBaseUrl = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--api-base-url=')) {
      apiBaseUrl = argument.slice('--api-base-url='.length);
      continue;
    }
    throw new Error(`未知参数：${argument}`);
  }
  return { apiBaseUrl: normalizeApiBaseUrl(apiBaseUrl), json };
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const options = readCliOptions(process.argv.slice(2));
  const apiUrl = `${options.apiBaseUrl}/api/cards`;
  const [cards, definitions] = await Promise.all([
    loadFrontendCards(apiUrl),
    loadDefinitions(repoRoot),
  ]);
  const sourceDirectReuseViolations = findSourceDirectReuseViolations(repoRoot, definitions);
  const report = buildReport(apiUrl, cards, definitions, sourceDirectReuseViolations);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }
}

await main();
