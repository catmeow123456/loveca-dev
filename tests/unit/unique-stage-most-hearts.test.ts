import { describe, expect, it } from 'vitest';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type LiveModifierState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  collectLiveModifiers,
  selectUniqueStageMemberWithMostEffectiveHearts,
} from '../../src/domain/rules/live-modifiers';
import { CardType, HeartColor, SlotPosition } from '../../src/shared/types/enums';

function setup(ownHearts: number, opponentHearts: number) {
  const own = createCardInstance(
    {
      cardType: CardType.MEMBER,
      cardCode: 'PL!N-bp5-002-P',
      name: '中须霞',
      cost: 15,
      blade: 1,
      hearts: [{ color: HeartColor.PINK, count: ownHearts }],
    },
    'p1',
    'own'
  );
  const opponent = createCardInstance(
    {
      ...own.data,
      cardCode: 'unrelated',
      hearts: [{ color: HeartColor.GRAY, count: opponentHearts }],
    },
    'p2',
    'opponent'
  );
  let game = registerCards(createGameState('unique-hearts', 'p1', 'P1', 'p2', 'P2'), [
    own,
    opponent,
  ]);
  game = updatePlayer(game, 'p1', (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, own.instanceId),
  }));
  game = updatePlayer(game, 'p2', (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, opponent.instanceId),
  }));
  return game;
}

describe('unique stage member with most effective Hearts', () => {
  it('returns the player and member identity across both stages and has no tie-breaker', () => {
    expect(selectUniqueStageMemberWithMostEffectiveHearts(setup(1, 3), [])).toEqual({
      playerId: 'p2',
      memberCardId: 'opponent',
      heartCount: 3,
    });
    expect(selectUniqueStageMemberWithMostEffectiveHearts(setup(3, 3), [])).toBeNull();
    expect(selectUniqueStageMemberWithMostEffectiveHearts(setup(0, 0), [])).toBeNull();
  });

  it('returns null for an empty stage and recognizes a sole zero-Heart member', () => {
    const game = createGameState('empty-stage', 'p1', 'P1', 'p2', 'P2');
    expect(selectUniqueStageMemberWithMostEffectiveHearts(game, [])).toBeNull();
    const only = updatePlayer(setup(0, 0), 'p2', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
      },
    }));
    expect(selectUniqueStageMemberWithMostEffectiveHearts(only, [])).toEqual({
      playerId: 'p1',
      memberCardId: 'own',
      heartCount: 0,
    });
  });

  it('honors the explicit snapshot without collecting or mutating state', () => {
    const game = setup(1, 2);
    const before = structuredClone(game);
    const snapshot: readonly LiveModifierState[] = [
      {
        kind: 'HEART',
        target: 'TARGET_MEMBER',
        playerId: 'p1',
        sourceCardId: 'source',
        targetMemberCardId: 'own',
        hearts: [{ color: HeartColor.RAINBOW, count: 2 }],
      },
    ];
    expect(selectUniqueStageMemberWithMostEffectiveHearts(game, snapshot)).toEqual({
      playerId: 'p1',
      memberCardId: 'own',
      heartCount: 3,
    });
    expect(selectUniqueStageMemberWithMostEffectiveHearts(game, [])?.playerId).toBe('p2');
    expect(game).toEqual(before);
  });

  it('keeps the old Kasumi continuous collector nonrecursive and uses its existing stored-modifier semantics', () => {
    const game = setup(3, 2);
    expect(collectLiveModifiers(game)).toContainEqual(
      expect.objectContaining({
        kind: 'SCORE',
        sourceCardId: 'own',
        countDelta: 1,
        abilityId: 'PL!N-bp5-002:continuous-stage-most-hearts-live-score',
      })
    );
    expect(
      collectLiveModifiers(setup(2, 2)).some(
        (item) => item.kind === 'SCORE' && item.sourceCardId === 'own'
      )
    ).toBe(false);
  });
});
