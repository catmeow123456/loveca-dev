import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createEdelied(): LiveCardData {
  return {
    cardCode: 'PL!HS-pb1-030-L',
    name: 'Edelied',
    groupName: '蓮ノ空女学院スクールアイドルクラブ',
    unitName: 'EdelNote',
    cardType: CardType.LIVE,
    score: 7,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
  };
}

function createMember(
  cardCode: string,
  name: string,
  unitName = 'EdelNote',
  groupName = '蓮ノ空女学院スクールアイドルクラブ'
): MemberCardData {
  return {
    cardCode,
    name,
    groupName,
    unitName,
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function buildLiveStartState(
  members: readonly { readonly card: MemberCardData; readonly id: string }[]
) {
  const live = createCardInstance(createEdelied(), PLAYER1, 'edelied-live');
  const memberInstances = members.map((member) =>
    createCardInstance(member.card, PLAYER1, member.id)
  );

  let game = createGameState('hs-pb1-030-edelied', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ...memberInstances]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    memberInstances.forEach((member, index) => {
      memberSlots = placeCardInSlot(
        memberSlots,
        [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index],
        member.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      );
    });

    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots,
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
    },
  };

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return { state: result.gameState, live, members: memberInstances };
}

function createSessionFromState(state: GameState): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  session.createGame('hs-pb1-030-edelied-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

describe('PL!HS-pb1-030-L Edelied workflow', () => {
  it('gives BLADE +2 to one EdelNote member, then purple Heart +2 to a different-name EdelNote member', () => {
    const { state, live, members } = buildLiveStartState([
      {
        card: createMember('PL!HS-test-seras', 'セラス 柳田 リリエンフェルト'),
        id: 'seras',
      },
      { card: createMember('PL!HS-test-izumi', '桂城 泉'), id: 'izumi' },
      {
        card: createMember('PL!HS-test-not-edel', '日野下花帆', 'スリーズブーケ'),
        id: 'non-edelnote',
      },
    ]);
    const session = createSessionFromState(state);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID,
      selectableCardIds: [members[0].instanceId, members[1].instanceId],
    });

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          members[0].instanceId
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'HS_PB1_030_SELECT_DIFFERENT_NAME_EDELNOTE_MEMBER_PURPLE_HEART_TARGET',
      selectableCardIds: [members[1].instanceId],
    });

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          members[1].instanceId
        )
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: members[0].instanceId,
      abilityId: HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID,
    });
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: members[1].instanceId,
      hearts: [{ color: HeartColor.PURPLE, count: 2 }],
      sourceCardId: live.instanceId,
      abilityId: HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID,
    });
  });

  it('clears the effect with no-target when there are no EdelNote members', () => {
    const { state, live } = buildLiveStartState([
      {
        card: createMember('PL!HS-test-kaho', '日野下花帆', 'スリーズブーケ'),
        id: 'kaho',
      },
    ]);

    expect(state.activeEffect).toBeNull();
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID &&
          action.payload.sourceCardId === live.instanceId &&
          action.payload.step === 'NO_EDELNOTE_BLADE_TARGET'
      )
    ).toBe(true);
  });

  it('keeps the first BLADE target when there is no different-name EdelNote Heart target', () => {
    const { state, members } = buildLiveStartState([
      {
        card: createMember('PL!HS-test-seras-a', 'セラス 柳田 リリエンフェルト'),
        id: 'seras-a',
      },
      {
        card: createMember('PL!HS-test-seras-b', 'セラス 柳田 リリエンフェルト'),
        id: 'seras-b',
      },
    ]);
    const session = createSessionFromState(state);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          members[0].instanceId
        )
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        sourceCardId: members[0].instanceId,
        countDelta: 2,
      })
    );
    expect(
      session.state?.liveResolution.liveModifiers.some((modifier) => modifier.kind === 'HEART')
    ).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_030_LIVE_START_EDELNOTE_MEMBER_BLADE_DIFFERENT_NAME_PURPLE_HEART_ABILITY_ID &&
          action.payload.step === 'NO_DIFFERENT_NAME_EDELNOTE_HEART_TARGET'
      )
    ).toBe(true);
  });

  it('excludes same-name EdelNote members from the second target while allowing different names', () => {
    const { state, members } = buildLiveStartState([
      {
        card: createMember('PL!HS-test-seras-a', 'セラス 柳田 リリエンフェルト'),
        id: 'seras-a',
      },
      {
        card: createMember('PL!HS-test-seras-b', 'セラス 柳田 リリエンフェルト'),
        id: 'seras-b',
      },
      { card: createMember('PL!HS-test-izumi', '桂城 泉'), id: 'izumi' },
    ]);
    const session = createSessionFromState(state);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          members[0].instanceId
        )
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([members[2].instanceId]);
  });
});
