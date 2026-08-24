import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  getCardById,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToZone,
  addMemberBelowMember,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import { handlePlayMember } from '../../src/application/action-handlers/play-member.handler';
import type { ActionHandlerContext } from '../../src/application/action-handlers/types';
import { GameActionType } from '../../src/application/actions';
import {
  playMemberFromZoneToEmptySlot,
  playMemberFromZoneToStageSlotWithReplacement,
} from '../../src/application/card-effects/runtime/play-member-to-stage';
import { moveInspectedSelectionToStageRestToWaitingRoomAndEnqueueTriggers } from '../../src/application/card-effects/runtime/inspection-waiting-room-triggers';
import {
  playMemberBelowCardToEmptySlot,
  playMembersFromWaitingRoomToEmptySlots,
} from '../../src/application/effects/member-state';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PL_PB2_002_CONTINUOUS_FACING_LOW_ORIGINAL_HEART_MEMBER_ENTERS_WAITING_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const EFFECT_TEXT =
  '【常时】原本持有的HEART数量小于等于4的成员登场至此成员正面的区域时，以待机状态登场。';

function member(
  cardCode: string,
  ownerId: string,
  id: string,
  options: { readonly heartCount?: number; readonly cost?: number; readonly name?: string } = {}
) {
  const data: MemberCardData = {
    cardCode,
    name: options.name ?? cardCode,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, options.heartCount ?? 1)],
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

function orientation(game: GameState, playerId: string, cardId: string) {
  return game.players.find((player) => player.id === playerId)?.memberSlots.cardStates.get(cardId)
    ?.orientation;
}

function expectWaitingEntryWithoutStateChangeEvent(
  game: GameState,
  playerId: string,
  cardId: string
) {
  expect(orientation(game, playerId, cardId)).toBe(OrientationState.WAITING);
  expect(
    game.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
    )
  ).toHaveLength(0);
}

function baseGame(extraCards: ReturnType<typeof member>[] = []) {
  const eli = member('PL!-pb2-002-PP', P1, 'eli', { heartCount: 2 });
  let game = registerCards(createGameState('pl-pb2-002', P1, 'P1', P2, 'P2'), [eli, ...extraCards]);
  game = place(game, P1, SlotPosition.LEFT, eli.instanceId, OrientationState.WAITING);
  return { game, eli };
}

const playMemberContext = {
  getPlayerById: (game: GameState, playerId: string) =>
    game.players.find((player) => player.id === playerId),
  getCardById,
  addAction,
} as ActionHandlerContext;

describe('PL!-pb2-002 费用4 绚濑绘里 member-entry orientation', () => {
  it('classifies every rarity by base card code and uses the approved typo correction', () => {
    for (const cardCode of ['PL!-pb2-002-PP', 'PL!-pb2-002-R', 'PL!-pb2-002-UNSEEN']) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions).toEqual([
        expect.objectContaining({
          abilityId:
            PL_PB2_002_CONTINUOUS_FACING_LOW_ORIGINAL_HEART_MEMBER_ENTERS_WAITING_ABILITY_ID,
          baseCardCodes: ['PL!-pb2-002'],
          effectText: EFFECT_TEXT,
          queued: false,
          implemented: true,
        }),
      ]);
      expect(definitions[0]?.cardCodes).toBeUndefined();
      expect(definitions[0]?.triggerCondition).toBeUndefined();
    }
  });

  it('applies to an ordinary hand play with a relay replacement', () => {
    const incoming = member('INCOMING', P2, 'incoming', { heartCount: 4, cost: 5 });
    const replaced = member('REPLACED', P2, 'replaced', { heartCount: 2, cost: 2 });
    let { game } = baseGame([incoming, replaced]);
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, incoming.instanceId),
    }));
    game = place(game, P2, SlotPosition.RIGHT, replaced.instanceId);

    const result = handlePlayMember(
      game,
      {
        type: GameActionType.PLAY_MEMBER,
        playerId: P2,
        cardId: incoming.instanceId,
        targetSlot: SlotPosition.RIGHT,
        isRelay: true,
        relayFromSlot: SlotPosition.RIGHT,
        timestamp: 1,
      },
      playMemberContext
    );

    expect(result.success, result.error).toBe(true);
    expectWaitingEntryWithoutStateChangeEvent(result.gameState, P2, incoming.instanceId);
    expect(result.triggeredEvents).not.toContain(TriggerCondition.ON_MEMBER_STATE_CHANGED);
    expect(result.gameState.players[1]!.waitingRoom.cardIds).toContain(replaced.instanceId);
  });

  it.each([
    ['HAND', ZoneType.HAND],
    ['INSPECTION_ZONE', ZoneType.INSPECTION_ZONE],
  ] as const)('applies to runtime %s -> empty stage placement', (_label, sourceZone) => {
    const incoming = member(`INCOMING-${sourceZone}`, P2, `incoming-${sourceZone}`, {
      heartCount: 4,
    });
    let { game } = baseGame([incoming]);
    if (sourceZone === ZoneType.HAND) {
      game = updatePlayer(game, P2, (player) => ({
        ...player,
        hand: addCardToZone(player.hand, incoming.instanceId),
      }));
    } else {
      game = {
        ...game,
        inspectionZone: { ...game.inspectionZone, cardIds: [incoming.instanceId] },
      };
    }

    const result = playMemberFromZoneToEmptySlot(game, P2, {
      cardId: incoming.instanceId,
      sourceZone,
      toSlot: SlotPosition.RIGHT,
    });

    expect(result).not.toBeNull();
    expectWaitingEntryWithoutStateChangeEvent(result!.gameState, P2, incoming.instanceId);
  });

  it('applies to runtime waiting-room placement with duplicate-member cleanup', () => {
    const incoming = member('INCOMING-WAITING', P2, 'incoming-waiting', { heartCount: 1 });
    const replaced = member('REPLACED', P2, 'replaced', { heartCount: 2 });
    let { game } = baseGame([incoming, replaced]);
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      waitingRoom: addCardToZone(player.waitingRoom, incoming.instanceId),
    }));
    game = place(game, P2, SlotPosition.RIGHT, replaced.instanceId);

    const result = playMemberFromZoneToStageSlotWithReplacement(game, P2, {
      cardId: incoming.instanceId,
      sourceZone: ZoneType.WAITING_ROOM,
      toSlot: SlotPosition.RIGHT,
    });

    expect(result).not.toBeNull();
    expectWaitingEntryWithoutStateChangeEvent(result!.gameState, P2, incoming.instanceId);
    expect(result!.movedToWaitingRoomCardIds).toEqual([replaced.instanceId]);
  });

  it('applies per placement in waiting-room batch play without affecting adjacent entries', () => {
    const facing = member('FACING', P2, 'facing', { heartCount: 4 });
    const adjacent = member('ADJACENT', P2, 'adjacent', { heartCount: 1 });
    let { game } = baseGame([facing, adjacent]);
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      waitingRoom: addCardToZone(
        addCardToZone(player.waitingRoom, facing.instanceId),
        adjacent.instanceId
      ),
    }));

    const result = playMembersFromWaitingRoomToEmptySlots(game, P2, [
      { cardId: facing.instanceId, toSlot: SlotPosition.RIGHT },
      { cardId: adjacent.instanceId, toSlot: SlotPosition.LEFT },
    ]);

    expect(result).not.toBeNull();
    expectWaitingEntryWithoutStateChangeEvent(result!.gameState, P2, facing.instanceId);
    expect(orientation(result!.gameState, P2, adjacent.instanceId)).toBe(OrientationState.ACTIVE);
  });

  it('applies to memberBelow -> empty stage play', () => {
    const host = member('HOST', P2, 'host', { heartCount: 2 });
    const incoming = member('BELOW', P2, 'below', { heartCount: 4 });
    let { game } = baseGame([host, incoming]);
    game = place(game, P2, SlotPosition.CENTER, host.instanceId);
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(
        player.memberSlots,
        SlotPosition.CENTER,
        incoming.instanceId
      ),
    }));

    const result = playMemberBelowCardToEmptySlot(game, P2, {
      hostCardId: host.instanceId,
      fromSlot: SlotPosition.CENTER,
      cardId: incoming.instanceId,
      toSlot: SlotPosition.RIGHT,
    });

    expect(result).not.toBeNull();
    expectWaitingEntryWithoutStateChangeEvent(result!.gameState, P2, incoming.instanceId);
  });

  it('applies to the inspection selection placement wrapper', () => {
    const incoming = member('INSPECTED', P2, 'inspected', { heartCount: 4 });
    const rest = member('REST', P2, 'rest', { heartCount: 1 });
    let { game } = baseGame([incoming, rest]);
    game = {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        cardIds: [incoming.instanceId, rest.instanceId],
      },
    };

    const result = moveInspectedSelectionToStageRestToWaitingRoomAndEnqueueTriggers(
      game,
      P2,
      [incoming.instanceId, rest.instanceId],
      incoming.instanceId,
      SlotPosition.RIGHT,
      (state) => state
    );

    expect(result).not.toBeNull();
    expectWaitingEntryWithoutStateChangeEvent(result!.gameState, P2, incoming.instanceId);
    expect(result!.waitingRoomCardIds).toEqual([rest.instanceId]);
  });
});
