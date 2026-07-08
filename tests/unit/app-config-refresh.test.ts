import { describe, expect, it } from 'vitest';
import {
  buildAnnouncementUnreadKey,
  buildPublicAppConfigRenderKey,
  type PublicAppConfig,
} from '../../client/src/lib/appConfig';
import {
  getPublicConfigRefreshDelay,
  shouldRunFocusPublicConfigRefresh,
} from '../../client/src/lib/publicConfigRefresh';

function createConfig(overrides: Partial<PublicAppConfig> = {}): PublicAppConfig {
  return {
    features: {
      email: {
        enabled: false,
        verificationRequired: false,
        passwordResetEnabled: false,
      },
    },
    siteStatus: {
      lifecycle: 'MAINTENANCE',
      generatedAt: '2026-07-08T08:00:00.000Z',
      maintenance: {
        id: 'maintenance-1',
        title: '今晚维护',
        summary: '维护期间限制新对局。',
        detail: '将更新平台配置。',
        startsAt: '2026-07-08T13:00:00.000Z',
        estimatedEndsAt: '2026-07-08T14:00:00.000Z',
        restrictsNewGamesAt: '2026-07-08T12:50:00.000Z',
        impactScopes: ['正式联机'],
        restrictions: ['限制新对局'],
        action: '请稍后再开始对局',
        updatedAt: '2026-07-08T08:00:00.000Z',
      },
      announcements: [
        {
          id: 'announcement-1',
          type: 'UPDATE',
          title: '更新公告',
          summary: '首页公告已更新。',
          detail: '普通用户会自动看到新公告。',
          publishedAt: '2026-07-08T08:05:00.000Z',
          startsAt: null,
          endsAt: null,
          priority: 10,
          impactScopes: ['首页'],
        },
      ],
    },
    ...overrides,
  };
}

describe('public app config refresh fingerprints', () => {
  it('ignores generatedAt when deciding whether App should re-render public config', () => {
    const first = createConfig();
    const second = {
      ...first,
      siteStatus: {
        ...first.siteStatus,
        generatedAt: '2026-07-08T08:01:00.000Z',
      },
    };

    expect(buildPublicAppConfigRenderKey(first)).toBe(buildPublicAppConfigRenderKey(second));
  });

  it('tracks visible announcement and maintenance fields in unread fingerprint', () => {
    const first = createConfig();
    const second = {
      ...first,
      siteStatus: {
        ...first.siteStatus,
        maintenance: first.siteStatus.maintenance
          ? {
              ...first.siteStatus.maintenance,
              restrictions: ['限制新对局', '限制重开请求'],
              action: '请等待维护完成后再创建房间',
            }
          : null,
        announcements: first.siteStatus.announcements.map((announcement) => ({
          ...announcement,
          detail: '公告详情已更新。',
          impactScopes: ['首页', '公告栏'],
        })),
      },
    };

    expect(buildAnnouncementUnreadKey(first.siteStatus)).not.toBe(
      buildAnnouncementUnreadKey(second.siteStatus)
    );
  });

  it('lets priority change update render order without forcing a new unread key', () => {
    const first = createConfig();
    const second = {
      ...first,
      siteStatus: {
        ...first.siteStatus,
        announcements: first.siteStatus.announcements.map((announcement) => ({
          ...announcement,
          priority: announcement.priority + 1,
        })),
      },
    };

    expect(buildPublicAppConfigRenderKey(first)).not.toBe(buildPublicAppConfigRenderKey(second));
    expect(buildAnnouncementUnreadKey(first.siteStatus)).toBe(
      buildAnnouncementUnreadKey(second.siteStatus)
    );
  });

  it('keeps the unread key stable when priority-only changes reorder announcements', () => {
    const first = createConfig({
      siteStatus: {
        ...createConfig().siteStatus,
        announcements: [
          {
            id: 'announcement-low',
            type: 'UPDATE',
            title: '低优先级公告',
            summary: '内容不变。',
            detail: null,
            publishedAt: '2026-07-08T08:00:00.000Z',
            startsAt: null,
            endsAt: null,
            priority: 1,
            impactScopes: ['首页'],
          },
          {
            id: 'announcement-high',
            type: 'NEWS',
            title: '高优先级公告',
            summary: '内容不变。',
            detail: null,
            publishedAt: '2026-07-08T08:05:00.000Z',
            startsAt: null,
            endsAt: null,
            priority: 10,
            impactScopes: ['首页'],
          },
        ],
      },
    });
    const second = {
      ...first,
      siteStatus: {
        ...first.siteStatus,
        announcements: first.siteStatus.announcements.map((announcement) =>
          announcement.id === 'announcement-low'
            ? { ...announcement, priority: 20 }
            : { ...announcement, priority: 1 }
        ),
      },
    };

    expect(buildPublicAppConfigRenderKey(first)).not.toBe(buildPublicAppConfigRenderKey(second));
    expect(buildAnnouncementUnreadKey(first.siteStatus)).toBe(
      buildAnnouncementUnreadKey(second.siteStatus)
    );
  });

  it('does not create an unread key when there is nothing to show', () => {
    expect(
      buildAnnouncementUnreadKey({
        lifecycle: 'NORMAL',
        generatedAt: '2026-07-08T08:00:00.000Z',
        maintenance: null,
        announcements: [],
      })
    ).toBeNull();
  });
});

describe('public app config refresh timing', () => {
  it('adds bounded jitter and failure backoff to periodic refresh delay', () => {
    expect(
      getPublicConfigRefreshDelay(0, () => 0.5, {
        intervalMs: 60_000,
        jitterMs: 5_000,
        failureBackoffStepMs: 30_000,
        maxFailureBackoffMs: 300_000,
      })
    ).toBe(62_500);
    expect(
      getPublicConfigRefreshDelay(20, () => 0, {
        intervalMs: 60_000,
        jitterMs: 5_000,
        failureBackoffStepMs: 30_000,
        maxFailureBackoffMs: 300_000,
      })
    ).toBe(360_000);
  });

  it('throttles focus-triggered refreshes', () => {
    expect(shouldRunFocusPublicConfigRefresh(null, 1_000, 15_000)).toBe(true);
    expect(shouldRunFocusPublicConfigRefresh(1_000, 10_000, 15_000)).toBe(false);
    expect(shouldRunFocusPublicConfigRefresh(1_000, 16_000, 15_000)).toBe(true);
  });
});
