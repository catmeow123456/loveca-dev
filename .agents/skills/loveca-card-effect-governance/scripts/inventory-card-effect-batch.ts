import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  findRepoRoot,
  formatCardStat,
  hasCardAbilityText,
  listFilesRecursively,
  parseScopeArguments,
  selectCardGroups,
  uniqueStrings,
  type CardGroup,
} from './tooling.js';

function buildSourceIndex(repoRoot: string): Map<string, string> {
  const files = listFilesRecursively(
    repoRoot,
    [
      'src/application/card-effects',
      'src/application/effects',
      'src/domain/rules',
      'tests',
      'docs/card-effect-reuse-audit',
    ],
    ['.ts', '.md']
  );
  return new Map(files.map((file) => [file, readFileSync(join(repoRoot, file), 'utf8')]));
}

function getAbilityConstantNames(repoRoot: string, abilityIds: readonly string[]): string[] {
  const source = readFileSync(
    join(repoRoot, 'src/application/card-effects/ability-ids.ts'),
    'utf8'
  );
  return abilityIds.flatMap((abilityId) => {
    const escaped = abilityId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(
      new RegExp(`export const ([A-Z0-9_]+)\\s*=\\s*['\"]${escaped}['\"]`)
    );
    return match?.[1] ? [match[1]] : [];
  });
}

function findOwnershipFiles(
  repoRoot: string,
  group: CardGroup,
  sourceIndex: ReadonlyMap<string, string>
): string[] {
  const abilityIds = group.definitions.map((definition) => definition.abilityId);
  const needles = [
    group.baseCardCode,
    ...abilityIds,
    ...getAbilityConstantNames(repoRoot, abilityIds),
  ];
  return [...sourceIndex]
    .filter(([, source]) => needles.some((needle) => source.includes(needle)))
    .map(([file]) => file)
    .filter((file) => !file.endsWith('definitions/index.ts') && !file.endsWith('ability-ids.ts'))
    .sort();
}

function runnerRegistration(repoRoot: string, ownershipFiles: readonly string[]): string {
  const runner = readFileSync(join(repoRoot, 'src/application/card-effect-runner.ts'), 'utf8');
  const workflowFiles = ownershipFiles.filter((file) => file.includes('/workflows/'));
  return workflowFiles.some((file) => runner.includes(basename(file, '.ts')))
    ? '是'
    : '否/无需注册';
}

function printMarkdown(
  repoRoot: string,
  groups: readonly CardGroup[],
  sourceIndex: ReadonlyMap<string, string>
): void {
  for (const group of groups) {
    const card = group.representative;
    const ownershipFiles = findOwnershipFiles(repoRoot, group, sourceIndex);
    const implementedDefinitions = group.definitions.filter((definition) => definition.implemented);
    console.log(`## ${group.baseCardCode} ${formatCardStat(card)}「${card.name ?? '未登记卡名'}」`);
    console.log(`- 印刷：${group.prints.map((print) => print.card_no).join('、')}`);
    console.log(
      `- 卡种：${card.type ?? '未登记'}；原始卡文：${hasCardAbilityText(card) ? '有' : '无'}`
    );
    console.log(
      `- Definition：${implementedDefinitions.length}/${group.definitions.length} implemented；Runner 注册：${runnerRegistration(repoRoot, ownershipFiles)}`
    );
    for (const definition of group.definitions) {
      console.log(
        `  - ${definition.abilityId} | ${definition.category ?? '-'} | ${definition.sourceZone ?? '-'} | ${definition.triggerCondition ?? '-'} | queued=${String(definition.queued)} | implemented=${String(definition.implemented)}`
      );
      if (definition.effectText) console.log(`    - effectText：${definition.effectText}`);
    }
    if (group.definitions.length === 0) console.log('  - 无 definition');
    console.log(`- ownership：${ownershipFiles.length ? ownershipFiles.join('、') : '未找到'}`);
    console.log(
      `- existing_module_map：${sourceIndex.get('docs/card-effect-reuse-audit/existing_module_map.md')?.includes(group.baseCardCode) ? '已登记' : '未登记'}`
    );
    if (hasCardAbilityText(card)) {
      console.log('- 日文原文：');
      for (const line of String(card.ability).split('\n')) console.log(`  ${line}`);
    }
    console.log('');
  }
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const { scopes, flags } = parseScopeArguments(process.argv.slice(2));
  let groups = await selectCardGroups(repoRoot, scopes);
  if (flags.has('--ability-only')) {
    groups = groups.filter(
      (group) => hasCardAbilityText(group.representative) || group.definitions.length > 0
    );
  }
  if (flags.has('--unimplemented-only')) {
    groups = groups.filter(
      (group) =>
        hasCardAbilityText(group.representative) &&
        !group.definitions.some((definition) => definition.implemented)
    );
  }
  const sourceIndex = buildSourceIndex(repoRoot);
  if (flags.has('--json')) {
    console.log(
      JSON.stringify(
        groups.map((group) => ({
          baseCardCode: group.baseCardCode,
          name: group.representative.name,
          type: group.representative.type,
          cost: group.representative.cost,
          score: group.representative.score,
          ability: group.representative.ability,
          prints: group.prints.map((card) => ({
            cardNo: card.card_no,
            rare: card.rare,
          })),
          definitions: group.definitions,
          effectTexts: uniqueStrings(group.definitions.map((definition) => definition.effectText)),
          ownershipFiles: findOwnershipFiles(repoRoot, group, sourceIndex),
          existingModuleMap: sourceIndex
            .get('docs/card-effect-reuse-audit/existing_module_map.md')
            ?.includes(group.baseCardCode),
        })),
        null,
        2
      )
    );
    return;
  }
  printMarkdown(repoRoot, groups, sourceIndex);
  console.error(`共盘点 ${groups.length} 个基础编号。`);
}

await main();
