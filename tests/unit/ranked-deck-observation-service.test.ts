import { describe, expect, it } from 'vitest';
import {
  buildRankedDeckObservation,
  RankedDeckObservationServiceError,
} from '../../src/server/services/ranked-deck-observation-service';

interface DeckFixture {
  readonly mainDeck: string[];
  readonly cardSummaries: Record<string, Record<string, unknown>>;
}

function createDeckFixture(): DeckFixture {
  const mainDeck: string[] = [];
  const cardSummaries: Record<string, Record<string, unknown>> = {};
  for (let index = 1; index <= 15; index += 1) {
    const baseCardCode = `PL!N-bp1-${String(index).padStart(3, '0')}`;
    const normalCardCode = `${baseCardCode}-N`;
    const parallelCardCode = `${baseCardCode}-P`;
    const cardType = index % 3 === 0 ? 'LIVE' : 'MEMBER';
    const name = `测试卡 ${index}`;
    cardSummaries[normalCardCode] = {
      cardCode: normalCardCode,
      name,
      cardType,
      imageFilename: `${normalCardCode}.webp`,
    };
    cardSummaries[parallelCardCode] = {
      cardCode: parallelCardCode,
      name,
      cardType,
      imageFilename: `${parallelCardCode}.webp`,
    };
    mainDeck.push(
      ...(index === 1
        ? [normalCardCode, parallelCardCode, normalCardCode, parallelCardCode]
        : [normalCardCode, normalCardCode, normalCardCode, normalCardCode])
    );
  }
  return { mainDeck, cardSummaries };
}

function build(fixture: DeckFixture) {
  return buildRankedDeckObservation({
    seasonId: 'season-1',
    matchId: 'match-1',
    seat: 'FIRST',
    userId: 'user-1',
    mainDeck: fixture.mainDeck,
    cardSummaries: fixture.cardSummaries,
    observedAt: '2026-08-09T00:00:00.000Z',
  });
}

describe('ranked deck observation normalization', () => {
  it('合并同基础编号罕度，并生成与输入顺序无关的稳定指纹', () => {
    const fixture = createDeckFixture();
    const normal = build(fixture);
    const reversed = build({ ...fixture, mainDeck: [...fixture.mainDeck].reverse() });

    expect(normal.mainDeckCards).toHaveLength(15);
    expect(normal.mainDeckCards[0]).toEqual({
      baseCardCode: 'PL!N-bp1-001',
      cardCode: 'PL!N-bp1-001-N',
      name: '测试卡 1',
      cardType: 'MEMBER',
      count: 4,
      imageFilename: 'PL!N-bp1-001-N.webp',
    });
    expect(normal.mainDeckCards).toEqual(reversed.mainDeckCards);
    expect(normal.deckFingerprint).toBe(reversed.deckFingerprint);
    expect(normal.deckFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('只用基础编号与张数定义构筑指纹，不受罕度选择影响', () => {
    const mixed = createDeckFixture();
    const parallelOnly = createDeckFixture();
    parallelOnly.mainDeck.splice(
      0,
      4,
      'PL!N-bp1-001-P',
      'PL!N-bp1-001-P',
      'PL!N-bp1-001-P',
      'PL!N-bp1-001-P'
    );

    expect(build(mixed).deckFingerprint).toBe(build(parallelOnly).deckFingerprint);
    expect(build(parallelOnly).mainDeckCards[0]?.cardCode).toBe('PL!N-bp1-001-P');
  });

  it('拒绝非 60 张主卡组、缺失摘要和非主卡组类型', () => {
    const shortDeck = createDeckFixture();
    shortDeck.mainDeck.pop();
    expect(() => build(shortDeck)).toThrowError(RankedDeckObservationServiceError);
    expect(() => build(shortDeck)).toThrow('必须包含 60 张');

    const missingSummary = createDeckFixture();
    delete missingSummary.cardSummaries['PL!N-bp1-001-N'];
    expect(() => build(missingSummary)).toThrow('缺少卡牌 PL!N-bp1-001-N 的摘要');

    const energy = createDeckFixture();
    energy.cardSummaries['PL!N-bp1-001-N']!.cardType = 'ENERGY';
    expect(() => build(energy)).toThrow('摘要不一致或类型无效');
  });
});
