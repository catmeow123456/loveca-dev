import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from '../../src/server/db/pool';
import { siteAnnouncementService } from '../../src/server/services/site-announcement-service';

describe('siteAnnouncementService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns published announcements from the database for public site status', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            type: 'UPDATE',
            title: '3.7.1 更新',
            summary: '对墙打刷新恢复与运行态治理已上线。',
            detail: null,
            starts_at: null,
            ends_at: null,
            priority: 1,
            impact_scopes: ['对墙打'],
            status: 'PUBLISHED',
            published_at: new Date('2026-07-08T00:00:00.000Z'),
            created_by: '22222222-2222-4222-8222-222222222222',
            updated_by: '22222222-2222-4222-8222-222222222222',
            created_at: new Date('2026-07-07T00:00:00.000Z'),
            updated_at: new Date('2026-07-08T00:00:00.000Z'),
          },
        ],
      } as never);

    const status = await siteAnnouncementService.getPublicSiteStatus(
      {
        SITE_STATUS_ANNOUNCEMENTS_JSON: JSON.stringify([
          {
            id: 'env-announcement',
            type: 'NEWS',
            title: '环境变量公告',
            summary: '数据库可用时不展示。',
          },
        ]),
      },
      new Date('2026-07-08T08:00:00.000Z')
    );

    expect(status.announcements).toHaveLength(1);
    expect(status.announcements[0]).toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      type: 'UPDATE',
      title: '3.7.1 更新',
      publishedAt: '2026-07-08T00:00:00.000Z',
      impactScopes: ['对墙打'],
    });
    expect(vi.mocked(pool.query).mock.calls[1]?.[1]).toEqual([
      new Date('2026-07-08T08:00:00.000Z'),
      10,
    ]);
  });

  it('falls back to env announcements when the database query fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(pool.query)
      .mockRejectedValueOnce(new Error('relation missing'))
      .mockRejectedValueOnce(new Error('relation missing'));

    const status = await siteAnnouncementService.getPublicSiteStatus(
      {
        SITE_STATUS_ANNOUNCEMENTS_JSON: JSON.stringify([
          {
            id: 'env-announcement',
            type: 'MAINTENANCE',
            title: '维护公告',
            summary: '数据库不可用时使用环境变量兜底。',
            priority: 3,
          },
        ]),
      },
      new Date('2026-07-08T08:00:00.000Z')
    );

    expect(status.announcements.map((announcement) => announcement.id)).toEqual([
      'env-announcement',
    ]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('uses database site status config ahead of environment status', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [
        {
          id: 'default',
          lifecycle: 'MAINTENANCE',
          title: '后台维护',
          summary: '后台开关已限制新对局。',
          detail: '管理员在平台配置中开启。',
          starts_at: new Date('2026-07-08T13:00:00.000Z'),
          estimated_ends_at: new Date('2026-07-08T14:00:00.000Z'),
          restricts_new_games_at: new Date('2026-07-08T13:00:00.000Z'),
          impact_scopes: ['正式联机', '对墙打'],
          restrictions: ['限制新对局'],
          action: '请稍后再开始对局',
          updated_by: '22222222-2222-4222-8222-222222222222',
          created_at: new Date('2026-07-08T08:00:00.000Z'),
          updated_at: new Date('2026-07-08T08:30:00.000Z'),
        },
      ],
    } as never);

    const status = await siteAnnouncementService.getConfiguredSiteStatus(
      {
        SITE_STATUS_LIFECYCLE: 'NORMAL',
      },
      new Date('2026-07-08T08:45:00.000Z')
    );

    expect(status.lifecycle).toBe('MAINTENANCE');
    expect(status.maintenance).toMatchObject({
      title: '后台维护',
      summary: '后台开关已限制新对局。',
      impactScopes: ['正式联机', '对墙打'],
      restrictions: ['限制新对局'],
      updatedAt: '2026-07-08T08:30:00.000Z',
    });
  });

  it('updates the database maintenance switch and returns public site status', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [
        {
          id: 'default',
          lifecycle: 'MAINTENANCE',
          title: '今晚维护',
          summary: '维护期间限制新对局。',
          detail: null,
          starts_at: new Date('2026-07-08T13:00:00.000Z'),
          estimated_ends_at: new Date('2026-07-08T14:00:00.000Z'),
          restricts_new_games_at: null,
          impact_scopes: ['正式联机'],
          restrictions: ['限制新对局'],
          action: '请稍后再开始对局',
          updated_by: '22222222-2222-4222-8222-222222222222',
          created_at: new Date('2026-07-08T08:00:00.000Z'),
          updated_at: new Date('2026-07-08T08:30:00.000Z'),
        },
      ],
    } as never);

    const status = await siteAnnouncementService.updateSiteStatusConfig(
      {
        lifecycle: 'MAINTENANCE',
        title: ' 今晚维护 ',
        summary: '维护期间限制新对局。',
        startsAt: '2026-07-08T13:00:00.000Z',
        estimatedEndsAt: '2026-07-08T14:00:00.000Z',
        impactScopes: ['正式联机'],
        restrictions: ['限制新对局'],
        action: '请稍后再开始对局',
      },
      '22222222-2222-4222-8222-222222222222',
      new Date('2026-07-08T08:45:00.000Z')
    );

    expect(status.lifecycle).toBe('MAINTENANCE');
    expect(status.maintenance?.title).toBe('今晚维护');
    expect(vi.mocked(pool.query).mock.calls[0]?.[1]).toEqual([
      'MAINTENANCE',
      '今晚维护',
      '维护期间限制新对局。',
      null,
      new Date('2026-07-08T13:00:00.000Z'),
      new Date('2026-07-08T14:00:00.000Z'),
      null,
      JSON.stringify(['正式联机']),
      JSON.stringify(['限制新对局']),
      '请稍后再开始对局',
      '22222222-2222-4222-8222-222222222222',
    ]);
  });

  it('returns a gameplay restriction while maintenance is enabled', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [
        {
          id: 'default',
          lifecycle: 'MAINTENANCE',
          title: null,
          summary: null,
          detail: null,
          starts_at: null,
          estimated_ends_at: null,
          restricts_new_games_at: null,
          impact_scopes: [],
          restrictions: [],
          action: null,
          updated_by: null,
          created_at: new Date('2026-07-08T08:00:00.000Z'),
          updated_at: new Date('2026-07-08T08:00:00.000Z'),
        },
      ],
    } as never);

    const restriction = await siteAnnouncementService.getGameplayRestriction(
      {},
      new Date('2026-07-08T08:30:00.000Z')
    );

    expect(restriction).toMatchObject({
      title: '维护中',
      summary: '服务正在维护，暂时限制新的对局。',
    });
  });

  it('creates and publishes a maintenance announcement in one admin action', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          type: 'MAINTENANCE',
          title: '今晚维护',
          summary: '19:00 起进行短维护。',
          detail: '维护期间暂停新开正式联机。',
          starts_at: new Date('2026-07-08T11:00:00.000Z'),
          ends_at: new Date('2026-07-08T11:20:00.000Z'),
          priority: 5,
          impact_scopes: ['正式联机'],
          status: 'PUBLISHED',
          published_at: new Date('2026-07-08T08:00:00.000Z'),
          created_by: '22222222-2222-4222-8222-222222222222',
          updated_by: '22222222-2222-4222-8222-222222222222',
          created_at: new Date('2026-07-08T08:00:00.000Z'),
          updated_at: new Date('2026-07-08T08:00:00.000Z'),
        },
      ],
    } as never);

    const created = await siteAnnouncementService.createAnnouncement(
      {
        type: 'MAINTENANCE',
        title: ' 今晚维护 ',
        summary: '19:00 起进行短维护。',
        detail: '维护期间暂停新开正式联机。',
        startsAt: '2026-07-08T11:00:00.000Z',
        endsAt: '2026-07-08T11:20:00.000Z',
        priority: 5,
        impactScopes: ['正式联机'],
        publish: true,
      },
      '22222222-2222-4222-8222-222222222222',
      new Date('2026-07-08T08:00:00.000Z')
    );

    expect(created).toMatchObject({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'PUBLISHED',
      title: '今晚维护',
      publishedAt: '2026-07-08T08:00:00.000Z',
    });
    expect(vi.mocked(pool.query).mock.calls[0]?.[1]).toEqual([
      'MAINTENANCE',
      '今晚维护',
      '19:00 起进行短维护。',
      '维护期间暂停新开正式联机。',
      new Date('2026-07-08T11:00:00.000Z'),
      new Date('2026-07-08T11:20:00.000Z'),
      5,
      JSON.stringify(['正式联机']),
      'PUBLISHED',
      new Date('2026-07-08T08:00:00.000Z'),
      '22222222-2222-4222-8222-222222222222',
      '22222222-2222-4222-8222-222222222222',
    ]);
  });
});
