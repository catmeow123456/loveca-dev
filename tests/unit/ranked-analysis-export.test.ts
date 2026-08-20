import { describe, expect, it } from 'vitest';
import {
  buildRankedAnalysisExportFiles,
  createRankedAnalysisZip,
  type RankedAnalysisExportSource,
} from '../../src/server/services/ranked-analysis-export';
import JSZip from 'jszip';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const MATCH = 'private-match-id';
const EVENT = '33333333-3333-4333-8333-333333333333';
const DECK = `sha256:${'a'.repeat(64)}`;
const AT = '2026-08-01T12:00:00.000Z';

function source(): RankedAnalysisExportSource {
  return {
    season: {
      season_key: 'ranked-2026-08',
      name: '八月排位',
      lifecycle: 'ACTIVE',
      starts_at: '2026-08-01T00:00:00.000Z',
      scheduled_ends_at: '2026-09-01T00:00:00.000Z',
      closed_at: null,
      rules_version: 'rules-v1',
      card_catalog_version: 'cards-v1',
      card_catalog_hash: `sha256:${'b'.repeat(64)}`,
      deck_policy_version: 'deck-v1',
      rating_algorithm_version: 'GLICKO1_PER_MATCH_V2',
      rating_config: { initialRating: 1500 },
      leaderboard_minimum_match_count: 10,
      ledger_revision: 1,
    },
    matches: [
      {
        match_id: MATCH,
        first_user_id: ALICE,
        second_user_id: BOB,
        rating_status: 'SETTLED',
        winner_seat: 'FIRST',
        result_type: 'NORMAL',
        used_free: false,
        rules_version: 'rules-v1',
        card_catalog_version: 'cards-v1',
        card_catalog_hash: `sha256:${'b'.repeat(64)}`,
        deck_policy_version: 'deck-v1',
        rating_algorithm_version: 'GLICKO1_PER_MATCH_V2',
        ended_at: AT,
        settled_at: AT,
        created_at: AT,
      },
    ],
    ratingEvents: [
      {
        id: EVENT,
        event_sequence: 1,
        event_type: 'SETTLEMENT',
        match_id: MATCH,
        target_event_id: null,
        first_user_id: ALICE,
        second_user_id: BOB,
        winner_seat: 'FIRST',
        result_type: 'NORMAL',
        rated_at: AT,
        algorithm_version: 'GLICKO1_PER_MATCH_V2',
        created_at: AT,
      },
    ],
    ratingSteps: [
      {
        event_id: EVENT,
        step_index: 0,
        source_result_event_id: EVENT,
        match_id: MATCH,
        first_user_id: ALICE,
        second_user_id: BOB,
        winner_seat: 'FIRST',
        rated_at: AT,
        first_before_rating: 1500,
        first_before_deviation: 300,
        first_before_match_count: 0,
        first_before_last_rated_at: null,
        first_after_rating: 1600,
        first_after_deviation: 250,
        first_after_match_count: 1,
        first_after_last_rated_at: AT,
        second_before_rating: 1500,
        second_before_deviation: 300,
        second_before_match_count: 0,
        second_before_last_rated_at: null,
        second_after_rating: 1400,
        second_after_deviation: 250,
        second_after_match_count: 1,
        second_after_last_rated_at: AT,
        created_at: AT,
      },
    ],
    seeds: [
      {
        user_id: ALICE,
        source_season_key: null,
        rating: 1500,
        rating_deviation: 300,
        created_at: AT,
      },
    ],
    projections: [
      {
        user_id: ALICE,
        rating: 1600,
        rating_deviation: 250,
        rated_match_count: 1,
        last_rated_at: AT,
        ledger_revision: 1,
        updated_at: AT,
      },
    ],
    deckObservations: [
      {
        match_id: MATCH,
        seat: 'FIRST',
        user_id: ALICE,
        deck_fingerprint: DECK,
        main_deck_cards: [
          {
            baseCardCode: 'PL!-sd1-001',
            cardCode: 'PL!-sd1-001-SD',
            name: '高坂穗乃果',
            cardType: 'MEMBER',
            count: 4,
            imageFilename: 'private-image-name.webp',
          },
        ],
        observed_at: AT,
      },
      {
        match_id: MATCH,
        seat: 'SECOND',
        user_id: BOB,
        deck_fingerprint: DECK,
        main_deck_cards: [
          {
            baseCardCode: 'PL!-sd1-001',
            cardCode: 'PL!-sd1-001-SD',
            name: '高坂穗乃果',
            cardType: 'MEMBER',
            count: 4,
          },
        ],
        observed_at: AT,
      },
    ],
  };
}

describe('ranked analysis export', () => {
  it('exports raw rating and normalized deck tables without private identifiers or replay data', () => {
    const exported = buildRankedAnalysisExportFiles(source(), new Date('2026-08-20T00:00:00Z'));
    const allContent = Object.values(exported.files).join('\n');

    expect(Object.keys(exported.files).sort()).toEqual([
      'deck_cards.csv',
      'deck_observations.csv',
      'manifest.json',
      'matches.csv',
      'player_projections.csv',
      'player_seeds.csv',
      'rating_events.csv',
      'rating_steps.csv',
    ]);
    expect(exported.filename).toBe('loveca-ranked-analysis-ranked-2026-08-20260820T000000000Z.zip');
    expect(exported.files['matches.csv']).toContain(
      'match_000001,player_000001,player_000002,SETTLED,FIRST,NORMAL'
    );
    expect(exported.files['rating_steps.csv']).toContain(
      'event_000001,0,event_000001,match_000001'
    );
    expect(exported.files['deck_observations.csv']?.match(/deck_000001/g)).toHaveLength(2);
    expect(exported.files['deck_cards.csv']).toContain(
      'deck_000001,PL!-sd1-001,PL!-sd1-001-SD,高坂穗乃果,MEMBER,4'
    );
    expect(allContent).not.toContain(ALICE);
    expect(allContent).not.toContain(BOB);
    expect(allContent).not.toContain(MATCH);
    expect(allContent).not.toContain(EVENT);
    expect(allContent).not.toContain(DECK);
    expect(allContent).not.toContain('private-image-name.webp');
    expect(allContent).not.toContain('checkpoint_payload');

    const manifest = JSON.parse(exported.files['manifest.json'] ?? '{}') as {
      rowCounts: { uniqueDecks: number; deckObservations: number };
      excluded: string[];
    };
    expect(manifest.rowCounts).toMatchObject({ uniqueDecks: 1, deckObservations: 2 });
    expect(manifest.excluded.join('\n')).toContain('authority checkpoint');
    expect(manifest.excluded.join('\n')).toContain('完整对局记录');
  });

  it('rejects conflicting card contents for the same normalized deck identity', () => {
    const input = source();
    const second = input.deckObservations[1];
    if (!second) throw new Error('missing fixture observation');

    expect(() =>
      buildRankedAnalysisExportFiles({
        ...input,
        deckObservations: [
          input.deckObservations[0]!,
          {
            ...second,
            main_deck_cards: [
              {
                baseCardCode: 'PL!-sd1-002',
                cardCode: 'PL!-sd1-002-SD',
                name: '绚濑绘里',
                cardType: 'MEMBER',
                count: 4,
              },
            ],
          },
        ],
      })
    ).toThrow('同一卡组指纹对应的卡组观察内容不一致');
  });

  it('packages every declared raw table into a readable ZIP', async () => {
    const exported = await createRankedAnalysisZip(source(), new Date('2026-08-20T00:00:00.000Z'));
    const zip = await JSZip.loadAsync(exported.buffer);

    expect(Object.keys(zip.files).sort()).toEqual([
      'deck_cards.csv',
      'deck_observations.csv',
      'manifest.json',
      'matches.csv',
      'player_projections.csv',
      'player_seeds.csv',
      'rating_events.csv',
      'rating_steps.csv',
    ]);
    expect(await zip.file('manifest.json')?.async('text')).toContain(
      'loveca-ranked-analysis-export-v1'
    );
  });
});
