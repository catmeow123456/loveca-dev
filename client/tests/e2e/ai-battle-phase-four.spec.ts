import { expect, test, type Page, type Route } from '@playwright/test';

const MATCH_ID = 'phase-four-ui-e2e';
const NOW = 1_785_408_000_000;

function createSnapshot(ended: boolean) {
  return {
    matchId: MATCH_ID,
    seat: 'FIRST',
    playerId: 'human-player',
    seq: ended ? 8 : 7,
    currentPublicSeq: 0,
    playerViewState: {
      match: {
        matchId: MATCH_ID,
        viewerSeat: 'FIRST',
        participants: {
          FIRST: {
            id: 'human-player',
            name: 'Phase 4 验收玩家',
            participantKind: 'USER',
          },
          SECOND: {
            id: 'system-player',
            name: 'Loveca AI',
            participantKind: 'SYSTEM',
          },
        },
        turnCount: 3,
        phase: ended ? 'GAME_END' : 'MAIN_PHASE',
        subPhase: 'NONE',
        firstSeat: 'FIRST',
        activeSeat: 'FIRST',
        prioritySeat: ended ? null : 'FIRST',
        window: null,
        liveResult: {
          scores: { FIRST: 0, SECOND: 0 },
          scoreModifiers: { FIRST: 0, SECOND: 0 },
          heartBonuses: { FIRST: [], SECOND: [] },
          cheerHeartColorReplacements: { FIRST: null, SECOND: null },
          requirementReductions: {},
          requirementModifiers: {},
          liveCardScoreModifiers: {},
          winnerSeats: [],
          confirmedSeats: [],
          successLiveSelection: null,
        },
        endInfo: ended
          ? {
              reason: 'SYSTEM_LIVENESS_CONCEDE',
              winnerSeat: 'FIRST',
              loserSeat: 'SECOND',
            }
          : null,
        manualOperation: {
          mode: 'RULES',
          canSwitchNow: false,
          disabledReason: 'AI 对战固定使用规则模式',
          pendingRequest: null,
        },
        seq: ended ? 8 : 7,
      },
      table: { zones: {} },
      objects: {},
      permissions: { availableCommands: [] },
      activeEffect: null,
      pendingCostPayment: null,
      uiHints: { gameMode: 'DEBUG' },
    },
  };
}

function createBattleView(ended: boolean) {
  return {
    schemaVersion: 'ai-battle.phase-four-entry/v1',
    matchId: MATCH_ID,
    roomCode: 'AI-E2E',
    humanSeat: 'FIRST',
    systemSeat: 'SECOND',
    humanDeckKey: 'MUSE_STARTER',
    aiDeckKey: 'GREEN_HASUNOSORA_B6',
    snapshot: createSnapshot(ended),
  };
}

async function fulfill(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data, error: null }),
  });
}

async function installMocks(page: Page, ended: boolean) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === '/api/config') {
      await fulfill(route, {
        features: {
          email: {
            enabled: false,
            verificationRequired: false,
            passwordResetEnabled: false,
          },
        },
      });
      return;
    }
    if (url.pathname === '/api/auth/refresh') {
      await fulfill(route, {
        accessToken: 'phase-four-e2e-token',
        user: {
          id: 'human-player',
          email: 'phase-four-e2e@example.test',
          emailVerified: true,
        },
        profile: {
          id: 'phase-four-e2e-profile',
          username: 'phase_four_e2e',
          display_name: 'Phase 4 验收玩家',
          avatar_url: null,
          role: 'user',
          deck_count: 1,
          created_at: new Date(NOW).toISOString(),
          updated_at: new Date(NOW).toISOString(),
        },
      });
      return;
    }
    if (url.pathname === '/api/cards' || url.pathname === '/api/cards/export') {
      await fulfill(route, []);
      return;
    }
    if (url.pathname === '/api/online/ai-battles/current') {
      await fulfill(route, createBattleView(ended));
      return;
    }
    if (url.pathname === `/api/online/ai-battles/${MATCH_ID}`) {
      await fulfill(route, createBattleView(ended));
      return;
    }
    if (url.pathname === `/api/online/ai-battles/${MATCH_ID}/restart`) {
      await fulfill(route, createBattleView(false));
      return;
    }
    if (url.pathname === `/api/online/matches/${MATCH_ID}/snapshot`) {
      await fulfill(route, createSnapshot(ended));
      return;
    }
    if (url.pathname === `/api/online/matches/${MATCH_ID}/public-events`) {
      await fulfill(route, {
        matchId: MATCH_ID,
        currentPublicSeq: 0,
        publicEvents: [],
      });
      return;
    }
    if (url.pathname === `/api/online/matches/${MATCH_ID}/chat/messages`) {
      await fulfill(route, {
        matchId: MATCH_ID,
        messages: [
          {
            messageType: 'SYSTEM_NOTICE',
            messageSeq: 1,
            noticeCode: 'AI_FALLBACK_ENABLED',
            text: 'AI 模型暂时不可用，已切换为保守策略继续本局。',
            sentAt: NOW,
          },
        ],
        currentSeq: 1,
        nextAfterSeq: 1,
        oldestAvailableSeq: 1,
        truncated: false,
        hasMore: false,
      });
      return;
    }

    await fulfill(route, null);
  });
}

test.describe('Phase 4 AI battle UI', () => {
  test('shared board exposes the system fallback notice on desktop and mobile', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '页面级验收只需执行一次');
    await installMocks(page, false);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');

    await expect(page.getByText('AI 对战提示')).toBeVisible();
    await page.getByRole('button', { name: '关闭玩前须知' }).click();
    await expect(page.getByRole('button', { name: '局内聊天' })).toBeVisible();
    await page.getByRole('button', { name: '局内聊天' }).click();
    await expect(page.getByText('AI 模型暂时不可用，已切换为保守策略继续本局。')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: '局内聊天' })).toBeVisible();
    const viewport = await page.locator('html').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
  });

  test('end panel explains liveness win and offers both next actions', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'tablet-1024x768', '页面级验收只需执行一次');
    await installMocks(page, true);
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('/');

    await expect(page.getByRole('dialog', { name: '本局获胜' })).toBeVisible();
    await expect(
      page.getByText('AI 长时间无法让牌局继续推进，已按活性保护规则认输。')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '返回 AI 对战' })).toBeVisible();
    await page.getByRole('button', { name: '同配置再来一局' }).click();
    await expect(page.getByRole('dialog', { name: '本局获胜' })).toHaveCount(0);
    await expect(page.getByText('AI 对战提示')).toBeVisible();
  });
});
