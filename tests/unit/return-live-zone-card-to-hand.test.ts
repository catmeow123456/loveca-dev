import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { returnLiveZoneCardToHandForPlayer } from '../../src/application/card-effects/runtime/actions';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function live(): LiveCardData {
  return {
    cardCode: 'TEST-LIVE',
    name: 'Test Live',
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function member(): MemberCardData {
  return {
    cardCode: 'TEST-MEMBER',
    name: 'Test Member',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

describe('returnLiveZoneCardToHandForPlayer', () => {
  it('moves one owned LIVE, clears its live-zone state, and records ON_ENTER_HAND', () => {
    const card = createCardInstance(live(), PLAYER1, 'live');
    let game = registerCards(createGameState('return-live', PLAYER1, 'P1', PLAYER2, 'P2'), [card]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, card.instanceId, {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
    }));

    const result = returnLiveZoneCardToHandForPlayer(game, PLAYER1, card.instanceId);

    expect(result).not.toBeNull();
    expect(result?.gameState.players[0].liveZone.cardIds).toEqual([]);
    expect(result?.gameState.players[0].liveZone.cardStates.has(card.instanceId)).toBe(false);
    expect(result?.gameState.players[0].hand.cardIds).toEqual([card.instanceId]);
    expect(result?.enterHandEvent).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_HAND,
      cardInstanceId: card.instanceId,
      cardInstanceIds: [card.instanceId],
      controllerId: PLAYER1,
      fromZone: ZoneType.LIVE_ZONE,
      toZone: ZoneType.HAND,
    });
  });

  it('rejects stale, wrong-owner, and non-LIVE targets without mutation', () => {
    const staleLive = createCardInstance(live(), PLAYER1, 'stale-live');
    const opponentLive = createCardInstance(live(), PLAYER2, 'opponent-live');
    const wrongType = createCardInstance(member(), PLAYER1, 'member');
    let game = registerCards(createGameState('return-live-invalid', PLAYER1, 'P1', PLAYER2, 'P2'), [
      staleLive,
      opponentLive,
      wrongType,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, wrongType.instanceId, {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
    }));
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, opponentLive.instanceId, {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
    }));

    expect(returnLiveZoneCardToHandForPlayer(game, PLAYER1, staleLive.instanceId)).toBeNull();
    expect(returnLiveZoneCardToHandForPlayer(game, PLAYER1, opponentLive.instanceId)).toBeNull();
    expect(returnLiveZoneCardToHandForPlayer(game, PLAYER1, wrongType.instanceId)).toBeNull();
    expect(game.eventLog).toEqual([]);
  });
});
