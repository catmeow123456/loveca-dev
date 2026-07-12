import {
  findRepoRoot,
  formatCardStat,
  parseScopeArguments,
  selectCardGroups,
  uniqueStrings,
} from './tooling.js';

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const { scopes, values } = parseScopeArguments(process.argv.slice(2));
  const groups = await selectCardGroups(repoRoot, scopes);
  const title =
    values.get('--title') ?? `feat(effect): 更新${scopes.length === 1 ? scopes[0] : '本批'}卡效`;

  console.log(title);
  console.log('');
  console.log('新增卡效:');
  for (const group of groups) {
    const card = group.representative;
    const effectTexts = uniqueStrings(
      group.definitions
        .filter((definition) => definition.implemented)
        .map((definition) => definition.effectText)
    );
    console.log(
      `- ${group.baseCardCode} ${formatCardStat(card)}「${card.name ?? '未登记卡名'}」：${effectTexts.length ? effectTexts.join(' / ') : '【待补充前端 effectText】'}`
    );
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
