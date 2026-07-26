import { describe, expect, it } from 'vitest';
import { preserveActiveEffectSourceDisplay } from '../../src/application/card-effects/runtime/active-effect-source-display';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type ActiveEffectState,
  type GameState,
} from '../../src/domain/entities/game';
import { CardType, HeartColor } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createSourceCard() {
  const data: MemberCardData = {
    cardCode: 'PL!-test-source-P',
    name: '测试来源',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, PLAYER1, 'source-card');
}

function createEffect(): ActiveEffectState {
  return {
    id: 'effect',
    abilityId: 'TEST_ABILITY',
    sourceCardId: 'source-card',
    controllerId: PLAYER1,
    effectText: '测试效果',
    stepId: 'TEST_STEP',
    stepText: '测试步骤',
    awaitingPlayerId: PLAYER1,
  };
}

function createStateWithSourceIn(zone: 'HAND' | 'WAITING_ROOM'): GameState {
  const source = createSourceCard();
  let game = registerCards(
    createGameState('active-effect-source-display', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: zone === 'HAND' ? [source.instanceId] : [],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: zone === 'WAITING_ROOM' ? [source.instanceId] : [],
    },
  }));
  return game;
}

describe('active-effect source display snapshot', () => {
  it('captures a source that was public before moving into a hidden deck', () => {
    const before = createStateWithSourceIn('WAITING_ROOM');
    const after = updatePlayer({ ...before, activeEffect: createEffect() }, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: ['source-card'] },
    }));

    expect(
      preserveActiveEffectSourceDisplay(before, after).activeEffect?.sourceCardDisplayCode
    ).toBe('PL!-test-source-P');
  });

  it('does not expose a source that only exists in a private hand', () => {
    const before = createStateWithSourceIn('HAND');
    const after = { ...before, activeEffect: createEffect() };

    expect(
      preserveActiveEffectSourceDisplay(before, after).activeEffect?.sourceCardDisplayCode
    ).toBeUndefined();
  });

  it('captures a private-zone source only after the active effect explicitly reveals it', () => {
    const before = createStateWithSourceIn('HAND');
    const after = {
      ...before,
      activeEffect: {
        ...createEffect(),
        revealedCardIds: ['source-card'],
      },
    };

    expect(
      preserveActiveEffectSourceDisplay(before, after).activeEffect?.sourceCardDisplayCode
    ).toBe('PL!-test-source-P');
  });

  it('does not transfer a snapshot into a different effect instance', () => {
    const before = {
      ...createStateWithSourceIn('HAND'),
      activeEffect: {
        ...createEffect(),
        id: 'previous-effect',
        sourceCardDisplayCode: 'PL!-test-source-P',
      },
    };
    const after = {
      ...before,
      activeEffect: {
        ...createEffect(),
        id: 'next-effect',
      },
    };

    expect(
      preserveActiveEffectSourceDisplay(before, after).activeEffect?.sourceCardDisplayCode
    ).toBeUndefined();
  });
});
