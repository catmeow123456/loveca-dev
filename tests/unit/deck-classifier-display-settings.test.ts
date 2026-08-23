import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const release = vi.fn();
  return {
    query,
    release,
    connect: vi.fn(() => Promise.resolve({ query, release })),
  };
});

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    connect: mocks.connect,
    query: mocks.query,
  },
}));

import { DeckClassifierAdminService } from '../../src/server/services/deck-classifier-admin-service';

const BEFORE = {
  id: '11111111-1111-4111-8111-111111111111',
  archetype_key: 'test',
  name: '测试卡组',
  group_name: '测试',
  description: '',
  color_key: '#123456',
  representative_card_code: null,
  sort_order: 10,
  lifecycle: 'ACTIVE',
  template_count: '2',
  rule_count: '1',
  created_at: '2026-08-23T00:00:00.000Z',
  updated_at: '2026-08-23T00:00:00.000Z',
};

describe('deck classifier live display settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation((text: string) => {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('SELECT card_type FROM cards')) {
        return Promise.resolve({ rows: [{ card_type: 'MEMBER' }] });
      }
      if (text.includes('FROM deck_classifier_settings') && text.includes('FOR UPDATE')) {
        return Promise.resolve({
          rows: [
            {
              display_mode: 'BOTH',
              show_usage: true,
              show_winner: true,
              show_top_ranked: false,
              top_ranked_player_count: 30,
            },
          ],
        });
      }
      if (text.includes('UPDATE deck_classifier_settings')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('SELECT') && text.includes('FROM deck_archetypes AS archetype')) {
        return Promise.resolve({ rows: [BEFORE] });
      }
      if (text.includes('UPDATE deck_archetypes')) {
        return Promise.resolve({
          rows: [
            {
              ...BEFORE,
              color_key: '#ABCDEF',
              representative_card_code: 'PL!-bp1-001-P',
              updated_at: '2026-08-23T01:00:00.000Z',
            },
          ],
        });
      }
      if (text.includes('INSERT INTO management_audit_logs')) {
        return Promise.resolve({ rows: [] });
      }
      throw new Error(`Unexpected query: ${text}`);
    });
  });

  it('updates representative card and color without touching draft revision or classification jobs', async () => {
    const result = await new DeckClassifierAdminService().updateArchetypeDisplay(
      BEFORE.id,
      {
        color: '#ABCDEF',
        representativeCardCode: 'PL!-bp1-001-P',
        reason: '调整玩家端卡组封面',
      },
      {
        actorUserId: '22222222-2222-4222-8222-222222222222',
        actorRole: 'season_admin',
        requestId: 'request-display-1',
      }
    );

    expect(result).toMatchObject({
      color: '#ABCDEF',
      representativeCardCode: 'PL!-bp1-001-P',
    });
    const sql = mocks.query.mock.calls.map((call) => String(call[0])).join('\n');
    expect(sql).not.toContain('draft_revision');
    expect(sql).not.toContain('deck_classification_runs');
    expect(
      mocks.query.mock.calls.some(
        (call) => Array.isArray(call[1]) && call[1].includes('ARCHETYPE_DISPLAY_UPDATED')
      )
    ).toBe(true);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('updates visible sections and top-ranked size immediately without a classification release', async () => {
    const result = await new DeckClassifierAdminService().updateDisplaySettings(
      {
        displayMode: 'PLAYER_EQUAL',
        visibleSections: ['USAGE', 'TOP_RANKED'],
        topRankedPlayerCount: 40,
        reason: '调整玩家端卡组环境展示内容',
      },
      {
        actorUserId: '22222222-2222-4222-8222-222222222222',
        actorRole: 'season_admin',
        requestId: 'request-display-settings-1',
      }
    );

    expect(result).toEqual({
      displayMode: 'PLAYER_EQUAL',
      visibleSections: ['USAGE', 'TOP_RANKED'],
      topRankedPlayerCount: 40,
    });
    expect(
      mocks.query.mock.calls.some(
        (call) =>
          String(call[0]).includes('UPDATE deck_classifier_settings') &&
          Array.isArray(call[1]) &&
          call[1].slice(0, 5).join(',') === 'PLAYER_EQUAL,true,false,true,40'
      )
    ).toBe(true);
    const sql = mocks.query.mock.calls.map((call) => String(call[0])).join('\n');
    expect(sql).not.toContain('draft_revision = draft_revision + 1');
    expect(sql).not.toContain('deck_classification_runs');
  });

  it('maps an empty visible-section selection to the persisted hidden mode', async () => {
    const result = await new DeckClassifierAdminService().updateDisplaySettings(
      {
        displayMode: 'BOTH',
        visibleSections: [],
        topRankedPlayerCount: 30,
        reason: '临时隐藏玩家端全部卡组环境',
      },
      {
        actorUserId: '22222222-2222-4222-8222-222222222222',
        actorRole: 'season_admin',
        requestId: 'request-hide-display-1',
      }
    );

    expect(result).toEqual({
      displayMode: 'HIDDEN',
      visibleSections: [],
      topRankedPlayerCount: 30,
    });
    expect(
      mocks.query.mock.calls.some(
        (call) =>
          String(call[0]).includes('UPDATE deck_classifier_settings') &&
          Array.isArray(call[1]) &&
          call[1].slice(0, 5).join(',') === 'HIDDEN,false,false,false,30'
      )
    ).toBe(true);
  });
});
