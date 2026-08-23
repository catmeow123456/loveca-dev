import { describe, expect, it } from 'vitest';
import {
  buildDeckClassifierSnapshot,
  DECK_CLASSIFIER_ALGORITHM_VERSION,
  hashDeckClassifierSnapshot,
  readDeckClassifierSnapshot,
  readRuleConditions,
} from '../../src/server/services/deck-classifier-release.js';

const MEMBER_CARDS = Array.from({ length: 48 }, (_, index) => ({
  baseCardCode: `M-${String(index + 1).padStart(2, '0')}`,
  cardType: 'MEMBER' as const,
  count: 1,
}));
const LIVE_CARDS = Array.from({ length: 12 }, (_, index) => ({
  baseCardCode: `L-${String(index + 1).padStart(2, '0')}`,
  cardType: 'LIVE' as const,
  count: 1,
}));

function snapshot(
  display: { color: string; representativeCardCode: string | null } = {
    color: '#123456',
    representativeCardCode: 'PL!-bp1-001-P',
  }
) {
  const archetype = {
    id: '11111111-1111-4111-8111-111111111111',
    archetype_key: 'test',
    name: '测试卡组',
    group_name: '测试',
    description: '',
    color_key: display.color,
    representative_card_code: display.representativeCardCode,
    sort_order: 1,
  };
  return buildDeckClassifierSnapshot({
    releaseVersion: 3,
    archetypes: [archetype],
    templates: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        archetype_id: '11111111-1111-4111-8111-111111111111',
        cards: [...MEMBER_CARDS, ...LIVE_CARDS],
      },
    ],
    rules: [],
  });
}

describe('deck classifier release snapshot', () => {
  it('uses a stable algorithm version independent from the release number', () => {
    expect(snapshot().classifierVersion).toBe(DECK_CLASSIFIER_ALGORITHM_VERSION);
  });

  it('excludes live display settings from the release snapshot and config hash', () => {
    const before = snapshot({
      color: '#123456',
      representativeCardCode: 'PL!-bp1-001-P',
    });
    const after = snapshot({
      color: '#ABCDEF',
      representativeCardCode: 'PL!-bp2-002-P',
    });

    expect(before.archetypes[0]).not.toHaveProperty('color');
    expect(before.archetypes[0]).not.toHaveProperty('representativeCardCode');
    expect(hashDeckClassifierSnapshot(after)).toBe(hashDeckClassifierSnapshot(before));
  });

  it('replays the thresholds stored in the release instead of current defaults', () => {
    const stored = {
      ...snapshot(),
      memberDistanceWeight: 2,
      liveDistanceWeight: 5,
      maxDistance: 31,
      minMargin: 7,
    };

    expect(readDeckClassifierSnapshot(stored)).toMatchObject({
      memberDistanceWeight: 2,
      liveDistanceWeight: 5,
      maxDistance: 31,
      minMargin: 7,
    });
  });

  it('rejects snapshot versions that the running service cannot replay', () => {
    expect(() =>
      readDeckClassifierSnapshot({ ...snapshot(), classifierVersion: 'future-algorithm-v2' })
    ).toThrow('不支持的分类算法版本');
    expect(() =>
      readDeckClassifierSnapshot({ ...snapshot(), fingerprintVersion: 'future-fingerprint-v2' })
    ).toThrow('不支持的指纹版本');
  });

  it('rejects duplicate card codes that would inflate a sum rule', () => {
    expect(() =>
      readRuleConditions({
        countSums: [{ baseCardCodes: ['LIVE-1', 'LIVE-1'], minCount: 2 }],
      })
    ).toThrow('包含重复卡号');
  });
});
