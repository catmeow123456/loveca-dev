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
  updatePlayer,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { isPlayerLiveProhibited } from '../../src/domain/rules/live-prohibitions';
import { createConfirmSubPhaseAction, createSetLiveCardAction } from '../../src/application/actions';
import { GameService } from '../../src/application/game-service';
import { HS_BP2_014_ON_ENTER_DRAW_CANNOT_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'みらくらぱーく！',
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
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'みらくらぱーく！',
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function runOnEnter(mainDeckCount: number) {
  const source = createCardInstance(createMember('PL!HS-bp2-014-N'), PLAYER1, 'bp2-014-source');
  const live = createCardInstance(createLive('PL!HS-test-live'), PLAYER1, 'live-card');
  const drawCards = Array.from({ length: mainDeckCount }, (_, index) =>
    createCardInstance(createMember(`DRAW-${index}`), PLAYER1, `draw-${index}`)
  );
  const opponentLive = createCardInstance(createLive('PL!HS-test-opponent-live'), PLAYER2, 'p2-live');
  const opponentDraw = createCardInstance(createMember('P2-DRAW'), PLAYER2, 'p2-draw');
  let game = createGameState('hs-bp2-014-rurino', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, live, ...drawCards, opponentLive, opponentDraw]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [live.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [opponentLive.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: [opponentDraw.instanceId] },
  }));
  const event = createEnterStageEvent(
    source.instanceId,
    ZoneType.HAND,
    SlotPosition.CENTER,
    PLAYER1,
    PLAYER1
  );
  game = emitGameEvent(game, event);

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_ENTER_STAGE]);
  expect(result.success).toBe(true);
  return { state: result.gameState, source, live, drawCards, opponentLive, opponentDraw };
}

describe('HS-bp2-014 Rurino workflow', () => {
  it('draws one and prevents actual Live until Live end without blocking Live Set', () => {
    const { state, source, live, drawCards } = runOnEnter(4);
    const liveSetDrawnMemberId = drawCards[0].instanceId;

    expect(state.players[0].hand.cardIds).toEqual([live.instanceId, liveSetDrawnMemberId]);
    expect(isPlayerLiveProhibited(state, PLAYER1)).toBe(true);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP2_014_ON_ENTER_DRAW_CANNOT_LIVE_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.step === 'DRAW_ONE_CANNOT_LIVE_UNTIL_LIVE_END'
      )
    ).toBe(true);

    const service = new GameService();
    let liveSetState = {
      ...state,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      activePlayerIndex: 0,
      liveSetCompletedPlayers: [],
    };
    const setLiveResult = service.processAction(
      liveSetState,
      createSetLiveCardAction(PLAYER1, live.instanceId, true)
    );
    expect(setLiveResult.success).toBe(true);
    liveSetState = setLiveResult.gameState;

    const setMemberResult = service.processAction(
      liveSetState,
      createSetLiveCardAction(PLAYER1, liveSetDrawnMemberId, true)
    );
    expect(setMemberResult.success).toBe(true);
    expect(setMemberResult.gameState.players[0].liveZone.cardIds).toEqual([
      live.instanceId,
      liveSetDrawnMemberId,
    ]);

    const confirmResult = service.processAction(
      setMemberResult.gameState,
      createConfirmSubPhaseAction(PLAYER1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );
    expect(confirmResult.success).toBe(true);

    const playerAfterLiveSet = confirmResult.gameState.players[0];
    expect(playerAfterLiveSet.hand.cardIds).toEqual([
      drawCards[1].instanceId,
      drawCards[2].instanceId,
    ]);
    expect(playerAfterLiveSet.liveZone.cardIds).toEqual([]);
    expect(playerAfterLiveSet.liveZone.cardStates.size).toBe(0);
    expect(playerAfterLiveSet.waitingRoom.cardIds).toEqual([
      live.instanceId,
      liveSetDrawnMemberId,
    ]);
    expect(
      confirmResult.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LIVE_START &&
          entry.event.performerId === PLAYER1
      )
    ).toBe(false);
  });

  it('clears the restriction after Live result advances to the next active phase', () => {
    const { state, live } = runOnEnter(1);
    const service = new GameService();
    const advanceResult = service.advancePhase({
      ...state,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
    });
    expect(advanceResult.success).toBe(true);
    expect(isPlayerLiveProhibited(advanceResult.gameState, PLAYER1)).toBe(false);

    const liveSetResult = service.processAction(
      { ...advanceResult.gameState, currentPhase: GamePhase.LIVE_SET_PHASE },
      createSetLiveCardAction(PLAYER1, live.instanceId, true)
    );
    expect(liveSetResult.success).toBe(true);
  });

  it('safely resolves with an empty main deck and still applies the Live restriction', () => {
    const { state, live } = runOnEnter(0);

    expect(state.players[0].hand.cardIds).toEqual([live.instanceId]);
    expect(isPlayerLiveProhibited(state, PLAYER1)).toBe(true);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.length === 0
      )
    ).toBe(true);
  });

  it('lets the opponent proceed with Live while the prohibited player is skipped', () => {
    const { state, live, drawCards, opponentLive } = runOnEnter(3);
    const service = new GameService();
    let currentState = {
      ...state,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      activePlayerIndex: 0,
      liveSetCompletedPlayers: [],
    };

    const setP1Live = service.processAction(
      currentState,
      createSetLiveCardAction(PLAYER1, live.instanceId, true)
    );
    expect(setP1Live.success).toBe(true);
    currentState = setP1Live.gameState;

    const confirmP1 = service.processAction(
      currentState,
      createConfirmSubPhaseAction(PLAYER1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );
    expect(confirmP1.success).toBe(true);
    expect(confirmP1.gameState.players[0].liveZone.cardIds).toEqual([]);
    currentState = confirmP1.gameState;

    const setP2Live = service.processAction(
      currentState,
      createSetLiveCardAction(PLAYER2, opponentLive.instanceId, true)
    );
    expect(setP2Live.success).toBe(true);
    currentState = setP2Live.gameState;

    const confirmP2 = service.processAction(
      currentState,
      createConfirmSubPhaseAction(PLAYER2, SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(confirmP2.success).toBe(true);

    expect(confirmP2.gameState.players[0].liveZone.cardIds).toEqual([]);
    expect(confirmP2.gameState.players[0].waitingRoom.cardIds).toContain(live.instanceId);
    expect(confirmP2.gameState.players[0].hand.cardIds).toContain(drawCards[1].instanceId);
    expect(
      confirmP2.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LIVE_START &&
          entry.event.performerId === PLAYER1
      )
    ).toBe(false);
    expect(
      confirmP2.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LIVE_START &&
          entry.event.performerId === PLAYER2
      )
    ).toBe(true);

    const liveResult = service.advancePhase(confirmP2.gameState);
    expect(liveResult.success).toBe(true);
    expect(
      liveResult.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LIVE_SUCCESS &&
          entry.event.playerId === PLAYER1
      )
    ).toBe(false);
    expect(
      liveResult.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LIVE_SUCCESS &&
          entry.event.playerId === PLAYER2
      )
    ).toBe(true);
  });
});
