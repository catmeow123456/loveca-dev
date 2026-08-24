import { describe, expect, it } from 'vitest';
import type {
  RankedSeasonCardEnvironmentWeighting,
  RankedSeasonEnvironmentView,
} from '../../src/online/ranked-types';
import type { DeckEnvironmentSection } from '../../src/online/deck-classifier-types';
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

function observation(
  matchId: string,
  seat: 'FIRST' | 'SECOND',
  userId: string,
  winnerSeat: 'FIRST' | 'SECOND',
  cards: readonly ReturnType<typeof card>[],
  topRanked = false
) {
  return {
    match_id: matchId,
    seat,
    user_id: userId,
    winner_seat: winnerSeat,
    top_ranked: topRanked,
    main_deck_cards: cards,
  };
}

function ranking(
  result: RankedSeasonEnvironmentView,
  section: DeckEnvironmentSection,
  weighting: RankedSeasonCardEnvironmentWeighting
) {
  const resultRanking = result.rankings.find(
    (candidate) => candidate.section === section && candidate.weighting === weighting
  );
  if (!resultRanking) throw new Error(`missing ranking ${section}/${weighting}`);
  return resultRanking;
}

describe('ranked season card environment aggregation', () => {
  it('independently computes usage, winner and top-ranked cohorts under both base weightings', () => {
    const result = aggregateRankedSeasonEnvironment({
      seasonId: 'season-1',
      displayMode: 'BOTH',
      visibleSections: ['USAGE', 'WINNER', 'TOP_RANKED'],
      topRankedPlayerCount: 30,
      topRankedEligiblePlayerCount: 2,
      settledMatchCount: 3,
      observations: [
        observation(
          'match-1',
          'FIRST',
          'player-a',
          'FIRST',
          [card('CARD-X', { count: 4 }), card('CARD-Y')],
          true
        ),
        observation('match-1', 'SECOND', 'player-b', 'FIRST', [card('CARD-Z')], true),
        observation('match-2', 'FIRST', 'player-a', 'SECOND', [card('CARD-X', { count: 2 })], true),
        observation('match-2', 'SECOND', 'player-c', 'SECOND', [card('CARD-Y')]),
        observation('match-3', 'FIRST', 'player-d', 'FIRST', [card('CARD-Z')]),
        observation('match-3', 'SECOND', 'player-a', 'FIRST', [card('CARD-X')], true),
      ],
    });

    expect(result.sample).toEqual({
      settledMatchCount: 3,
      analyzedMatchCount: 3,
      deckObservationCount: 6,
      playerCount: 4,
      winningPlayerCount: 3,
      topRankedEligiblePlayerCount: 2,
      topRankedAnalyzedPlayerCount: 2,
      topRankedDeckObservationCount: 4,
      coverageRate: 1,
    });
    expect(result.rankings.map(({ section, weighting }) => `${section}/${weighting}`)).toEqual([
      'USAGE/PLAYER_EQUAL',
      'USAGE/MATCH_EQUAL',
      'WINNER/PLAYER_EQUAL',
      'WINNER/MATCH_EQUAL',
      'TOP_RANKED/PLAYER_EQUAL',
    ]);
    expect(
      ranking(result, 'USAGE', 'PLAYER_EQUAL').cards.find(
        (entry) => entry.baseCardCode === 'CARD-X'
      )
    ).toMatchObject({ adoptionRate: 0.25, playerCount: 1, deckCount: 3, averageCopies: 7 / 3 });
    expect(
      ranking(result, 'USAGE', 'MATCH_EQUAL').cards.find((entry) => entry.baseCardCode === 'CARD-X')
    ).toMatchObject({ adoptionRate: 0.5 });
    expect(
      ranking(result, 'WINNER', 'PLAYER_EQUAL').cards.find(
        (entry) => entry.baseCardCode === 'CARD-X'
      )
    ).toMatchObject({ adoptionRate: 1 / 3, deckCount: 1 });
    expect(
      ranking(result, 'WINNER', 'MATCH_EQUAL').cards.find(
        (entry) => entry.baseCardCode === 'CARD-X'
      )
    ).toMatchObject({ adoptionRate: 1 / 3 });
    expect(
      ranking(result, 'TOP_RANKED', 'PLAYER_EQUAL').cards.find(
        (entry) => entry.baseCardCode === 'CARD-X'
      )
    ).toMatchObject({ adoptionRate: 0.5, playerCount: 1, deckCount: 3 });
  });

  it('limits every enabled ranking independently to 30 deterministic cards', () => {
    const winnerCards = Array.from({ length: 31 }, (_, index) =>
      card(`WIN-${String(index + 1).padStart(2, '0')}`)
    ).reverse();
    const topCards = Array.from({ length: 31 }, (_, index) =>
      card(`TOP-${String(index + 1).padStart(2, '0')}`)
    ).reverse();
    const result = aggregateRankedSeasonEnvironment({
      seasonId: 'season-1',
      displayMode: 'PLAYER_EQUAL',
      visibleSections: ['WINNER', 'TOP_RANKED'],
      topRankedPlayerCount: 30,
      topRankedEligiblePlayerCount: 1,
      settledMatchCount: 1,
      observations: [
        observation('match-1', 'FIRST', 'winner', 'FIRST', winnerCards),
        observation('match-1', 'SECOND', 'top-player', 'FIRST', topCards, true),
      ],
    });

    const winner = ranking(result, 'WINNER', 'PLAYER_EQUAL').cards;
    const topRanked = ranking(result, 'TOP_RANKED', 'PLAYER_EQUAL').cards;
    expect(winner).toHaveLength(30);
    expect(topRanked).toHaveLength(30);
    expect(winner[0]?.baseCardCode).toBe('WIN-01');
    expect(winner[29]?.baseCardCode).toBe('WIN-30');
    expect(topRanked[0]?.baseCardCode).toBe('TOP-01');
    expect(topRanked[29]?.baseCardCode).toBe('TOP-30');
  });

  it('breaks equal-rate ties by player count, deck count and then base card code', () => {
    const byPlayerCount = aggregateRankedSeasonEnvironment({
      seasonId: 'season-1',
      displayMode: 'PLAYER_EQUAL',
      visibleSections: ['USAGE'],
      topRankedPlayerCount: 30,
      topRankedEligiblePlayerCount: 0,
      settledMatchCount: 3,
      observations: [
        observation('match-1', 'FIRST', 'player-a', 'FIRST', [card('WIDE')]),
        observation('match-1', 'SECOND', 'player-c', 'FIRST', [card('NARROW')]),
        observation('match-2', 'FIRST', 'player-a', 'FIRST', [card('FILLER-A')]),
        observation('match-2', 'SECOND', 'player-b', 'FIRST', [card('WIDE')]),
        observation('match-3', 'FIRST', 'player-b', 'FIRST', [card('FILLER-B')]),
        observation('match-3', 'SECOND', 'player-c', 'FIRST', [card('NARROW')]),
      ],
    });
    const playerCards = ranking(byPlayerCount, 'USAGE', 'PLAYER_EQUAL').cards;
    expect(playerCards.find((entry) => entry.baseCardCode === 'WIDE')?.adoptionRate).toBe(
      playerCards.find((entry) => entry.baseCardCode === 'NARROW')?.adoptionRate
    );
    expect(
      playerCards.indexOf(playerCards.find((entry) => entry.baseCardCode === 'WIDE')!)
    ).toBeLessThan(
      playerCards.indexOf(playerCards.find((entry) => entry.baseCardCode === 'NARROW')!)
    );

    const byDeckCount = aggregateRankedSeasonEnvironment({
      seasonId: 'season-1',
      displayMode: 'PLAYER_EQUAL',
      visibleSections: ['USAGE'],
      topRankedPlayerCount: 30,
      topRankedEligiblePlayerCount: 0,
      settledMatchCount: 4,
      observations: [
        observation('match-1', 'FIRST', 'player-a', 'FIRST', [card('FEWER-DECKS')]),
        observation('match-1', 'SECOND', 'player-b', 'FIRST', [card('MORE-DECKS')]),
        observation('match-2', 'FIRST', 'player-a', 'FIRST', [card('FILLER-A')]),
        observation('match-2', 'SECOND', 'player-b', 'FIRST', [card('MORE-DECKS')]),
        observation('match-3', 'FIRST', 'player-b', 'FIRST', [card('FILLER-B')]),
        observation('match-3', 'SECOND', 'player-c', 'FIRST', [card('FILLER-C')]),
        observation('match-4', 'FIRST', 'player-b', 'FIRST', [card('FILLER-B')]),
        observation('match-4', 'SECOND', 'player-c', 'FIRST', [card('FILLER-C')]),
      ],
    });
    const deckCards = ranking(byDeckCount, 'USAGE', 'PLAYER_EQUAL').cards;
    const moreDecks = deckCards.find((entry) => entry.baseCardCode === 'MORE-DECKS')!;
    const fewerDecks = deckCards.find((entry) => entry.baseCardCode === 'FEWER-DECKS')!;
    expect(moreDecks.adoptionRate).toBe(fewerDecks.adoptionRate);
    expect(moreDecks.playerCount).toBe(fewerDecks.playerCount);
    expect(deckCards.indexOf(moreDecks)).toBeLessThan(deckCards.indexOf(fewerDecks));
  });

  it('does not publish disabled winner or top-ranked cohort statistics', () => {
    const result = aggregateRankedSeasonEnvironment({
      seasonId: 'season-1',
      displayMode: 'PLAYER_EQUAL',
      visibleSections: ['USAGE'],
      topRankedPlayerCount: 30,
      topRankedEligiblePlayerCount: 0,
      settledMatchCount: 1,
      observations: [
        observation('match-1', 'FIRST', 'player-a', 'FIRST', [card('CARD-A')], true),
        observation('match-1', 'SECOND', 'player-b', 'FIRST', [card('CARD-B')]),
      ],
    });

    expect(result.rankings).toHaveLength(1);
    expect(result.sample).toMatchObject({
      winningPlayerCount: 0,
      topRankedEligiblePlayerCount: 0,
      topRankedAnalyzedPlayerCount: 0,
      topRankedDeckObservationCount: 0,
    });
  });

  it('rejects malformed persisted card observations instead of publishing partial facts', () => {
    expect(() =>
      aggregateRankedSeasonEnvironment({
        seasonId: 'season-1',
        displayMode: 'PLAYER_EQUAL',
        visibleSections: ['USAGE'],
        topRankedPlayerCount: 30,
        topRankedEligiblePlayerCount: 0,
        settledMatchCount: 1,
        observations: [
          observation('match-1', 'FIRST', 'player-a', 'FIRST', []),
          observation('match-1', 'SECOND', 'player-b', 'FIRST', [card('CARD-B')]),
        ],
      })
    ).toThrow('卡组观察数据无效');
  });

  it('rejects a match without two unique and consistent seats', () => {
    expect(() =>
      aggregateRankedSeasonEnvironment({
        seasonId: 'season-1',
        displayMode: 'PLAYER_EQUAL',
        visibleSections: ['USAGE'],
        topRankedPlayerCount: 30,
        topRankedEligiblePlayerCount: 0,
        settledMatchCount: 1,
        observations: [observation('match-1', 'FIRST', 'player-a', 'FIRST', [card('CARD-A')])],
      })
    ).toThrow('没有恰好两席一致的卡组观察');
  });

  it('rejects an analyzed match count that exceeds the settled snapshot', () => {
    expect(() =>
      aggregateRankedSeasonEnvironment({
        seasonId: 'season-1',
        displayMode: 'PLAYER_EQUAL',
        visibleSections: ['USAGE'],
        topRankedPlayerCount: 30,
        topRankedEligiblePlayerCount: 0,
        settledMatchCount: 0,
        observations: [
          observation('match-1', 'FIRST', 'player-a', 'FIRST', [card('CARD-A')]),
          observation('match-1', 'SECOND', 'player-b', 'FIRST', [card('CARD-B')]),
        ],
      })
    ).toThrow('可分析对局数超过已结算对局数');
  });
});

describe('RankedEnvironmentService', () => {
  it('uses independent card settings and does not require an active classifier release', async () => {
    const queries: { readonly text: string; readonly values?: readonly unknown[] }[] = [];
    const client: RankedEnvironmentQueryClient = {
      async query<T>(text: string, values?: readonly unknown[]) {
        await Promise.resolve();
        queries.push({ text, values });
        if (text.includes('FROM ranked_seasons') && !text.includes('WITH season_settings')) {
          return { rows: [{ id: 'season-1' }] as T[] };
        }
        if (text.includes('FROM deck_classifier_settings')) {
          return {
            rows: [
              {
                card_display_mode: 'BOTH',
                card_show_usage: true,
                card_show_winner: true,
                card_show_top_ranked: true,
                top_ranked_player_count: 40,
              },
            ] as T[],
          };
        }
        return {
          rows: [
            statsRow(
              observation('match-1', 'FIRST', 'player-a', 'FIRST', [card('CARD-A')], true),
              2,
              1
            ),
            statsRow(observation('match-1', 'SECOND', 'player-b', 'FIRST', [card('CARD-B')]), 2, 1),
          ] as T[],
        };
      },
    };

    const result = await new RankedEnvironmentService(client).getSeasonEnvironment('season-1');

    expect(result).toMatchObject({
      displayMode: 'BOTH',
      visibleSections: ['USAGE', 'WINNER', 'TOP_RANKED'],
      topRankedPlayerCount: 40,
      sample: { settledMatchCount: 2, analyzedMatchCount: 1, topRankedEligiblePlayerCount: 1 },
    });
    expect(queries).toHaveLength(3);
    expect(queries[1]?.text).toContain('card_display_mode');
    expect(queries[2]?.text).toContain('winner_seat');
    expect(queries[2]?.text).toContain('ranked_player_ratings');
    expect(queries[2]?.values).toEqual(['season-1', 40, true]);
    expect(queries.map(({ text }) => text).join('\n')).not.toContain('deck_classifier_releases');
  });

  it('returns a hidden response without reading ranked observations', async () => {
    const queries: string[] = [];
    const client: RankedEnvironmentQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        queries.push(text);
        if (text.includes('FROM ranked_seasons')) return { rows: [{ id: 'season-1' }] as T[] };
        return {
          rows: [
            {
              card_display_mode: 'HIDDEN',
              card_show_usage: false,
              card_show_winner: false,
              card_show_top_ranked: false,
              top_ranked_player_count: 30,
            },
          ] as T[],
        };
      },
    };

    const result = await new RankedEnvironmentService(client).getSeasonEnvironment('season-1');

    expect(result).toMatchObject({
      displayMode: 'HIDDEN',
      visibleSections: [],
      rankings: [],
      sample: { settledMatchCount: 0, analyzedMatchCount: 0 },
    });
    expect(queries).toHaveLength(2);
  });

  it('returns an empty sample from the same statistics statement', async () => {
    const client: RankedEnvironmentQueryClient = {
      async query<T>(text: string) {
        await Promise.resolve();
        if (text.includes('FROM ranked_seasons') && !text.includes('WITH season_settings')) {
          return { rows: [{ id: 'season-1' }] as T[] };
        }
        if (text.includes('FROM deck_classifier_settings')) {
          return {
            rows: [
              {
                card_display_mode: 'PLAYER_EQUAL',
                card_show_usage: true,
                card_show_winner: false,
                card_show_top_ranked: false,
                top_ranked_player_count: 30,
              },
            ] as T[],
          };
        }
        return {
          rows: [
            {
              settled_match_count: '3',
              top_ranked_eligible_player_count: '0',
              match_id: null,
              seat: null,
              user_id: null,
              winner_seat: null,
              top_ranked: null,
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
      winningPlayerCount: 0,
      topRankedEligiblePlayerCount: 0,
      topRankedAnalyzedPlayerCount: 0,
      topRankedDeckObservationCount: 0,
      coverageRate: 0,
    });
    expect(result.rankings).toEqual([{ section: 'USAGE', weighting: 'PLAYER_EQUAL', cards: [] }]);
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

function statsRow(
  row: ReturnType<typeof observation>,
  settledMatchCount: number,
  topRankedEligiblePlayerCount: number
) {
  return {
    settled_match_count: String(settledMatchCount),
    top_ranked_eligible_player_count: String(topRankedEligiblePlayerCount),
    match_id: row.match_id,
    seat: row.seat,
    user_id: row.user_id,
    winner_seat: row.winner_seat,
    top_ranked: row.top_ranked,
    main_deck_cards: row.main_deck_cards,
  };
}
