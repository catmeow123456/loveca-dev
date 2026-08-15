import { describe, expect, it, vi } from 'vitest';
import { ThemeTableAdminService } from '../../src/server/services/theme-table-admin-service';

const NOW = new Date('2026-08-02T12:00:00.000Z');
const THEME = {
  id: '11111111-1111-4111-8111-111111111111',
  version_key: 'summer-discovery-1',
  name: '夏日发现局',
  lifecycle: 'DRAFT',
  environment_id: 'sha256:environment',
  rules_environment_id: 'LOVECABATTLE_RULES_V1',
  card_catalog_hash: 'sha256:catalog',
  allocation_algorithm_version: 'THEME_WEIGHTED_PAIR_V1',
  platform_time_zone: 'Asia/Shanghai',
  open_windows: [{ weekdays: [7], startMinute: 0, endMinute: 1440 }],
  starts_at: new Date('2026-08-01T00:00:00.000Z'),
  ends_at: new Date('2026-08-20T00:00:00.000Z'),
  schedule_label: '周日全天',
  summary: '测试不同体系',
  announcement: '非计分',
  evaluation_policy: {
    minimumCompletedMatchesPerPair: 20,
    minimumCompletionRate: 0.8,
    maximumExceptionRate: 0.05,
    maximumExposureDeviation: 0.1,
    maximumMedianWaitSeconds: 180,
    winRateLowerBound: 0.35,
    winRateUpperBound: 0.65,
    baselineWindowLabel: '前两周同窗口',
  },
} as const;

describe('ThemeTableAdminService', () => {
  it('copies an owned cloud deck and automatically pairs it with the existing season pool', async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      if (text.includes('SELECT * FROM theme_table_versions')) {
        return { rows: [THEME], rowCount: 1 };
      }
      if (text.includes('INSERT INTO theme_prebuilt_deck_versions')) {
        return {
          rows: [
            {
              id: 'deck-version-1',
              deck_key: 'liella-tempo',
              display_name: 'Liella! 节奏',
              deck_list: {
                mainDeck: [{ cardCode: 'MEMBER-1', count: 2 }],
                energyDeck: [{ cardCode: 'ENERGY-1', count: 1 }],
              },
              content_hash: 'sha256:deck',
              play_style_tags: ['节奏'],
              difficulty: 'INTERMEDIATE',
              source_label: '内部试打',
              source_url: null,
              review_note: '双向完成',
              approved_at: NOW,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const loadDeck = vi.fn(async () => ({
      deckId: 'cloud-deck-1',
      deckName: '来源卡组',
      runtimeDeck: {
        mainDeck: [{ cardCode: 'MEMBER-1' }, { cardCode: 'MEMBER-1' }],
        energyDeck: [{ cardCode: 'ENERGY-1' }],
      },
    }));
    const service = new ThemeTableAdminService({
      query,
      now: () => NOW,
      createId: () => 'deck-version-1',
      loadDeck: loadDeck as never,
    });

    await service.addDeck('admin-1', THEME.id, {
      sourceDeckId: 'cloud-deck-1',
      deckKey: 'liella-tempo',
      displayName: 'Liella! 节奏',
      playStyleTags: ['节奏'],
      difficulty: 'INTERMEDIATE',
      sourceLabel: '内部试打',
      reviewNote: '双向完成',
    });

    expect(loadDeck).toHaveBeenCalledWith('admin-1', 'cloud-deck-1');
    const insert = calls.find((call) =>
      call.text.includes('INSERT INTO theme_prebuilt_deck_versions')
    );
    expect(JSON.parse(String(insert?.values?.[5]))).toEqual({
      mainDeck: [{ cardCode: 'MEMBER-1', count: 2 }],
      energyDeck: [{ cardCode: 'ENERGY-1', count: 1 }],
    });
    expect(insert?.values?.[6]).toMatch(/^[a-f0-9]{64}$/);
    expect(insert?.text).toContain('inserted_matchups AS');
    expect(insert?.text).toContain("jsonb_build_object('summary', '随卡组池自动启用')");
    expect(insert?.text).toContain('ON CONFLICT');
  });

  it('refuses publication until two decks and one enabled tested matchup exist', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('SELECT * FROM theme_table_versions')) {
        return { rows: [THEME], rowCount: 1 };
      }
      if (text.includes('deck_count')) {
        return { rows: [{ deck_count: '1', matchup_count: '0' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const service = new ThemeTableAdminService({
      query,
      now: () => NOW,
      getCatalog: vi.fn(async () => ({
        cardCatalogVersion: 'PUBLISHED_RUNTIME_CARD_CATALOG_V1',
        cardCatalogHash: 'sha256:catalog',
        publishedCardCount: 2000,
      })),
    });

    await expect(service.runLifecycleAction('admin-1', THEME.id, 'ACTIVATE')).rejects.toMatchObject(
      {
        code: 'THEME_DECK_POOL_INCOMPLETE',
      }
    );
    expect(
      query.mock.calls.some(([text]) => String(text).includes("SET lifecycle = 'ACTIVE'"))
    ).toBe(false);
  });

  it('canonicalizes matchup deck order so A×B and B×A share one database identity', async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      if (text.includes('SELECT * FROM theme_table_versions')) {
        return { rows: [THEME], rowCount: 1 };
      }
      return {
        rows: [
          {
            id: 'pair-1',
            first_deck_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            first_deck_name: '甲组',
            second_deck_version_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            second_deck_name: '乙组',
            weight: 1,
            enabled: true,
            test_summary: { summary: '双向完成' },
            approved_at: NOW,
          },
        ],
        rowCount: 1,
      };
    });
    const service = new ThemeTableAdminService({ query, now: () => NOW });

    await service.addMatchup('admin-1', THEME.id, {
      firstDeckVersionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      secondDeckVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      weight: 1,
      testSummary: { summary: '双向完成' },
    });

    const insert = calls.find((call) =>
      call.text.includes('INSERT INTO theme_matchup_pair_versions')
    );
    expect(insert?.values?.[2]).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(insert?.values?.[3]).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('disables a matchup and pauses an active event in one database statement when the pool empties', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('SELECT * FROM theme_table_versions')) {
        return { rows: [{ ...THEME, lifecycle: 'ACTIVE' }], rowCount: 1 };
      }
      if (text.includes('WITH updated_pair AS')) {
        return {
          rows: [
            {
              id: 'pair-1',
              first_deck_version_id: 'deck-1',
              first_deck_name: '甲组',
              second_deck_version_id: 'deck-2',
              second_deck_name: '乙组',
              weight: 1,
              enabled: false,
              test_summary: { summary: '已试打' },
              approved_at: NOW,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const service = new ThemeTableAdminService({ query, now: () => NOW });

    await service.setMatchupEnabled('admin-1', THEME.id, 'pair-1', false);

    const mutation = query.mock.calls.find(([text]) =>
      String(text).includes('WITH updated_pair AS')
    );
    expect(String(mutation?.[0])).toContain('paused_theme AS');
    expect(String(mutation?.[0])).toContain("theme.lifecycle = 'ACTIVE'");
    expect(query).toHaveBeenCalledTimes(2);
  });
});
