import { expect, test, type Page, type Route } from '@playwright/test';
import type {
  DeckClassifierYamlPreviewView,
  DeckClassifierOverviewView,
  DeckClassifierMatchCandidateView,
} from '../../../src/online/deck-classifier-types';

const NOW = '2026-09-06T04:00:00.000Z';
const yamlPreview = (name = 'YAML 测试卡组'): DeckClassifierYamlPreviewView => ({
  suggestedName: name,
  deckFingerprint: 'sha256:yaml',
  memberTotal: 48,
  liveTotal: 12,
  existingTemplate: null,
  cards: Array.from({ length: 15 }, (_, i) => ({
    baseCardCode: `PL!N-bp1-${String(i + 1).padStart(3, '0')}`,
    count: 4,
    cardType: i < 12 ? 'MEMBER' : 'LIVE',
  })),
});
const SEASON = '77777777-7777-4777-8777-777777777701';
const CLASS = '77777777-7777-4777-8777-777777777702';
function overview(): DeckClassifierOverviewView {
  const archetype = {
    id: CLASS,
    archetypeKey: 'aqours_test',
    name: '水族馆',
    groupName: 'Aqours',
    description: '',
    color: '#7C3AED',
    representativeCardCode: null,
    representativeImageFilename: null,
    sortOrder: 100,
    lifecycle: 'ACTIVE' as const,
    templateCount: 0,
    ruleCount: 0,
    createdAt: 0,
    updatedAt: 0,
  };
  return {
    displayMode: 'BOTH',
    visibleSections: ['USAGE'],
    cardDisplayMode: 'BOTH',
    cardVisibleSections: ['USAGE'],
    topRankedPlayerCount: 30,
    draftRevision: 1,
    activeRelease: null,
    archetypes: [
      archetype,
      { ...archetype, id: `${CLASS}-2`, name: '另一分类', groupName: ' Aqours ' },
      {
        ...archetype,
        id: `${CLASS}-3`,
        name: '旧分类',
        groupName: '莲之空',
        lifecycle: 'ARCHIVED',
      },
    ],
    templates: [],
    rules: [],
    releases: [],
    runs: [],
    reviewQueue: [],
    overrides: [],
  };
}
function candidate(index = 0, firstAvailable = true): DeckClassifierMatchCandidateView {
  return {
    matchId: `ranked-match-${index}`,
    roomCode: `R${index}`,
    matchMode: 'ONLINE',
    automationGameMode: 'DEBUG',
    originKind: 'RANKED',
    originLabel: '排位',
    status: 'COMPLETED',
    completeness: 'METADATA_ONLY',
    startedAt: Date.parse(NOW) - index * 60000,
    endedAt: Date.parse(NOW),
    sealedAt: Date.parse(NOW),
    viewerSeat: 'FIRST',
    opponentSeat: 'SECOND',
    opponentUserId: 'beta',
    opponentDisplayName: 'Beta',
    winnerSeat: 'SECOND',
    endReason: null,
    turnCount: 5,
    lastTimelineSeq: 0,
    lastCheckpointSeq: 0,
    replayCapabilities: [],
    replayLimitations: [],
    partialReasonSummary: null,
    participants: [
      {
        seat: 'FIRST',
        userId: 'alpha',
        displayName: 'Alpha',
        playerId: 'p1',
        participantKind: 'USER',
        ownerUserId: null,
      },
      {
        seat: 'SECOND',
        userId: 'beta',
        displayName: 'Beta',
        playerId: 'p2',
        participantKind: 'USER',
        ownerUserId: null,
      },
    ],
    activityName: '测试赛季',
    importableSeats: firstAvailable ? ['FIRST', 'SECOND'] : ['SECOND'],
    deckNamesBySeat: { FIRST: 'Alpha 的练习构筑', SECOND: index === 1 ? null : 'Beta 的比赛卡组' },
  };
}
async function reply(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data, error: null }),
  });
}
async function setup(page: Page) {
  const state = {
    overview: overview(),
    imports: [] as Record<string, unknown>[],
    creates: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    queries: [] as URL[],
    historyQueries: [] as URL[],
    failImport: false,
    failQuery: false,
    delayedQuery: false,
    records: [candidate(0, false), candidate(1)],
  };
  await page.route('**/site-status.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        availability: 'OPEN',
        generatedAt: NOW,
        maintenance: null,
      }),
    })
  );
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/config')
      return reply(route, {
        features: {
          email: { enabled: false, verificationRequired: false, passwordResetEnabled: false },
          battleEntries: { ranked: true, themeTable: true },
        },
        siteStatus: { lifecycle: 'NORMAL', generatedAt: NOW, maintenance: null, announcements: [] },
        matchEmotes: null,
      });
    if (path === '/api/auth/refresh')
      return reply(route, {
        accessToken: 'classifier-test-token',
        user: { id: 'test-admin', email: 'test@example.test' },
        profile: {
          id: 'test-admin',
          username: 'test_admin',
          display_name: '测试管理员',
          avatar_url: null,
          role: 'admin',
          deck_count: 0,
          created_at: NOW,
          updated_at: NOW,
        },
      });
    if (path === '/api/admin/ranked/seasons')
      return reply(route, [{ id: SEASON, name: '测试赛季' }]);
    if (path === '/api/battle/admin/match-records') {
      state.historyQueries.push(url);
      return reply(route, []);
    }
    if (path === '/api/admin/theme-table/events')
      return reply(route, [{ id: 'theme-1', name: '测试娱乐活动' }]);
    if (path.endsWith('/deck-classifier/overview')) return reply(route, state.overview);
    if (path.endsWith('/template-match-candidates')) {
      state.queries.push(url);
      if (state.failQuery) {
        state.failQuery = false;
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            data: null,
            error: { code: 'TEST_FAILURE', message: '查询暂时失败' },
          }),
        });
      }
      const query = url.searchParams.get('userQuery');
      if (state.delayedQuery && query === 'old')
        await new Promise((resolve) => setTimeout(resolve, 600));
      const records =
        query === 'empty'
          ? []
          : query === 'old'
            ? [{ ...candidate(90), activityName: '过期查询' }]
            : state.records.filter((record) => record.originKind === 'RANKED');
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return reply(route, {
        items: records.slice(offset, offset + 50),
        hasMore: records.length > offset + 50,
      });
    }
    if (path.endsWith('/templates/from-match')) {
      const input = route.request().postDataJSON();
      state.imports.push(input);
      if (state.failImport) {
        state.failImport = false;
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            data: null,
            error: {
              code: 'DECK_CLASSIFIER_DRAFT_REVISION_CONFLICT',
              message: '分类草稿已更新，请刷新后重试',
            },
          }),
        });
      }
      const template = {
        id: `template-${state.imports.length}`,
        archetypeId: input.archetypeId,
        name: input.name,
        deckFingerprint: 'sha256:test',
        cards: [],
        sourceKind: 'MATCH_OBSERVATION' as const,
        sourceMatchId: input.matchId,
        sourceSeat: input.seat,
        sourceNote: input.sourceNote,
        enabled: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      state.overview = {
        ...state.overview,
        draftRevision: state.overview.draftRevision + 1,
        templates: [...state.overview.templates, template],
      };
      return reply(route, template);
    }
    if (path.endsWith('/deck-classifier/archetypes') && route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      state.creates.push(input);
      state.overview = {
        ...state.overview,
        draftRevision: state.overview.draftRevision + 1,
        archetypes: [
          ...state.overview.archetypes,
          { ...state.overview.archetypes[0], ...input, id: 'new-class' },
        ],
      };
      return reply(route, state.overview.archetypes.at(-1));
    }
    if (path.includes('/deck-classifier/archetypes/') && route.request().method() === 'PUT') {
      const input = route.request().postDataJSON();
      state.updates.push(input);
      return reply(route, {});
    }
    if (path === '/api/decks' || path === '/api/player-badges/me') return reply(route, []);
    return reply(route, null);
  });
  await page.goto('/?page=deck-classifier-admin');
  await page.getByRole('tab', { name: '样板库', exact: true }).click();
  return state;
}
const picker = (page: Page) => page.getByRole('dialog', { name: '从历史对局选择', exact: true });
async function openPicker(page: Page) {
  await page.getByRole('button', { name: '从历史对局选择', exact: true }).click();
  await expect(
    picker(page).getByRole('button', { name: '后攻 · Beta', exact: true }).first()
  ).toBeEnabled();
}

test('筛选、先后攻回填及最终导入，取消与键盘关闭不写入', async ({ page }, testInfo) => {
  const state = await setup(page);
  await page.getByLabel('样板名称', { exact: true }).fill('手写样板');
  await page.getByLabel('来源备注', { exact: true }).fill('保留备注');
  await openPicker(page);
  await expect(
    picker(page).getByRole('button', { name: '先攻 · Alpha', exact: true }).first()
  ).toBeDisabled();
  const firstSeats = picker(page).locator('article').first().locator('div.grid > div');
  await expect(firstSeats.nth(0)).toContainText('负 ·Alpha 的练习构筑');
  await expect(firstSeats.nth(1)).toContainText('胜 ·Beta 的比赛卡组');
  await expect(picker(page).locator('article').nth(1)).toContainText('卡组名称未记录');
  await picker(page).getByRole('button', { name: '按排位赛季筛选', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeVisible();
  await picker(page).getByRole('button', { name: '按排位赛季筛选', exact: true }).click();
  await page.getByRole('option', { name: '测试赛季', exact: true }).click();
  await picker(page).getByLabel('玩家 A', { exact: true }).fill('Alpha');
  await picker(page).getByLabel('玩家 B', { exact: true }).fill('Beta');
  await picker(page).getByLabel('开始', { exact: true }).fill('2026-09-01');
  await picker(page).getByLabel('结束', { exact: true }).fill('2026-09-06');
  await picker(page).getByRole('button', { name: '查询', exact: true }).click();
  await expect.poll(() => state.queries.at(-1)?.searchParams.get('playerBQuery')).toBe('Beta');
  expect(state.queries.at(-1)?.searchParams.get('rankedSeasonId')).toBe(SEASON);
  await expect(
    picker(page).getByRole('button', { name: '后攻 · Beta', exact: true }).first()
  ).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('match-picker.png') });
  const box = await picker(page).boundingBox();
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await picker(page).getByRole('button', { name: '后攻 · Beta', exact: true }).first().click();
  await expect(page.getByLabel('对局 ID', { exact: true })).toHaveValue('ranked-match-0');
  await expect(page.getByRole('combobox', { name: '席位', exact: true })).toHaveValue('SECOND');
  await expect(page.getByLabel('样板名称', { exact: true })).toHaveValue('手写样板');
  expect(state.imports).toHaveLength(0);
  await openPicker(page);
  await expect(picker(page).getByLabel('玩家 A', { exact: true })).toHaveValue('Alpha');
  await page.keyboard.press('Escape');
  await expect(picker(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '从历史对局选择', exact: true })).toBeFocused();
  await expect(page.getByLabel('对局 ID', { exact: true })).toHaveValue('ranked-match-0');
  await page.getByRole('button', { name: '导入样板', exact: true }).click();
  await expect.poll(() => state.overview.templates.length).toBe(1);
  expect(state.imports[0]).toMatchObject({
    matchId: 'ranked-match-0',
    seat: 'SECOND',
    archetypeId: CLASS,
    name: '手写样板',
    sourceNote: '保留备注',
    expectedDraftRevision: 1,
  });
  expect(state.imports[0]).not.toHaveProperty('cards');
  await expect(page.getByLabel('对局 ID', { exact: true })).toHaveValue('');
});

test('自动名称随选局和席位更新，手动改名保留，冲突后输入可重试', async ({ page }) => {
  const state = await setup(page);
  await openPicker(page);
  await picker(page).getByRole('button', { name: '后攻 · Beta', exact: true }).first().click();
  await expect(page.getByLabel('样板名称', { exact: true })).toHaveValue(/Beta.*后攻/);
  await openPicker(page);
  await picker(page).getByRole('button', { name: '先攻 · Alpha', exact: true }).nth(1).click();
  await expect(page.getByLabel('样板名称', { exact: true })).toHaveValue(/Alpha.*先攻/);
  await page.getByRole('combobox', { name: '席位', exact: true }).selectOption('SECOND');
  await expect(page.getByLabel('样板名称', { exact: true })).toHaveValue(/Beta.*后攻/);
  await page.getByLabel('样板名称', { exact: true }).fill('自定名称');
  state.failImport = true;
  await page.getByRole('button', { name: '导入样板', exact: true }).click();
  await expect.poll(() => state.imports.length).toBe(1);
  await expect(page.getByLabel('样板名称', { exact: true })).toHaveValue('自定名称');
  await expect(page.getByLabel('对局 ID', { exact: true })).toHaveValue('ranked-match-1');
  await page.getByRole('button', { name: '导入样板', exact: true }).click();
  await expect.poll(() => state.overview.templates.length).toBe(1);
});

test('分页、空结果、失败重试和迟到查询不会覆盖当前筛选', async ({ page }) => {
  const state = await setup(page);
  state.records = Array.from({ length: 51 }, (_, i) => candidate(i));
  await openPicker(page);
  await expect(picker(page).locator('article')).toHaveCount(50);
  await picker(page).getByRole('button', { name: '加载更多', exact: true }).click();
  await expect(picker(page).locator('article')).toHaveCount(51);
  expect(state.queries.at(-1)?.searchParams.get('offset')).toBe('50');
  const search = picker(page).getByLabel('搜索参与者或对局');
  await search.fill('empty');
  await picker(page).getByRole('button', { name: '查询', exact: true }).click();
  await expect(picker(page).locator('article')).toHaveCount(0);
  state.failQuery = true;
  await search.fill('retry');
  await picker(page).getByRole('button', { name: '查询', exact: true }).click();
  await picker(page).getByRole('button', { name: '重试', exact: true }).click();
  await expect(picker(page).locator('article')).toHaveCount(50);
  state.delayedQuery = true;
  await search.fill('old');
  await picker(page).getByRole('button', { name: '查询', exact: true }).click();
  await expect.poll(() => state.queries.at(-1)?.searchParams.get('userQuery')).toBe('old');
  await search.fill('empty');
  await picker(page).getByRole('button', { name: '查询', exact: true }).click();
  await expect(picker(page).locator('article')).toHaveCount(0);
  await page.waitForTimeout(800); // Wait beyond the deliberately delayed response.
  await expect(picker(page).locator('article')).toHaveCount(0);
  expect(state.queries.at(-1)?.searchParams.get('offset')).toBe('0');
});

test('取消编辑沿用原行为，分组去重、归档选项及自定义保存后可继续新增', async ({
  page,
}, testInfo) => {
  const state = await setup(page);
  await page.getByRole('tab', { name: '分类名称', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).first().click();
  await expect(page.getByLabel('稳定 key', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '所属系列／分组', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Aqours', exact: true })).toHaveCount(1);
  await expect(page.getByRole('option', { name: '莲之空', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(page.getByLabel('稳定 key', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('稳定 key', { exact: true })).toHaveValue('');
  expect(state.updates).toHaveLength(0);
  await page.getByLabel('稳定 key', { exact: true }).fill('new_group');
  await page.getByLabel('玩家显示名', { exact: true }).fill('新分类');
  await page.getByRole('button', { name: '所属系列／分组', exact: true }).click();
  await page.getByRole('option', { name: '自定义…', exact: true }).click();
  await page.getByLabel('自定义系列／分组', { exact: true }).fill('新系列');
  await page.screenshot({ path: testInfo.outputPath('custom-group.png'), fullPage: true });
  await page.getByRole('button', { name: '新增分类', exact: true }).click();
  await expect.poll(() => state.creates.length).toBe(1);
  expect(state.creates[0]).toMatchObject({
    archetypeKey: 'new_group',
    name: '新分类',
    groupName: '新系列',
  });
  await expect(page.getByLabel('稳定 key', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '所属系列／分组', exact: true }).click();
  await page.getByRole('option', { name: '新系列', exact: true }).click();
  await expect(page.getByLabel('自定义系列／分组', { exact: true })).toHaveCount(0);
  await page.getByLabel('稳定 key', { exact: true }).fill('next_group');
  await page.getByLabel('玩家显示名', { exact: true }).fill('再一分类');
  await page.getByRole('button', { name: '新增分类', exact: true }).click();
  await expect.poll(() => state.creates.length).toBe(2);
  expect(state.creates[1].groupName).toBe('新系列');
});

test('历史对局复用双方筛选，并保留原有娱乐活动筛选', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/?page=match-records');
  await page.getByRole('button', { name: '筛选对局', exact: true }).click();
  await page.getByRole('button', { name: '按所属活动筛选', exact: true }).click();
  await page.getByRole('option', { name: '主题牌桌 · 测试娱乐活动', exact: true }).click();
  await page.getByLabel('玩家 A', { exact: true }).fill('Alpha');
  await page.getByLabel('玩家 B', { exact: true }).fill('Beta');
  await page.getByLabel('搜索参与者或对局').fill('ROOM');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect
    .poll(() => state.historyQueries.at(-1)?.searchParams.get('playerBQuery'))
    .toBe('Beta');
  expect(Object.fromEntries(state.historyQueries.at(-1)!.searchParams)).toMatchObject({
    playerAQuery: 'Alpha',
    playerBQuery: 'Beta',
    userQuery: 'ROOM',
    themeTableVersionId: 'theme-1',
  });
  await expect(page.getByRole('button', { name: '查询', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '清空', exact: true }).click();
  await expect.poll(() => state.historyQueries.at(-1)?.search).toBe('');
  expect(state.imports).toHaveLength(0);
});

test('样板选择仅保留排位赛季，不请求娱乐活动或显示模式筛选', async ({ page }) => {
  const state = await setup(page);
  state.records = [candidate(0), { ...candidate(1), originKind: 'SOLITAIRE' }];
  const themeRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/theme')) themeRequests.push(request.url());
  });
  await openPicker(page);
  await expect(picker(page).locator('article')).toHaveCount(1);
  await expect(
    picker(page).getByRole('button', { name: '按对局模式筛选', exact: true })
  ).toHaveCount(0);
  await expect(
    picker(page).getByRole('button', { name: '按排位赛季筛选', exact: true })
  ).toBeVisible();
  await expect(
    picker(page).getByRole('button', { name: '按所属活动筛选', exact: true })
  ).toHaveCount(0);
  expect(themeRequests).toEqual([]);
});

test('YAML 文件预览、确认导入和失败重试，取消不写入', async ({ page }, testInfo) => {
  const state = await setup(page);
  const imports: Record<string, unknown>[] = [];
  await page.route('**/templates/preview-yaml', (route) => reply(route, yamlPreview()));
  await page.route('**/templates/from-yaml', async (route) => {
    const data = route.request().postDataJSON();
    imports.push(data);
    if (imports.length === 1)
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          data: null,
          error: { code: 'CONFLICT', message: '测试导入失败，请重试' },
        }),
      });
    const template = {
      id: 'yaml-template',
      archetypeId: CLASS,
      name: data.name,
      cards: yamlPreview().cards,
      deckFingerprint: 'sha256:yaml',
      sourceKind: 'MANUAL' as const,
      sourceMatchId: null,
      sourceSeat: null,
      sourceNote: data.sourceNote,
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.overview = {
      ...state.overview,
      templates: [template],
      draftRevision: state.overview.draftRevision + 1,
    };
    return reply(route, template);
  });
  await expect(page.getByRole('dialog', { name: '从 YAML 文件导入样板' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('yaml-button-entry.png'), fullPage: true });
  const file = {
    name: '测试卡组.yaml',
    mimeType: 'text/yaml',
    buffer: Buffer.from('player_name: 测试卡组'),
  };
  await page.getByRole('button', { name: '导入 YAML', exact: true }).click();
  await page.getByLabel('YAML 卡组文件', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('table', { name: 'YAML 主卡组预览' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('yaml-import-dialog.png'), fullPage: true });
  expect(imports).toHaveLength(0);
  await page.getByRole('button', { name: '取消 YAML 导入', exact: true }).click();
  await expect(page.getByRole('table', { name: 'YAML 主卡组预览' })).toHaveCount(0);
  expect(imports).toHaveLength(0);
  await page.getByRole('button', { name: '导入 YAML', exact: true }).click();
  await page.getByLabel('YAML 卡组文件', { exact: true }).setInputFiles(file);
  await expect(page.getByLabel('YAML 样板名称', { exact: true })).toHaveValue('YAML 测试卡组');
  await page.getByLabel('YAML 样板名称', { exact: true }).fill('手写 YAML 名称');
  await page.getByLabel('YAML 来源备注', { exact: true }).fill('管理员文件备注');
  await page.getByRole('button', { name: '确认导入 YAML 样板', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: '从 YAML 文件导入样板' })
      .getByText('测试导入失败，请重试', { exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('YAML 样板名称', { exact: true })).toHaveValue('手写 YAML 名称');
  await expect(page.getByRole('table', { name: 'YAML 主卡组预览' })).toBeVisible();
  await page.getByRole('button', { name: '确认导入 YAML 样板', exact: true }).click();
  await expect.poll(() => state.overview.templates.length).toBe(1);
  await expect(page.getByRole('table', { name: 'YAML 主卡组预览' })).toHaveCount(0);
  expect(imports[1]).toMatchObject({
    yamlContent: 'player_name: 测试卡组',
    archetypeId: CLASS,
    name: '手写 YAML 名称',
    sourceNote: '管理员文件备注',
  });
  expect(imports[1]).not.toHaveProperty('cards');
});

test('YAML 文件限制、预览失败重试、重复提示和过期预览', async ({ page }) => {
  await setup(page);
  let previews = 0;
  let releaseOld: () => void = () => {};
  const oldReady = new Promise<void>((resolve) => {
    releaseOld = resolve;
  });
  await page.route('**/templates/preview-yaml', async (route) => {
    previews++;
    const content = route.request().postDataJSON().yamlContent;
    if (content === 'old') {
      await oldReady;
      return reply(route, yamlPreview('过期文件'));
    }
    if (content === 'invalid')
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ data: null, error: { message: 'YAML 格式无效' } }),
      });
    return reply(
      route,
      content === 'duplicate'
        ? {
            ...yamlPreview(),
            existingTemplate: { id: 'existing', name: '已存卡组', enabled: false },
          }
        : yamlPreview('当前文件')
    );
  });
  const upload = (name: string, text: string) =>
    page
      .getByLabel('YAML 卡组文件', { exact: true })
      .setInputFiles({ name, mimeType: 'text/yaml', buffer: Buffer.from(text) });
  await expect(page.getByLabel('YAML 卡组文件', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '导入 YAML', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '导入 YAML', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '导入 YAML', exact: true }).click();
  await upload('large.yaml', 'x'.repeat(65537));
  await expect(
    page.getByText('请选择非空且不超过 64 KB 的 YAML 文件', { exact: true })
  ).toBeVisible();
  expect(previews).toBe(0);
  await upload('bad.yaml', 'invalid');
  await expect(page.getByText('YAML 格式无效', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重试 YAML 预览', exact: true }).click();
  await expect.poll(() => previews).toBe(2);
  await upload('old.yaml', 'old');
  await expect.poll(() => previews).toBe(3);
  await upload('new.yaml', 'new');
  await expect(page.getByLabel('YAML 样板名称', { exact: true })).toHaveValue('当前文件');
  releaseOld();
  await upload('duplicate.yml', 'duplicate');
  await expect(page.getByText(/该构筑已存在于样板“已存卡组”/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: '确认导入 YAML 样板', exact: true })
  ).toBeDisabled();
  await page.getByRole('button', { name: '取消 YAML 导入', exact: true }).click();
});
