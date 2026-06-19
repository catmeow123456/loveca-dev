import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import {
  addLiveProhibitionUntilLiveEnd,
  clearLiveProhibitionsUntilLiveEnd,
  isPlayerLiveProhibited,
  liveProhibitedPlayerLiveZoneToWaitingRoom,
} from '../../src/domain/rules/live-prohibitions';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
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
