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
  it('updates player-facing operations after a theme season has started', async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const query = vi.fn((text: string, values?: readonly unknown[]) => {
      calls.push({ text, values });
      if (text.includes('UPDATE theme_table_versions')) {
        return Promise.resolve({
          rows: [
            {
              ...THEME,
              lifecycle: 'ACTIVE',
              name: '盛夏发现局',
              starts_at: new Date('2026-08-09T00:00:00.000Z'),
              ends_at: new Date('2026-08-30T00:00:00.000Z'),
            },
          ],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const service = new ThemeTableAdminService({ query, now: () => NOW });

    const updated = await service.updateOperations('admin-1', THEME.id, {
      name: ' 盛夏发现局 ',
      openWindows: [{ weekdays: [6, 7], startMinute: 1080, endMinute: 1380 }],
      startsAt: new Date('2026-08-09T00:00:00.000Z'),
      endsAt: new Date('2026-08-30T00:00:00.000Z'),
      scheduleLabel: '周末 18:00–23:00',
      summary: '调整后的玩家说明',
      announcement: '不计入排位，确认后随机分配预组。',
    });

    expect(updated.name).toBe('盛夏发现局');
    const mutation = calls.find((call) => call.text.includes('UPDATE theme_table_versions'));
    expect(mutation?.text).toContain("lifecycle IN ('ACTIVE', 'PAUSED')");
    expect(mutation?.text).not.toContain('evaluation_policy');
    expect(mutation?.values?.[1]).toBe('盛夏发现局');
  });

  it('adds an owned cloud deck to an active season and pairs it with the current pool', async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      await Promise.resolve();
      calls.push({ text, values });
      if (text.includes('SELECT * FROM theme_table_versions')) {
        return { rows: [{ ...THEME, lifecycle: 'ACTIVE' }], rowCount: 1 };
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
    const loadDeck = vi.fn(() =>
      Promise.resolve({
        deckId: 'cloud-deck-1',
        deckName: '来源卡组',
        runtimeDeck: {
          mainDeck: [{ cardCode: 'MEMBER-1' }, { cardCode: 'MEMBER-1' }],
          energyDeck: [{ cardCode: 'ENERGY-1' }],
        },
      })
    );
    const service = new ThemeTableAdminService({
      query,
      now: () => NOW,
      createId: () => 'deck-version-1',
      loadDeck: loadDeck as never,
      getCatalog: vi.fn(() =>
        Promise.resolve({
          cardCatalogVersion: 'PUBLISHED_RUNTIME_CARD_CATALOG_V1',
          cardCatalogHash: 'sha256:catalog',
          publishedCardCount: 2000,
        })
      ),
    });

    await service.addDeck('admin-1', THEME.id, {
      sourceType: 'CLOUD',
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
    expect(insert?.text).toContain('UNION ALL');
    expect(insert?.text).toContain('inserted.id, inserted.id');
    expect(insert?.text).toContain("theme.lifecycle IN ('DRAFT', 'ACTIVE', 'PAUSED')");
    expect(insert?.text).toContain('existing.retired_at IS NULL');
    expect(insert?.text).toContain("jsonb_build_object('summary', '随卡组池自动启用')");
    expect(insert?.text).toContain('ON CONFLICT');
  });

  it('loads a YAML deck through the same frozen snapshot path', async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      await Promise.resolve();
      calls.push({ text, values });
      if (text.includes('SELECT * FROM theme_table_versions')) {
        return { rows: [THEME], rowCount: 1 };
      }
      if (text.includes('INSERT INTO theme_prebuilt_deck_versions')) {
        return {
          rows: [
            {
              id: 'deck-version-1',
              deck_key: 'yaml-deck',
              display_name: 'YAML 卡组',
              deck_list: { mainDeck: [], energyDeck: [] },
              content_hash: 'sha256:yaml',
              play_style_tags: [],
              difficulty: 'INTERMEDIATE',
              source_label: 'YAML · deck.yaml',
              source_url: null,
              review_note: '管理员导入',
              approved_at: NOW,
            },
          ],
          rowCount: 1,
        };
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const loadYamlDeck = vi.fn(() =>
      Promise.resolve({ runtimeDeck: { mainDeck: [], energyDeck: [] } })
    );
    const service = new ThemeTableAdminService({
      query,
      now: () => NOW,
      createId: () => 'deck-version-1',
      loadYamlDeck: loadYamlDeck as never,
    });

    await service.addDeck('admin-1', THEME.id, {
      sourceType: 'YAML',
      yamlContent: 'player_name: YAML 卡组',
      deckKey: 'yaml-deck',
      displayName: 'YAML 卡组',
      playStyleTags: [],
      difficulty: 'INTERMEDIATE',
      sourceLabel: 'YAML · deck.yaml',
      sourceUrl: null,
      reviewNote: '管理员导入',
    });

    expect(loadYamlDeck).toHaveBeenCalledWith('player_name: YAML 卡组');
  });

  it('refuses publication until one deck and one enabled matchup exist', async () => {
    const query = vi.fn(async (text: string) => {
      await Promise.resolve();
      if (text.includes('SELECT * FROM theme_table_versions')) {
        return { rows: [THEME], rowCount: 1 };
      }
      if (text.includes('deck_count')) {
        return { rows: [{ deck_count: '0', matchup_count: '0' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const service = new ThemeTableAdminService({
      query,
      now: () => NOW,
      getCatalog: vi.fn(() =>
        Promise.resolve({
          cardCatalogVersion: 'PUBLISHED_RUNTIME_CARD_CATALOG_V1',
          cardCatalogHash: 'sha256:catalog',
          publishedCardCount: 2000,
        })
      ),
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

  it('retires a deck and disables its future matchups after the season has started', async () => {
    const query = vi.fn((text: string) => {
      if (text.includes('SELECT * FROM theme_table_versions')) {
        return Promise.resolve({ rows: [{ ...THEME, lifecycle: 'ACTIVE' }], rowCount: 1 });
      }
      if (text.includes('WITH target_deck AS')) {
        return Promise.resolve({
          rows: [{ id: 'deck-1', disabled_matchup_count: '4' }],
          rowCount: 1,
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    const service = new ThemeTableAdminService({ query, now: () => NOW });

    await expect(service.deleteDeck('admin-1', THEME.id, 'deck-1')).resolves.toEqual({
      id: 'deck-1',
      disabledMatchupCount: 4,
    });
    const deletion = query.mock.calls.find(([text]) =>
      String(text).includes('WITH target_deck AS')
    );
    expect(String(deletion?.[0])).toContain('retired_deck AS');
    expect(String(deletion?.[0])).toContain('disabled_matchups AS');
    expect(String(deletion?.[0])).toContain("SET lifecycle = 'PAUSED'");
    expect(String(deletion?.[0])).not.toContain('DELETE FROM theme_prebuilt_deck_versions');
  });

  it('replaces an active deck version and rebuilds only its future matchup set', async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      await Promise.resolve();
      calls.push({ text, values });
      if (text.includes('SELECT * FROM theme_table_versions')) {
        return { rows: [{ ...THEME, lifecycle: 'ACTIVE' }], rowCount: 1 };
      }
      if (text.includes('WITH target_deck AS')) {
        return {
          rows: [
            {
              id: 'deck-version-2',
              deck_key: 'liella-tempo',
              display_name: 'Liella! 新节奏',
              deck_list: {
                mainDeck: [{ cardCode: 'MEMBER-2', count: 2 }],
                energyDeck: [{ cardCode: 'ENERGY-1', count: 1 }],
              },
              content_hash: 'sha256:deck-v2',
              play_style_tags: ['节奏'],
              difficulty: 'INTERMEDIATE',
              source_label: '运营编辑',
              source_url: null,
              review_note: '运行期调整',
              approved_at: NOW,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const loadYamlDeck = vi.fn(() =>
      Promise.resolve({
        runtimeDeck: {
          mainDeck: [{ cardCode: 'MEMBER-2' }, { cardCode: 'MEMBER-2' }],
          energyDeck: [{ cardCode: 'ENERGY-1' }],
        },
      })
    );
    const service = new ThemeTableAdminService({
      query,
      now: () => NOW,
      createId: () => 'deck-version-2',
      loadYamlDeck: loadYamlDeck as never,
      getCatalog: vi.fn(() =>
        Promise.resolve({
          cardCatalogVersion: 'PUBLISHED_RUNTIME_CARD_CATALOG_V1',
          cardCatalogHash: 'sha256:catalog',
          publishedCardCount: 2000,
        })
      ),
    });

    const updated = await service.updateDeck('admin-1', THEME.id, 'deck-version-1', {
      sourceType: 'YAML',
      yamlContent: 'player_name: Liella! 新节奏',
      displayName: 'Liella! 新节奏',
      playStyleTags: ['节奏'],
      difficulty: 'INTERMEDIATE',
      sourceLabel: '运营编辑',
      sourceUrl: null,
      reviewNote: '运行期调整',
    });

    expect(updated.id).toBe('deck-version-2');
    const replacement = calls.find((call) => call.text.includes('WITH target_deck AS'));
    expect(replacement?.text).toContain("theme.lifecycle IN ('DRAFT', 'ACTIVE', 'PAUSED')");
    expect(replacement?.text).toContain('SET retired_at = $13');
    expect(replacement?.text).toContain('disabled_matchups AS');
    expect(replacement?.text).toContain('inserted_matchups AS');
    expect(replacement?.text).toContain('existing.retired_at IS NULL');
    expect(replacement?.values?.[2]).toBe('deck-version-1');
  });

  it('canonicalizes matchup deck order so A×B and B×A share one database identity', async () => {
    const calls: { text: string; values?: readonly unknown[] }[] = [];
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      await Promise.resolve();
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
      await Promise.resolve();
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
