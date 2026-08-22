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
import { resolveMemberEntryOrientation } from '../../src/domain/rules/member-entry-orientation';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function member(cardCode: string, ownerId: string, id: string, heartCount: number) {
  const data: MemberCardData = {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, heartCount)],
  };
  return createCardInstance(data, ownerId, id);
}

function place(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string,
  orientation: OrientationState = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

describe('member entry orientation rules', () => {
  it.each([
    [SlotPosition.LEFT, SlotPosition.RIGHT],
    [SlotPosition.CENTER, SlotPosition.CENTER],
    [SlotPosition.RIGHT, SlotPosition.LEFT],
  ] as const)(
    'maps opponent source %s to entering slot %s and covers unseen rarities',
    (sourceSlot, enteringSlot) => {
      const eli = member('PL!-pb2-002-UNSEEN', P1, 'eli', 2);
      const entering = member('ENTERING', P2, 'entering', 4);
      let game = registerCards(createGameState('entry-map', P1, 'P1', P2, 'P2'), [eli, entering]);
      game = place(game, P1, sourceSlot, eli.instanceId, OrientationState.WAITING);

      expect(
        resolveMemberEntryOrientation(
          game,
          P2,
          entering.instanceId,
          enteringSlot,
          OrientationState.ACTIVE
        )
      ).toBe(OrientationState.WAITING);
    }
  );

  it('uses printed Heart count with an inclusive four-Heart boundary', () => {
    const eli = member('PL!-pb2-002-PP', P1, 'eli', 2);
    const fourHearts = member('FOUR', P2, 'four', 4);
    const fiveHearts = member('FIVE', P2, 'five', 5);
    let game = registerCards(createGameState('entry-heart', P1, 'P1', P2, 'P2'), [
      eli,
      fourHearts,
      fiveHearts,
    ]);
    game = place(game, P1, SlotPosition.LEFT, eli.instanceId);

    expect(resolveMemberEntryOrientation(game, P2, fourHearts.instanceId, SlotPosition.RIGHT)).toBe(
      OrientationState.WAITING
    );
    expect(resolveMemberEntryOrientation(game, P2, fiveHearts.instanceId, SlotPosition.RIGHT)).toBe(
      OrientationState.ACTIVE
    );
  });

  it('mirrors the facing slot when the source belongs to the second player', () => {
    const eli = member('PL!-pb2-002-R', P2, 'eli', 2);
    const entering = member('ENTERING', P1, 'entering', 4);
    let game = registerCards(createGameState('entry-second-player', P1, 'P1', P2, 'P2'), [
      eli,
      entering,
    ]);
    game = place(game, P2, SlotPosition.RIGHT, eli.instanceId);

    expect(resolveMemberEntryOrientation(game, P1, entering.instanceId, SlotPosition.LEFT)).toBe(
      OrientationState.WAITING
    );
  });

  it('ignores adjacent, off-stage, and memberBelow sources', () => {
    const eli = member('PL!-pb2-002-PP', P1, 'eli', 2);
    const host = member('HOST', P1, 'host', 2);
    const entering = member('ENTERING', P2, 'entering', 1);
    let game = registerCards(createGameState('entry-source-lifecycle', P1, 'P1', P2, 'P2'), [
      eli,
      host,
      entering,
    ]);
    game = place(game, P1, SlotPosition.LEFT, eli.instanceId);

    expect(resolveMemberEntryOrientation(game, P2, entering.instanceId, SlotPosition.LEFT)).toBe(
      OrientationState.ACTIVE
    );

    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    expect(resolveMemberEntryOrientation(game, P2, entering.instanceId, SlotPosition.RIGHT)).toBe(
      OrientationState.ACTIVE
    );

    game = place(game, P1, SlotPosition.LEFT, host.instanceId);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(player.memberSlots, SlotPosition.LEFT, eli.instanceId),
    }));
    expect(resolveMemberEntryOrientation(game, P2, entering.instanceId, SlotPosition.RIGHT)).toBe(
      OrientationState.ACTIVE
    );
  });

  it('preserves a caller-requested WAITING orientation when no rule matches', () => {
    const entering = member('ENTERING', P2, 'entering', 5);
    const game = registerCards(createGameState('entry-preserve', P1, 'P1', P2, 'P2'), [entering]);

    expect(
      resolveMemberEntryOrientation(
        game,
        P2,
        entering.instanceId,
        SlotPosition.CENTER,
        OrientationState.WAITING
      )
    ).toBe(OrientationState.WAITING);
  });
});
