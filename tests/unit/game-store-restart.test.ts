import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import type { DeckConfig } from '../../src/application/game-service';
import { CardType, GameMode, HeartColor } from '../../src/shared/types/enums';

vi.mock('@/lib/imageService', () => ({
  preloadImage: vi.fn(() => Promise.resolve()),
  resolveCardImagePath: vi.fn(() => '/images/medium/mock.webp'),
}));

import { useGameStore } from '../../client/src/store/gameStore';

describe('gameStore local restart', () => {
  afterEach(() => {
    useGameStore.getState().leaveLocalGame();
  });

  it('本地调试使用双方开局卡组重建全新对局', async () => {
    const store = useGameStore.getState();
    store.setGameMode(GameMode.DEBUG);
    store.createGame('local-before-restart', 'p1', '玩家一', 'p2', '玩家二');
    store.initializeGame(createDeck('P1'), createDeck('P2'));

    const before = useGameStore.getState().getMatchView();
    expect(before?.matchId).toBe('local-before-restart');

    const result = await useGameStore.getState().restartCurrentGame();

    expect(result).toEqual({ success: true });
    const state = useGameStore.getState();
    const after = state.getMatchView();
    expect(after?.matchId).not.toBe(before?.matchId);
    expect(after?.participants).toEqual(before?.participants);
    expect(after?.turnCount).toBe(1);
    expect(state.viewingPlayerId).toBe('p1');
    expect(state.gameMode).toBe(GameMode.DEBUG);
    expect(state.ui.logs.at(-1)?.message).toBe('对局已重新开始');
  });
});

function createDeck(prefix: string): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: EnergyCardData[] = [];

  for (let index = 0; index < 48; index += 1) {
    mainDeck.push(createMember(`${prefix}-MEMBER-${index}`));
  }
  for (let index = 0; index < 12; index += 1) {
    mainDeck.push(createLive(`${prefix}-LIVE-${index}`));
    energyDeck.push(createEnergy(`${prefix}-ENERGY-${index}`));
  }

  return { mainDeck, energyDeck };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}
