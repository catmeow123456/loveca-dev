import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, imageCount = 1, slowFirstCheck = false) {
  const writes: Record<string, unknown>[] = [];
  const checks: Record<string, unknown>[] = [];
  const preview = {
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    summary: {
      sourceCount: 202,
      existingCount: 0,
      candidateCount: 1,
      blockedCount: imageCount + 1,
      warningCount: 0,
    },
    candidates: [
      {
        cardCode: 'PL!HS-ad2-001-AD',
        name: '可直接导入的测试成员',
        cardType: 'MEMBER',
        warnings: [],
      },
    ],
    blocked: [
      {
        sourceKey: 'row:5',
        cardCode: 'FUTURE-ad2-001-NEW',
        suggestedCardCode: 'FUTURE-ad2-001-NEW',
        name: '需要确认的完整测试卡名',
        cardType: 'MEMBER',
        reasons: ['商品代号或稀有度尚未登记'],
        imageIssue: false,
      },
      ...Array.from({ length: imageCount }, (_, i) => ({
        sourceKey: `row:${i + 6}`,
        cardCode: `IMAGE-${i + 1}`,
        suggestedCardCode: `IMAGE-${i + 1}`,
        name: `待检查卡图 ${i + 1}`,
        cardType: 'LIVE',
        reasons: ['卡图缺失或暂时不可用，可强制导入无图草稿'],
        imageIssue: true,
      })),
    ],
  };
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname))
      return route.abort();
    return route.continue();
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown;
    if (path.endsWith('/card-sync/status'))
      data = { configuration: 'READY', activeRun: null, latestRun: null };
    else if (path.endsWith('/card-sync/previews')) {
      checks.push(route.request().postDataJSON());
      data = { id: preview.id, status: 'RUNNING', progress: { checked: 4, total: imageCount + 1 } };
    } else if (path.includes('/card-sync/previews/'))
      data =
        slowFirstCheck && checks.length === 1
          ? { id: preview.id, status: 'RUNNING', progress: { checked: 4, total: 200 } }
          : { ...preview, imageCheck: checks.at(-1)?.imageCheck };
    else if (path.endsWith('/card-sync/runs') && route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON());
      data = {
        id: '22222222-2222-4222-8222-222222222222',
        previewId: preview.id,
        status: 'SUCCEEDED',
        createdAt: new Date().toISOString(),
        summary: { totalCount: 2, succeededCount: 2, failedCount: 0, pendingCount: 0 },
        items: [
          {
            cardCode: 'MY-CARD',
            name: '人工确认名称',
            status: 'SUCCEEDED',
            message: '已按确认导入无图草稿',
          },
        ],
      };
    } else {
      await route.abort();
      throw new Error(`Unexpected API request: ${path}`);
    }
    await route.fulfill({ json: { data, error: null } });
  });
  await page.goto('/tests/card-sync-review/index.html');
  await page.getByRole('button', { name: '检查新卡', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('卡图检查 4');
  if (!slowFirstCheck)
    await expect(page.getByRole('heading', { name: '检查结果', exact: true })).toBeVisible();
  return { writes, checks };
}

test('error cards retain their identity, allow editing and import only after explicit confirmation', async ({
  page,
}, info) => {
  const { writes, checks } = await fixture(page);
  expect(checks[0].imageCheck).toBe('LINK');
  await expect(page.getByText('需要确认的完整测试卡名', { exact: true })).toBeVisible();
  await expect(page.getByText('FUTURE-ad2-001-NEW', { exact: true })).toBeVisible();
  await expect(page.getByText('待检查卡图 1', { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '强制导入 FUTURE-ad2-001-NEW', exact: true }).check();
  await page.getByLabel('导入编号', { exact: true }).fill('MY-CARD');
  await page.getByLabel('导入名称', { exact: true }).fill('人工确认名称');
  await page.getByLabel('导入类型', { exact: true }).selectOption('LIVE');
  await page.screenshot({ path: info.outputPath('review-selection.png'), fullPage: true });
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: '同步所选 2 张新卡为草稿', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('忽略所选卡牌的数据检查错误');
  await expect(dialog).toContainText('卡图失败仍保存无图草稿');
  await page.screenshot({ path: info.outputPath('force-confirmation.png'), fullPage: true });
  await dialog.getByRole('button', { name: '继续检查' }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: '同步所选 2 张新卡为草稿', exact: true }).click();
  await dialog.getByRole('button', { name: '确认强制导入 2 张新卡为草稿' }).click();
  await expect(page.getByText('已按确认导入无图草稿', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    forceImport: true,
    cardCodes: ['PL!HS-ad2-001-AD'],
    forceImports: [
      { sourceKey: 'row:5', cardCode: 'MY-CARD', name: '人工确认名称', cardType: 'LIVE' },
    ],
  });
});

test('200 image issues stay unselected, remain accessible and full image checking is optional', async ({
  page,
}, info) => {
  const { checks, writes } = await fixture(page, 200);
  await expect(page.getByRole('button', { name: '同步所选 1 张新卡为草稿' })).toBeEnabled();
  await page.getByRole('checkbox', { name: /隐藏卡图异常/ }).uncheck();
  await page.getByRole('checkbox', { name: '强制导入 IMAGE-1', exact: true }).check();
  await expect(page.getByRole('button', { name: '同步所选 2 张新卡为草稿' })).toBeEnabled();
  expect(writes).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('image-review-list.png'), fullPage: true });
  await page.getByRole('combobox', { name: '卡图检查方式' }).selectOption('DECODE');
  await page.getByRole('button', { name: '检查新卡', exact: true }).click();
  await expect.poll(() => checks.length).toBe(2);
  expect(checks[1].imageCheck).toBe('DECODE');
  await expect(page.getByRole('status')).toContainText('卡图检查');
  await expect(page.getByRole('button', { name: '同步所选 1 张新卡为草稿' })).toBeEnabled();
});

test('a slow light check can stop waiting and fall back to no image checking', async ({
  page,
}, info) => {
  const { checks, writes } = await fixture(page, 200, true);
  await page.getByRole('button', { name: '停止等待' }).click();
  await page.getByRole('combobox', { name: '卡图检查方式' }).selectOption('NONE');
  await page.getByRole('button', { name: '检查新卡', exact: true }).click();
  await expect(page.getByRole('heading', { name: '检查结果', exact: true })).toBeVisible();
  await expect(page.getByText(/本次未检查卡图/)).toBeVisible();
  expect(checks.map((request) => request.imageCheck)).toEqual(['LINK', 'NONE']);
  expect(writes).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('no-image-check.png'), fullPage: true });
});
