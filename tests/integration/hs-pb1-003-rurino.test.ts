import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterWaitingRoomEvent } from '../../src/domain/events/game-events';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, unitName = 'みらくらぱーく！'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 15,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

describe('HS-pb1-003 Rurino workflow', () => {
  it('limits the hand-to-waiting auto ability to two events per turn', () => {
    const source = createCardInstance(createMember('PL!HS-pb1-003-P＋'), PLAYER1, 'limit-source');
    const movedCards = [0, 1, 2].map((index) =>
      createCardInstance(createMember(`MOVED-${index}`), PLAYER1, `moved-${index}`)
    );
    let game = createGameState('hs-pb1-003-turn-limit', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, ...movedCards]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: movedCards.map((card) => card.instanceId) },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));

    for (const movedCard of movedCards) {
      const event = createEnterWaitingRoomEvent(
        [movedCard.instanceId],
        ZoneType.HAND,
        PLAYER1,
        PLAYER1
      );
      game = emitGameEvent(game, event);
      game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
        enterWaitingRoomEvents: [event],
      });
      game = resolvePendingCardEffects(game).gameState;
    }

    expect(
      game.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toHaveLength(2);
    expect(
      game.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toHaveLength(4);
  });
});
