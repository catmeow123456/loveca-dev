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

describe('deck classifier release card-catalog barrier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockImplementation((text: string) => {
      if (
        text === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' ||
        text === 'ROLLBACK' ||
        text === 'COMMIT'
      ) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('SELECT draft_revision FROM deck_classifier_settings')) {
        return Promise.resolve({ rows: [{ draft_revision: 7 }] });
      }
      if (text.includes('SELECT COALESCE(max(version)')) {
        return Promise.resolve({ rows: [{ next_version: 1 }] });
      }
      if (text.includes('FROM deck_archetypes AS archetype') && text.includes('lifecycle')) {
        return Promise.resolve({
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              archetype_key: 'test',
              name: '测试卡组',
              group_name: '测试',
              description: '',
              sort_order: 1,
            },
          ],
        });
      }
      if (text.includes('FROM deck_archetype_templates AS template')) {
        return Promise.resolve({
          rows: [
            {
              id: '22222222-2222-4222-8222-222222222222',
              archetype_id: '11111111-1111-4111-8111-111111111111',
              cards: CARDS,
            },
          ],
        });
      }
      if (text.includes('FROM deck_archetype_rules AS rule')) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('SELECT card_code, card_type') && text.includes('FROM cards')) {
        return Promise.resolve({ rows: [] });
      }
      throw new Error(`Unexpected query: ${text}`);
    });
  });

  it('rejects an otherwise valid draft before preview when a template card is unknown', async () => {
    await expect(new DeckClassifierAdminService().previewRelease(7)).rejects.toMatchObject({
      code: 'DECK_CLASSIFIER_DRAFT_INVALID',
      statusCode: 400,
    });
    await expect(new DeckClassifierAdminService().previewRelease(7)).rejects.toThrow(
      '不存在于卡牌目录'
    );
    expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO'));
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
});
