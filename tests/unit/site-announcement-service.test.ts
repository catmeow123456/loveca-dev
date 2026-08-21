import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock('../../src/server/services/public-site-status-snapshot-service.js', () => ({
  publicSiteStatusSnapshotService: {
    write: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({
      status: 'SYNCED',
      availability: 'OPEN',
      generatedAt: '2026-07-08T08:00:00.000Z',
      error: null,
    }),
  },
}));

vi.mock('../../src/server/services/readiness-service.js', () => ({
  assertApplicationReady: vi.fn().mockResolvedValue(undefined),
  ApplicationReadinessError: class ApplicationReadinessError extends Error {},
}));

import { pool } from '../../src/server/db/pool';
import { publicSiteStatusSnapshotService } from '../../src/server/services/public-site-status-snapshot-service';
import { assertApplicationReady } from '../../src/server/services/readiness-service';
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

  it('does not infer a normal status when the status database query fails', async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error('relation missing'));

    await expect(
      siteAnnouncementService.getPublicSiteStatus(new Date('2026-07-08T08:00:00.000Z'))
    ).rejects.toThrow('relation missing');
  });

  it('uses database site status config as the authority', async () => {
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
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
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
        maintenanceConfirmed: true,
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
    expect(vi.mocked(pool.query).mock.calls[1]?.[1]).toEqual([
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
    expect(vi.mocked(publicSiteStatusSnapshotService.write)).toHaveBeenCalledTimes(2);
  });

  it('requires an explicit confirmation before entering whole-site maintenance', async () => {
    await expect(
      siteAnnouncementService.updateSiteStatusConfig(
        { lifecycle: 'MAINTENANCE', title: '维护', summary: '暂停访问' },
        '22222222-2222-4222-8222-222222222222'
      )
    ).rejects.toMatchObject({ code: 'MAINTENANCE_CONFIRMATION_REQUIRED', statusCode: 400 });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('checks application readiness before reopening from maintenance', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'default',
            lifecycle: 'MAINTENANCE',
            title: '维护中',
            summary: '暂停访问',
            detail: null,
            starts_at: null,
            estimated_ends_at: null,
            restricts_new_games_at: null,
            impact_scopes: [],
            restrictions: [],
            action: null,
            updated_by: null,
            created_at: new Date('2026-08-21T12:00:00.000Z'),
            updated_at: new Date('2026-08-21T12:00:00.000Z'),
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'default',
            lifecycle: 'NORMAL',
            title: null,
            summary: null,
            detail: null,
            starts_at: null,
            estimated_ends_at: null,
            restricts_new_games_at: null,
            impact_scopes: [],
            restrictions: [],
            action: null,
            updated_by: '22222222-2222-4222-8222-222222222222',
            created_at: new Date('2026-08-21T12:00:00.000Z'),
            updated_at: new Date('2026-08-21T12:30:00.000Z'),
          },
        ],
      } as never);

    await expect(
      siteAnnouncementService.updateSiteStatusConfig(
        { lifecycle: 'NORMAL' },
        '22222222-2222-4222-8222-222222222222'
      )
    ).resolves.toMatchObject({ lifecycle: 'NORMAL', maintenance: null });
    expect(assertApplicationReady).toHaveBeenCalledOnce();
    expect(publicSiteStatusSnapshotService.write).toHaveBeenCalledWith(
      'OPEN',
      null,
      expect.any(Date)
    );
  });

  it('checks application readiness before reopening an offline maintenance snapshot', async () => {
    vi.mocked(publicSiteStatusSnapshotService.inspect).mockResolvedValueOnce({
      status: 'SYNCED',
      availability: 'MAINTENANCE',
      generatedAt: '2026-08-21T12:00:00.000Z',
      error: null,
    });
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'default',
            lifecycle: 'NORMAL',
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
            created_at: new Date('2026-08-21T12:00:00.000Z'),
            updated_at: new Date('2026-08-21T12:00:00.000Z'),
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'default',
            lifecycle: 'NORMAL',
            title: null,
            summary: null,
            detail: null,
            starts_at: null,
            estimated_ends_at: null,
            restricts_new_games_at: null,
            impact_scopes: [],
            restrictions: [],
            action: null,
            updated_by: '22222222-2222-4222-8222-222222222222',
            created_at: new Date('2026-08-21T12:00:00.000Z'),
            updated_at: new Date('2026-08-21T12:30:00.000Z'),
          },
        ],
      } as never);

    await expect(
      siteAnnouncementService.updateSiteStatusConfig(
        { lifecycle: 'NORMAL' },
        '22222222-2222-4222-8222-222222222222'
      )
    ).resolves.toMatchObject({ lifecycle: 'NORMAL', maintenance: null });
    expect(assertApplicationReady).toHaveBeenCalledOnce();
  });

  it('reads player battle entry visibility and defaults a missing config row to visible', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        rows: [{ ranked_entry_visible: false, theme_table_entry_visible: true }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never);

    await expect(siteAnnouncementService.getPlayerBattleEntryVisibility()).resolves.toEqual({
      ranked: false,
      themeTable: true,
    });
    await expect(siteAnnouncementService.getPlayerBattleEntryVisibility()).resolves.toEqual({
      ranked: true,
      themeTable: true,
    });
  });

  it('updates both player battle entry switches without changing season lifecycle state', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ ranked_entry_visible: true, theme_table_entry_visible: false }],
    } as never);

    const visibility = await siteAnnouncementService.updatePlayerBattleEntryVisibility(
      { ranked: true, themeTable: false },
      '22222222-2222-4222-8222-222222222222'
    );

    expect(visibility).toEqual({ ranked: true, themeTable: false });
    expect(vi.mocked(pool.query).mock.calls[0]?.[1]).toEqual([
      true,
      false,
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(vi.mocked(pool.query).mock.calls[0]?.[0]).toContain(
      'ranked_entry_visible = EXCLUDED.ranked_entry_visible'
    );
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
      new Date('2026-07-08T08:30:00.000Z')
    );

    expect(restriction).toMatchObject({
      title: '舞台正在整备',
      summary: '稍后再见，下一场 LIVE 很快开始。',
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
