import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  addLiveProhibitionUntilLiveEnd,
  clearLiveProhibitionsUntilLiveEnd,
  collectContinuousLiveProhibitionSources,
  isPlayerContinuouslyLiveProhibited,
  isPlayerLiveProhibited,
  liveProhibitedPlayerLiveZoneToWaitingRoom,
} from '../../src/domain/rules/live-prohibitions';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

describe('live prohibitions', () => {
  it('adds, deduplicates, queries, and clears until-live-end prohibitions', () => {
    let game = createGameState('live-prohibition', 'p1', 'P1', 'p2', 'P2');

    game = addLiveProhibitionUntilLiveEnd(game, {
      playerId: 'p1',
      sourceCardId: 'source-1',
      abilityId: 'ability-1',
    });
    game = addLiveProhibitionUntilLiveEnd(game, {
      playerId: 'p1',
      sourceCardId: 'source-1',
      abilityId: 'ability-1',
    });

    expect(game.liveProhibitions).toHaveLength(1);
    expect(isPlayerLiveProhibited(game, 'p1')).toBe(true);
    expect(isPlayerLiveProhibited(game, 'p2')).toBe(false);

    game = clearLiveProhibitionsUntilLiveEnd(game);
    expect(game.liveProhibitions).toEqual([]);
    expect(isPlayerLiveProhibited(game, 'p1')).toBe(false);
  });

  it('moves a prohibited player live zone to waiting room without clearing the restriction', () => {
    const live = createCardInstance(createLive('TEST-LIVE'), 'p1', 'live-1');
    const member = createCardInstance(createMember('TEST-MEMBER'), 'p1', 'member-1');
    let game = createGameState('live-prohibition-cleanup', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [live, member]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(
        addCardToStatefulZone(player.liveZone, live.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_DOWN,
        }),
        member.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_DOWN,
        }
      ),
    }));
    game = addLiveProhibitionUntilLiveEnd(game, {
      playerId: 'p1',
      sourceCardId: 'source-1',
      abilityId: 'ability-1',
    });

    const cleaned = liveProhibitedPlayerLiveZoneToWaitingRoom(game, 'p1');

    expect(cleaned.players[0].liveZone.cardIds).toEqual([]);
    expect(cleaned.players[0].liveZone.cardStates.size).toBe(0);
    expect(cleaned.players[0].waitingRoom.cardIds).toEqual([live.instanceId, member.instanceId]);
    expect(isPlayerLiveProhibited(cleaned, 'p1')).toBe(true);
  });

  it('does not move live zone cards for a player without prohibition', () => {
    const live = createCardInstance(createLive('TEST-LIVE'), 'p1', 'live-1');
    let game = createGameState('live-prohibition-noop', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_DOWN,
      }),
    }));

    const cleaned = liveProhibitedPlayerLiveZoneToWaitingRoom(game, 'p1');

    expect(cleaned).toBe(game);
    expect(cleaned.players[0].liveZone.cardIds).toEqual([live.instanceId]);
    expect(cleaned.players[0].waitingRoom.cardIds).toEqual([]);
  });
});

describe('PL!SP-bp1-001 continuous Live prohibition', () => {
  function createStageState(
    sourceCode = 'PL!SP-bp1-001-P',
    sourceOwner = 'p1',
    sourceSlot: SlotPosition = SlotPosition.CENTER
  ) {
    const source = createCardInstance(createMember(sourceCode), sourceOwner, 'source-001');
    const other = createCardInstance(createMember('TEST-OTHER-MEMBER'), 'p1', 'other-member');
    const opponent = createCardInstance(createMember('TEST-OPPONENT-MEMBER'), 'p2', 'opponent');
    let game = registerCards(createGameState('sp-bp1-001-continuous', 'p1', 'P1', 'p2', 'P2'), [
      source,
      other,
      opponent,
    ]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, sourceSlot, source.instanceId),
    }));
    return { game, source, other, opponent, sourceSlot };
  }

  it.each([
    ['PL!SP-bp1-001-P', SlotPosition.LEFT],
    ['PL!SP-bp1-001-R', SlotPosition.CENTER],
    ['PL!SP-bp1-001-P', SlotPosition.RIGHT],
  ])('prohibits Live for %s as the only own top-level member in %s', (cardCode, slot) => {
    const { game, source } = createStageState(cardCode, 'p1', slot);

    expect(collectContinuousLiveProhibitionSources(game, 'p1')).toEqual([
      {
        playerId: 'p1',
        sourceCardId: source.instanceId,
        baseCardCode: 'PL!SP-bp1-001',
      },
    ]);
    expect(isPlayerContinuouslyLiveProhibited(game, 'p1')).toBe(true);
    expect(isPlayerLiveProhibited(game, 'p1')).toBe(true);
  });

  it('ignores opponent members and memberBelow when looking for another own member', () => {
    const { game: initial, other, opponent, sourceSlot } = createStageState();
    let game = updatePlayer(initial, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [sourceSlot]: [other.instanceId],
        },
      },
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, opponent.instanceId),
    }));

    expect(isPlayerLiveProhibited(game, 'p1')).toBe(true);
    expect(isPlayerLiveProhibited(game, 'p2')).toBe(false);
  });

  it('dynamically disappears with another own top-level member and returns when it leaves', () => {
    const { game: initial, other } = createStageState();
    const withOther = updatePlayer(initial, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, other.instanceId),
    }));
    expect(isPlayerLiveProhibited(withOther, 'p1')).toBe(false);

    const withoutOther = updatePlayer(withOther, 'p1', (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    expect(isPlayerLiveProhibited(withoutOther, 'p1')).toBe(true);
  });

  it('does not prohibit Live when two 001 instances are top-level stage members', () => {
    const { game: initial } = createStageState('PL!SP-bp1-001-P', 'p1', SlotPosition.LEFT);
    const second = createCardInstance(createMember('PL!SP-bp1-001-R'), 'p1', 'source-001-r');
    let game = registerCards(initial, [second]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, second.instanceId),
    }));

    expect(collectContinuousLiveProhibitionSources(game, 'p1')).toEqual([]);
    expect(isPlayerLiveProhibited(game, 'p1')).toBe(false);
  });

  it.each(['HAND', 'WAITING_ROOM', 'MEMBER_BELOW', 'OFF_STAGE'] as const)(
    'does not apply when the source is in %s',
    (location) => {
      const { game: initial, source, sourceSlot } = createStageState();
      let game = updatePlayer(initial, 'p1', (player) => {
        const memberSlots = removeCardFromSlot(player.memberSlots, sourceSlot);
        if (location === 'HAND') {
          return { ...player, memberSlots, hand: addCardToZone(player.hand, source.instanceId) };
        }
        if (location === 'WAITING_ROOM') {
          return {
            ...player,
            memberSlots,
            waitingRoom: addCardToZone(player.waitingRoom, source.instanceId),
          };
        }
        if (location === 'MEMBER_BELOW') {
          return {
            ...player,
            memberSlots: {
              ...memberSlots,
              memberBelow: {
                ...memberSlots.memberBelow,
                [SlotPosition.CENTER]: [source.instanceId],
              },
            },
          };
        }
        return { ...player, memberSlots };
      });

      expect(isPlayerLiveProhibited(game, 'p1')).toBe(false);
    }
  );

  it.each([
    ['wrong owner', createMember('PL!SP-bp1-001-P'), 'p2'],
    ['wrong type', createLive('PL!SP-bp1-001-P'), 'p1'],
    ['wrong card code', createMember('PL!SP-bp1-999-P'), 'p1'],
  ])('rejects a source with %s', (_label, cardData, ownerId) => {
    const source = createCardInstance(cardData, ownerId, 'invalid-source');
    let game = registerCards(createGameState('sp-bp1-001-invalid', 'p1', 'P1', 'p2', 'P2'), [
      source,
    ]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
    }));

    expect(isPlayerLiveProhibited(game, 'p1')).toBe(false);
  });

  it('keeps temporary and continuous restrictions isolated', () => {
    const { game: initial, other } = createStageState();
    let game = addLiveProhibitionUntilLiveEnd(initial, {
      playerId: 'p1',
      sourceCardId: 'temporary-source',
      abilityId: 'temporary-ability',
    });
    expect(isPlayerLiveProhibited(game, 'p1')).toBe(true);

    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, other.instanceId),
    }));
    expect(isPlayerContinuouslyLiveProhibited(game, 'p1')).toBe(false);
    expect(isPlayerLiveProhibited(game, 'p1')).toBe(true);
    expect(game.liveProhibitions).toHaveLength(1);

    game = clearLiveProhibitionsUntilLiveEnd(game);
    expect(game.liveProhibitions).toEqual([]);
    expect(isPlayerLiveProhibited(game, 'p1')).toBe(false);

    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    expect(game.liveProhibitions).toEqual([]);
    expect(isPlayerLiveProhibited(game, 'p1')).toBe(true);
  });

  it('clearing temporary restrictions does not clear an active continuous restriction', () => {
    const { game: initial } = createStageState();
    const withTemporary = addLiveProhibitionUntilLiveEnd(initial, {
      playerId: 'p1',
      sourceCardId: 'temporary-source',
      abilityId: 'temporary-ability',
    });
    const cleared = clearLiveProhibitionsUntilLiveEnd(withTemporary);

    expect(cleared.liveProhibitions).toEqual([]);
    expect(isPlayerContinuouslyLiveProhibited(cleared, 'p1')).toBe(true);
    expect(isPlayerLiveProhibited(cleared, 'p1')).toBe(true);
  });

  it('safely no-ops with an empty Live zone while the continuous restriction remains active', () => {
    const { game } = createStageState();
    const cleaned = liveProhibitedPlayerLiveZoneToWaitingRoom(game, 'p1');

    expect(cleaned).toBe(game);
    expect(cleaned.players[0].liveZone.cardIds).toEqual([]);
    expect(isPlayerLiveProhibited(cleaned, 'p1')).toBe(true);
  });
});
