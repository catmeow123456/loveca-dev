import { describe, expect, it } from 'vitest';
import {
  DECK_FINGERPRINT_VERSION,
  classifyDeck,
  fingerprintNormalizedDeck,
  normalizeDeck,
  serializeDeckFingerprintPayload,
  type DeckArchetypeTemplate,
  type DeckCardInput,
  type DeckClassifierSnapshot,
} from '../../src/server/services/deck-classifier-engine';
import { buildRankedDeckObservation } from '../../src/server/services/ranked-deck-observation-service';

function baseDeck(prefix = 'BASE'): DeckCardInput[] {
  return [
    ...Array.from({ length: 12 }, (_, index) => ({
      baseCardCode: `${prefix}-member-${String(index + 1).padStart(3, '0')}`,
      cardType: 'MEMBER' as const,
      count: 4,
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      baseCardCode: `${prefix}-live-${String(index + 1).padStart(3, '0')}`,
      cardType: 'LIVE' as const,
      count: 4,
    })),
  ];
}

function replaceCopies(
  cards: readonly DeckCardInput[],
  cardType: 'MEMBER' | 'LIVE',
  fromCode: string,
  toCode: string,
  count: number
): DeckCardInput[] {
  const retainedCards = cards
    .map((card) =>
      card.cardType === cardType && card.baseCardCode === fromCode
        ? { ...card, count: card.count - count }
        : card
    )
    .filter((card) => card.count > 0);
  return retainedCards.concat({ baseCardCode: toCode, cardType, count });
}

function template(
  templateId: string,
  archetypeId: string,
  cards: readonly DeckCardInput[]
): DeckArchetypeTemplate {
  return { templateId, archetypeId, cards };
}

function snapshot(
  overrides: Omit<DeckClassifierSnapshot, 'classifierVersion'> = {}
): DeckClassifierSnapshot {
  return { classifierVersion: 'classifier-test-v1', ...overrides };
}

function fingerprint(cards: readonly DeckCardInput[]): string {
  const normalized = normalizeDeck(cards);
  if (!normalized.valid) throw new Error('测试卡组无效');
  return fingerprintNormalizedDeck(normalized.deck);
}

describe('deck classifier normalization and fingerprint protocol', () => {
  it('按基础编号聚合不同罕度，并让顺序不影响带版本的确定性指纹', () => {
    const cards = baseDeck();
    cards.splice(0, 1, {
      cardCode: 'PL!N-bp1-001-P',
      cardType: 'MEMBER',
      count: 2,
    });
    cards.push({
      cardCode: 'PL!N-bp1-001-SEC',
      cardType: 'MEMBER',
      count: 2,
    });
    const normal = normalizeDeck(cards);
    const reversed = normalizeDeck([...cards].reverse());

    expect(normal.valid).toBe(true);
    expect(reversed.valid).toBe(true);
    if (!normal.valid || !reversed.valid) return;
    expect(normal.deck.members).toContainEqual({ baseCardCode: 'PL!N-bp1-001', count: 4 });
    expect(fingerprintNormalizedDeck(normal.deck)).toBe(fingerprintNormalizedDeck(reversed.deck));
    expect(fingerprintNormalizedDeck(normal.deck)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(DECK_FINGERPRINT_VERSION).toBe('loveca-deck-v1');
    expect(serializeDeckFingerprintPayload(normal.deck)).toContain(
      `{"baseCardCode":"PL!N-bp1-001","count":4}`
    );
    expect(fingerprintNormalizedDeck(normal.deck)).toBe(
      'sha256:205bfb53821628fdd0b30198ec8a0e4bef4a403231c997cb88e25de6dabd2fce'
    );
  });

  it('与 ranked_deck_observations 的既有指纹协议完全一致', () => {
    const mainDeck: string[] = [];
    const cardSummaries: Record<string, Record<string, unknown>> = {};
    const classifierCards: DeckCardInput[] = [];
    for (let index = 1; index <= 15; index += 1) {
      const baseCardCode = `PL!N-bp1-${String(index).padStart(3, '0')}`;
      const cardCode = `${baseCardCode}-${index % 5 === 0 ? 'L' : 'P'}`;
      const cardType = index % 5 === 0 ? ('LIVE' as const) : ('MEMBER' as const);
      mainDeck.push(cardCode, cardCode, cardCode, cardCode);
      cardSummaries[cardCode] = { cardCode, name: `测试卡 ${index}`, cardType };
      classifierCards.push({ cardCode, cardType, count: 4 });
    }

    const observation = buildRankedDeckObservation({
      seasonId: 'season-1',
      matchId: 'match-1',
      seat: 'FIRST',
      userId: 'user-1',
      mainDeck,
      cardSummaries,
      observedAt: '2026-08-23T00:00:00.000Z',
    });

    expect(fingerprint(classifierCards)).toBe(observation.deckFingerprint);
  });

  it('拒绝不是 48 MEMBER + 12 LIVE = 60 的卡组', () => {
    const cards = baseDeck();
    cards[0] = { ...cards[0]!, count: 3 };

    const result = classifyDeck(cards, snapshot());

    expect(result).toMatchObject({
      decision: 'INVALID',
      method: 'INVALID',
      accepted: false,
      archetypeId: null,
      reason: 'INVALID_DECK',
      deckFingerprint: null,
    });
    expect(result.evidence.validationIssues.map((issue) => issue.code)).toEqual([
      'INVALID_MEMBER_TOTAL',
      'INVALID_DECK_TOTAL',
    ]);
  });
});

describe('deck classifier precedence and structured rules', () => {
  it('人工锁定优先于精确模板和特殊规则', () => {
    const cards = baseDeck();
    const deckFingerprint = fingerprint(cards);
    const result = classifyDeck(
      cards,
      snapshot({
        manualMappings: [
          { mappingId: 'manual-1', deckFingerprint, archetypeId: 'manual-archetype' },
        ],
        templates: [template('template-1', 'exact-archetype', cards)],
        rules: [
          {
            ruleId: 'rule-1',
            archetypeId: 'rule-archetype',
            conditions: {
              includeAll: [{ baseCardCode: 'BASE-live-001', cardType: 'LIVE', minCount: 4 }],
            },
          },
        ],
      })
    );

    expect(result).toMatchObject({
      decision: 'CLASSIFIED',
      method: 'MANUAL',
      accepted: true,
      archetypeId: 'manual-archetype',
      reason: 'MANUAL_MAPPING_MATCH',
    });
    expect(result.evidence.matchedMappingIds).toEqual(['manual-1']);
  });

  it('精确模板优先于规则，停用模板不参与精确命中', () => {
    const cards = baseDeck();
    const result = classifyDeck(
      cards,
      snapshot({
        templates: [
          template('active-template', 'exact-archetype', cards),
          { ...template('disabled-template', 'disabled-archetype', cards), active: false },
        ],
        rules: [
          {
            ruleId: 'rule-1',
            archetypeId: 'rule-archetype',
            conditions: {
              includeAll: [{ baseCardCode: 'BASE-live-001', cardType: 'LIVE', minCount: 2 }],
            },
          },
        ],
      })
    );

    expect(result).toMatchObject({
      method: 'EXACT',
      archetypeId: 'exact-archetype',
      reason: 'EXACT_FINGERPRINT_MATCH',
    });
    expect(result.evidence.matchedMappingIds).toEqual(['template:active-template']);
  });

  it('用结构化包含、禁含与合计条件匹配规则，并拒绝不同类别的规则冲突', () => {
    const cards = baseDeck();
    const result = classifyDeck(
      cards,
      snapshot({
        rules: [
          {
            ruleId: 'rule-a',
            archetypeId: 'archetype-a',
            conditions: {
              includeAll: [{ baseCardCode: 'BASE-live-001', cardType: 'LIVE', minCount: 2 }],
              forbidAny: [{ baseCardCode: 'FORBIDDEN-live-001', cardType: 'LIVE' }],
              countSums: [
                {
                  baseCardCodes: ['BASE-live-001', 'BASE-live-002'],
                  cardType: 'LIVE',
                  minCount: 8,
                },
              ],
            },
          },
          {
            ruleId: 'rule-b',
            archetypeId: 'archetype-b',
            conditions: {
              includeAny: [{ baseCardCode: 'BASE-live-003', cardType: 'LIVE', minCount: 4 }],
              forbidAny: [{ baseCardCode: 'FORBIDDEN-member-001', cardType: 'MEMBER' }],
            },
          },
        ],
      })
    );

    expect(result).toMatchObject({
      decision: 'AMBIGUOUS',
      method: 'AMBIGUOUS',
      accepted: false,
      archetypeId: null,
      reason: 'RULE_CONFLICT',
    });
    expect(result.evidence.matchedRules).toEqual([
      { ruleId: 'rule-a', archetypeId: 'archetype-a' },
      { ruleId: 'rule-b', archetypeId: 'archetype-b' },
    ]);
  });

  it('只在数字最小的最高优先级命中组内判断规则冲突', () => {
    const result = classifyDeck(
      baseDeck(),
      snapshot({
        rules: [
          {
            ruleId: 'high-priority',
            archetypeId: 'archetype-a',
            priority: 10,
            conditions: {
              includeAll: [{ baseCardCode: 'BASE-live-001', cardType: 'LIVE', minCount: 2 }],
            },
          },
          {
            ruleId: 'low-priority',
            archetypeId: 'archetype-b',
            priority: 100,
            conditions: {
              includeAll: [{ baseCardCode: 'BASE-live-002', cardType: 'LIVE', minCount: 2 }],
            },
          },
        ],
      })
    );

    expect(result).toMatchObject({
      decision: 'CLASSIFIED',
      method: 'RULE',
      archetypeId: 'archetype-a',
      reason: 'SPECIAL_RULE_MATCH',
    });
    expect(result.evidence.matchedRules).toEqual([
      { ruleId: 'high-priority', archetypeId: 'archetype-a' },
    ]);
  });
});

describe('deck classifier weighted multi-template similarity', () => {
  it('类别距离取该类最近模板，同类第二模板不充当第二名类别', () => {
    const query = baseDeck();
    const archetypeAFirst = replaceCopies(query, 'MEMBER', 'BASE-member-001', 'A-member-tech', 2);
    const archetypeASecond = replaceCopies(query, 'LIVE', 'BASE-live-001', 'A-live-tech', 1);
    const archetypeB = replaceCopies(
      replaceCopies(query, 'MEMBER', 'BASE-member-002', 'B-member-tech-1', 4),
      'MEMBER',
      'BASE-member-003',
      'B-member-tech-2',
      1
    );

    const result = classifyDeck(
      query,
      snapshot({
        templates: [
          template('a-first', 'archetype-a', archetypeAFirst),
          template('a-second', 'archetype-a', archetypeASecond),
          template('b-first', 'archetype-b', archetypeB),
        ],
      })
    );

    expect(result).toMatchObject({
      decision: 'CLASSIFIED',
      method: 'SIMILARITY',
      archetypeId: 'archetype-a',
      reason: 'SIMILARITY_ACCEPTED',
    });
    expect(result.evidence.similarity).toMatchObject({
      memberWeight: 1,
      liveWeight: 3,
      maxDistance: 42,
      minMargin: 3,
      best: { archetypeId: 'archetype-a', distance: 2, nearestTemplateId: 'a-first' },
      secondBest: { archetypeId: 'archetype-b', distance: 5 },
      margin: 3,
    });
    expect(result.evidence.similarity?.candidates).toHaveLength(2);
  });

  it('最佳距离超过阈值时拒识为 unknown', () => {
    const result = classifyDeck(
      baseDeck('QUERY'),
      snapshot({ templates: [template('far', 'far-archetype', baseDeck('TEMPLATE'))] })
    );

    expect(result).toMatchObject({
      decision: 'UNKNOWN',
      method: 'UNKNOWN',
      reason: 'DISTANCE_EXCEEDED',
      accepted: false,
      archetypeId: null,
    });
    expect(result.evidence.similarity?.best?.distance).toBe(84);
  });

  it('最佳与第二类别的 margin 小于阈值时拒识为 ambiguous', () => {
    const query = baseDeck();
    const archetypeA = replaceCopies(query, 'MEMBER', 'BASE-member-001', 'A-member-tech', 1);
    const archetypeB = replaceCopies(query, 'MEMBER', 'BASE-member-002', 'B-member-tech', 2);

    const result = classifyDeck(
      query,
      snapshot({
        templates: [
          template('a', 'archetype-a', archetypeA),
          template('b', 'archetype-b', archetypeB),
        ],
      })
    );

    expect(result).toMatchObject({
      decision: 'AMBIGUOUS',
      method: 'AMBIGUOUS',
      reason: 'MARGIN_TOO_SMALL',
      accepted: false,
      archetypeId: null,
    });
    expect(result.evidence.similarity).toMatchObject({ margin: 1 });
  });
});
