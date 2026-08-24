import { describe, expect, it } from 'vitest';
import {
  aggregateDeckArchetypeEnvironment,
  mergeLiveArchetypeDisplaySettings,
  RankedDeckArchetypeEnvironmentService,
  type DeckArchetypeEnvironmentQueryClient,
} from '../../src/server/services/ranked-deck-archetype-environment-service';
import {
  buildDeckClassifierSnapshot,
  hashDeckClassifierSnapshot,
} from '../../src/server/services/deck-classifier-release';

const ARCHETYPES = [
  {
    id: 'archetype-a',
    archetypeKey: 'a',
    name: 'A 卡组',
    groupName: '测试',
    description: '',
    color: '#2563EB',
    representativeCardCode: 'PL!-bp1-001-P',
    representativeImageFilename: 'PL!-bp1-001-P.webp',
    sortOrder: 10,
  },
  {
    id: 'archetype-b',
    archetypeKey: 'b',
    name: 'B 卡组',
    groupName: '测试',
    description: '',
    color: '#DC2626',
    representativeImageFilename: null,
    sortOrder: 20,
  },
] as const;

describe('ranked deck archetype environment aggregation', () => {
  it('同时计算玩家等权、对局等权、胜者构成、胜率和未识别分母', () => {
    const result = aggregateDeckArchetypeEnvironment({
      seasonId: 'season-1',
      displayMode: 'BOTH',
      visibleSections: ['USAGE', 'WINNER', 'TOP_RANKED'],
      topRankedPlayerCount: 30,
      topRankedEligiblePlayerCount: 2,
      release: { id: 'release-1', version: 1, publishedAt: 1_700_000_000_000 },
      archetypes: ARCHETYPES,
      settledMatchCount: 4,
      observedMatchCount: 3,
      assignedObservationCount: 6,
      recognizedObservationCount: 5,
      assignments: [
        assignment('match-1', 'FIRST', 'player-1', 'FIRST', 'CLASSIFIED', 'archetype-a', true),
        assignment('match-1', 'SECOND', 'player-2', 'FIRST', 'CLASSIFIED', 'archetype-b', true),
        assignment('match-2', 'FIRST', 'player-1', 'SECOND', 'CLASSIFIED', 'archetype-a', true),
        assignment('match-2', 'SECOND', 'player-3', 'SECOND', 'CLASSIFIED', 'archetype-b'),
        assignment('match-3', 'FIRST', 'player-4', 'FIRST', 'UNKNOWN', null),
        assignment('match-3', 'SECOND', 'player-2', 'FIRST', 'CLASSIFIED', 'archetype-a', true),
      ],
    });

    expect(result.sample).toEqual({
      settledMatchCount: 4,
      analyzedMatchCount: 3,
      deckObservationCount: 6,
      assignedDeckObservationCount: 6,
      recognizedDeckObservationCount: 5,
      playerCount: 4,
      winningPlayerCount: 3,
      topRankedEligiblePlayerCount: 2,
      topRankedAnalyzedPlayerCount: 2,
      observationCoverageRate: 0.75,
      classificationCoverageRate: 1,
    });
    expect(result.archetypes.find((entry) => entry.archetypeId === 'archetype-a')).toMatchObject({
      appearanceCount: 3,
      winnerCount: 1,
      playerEqualUsageRate: 0.375,
      matchEqualUsageRate: 0.5,
      playerEqualWinnerRate: 1 / 3,
      matchEqualWinnerRate: 1 / 3,
      winRate: 1 / 3,
      nonMirrorAppearanceCount: 2,
      nonMirrorWinRate: 0.5,
      representativeCardCode: 'PL!-bp1-001-P',
      representativeImageFilename: 'PL!-bp1-001-P.webp',
      topRankedPlayerEqualUsageRate: 0.75,
    });
    expect(result.archetypes.find((entry) => entry.archetypeKey === 'other_unknown')).toMatchObject(
      {
        classificationStatus: 'UNKNOWN',
        appearanceCount: 1,
        matchEqualUsageRate: 1 / 6,
        playerEqualUsageRate: 0.25,
      }
    );
    expect(
      result.archetypes.reduce((sum, entry) => sum + entry.matchEqualUsageRate, 0)
    ).toBeCloseTo(1);
    expect(
      result.archetypes.reduce((sum, entry) => sum + entry.playerEqualUsageRate, 0)
    ).toBeCloseTo(1);
    expect(
      result.archetypes.reduce((sum, entry) => sum + entry.topRankedPlayerEqualUsageRate, 0)
    ).toBeCloseTo(1);
  });

  it('拒绝只有一席分类结果的所谓可分析对局', () => {
    expect(() =>
      aggregateDeckArchetypeEnvironment({
        seasonId: 'season-1',
        displayMode: 'MATCH_EQUAL',
        visibleSections: ['USAGE'],
        topRankedPlayerCount: 30,
        topRankedEligiblePlayerCount: 0,
        release: { id: 'release-1', version: 1, publishedAt: 1 },
        archetypes: ARCHETYPES,
        settledMatchCount: 1,
        observedMatchCount: 1,
        assignedObservationCount: 1,
        recognizedObservationCount: 1,
        assignments: [
          assignment('match-1', 'FIRST', 'player-1', 'FIRST', 'CLASSIFIED', 'archetype-a'),
        ],
      })
    ).toThrow('没有恰好两席分类结果');
  });

  it('拒绝用截断百分比掩盖分类数量超过观察数量', () => {
    expect(() =>
      aggregateDeckArchetypeEnvironment({
        seasonId: 'season-1',
        displayMode: 'MATCH_EQUAL',
        visibleSections: ['USAGE'],
        topRankedPlayerCount: 30,
        topRankedEligiblePlayerCount: 0,
        release: { id: 'release-1', version: 1, publishedAt: 1 },
        archetypes: ARCHETYPES,
        settledMatchCount: 1,
        observedMatchCount: 1,
        assignedObservationCount: 3,
        recognizedObservationCount: 3,
        assignments: [],
      })
    ).toThrow('样本数量不一致');
  });
});

describe('RankedDeckArchetypeEnvironmentService', () => {
  it('serves an active release with its latest live display settings', async () => {
    const snapshot = storedSnapshot();
    const queries: string[] = [];
    const client: DeckArchetypeEnvironmentQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        queries.push(text);
        if (text.includes('SELECT id FROM ranked_seasons')) {
          return { rows: [{ id: 'season-1' }] as T[] };
        }
        if (text.includes('FROM deck_classifier_settings')) {
          return {
            rows: [
              {
                display_mode: 'BOTH',
                show_usage: true,
                show_winner: true,
                show_top_ranked: true,
                top_ranked_player_count: 30,
                id: 'release-1',
                version: 1,
                snapshot_json: snapshot,
                config_hash: hashDeckClassifierSnapshot(snapshot),
                published_at: '2026-08-23T00:00:00.000Z',
                activated_at: '2026-08-23T00:01:00.000Z',
              },
            ] as T[],
          };
        }
        if (text.includes('FROM deck_archetypes AS archetype')) {
          return {
            rows: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                color_key: '#abcdef',
                representative_card_code: 'PL!-bp1-001-P',
                representative_image_filename: 'PL!-bp1-001-P.webp',
              },
            ] as T[],
          };
        }
        return {
          rows: [
            {
              settled_match_count: '0',
              observed_match_count: '0',
              assigned_observation_count: '0',
              recognized_observation_count: '0',
              top_ranked_eligible_player_count: '0',
              match_id: null,
              seat: null,
              user_id: null,
              winner_seat: null,
              status: null,
              archetype_id: null,
              top_ranked: null,
            },
          ] as T[],
        };
      },
    };

    const result = await new RankedDeckArchetypeEnvironmentService(client).getSeasonEnvironment(
      'season-1'
    );

    expect(result).toMatchObject({
      available: true,
      displayMode: 'BOTH',
      visibleSections: ['USAGE', 'WINNER', 'TOP_RANKED'],
      topRankedPlayerCount: 30,
      release: { id: 'release-1', version: 1 },
    });
    expect(queries[1]).toContain("release.status = 'ACTIVE'");
    expect(queries[1]).toContain('release.config_hash');
    expect(queries[2]).toContain('representative_card.image_filename');
    expect(queries[3]).toContain("assignment.status IN ('CLASSIFIED', 'UNKNOWN', 'AMBIGUOUS')");
    expect(queries[3]).toContain(
      'rating.rated_match_count >= season.leaderboard_minimum_match_count'
    );
    expect(queries[3]).toContain('LIMIT $3');
  });

  it('returns no player environment data or aggregation when display is hidden', async () => {
    const queries: string[] = [];
    const client: DeckArchetypeEnvironmentQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        queries.push(text);
        if (text.includes('SELECT id FROM ranked_seasons')) {
          return { rows: [{ id: 'season-1' }] as T[] };
        }
        if (text.includes('FROM deck_classifier_settings')) {
          return {
            rows: [
              {
                display_mode: 'HIDDEN',
                show_usage: false,
                show_winner: false,
                show_top_ranked: false,
                top_ranked_player_count: 30,
                id: 'release-1',
                version: 1,
                snapshot_json: { intentionally: 'not read' },
                config_hash: 'intentionally-not-read',
                published_at: '2026-08-23T00:00:00.000Z',
                activated_at: '2026-08-23T00:01:00.000Z',
              },
            ] as T[],
          };
        }
        throw new Error(`hidden mode unexpectedly queried: ${text}`);
      },
    };

    const result = await new RankedDeckArchetypeEnvironmentService(client).getSeasonEnvironment(
      'season-1'
    );

    expect(result).toMatchObject({
      available: false,
      seasonId: 'season-1',
      displayMode: 'HIDDEN',
      visibleSections: [],
      release: null,
      archetypes: [],
    });
    expect(result.sample).toMatchObject({ analyzedMatchCount: 0, deckObservationCount: 0 });
    expect(queries).toHaveLength(2);
  });

  it('defaults to a fully hidden environment if the settings singleton is missing', async () => {
    const queries: string[] = [];
    const client: DeckArchetypeEnvironmentQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        queries.push(text);
        if (text.includes('SELECT id FROM ranked_seasons')) {
          return { rows: [{ id: 'season-1' }] as T[] };
        }
        if (text.includes('FROM deck_classifier_settings')) {
          return { rows: [] as T[] };
        }
        throw new Error(`missing settings unexpectedly queried: ${text}`);
      },
    };

    const result = await new RankedDeckArchetypeEnvironmentService(client).getSeasonEnvironment(
      'season-1'
    );

    expect(result).toMatchObject({
      available: false,
      displayMode: 'HIDDEN',
      visibleSections: [],
      release: null,
      archetypes: [],
    });
    expect(queries).toHaveLength(2);
  });

  it('rejects a published snapshot whose content no longer matches its hash', async () => {
    const snapshot = storedSnapshot();
    const client: DeckArchetypeEnvironmentQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        if (text.includes('SELECT id FROM ranked_seasons')) {
          return { rows: [{ id: 'season-1' }] as T[] };
        }
        return {
          rows: [
            {
              display_mode: 'MATCH_EQUAL',
              show_usage: true,
              show_winner: true,
              show_top_ranked: false,
              top_ranked_player_count: 30,
              id: 'release-1',
              version: 1,
              snapshot_json: snapshot,
              config_hash: `sha256:${'0'.repeat(64)}`,
              published_at: '2026-08-23T00:00:00.000Z',
              activated_at: null,
            },
          ] as T[],
        };
      },
    };

    await expect(
      new RankedDeckArchetypeEnvironmentService(client).getSeasonEnvironment('season-1')
    ).rejects.toMatchObject({
      code: 'RANKED_DECK_CLASSIFIER_SNAPSHOT_INVALID',
      statusCode: 500,
    });
  });

  it('overlays display settings without changing release metadata', () => {
    const releaseArchetypes = storedSnapshot().archetypes;
    const result = mergeLiveArchetypeDisplaySettings(releaseArchetypes, [
      {
        id: '11111111-1111-4111-8111-111111111111',
        color_key: '#abcdef',
        representative_card_code: 'PL!-bp1-001-P',
        representative_image_filename: 'PL!-bp1-001-P.webp',
      },
    ]);

    expect(result[0]).toMatchObject({
      name: '测试卡组',
      color: '#ABCDEF',
      representativeCardCode: 'PL!-bp1-001-P',
      representativeImageFilename: 'PL!-bp1-001-P.webp',
    });
  });
});

function storedSnapshot() {
  return buildDeckClassifierSnapshot({
    releaseVersion: 1,
    archetypes: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        archetype_key: 'test',
        name: '测试卡组',
        group_name: '测试',
        description: '',
        sort_order: 1,
      },
    ],
    templates: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        archetype_id: '11111111-1111-4111-8111-111111111111',
        cards: [
          ...Array.from({ length: 12 }, (_, index) => ({
            baseCardCode: `M-${index + 1}`,
            cardType: 'MEMBER' as const,
            count: 4,
          })),
          ...Array.from({ length: 3 }, (_, index) => ({
            baseCardCode: `L-${index + 1}`,
            cardType: 'LIVE' as const,
            count: 4,
          })),
        ],
      },
    ],
    rules: [],
  });
}

function assignment(
  matchId: string,
  seat: 'FIRST' | 'SECOND',
  userId: string,
  winnerSeat: 'FIRST' | 'SECOND',
  status: 'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS',
  archetypeId: string | null,
  topRanked = false
) {
  return { matchId, seat, userId, winnerSeat, status, archetypeId, topRanked };
}
