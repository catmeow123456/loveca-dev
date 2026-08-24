import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  fingerprintNormalizedDeck,
  normalizeDeck,
  type DeckCardInput,
} from '../../src/server/services/deck-classifier-engine';
import { readDeckClassifierSeedPackage } from '../../src/server/services/deck-classifier-seed-package';

describe('deck classifier seed package', () => {
  it('验证指纹和 48+12 卡组，保留 provisional 为停用样板且不把软签名变成硬规则', async () => {
    const cards = seedCards();
    const normalized = normalizeDeck(cards);
    if (!normalized.valid) throw new Error('测试卡组无效');
    const fingerprint = fingerprintNormalizedDeck(normalized.deck);
    const memberCounts = countMap(cards, 'MEMBER');
    const liveCounts = countMap(cards, 'LIVE');
    const zip = new JSZip();
    zip.file(
      'package/02_archetypes.seed.json',
      JSON.stringify({
        catalogVersion: 'test-v1',
        archetypes: [
          {
            archetypeId: 'test_a',
            displayName: '测试 A',
            group: '测试',
            status: 'confirmed',
            notes: '仅用于测试',
          },
        ],
      })
    );
    zip.file(
      'package/04_deck_templates.seed.jsonl',
      JSON.stringify({
        deckFingerprint: fingerprint,
        archetypeId: 'test_a',
        displayName: '测试 A',
        labelStatus: 'provisional',
        activeTemplate: false,
        observationCount: 2,
        memberCounts,
        liveCounts,
      })
    );
    zip.file(
      'package/05_special_rules.seed.json',
      JSON.stringify({
        ruleVersion: 'rule-v1',
        rules: [
          {
            ruleId: 'test_rule_v1',
            archetypeId: 'test_a',
            displayName: '测试 A',
            enabled: true,
            scope: { cardType: 'LIVE' },
            conditions: {
              all: [{ baseCardCode: 'PL!N-bp1-101-L', minCount: 2 }],
              sumAtLeast: {
                baseCardCodes: ['PL!N-bp1-101-L', 'PL!N-bp1-102-SEC'],
                minCount: 6,
              },
            },
          },
        ],
        softSignatures: [{ signatureId: 'hint-only' }],
      })
    );

    const parsed = await readDeckClassifierSeedPackage(
      await zip.generateAsync({ type: 'uint8array' })
    );

    expect(parsed).toMatchObject({
      catalogVersion: 'test-v1',
      ruleVersion: 'rule-v1',
      activeTemplateCount: 0,
      provisionalTemplateCount: 1,
      ignoredSoftSignatureCount: 1,
    });
    expect(parsed.archetypes).toHaveLength(1);
    expect(parsed.archetypes[0]?.color).toMatch(/^#[0-9A-F]{6}$/);
    expect(parsed.templates[0]).toMatchObject({ deckFingerprint: fingerprint, enabled: false });
    expect(parsed.rules[0]).toMatchObject({
      sourceKey: 'test_rule_v1',
      archetypeKey: 'test_a',
      enabled: true,
      definition: {
        includeAll: [{ baseCardCode: 'PL!N-bp1-101', cardType: 'LIVE', minCount: 2 }],
        countSums: [
          {
            baseCardCodes: ['PL!N-bp1-101', 'PL!N-bp1-102'],
            cardType: 'LIVE',
            minCount: 6,
          },
        ],
      },
    });
  });
});

function seedCards(): DeckCardInput[] {
  return [
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
}

function countMap(
  cards: readonly DeckCardInput[],
  cardType: 'MEMBER' | 'LIVE'
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const card of cards) {
    if (card.cardType !== cardType) continue;
    if (!card.baseCardCode) throw new Error('测试卡牌缺少基础卡号');
    result[card.baseCardCode] = card.count;
  }
  return result;
}
