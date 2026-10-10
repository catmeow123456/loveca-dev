import { describe, expect, it } from 'vitest';
import { N_BP8_022_CONTINUOUS_OTHER_NIJIGASAKI_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
  getMemberEffectiveBladeCount,
} from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

function member(
  id: string,
  groupNames: readonly string[] = ['虹ヶ咲'],
  ownerId = 'p1',
  cardCode = `TEST-${id}`
) {
  return createCardInstance(
    {
      cardCode,
      name: id,
      cardType: CardType.MEMBER,
      groupNames,
      cost: 13,
      blade: 5,
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
    },
    ownerId,
    id
  );
}

function place(
  game: GameState,
  playerId: string,
  id: string,
  slot: SlotPosition,
  orientation = OrientationState.ACTIVE
) {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, id, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

describe('PL!N-bp8-022 费用13「三船栞子」continuous BLADE', () => {
  it.each(['N', 'P', 'SEC'])(
    'counts only other own top-level Nijigasaki members for rarity %s',
    (rarity) => {
      const cards = [
        member('source', ['虹ヶ咲'], 'p1', `PL!N-bp8-022-${rarity}`),
        member('own-a', ['虹咲']),
        member('own-b', ['虹ヶ咲']),
        member('lower'),
        member('opponent', ['虹ヶ咲'], 'p2'),
      ];
      let game = registerCards(createGameState('shioriko-count', 'p1', 'P1', 'p2', 'P2'), cards);
      game = place(game, 'p1', 'source', SlotPosition.CENTER);
      game = place(game, 'p2', 'opponent', SlotPosition.CENTER);
      game = updatePlayer(game, 'p1', (player) => ({
        ...player,
        memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.CENTER, 'lower'),
      }));
      expect(getMemberEffectiveBladeCount(game, 'p1', 'source')).toBe(5);
      game = place(game, 'p1', 'own-a', SlotPosition.LEFT, OrientationState.WAITING);
      expect(getMemberEffectiveBladeCount(game, 'p1', 'source')).toBe(6);
      game = place(game, 'p1', 'own-b', SlotPosition.RIGHT);
      expect(getMemberEffectiveBladeCount(game, 'p1', 'source')).toBe(7);
      expect(collectLiveModifiers(game, 'p1')).toContainEqual(
        expect.objectContaining({
          kind: 'BLADE',
          target: 'SOURCE_MEMBER',
          sourceCardId: 'source',
          countDelta: 2,
          abilityId: N_BP8_022_CONTINUOUS_OTHER_NIJIGASAKI_GAIN_BLADE_ABILITY_ID,
        })
      );
      expect(game.liveResolution.liveModifiers).toEqual([]);
      game = updatePlayer(game, 'p1', (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      }));
      expect(getMemberEffectiveBladeCount(game, 'p1', 'source')).toBe(6);
      game = updatePlayer(game, 'p1', (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      }));
      expect(
        collectLiveModifiers(game, 'p1').filter(
          (modifier) =>
            modifier.abilityId === N_BP8_022_CONTINUOUS_OTHER_NIJIGASAKI_GAIN_BLADE_ABILITY_ID
        )
      ).toEqual([]);
    }
  );

  it('does not count other groups, and uses structured multi-group identity', () => {
    let game = registerCards(createGameState('shioriko-groups', 'p1', 'P1', 'p2', 'P2'), [
      member('source', ['虹ヶ咲'], 'p1', 'PL!N-bp8-022-N'),
      member('other', ['Aqours']),
      member('duo', ['Liella!', '虹ヶ咲']),
    ]);
    game = place(game, 'p1', 'source', SlotPosition.CENTER);
    game = place(game, 'p1', 'other', SlotPosition.LEFT);
    game = place(game, 'p1', 'duo', SlotPosition.RIGHT);
    expect(getMemberEffectiveBladeCount(game, 'p1', 'source')).toBe(6);
    expect(getMemberEffectiveBladeCount(game, 'p1', 'other')).toBe(5);
    expect(getMemberEffectiveBladeCount(game, 'p1', 'duo')).toBe(5);
  });
});
