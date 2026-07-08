import { describe, expect, it } from 'vitest';
import { buildPublicSiteStatusFromEnv } from '../../src/server/site-status';

describe('buildPublicSiteStatusFromEnv', () => {
  it('returns a normal empty status when no site status env is configured', () => {
    const status = buildPublicSiteStatusFromEnv({}, new Date('2026-07-08T00:00:00.000Z'));

    expect(status).toEqual({
      lifecycle: 'NORMAL',
      generatedAt: '2026-07-08T00:00:00.000Z',
      maintenance: null,
      announcements: [],
    });
  });

  it('builds a scheduled maintenance status from explicit env values', () => {
    const status = buildPublicSiteStatusFromEnv(
      {
        SITE_STATUS_LIFECYCLE: 'scheduled',
        SITE_STATUS_TITLE: '今晚维护',
        SITE_STATUS_SUMMARY: '2026-07-08 19:00 UTC+8 进行 3.7.1 更新。',
        SITE_STATUS_DETAIL: '维护前 30 分钟暂停新开正式联机。',
        SITE_STATUS_START_AT: '2026-07-08T11:00:00.000Z',
        SITE_STATUS_END_AT: '2026-07-08T11:10:00.000Z',
        SITE_STATUS_RESTRICT_NEW_GAMES_AT: '2026-07-08T10:30:00.000Z',
        SITE_STATUS_IMPACT_SCOPES: '正式联机, 对墙打, 历史回放',
        SITE_STATUS_RESTRICTIONS: '限制正式联机新开局',
        SITE_STATUS_ACTION: '建议进行中对局尽快收束',
      },
      new Date('2026-07-08T08:00:00.000Z')
    );

    expect(status.lifecycle).toBe('SCHEDULED');
    expect(status.maintenance).toMatchObject({
      title: '今晚维护',
      summary: '2026-07-08 19:00 UTC+8 进行 3.7.1 更新。',
      startsAt: '2026-07-08T11:00:00.000Z',
      estimatedEndsAt: '2026-07-08T11:10:00.000Z',
      restrictsNewGamesAt: '2026-07-08T10:30:00.000Z',
      impactScopes: ['正式联机', '对墙打', '历史回放'],
      restrictions: ['限制正式联机新开局'],
      action: '建议进行中对局尽快收束',
    });
  });

  it('normalizes announcement JSON and keeps the newest high priority items first', () => {
    const status = buildPublicSiteStatusFromEnv(
      {
        SITE_STATUS_ANNOUNCEMENTS_JSON: JSON.stringify([
          {
            id: 'older',
            type: 'NEWS',
            title: '活动动态',
            summary: '新增一条站点动态。',
            publishedAt: '2026-07-01T00:00:00.000Z',
            priority: 1,
          },
          {
            id: 'release',
            type: 'UPDATE',
            title: '3.7.1 更新',
            summary: '对墙打刷新恢复与运行态治理已上线。',
            publishedAt: '2026-07-08T00:00:00.000Z',
            priority: 2,
          },
          {
            title: '',
            summary: '缺标题会被忽略。',
          },
        ]),
      },
      new Date('2026-07-08T08:00:00.000Z')
    );

    expect(status.announcements.map((announcement) => announcement.id)).toEqual([
      'release',
      'older',
    ]);
  });

  it('ignores unknown announcement types', () => {
    const status = buildPublicSiteStatusFromEnv(
      {
        SITE_STATUS_ANNOUNCEMENTS_JSON: JSON.stringify([
          {
            id: 'invalid-type',
            type: 'INVALID_TYPE',
            title: '非法类型公告',
            summary: '非法类型会被忽略。',
          },
          {
            id: 'valid-update',
            type: 'UPDATE',
            title: '更新公告',
            summary: '新类型会被保留。',
          },
        ]),
      },
      new Date('2026-07-08T08:00:00.000Z')
    );

    expect(status.announcements.map((announcement) => announcement.id)).toEqual(['valid-update']);
  });

  it('ignores malformed announcement JSON without breaking public config', () => {
    const status = buildPublicSiteStatusFromEnv(
      {
        SITE_STATUS_ANNOUNCEMENTS_JSON: '{not json',
      },
      new Date('2026-07-08T08:00:00.000Z')
    );

    expect(status.lifecycle).toBe('NORMAL');
    expect(status.announcements).toEqual([]);
  });
});
