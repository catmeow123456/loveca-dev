import { describe, expect, it } from 'vitest';
import {
  RankedEnvironmentService,
  aggregateRankedSeasonEnvironment,
  type RankedEnvironmentQueryClient,
} from '../../src/server/services/ranked-environment-service';

function card(
  baseCardCode: string,
  options: { readonly count?: number; readonly cardType?: 'MEMBER' | 'LIVE' } = {}
) {
  return {
    baseCardCode,
    cardCode: `${baseCardCode}-${options.cardType === 'LIVE' ? 'L' : 'P'}`,
    name: `Card ${baseCardCode}`,
    cardType: options.cardType ?? ('MEMBER' as const),
    count: options.count ?? 1,
    imageFilename: null,
  };
}

describe('ranked season environment aggregation', () => {
  it('gives each player equal weight instead of weighting frequent players by matches', () => {
    const result = aggregateRankedSeasonEnvironment(
      'season-1',
      [
        {
          match_id: 'match-1',
          seat: 'FIRST',
          user_id: 'player-a',
          main_deck_cards: [card('PL!HS-bp1-001', { count: 4 })],
        },
        {
          match_id: 'match-1',
          seat: 'SECOND',
          user_id: 'player-b',
          main_deck_cards: [card('PL!N-bp1-001')],
        },
        {
          match_id: 'match-2',
          seat: 'FIRST',
          user_id: 'player-a',
          main_deck_cards: [card('PL!HS-bp1-001', { count: 2 })],
        },
        {
          match_id: 'match-2',
          seat: 'SECOND',
          user_id: 'player-c',
          main_deck_cards: [card('PL!N-bp1-001')],
        },
      ],
      2
    );

    expect(result.sample).toEqual({
      settledMatchCount: 2,
      analyzedMatchCount: 2,
      deckObservationCount: 4,
      playerCount: 3,
      coverageRate: 1,
    });
    expect(result.cardUsage.find((entry) => entry.baseCardCode === 'PL!HS-bp1-001')).toMatchObject({
      baseCardCode: 'PL!HS-bp1-001',
      usageRate: 1 / 3,
      deckInclusionRate: 0.5,
      playerCount: 1,
      deckCount: 2,
      averageCopies: 3,
    });
  });

  it('limits the public ranking to 30 cards with deterministic tie ordering', () => {
    const cards = Array.from({ length: 31 }, (_, index) =>
      card(`PL!N-bp1-${String(index + 1).padStart(3, '0')}`)
    ).reverse();
    const result = aggregateRankedSeasonEnvironment(
      'season-1',
      [
        {
          match_id: 'match-1',
          seat: 'FIRST',
          user_id: 'player-a',
          main_deck_cards: cards,
        },
      ],
      1
    );

    expect(result.cardUsage).toHaveLength(30);
    expect(result.cardUsage[0]?.baseCardCode).toBe('PL!N-bp1-001');
    expect(result.cardUsage[29]?.baseCardCode).toBe('PL!N-bp1-030');
  });

  it('rejects malformed persisted card observations instead of publishing partial facts', () => {
    expect(() =>
      aggregateRankedSeasonEnvironment(
        'season-1',
        [
          {
            match_id: 'match-1',
            seat: 'FIRST',
            user_id: 'player-a',
            main_deck_cards: [],
          },
        ],
        1
      )
    ).toThrow('卡组观察数据无效');
  });

  it('rejects an analyzed match count that exceeds the settled snapshot', () => {
    expect(() =>
      aggregateRankedSeasonEnvironment(
        'season-1',
        [
          {
            match_id: 'match-1',
            seat: 'FIRST',
            user_id: 'player-a',
            main_deck_cards: [card('PL!HS-bp1-001')],
          },
        ],
        0
      )
    ).toThrow('可分析对局数超过已结算对局数');
  });
});

describe('RankedEnvironmentService', () => {
  it('returns only observations from settled matches that have both seats', async () => {
    const queries: string[] = [];
    const client: RankedEnvironmentQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        queries.push(text);
        if (text.includes('FROM ranked_seasons')) return { rows: [{ id: 'season-1' }] as T[] };
        return {
          rows: [
            {
              settled_match_count: '2',
              match_id: 'match-1',
              seat: 'FIRST',
              user_id: 'player-a',
              main_deck_cards: [card('PL!HS-bp1-001')],
            },
            {
              settled_match_count: '2',
              match_id: 'match-1',
              seat: 'SECOND',
              user_id: 'player-b',
              main_deck_cards: [card('PL!N-bp1-001')],
            },
          ] as T[],
        };
      },
    };

    const result = await new RankedEnvironmentService(client).getSeasonEnvironment('season-1');

    expect(result.sample).toMatchObject({
      settledMatchCount: 2,
      analyzedMatchCount: 1,
      deckObservationCount: 2,
      playerCount: 2,
      coverageRate: 0.5,
    });
    expect(queries.join('\n')).toContain("rating_status = 'SETTLED'");
    expect(queries.join('\n')).toContain('HAVING count(*) = 2');
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain('WITH settled_matches AS MATERIALIZED');
    expect(queries[1]).toContain('LEFT JOIN observation_rows AS observation ON TRUE');
  });

  it('returns an empty sample from the same statistics statement', async () => {
    const client: RankedEnvironmentQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        if (text.includes('FROM ranked_seasons')) return { rows: [{ id: 'season-1' }] as T[] };
        return {
          rows: [
            {
              settled_match_count: '3',
              match_id: null,
              seat: null,
              user_id: null,
              main_deck_cards: null,
            },
          ] as T[],
        };
      },
    };

    const result = await new RankedEnvironmentService(client).getSeasonEnvironment('season-1');

    expect(result.sample).toEqual({
      settledMatchCount: 3,
      analyzedMatchCount: 0,
      deckObservationCount: 0,
      playerCount: 0,
      coverageRate: 0,
    });
    expect(result.cardUsage).toEqual([]);
  });

  it('does not expose draft or missing seasons', async () => {
    const client: RankedEnvironmentQueryClient = {
      async query<T>() {
        await Promise.resolve();
        return { rows: [] as T[] };
      },
    };

    await expect(
      new RankedEnvironmentService(client).getSeasonEnvironment('missing')
    ).rejects.toMatchObject({ code: 'RANKED_SEASON_NOT_FOUND', statusCode: 404 });
  });
});
