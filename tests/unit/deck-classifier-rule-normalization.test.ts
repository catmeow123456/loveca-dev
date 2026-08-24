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
const RULE_ID = '22222222-2222-4222-8222-222222222222';
let persistedDefinition: unknown;

describe('deck classifier rule persistence normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistedDefinition = undefined;
    mocks.query.mockImplementation((text: string, values?: readonly unknown[]) => {
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
      if (text.includes('SELECT card_code, card_type') && text.includes('FROM cards')) {
        return Promise.resolve({
          rows: [
            { card_code: 'PL!N-bp1-101-L', card_type: 'LIVE' },
            { card_code: 'PL!N-bp1-102-L', card_type: 'LIVE' },
          ],
        });
      }
      if (text.includes('INSERT INTO deck_archetype_rules')) {
        persistedDefinition = parseJsonValue(String(values?.[3]));
        return Promise.resolve({
          rows: [
            {
              id: RULE_ID,
              archetype_id: ARCHETYPE_ID,
              name: 'LIVE 合计测试',
              priority: 100,
              definition: persistedDefinition,
              enabled: true,
              created_at: '2026-08-24T00:00:00.000Z',
              updated_at: '2026-08-24T00:00:00.000Z',
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

  it('writes canonical base card codes instead of the submitted rarity variants', async () => {
    const result = await new DeckClassifierAdminService().createRule(
      {
        expectedDraftRevision: 4,
        archetypeId: ARCHETYPE_ID,
        name: 'LIVE 合计测试',
        priority: 100,
        definition: {
          includeAll: [{ baseCardCode: 'PL!N-bp1-101-L', cardType: 'LIVE', minCount: 2 }],
          countSums: [
            {
              baseCardCodes: ['PL!N-bp1-101-L', 'PL!N-bp1-102-SEC'],
              cardType: 'LIVE',
              minCount: 6,
            },
          ],
        },
        enabled: true,
        reason: '验证规则规范化落库',
      },
      {
        actorUserId: '33333333-3333-4333-8333-333333333333',
        actorRole: 'season_admin',
        requestId: 'request-rule-normalization',
      }
    );

    expect(result.definition).toMatchObject({
      includeAll: [{ baseCardCode: 'PL!N-bp1-101', cardType: 'LIVE', minCount: 2 }],
      countSums: [
        {
          baseCardCodes: ['PL!N-bp1-101', 'PL!N-bp1-102'],
          cardType: 'LIVE',
          minCount: 6,
        },
      ],
    });
    expect(persistedDefinition).toEqual(result.definition);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});

function parseJsonValue(value: string): unknown {
  return JSON.parse(value) as unknown;
}
