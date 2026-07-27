import { describe, expect, it } from 'vitest';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
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
  getMemberEffectiveHeartIcons,
  getPlayerLiveHeartModifiers,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

const CONTINUOUS_ABILITY_ID = 'PL!SP-bp7-009-P:continuous-side-red-heart';

function member(cardCode: string, ownerId: string, instanceId: string) {
  return createCardInstance(
    {
      cardCode,
      name: instanceId,
      groupNames: ['Liella!'],
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 2,
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    ownerId,
    instanceId
  );
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

function collectSourceHearts(game: GameState, sourceCardId: string) {
  return collectLiveModifiers(game).filter(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.abilityId === CONTINUOUS_ABILITY_ID &&
      modifier.sourceCardId === sourceCardId
  );
}

describe('PL!SP-bp7-009 continuous side-slot red Heart', () => {
  it.each([SlotPosition.LEFT, SlotPosition.RIGHT])(
    'dynamically grants one SOURCE_MEMBER red Heart in %s and covers sibling rarities',
    (slot) => {
      const source = member('PL!SP-bp7-009-R', 'p1', `source-${slot}`);
      let game = registerCards(createGameState(`sp-bp7-009-${slot}`, 'p1', 'P1', 'p2', 'P2'), [
        source,
      ]);
      game = placeOnStage(game, 'p1', slot, source.instanceId);

      expect(collectSourceHearts(game, source.instanceId)).toEqual([
        {
          kind: 'HEART',
          target: 'SOURCE_MEMBER',
          playerId: 'p1',
          hearts: [createHeartIcon(HeartColor.RED, 1)],
          sourceCardId: source.instanceId,
          abilityId: CONTINUOUS_ABILITY_ID,
        },
      ]);
      expect(getMemberEffectiveHeartIcons(game, 'p1', source.instanceId)).toEqual([
        createHeartIcon(HeartColor.YELLOW, 1),
        createHeartIcon(HeartColor.RED, 1),
      ]);
      expect(
        getPlayerLiveHeartModifiers(game.liveResolution, 'p1', collectLiveModifiers(game))
      ).toEqual([]);
    }
  );

  it('expires in CENTER, off stage, or memberBelow and ignores the adjacent base code', () => {
    const source = member('PL!SP-bp7-009-P', 'p1', 'source');
    const adjacent = member('PL!SP-bp7-010-P', 'p1', 'adjacent');
    const host = member('HOST', 'p1', 'host');
    let game = registerCards(
      createGameState('sp-bp7-009-inactive-positions', 'p1', 'P1', 'p2', 'P2'),
      [source, adjacent, host]
    );
    game = placeOnStage(game, 'p1', SlotPosition.CENTER, source.instanceId);
    game = placeOnStage(game, 'p1', SlotPosition.RIGHT, adjacent.instanceId);
    expect(collectSourceHearts(game, source.instanceId)).toEqual([]);
    expect(collectSourceHearts(game, adjacent.instanceId)).toEqual([]);

    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(collectSourceHearts(game, source.instanceId)).toEqual([]);

    game = placeOnStage(game, 'p1', SlotPosition.LEFT, host.instanceId);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.LEFT, source.instanceId),
    }));
    expect(collectSourceHearts(game, source.instanceId)).toEqual([]);
  });
});
