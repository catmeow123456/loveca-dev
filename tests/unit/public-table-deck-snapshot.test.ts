import { describe, expect, it } from 'vitest';
import type { DeckConfig } from '../../src/application/game-service';
import {
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  decodePublicTableRuntimeDeck,
  encodePublicTableRuntimeDeck,
} from '../../src/server/services/public-table-deck-snapshot';
import { CardType, HeartColor } from '../../src/shared/types/enums';

describe('公共牌桌卡组快照', () => {
  it('跨 JSONB 往返后保留 LIVE 必要 Heart 的 Map 结构', () => {
    const live: LiveCardData = {
      cardCode: 'TEST-LIVE',
      name: '测试 LIVE',
      cardType: CardType.LIVE,
      score: 3,
      requirements: createHeartRequirement({
        [HeartColor.PINK]: 2,
        [HeartColor.RAINBOW]: 1,
      }),
    };
    const energy: EnergyCardData = {
      cardCode: 'TEST-ENERGY',
      name: '测试能量',
      cardType: CardType.ENERGY,
    };
    const deck: DeckConfig = {
      mainDeck: [live],
      energyDeck: [energy],
    };

    const encoded = encodePublicTableRuntimeDeck(deck);
    const decoded = decodePublicTableRuntimeDeck(JSON.parse(encoded.json));
    const decodedLive = decoded.mainDeck[0] as LiveCardData;

    expect(decodedLive.requirements.colorRequirements).toBeInstanceOf(Map);
    expect([...decodedLive.requirements.colorRequirements]).toEqual([
      [HeartColor.PINK, 2],
      [HeartColor.RAINBOW, 1],
    ]);
    expect(encoded.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(encodePublicTableRuntimeDeck(deck).contentHash).toBe(encoded.contentHash);
  });

  it('拒绝没有卡组数组的快照', () => {
    expect(() => decodePublicTableRuntimeDeck({})).toThrow('公共牌桌卡组快照格式无效');
  });
});
