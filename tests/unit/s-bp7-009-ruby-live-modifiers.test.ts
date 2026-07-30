import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const ABILITY_ID = 'PL!S-bp7-009:continuous-front-low-cost-member-lose-blade';

function memberData(cardCode: string, name: string, cost: number, blade: number): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost,
    blade,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function placeOnStage(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function rubyModifiers(game: GameState) {
  return collectLiveModifiers(game).filter((modifier) => modifier.abilityId === ABILITY_ID);
}

describe('PL!S-bp7-009 黑泽露比 front low-cost member BLADE reduction', () => {
  it.each([
    [SlotPosition.LEFT, SlotPosition.RIGHT, 'PL!S-bp7-009-P'],
    [SlotPosition.CENTER, SlotPosition.CENTER, 'PL!S-bp7-009-R'],
    [SlotPosition.RIGHT, SlotPosition.LEFT, 'PL!S-bp7-009-UNSEEN'],
  ] as const)(
    'maps source %s to opponent %s and covers base-card rarities',
    (sourceSlot, opponentSlot, sourceCardCode) => {
      const source = createCardInstance(
        memberData(sourceCardCode, '黑泽露比', 2, 0),
        PLAYER1,
        'ruby'
      );
      const target = createCardInstance(
        memberData('TARGET', 'facing member', 4, 2),
        PLAYER2,
        'target'
      );
      let game = registerCards(
        createGameState(`s-bp7-009-${sourceSlot}`, PLAYER1, 'P1', PLAYER2, 'P2'),
        [source, target]
      );
      game = placeOnStage(game, PLAYER1, sourceSlot, source.instanceId);
      game = placeOnStage(game, PLAYER2, opponentSlot, target.instanceId);

      expect(rubyModifiers(game)).toEqual([
        {
          kind: 'BLADE',
          playerId: PLAYER2,
          countDelta: -1,
          sourceCardId: source.instanceId,
          targetMemberCardId: target.instanceId,
          abilityId: ABILITY_ID,
        },
      ]);
      expect(getMemberEffectiveBladeCount(game, PLAYER2, target.instanceId)).toBe(1);
    }
  );

  it('does not affect a facing printed-cost-5 member or an adjacent source card', () => {
    const source = createCardInstance(
      memberData('PL!S-bp7-009-P', '黑泽露比', 2, 0),
      PLAYER1,
      'ruby'
    );
    const adjacent = createCardInstance(
      memberData('PL!S-bp7-010-P', 'adjacent', 2, 1),
      PLAYER1,
      'adjacent'
    );
    const target = createCardInstance(
      memberData('TARGET', 'facing member', 5, 2),
      PLAYER2,
      'target'
    );
    let game = registerCards(
      createGameState('s-bp7-009-cost-boundary', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, adjacent, target]
    );
    game = placeOnStage(game, PLAYER1, SlotPosition.LEFT, source.instanceId);
    game = placeOnStage(game, PLAYER1, SlotPosition.RIGHT, adjacent.instanceId);
    game = placeOnStage(game, PLAYER2, SlotPosition.RIGHT, target.instanceId);

    expect(rubyModifiers(game)).toEqual([]);
    expect(getMemberEffectiveBladeCount(game, PLAYER2, target.instanceId)).toBe(2);
  });

  it('expires when source leaves the top-level stage or becomes memberBelow', () => {
    const source = createCardInstance(
      memberData('PL!S-bp7-009-P', '黑泽露比', 2, 0),
      PLAYER1,
      'ruby'
    );
    const host = createCardInstance(memberData('HOST', 'host', 4, 1), PLAYER1, 'host');
    const target = createCardInstance(
      memberData('TARGET', 'facing member', 4, 2),
      PLAYER2,
      'target'
    );
    let game = registerCards(
      createGameState('s-bp7-009-source-lifecycle', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, host, target]
    );
    game = placeOnStage(game, PLAYER1, SlotPosition.LEFT, source.instanceId);
    game = placeOnStage(game, PLAYER2, SlotPosition.RIGHT, target.instanceId);
    expect(rubyModifiers(game)).toHaveLength(1);

    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
        SlotPosition.CENTER,
        source.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    }));
    expect(rubyModifiers(game)).toEqual([]);

    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        SlotPosition.LEFT,
        source.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    }));
    expect(rubyModifiers(game)).toHaveLength(1);

    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    expect(rubyModifiers(game)).toEqual([]);

    game = placeOnStage(game, PLAYER1, SlotPosition.LEFT, host.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.LEFT, source.instanceId),
    }));
    expect(rubyModifiers(game)).toEqual([]);
  });

  it('mirrors LEFT/RIGHT when the continuous source belongs to the second player', () => {
    const source = createCardInstance(
      memberData('PL!S-bp7-009-P+', '黑泽露比', 2, 0),
      PLAYER2,
      'ruby'
    );
    const target = createCardInstance(
      memberData('TARGET', 'facing member', 4, 2),
      PLAYER1,
      'target'
    );
    let game = registerCards(
      createGameState('s-bp7-009-second-controller', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, target]
    );
    game = placeOnStage(game, PLAYER2, SlotPosition.LEFT, source.instanceId);
    game = placeOnStage(game, PLAYER1, SlotPosition.RIGHT, target.instanceId);

    expect(rubyModifiers(game)).toEqual([
      {
        kind: 'BLADE',
        playerId: PLAYER1,
        countDelta: -1,
        sourceCardId: source.instanceId,
        targetMemberCardId: target.instanceId,
        abilityId: ABILITY_ID,
      },
    ]);
    expect(getMemberEffectiveBladeCount(game, PLAYER1, target.instanceId)).toBe(1);
  });

  it('tracks the current facing member and clamps a zero-BLADE target at zero', () => {
    const source = createCardInstance(
      memberData('PL!S-bp7-009-P', '黑泽露比', 2, 0),
      PLAYER1,
      'ruby'
    );
    const target = createCardInstance(
      memberData('TARGET', 'facing member', 4, 0),
      PLAYER2,
      'target'
    );
    let game = registerCards(
      createGameState('s-bp7-009-target-lifecycle', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, target]
    );
    game = placeOnStage(game, PLAYER1, SlotPosition.LEFT, source.instanceId);
    game = placeOnStage(game, PLAYER2, SlotPosition.RIGHT, target.instanceId);
    expect(getMemberEffectiveBladeCount(game, PLAYER2, target.instanceId)).toBe(0);

    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.RIGHT),
        SlotPosition.LEFT,
        target.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    }));
    expect(rubyModifiers(game)).toEqual([]);

    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
        SlotPosition.RIGHT,
        source.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    }));
    expect(rubyModifiers(game)).toHaveLength(1);

    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    expect(rubyModifiers(game)).toEqual([]);
  });
});
