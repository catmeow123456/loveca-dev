import { findRepoRoot, parseScopeArguments } from './tooling.js';

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

interface FrontendCardGroup {
  readonly baseCardCode: string;
  readonly prints: readonly FrontendCardRecord[];
  readonly representative: FrontendCardRecord;
}

interface CommitMessageEntry {
  readonly effectText: string;
  readonly groups: readonly FrontendCardGroup[];
}

const DEFAULT_FRONTEND_API_BASE_URL = 'https://loveca.lovelivefun.xyz';

function normalizeFrontendCardText(value: string | null | undefined): string | undefined {
  const normalized = value?.replace(/\r\n?/g, '\n').trim();
  if (!normalized || /^[-ー－—]+$/.test(normalized)) return undefined;
  return normalized;
}

function normalizeApiBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized) {
    throw new Error('前端卡牌 API 地址不能为空。');
  }
  return normalized;
}

function normalizeCardCode(value: string): string {
  return value.replaceAll('＋', '+');
}

function getBaseCardCode(card: FrontendCardRecord): string {
  const suffix = card.rare ? `-${card.rare}` : '';
  return suffix && card.card_code.endsWith(suffix)
    ? card.card_code.slice(0, -suffix.length)
    : card.card_code.replace(/-[^-]+$/, '');
}

async function loadFrontendCards(apiBaseUrl: string): Promise<readonly FrontendCardRecord[]> {
  const url = `${apiBaseUrl}/api/cards`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    throw new Error(
      `读取前端卡牌 API 失败：${url}；${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!response.ok) {
    throw new Error(`读取前端卡牌 API 失败：${url} 返回 HTTP ${response.status}。`);
  }
  const payload = (await response.json()) as FrontendCardsResponse;
  if (!payload.data) {
    throw new Error(
      `前端卡牌 API 没有返回卡牌数据${payload.error?.message ? `：${payload.error.message}` : '。'}`
    );
  }
  return payload.data;
}

function selectFrontendCardGroups(
  cards: readonly FrontendCardRecord[],
  scopes: readonly string[]
): readonly FrontendCardGroup[] {
  if (scopes.length === 0) {
    throw new Error('请至少提供一个基础编号、完整卡号或卡号前缀。');
  }

  const groups = new Map<string, FrontendCardRecord[]>();
  const exactPrintToBase = new Map<string, string>();
  for (const card of cards) {
    const baseCardCode = getBaseCardCode(card);
    const prints = groups.get(baseCardCode) ?? [];
    prints.push(card);
    groups.set(baseCardCode, prints);
    exactPrintToBase.set(card.card_code, baseCardCode);
  }

  const selectedBases = new Set<string>();
  for (const rawScope of scopes) {
    const scope = normalizeCardCode(rawScope);
    const exactBase = groups.has(scope) ? scope : exactPrintToBase.get(scope);
    if (exactBase) {
      selectedBases.add(exactBase);
      continue;
    }

    const matchingBases = [...groups.keys()].filter((baseCardCode) =>
      baseCardCode.startsWith(scope)
    );
    if (matchingBases.length === 0) {
      throw new Error(`${rawScope} 在当前前端卡牌 API 中没有匹配卡牌。`);
    }
    for (const baseCardCode of matchingBases) {
      selectedBases.add(baseCardCode);
    }
  }

  return [...selectedBases]
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((baseCardCode) => {
      const prints = (groups.get(baseCardCode) ?? []).sort((left, right) =>
        left.card_code.localeCompare(right.card_code, 'en')
      );
      return {
        baseCardCode,
        prints,
        representative: prints[0]!,
      };
    });
}

function getFrontendCardText(group: FrontendCardGroup): string {
  const textsByPrint = group.prints
    .map((card) => ({
      cardCode: card.card_code,
      text:
        normalizeFrontendCardText(card.card_text_cn) ??
        normalizeFrontendCardText(card.card_text_jp),
    }))
    .filter((entry): entry is { readonly cardCode: string; readonly text: string } =>
      Boolean(entry.text)
    );
  const uniqueTexts = [...new Set(textsByPrint.map((entry) => entry.text))];

  if (uniqueTexts.length === 0) {
    throw new Error(
      `${group.baseCardCode} 在前端卡牌 API 中没有可用的 card_text_cn 或 card_text_jp。`
    );
  }
  if (uniqueTexts.length > 1) {
    const details = textsByPrint
      .map((entry) => `${entry.cardCode}=${JSON.stringify(entry.text)}`)
      .join('；');
    throw new Error(
      `${group.baseCardCode} 的不同罕度在前端卡牌 API 中存在不同展示卡文，拒绝自动合并：${details}`
    );
  }
  return uniqueTexts[0]!;
}

function mergeGroupsByFrontendCardText(
  groups: readonly FrontendCardGroup[]
): readonly CommitMessageEntry[] {
  const entries = new Map<string, FrontendCardGroup[]>();
  for (const group of groups) {
    const effectText = getFrontendCardText(group);
    const matchingGroups = entries.get(effectText) ?? [];
    matchingGroups.push(group);
    entries.set(effectText, matchingGroups);
  }
  return [...entries].map(([effectText, matchingGroups]) => ({
    effectText,
    groups: matchingGroups,
  }));
}

function formatCardStat(card: FrontendCardRecord): string {
  if (typeof card.cost === 'number') return `费用${card.cost}`;
  if (typeof card.score === 'number') return `分数${card.score}`;
  return '费用/分数未登记';
}

function formatCardDescriptor(group: FrontendCardGroup): string {
  const card = group.representative;
  const name = card.name_cn?.trim() || card.name_jp?.trim() || '未登记卡名';
  return `${group.baseCardCode} ${formatCardStat(card)}「${name}」`;
}

async function main(): Promise<void> {
  findRepoRoot();
  const { scopes, values } = parseScopeArguments(process.argv.slice(2));
  const apiBaseUrl = normalizeApiBaseUrl(
    values.get('--api-base-url') ??
      process.env.LOVECA_CARD_API_BASE_URL ??
      DEFAULT_FRONTEND_API_BASE_URL
  );
  const frontendCards = await loadFrontendCards(apiBaseUrl);
  const groups = selectFrontendCardGroups(frontendCards, scopes);
  const entries = mergeGroupsByFrontendCardText(groups);
  const title =
    values.get('--title') ?? `feat(effect): 更新${scopes.length === 1 ? scopes[0] : '本批'}卡效`;

  console.log(title);
  console.log('');
  console.log('新增卡效:');
  for (const entry of entries) {
    console.log(`- ${entry.groups.map(formatCardDescriptor).join('、')}：${entry.effectText}`);
  }
  console.log('');
  console.log('修复bug:');
  console.log('- 【按实际 diff 补充；没有则删除本节】');
  console.log('');
  console.log('通用更新:');
  console.log('- 【按 shared helper/workflow/query/runtime 的实际 diff 补充；没有则删除本节】');
  console.log('');
  console.log('验证:');
  console.log('- focused vitest：【补充 files / tests】');
  console.log('- tsc --noEmit');
  console.log('- git diff --check');
}

await main();
