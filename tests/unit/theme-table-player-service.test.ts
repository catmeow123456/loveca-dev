import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  publicJoin: vi.fn(),
  publicGetStatus: vi.fn(),
  getCatalog: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({ pool: { query: mocks.poolQuery } }));
vi.mock('../../src/server/services/public-table-service.js', () => ({
  PublicTableServiceError: class PublicTableServiceError extends Error {},
  publicTableService: {
    join: mocks.publicJoin,
    getStatus: mocks.publicGetStatus,
    heartbeat: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    expireWaitingTickets: vi.fn(),
  },
}));
vi.mock('../../src/server/rating/ranked-environment.js', () => ({
  getCurrentRankedCardCatalogIdentity: mocks.getCatalog,
}));

import { ThemeTablePlayerService } from '../../src/server/services/theme-table-player-service';

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const THEME = {
  id: '11111111-1111-4111-8111-111111111111',
  version_key: 'summer-discovery-1',
  name: '夏日发现局',
  lifecycle: 'ACTIVE',
  environment_id: 'THEME_SUMMER_V1',
  rules_environment_id: 'LOVECABATTLE_RULES_V1',
  card_catalog_hash: 'sha256:catalog',
  allocation_algorithm_version: 'THEME_WEIGHTED_PAIR_V1',
  platform_time_zone: 'Asia/Shanghai',
  open_windows: [{ weekdays: [7], startMinute: 0, endMinute: 1440 }],
  starts_at: new Date('2026-08-01T00:00:00.000Z'),
  ends_at: new Date('2026-08-03T00:00:00.000Z'),
  schedule_label: '周日 00:00–24:00',
  summary: '测试不同体系',
  announcement: '非计分',
};

describe('ThemeTablePlayerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCatalog.mockResolvedValue({ cardCatalogHash: 'sha256:catalog' });
    mocks.publicJoin.mockResolvedValue({ state: 'WAITING' });
    mocks.publicGetStatus.mockResolvedValue({ state: 'IDLE' });
    mocks.poolQuery.mockImplementation(async (text: string) => {
      if (text.includes("lifecycle IN ('ACTIVE', 'PAUSED')")) return { rows: [THEME] };
      if (text.includes('AS completed_matches')) {
        return { rows: [{ completed_matches: '6', wins: '3', losses: '2', draws: '1' }] };
      }
      if (text.includes('COUNT(*)::text')) return { rows: [{ count: '2' }] };
      return { rows: [] };
    });
  });

  it('joins the independent theme queue without a personal deck during an open window', async () => {
    const service = new ThemeTablePlayerService(() => NOW);

    await expect(service.join('user-1')).resolves.toEqual({ state: 'WAITING' });

    expect(mocks.publicJoin).toHaveBeenCalledWith('user-1', null, 'DIRECT', {
      queueKind: 'THEME',
      participationKind: 'THEME_QUEUE',
      environmentId: 'THEME_SUMMER_V1',
      seasonId: null,
      themeTableVersionId: THEME.id,
    });
  });

  it('prefers the active theme over newer paused versions', async () => {
    const service = new ThemeTablePlayerService(() => NOW);

    await service.getOverview('user-1');

    const visibleThemeQuery = mocks.poolQuery.mock.calls.find(([text]) =>
      String(text).includes("lifecycle IN ('ACTIVE', 'PAUSED')")
    );
    expect(String(visibleThemeQuery?.[0])).toContain(
      "ORDER BY CASE lifecycle WHEN 'ACTIVE' THEN 0 ELSE 1 END, starts_at DESC"
    );
  });

  it('returns the current theme season win-loss record without creating a rating projection', async () => {
    const service = new ThemeTablePlayerService(() => NOW);

    const overview = await service.getOverview('user-1');

    expect(overview.player).toEqual({
      completedMatches: 6,
      wins: 3,
      losses: 2,
      draws: 1,
      winRate: 0.5,
    });
    expect(mocks.poolQuery).toHaveBeenCalledWith(
      expect.stringMatching(
        /record\.status IN \('COMPLETED', 'SURRENDERED'\)[\s\S]+FROM theme_table_assignments/
      ),
      [THEME.id, 'user-1']
    );
  });

  it('fails closed when the published card catalog no longer matches the frozen event', async () => {
    mocks.getCatalog.mockResolvedValue({ cardCatalogHash: 'sha256:new-catalog' });
    const service = new ThemeTablePlayerService(() => NOW);

    await expect(service.join('user-1')).rejects.toMatchObject({
      code: 'THEME_TABLE_CLOSED',
      message: '当前规则或卡牌目录与本期冻结版本不一致',
    });
    expect(mocks.publicJoin).not.toHaveBeenCalled();
  });

  it('does not admit players outside the frozen weekly window', async () => {
    mocks.poolQuery.mockImplementation(async (text: string) => {
      if (text.includes("lifecycle IN ('ACTIVE', 'PAUSED')")) {
        return {
          rows: [{ ...THEME, open_windows: [{ weekdays: [1], startMinute: 0, endMinute: 60 }] }],
        };
      }
      if (text.includes('COUNT(*)::text')) return { rows: [{ count: '2' }] };
      return { rows: [] };
    });
    const service = new ThemeTablePlayerService(() => NOW);

    await expect(service.join('user-1')).rejects.toMatchObject({
      code: 'THEME_TABLE_CLOSED',
      message: '当前不在本期开放时段',
    });
  });
});
