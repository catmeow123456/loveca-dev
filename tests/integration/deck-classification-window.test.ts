import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckClassificationScopeMode } from '../../src/online/deck-classifier-types';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
vi.mock('../../src/server/db/pool.js', () => ({ pool: mocks }));
vi.mock('../../src/server/services/management-audit-service.js', () => ({
  writeManagementAudit: vi.fn(),
}));
import { DeckClassificationWorker } from '../../src/server/services/deck-classification-worker';
import {
  buildDeckClassifierSnapshot,
  hashDeckClassifierSnapshot,
} from '../../src/server/services/deck-classifier-release';
import { RankedDeckArchetypeEnvironmentService } from '../../src/server/services/ranked-deck-archetype-environment-service';
import { CLASSIFICATION_OBSERVATIONS_QUERY } from '../../src/server/services/deck-classification-scope';
import { DeckClassifierAdminService } from '../../src/server/services/deck-classifier-admin-service';

const season = '11111111-1111-4111-8111-111111111111';
const oldRelease = '22222222-2222-4222-8222-222222222222';
const newRelease = '33333333-3333-4333-8333-333333333333';
const oldRun = '44444444-4444-4444-8444-444444444444';
const archetype = '55555555-5555-4555-8555-555555555555';
const retired = '66666666-6666-4666-8666-666666666666';
const firstUser = '77777777-7777-4777-8777-777777777777';
const secondUser = '88888888-8888-4888-8888-888888888888';
const cards = [
  ...Array.from({ length: 12 }, (_, i) => ({
    baseCardCode: `M${i}`,
    cardType: 'MEMBER' as const,
    count: 4,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    baseCardCode: `L${i}`,
    cardType: 'LIVE' as const,
    count: 4,
  })),
];
function snapshot(version: number) {
  return buildDeckClassifierSnapshot({
    releaseVersion: version,
    archetypes: [archetype, retired].map((id, i) => ({
      id,
      archetype_key: `type${i}`,
      name: i ? '历史分类' : '当前分类',
      group_name: '测试',
      description: '',
      sort_order: i,
    })),
    templates: [{ id: '99999999-9999-4999-8999-999999999999', archetype_id: archetype, cards }],
    rules: [],
  });
}

// Start with the old schema, then run the actual migration against real PostgreSQL
// in WASM. No external database, accounts, card catalogue or production APIs.
const legacySchema = `
CREATE TABLE deck_classifier_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer UNIQUE, status text,
 snapshot_json jsonb, config_hash text, reason text DEFAULT '', published_by uuid, published_at timestamptz DEFAULT now(), activated_at timestamptz);
CREATE TABLE deck_classification_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), release_id uuid REFERENCES deck_classifier_releases(id),
 status text DEFAULT 'QUEUED', trigger text, scope_season_id uuid, requested_by uuid, request_id text, idempotency_key text UNIQUE, reason text,
 total_count integer DEFAULT 0, processed_count integer DEFAULT 0, classified_count integer DEFAULT 0,
 unknown_count integer DEFAULT 0, ambiguous_count integer DEFAULT 0, invalid_count integer DEFAULT 0,
 excluded_count integer DEFAULT 0, changed_count integer DEFAULT 0, error_message text,
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 UNIQUE(id, release_id));
CREATE UNIQUE INDEX one_running ON deck_classification_runs ((true)) WHERE status = 'RUNNING';
CREATE TABLE ranked_deck_observations (
 match_id text, seat text CHECK(seat IN ('FIRST', 'SECOND')), season_id uuid, user_id uuid,
 deck_fingerprint text, main_deck_cards jsonb, observed_at timestamptz, PRIMARY KEY(match_id, seat));
CREATE TABLE deck_classification_assignments (
 match_id text, seat text, release_id uuid REFERENCES deck_classifier_releases(id), run_id uuid,
 archetype_id uuid, status text, method text, best_distance double precision, second_distance double precision,
 margin double precision, evidence jsonb, classified_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 PRIMARY KEY(match_id, seat, release_id), FOREIGN KEY(match_id,seat) REFERENCES ranked_deck_observations(match_id,seat),
 FOREIGN KEY(run_id,release_id) REFERENCES deck_classification_runs(id,release_id));
CREATE TABLE deck_classification_overrides (
 id uuid DEFAULT gen_random_uuid(), deck_fingerprint text, target_status text, archetype_id uuid, reason text,
 revoked_at timestamptz, applies_to_future_releases boolean, release_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE ranked_seasons (id uuid, lifecycle text DEFAULT 'ACTIVE', leaderboard_minimum_match_count integer DEFAULT 1);
CREATE TABLE ranked_matches (match_id text, season_id uuid, rating_status text, first_user_id uuid, second_user_id uuid, winner_seat text);
CREATE TABLE ranked_player_ratings (season_id uuid, user_id uuid, rated_match_count integer, rating numeric);
CREATE TABLE deck_archetypes (id uuid, color_key text DEFAULT '#123456', representative_card_code text,
 lifecycle text DEFAULT 'ACTIVE', archetype_key text, name text, group_name text DEFAULT '测试', description text DEFAULT '', sort_order integer DEFAULT 0);
CREATE TABLE deck_archetype_templates (id uuid, archetype_id uuid, cards jsonb, enabled boolean DEFAULT true);
CREATE TABLE deck_archetype_rules (id uuid, archetype_id uuid, priority integer, definition jsonb, enabled boolean);
CREATE TABLE cards (card_code text, card_type text, image_filename text);
CREATE TABLE deck_classifier_settings (id integer, display_mode text, show_usage boolean, show_winner boolean, show_top_ranked boolean, top_ranked_player_count integer, draft_revision integer DEFAULT 1);
INSERT INTO deck_classifier_settings(id, display_mode, show_usage, show_winner, show_top_ranked, top_ranked_player_count) VALUES (1, 'BOTH', true, true, true, 30);
`;

describe('classification windows, migration and atomic history retention (PostgreSQL)', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(legacySchema);
    const frozen = snapshot(1);
    await db.query(
      `INSERT INTO deck_classifier_releases(id, version, status, snapshot_json, config_hash, activated_at)
      VALUES ($1, 1, 'ACTIVE', $2, $3, now())`,
      [oldRelease, JSON.stringify(frozen), hashDeckClassifierSnapshot(frozen)]
    );
    await db.query(
      `INSERT INTO deck_classification_runs(id, release_id, status, trigger)
      VALUES ($1, $2, 'SUCCEEDED', 'RELEASE_PUBLISHED')`,
      [oldRun, oldRelease]
    );
    await db.query(
      `INSERT INTO ranked_deck_observations
      SELECT 'match-' || lpad(i::text, 4, '0'), seat, $1::uuid,
        CASE WHEN seat = 'FIRST' THEN $3::uuid ELSE $4::uuid END,
        'same-deck', $2::jsonb, '2026-01-01'::timestamptz + i * interval '1 second'
      FROM generate_series(0, 204) i CROSS JOIN (VALUES ('FIRST'), ('SECOND')) AS seats(seat)`,
      [season, JSON.stringify(cards), firstUser, secondUser]
    );
    await db.query(
      `INSERT INTO deck_classification_assignments(match_id,seat,release_id,run_id,archetype_id,status,method,evidence)
      SELECT match_id,seat,$1,$2,$3,'CLASSIFIED','RULE','{}' FROM ranked_deck_observations`,
      [oldRelease, oldRun, retired]
    );
    await db.query('INSERT INTO ranked_seasons(id) VALUES ($1)', [season]);
    await db.query(
      `INSERT INTO ranked_matches SELECT DISTINCT match_id,season_id,'SETTLED',$1::uuid,$2::uuid,'FIRST'
      FROM ranked_deck_observations`,
      [firstUser, secondUser]
    );
    await db.query('INSERT INTO deck_archetypes(id) VALUES ($1),($2)', [archetype, retired]);
    await db.query(
      "UPDATE deck_archetypes SET archetype_key='current',name='当前分类' WHERE id=$1",
      [archetype]
    );
    await db.query(
      "UPDATE deck_archetypes SET lifecycle='ARCHIVED',archetype_key='retired',name='不应读取的归档草稿名称' WHERE id=$1",
      [retired]
    );
    await db.query(
      'INSERT INTO deck_archetype_templates(id,archetype_id,cards) VALUES ($1,$2,$3)',
      ['99999999-9999-4999-8999-999999999999', archetype, JSON.stringify(cards)]
    );
    for (const card of cards)
      await db.query('INSERT INTO cards(card_code,card_type) VALUES ($1,$2)', [
        card.baseCardCode,
        card.cardType,
      ]);
    await db.exec(readFileSync('drizzle/0047_deck_classifier_recent_window.sql', 'utf8'));
    mocks.connect.mockImplementation(async () => ({ query: db.query.bind(db), release() {} }));
    mocks.query.mockImplementation(db.query.bind(db));
  }, 20_000);
  afterEach(async () => {
    await db?.close();
    vi.resetAllMocks();
  });

  async function queue(
    scope: DeckClassificationScopeMode,
    release = oldRelease,
    trigger = 'MANUAL_RECLASSIFY'
  ) {
    const result = await db.query<{ id: string }>(
      `INSERT INTO deck_classification_runs(release_id,scope_mode,trigger)
      VALUES ($1,$2,$3) RETURNING id`,
      [release, scope, trigger]
    );
    return result.rows[0]!.id;
  }
  async function addRelease() {
    const frozen = snapshot(2);
    await db.query(
      `INSERT INTO deck_classifier_releases(id,version,status,snapshot_json,config_hash)
      VALUES ($1,2,'BUILDING',$2,$3)`,
      [newRelease, JSON.stringify(frozen), hashDeckClassifierSnapshot(frozen)]
    );
  }
  async function recentResults() {
    return (
      await db.query(`SELECT match_id,seat,archetype_id,status,method,best_distance,second_distance,margin,evidence
      FROM deck_classification_assignments WHERE is_current AND match_id >= 'match-0005' ORDER BY match_id,seat`)
    ).rows;
  }

  it('backfills one current result per seat and enforces uniqueness across releases', async () => {
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM deck_classification_assignments WHERE is_current'
        )
      ).rows
    ).toEqual([{ count: 410 }]);
    expect((await db.query('SELECT scope_mode FROM deck_classification_runs')).rows).toEqual([
      { scope_mode: 'FULL' },
    ]);
    await addRelease();
    const run = await queue('RECENT', newRelease, 'RELEASE_PUBLISHED');
    await expect(
      db.query(
        `INSERT INTO deck_classification_assignments(match_id,seat,release_id,run_id,status,method,is_current)
      VALUES ('match-0000','FIRST',$1,$2,'UNKNOWN','UNKNOWN',true)`,
        [newRelease, run]
      )
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('recomputes 200 whole matches and gives identical selected results to a full run', async () => {
    const run = await queue('RECENT');
    await new DeckClassificationWorker().runOnce();
    expect(
      (
        await db.query(
          'SELECT status,total_count,processed_count,changed_count FROM deck_classification_runs WHERE id=$1',
          [run]
        )
      ).rows
    ).toEqual([
      { status: 'SUCCEEDED', total_count: 400, processed_count: 400, changed_count: 400 },
    ]);
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM deck_classification_assignments WHERE run_id=$1',
          [oldRun]
        )
      ).rows
    ).toEqual([{ count: 10 }]);
    const recent = await recentResults();
    await queue('FULL');
    await new DeckClassificationWorker().runOnce();
    expect(await recentResults()).toEqual(recent);
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM deck_classification_assignments WHERE is_current AND archetype_id=$1',
          [archetype]
        )
      ).rows
    ).toEqual([{ count: 410 }]);
  });

  it('keeps older source versions in player statistics after a recent-only release', async () => {
    await addRelease();
    await queue('RECENT', newRelease, 'RELEASE_PUBLISHED');
    await new DeckClassificationWorker().runOnce();
    expect(
      (
        await db.query(`SELECT release_id,count(*)::int AS count FROM deck_classification_assignments
      WHERE is_current GROUP BY release_id ORDER BY release_id`)
      ).rows
    ).toEqual([
      { release_id: oldRelease, count: 10 },
      { release_id: newRelease, count: 400 },
    ]);
    const service = new RankedDeckArchetypeEnvironmentService({ query: db.query.bind(db) });
    const environment = await service.getSeasonEnvironment(season);
    expect(environment.sample.analyzedMatchCount).toBe(205);
    expect(environment.sample.classificationCoverageRate).toBe(1);
    expect(environment.archetypes.find((row) => row.archetypeId === retired)?.appearanceCount).toBe(
      10
    );
    expect(
      environment.archetypes.find((row) => row.archetypeId === archetype)?.appearanceCount
    ).toBe(400);
    expect(await new DeckClassificationWorker().runOnce()).toBe(false);
  });

  it('recomputes every match in a smaller selected season without touching another season', async () => {
    const smallSeason = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await db.query(
      "UPDATE ranked_deck_observations SET season_id=$1 WHERE match_id < 'match-0005'",
      [smallSeason]
    );
    const run = await queue('RECENT');
    await db.query('UPDATE deck_classification_runs SET scope_season_id=$1 WHERE id=$2', [
      smallSeason,
      run,
    ]);
    await new DeckClassificationWorker().runOnce();
    expect(
      (await db.query('SELECT status,total_count FROM deck_classification_runs WHERE id=$1', [run]))
        .rows
    ).toEqual([{ status: 'SUCCEEDED', total_count: 10 }]);
    expect(
      (
        await db.query(`SELECT archetype_id,count(*)::int AS count
        FROM deck_classification_assignments WHERE is_current
        GROUP BY archetype_id ORDER BY archetype_id`)
      ).rows
    ).toEqual([
      { archetype_id: archetype, count: 10 },
      { archetype_id: retired, count: 400 },
    ]);
  });

  it('rolls back earlier batches and preserves the serving version when a build contains invalid data', async () => {
    await addRelease();
    const run = await queue('RECENT', newRelease, 'RELEASE_PUBLISHED');
    await db.query(
      `UPDATE ranked_deck_observations SET deck_fingerprint='invalid', main_deck_cards=$1
      WHERE match_id='match-0204'`,
      [JSON.stringify(cards.slice(1))]
    );
    await new DeckClassificationWorker().runOnce();
    expect(
      (await db.query('SELECT status FROM deck_classification_runs WHERE id=$1', [run])).rows
    ).toEqual([{ status: 'FAILED' }]);
    expect(
      (await db.query('SELECT status FROM deck_classifier_releases WHERE id=$1', [oldRelease])).rows
    ).toEqual([{ status: 'ACTIVE' }]);
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM deck_classification_assignments WHERE release_id=$1',
          [newRelease]
        )
      ).rows
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM deck_classification_assignments WHERE is_current'
        )
      ).rows
    ).toEqual([{ count: 410 }]);
  });

  it('does not queue work for missing history outside the window, and coalesces new observations', async () => {
    await db.query("DELETE FROM deck_classification_assignments WHERE match_id='match-0000'");
    const worker = new DeckClassificationWorker();
    expect(await worker.runOnce()).toBe(false);
    await db.query("DELETE FROM deck_classification_assignments WHERE match_id='match-0204'");
    expect(await worker.runOnce()).toBe(true);
    expect(
      (await db.query("SELECT scope_mode FROM deck_classification_runs WHERE status='QUEUED'")).rows
    ).toEqual([{ scope_mode: 'RECENT' }]);
    await worker.runOnce();
    expect(await worker.runOnce()).toBe(false);
  });

  it('freezes selected inputs and resolves time ties deterministically without splitting a match', async () => {
    await db.query('UPDATE ranked_deck_observations SET observed_at=$1', ['2026-01-01']);
    await db.query(`CREATE TEMP TABLE frozen_targets AS ${CLASSIFICATION_OBSERVATIONS_QUERY}`, [
      null,
      'RECENT',
      200,
    ]);
    await db.query(`INSERT INTO ranked_deck_observations SELECT 'newer-match',seat,season_id,user_id,deck_fingerprint,main_deck_cards,now()
      FROM ranked_deck_observations WHERE match_id='match-0000'`);
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS seats,count(DISTINCT match_id)::int AS matches,min(match_id) AS first FROM frozen_targets'
        )
      ).rows
    ).toEqual([{ seats: 400, matches: 200, first: 'match-0005' }]);
  });

  it('publishes the requested scope, retains archived metadata, and rejects scope changes under the same idempotency key', async () => {
    const service = new DeckClassifierAdminService();
    const operator = {
      actorUserId: firstUser,
      actorRole: 'admin' as const,
      requestId: 'test-request',
    };
    const published = await service.publishRelease(
      1,
      '发布近期窗口测试',
      'publish-window-test',
      operator,
      'RECENT'
    );
    expect(published.run.scopeMode).toBe('RECENT');
    const stored = await db.query<{ snapshot_json: ReturnType<typeof snapshot> }>(
      'SELECT snapshot_json FROM deck_classifier_releases WHERE id=$1',
      [published.release.id]
    );
    expect(stored.rows[0]!.snapshot_json.archetypes.find((row) => row.id === retired)?.name).toBe(
      '历史分类'
    );
    expect(
      (
        await service.publishRelease(
          1,
          '发布近期窗口测试',
          'publish-window-test',
          operator,
          'RECENT'
        )
      ).run.id
    ).toBe(published.run.id);
    await expect(
      service.publishRelease(1, '发布近期窗口测试', 'publish-window-test', operator, 'FULL')
    ).rejects.toMatchObject({ statusCode: 409, code: 'DECK_CLASSIFICATION_IDEMPOTENCY_CONFLICT' });
    await new DeckClassificationWorker().runOnce();
    expect(
      (
        await new RankedDeckArchetypeEnvironmentService({
          query: db.query.bind(db),
        }).getSeasonEnvironment(season)
      ).sample.analyzedMatchCount
    ).toBe(205);
    const full = await service.queueReclassification(
      null,
      '统一全量历史',
      'full-window-test',
      operator,
      'FULL'
    );
    expect(full.scopeMode).toBe('FULL');
    await expect(
      service.queueReclassification(null, '统一全量历史', 'full-window-test', operator, 'RECENT')
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('counts actual changed seats in a preview when the same deck has mixed historical results', async () => {
    await queue('RECENT');
    await new DeckClassificationWorker().runOnce();
    const service = new DeckClassifierAdminService();
    const recent = await service.previewRelease(1, 'RECENT');
    const full = await service.previewRelease(1, 'FULL');
    expect(recent).toMatchObject({
      observationCount: 400,
      classifiedCount: 400,
      changedCount: 0,
    });
    expect(full).toMatchObject({ observationCount: 410, classifiedCount: 410, changedCount: 10 });
  });

  it('shows one review item for a deck with different unresolved historical classifications', async () => {
    await addRelease();
    await queue('RECENT', newRelease, 'RELEASE_PUBLISHED');
    await new DeckClassificationWorker().runOnce();
    await db.query(
      `UPDATE deck_classification_assignments SET archetype_id=NULL,
       status='UNKNOWN',method='UNKNOWN',classified_at='2026-01-01',evidence='{"source":"older"}'
       WHERE is_current AND release_id=$1`,
      [oldRelease]
    );
    await db.query(
      `UPDATE deck_classification_assignments SET archetype_id=NULL,
       status='AMBIGUOUS',method='AMBIGUOUS',classified_at='2026-01-02',evidence='{"source":"newer"}'
       WHERE is_current AND release_id=$1`,
      [newRelease]
    );
    const review = await new DeckClassifierAdminService().listReviewQueue();
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({
      deckFingerprint: 'same-deck',
      status: 'AMBIGUOUS',
      occurrenceCount: 410,
      playerCount: 2,
      seasonCount: 1,
      evidence: { source: 'newer' },
    });
  });

  it('queues different missing matches even when their timestamps and counts are identical', async () => {
    await db.query("UPDATE ranked_deck_observations SET observed_at='2026-01-01'");
    await db.query("DELETE FROM deck_classification_assignments WHERE match_id='match-0204'");
    const worker = new DeckClassificationWorker();
    expect(await worker.runOnce()).toBe(true);
    await worker.runOnce();
    await db.query("DELETE FROM deck_classification_assignments WHERE match_id='match-0203'");
    expect(await worker.runOnce()).toBe(true);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM deck_classification_runs WHERE trigger='AUTO_NEW_OBSERVATIONS'"
        )
      ).rows
    ).toEqual([{ count: 2 }]);
  });
});
