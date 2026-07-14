import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMulliganAction } from '../../src/application/actions';
import { type DeckConfig, GameService } from '../../src/application/game-service';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { getFirstPlayer, getSecondPlayer } from '../../src/domain/entities/game';
import type { GameState } from '../../src/domain/entities/game';
import { CardType, GamePhase, HeartColor, SubPhase } from '../../src/shared/types/enums';

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 1,
    } as Record<HeartColor, number>),
  };
}

function energy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function deck(prefix: string): DeckConfig {
  const mainDeck: AnyCardData[] = [
    ...Array.from({ length: 48 }, (_, index) => member(`${prefix}-MEMBER-${index}`)),
    ...Array.from({ length: 12 }, (_, index) => live(`${prefix}-LIVE-${index}`)),
  ];
  const energyDeck: AnyCardData[] = Array.from({ length: 12 }, (_, index) =>
    energy(`${prefix}-ENERGY-${index}`)
  );
  return { mainDeck, energyDeck };
}

function initializeGame(): { service: GameService; game: GameState } {
  const service = new GameService();
  const created = service.createGame('mulligan-test', 'p1', '玩家1', 'p2', '玩家2');
  const initialized = service.initializeGame(created, deck('P1'), deck('P2'));
  expect(initialized.success).toBe(true);
  return { service, game: initialized.gameState };
}

describe('换牌规则', () => {
  let service: GameService;
  let game: GameState;

  beforeEach(() => {
    ({ service, game } = initializeGame());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([1, 3, 6])(
    '换 %i 张时应先从原主卡组顶抽取替换牌，再放回换掉的牌并洗牌',
    (mulliganCount) => {
      vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: Uint32Array) => {
        array[0] = 0;
        return array;
      }) as typeof globalThis.crypto.getRandomValues);

      const firstPlayer = getFirstPlayer(game);
      const returnedCardIds = firstPlayer.hand.cardIds.slice(0, mulliganCount);
      const expectedDrawnCardIds = firstPlayer.mainDeck.cardIds.slice(0, mulliganCount);
      const cardsBefore = [...firstPlayer.hand.cardIds, ...firstPlayer.mainDeck.cardIds].sort();

      const result = service.processAction(
        game,
        createMulliganAction(firstPlayer.id, returnedCardIds)
      );

      expect(result.success).toBe(true);
      const updatedPlayer = result.gameState.players.find((player) => player.id === firstPlayer.id);
      expect(updatedPlayer).toBeDefined();
      expect(updatedPlayer?.hand.cardIds.slice(-mulliganCount)).toEqual(expectedDrawnCardIds);
      expect(updatedPlayer?.hand.cardIds).not.toEqual(expect.arrayContaining(returnedCardIds));
      expect(updatedPlayer?.mainDeck.cardIds).toEqual(expect.arrayContaining(returnedCardIds));
      expect(
        [...(updatedPlayer?.hand.cardIds ?? []), ...(updatedPlayer?.mainDeck.cardIds ?? [])].sort()
      ).toEqual(cardsBefore);
      expect(
        new Set([
          ...(updatedPlayer?.hand.cardIds ?? []),
          ...(updatedPlayer?.mainDeck.cardIds ?? []),
        ]).size
      ).toBe(cardsBefore.length);
    }
  );

  it('不换牌时不应改变手牌或主卡组，但应进入后攻换牌子阶段', () => {
    const firstPlayer = getFirstPlayer(game);
    const handBefore = [...firstPlayer.hand.cardIds];
    const deckBefore = [...firstPlayer.mainDeck.cardIds];

    const result = service.processAction(game, createMulliganAction(firstPlayer.id, []));

    expect(result.success).toBe(true);
    const updatedPlayer = result.gameState.players.find((player) => player.id === firstPlayer.id);
    expect(updatedPlayer?.hand.cardIds).toEqual(handBefore);
    expect(updatedPlayer?.mainDeck.cardIds).toEqual(deckBefore);
    expect(result.gameState.currentPhase).toBe(GamePhase.MULLIGAN_PHASE);
    expect(result.gameState.currentSubPhase).toBe(SubPhase.MULLIGAN_SECOND_PLAYER);
  });

  it('应拒绝重复的卡牌实例 ID，且不改变状态', () => {
    const firstPlayer = getFirstPlayer(game);
    const cardId = firstPlayer.hand.cardIds[0];

    const result = service.processAction(
      game,
      createMulliganAction(firstPlayer.id, [cardId, cardId])
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('换牌列表中存在重复的卡牌');
    expect(result.gameState).toBe(game);
  });

  it('应拒绝不在手牌中的卡牌实例 ID，且不改变状态', () => {
    const firstPlayer = getFirstPlayer(game);
    const nonHandCardId = firstPlayer.mainDeck.cardIds[0];

    const result = service.processAction(
      game,
      createMulliganAction(firstPlayer.id, [nonHandCardId])
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('选择的卡牌不在手牌中');
    expect(result.gameState).toBe(game);
  });

  it('应拒绝后攻玩家越过先攻提前换牌', () => {
    const secondPlayer = getSecondPlayer(game);

    const result = service.processAction(game, createMulliganAction(secondPlayer.id, []));

    expect(result.success).toBe(false);
    expect(result.error).toBe('不是你的回合');
    expect(result.gameState).toBe(game);
  });

  it('应在双方按顺序完成换牌后进入活跃阶段', () => {
    const firstPlayerId = getFirstPlayer(game).id;
    const secondPlayerId = getSecondPlayer(game).id;

    const firstResult = service.processAction(game, createMulliganAction(firstPlayerId, []));
    expect(firstResult.success).toBe(true);

    const secondResult = service.processAction(
      firstResult.gameState,
      createMulliganAction(secondPlayerId, [])
    );
    expect(secondResult.success).toBe(true);
    expect(secondResult.gameState.currentPhase).toBe(GamePhase.ACTIVE_PHASE);
    expect(secondResult.gameState.currentSubPhase).toBe(SubPhase.NONE);
  });
});
