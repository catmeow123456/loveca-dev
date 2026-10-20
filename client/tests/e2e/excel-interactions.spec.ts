import { test, expect, type Page } from '@playwright/test';
async function prepare(page: Page, kind?: string) {
  await page.goto('/tests/excel-review/index.html');
  await expect(page.getByTestId('excel-battle')).toBeVisible();
  if (kind) await page.evaluate((kind) => (window as any).excelReview.selection(kind), kind);
}
const panel = (page: Page) => page.locator('.excel-operation-panels');
const submissions = (page: Page) => page.evaluate(() => (window as any).excelReview.submissions);
test('stage separates effective attributes and complete text, with no visible instance IDs in sheets', async ({
  page,
}, info) => {
  await prepare(page);
  const fixture = await page.evaluate(() => (window as any).excelReview.stageDetails());
  const stage = page.getByRole('table', { name: '我方场面', exact: true });
  const center = stage.locator('.excel-stage-cell').nth(1);
  const attributes = center.locator('.excel-stage-attributes > div');
  await expect(attributes).toHaveCount(3);
  await expect(attributes.nth(0)).toContainText('费用6（印刷 4）');
  await expect(attributes.nth(1)).toContainText('光棒3');
  await expect(attributes.nth(2)).toContainText('心黄 2');
  await expect(center.locator('.excel-stage-effect')).toContainText('完整卡文最后一句。');
  const state = center.locator('.excel-stage-heading');
  await expect(state).toContainText('活跃');
  await expect(state).toContainText('下置能量 0');
  await expect(state).toContainText('下置成员 0');
  await expect(page.getByRole('table', { name: '对方场面' })).toContainText('未知成员');
  await expect(page.locator('body')).not.toContainText('未公开成员');
  await expect(page.locator('body')).not.toContainText('未公开效果');
  await center.getByRole('button', { name: '中须霞', exact: true }).click();
  await expect(page.locator('.excel-formula')).toContainText('我方 · 中');
  const sheets = page.getByRole('navigation', { name: '工作表', exact: true });
  for (const sheet of ['详情', '休息室', '其他区域', '公开记录', '对局']) {
    await sheets.getByRole('button', { name: sheet, exact: true }).click();
    await expect(page.locator('body')).not.toContainText(fixture.prefix);
    expect(await page.locator('body').ariaSnapshot()).not.toContain(fixture.prefix);
  }
  const cellBounds = await center.boundingBox();
  const effectBounds = await center.locator('.excel-stage-effect').boundingBox();
  // Full stage text remains available in its own bounded cell.
  expect(effectBounds!.width).toBeLessThanOrEqual(cellBounds!.width);
  if (page.viewportSize()!.width < 1100) await stage.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('stage-initial.png'), fullPage: true });
  await center.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const sticky = await state.boundingBox();
  const scrolledCell = await center.boundingBox();
  expect(sticky!.y).toBeGreaterThanOrEqual(scrolledCell!.y);
  expect(sticky!.y + sticky!.height).toBeLessThanOrEqual(scrolledCell!.y + scrolledCell!.height);
  await expect(state).toBeInViewport();
  await page.screenshot({ path: info.outputPath('stage-full-text.png'), fullPage: true });
  if (page.viewportSize()!.width >= 1100) {
    const hand = await page.locator('.excel-hand').boundingBox();
    const tabs = await sheets.boundingBox();
    expect(hand!.height).toBeGreaterThanOrEqual(80);
    expect(tabs!.y + tabs!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  }
});
test('waiting-room lists and details omit orientation while stage and energy retain it', async ({
  page,
}, info) => {
  await prepare(page);
  await page.evaluate(() => (window as any).excelReview.recovery(true));
  const sheets = page.getByRole('navigation', { name: '工作表', exact: true });
  await expect(page.getByRole('table', { name: '我方场面', exact: true })).toContainText('活跃');
  await sheets.getByRole('button', { name: '休息室', exact: true }).click();
  const waiting = page.getByRole('table', { name: '我方休息室', exact: true });
  await expect(waiting.getByRole('columnheader').last()).toHaveText('费用 / 分数');
  const detail = page.getByRole('region', { name: '选中卡牌', exact: true });
  for (const row of await waiting.locator('tbody tr').all()) {
    await expect(row).not.toContainText('活跃');
    await row.getByRole('button').click();
    await expect(
      detail.locator(':scope > p').filter({ hasText: /^(活跃|待机|本回合登场|下次不活跃)/ })
    ).toHaveCount(0);
    await expect(sheets.getByRole('button', { name: '休息室', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    );
  }
  await waiting.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('waiting-room.png'), fullPage: true });
  await sheets.getByRole('button', { name: '详情', exact: true }).click();
  await expect(
    page
      .locator('.excel-full-details > p')
      .filter({ hasText: /^(活跃|待机|本回合登场|下次不活跃)/ })
  ).toHaveCount(0);
  await sheets.getByRole('button', { name: '其他区域', exact: true }).click();
  const energy = page.getByRole('table', { name: '我方能量区', exact: true });
  await expect(energy.getByRole('columnheader').last()).toHaveText('状态');
  await expect(energy.locator('tbody tr').first().getByRole('cell').last()).toContainText('活跃');
  await energy.getByRole('button').first().click();
  await expect(detail.getByText('活跃', { exact: true })).toBeVisible();
});
test('zone tables use compact rows and pin complete text without leaving their sheet or exposing hidden cards', async ({
  page,
}, info) => {
  await prepare(page);
  const fixture = await page.evaluate(() => (window as any).excelReview.compactZones());
  await panel(page).locator('.excel-candidate-choose').first().click();
  const sheets = page.getByRole('navigation', { name: '工作表', exact: true });
  await sheets.getByRole('button', { name: '休息室', exact: true }).click();
  const waiting = page.getByRole('table', { name: '我方休息室', exact: true });
  await expect(waiting.getByRole('columnheader')).toHaveText([
    '序号',
    '卡号',
    '名称',
    '卡牌效果',
    '类型',
    '费用 / 分数',
  ]);
  await expect(waiting.locator('caption')).toContainText('17 张（1 张未公开）');
  const rows = waiting.locator('tbody tr');
  await expect(rows).toHaveCount(16);
  const layout = await waiting.evaluate((element) => {
    const effect = element.querySelector('.excel-card-effect')! as HTMLElement;
    return {
      heights: Array.from(element.querySelectorAll('tbody tr')).map(
        (row) => row.getBoundingClientRect().height
      ),
      nowrap: getComputedStyle(effect).whiteSpace,
      overflow: getComputedStyle(effect).textOverflow,
      clipped: effect.scrollWidth > effect.clientWidth,
    };
  });
  expect(layout.heights.every((height) => height <= 31)).toBe(true);
  expect(layout).toMatchObject({ nowrap: 'nowrap', overflow: 'ellipsis', clipped: true });
  // Selecting a duplicate by its row retains the exact instance without showing its ID.
  await rows.nth(2).getByRole('cell').nth(2).click();
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() => page.evaluate(() => (window as any).excelReview.store().ui.selectedCardId))
    .toBe(fixture.waitingIds[2].replace(/^obj_/, ''));
  const detail = page.getByRole('region', { name: '选中卡牌', exact: true });
  await expect(detail).toContainText('完整卡文最后一句。');
  await expect(sheets.getByRole('button', { name: '休息室', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  );
  await rows.nth(1).getByRole('button').focus();
  await page.keyboard.press('Enter');
  await expect(detail).toContainText('手札を1枚控え室に置く。');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
  await waiting.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('compact-waiting-room.png'), fullPage: true });
  await sheets.getByRole('button', { name: '其他区域', exact: true }).click();
  for (const zone of [
    '下置卡牌',
    '能量区',
    '能量卡组',
    '主卡组',
    '成功区',
    '除外区',
    '检视区',
    '解决区',
  ]) {
    const table = page.getByRole('table', { name: `我方${zone}`, exact: true });
    const headers = table.getByRole('columnheader');
    await expect(headers).toHaveCount(zone === '能量区' ? 7 : 6);
    if (zone !== '能量区') await expect(table.locator('caption')).toContainText('1 张未公开');
    await table.locator('tbody tr').first().getByRole('button').click();
    await expect(sheets.getByRole('button', { name: '其他区域', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await expect(detail.getByRole('heading', { name: '完整卡效', exact: true })).toBeVisible();
  }
  await page.getByRole('table', { name: '我方解决区', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('compact-other-zones.png'), fullPage: true });
  await expect(page.locator('body')).not.toContainText(fixture.prefix);
  await expect(page.locator('body')).not.toContainText('未公开区域');
  expect(await page.locator('body').ariaSnapshot()).not.toContain('未公开区域');
  await expect(page.getByRole('list', { name: '已选顺序' }).getByRole('listitem')).toHaveCount(1);
  expect(await submissions(page)).toEqual([]);
});
test('candidate table previews eight compact rows, inspects without submitting and keeps exact identities', async ({
  page,
}, info) => {
  await prepare(page);
  const fixture = await page.evaluate(() => (window as any).excelReview.candidateTable());
  const table = page.getByRole('table', { name: '效果候选卡牌', exact: true });
  await expect(table.getByRole('columnheader')).toHaveText([
    '选择',
    '卡号',
    '名称',
    '类型',
    '费用/分数',
    '卡牌效果',
    '查看',
  ]);
  const rows = table.locator('tbody tr');
  const choices = table.locator('.excel-candidate-choose');
  await expect(rows).toHaveCount(8);
  await expect(rows.nth(0)).toContainText('PL!N-bp5-014-N');
  await expect(rows.nth(0)).toContainText('成员');
  await expect(rows.nth(0)).toContainText('费 4');
  await expect(rows.nth(6)).toContainText('LIVE');
  await expect(rows.nth(6)).toContainText('分 4');
  await expect(rows.nth(1)).toContainText('日文候选');
  await expect(rows.nth(1)).toContainText('手札を1枚控え室に置く。');
  const geometry = await table.evaluate((element) => {
    const cell = element.querySelector('.excel-candidate-effect')! as HTMLElement;
    const scroller = element.parentElement!;
    return {
      rowHeights: Array.from(element.querySelectorAll('tbody tr')).map(
        (row) => row.getBoundingClientRect().height
      ),
      nowrap: getComputedStyle(cell).whiteSpace,
      ellipsis: getComputedStyle(cell).textOverflow,
      clipped: cell.scrollWidth > cell.clientWidth,
      width: element.getBoundingClientRect().width,
      available: scroller.clientWidth,
      height: scroller.clientHeight,
    };
  });
  expect(geometry.rowHeights.every((height) => height <= 31)).toBe(true);
  expect(geometry).toMatchObject({ nowrap: 'nowrap', ellipsis: 'ellipsis', clipped: true });
  expect(geometry.height).toBeGreaterThanOrEqual(270);
  if (page.viewportSize()!.width >= 1100)
    expect(geometry.width).toBeLessThanOrEqual(geometry.available + 1);
  await table.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('candidate-table.png'), fullPage: true });
  // Inspection is a separate action even for single-click submission windows.
  await rows.first().getByRole('button', { name: /^查看/ }).click();
  const details = page.getByRole('region', { name: '候选卡牌完整信息' });
  await expect(details).toContainText('完整卡文最后一句。');
  expect(await submissions(page)).toEqual([]);
  await expect(
    page
      .getByRole('navigation', { name: '工作表', exact: true })
      .getByRole('button', { name: '对局', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  await details.getByRole('button', { name: '收起卡文' }).click();
  await choices.nth(0).focus();
  await page.keyboard.press('Enter');
  await choices.nth(1).click();
  await choices.nth(2).click();
  await expect(page.getByRole('list', { name: '已选顺序' }).getByRole('listitem')).toHaveCount(2);
  await expect(rows.nth(2)).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('body')).not.toContainText(fixture.prefix);
  expect(await page.locator('body').ariaSnapshot()).not.toContain(fixture.prefix);
  await page.getByRole('button', { name: '确认选择', exact: true }).click();
  await expect
    .poll(() => submissions(page))
    .toEqual([
      [
        'fixture-effect',
        undefined,
        undefined,
        undefined,
        undefined,
        [fixture.first, fixture.second],
      ],
    ]);
});
test('compact hand selects duplicates by row and shows complete details without leaving the sheet', async ({
  page,
}, info) => {
  await prepare(page);
  await page.evaluate(() => (window as any).excelReview.handDetails());
  const hand = page.getByRole('table', { name: '我方手牌', exact: true });
  await expect(hand.getByRole('columnheader')).toHaveText([
    '序号',
    '卡号',
    '名称',
    '卡牌效果',
    '类型',
    '费用 / 分数',
  ]);
  const first = hand.locator('tbody tr').nth(0);
  await expect(first.getByRole('cell').nth(3)).toHaveText('成员');
  await expect(first.getByRole('cell').nth(4)).toHaveText('费 4');
  const preview = first.locator('.excel-card-effect');
  await expect(preview).toContainText('将1张手牌');
  await expect(preview).toHaveCSS('white-space', 'nowrap');
  await expect(preview).toHaveCSS('text-overflow', 'ellipsis');
  const nameWidth = (await first.getByRole('cell').nth(1).boundingBox())!.width;
  const effectWidth = (await preview.boundingBox())!.width;
  expect(nameWidth / (nameWidth + effectWidth)).toBeCloseTo(0.25, 2);
  await expect(hand).not.toContainText('#hand-');
  await expect(hand.locator('img')).toHaveCount(0);
  await page.evaluate(() => (window as any).excelReview.store().setHoveredCard('hand-0'));
  await expect(page.getByRole('dialog', { name: '卡牌详情', exact: true })).toBeVisible();
  await first.getByRole('cell').first().click();
  await expect(page.getByRole('dialog', { name: '卡牌详情', exact: true })).toHaveCount(0);
  const details = page.getByRole('region', { name: '选中卡牌', exact: true });
  await expect(details).toContainText('印刷费用 4；光棒 2；心 黄 1');
  await expect(details).toContainText(
    '将1张手牌放置入休息室：从自己的休息室将1张『虹咲』的LIVE卡加入手牌。'
  );
  await expect(details).not.toContainText('手札を1枚控え室に置く。');
  const second = hand.locator('tbody tr').nth(1);
  await second.getByRole('button', { name: '中须霞', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(first).toHaveAttribute('aria-selected', 'false');
  await expect
    .poll(() => page.evaluate(() => (window as any).excelReview.store().ui.selectedCardId))
    .toBe('hand-1');
  await expect(page.locator('.excel-formula')).toContainText('手牌 2');
  await expect(details).toContainText('手札を1枚控え室に置く。');
  await expect(
    page
      .getByRole('navigation', { name: '工作表', exact: true })
      .getByRole('button', { name: '对局', exact: true })
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('dialog', { name: '卡牌详情', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('hand-selection.png'), fullPage: true });
  if (page.viewportSize()!.width < 1100) {
    const value = second.getByRole('cell').last();
    await value.scrollIntoViewIfNeeded();
    const bounds = (await value.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await details.scrollIntoViewIfNeeded();
    const effect = details.locator('.excel-selected-effect');
    await effect.scrollIntoViewIfNeeded();
    const effectBounds = (await effect.boundingBox())!;
    expect(effectBounds.y).toBeGreaterThanOrEqual(0);
    expect(effectBounds.y + effectBounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.screenshot({ path: info.outputPath('hand-details-mobile.png'), fullPage: true });
  }
});
test('hand overview reserves desktop rows, expands in place and keeps pending effect choices intact', async ({
  page,
}, info) => {
  await page.goto('/tests/excel-review/index.html?frame=1');
  await expect(page.getByTestId('excel-battle')).toBeVisible();
  const fixture = await page.evaluate(() => (window as any).excelReview.compactHand());
  const hand = page.getByRole('table', { name: '我方手牌', exact: true });
  const rows = hand.locator('tbody tr');
  await expect(rows).toHaveCount(16);
  await expect(page.locator('.excel-hand-summary')).toContainText(
    '手牌 16 张成员 11LIVE 5可用能量 4'
  );
  await expect(hand).not.toContainText('This secondary name');
  // This fixture includes a long, multiline effect; a short effect may fit fully at 1920.
  expect(
    await rows
      .first()
      .locator('.excel-card-effect')
      .evaluate((el) => el.scrollWidth > el.clientWidth)
  ).toBe(true);
  for (const row of await rows.all())
    expect((await row.boundingBox())!.height).toBeLessThanOrEqual(32);
  const size = page.viewportSize()!;
  if (size.width >= 1100) {
    const viewport = await page.locator('.excel-hand').boundingBox();
    const visible = await rows.evaluateAll(
      (elements, box) =>
        elements.filter((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.top >= box.y && bounds.bottom <= box.y + box.height;
        }).length,
      viewport!
    );
    expect(visible).toBeGreaterThanOrEqual(size.height >= 950 ? 12 : 8);
    const tabs = await page.locator('.excel-sheets').boundingBox();
    expect(tabs!.y + tabs!.height).toBeLessThanOrEqual(size.height + 1);
  }
  const choices = panel(page).locator('.excel-candidate-choose');
  await choices.first().click();
  await rows.nth(1).getByRole('button').click();
  const details = page.getByRole('region', { name: '选中卡牌', exact: true });
  await expect(details).toContainText('手札を1枚控え室に置く。');
  await expect(page.getByRole('list', { name: '已选顺序' }).getByRole('listitem')).toHaveCount(1);
  expect(await submissions(page)).toEqual([]);
  await expect(page.locator('body')).not.toContainText(fixture.prefix);
  await expect(page.locator('body')).not.toContainText('未公开效果');
  if (size.width >= 1100) {
    const bounds = await details.boundingBox();
    const pending = await page.locator('.excel-operation-task').boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(pending!.y + pending!.height);
    expect(bounds!.height).toBeGreaterThan(180);
  }
  await page.screenshot({ path: info.outputPath('compact-hand.png'), fullPage: true });
  const before = (await page.locator('.excel-hand').boundingBox())!.height;
  await page.getByRole('button', { name: '展开手牌', exact: true }).click();
  expect((await page.locator('.excel-hand').boundingBox())!.height).toBeGreaterThan(before);
  await rows.last().getByRole('button').click();
  await expect(rows.last()).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '收起手牌', exact: true }).click();
  await expect(rows.last()).toHaveAttribute('aria-selected', 'true');
  await expect(rows).toHaveCount(16);
  await page.getByRole('button', { name: '确认选择', exact: true }).click();
  await expect
    .poll(() => submissions(page))
    .toEqual([['fixture-effect', undefined, undefined, undefined, undefined, [fixture.first]]]);
});
test('numeric bounds, keyboard input and slot payload', async ({ page }) => {
  await prepare(page, 'numeric');
  const input = page.getByRole('spinbutton', { name: '支付数量' }),
    confirm = page.getByRole('button', { name: '确认数量' });
  for (const value of ['', '0', '4', '1.5']) {
    await input.fill(value);
    await expect(confirm).toBeDisabled();
  }
  await input.fill('2');
  await input.press('Tab');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => submissions(page))
    .toEqual([['fixture-effect', undefined, undefined, undefined, undefined, undefined, 2]]);
  await page.evaluate(() => (window as any).excelReview.selection('slot'));
  await page.getByRole('button', { name: '移动到左侧', exact: true }).click();
  await expect.poll(() => submissions(page)).toEqual([['fixture-effect', undefined, 'LEFT']]);
});
test('ordered selection retains draft across renderer, reorders and removes stale candidates', async ({
  page,
}) => {
  await prepare(page, 'ordered');
  const choices = panel(page).locator('.excel-candidate-choose');
  await choices.nth(0).click();
  await choices.nth(1).click();
  await page.getByRole('button', { name: '第 2 项上移', exact: true }).click();
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await expect(page.getByRole('list', { name: '已选顺序' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /第 \d+ 项[上下]移/ })).toHaveCount(0);
  await expect(page.locator('.excel-candidate-table')).toHaveCount(0);
  const normalChoices = page.locator('button.group');
  await normalChoices.nth(0).click();
  await normalChoices.nth(0).click();
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'excel');
  await expect(page.getByRole('list', { name: '已选顺序' }).getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: '确认选择', exact: true }).click();
  await expect
    .poll(() => submissions(page))
    .toEqual([
      ['fixture-effect', undefined, undefined, undefined, undefined, ['hand-1', 'hand-0']],
    ]);
  await page.evaluate(() => (window as any).excelReview.expireCandidate());
  await expect(page.getByRole('list', { name: '已选顺序' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText(/候选已更新/)).toBeVisible();
  await page.keyboard.press('Control+Alt+e');
  await expect(page.getByRole('list', { name: '已选顺序' })).toHaveCount(0);
  await expect(page.getByText(/候选已更新/)).toHaveCount(0);
  await expect(page.locator('button.group')).toHaveCount(2);
});
test('anonymous selection sends token, reveals no front or image, and cover does not act', async ({
  page,
}) => {
  const assets: string[] = [];
  page.on('request', (r) => {
    if (['image', 'media'].includes(r.resourceType())) assets.push(r.url());
  });
  await prepare(page, 'blind');
  await expect(panel(page).locator('img')).toHaveCount(0);
  const table = page.getByRole('table', { name: '效果候选卡牌', exact: true });
  await expect(table).not.toContainText('中须霞');
  await expect(table.getByRole('button', { name: /^查看/ })).toHaveCount(0);
  expect(await table.ariaSnapshot()).not.toContain('blind-token');
  await page.keyboard.press('Control+Alt+x');
  await expect(page.locator('#app-overlays')).toHaveAttribute('inert', '');
  await expect(page.getByRole('region', { name: '工作记录工作表' })).not.toContainText('中须霞');
  expect(await submissions(page)).toEqual([]);
  await page.keyboard.press('Control+Alt+x');
  await panel(page).locator('.excel-candidate-choose').first().click();
  await expect.poll(() => submissions(page)).toEqual([['fixture-effect', 'blind-token-1']]);
  expect(assets).toEqual([]);
});
test('Excel theme and stylesheet leave ordinary battle controls unchanged after switching back', async ({
  page,
}) => {
  await prepare(page, 'numeric');
  await page.keyboard.press('Control+Alt+e');
  const ordinaryPanel = page.locator('[data-battle-ui-anchor="active-effect-panel"]');
  await expect(ordinaryPanel.locator('label')).toHaveText('支付数量');
  await expect(ordinaryPanel).not.toContainText('整数');
  const ordinaryAppearance = () =>
    ordinaryPanel.evaluate((panel) => {
      const properties = [
        'color',
        'background-color',
        'font-family',
        'font-size',
        'border-radius',
        'padding',
      ];
      return [panel, ...panel.querySelectorAll('button,input,label')].map((element) =>
        properties.map((property) => getComputedStyle(element).getPropertyValue(property))
      );
    });
  const before = await ordinaryAppearance();
  await page.keyboard.press('Control+Alt+e');
  await page.getByRole('button', { name: '夜间模式', exact: true }).click();
  await page.keyboard.press('Control+Alt+x');
  await page.keyboard.press('Control+Alt+x');
  await page.keyboard.press('Control+Alt+e');
  await expect.poll(ordinaryAppearance).toEqual(before);
  await expect(page.locator('.excel-toolbar,.excel-candidate-table,.excel-card-table')).toHaveCount(
    0
  );
  expect(await submissions(page)).toEqual([]);
  const changes = await page.evaluate(() => {
    const style = document.querySelector<HTMLStyleElement>(
      'style[data-vite-dev-id$="/components/excel/excel.css"]'
    );
    if (!style?.sheet) throw new Error('Missing Excel stylesheet for isolation check');
    const elements = [
      document.documentElement,
      document.body,
      ...document.querySelectorAll('[data-battle-ui-anchor],button,input,[role="dialog"]'),
    ];
    const properties = [
      'display',
      'position',
      'color',
      'background-color',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'border-radius',
      'padding',
      'box-shadow',
      'z-index',
    ];
    const read = () =>
      elements.map((element) =>
        properties.map((property) => getComputedStyle(element).getPropertyValue(property))
      );
    const before = read();
    style.sheet.disabled = true;
    const after = read();
    style.sheet.disabled = false;
    return before.flatMap((values, index) =>
      JSON.stringify(values) === JSON.stringify(after[index])
        ? []
        : [elements[index].outerHTML.slice(0, 160)]
    );
  });
  expect(changes).toEqual([]);
});
test('candidate inspection never commits a single choice and hidden fronts stay unavailable', async ({
  page,
}) => {
  await prepare(page, 'single');
  const table = page.getByRole('table', { name: '效果候选卡牌', exact: true });
  await table.getByRole('button', { name: /^查看/ }).first().click();
  expect(await submissions(page)).toEqual([]);
  await table.locator('.excel-candidate-choose').first().click();
  expect(await submissions(page)).toEqual([['fixture-effect', 'hand-0']]);
  await page.evaluate(() => (window as any).excelReview.hiddenCandidates());
  await expect(table).not.toContainText('未公开成员');
  await expect(table).not.toContainText('未公开效果');
  await expect(table.getByRole('button', { name: /^查看/ })).toHaveCount(0);
  await expect(table.locator('.excel-candidate-choose')).toBeDisabled();
  expect(await submissions(page)).toEqual([]);
});
test('candidate stage position and energy state remain distinguishable, blocked commands cannot select', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => (window as any).excelReview.candidateStates());
  const table = page.getByRole('table', { name: '效果候选卡牌', exact: true });
  const rows = table.locator('tbody tr');
  await expect(rows.nth(0)).toContainText('我方中');
  await expect(rows.nth(1)).toContainText('能量');
  await expect(rows.nth(1)).toContainText('待机；下次不活跃');
  await expect(rows.nth(2)).not.toContainText('下次不活跃');
  await page.evaluate(() => (window as any).excelReview.candidateStates(true));
  for (const choice of await table.locator('.excel-candidate-choose').all())
    await expect(choice).toBeDisabled();
  await rows.first().getByRole('cell').nth(2).click();
  await rows.first().getByRole('button', { name: /^查看/ }).click();
  await expect(page.getByRole('region', { name: '候选卡牌完整信息' })).toContainText('我方中');
  expect(await submissions(page)).toEqual([]);
});
test('real recovery command, public dwell, keyboard and bounded desktop layout', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await prepare(page);
  await page.getByRole('table', { name: '我方场面' }).getByRole('button').click();
  await panel(page)
    .getByRole('button', { name: /回收虹咲LIVE/ })
    .click();
  await expect(panel(page)).toContainText('选择');
  await panel(page).locator('.excel-candidate-choose').first().click();
  const recoveryTable = page.getByRole('table', { name: '效果候选卡牌', exact: true });
  await expect(recoveryTable).toContainText('Dream with You');
  await recoveryTable.locator('.excel-candidate-choose').first().click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).excelReview.store().playerViewState.activeEffect
            ?.publicCardSelectionAutoAdvanceAt ?? null
      )
    )
    .not.toBeNull();
  await page.keyboard.press('Control+Alt+x');
  await page.waitForTimeout(2200);
  await page.keyboard.press('Control+Alt+x');
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).excelReview.store().playerViewState.activeEffect)
    )
    .toBeNull();
  await expect(page.getByRole('table', { name: /我方手牌/ })).toContainText('Dream with You');
  const recoveredLive = page
    .getByRole('table', { name: '我方手牌', exact: true })
    .getByRole('row')
    .filter({ hasText: 'Dream with You' });
  const liveCells = recoveredLive.getByRole('cell');
  await expect(liveCells.nth(3)).toHaveText('LIVE');
  await expect(liveCells.nth(4)).toHaveText('分 4');
  await recoveredLive.getByRole('button').click();
  await expect(page.getByRole('region', { name: '选中卡牌', exact: true })).toContainText(
    '总心 11'
  );
  const size = page.viewportSize()!;
  const rect = await page.locator('.excel-sheets').boundingBox();
  if (size.width >= 1100) expect(rect!.y + rect!.height).toBeLessThanOrEqual(size.height + 1);
  await page.screenshot({ path: info.outputPath('excel-battle.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('effect options show complete text, selection count and illegal option', async ({ page }) => {
  await prepare(page, 'choice');
  const confirm = panel(page).getByRole('button', { name: /按所选效果结算/ });
  await expect(confirm).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: /不可用的效果/ })).toBeDisabled();
  await panel(page)
    .getByRole('button', { name: /选择第一项完整效果/ })
    .click();
  await panel(page)
    .getByRole('button', { name: /选择第二项完整效果/ })
    .click();
  await expect(panel(page)).toContainText('已选 2 / 2');
  await confirm.click();
  const result = await submissions(page);
  expect(result[0][1]).toMatchObject({ selectedEffectOptionIds: ['first', 'second'] });
});
test('real cost payment and text-only LIVE judgment', async ({ page }, info) => {
  await prepare(page);
  await page.evaluate(() => (window as any).excelReview.payment(false));
  await page
    .getByRole('table', { name: /我方手牌/ })
    .getByRole('button', { name: '中须霞', exact: true })
    .first()
    .click();
  await panel(page)
    .getByRole('button', { name: /登场.*左侧.*支付 4 能量/ })
    .click();
  await expect(
    page.getByRole('table', { name: '我方场面' }).getByRole('cell').first()
  ).toContainText('中须霞');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).excelReview.store().playerViewState.table.zones.FIRST_MEMBER_LEFT.slotMap
            .LEFT
      )
    )
    .toBe('obj_hand-0');
  expect(
    await page.evaluate(
      () =>
        Object.values((window as any).excelReview.store().playerViewState.objects).filter(
          (card: any) => card.frontInfo?.cardType === 'ENERGY' && card.orientation === 'WAITING'
        ).length
    )
  ).toBe(4);
  await page.evaluate(() => (window as any).excelReview.cheer(false, 3, false, 1, true));
  const judgment = page.getByRole('region', { name: '应援与 LIVE 判定' });
  await expect(judgment).toBeVisible();
  await expect(judgment).toContainText('当前分数');
  await expect(judgment.getByRole('button', { name: '接受自动判定' })).toBeEnabled();
  await judgment.getByRole('button', { name: '接受自动判定' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).excelReview
          .store()
          .gameSession.state.liveResolution.liveResults.get('live-0')
      )
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath('excel-judgment.png'), fullPage: true });
});
test('headless entrance retries same token while covered', async ({ page }) => {
  const assets: string[] = [];
  page.on('request', (r) => {
    if (['image', 'media'].includes(r.resourceType())) assets.push(r.url());
  });
  await prepare(page);
  await page.evaluate(() => (window as any).excelReview.entrance());
  await expect
    .poll(() => page.evaluate(() => (window as any).excelReview.acks.length))
    .toBeGreaterThan(0);
  await page.keyboard.press('Control+Alt+x');
  await expect
    .poll(() => page.evaluate(() => (window as any).excelReview.acks.length))
    .toBeGreaterThan(1);
  expect(
    await page.evaluate(() =>
      (window as any).excelReview.acks.every((token: string) => token === 'barrier-token')
    )
  ).toBe(true);
  expect(assets).toEqual([]);
});
test('score draft persists across renderer, result window advances and successful LIVE can be chosen', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => (window as any).excelReview.score());
  await expect(page.getByText('Live 分数最终确认', { exact: true })).toBeVisible();
  await page.getByRole('spinbutton').fill('5');
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'excel');
  await expect(page.getByRole('spinbutton')).toHaveValue('5');
  await page.getByRole('button', { name: '确认我的分数', exact: true }).click();
  await page.evaluate(() => {
    const s = (window as any).excelReview.store();
    s.setViewingPlayer('p2');
  });
  await page.getByRole('button', { name: '确认我的分数', exact: true }).click();
  await page.evaluate(() => (window as any).excelReview.store().setViewingPlayer('p1'));
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).excelReview.store().playerViewState.match.subPhase)
    )
    .toBe('RESULT_ANIMATION');
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await expect(page.getByText('LIVE RESULT', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'excel');

  await expect
    .poll(() =>
      page.evaluate(() => (window as any).excelReview.store().playerViewState.match.subPhase)
    )
    .toBe('RESULT_SETTLEMENT');
  await expect(page.getByText(/选择.*成功/).first()).toBeVisible();
  await panel(page).locator('button[data-battle-ui-object-id="live-0"]').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).excelReview.store().playerViewState.table.zones.FIRST_SUCCESS_ZONE.count
      )
    )
    .toBe(1);
});

test('special payment draft, cancellation and explicit ordinary payment stay textual', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => (window as any).excelReview.paymentContract(true));
  const confirm = page.getByRole('button', { name: '确认特殊支付', exact: true });
  await expect(confirm).toBeDisabled();
  await page
    .getByRole('table', { name: '特殊登场支付候选卡牌' })
    .locator('.excel-candidate-choose')
    .first()
    .click();
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'excel');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  expect(await submissions(page)).toEqual([['special-payment', ['hand-1']]]);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect((await submissions(page))[1]).toEqual(['cancel', 'special-payment']);
  await page.evaluate(() => (window as any).excelReview.paymentContract(false));
  await expect(panel(page)).toContainText('权威费用：4 减 2 = 2');
  await page.getByRole('button', { name: '确认支付', exact: true }).click();
  expect(await submissions(page)).toEqual([['cost-payment', ['e1', 'e2']]]);
});
test('formation can move by keyboard and submit placements without dragging', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => (window as any).excelReview.formation());
  await panel(page)
    .getByRole('button', { name: /左侧.*原左/ })
    .focus();
  await page.keyboard.press('Enter');
  await panel(page)
    .getByRole('button', { name: /中心.*空位/ })
    .click();
  await page.getByRole('button', { name: '确认站位', exact: true }).click();
  const result = await submissions(page);
  expect(result[0][7]).toEqual([{ cardId: 'source', toSlot: 'CENTER' }]);
  expect(result[0][8]).toEqual([{ cardId: 'source', toSlot: 'CENTER' }]);
});
test('optional selection skips explicitly and waiting viewer cannot confirm', async ({ page }) => {
  await prepare(page, 'single');
  await page.getByRole('button', { name: '不加入', exact: true }).click();
  expect((await submissions(page))[0][1]).toBeNull();
  await page.evaluate(() => {
    (window as any).excelReview.selection('numeric');
    const s = (window as any).excelReview.store();
    s.setViewingPlayer('p2');
  });
  await expect(page.getByRole('button', { name: '确认数量' })).toHaveCount(0);
});

test('a covered entrance window does not replay when normal rendering returns', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => (window as any).excelReview.entrance(true));
  await expect
    .poll(() => page.evaluate(() => (window as any).excelReview.acks.length))
    .toBeGreaterThan(0);
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await expect(page.locator('[data-profile="kanata"]')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.locator('[data-profile="kanata"]')).toHaveCount(0);
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'excel');
  await expect(page.getByTestId('excel-battle')).toBeVisible();
});

test('normal result presentation still plays, then cover cancels it without blocking settlement', async ({
  page,
}) => {
  await prepare(page);
  await page.keyboard.press('Control+Alt+e');
  await expect(page.locator('html')).toHaveAttribute('data-presentation', 'normal');
  await page.evaluate(() => (window as any).excelReview.score());
  await page.getByRole('button', { name: '确认我的分数', exact: true }).click();
  await page.evaluate(() => (window as any).excelReview.store().setViewingPlayer('p2'));
  await page.getByRole('button', { name: '确认我的分数', exact: true }).click();
  await page.evaluate(() => (window as any).excelReview.store().setViewingPlayer('p1'));
  await expect(page.getByText('LIVE RESULT', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+Alt+x');
  await expect(page.getByRole('region', { name: '工作记录工作表' })).toBeVisible();
  await page.keyboard.press('Control+Alt+x');
  await expect(page.getByText('LIVE RESULT', { exact: true })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).excelReview.store().playerViewState.match.subPhase)
    )
    .toBe('RESULT_SETTLEMENT');
});
