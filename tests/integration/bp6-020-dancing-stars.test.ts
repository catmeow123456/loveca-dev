import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
  BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
  BP6_020_AUTO_CENTER_MUSE_LIVE_START_RESOLVED_POSITION_CHANGE_ABILITY_ID,
  BP6_020_AUTO_CENTER_MUSE_LIVE_SUCCESS_RESOLVED_MOVED_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, groupName = "μ's"): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    unitName: groupName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: 'Dancing stars on me!',
    groupNames: ["μ's"],
    unitName: "μ's",
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
  };
}

function setupState(options: {
  readonly sourceSlot?: SlotPosition;
  readonly sourceGroupName?: string;
  readonly sourceCardCode?: string;
} = {}): {
  readonly game: GameState;
  readonly liveId: string;
  readonly sourceId: string;
  readonly otherId: string;
} {
  const live = createCardInstance(createLive('PL!-bp6-020-L'), PLAYER1, 'dancing-live');
  const source = createCardInstance(
    createMember(options.sourceCardCode ?? 'PL!-bp6-003-P', options.sourceGroupName ?? "μ's"),
    PLAYER1,
    'dancing-source'
  );
  const other = createCardInstance(createMember('PL!-bp6-020-other'), PLAYER1, 'dancing-other');
  const sourceSlot = options.sourceSlot ?? SlotPosition.CENTER;
  let game = createGameState('bp6-020-dancing-stars', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, source, other]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, sourceSlot, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (sourceSlot !== SlotPosition.RIGHT) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, other.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone: { ...player.liveZone, cardIds: [live.instanceId] },
      memberSlots,
    };
  });
  return { game, liveId: live.instanceId, sourceId: source.instanceId, otherId: other.instanceId };
}

function addResolvedMemberAbilityAction(
  game: GameState,
  options: {
    readonly abilityId: string;
    readonly sourceCardId: string;
    readonly sourceSlot?: SlotPosition;
  }
): GameState {
  return addAction(game, 'RESOLVE_ABILITY', PLAYER1, {
    pendingAbilityId: `${options.abilityId}:resolved`,
    abilityId: options.abilityId,
    sourceCardId: options.sourceCardId,
    sourceSlot: options.sourceSlot ?? SlotPosition.CENTER,
    step: 'TEST_MEMBER_ABILITY_RESOLVED',
  });
}

function abilityUseCount(game: GameState, abilityId: string): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === abilityId &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!-bp6-020 Dancing stars on me!', () => {
  it('position changes the center Muse member after its LIVE_START ability resolves', () => {
    const scenario = setupState();
    let state = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(scenario.game, {
        abilityId: BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
        sourceCardId: scenario.sourceId,
      })
    ).gameState;

    expect(state.activeEffect?.abilityId).toBe(
      BP6_020_AUTO_CENTER_MUSE_LIVE_START_RESOLVED_POSITION_CHANGE_ABILITY_ID
    );
    expect(state.activeEffect?.selectableSlots).toEqual([SlotPosition.LEFT, SlotPosition.RIGHT]);

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null,
      SlotPosition.LEFT
    );

    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(scenario.sourceId);
    expect(state.players[0].positionMovedThisTurn).toContain(scenario.sourceId);
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          entry.event.cardInstanceId === scenario.sourceId
      )
    ).toBe(true);
    expect(
      abilityUseCount(
        state,
        BP6_020_AUTO_CENTER_MUSE_LIVE_START_RESOLVED_POSITION_CHANGE_ABILITY_ID
      )
    ).toBe(1);
  });

  it('does not trigger from non-center, non-Muse, or unresolved abilities', () => {
    const left = setupState({ sourceSlot: SlotPosition.LEFT });
    const leftState = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(left.game, {
        abilityId: BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
        sourceCardId: left.sourceId,
        sourceSlot: SlotPosition.LEFT,
      })
    ).gameState;
    expect(leftState.pendingAbilities).toEqual([]);
    expect(leftState.activeEffect).toBeNull();

    const nonMuse = setupState({ sourceCardCode: 'PL!S-bp6-003-P', sourceGroupName: 'Aqours' });
    const nonMuseState = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(nonMuse.game, {
        abilityId: BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
        sourceCardId: nonMuse.sourceId,
      })
    ).gameState;
    expect(nonMuseState.pendingAbilities).toEqual([]);
    expect(nonMuseState.activeEffect).toBeNull();

    const unresolved = setupState();
    const unresolvedState = resolvePendingCardEffects(unresolved.game).gameState;
    expect(unresolvedState.pendingAbilities).toEqual([]);
    expect(unresolvedState.activeEffect).toBeNull();
  });

  it('adds score after a center Muse LIVE_SUCCESS ability resolves if that member moved this turn', () => {
    const scenario = setupState();
    const movedGame = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      positionMovedThisTurn: [scenario.sourceId],
    }));
    const state = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(movedGame, {
        abilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
      })
    ).gameState;

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: scenario.liveId,
      sourceCardId: scenario.liveId,
      abilityId: BP6_020_AUTO_CENTER_MUSE_LIVE_SUCCESS_RESOLVED_MOVED_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(
      abilityUseCount(
        state,
        BP6_020_AUTO_CENTER_MUSE_LIVE_SUCCESS_RESOLVED_MOVED_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toBe(1);
  });

  it('resolves without score when the center Muse member has not moved', () => {
    const scenario = setupState();
    const state = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(scenario.game, {
        abilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
      })
    ).gameState;

    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
    expect(
      abilityUseCount(
        state,
        BP6_020_AUTO_CENTER_MUSE_LIVE_SUCCESS_RESOLVED_MOVED_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toBe(1);
  });

  it('applies turn-once separately for each auto ability', () => {
    const scenario = setupState();
    let state = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(scenario.game, {
        abilityId: BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
        sourceCardId: scenario.sourceId,
      })
    ).gameState;
    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null,
      SlotPosition.LEFT
    );
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, scenario.sourceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const secondLiveStart = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(state, {
        abilityId: BP6_003_LIVE_START_CENTER_REVEAL_LOW_COST_MUSE_MEMBER_STACK_GAIN_HEART_ABILITY_ID,
        sourceCardId: scenario.sourceId,
      })
    ).gameState;
    expect(secondLiveStart.activeEffect).toBeNull();
    expect(
      abilityUseCount(
        secondLiveStart,
        BP6_020_AUTO_CENTER_MUSE_LIVE_START_RESOLVED_POSITION_CHANGE_ABILITY_ID
      )
    ).toBe(1);

    const liveSuccessState = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(secondLiveStart, {
        abilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
      })
    ).gameState;
    expect(
      abilityUseCount(
        liveSuccessState,
        BP6_020_AUTO_CENTER_MUSE_LIVE_SUCCESS_RESOLVED_MOVED_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toBe(1);
  });
});
