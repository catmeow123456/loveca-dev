import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CardGroup,
  findRepoRoot,
  formatCardStat,
  parseScopeArguments,
  selectCardGroups,
} from './tooling.js';

interface FrontendCardRecord {
  readonly detail?: {
    readonly ability?: string;
  };
}

type FrontendCardDatabase = Readonly<Record<string, FrontendCardRecord>>;

interface CommitMessageEntry {
  readonly effectText: string;
  readonly groups: readonly CardGroup[];
}

function normalizeFrontendCardText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\r\n?/g, '\n').trim();
  if (!normalized || /^[-ー－—]+$/.test(normalized)) return undefined;
  return normalized;
}

function loadFrontendCards(repoRoot: string): FrontendCardDatabase {
  return JSON.parse(
    readFileSync(join(repoRoot, 'llocg_db/json/cards_cn.json'), 'utf8')
  ) as FrontendCardDatabase;
}

function getFrontendCardText(
  group: CardGroup,
  frontendCards: FrontendCardDatabase
): string {
  const textsByPrint = group.prints
    .map((card) => ({
      cardCode: card.card_no,
      text: normalizeFrontendCardText(frontendCards[card.card_no]?.detail?.ability),
    }))
    .filter(
      (entry): entry is { readonly cardCode: string; readonly text: string } =>
        Boolean(entry.text)
    );
  const uniqueTexts = [...new Set(textsByPrint.map((entry) => entry.text))];

  if (uniqueTexts.length === 0) {
    throw new Error(
      `${group.baseCardCode} 在 llocg_db/json/cards_cn.json 中没有可用的前端中文 detail.ability。`
    );
  }
  if (uniqueTexts.length > 1) {
    const details = textsByPrint
      .map((entry) => `${entry.cardCode}=${JSON.stringify(entry.text)}`)
      .join('；');
    throw new Error(
      `${group.baseCardCode} 的不同罕度在 cards_cn.json 中存在不同卡文，拒绝自动合并：${details}`
    );
  }
  return uniqueTexts[0]!;
}

function mergeGroupsByFrontendCardText(
  groups: readonly CardGroup[],
  frontendCards: FrontendCardDatabase
): readonly CommitMessageEntry[] {
  const entries = new Map<string, CardGroup[]>();
  for (const group of groups) {
    const effectText = getFrontendCardText(group, frontendCards);
    const matchingGroups = entries.get(effectText) ?? [];
    matchingGroups.push(group);
    entries.set(effectText, matchingGroups);
  }
  return [...entries].map(([effectText, matchingGroups]) => ({
    effectText,
    groups: matchingGroups,
  }));
}

function formatCardDescriptor(group: CardGroup): string {
  const card = group.representative;
  return `${group.baseCardCode} ${formatCardStat(card)}「${card.name ?? '未登记卡名'}」`;
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const { scopes, values } = parseScopeArguments(process.argv.slice(2));
  const groups = await selectCardGroups(repoRoot, scopes);
  const frontendCards = loadFrontendCards(repoRoot);
  const entries = mergeGroupsByFrontendCardText(groups, frontendCards);
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
