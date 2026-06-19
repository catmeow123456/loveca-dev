import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import type { PendingAbilityState } from '../../src/domain/entities/game';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createHime(): MemberCardData {
  return {
    cardCode: 'PL!HS-bp6-006-SEC',
    name: '安養寺 姫芽',
    groupName: '蓮ノ空女学院スクールアイドルクラブ',
    unitName: 'みらくらぱーく！',
    cardType: CardType.MEMBER,
    cost: 20,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(): LiveCardData {
  return {
    cardCode: 'TEST-LIVE',
    name: 'テストLIVE',
    groupName: '蓮ノ空女学院スクールアイドルクラブ',
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createLiveSuccessState() {
  const hime = createCardInstance(createHime(), PLAYER1, 'hime-source');
  const live = createCardInstance(createLive(), PLAYER1, 'successful-live');
  let game = createGameState('hs-bp6-006-hime', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [hime, live]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hime.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[live.instanceId, true]]),
      playerScores: new Map([
        [PLAYER1, 1],
        [PLAYER2, 0],
      ]),
      performingPlayerId: PLAYER1,
    },
  };

  return { game, hime, live };
}

describe('HS-bp6-006 安養寺 姫芽 workflow', () => {
  it('waits the source member and marks it to skip the next own active phase on LIVE success', () => {
    const { game, hime } = createLiveSuccessState();

    const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);

    expect(result.success).toBe(true);
    expect(result.gameState.pendingAbilities).toEqual([]);
    expect(
      result.gameState.players[0].memberSlots.cardStates.get(hime.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(result.gameState.memberActivePhaseSkips).toEqual([
      {
        playerId: PLAYER1,
        memberCardId: hime.instanceId,
        sourceCardId: hime.instanceId,
        abilityId: HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID,
      },
    ]);
    expect(
      result.gameState.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
            event.cardInstanceId === hime.instanceId
        )
    ).toMatchObject({
      eventType: TriggerCondition.ON_MEMBER_STATE_CHANGED,
      cardInstanceId: hime.instanceId,
      controllerId: PLAYER1,
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: PLAYER1,
        sourceCardId: hime.instanceId,
        abilityId: HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID,
      },
    });
    expect(
      result.gameState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID &&
          action.payload.step === 'WAIT_SOURCE_SKIP_NEXT_ACTIVE'
      )
    ).toBe(true);
  });

  it('skips only the next own active phase and can become active on the following one', () => {
    const { game, hime } = createLiveSuccessState();
    const service = new GameService();
    const liveSuccess = service.executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);

    const skippedActive = service.advancePhase({
      ...liveSuccess.gameState,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });

    expect(skippedActive.success).toBe(true);
    expect(skippedActive.gameState.memberActivePhaseSkips).toEqual([]);
    expect(
      skippedActive.gameState.players[0].memberSlots.cardStates.get(hime.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      skippedActive.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === hime.instanceId &&
          entry.event.previousOrientation === OrientationState.WAITING &&
          entry.event.nextOrientation === OrientationState.ACTIVE
      )
    ).toBe(false);

    const followingActive = service.advancePhase({
      ...skippedActive.gameState,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });

    expect(followingActive.success).toBe(true);
    expect(
      followingActive.gameState.players[0].memberSlots.cardStates.get(hime.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('safely resolves as no-op when the source member is no longer on stage', () => {
    const hime = createCardInstance(createHime(), PLAYER1, 'hime-source');
    let game = createGameState('hs-bp6-006-hime-no-op', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [hime]);
    const pendingAbility: PendingAbilityState = {
      id: 'pending-hs-bp6-006-no-op',
      abilityId: HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID,
      sourceCardId: hime.instanceId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_SUCCESS,
      eventIds: ['live-success:test'],
    };
    game = {
      ...game,
      pendingAbilities: [pendingAbility],
    };

    const result = new GameService().executeCheckTiming(game, []);

    expect(result.success).toBe(true);
    expect(result.gameState.pendingAbilities).toEqual([]);
    expect(result.gameState.memberActivePhaseSkips).toEqual([]);
    expect(
      result.gameState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_006_LIVE_SUCCESS_WAIT_SKIP_NEXT_ACTIVE_ABILITY_ID &&
          action.payload.step === 'SOURCE_NOT_ON_STAGE_NO_OP'
      )
    ).toBe(true);
  });
});
