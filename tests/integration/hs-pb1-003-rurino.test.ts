import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  type GameState,
  updatePlayer,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
} from '../../src/domain/events/game-events';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
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
    groupName: '蓮ノ空女学院スクールアイドルクラブ',
    unitName,
    cardType: CardType.MEMBER,
    cost: 15,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: '蓮ノ空女学院スクールアイドルクラブ',
    unitName: 'みらくらぱーく！',
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function startOnEnter() {
  const source = createCardInstance(createMember('PL!HS-pb1-003-R'), PLAYER1, 'pb1-003-source');
  const mira1 = createCardInstance(createMember('MIRACRA-1'), PLAYER1, 'mira-1');
  const mira2 = createCardInstance(createMember('MIRACRA-2'), PLAYER1, 'mira-2');
  const nonMira = createCardInstance(createMember('CERISE-1', 'スリーズブーケ'), PLAYER1, 'cerise');
  const live = createCardInstance(createLive('MIRACRA-LIVE'), PLAYER1, 'live-non-member');
  const drawCards = Array.from({ length: 4 }, (_, index) =>
    createCardInstance(createMember(`DRAW-${index}`), PLAYER1, `draw-${index}`)
  );
  let game = createGameState('hs-pb1-003-rurino', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, mira1, mira2, nonMira, live, ...drawCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: [mira1.instanceId, mira2.instanceId, nonMira.instanceId, live.instanceId],
    },
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );

  const checkResult = new GameService().executeCheckTiming(game, [TriggerCondition.ON_ENTER_STAGE]);
  expect(checkResult.success).toBe(true);
  const session = createGameSession();
  session.createGame('hs-pb1-003-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;
  return { session, source, mira1, mira2, nonMira, live, drawCards };
}

function confirmSelected(
  session: ReturnType<typeof createGameSession>,
  cardIds: readonly string[]
) {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      activeEffect.id,
      undefined,
      null,
      undefined,
      null,
      cardIds
    )
  );
  expect(result.success).toBe(true);
}

describe('HS-pb1-003 Rurino workflow', () => {
  it('allows choosing zero cards and still draws one', () => {
    const { session, drawCards } = startOnEnter();

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.minSelectableCards).toBe(0);

    confirmSelected(session, []);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(drawCards[0].instanceId);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toHaveLength(0);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID &&
          Array.isArray(action.payload.discardedCardIds) &&
          action.payload.discardedCardIds.length === 0 &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.length === 1
      )
    ).toBe(true);
  });

  it('filters selectable cards to Mira-Cra members only', () => {
    const { session, mira1, mira2, nonMira, live } = startOnEnter();

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      mira1.instanceId,
      mira2.instanceId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(nonMira.instanceId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(live.instanceId);
  });

  it('discards selected Mira-Cra members, draws count plus one, and triggers the auto once', () => {
    const { session, source, mira1, mira2, nonMira, live, drawCards } = startOnEnter();

    confirmSelected(session, [mira1.instanceId, mira2.instanceId]);

    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      mira1.instanceId,
      mira2.instanceId,
    ]);
    expect(session.state?.players[0].hand.cardIds).toEqual([
      nonMira.instanceId,
      live.instanceId,
      drawCards[0].instanceId,
      drawCards[1].instanceId,
      drawCards[2].instanceId,
    ]);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toHaveLength(1);
    expect(
      session.state?.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(1);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: source.instanceId,
      abilityId: HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: source.instanceId,
      abilityId: HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
      countDelta: 1,
    });
  });

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
