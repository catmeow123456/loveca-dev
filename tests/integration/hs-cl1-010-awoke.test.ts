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
  type LiveModifierState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { HS_CL1_010_LIVE_START_HIGH_COST_HASUNOSORA_MEMBER_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createAwoke(): LiveCardData {
  return {
    cardCode: 'PL!HS-cl1-010-CL',
    name: 'AWOKE',
    groupName: '蓮ノ空女学院スクールアイドルクラブ',
    unitName: 'DOLLCHESTRA',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
  };
}

function createMember(
  cardCode: string,
  name: string,
  cost: number,
  groupName = '蓮ノ空女学院スクールアイドルクラブ',
  unitName = 'DOLLCHESTRA'
): MemberCardData {
  return {
    cardCode,
    name,
    groupName,
    unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function buildLiveStartState(options: {
  readonly stageMembers: readonly {
    readonly card: MemberCardData;
    readonly id: string;
    readonly slot: SlotPosition;
  }[];
  readonly opponentStageMembers?: readonly {
    readonly card: MemberCardData;
    readonly id: string;
    readonly slot: SlotPosition;
  }[];
  readonly memberCostModifiers?: readonly {
    readonly memberId: string;
    readonly countDelta: number;
  }[];
}) {
  const live = createCardInstance(createAwoke(), PLAYER1, 'awoke-live');
  const stageMembers = options.stageMembers.map((member) =>
    createCardInstance(member.card, PLAYER1, member.id)
  );
  const opponentStageMembers = (options.opponentStageMembers ?? []).map((member) =>
    createCardInstance(member.card, PLAYER2, member.id)
  );

  let game = createGameState('hs-cl1-010-awoke', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ...stageMembers, ...opponentStageMembers]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    options.stageMembers.forEach((member, index) => {
      memberSlots = placeCardInSlot(memberSlots, member.slot, stageMembers[index]!.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
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
  game = updatePlayer(game, PLAYER2, (player) => {
    let memberSlots = player.memberSlots;
    (options.opponentStageMembers ?? []).forEach((member, index) => {
      memberSlots = placeCardInSlot(
        memberSlots,
        member.slot,
        opponentStageMembers[index]!.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      );
    });
    return { ...player, memberSlots };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      liveModifiers: createMemberCostModifiers(options.memberCostModifiers ?? [], live.instanceId),
    },
  };

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return { state: result.gameState, live, stageMembers, opponentStageMembers };
}

function createMemberCostModifiers(
  modifiers: readonly { readonly memberId: string; readonly countDelta: number }[],
  sourceCardId: string
): readonly LiveModifierState[] {
  return modifiers.map((modifier) => ({
    kind: 'MEMBER_COST',
    playerId: PLAYER1,
    memberCardId: modifier.memberId,
    countDelta: modifier.countDelta,
    sourceCardId,
    abilityId: 'test-member-cost-modifier',
  }));
}

function createSessionFromState(state: GameState): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  session.createGame('hs-cl1-010-awoke-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function confirmCard(session: ReturnType<typeof createGameSession>, selectedCardId: string) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
}

describe('PL!HS-cl1-010-CL AWOKE workflow', () => {
  it('gives BLADE +2 to a selected high-effective-cost Hasunosora member', () => {
    const { state, live, stageMembers } = buildLiveStartState({
      stageMembers: [
        {
          card: createMember('PL!HS-test-high-hasunosora', '夕霧綴理', 10),
          id: 'high-hasunosora',
          slot: SlotPosition.LEFT,
        },
      ],
    });
    const session = createSessionFromState(state);
    const target = stageMembers[0]!;

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_CL1_010_LIVE_START_HIGH_COST_HASUNOSORA_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
      selectableCardIds: [target.instanceId],
    });

    confirmCard(session, target.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: target.instanceId,
      abilityId: HS_CL1_010_LIVE_START_HIGH_COST_HASUNOSORA_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_CL1_010_LIVE_START_HIGH_COST_HASUNOSORA_MEMBER_GAIN_TWO_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === live.instanceId &&
          action.payload.targetMemberCardId === target.instanceId &&
          action.payload.bladeBonus === 2
      )
    ).toBe(true);
  });

  it('filters out non-Hasunosora members, opponent members, and insufficient-cost members', () => {
    const { state, stageMembers, opponentStageMembers } = buildLiveStartState({
      stageMembers: [
        {
          card: createMember('PL!HS-test-high-hasunosora', '夕霧綴理', 10),
          id: 'high-hasunosora',
          slot: SlotPosition.LEFT,
        },
        {
          card: createMember('PL!HS-test-low-hasunosora', '村野さやか', 9),
          id: 'low-hasunosora',
          slot: SlotPosition.CENTER,
        },
        {
          card: createMember('PL!S-test-high-non-hasunosora', '高坂穂乃果', 10, "μ's"),
          id: 'high-non-hasunosora',
          slot: SlotPosition.RIGHT,
        },
      ],
      opponentStageMembers: [
        {
          card: createMember('PL!HS-test-opponent-high-hasunosora', '乙宗梢', 10),
          id: 'opponent-high-hasunosora',
          slot: SlotPosition.LEFT,
        },
      ],
    });
    const target = stageMembers[0]!;

    expect(state.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    expect(state.activeEffect?.selectableCardIds).not.toContain(stageMembers[1]!.instanceId);
    expect(state.activeEffect?.selectableCardIds).not.toContain(stageMembers[2]!.instanceId);
    expect(state.activeEffect?.selectableCardIds).not.toContain(
      opponentStageMembers[0]!.instanceId
    );
  });

  it('uses effective cost for the high-cost Hasunosora member condition', () => {
    const { state, live, stageMembers } = buildLiveStartState({
      stageMembers: [
        {
          card: createMember('PL!HS-test-effective-cost-hasunosora', '村野さやか', 9),
          id: 'effective-cost-hasunosora',
          slot: SlotPosition.LEFT,
        },
      ],
      memberCostModifiers: [{ memberId: 'effective-cost-hasunosora', countDelta: 1 }],
    });
    const session = createSessionFromState(state);
    const target = stageMembers[0]!;

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);

    confirmCard(session, target.instanceId);

    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: target.instanceId,
      abilityId: HS_CL1_010_LIVE_START_HIGH_COST_HASUNOSORA_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.sourceCardId === live.instanceId &&
          action.payload.step === 'TARGET_HIGH_COST_HASUNOSORA_MEMBER_GAIN_BLADE'
      )
    ).toBe(true);
  });

  it('consumes the pending ability with no target when there are no legal members', () => {
    const { state, live } = buildLiveStartState({
      stageMembers: [
        {
          card: createMember('PL!HS-test-low-hasunosora', '村野さやか', 9),
          id: 'low-hasunosora',
          slot: SlotPosition.LEFT,
        },
        {
          card: createMember('PL!S-test-high-non-hasunosora', '高坂穂乃果', 10, "μ's"),
          id: 'high-non-hasunosora',
          slot: SlotPosition.CENTER,
        },
      ],
    });

    expect(state.activeEffect).toBeNull();
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_CL1_010_LIVE_START_HIGH_COST_HASUNOSORA_MEMBER_GAIN_TWO_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === live.instanceId &&
          action.payload.step === 'NO_HIGH_COST_HASUNOSORA_MEMBER_TARGET'
      )
    ).toBe(true);
  });
});
