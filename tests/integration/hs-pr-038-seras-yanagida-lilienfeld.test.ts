import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { GameService } from '../../src/application/game-service';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PR_038_LIVE_SUCCESS_WAIT_OPPONENT_COST_FOUR_SKIP_NEXT_ACTIVE_ABILITY_ID,
  HS_PR_038_ON_ENTER_NON_HAND_GAIN_PURPLE_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
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

function member(cardCode: string, cost: number, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'Edel Note',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function putOnStage(
  game: GameState,
  playerId: string,
  cardId: string,
  slot: SlotPosition,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function countEffectiveHearts(
  game: GameState,
  playerId: string,
  memberCardId: string,
  color: HeartColor
): number {
  return getMemberEffectiveHeartIcons(game, playerId, memberCardId)
    .filter((heart) => heart.color === color)
    .reduce((sum, heart) => sum + heart.count, 0);
}

function createEnterScenario(fromZone: ZoneType): {
  readonly game: GameState;
  readonly sourceId: string;
} {
  const source = createCardInstance(
    member('PL!HS-PR-038-PR', 4, 'セラス 柳田 リリエンフェルト'),
    PLAYER1,
    `seras-${fromZone}`
  );
  let game = createGameState(`hs-pr-038-enter-${fromZone}`, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source]);
  game = putOnStage(game, PLAYER1, source.instanceId, SlotPosition.CENTER);
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, fromZone, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );
  return {
    game: enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]),
    sourceId: source.instanceId,
  };
}

function confirmSinglePendingAbility(game: GameState): GameState {
  const preview = resolvePendingCardEffects(game).gameState;
  if (preview.activeEffect?.metadata?.confirmOnlyPendingAbility !== true) {
    return preview;
  }
  expect(preview.activeEffect.abilityId).toBe(
    HS_PR_038_ON_ENTER_NON_HAND_GAIN_PURPLE_HEART_ABILITY_ID
  );
  return confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect.id);
}

function liveSuccessPending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'hs-pr-038-live-success-pending',
    abilityId: HS_PR_038_LIVE_SUCCESS_WAIT_OPPONENT_COST_FOUR_SKIP_NEXT_ACTIVE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['hs-pr-038-live-success-event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function createLiveSuccessScenario(
  options: {
    readonly includeLegalTarget?: boolean;
  } = {}
): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly legalTargetId: string | null;
  readonly highCostTargetId: string;
  readonly waitingTargetId: string;
} {
  const source = createCardInstance(
    member('PL!HS-PR-038-PR', 4, 'セラス 柳田 リリエンフェルト'),
    PLAYER1,
    'seras-live-success'
  );
  const legalTarget =
    options.includeLegalTarget === false
      ? null
      : createCardInstance(member('PL!HS-test-cost-4', 4), PLAYER2, 'opponent-cost-4');
  const highCostTarget = createCardInstance(
    member('PL!HS-test-cost-5', 5),
    PLAYER2,
    'opponent-cost-5'
  );
  const waitingTarget = createCardInstance(
    member('PL!HS-test-waiting-cost-3', 3),
    PLAYER2,
    'opponent-waiting-cost-3'
  );
  let game = createGameState('hs-pr-038-live-success', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...(legalTarget ? [legalTarget] : []),
    highCostTarget,
    waitingTarget,
  ]);
  game = putOnStage(game, PLAYER1, source.instanceId, SlotPosition.CENTER);
  if (legalTarget) {
    game = putOnStage(game, PLAYER2, legalTarget.instanceId, SlotPosition.LEFT);
  }
  game = putOnStage(game, PLAYER2, highCostTarget.instanceId, SlotPosition.CENTER);
  game = putOnStage(
    game,
    PLAYER2,
    waitingTarget.instanceId,
    SlotPosition.RIGHT,
    OrientationState.WAITING
  );
  return {
    game: {
      ...game,
      pendingAbilities: [liveSuccessPending(source.instanceId)],
    },
    sourceId: source.instanceId,
    legalTargetId: legalTarget?.instanceId ?? null,
    highCostTargetId: highCostTarget.instanceId,
    waitingTargetId: waitingTarget.instanceId,
  };
}

function latestResolvePayload(game: GameState, abilityId: string) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    .at(-1)?.payload;
}

describe('PL!HS-PR-038-PR 费用4「赛拉丝·柳田·利林费尔德」', () => {
  it('triggers the on-enter Heart ability only after a non-hand entry', () => {
    const fromHand = createEnterScenario(ZoneType.HAND);
    expect(fromHand.game.pendingAbilities).toEqual([]);
    expect(countEffectiveHearts(fromHand.game, PLAYER1, fromHand.sourceId, HeartColor.PURPLE)).toBe(
      0
    );

    const fromWaitingRoom = createEnterScenario(ZoneType.WAITING_ROOM);
    expect(fromWaitingRoom.game.pendingAbilities).toEqual([
      expect.objectContaining({
        abilityId: HS_PR_038_ON_ENTER_NON_HAND_GAIN_PURPLE_HEART_ABILITY_ID,
        sourceCardId: fromWaitingRoom.sourceId,
      }),
    ]);

    const resolved = confirmSinglePendingAbility(fromWaitingRoom.game);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      countEffectiveHearts(resolved, PLAYER1, fromWaitingRoom.sourceId, HeartColor.PURPLE)
    ).toBe(1);
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.PURPLE, count: 1 }],
      sourceCardId: fromWaitingRoom.sourceId,
      abilityId: HS_PR_038_ON_ENTER_NON_HAND_GAIN_PURPLE_HEART_ABILITY_ID,
    });
    expect(
      latestResolvePayload(resolved, HS_PR_038_ON_ENTER_NON_HAND_GAIN_PURPLE_HEART_ABILITY_ID)
    ).toMatchObject({
      step: 'ON_ENTER_NON_HAND_SOURCE_MEMBER_GAIN_PURPLE_HEART',
      sourceOnStage: true,
      heartColor: HeartColor.PURPLE,
      heartBonus: 1,
      heartApplied: true,
    });
  });

  it('consumes the on-enter pending without a modifier when the source has left the stage', () => {
    const scenario = createEnterScenario(ZoneType.WAITING_ROOM);
    const sourceLeftStage = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, scenario.sourceId],
      },
    }));

    const resolved = confirmSinglePendingAbility(sourceLeftStage);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(
      latestResolvePayload(resolved, HS_PR_038_ON_ENTER_NON_HAND_GAIN_PURPLE_HEART_ABILITY_ID)
    ).toMatchObject({
      step: 'SOURCE_MEMBER_GAIN_HEART_NO_OP',
      sourceOnStage: false,
      heartApplied: false,
    });
  });

  it('clears the gained purple Heart at LIVE end', () => {
    const scenario = createEnterScenario(ZoneType.WAITING_ROOM);
    const resolved = confirmSinglePendingAbility(scenario.game);
    expect(countEffectiveHearts(resolved, PLAYER1, scenario.sourceId, HeartColor.PURPLE)).toBe(1);

    const finalized = new GameService().finalizeLiveResult({
      ...resolved,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });
    expect(finalized.success).toBe(true);
    expect(finalized.gameState.liveResolution.liveModifiers).toEqual([]);
    expect(
      countEffectiveHearts(finalized.gameState, PLAYER1, scenario.sourceId, HeartColor.PURPLE)
    ).toBe(0);
  });

  it('waits only an active opponent member with printed cost at most four, emits the state event, and skips exactly its next active phase', () => {
    const scenario = createLiveSuccessScenario();
    const preview = resolvePendingCardEffects(scenario.game).gameState;
    expect(preview.activeEffect).toMatchObject({
      abilityId: HS_PR_038_LIVE_SUCCESS_WAIT_OPPONENT_COST_FOUR_SKIP_NEXT_ACTIVE_ABILITY_ID,
      selectableCardIds: [scenario.legalTargetId],
      selectionLabel: '选择对方舞台上费用小于等于4的成员',
      confirmSelectionLabel: '变为待机状态',
    });
    expect(preview.activeEffect?.selectableCardIds).not.toContain(scenario.highCostTargetId);
    expect(preview.activeEffect?.selectableCardIds).not.toContain(scenario.waitingTargetId);

    const resolved = confirmActiveEffectStep(
      preview,
      PLAYER1,
      preview.activeEffect!.id,
      scenario.legalTargetId
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.players[1].memberSlots.cardStates.get(scenario.legalTargetId!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(resolved.memberActivePhaseSkips).toEqual([
      {
        playerId: PLAYER2,
        memberCardId: scenario.legalTargetId,
        sourceCardId: scenario.sourceId,
        abilityId: HS_PR_038_LIVE_SUCCESS_WAIT_OPPONENT_COST_FOUR_SKIP_NEXT_ACTIVE_ABILITY_ID,
      },
    ]);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.legalTargetId &&
          entry.event.previousOrientation === OrientationState.ACTIVE &&
          entry.event.nextOrientation === OrientationState.WAITING
      )
    ).toBe(true);
    expect(
      latestResolvePayload(
        resolved,
        HS_PR_038_LIVE_SUCCESS_WAIT_OPPONENT_COST_FOUR_SKIP_NEXT_ACTIVE_ABILITY_ID
      )
    ).toMatchObject({
      step: 'WAIT_OPPONENT_MEMBER',
      targetPlayerId: PLAYER2,
      targetCardId: scenario.legalTargetId,
      skipNextActivePhase: true,
      skipNextActivePlayerId: PLAYER2,
      skipNextActiveMemberCardId: scenario.legalTargetId,
    });

    const controllerActive = new GameService().advancePhase({
      ...resolved,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    });
    expect(controllerActive.gameState.memberActivePhaseSkips).toHaveLength(1);

    const opponentActive = new GameService().advancePhase({
      ...controllerActive.gameState,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 1,
      firstPlayerIndex: 1,
    });
    expect(opponentActive.gameState.memberActivePhaseSkips).toEqual([]);
    expect(
      opponentActive.gameState.players[1].memberSlots.cardStates.get(scenario.legalTargetId!)
        ?.orientation
    ).toBe(OrientationState.WAITING);

    const followingOpponentActive = new GameService().advancePhase({
      ...opponentActive.gameState,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 1,
      firstPlayerIndex: 1,
    });
    expect(
      followingOpponentActive.gameState.players[1].memberSlots.cardStates.get(
        scenario.legalTargetId!
      )?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('confirms a no-target LIVE-success ability as a clean no-op without a skip marker', () => {
    const scenario = createLiveSuccessScenario({ includeLegalTarget: false });
    const preview = resolvePendingCardEffects(scenario.game).gameState;
    expect(preview.activeEffect).toMatchObject({
      abilityId: HS_PR_038_LIVE_SUCCESS_WAIT_OPPONENT_COST_FOUR_SKIP_NEXT_ACTIVE_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('当前合法目标0名');

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.memberActivePhaseSkips).toEqual([]);
  });

  it('consumes a stale target selection as a no-op without a state event or skip marker', () => {
    const scenario = createLiveSuccessScenario();
    const preview = resolvePendingCardEffects(scenario.game).gameState;
    const target = preview.cardRegistry.get(scenario.legalTargetId!)!;
    const staleRegistry = new Map(preview.cardRegistry);
    staleRegistry.set(scenario.legalTargetId!, {
      ...target,
      data: {
        ...target.data,
        cost: 5,
      } as MemberCardData,
    });
    const stale = {
      ...preview,
      cardRegistry: staleRegistry,
    };

    const resolved = confirmActiveEffectStep(
      stale,
      PLAYER1,
      stale.activeEffect!.id,
      scenario.legalTargetId
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.memberActivePhaseSkips).toEqual([]);
    expect(
      resolved.players[1].memberSlots.cardStates.get(scenario.legalTargetId!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === scenario.legalTargetId
      )
    ).toBe(false);
    expect(
      latestResolvePayload(
        resolved,
        HS_PR_038_LIVE_SUCCESS_WAIT_OPPONENT_COST_FOUR_SKIP_NEXT_ACTIVE_ABILITY_ID
      )
    ).toMatchObject({
      step: 'STALE_TARGET_NO_OP',
      targetPlayerId: PLAYER2,
      targetCardId: scenario.legalTargetId,
      skipMarkerApplied: false,
    });
  });
});
