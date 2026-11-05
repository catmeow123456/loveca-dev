import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }));
vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.query, connect: mocks.connect },
}));
vi.mock('../../src/server/services/public-site-status-snapshot-service.js', () => ({
  publicSiteStatusSnapshotService: {},
}));
vi.mock('../../src/server/services/readiness-service.js', () => ({
  assertApplicationReady: vi.fn(),
  ApplicationReadinessError: class extends Error {},
}));
import { siteAnnouncementService } from '../../src/server/services/site-announcement-service';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.connect.mockResolvedValue(
    Object.assign(new EventEmitter(), { query: mocks.query, release: mocks.release })
  );
});

const row = {
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
  updated_at: new Date(),
  ranked_entry_visible: false,
  theme_table_entry_visible: true,
  player_action_timeout_seconds: 240,
  reconnect_grace_period_seconds: 90,
  double_disconnect_no_contest_window_seconds: 8,
};

describe('public startup config', () => {
  it('reads the singleton once for all three projections and re-reads on the next request', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({ rows: [] });
    const result = await siteAnnouncementService.getPublicStartupConfig();
    expect(result).toMatchObject({
      siteStatus: { lifecycle: 'NORMAL', announcements: [] },
      battleEntries: { ranked: false, themeTable: true },
      battleTimeouts: {
        playerActionTimeoutSeconds: 240,
        reconnectGracePeriodSeconds: 90,
        doubleDisconnectNoContestWindowSeconds: 8,
      },
    });
    expect(
      mocks.query.mock.calls.filter(
        ([sql]) => typeof sql === 'string' && sql.includes('FROM site_status_config')
      )
    ).toHaveLength(1);
    expect(mocks.release).toHaveBeenCalledOnce();
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            ...row,
            lifecycle: 'MAINTENANCE',
            title: '维护',
            summary: '维护中',
            ranked_entry_visible: true,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const changed = await siteAnnouncementService.getPublicStartupConfig();
    expect(changed.siteStatus.lifecycle).toBe('MAINTENANCE');
    expect(changed.battleEntries.ranked).toBe(true);
    expect(
      mocks.query.mock.calls.filter(
        ([sql]) => typeof sql === 'string' && sql.includes('FROM site_status_config')
      )
    ).toHaveLength(2);
  });

  it('retains existing defaults only for an absent row', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await siteAnnouncementService.getPublicStartupConfig()).toMatchObject({
      siteStatus: { lifecycle: 'NORMAL' },
      battleEntries: { ranked: true, themeTable: true },
      battleTimeouts: {
        playerActionTimeoutSeconds: 180,
        reconnectGracePeriodSeconds: 60,
        doubleDisconnectNoContestWindowSeconds: 5,
      },
    });
  });

  it('does not manufacture normal status on a database failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('database unavailable');
    mocks.query.mockRejectedValue(error);
    try {
      await expect(siteAnnouncementService.getPublicStartupConfig()).rejects.toBe(error);
    } finally {
      warn.mockRestore();
    }
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.query).toHaveBeenCalledOnce();
  });
});
