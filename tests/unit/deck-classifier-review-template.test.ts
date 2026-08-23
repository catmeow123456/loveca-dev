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

const ARCHETYPE_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';
const FINGERPRINT = `sha256:${'a'.repeat(64)}`;
const CARDS = [
  ...Array.from({ length: 12 }, (_, index) => ({
    baseCardCode: `PL!N-bp1-${String(index + 1).padStart(3, '0')}`,
    cardType: 'MEMBER' as const,
    count: 4,
  })),
  ...Array.from({ length: 3 }, (_, index) => ({
    baseCardCode: `PL!N-bp1-${String(index + 101).padStart(3, '0')}`,
    cardType: 'LIVE' as const,
    count: 4,
  })),
];
let authoritativeLiveType: 'MEMBER' | 'LIVE';

describe('deck classifier template creation from review queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authoritativeLiveType = 'LIVE';
    mocks.query.mockImplementation((text: string) => {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('SELECT draft_revision FROM deck_classifier_settings')) {
        return Promise.resolve({ rows: [{ draft_revision: 4 }] });
      }
      if (text.includes('UPDATE deck_classifier_settings')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('SELECT 1 FROM deck_archetypes')) {
        return Promise.resolve({ rows: [{ exists: 1 }] });
      }
      if (text.includes('FROM ranked_deck_observations AS observation')) {
        return Promise.resolve({
          rows: [{ deck_fingerprint: FINGERPRINT, main_deck_cards: CARDS }],
        });
      }
      if (text.includes('SELECT id FROM deck_archetype_templates')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('SELECT card_code, card_type') && text.includes('FROM cards')) {
        return Promise.resolve({
          rows: CARDS.map((card) => ({
            card_code: `${card.baseCardCode}-P`,
            card_type: card.cardType === 'LIVE' ? authoritativeLiveType : card.cardType,
          })),
        });
      }
      if (text.includes('INSERT INTO deck_archetype_templates')) {
        return Promise.resolve({
          rows: [
            {
              id: TEMPLATE_ID,
              archetype_id: ARCHETYPE_ID,
              name: '测试卡组 · 待处理导入',
              deck_fingerprint: FINGERPRINT,
              cards: CARDS,
              source_kind: 'MANUAL',
              source_match_id: null,
              source_seat: null,
              source_note: '从待处理队列导入',
              enabled: true,
              created_at: '2026-08-23T00:00:00.000Z',
              updated_at: '2026-08-23T00:00:00.000Z',
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

  it('copies the current pending observation into an enabled manual draft template', async () => {
    const result = await new DeckClassifierAdminService().createTemplateFromReview(
      {
        expectedDraftRevision: 4,
        archetypeId: ARCHETYPE_ID,
        deckFingerprint: FINGERPRINT,
        name: '测试卡组 · 待处理导入',
        sourceNote: '从待处理队列导入',
        reason: '将人工复核构筑加入草稿样板库',
      },
      {
        actorUserId: '22222222-2222-4222-8222-222222222222',
        actorRole: 'season_admin',
        requestId: 'request-review-template-1',
      }
    );

    expect(result).toMatchObject({
      id: TEMPLATE_ID,
      archetypeId: ARCHETYPE_ID,
      deckFingerprint: FINGERPRINT,
      cards: CARDS,
      sourceKind: 'MANUAL',
      enabled: true,
    });
    const sql = mocks.query.mock.calls.map((call) => String(call[0])).join('\n');
    expect(sql).toContain("assignment.status IN ('UNKNOWN', 'AMBIGUOUS')");
    expect(sql).toContain("'MANUAL'");
    expect(sql).toContain('draft_revision = draft_revision + 1');
    expect(
      mocks.query.mock.calls.some(
        (call) => Array.isArray(call[1]) && call[1].includes('TEMPLATE_CREATED_FROM_REVIEW')
      )
    ).toBe(true);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rejects a pending observation whose declared type disagrees with the card catalog', async () => {
    authoritativeLiveType = 'MEMBER';

    await expect(
      new DeckClassifierAdminService().createTemplateFromReview(
        {
          expectedDraftRevision: 4,
          archetypeId: ARCHETYPE_ID,
          deckFingerprint: FINGERPRINT,
          name: '类型错误样板',
          sourceNote: '',
          reason: '验证权威卡牌类型',
        },
        {
          actorUserId: '22222222-2222-4222-8222-222222222222',
          actorRole: 'season_admin',
          requestId: 'request-review-template-invalid-type',
        }
      )
    ).rejects.toMatchObject({
      code: 'DECK_TEMPLATE_CARD_INVALID',
      statusCode: 400,
    });
    expect(
      mocks.query.mock.calls.some((call) =>
        String(call[0]).includes('INSERT INTO deck_archetype_templates')
      )
    ).toBe(false);
  });
});
