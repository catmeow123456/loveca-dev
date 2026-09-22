import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { aiBrowserFixture, CREATE_INPUT } from './ai-battle-fixture';

test.describe('AI 管理员共享牌桌与只读观察', () => {
  test.beforeEach(({ browser }, info) => {
    void browser;
    test.skip(info.project.name !== 'tablet-1024x768', '本文件显式覆盖宽屏与紧凑视口');
  });

  test('本地完整归档：默认关闭、逐局选择、缓存淘汰后下载及失败提示', async ({ page }) => {
    const dir = await mkdtemp(join(tmpdir(), 'loveca-ui-archive-'));
    const f = await aiBrowserFixture(page, dir);
    try {
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.goto('/?page=ai-battle-admin');
      const toggle = page.getByRole('checkbox', { name: '完整归档到本机', exact: true });
      await expect(toggle).not.toBeChecked();
      await toggle.check();
      await toggle.uncheck();
      await toggle.check();
      await page.screenshot({ path: '../output/playwright/ai-battle/archive-setup-1600.png' });
      await page.getByRole('button', { name: '创建调试对局', exact: true }).click();
      await expect.poll(() => f.service.listSessions(f.owner).length).toBe(1);
      const id = f.service.listSessions(f.owner)[0]!.matchId;
      expect(f.service.getSession(f.owner, id).archiveEnabled).toBe(true);
      const full = '完整材料'.repeat(30000);
      for (let i = 0; i < 130; i++) {
        f.traces.begin(id, {
          id: `archive-${i}`,
          revision: i,
          windowKey: 'TEST',
          seat: 'SECOND',
          purpose: 'MAIN',
        });
        f.traces.append(
          id,
          `archive-${i}`,
          'SAMPLE',
          { text: i === 0 ? full : 'test' },
          { status: 'ACCEPTED' }
        );
      }
      await page.getByRole('button', { name: '观察', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'AI 决定观察', exact: true });
      await expect(dialog).toContainText('本地完整归档正在记录');
      const downloadPromise = page.waitForEvent('download');
      await dialog.getByRole('button', { name: '导出完整归档', exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toContain('.jsonl');
      const rows = (await readFile((await download.path())!, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(rows[0].payload.completeThroughExport).toBe(true);
      expect(
        rows.find((row) => row.kind === 'APPEND' && row.payload.decisionId === 'archive-0').payload
          .payload.text
      ).toBe(full);
      expect(f.service.listDecisions(f.owner, id).evictedDecisions).toBeGreaterThan(0);
      await page.screenshot({
        path: '../output/playwright/ai-battle/archive-observation-1600.png',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(dialog.getByRole('button', { name: '导出完整归档', exact: true })).toBeVisible();
      await page.screenshot({ path: '../output/playwright/ai-battle/archive-observation-390.png' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      f.traces.reportCaptureFailure(id);
      await expect(dialog).toContainText('记录不完整');
      await expect(
        dialog.getByRole('button', { name: '导出已有归档（不完整）', exact: true })
      ).toBeVisible();
      await page.screenshot({ path: '../output/playwright/ai-battle/archive-failed-390.png' });
      const closeBounds = await dialog
        .getByRole('button', { name: '关闭决定观察', exact: true })
        .boundingBox();
      expect(closeBounds).not.toBeNull();
      expect(closeBounds!.x + closeBounds!.width).toBeLessThanOrEqual(390);
      expect(f.state.modelCalls).toBe(0);
    } finally {
      await f.close();
      const originalNow = Date.now;
      Date.now = () => originalNow() + 61 * 60 * 1000;
      f.service.cleanup();
      Date.now = originalNow;
      await new Promise((resolve) => setImmediate(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of [
      { width: 1600, height: 900 },
      { width: 390, height: 844 },
    ]) {
      test(`${theme} ${viewport.width}：固定历史、迟到内容、全文导出与键盘焦点`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.addInitScript((value) => localStorage.setItem('loveca-theme', value), theme);
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const f = await aiBrowserFixture(page);
        try {
          const created = await f.create({ ...CREATE_INPUT, humanSeat: 'SECOND' });
          const id = created.session.matchId;
          await expect
            .poll(() =>
              f.service.listDecisions(f.owner, id).decisions.some((d) => d.status === 'ACCEPTED')
            )
            .toBe(true);
          const accepted = f.service
            .listDecisions(f.owner, id)
            .decisions.find((d) => d.status === 'ACCEPTED')!;
          f.traces.begin(id, {
            id: 'ui-display-wait',
            revision: 89,
            windowKey: 'ui-display-wait',
            seat: 'FIRST',
            purpose: 'WAITING_FOR_TIME',
          });
          f.traces.append(id, 'ui-display-wait', 'WAIT', {}, { status: 'WAITING' });
          f.traces.begin(id, {
            id: 'ui-mechanical',
            revision: 90,
            windowKey: 'ui-mechanical',
            seat: 'FIRST',
            purpose: 'RULE_CONFIRM',
          });
          f.traces.append(id, 'ui-mechanical', 'SUBMIT', {
            selection: { source: 'MECHANICAL' },
            command: { type: 'CONFIRM_RULE_ACTION' },
          });
          f.traces.append(
            id,
            'ui-mechanical',
            'AUTHORITY_RESULT',
            { success: true },
            { status: 'ACCEPTED' }
          );
          await page.goto('/?page=ai-battle-admin');
          await page.getByRole('button', { name: '观察材料', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: 'AI 决定观察', exact: true });
          await expect(dialog).toBeVisible();
          const showWaiting = dialog.getByRole('checkbox', { name: '显示等待记录', exact: true });
          const showMechanical = dialog.getByRole('checkbox', {
            name: '显示机械处理记录',
            exact: true,
          });
          const mechanicalRow = dialog
            .locator('.ai-decision-row')
            .filter({ hasText: 'ui-mechanical' });
          await expect(showMechanical).not.toBeChecked();
          await expect(mechanicalRow).toHaveCount(0);
          const waitingRow = dialog
            .locator('.ai-decision-row')
            .filter({ hasText: 'ui-display-wait' });
          await expect(showWaiting).not.toBeChecked();
          await expect(waitingRow).toHaveCount(0);
          const row = dialog
            .locator('.ai-decision-row')
            .filter({ has: page.locator('.ai-decision-number', { hasText: accepted.id }) })
            .first();
          await expect(row).toHaveAttribute('aria-current', 'true');
          await showWaiting.focus();
          await page.keyboard.press('Space');
          await expect(showWaiting).toBeChecked();
          await expect(waitingRow).toHaveAttribute('aria-current', 'true');
          await waitingRow.click();
          await expect(dialog.locator('.ai-selected-heading')).toContainText('ui-display-wait');
          await page.screenshot({
            path: `../output/playwright/ai-battle/waiting-visible-${theme}-${viewport.width}.png`,
          });
          await showMechanical.check();
          await expect(mechanicalRow).toBeVisible();
          await expect(waitingRow).toHaveAttribute('aria-current', 'true');
          await showWaiting.uncheck();
          await expect(waitingRow).toHaveCount(0);
          await expect(mechanicalRow).toHaveAttribute('aria-current', 'true');
          await mechanicalRow.click();
          await expect(dialog.locator('.ai-outcome')).toContainText('机械处理');
          await page.screenshot({
            path: `../output/playwright/ai-battle/mechanical-visible-${theme}-${viewport.width}.png`,
          });
          await showMechanical.uncheck();
          await expect(mechanicalRow).toHaveCount(0);
          await expect(row).toHaveAttribute('aria-current', 'true');
          await expect(dialog.locator('.ai-selected-heading')).toContainText(`决定 ${accepted.id}`);
          await row.click();
          await expect(row).toHaveAttribute('aria-current', 'true');
          const commandSeq = f.matches.getMatch(id)!.session.getRuntimeStats().currentCommandSeq;
          const modelCalls = f.state.modelCalls;
          const writeCount = f.state.writes.length;
          const cost = row.locator('..').locator('[data-ai-billing="decision"]');
          await expect(cost).toContainText('≈¥0.3866');
          if (viewport.width === 390) await cost.click();
          else await cost.hover();
          const tooltip = page.getByRole('tooltip');
          await expect(tooltip).toHaveText(
            '输入 29,797 + 缓存输入 17,408 + 缓存创建 0 → 输出 81 token'
          );
          const tooltipBounds = await tooltip.boundingBox();
          expect(tooltipBounds!.x).toBeGreaterThanOrEqual(0);
          expect(tooltipBounds!.x + tooltipBounds!.width).toBeLessThanOrEqual(viewport.width);
          await page.screenshot({
            path: `../output/playwright/ai-battle/billing-${theme}-${viewport.width}.png`,
          });
          await cost.focus();
          await page.keyboard.press('Escape');
          await expect(tooltip).not.toBeVisible();
          await expect(dialog).toBeVisible();
          const billing = await f.service.getRecordedBilling(f.owner, id);
          expect(billing.matchBilling?.estimatedCny).toBe('0.38659200');
          const requestMaterial = dialog
            .locator('.ai-material')
            .filter({ has: page.locator('summary', { hasText: '实际模型请求' }) })
            .first();
          await requestMaterial.locator('> summary').click();
          await expect(
            requestMaterial.getByRole('list', { name: '实际发送的消息，按请求顺序' }).locator('li')
          ).toHaveCount(6);
          await page.screenshot({
            path: `../output/playwright/ai-battle/request-${theme}-${viewport.width}.png`,
          });
          await requestMaterial.locator('> summary').click();
          await dialog.locator('.ai-captured-view > summary').click();
          await expect(
            dialog
              .locator('.ai-view-zones section')
              .filter({ has: page.locator('h5', { hasText: '当时 AI 手牌' }) })
              .locator('li')
          ).toHaveCount(6);
          await dialog.locator('.ai-captured-view > summary').click();

          f.traces.begin(id, {
            id: 'ui-late',
            revision: 90,
            windowKey: 'ui-fixture',
            seat: 'FIRST',
            purpose: 'MAIN',
          });
          f.traces.append(
            id,
            'ui-late',
            'WAIT',
            { reason: 'browser fixture' },
            { status: 'WAITING_SELECTED' }
          );
          f.traces.append(id, accepted.id, 'RESPONSE_BODY', {
            rawBody: 'late-response-body\n' + '保留正文'.repeat(2500),
          });
          await expect(dialog.locator('.ai-decision-number', { hasText: 'ui-late' })).toBeVisible();
          await expect(row).toHaveAttribute('aria-current', 'true');
          const lateRow = dialog.locator('.ai-decision-row').filter({ hasText: 'ui-late' });
          await lateRow.click();
          f.traces.append(id, 'ui-late', 'SUBMIT', { selection: { source: 'MECHANICAL' } });
          await expect(lateRow).toHaveCount(0);
          await expect(row).toHaveAttribute('aria-current', 'true');
          await expect(dialog.locator('.ai-selected-heading')).toContainText(`决定 ${accepted.id}`);
          await showMechanical.check();
          await expect(lateRow).toHaveAttribute('aria-current', 'true');
          await showMechanical.uncheck();
          await row.click();
          await dialog.getByLabel('查找当前材料', { exact: true }).fill('late-response-body');
          await expect(dialog.locator('.ai-material')).toHaveCount(1);
          await dialog.locator('.ai-material > summary').click();
          await expect(dialog.locator('.ai-material > pre')).toContainText('late-response-body');
          await dialog.getByRole('button', { name: '复制正文全文', exact: true }).click();
          expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
            'late-response-body\n' + '保留正文'.repeat(2500)
          );
          await dialog.getByLabel('查找当前材料', { exact: true }).fill('');
          await dialog.locator('.ai-material[open] > summary').click();

          const downloadEvent = page.waitForEvent('download');
          await dialog.getByRole('button', { name: '导出本决定', exact: true }).click();
          const download = await downloadEvent;
          const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
          expect(exported.decisions).toHaveLength(1);
          expect(exported.decisions[0].id).toBe(accepted.id);
          expect(exported.decisions[0].decisionBilling.estimatedCny).toBe('0.38659200');
          expect(exported.matchBilling.estimatedCny).toBe('0.38659200');
          expect(
            exported.materials.some((m: { content: string }) =>
              m.content?.includes('late-response-body')
            )
          ).toBe(true);
          const ids = new Set(exported.materials.map((m: { id: string }) => m.id));
          for (const event of exported.decisions[0].events)
            expect(ids.has(event.materialId)).toBe(true);
          expect(JSON.stringify(exported)).not.toContain('browser-fake-secret');

          // The final summary must wrap forward; reverse Tab from the first control must land
          // on that visible summary, never a copy button or pre inside closed details.
          const lastSummary = dialog.locator('.ai-material > summary').last();
          await lastSummary.focus();
          await page.keyboard.press('Tab');
          await expect(dialog.locator('[data-ai-billing="match"]').first()).toBeFocused();
          await page.keyboard.press('Shift+Tab');
          await expect(lastSummary).toBeFocused();
          await dialog.locator('.ai-decision-detail').evaluate((element) => {
            element.scrollTop = 0;
          });
          await page.screenshot({
            path: `../output/playwright/ai-battle/observation-${theme}-${viewport.width}.png`,
          });
          const bounds = await dialog.boundingBox();
          expect(bounds!.x).toBeGreaterThanOrEqual(0);
          expect(bounds!.width).toBeLessThanOrEqual(viewport.width);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
          ).toBe(true);
          await page.keyboard.press('Escape');
          await expect(dialog).not.toBeVisible();
          await expect(page.getByRole('button', { name: '观察材料', exact: true })).toBeFocused();
          expect(f.state.writes).toHaveLength(writeCount);
          expect(f.state.modelCalls).toBe(modelCalls);
          expect(f.matches.getMatch(id)!.session.getRuntimeStats().currentCommandSeq).toBe(
            commandSeq
          );
          expect(errors).toEqual([]);
        } finally {
          await f.close();
        }
      });
    }
  }

  test('提交未完成、规则拒绝与历史淘汰不会显示为已执行或切换到别的旧详情', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const f = await aiBrowserFixture(page);
    try {
      const { session } = await f.create();
      const id = session.matchId;
      await expect
        .poll(() => f.service.listDecisions(f.owner, id).decisions.length)
        .toBeGreaterThan(0);
      const waits = f.service.listDecisions(f.owner, id).decisions;
      expect(waits.every((row) => row.purpose === 'WAITING_FOR_PLAYER')).toBe(true);
      await page.goto('/?page=ai-battle-admin');
      await page.getByRole('button', { name: '观察材料', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'AI 决定观察', exact: true });
      const showWaiting = dialog.getByRole('checkbox', { name: '显示等待记录', exact: true });
      await expect(showWaiting).not.toBeChecked();
      await expect(dialog.locator('.ai-decision-row')).toHaveCount(0);
      await expect(dialog.locator('.ai-selected-heading')).toHaveCount(0);
      await showWaiting.check();
      await expect(dialog.locator('.ai-decision-row')).toHaveCount(waits.length);
      await dialog.locator('.ai-decision-row').last().click();
      await showWaiting.uncheck();
      await expect(dialog.locator('.ai-decision-row')).toHaveCount(0);
      await expect(dialog.locator('.ai-selected-heading')).toHaveCount(0);
      await page.screenshot({
        path: '../output/playwright/ai-battle/waiting-only-hidden-1600.png',
      });
      f.traces.begin(id, {
        id: 'only-mechanical',
        revision: 79,
        windowKey: 'only-mechanical',
        seat: 'SECOND',
        purpose: 'RULE_CONFIRM',
      });
      f.traces.append(id, 'only-mechanical', 'SUBMIT', { selection: { source: 'MECHANICAL' } });
      const showMechanical = dialog.getByRole('checkbox', {
        name: '显示机械处理记录',
        exact: true,
      });
      await showMechanical.check();
      const mechanicalRow = dialog
        .locator('.ai-decision-row')
        .filter({ hasText: 'only-mechanical' });
      await expect(mechanicalRow).toHaveAttribute('aria-current', 'true');
      await mechanicalRow.click();
      await showMechanical.uncheck();
      await expect(dialog.locator('.ai-decision-row')).toHaveCount(0);
      await expect(dialog.locator('.ai-selected-heading')).toHaveCount(0);
      f.traces.begin(id, {
        id: 'ui-rejected',
        revision: 80,
        windowKey: 'ui-rejected',
        seat: 'SECOND',
        purpose: 'MAIN',
      });
      f.traces.append(id, 'ui-rejected', 'SUBMIT', {
        selection: { source: 'FALLBACK' },
        command: { type: 'END_PHASE' },
      });
      await expect(dialog.locator('.ai-outcome')).toContainText('已提交，等待执行结果');
      await dialog.locator('.ai-decision-row').filter({ hasText: 'ui-rejected' }).click();
      f.traces.append(
        id,
        'ui-rejected',
        'AUTHORITY_RESULT',
        { success: false, error: '夹具规则拒绝' },
        { status: 'STOPPED' }
      );
      await expect(dialog.locator('.ai-outcome')).toContainText('执行被拒绝');
      await expect(dialog.locator('.ai-outcome')).not.toContainText('执行成功');
      const downloadEvent = page.waitForEvent('download');
      await dialog.getByRole('button', { name: '导出会话', exact: true }).click();
      const downloaded = JSON.parse(await readFile((await (await downloadEvent).path())!, 'utf8'));
      expect(downloaded).toMatchObject({ format: 'loveca-ai-observation-v1', matchId: id });
      expect(
        downloaded.decisions.some((decision: { id: string }) => decision.id === 'only-mechanical')
      ).toBe(true);
      for (const wait of waits) {
        expect(
          downloaded.decisions.some((decision: { id: string }) => decision.id === wait.id)
        ).toBe(true);
      }
      expect(
        downloaded.decisions.some((decision: { id: string }) => decision.id === 'ui-rejected')
      ).toBe(true);
      for (let i = 0; i < 130; i++) {
        f.traces.begin(id, {
          id: `eviction-${i}`,
          revision: 81 + i,
          windowKey: `eviction-${i}`,
          seat: 'SECOND',
          purpose: 'MAIN',
        });
        f.traces.append(id, `eviction-${i}`, 'ACCEPTED', {}, { status: 'ACCEPTED' });
      }
      await expect(dialog.getByRole('alert')).toContainText('决定 ui-rejected');
      await expect(dialog.locator('.ai-selected-heading')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: '导出本决定', exact: true })).toHaveCount(0);
      await dialog.getByRole('button', { name: '跟随最新', exact: true }).click();
      await expect(dialog.locator('.ai-decision-row[aria-current="true"]')).toContainText(
        'eviction-129'
      );
      await expect(dialog.locator('.ai-selected-heading')).toContainText('eviction-129');
      await expect(dialog.getByRole('alert')).toHaveCount(0);
      expect(f.state.writes).toEqual([]);
      expect(f.state.modelCalls).toBe(0);
      expect(f.matches.getMatch(id)!.session.getRuntimeStats().currentCommandSeq).toBe(0);
    } finally {
      await f.close();
    }
  });

  test('创建、真实换牌命令、返回恢复、失败结束重试及再次创建', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const f = await aiBrowserFixture(page);
    try {
      await page.goto('/?page=ai-battle-admin');
      await expect(page.getByRole('button', { name: '创建调试对局', exact: true })).toBeEnabled();
      const model = page.getByRole('combobox', { name: 'AI 模型', exact: true });
      await expect(model.locator('option')).toHaveCount(f.service.listModels().length);
      await expect(model).toHaveValue('qwen3.8-flash');
      const thinking = page.getByRole('checkbox', { name: '开启思考', exact: true });
      await expect(thinking).not.toBeChecked();
      await thinking.focus();
      await page.keyboard.press('Space');
      await expect(thinking).toBeChecked();
      await page.screenshot({ path: '../output/playwright/ai-battle/setup-1600.png' });
      await page.getByRole('button', { name: '创建调试对局', exact: true }).click();
      await expect.poll(() => f.service.listSessions(f.owner).length).toBe(1);
      const id = f.service.listSessions(f.owner)[0]!.matchId;
      expect(f.service.getSession(f.owner, id).model).toBe('qwen3.8-flash');
      expect(f.service.getSession(f.owner, id).enableThinking).toBe(true);
      await expect(page.locator('.ai-battle-toolbar')).toBeVisible();
      await page.screenshot({ path: '../output/playwright/ai-battle/board-opening-1600.png' });
      await page.getByRole('button', { name: '保留手牌', exact: true }).click();
      await expect
        .poll(
          () =>
            f.matches
              .getMatch(id)!
              .session.getCommandLogSince(0)
              .filter((c) => c.commandType === 'MULLIGAN').length
        )
        .toBe(2);
      await expect.poll(() => f.state.modelCalls).toBeGreaterThan(0);
      const materials = f.service.exportDecisions(f.owner, id).materials;
      const request = materials.find((material) => material.title === 'REQUEST')!;
      expect(JSON.parse(JSON.parse(request.content!).body).enable_thinking).toBe(true);
      await expect
        .poll(() => f.service.getSession(f.owner, id).matchBilling.reportedAttempts)
        .toBeGreaterThan(0);
      expect(f.service.getSession(f.owner, id).matchBilling.estimatedCny).toBe('0.02579710');
      expect(f.state.writes.filter((p) => p.endsWith('/command'))).toHaveLength(1);
      const before = f.state.snapshots;
      await page.getByRole('button', { name: '观察', exact: true }).click();
      await expect.poll(() => f.state.snapshots).toBeGreaterThan(before);
      await page.getByRole('button', { name: '关闭决定观察', exact: true }).click();
      await page.getByRole('button', { name: '返回 AI 会话列表，保留对局' }).click();
      expect(f.matches.getMatch(id)).not.toBeNull();
      await page.reload();
      await expect(page.locator('.ai-session-section')).toContainText('思考开启');
      await page.getByRole('button', { name: '继续对局', exact: true }).click();
      await expect(page.locator('.ai-battle-toolbar')).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: '../output/playwright/ai-battle/board-resumed-390.png' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      f.state.failNextEnd = true;
      await page.getByRole('button', { name: '结束', exact: true }).click();
      await page.getByRole('button', { name: '结束调试对局', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('请重试结束');
      expect(f.matches.getMatch(id)).not.toBeNull();
      await page.screenshot({ path: '../output/playwright/ai-battle/end-failed-390.png' });
      await page.getByRole('button', { name: '结束', exact: true }).click();
      await page.getByRole('button', { name: '结束调试对局', exact: true }).click();
      await expect.poll(() => f.matches.getMatch(id)).toBeNull();
      await expect(thinking).not.toBeChecked();
      await page.getByRole('button', { name: '创建调试对局', exact: true }).click();
      await expect
        .poll(() => f.service.listSessions(f.owner).filter((s) => s.endedAt === null).length)
        .toBe(1);
      expect(f.service.listSessions(f.owner).find((s) => s.endedAt === null)!.matchId).not.toBe(id);
      expect(f.service.listSessions(f.owner).find((s) => s.endedAt === null)!.enableThinking).toBe(
        false
      );
      expect(errors).toEqual([]);
    } finally {
      await f.close();
    }
  });
});
