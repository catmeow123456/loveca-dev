import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
  HS_PB1_025_LIVE_START_HASUNOSORA_WAITING_TARGET_GREEN_HEART_ABILITY_ID,
  HS_PB1_025_LIVE_SUCCESS_HAND_SIX_RECOVER_MEMBER_ABILITY_ID,
  HS_PB1_027_LIVE_SUCCESS_OPTIONAL_MILL_TOP_FOUR_IF_CERISE_MEMBER_ABILITY_ID,
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

function createMember(
  cardCode: string,
  name = cardCode,
  groupName = '蓮ノ空女学院スクールアイドルクラブ',
  unitName = 'スリーズブーケ'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createLive(cardCode: string, score = 1, unitName = 'スリーズブーケ'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function createSessionFromState(state: GameState): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  session.createGame('hs-pb1-024-025-027-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function resolve(state: GameState): GameState {
  return resolvePendingCardEffects(state).gameState;
}

describe('PL!HS-pb1-024-N arrange inspected top two', () => {
  it('puts selected inspected cards on top and sends the rest through the inspection waiting-room wrapper', () => {
    const source = createCardInstance(createMember('PL!HS-pb1-024-N', '桂城 泉'), PLAYER1, 'izumi');
    const topA = createCardInstance(createMember('PL!HS-pb1-024-top-a'), PLAYER1, 'top-a');
    const topB = createCardInstance(createMember('PL!HS-pb1-024-top-b'), PLAYER1, 'top-b');
    let game = createGameState('hs-pb1-024-arrange', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, topA, topB]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [topA.instanceId, topB.instanceId] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        {
          id: 'pb1-024-on-enter',
          abilityId: HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
          sourceCardId: source.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          eventIds: ['manual-on-enter'],
        },
      ],
    };

    const session = createSessionFromState(resolve(game));
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
      selectableCardIds: [topA.instanceId, topB.instanceId],
    });

    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [topB.instanceId]
      )
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe(topB.instanceId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(topA.instanceId);
    expect(
      session.state?.eventLog.some((entry) => {
        const event = entry.event;
        return (
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK &&
          event.toZone === ZoneType.WAITING_ROOM &&
          event.cardInstanceIds?.includes(topA.instanceId)
        );
      })
    ).toBe(true);
  });
});

describe('PL!HS-pb1-027-L optional direct mill', () => {
  function setupYumewazurai(hasCeriseStageMember = true): {
    readonly state: GameState;
    readonly topCardIds: readonly string[];
  } {
    const live = createCardInstance(createLive('PL!HS-pb1-027-L'), PLAYER1, 'yumewazurai');
    const cerise = createCardInstance(
      createMember('PL!HS-test-cerise', '日野下花帆', '蓮ノ空女学院スクールアイドルクラブ', 'スリーズブーケ'),
      PLAYER1,
      'cerise'
    );
    const topCards = Array.from({ length: 4 }, (_, index) =>
      createCardInstance(createMember(`PL!HS-pb1-027-top-${index}`), PLAYER1, `top-${index}`)
    );
    const tailCard = createCardInstance(createMember('PL!HS-pb1-027-tail'), PLAYER1, 'tail');
    let game = createGameState('hs-pb1-027-mill', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [live, cerise, ...topCards, tailCard]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: {
        ...player.mainDeck,
        cardIds: [...topCards.map((card) => card.instanceId), tailCard.instanceId],
      },
      liveZone: {
        ...player.liveZone,
        cardIds: [live.instanceId],
        cardStates: new Map([
          [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
      memberSlots: hasCeriseStageMember
        ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, cerise.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          })
        : player.memberSlots,
    }));
    return {
      state: {
        ...game,
        pendingAbilities: [
          {
            id: 'pb1-027-live-success',
            abilityId: HS_PB1_027_LIVE_SUCCESS_OPTIONAL_MILL_TOP_FOUR_IF_CERISE_MEMBER_ABILITY_ID,
            sourceCardId: live.instanceId,
            controllerId: PLAYER1,
            mandatory: true,
            timingId: TriggerCondition.ON_LIVE_SUCCESS,
            eventIds: ['manual-live-success'],
          },
        ],
      },
      topCardIds: topCards.map((card) => card.instanceId),
    };
  }

  it('opens the optional window before moving any deck cards and mills only after choosing to activate', () => {
    const { state, topCardIds } = setupYumewazurai();
    const session = createSessionFromState(resolve(state));

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_PB1_027_LIVE_SUCCESS_OPTIONAL_MILL_TOP_FOUR_IF_CERISE_MEMBER_ABILITY_ID,
      stepId: 'HS_PB1_027_DECIDE_MILL_TOP_FOUR',
      canSkipSelection: true,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          'activate'
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'HS_PB1_027_REVEAL_MILLED_TOP_FOUR',
      revealedCardIds: topCardIds,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);

    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id))
        .success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('declines without milling and skips safely without a Cerise Bouquet stage member', () => {
    const decline = createSessionFromState(resolve(setupYumewazurai().state));
    expect(
      decline.executeCommand(createConfirmEffectStepCommand(PLAYER1, decline.state!.activeEffect!.id))
        .success
    ).toBe(true);
    expect(decline.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const noCerise = resolve(setupYumewazurai(false).state);
    expect(noCerise.activeEffect).toBeNull();
    expect(noCerise.players[0].waitingRoom.cardIds).toEqual([]);
  });
});

describe('PL!HS-pb1-025-L live start/success', () => {
  it('chooses a Hasunosora stage member for green Heart at LIVE start and recovers a member on LIVE success', () => {
    const live = createCardInstance(createLive('PL!HS-pb1-025-L', 3), PLAYER1, 'dakishimeru');
    const target = createCardInstance(createMember('PL!HS-test-target', '乙宗梢'), PLAYER1, 'target');
    const waitingMembers = Array.from({ length: 10 }, (_, index) =>
      createCardInstance(createMember(`PL!HS-pb1-025-waiting-${index}`), PLAYER1, `waiting-${index}`)
    );
    const recoverTarget = waitingMembers[0]!;
    let game = createGameState('hs-pb1-025-live', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [live, target, ...waitingMembers]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: waitingMembers.map((card) => card.instanceId),
      },
      liveZone: {
        ...player.liveZone,
        cardIds: [live.instanceId],
        cardStates: new Map([
          [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, target.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));

    const liveStartSession = createSessionFromState(
      resolve({
        ...game,
        pendingAbilities: [
          {
            id: 'pb1-025-live-start',
            abilityId: HS_PB1_025_LIVE_START_HASUNOSORA_WAITING_TARGET_GREEN_HEART_ABILITY_ID,
            sourceCardId: live.instanceId,
            controllerId: PLAYER1,
            mandatory: true,
            timingId: TriggerCondition.ON_LIVE_START,
            eventIds: ['manual-live-start'],
          },
        ],
      })
    );
    expect(liveStartSession.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    expect(
      liveStartSession.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, liveStartSession.state!.activeEffect!.id, target.instanceId)
      ).success
    ).toBe(true);
    expect(liveStartSession.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: target.instanceId,
      sourceCardId: live.instanceId,
      abilityId: HS_PB1_025_LIVE_START_HASUNOSORA_WAITING_TARGET_GREEN_HEART_ABILITY_ID,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
    });

    const liveSuccessSession = createSessionFromState(
      resolve({
        ...game,
        pendingAbilities: [
          {
            id: 'pb1-025-live-success',
            abilityId: HS_PB1_025_LIVE_SUCCESS_HAND_SIX_RECOVER_MEMBER_ABILITY_ID,
            sourceCardId: live.instanceId,
            controllerId: PLAYER1,
            mandatory: true,
            timingId: TriggerCondition.ON_LIVE_SUCCESS,
            eventIds: ['manual-live-success'],
          },
        ],
      })
    );
    expect(liveSuccessSession.state?.activeEffect?.selectableCardIds).toContain(
      recoverTarget.instanceId
    );
    expect(
      liveSuccessSession.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          liveSuccessSession.state!.activeEffect!.id,
          recoverTarget.instanceId
        )
      ).success
    ).toBe(true);
    expect(liveSuccessSession.state?.players[0].hand.cardIds).toContain(recoverTarget.instanceId);
  });
});
