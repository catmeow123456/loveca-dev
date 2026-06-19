import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  type GameState,
  updatePlayer,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createLeaveStageEvent } from '../../src/domain/events/game-events';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: '蓮ノ空女学院スクールアイドルクラブ',
    unitName: 'みらくらぱーく！',
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function startPositionChange(targetPlayerId: string, targetLocalSlot: SlotPosition) {
  const source = createCardInstance(createMember('PL!HS-bp5-003-AR'), PLAYER1, 'bp5-003-source');
  const target = createCardInstance(createMember('TARGET-MEMBER'), targetPlayerId, 'target-member');
  let game = createGameState('hs-bp5-003-position', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, target]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    waitingRoom: addCardToZone(player.waitingRoom, source.instanceId),
  }));
  game = updatePlayer(game, targetPlayerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, targetLocalSlot, target.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = emitGameEvent(
    game,
    createLeaveStageEvent(
      source.instanceId,
      SlotPosition.CENTER,
      ZoneType.WAITING_ROOM,
      PLAYER1,
      PLAYER1
    )
  );

  const checkResult = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LEAVE_STAGE]);
  expect(checkResult.success).toBe(true);
  const session = createGameSession();
  session.createGame('hs-bp5-003-position-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;
  return { session, target };
}

describe('HS-bp5-003 Rurino position-change slot perspective', () => {
  it('keeps own member slot selection in the controller local perspective', () => {
    const { session, target } = startPositionChange(PLAYER1, SlotPosition.LEFT);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ]);

    const moveResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(target.instanceId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID &&
          action.payload.controllerPerspectiveSlot === SlotPosition.RIGHT &&
          action.payload.targetLocalSlot === SlotPosition.RIGHT
      )
    ).toBe(true);
  });

  it('mirrors opponent member slot selection from the controller perspective', () => {
    const { session, target } = startPositionChange(PLAYER2, SlotPosition.LEFT);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.CENTER,
    ]);

    const moveResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.LEFT
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.players[1].memberSlots.slots[SlotPosition.RIGHT]).toBe(target.instanceId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID &&
          action.payload.controllerPerspectiveSlot === SlotPosition.LEFT &&
          action.payload.targetLocalSlot === SlotPosition.RIGHT
      )
    ).toBe(true);
  });
});
