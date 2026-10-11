import { describe, expect, it } from 'vitest';
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
import { addCardToStatefulZone, addCardToZone } from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  getLiveCardScoreModifier,
  getLiveCardRequirementModifiers,
  removeLiveCardBoundLiveModifiers,
} from '../../src/domain/rules/live-modifiers';
import { GameService } from '../../src/application/game-service';
import { createManualMoveCardAction, createSetLiveCardAction } from '../../src/application/actions';
import { moveCardUniversal } from '../../src/application/action-handlers/zone-operations';
import {
  placeHandLiveCardInLiveZoneForPlayer,
  placeWaitingRoomLiveCardInLiveZoneForPlayer,
  returnLiveZoneCardToHandForPlayer,
} from '../../src/application/card-effects/runtime/actions';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { getAbilitySourceLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { N_BP8_030_AUTO_FROM_WAITING_ROOM_REDUCE_REQUIREMENT_ABILITY_ID as STAY_AUTO } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const TARGET = 'old-live';
const OTHER = 'other-live';

function fixture(zone: ZoneType = ZoneType.LIVE_ZONE): GameState {
  const live = createCardInstance(
    {
      cardCode: 'PL!N-bp8-030-UNSEEN',
      name: 'Stay',
      cardType: CardType.LIVE,
      score: 6,
      requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 5 }),
    },
    P1,
    TARGET
  );
  const other = createCardInstance(
    {
      cardCode: 'OTHER-LIVE',
      name: 'Other',
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({}),
    },
    P1,
    OTHER
  );
  let game = registerCards(createGameState('live-card-bound-modifiers', P1, 'P1', P2, 'P2'), [
    live,
    other,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, OTHER),
    ...(zone === ZoneType.LIVE_ZONE
      ? { liveZone: addCardToStatefulZone(addCardToStatefulZone(player.liveZone, OTHER), TARGET) }
      : zone === ZoneType.HAND
        ? { hand: addCardToZone(player.hand, TARGET) }
        : { waitingRoom: addCardToZone(player.waitingRoom, TARGET) }),
  }));
  const modifiers: readonly LiveModifierState[] = [
    {
      kind: 'SCORE',
      playerId: P1,
      liveCardId: TARGET,
      countDelta: 2,
      sourceCardId: OTHER,
      abilityId: 'target-score',
    },
    {
      kind: 'REQUIREMENT',
      liveCardId: TARGET,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -3 }],
      sourceCardId: OTHER,
      abilityId: 'target-requirement',
    },
    {
      kind: 'SUPPRESS_ABILITY',
      sourceCardId: TARGET,
      suppressedAbilityId: STAY_AUTO,
      abilityId: 'target-suppression',
    },
    {
      kind: 'SCORE',
      playerId: P1,
      liveCardId: OTHER,
      countDelta: 1,
      sourceCardId: TARGET,
      abilityId: 'other-score',
    },
    {
      kind: 'REQUIREMENT',
      liveCardId: OTHER,
      modifiers: [{ color: HeartColor.PINK, countDelta: -1 }],
      sourceCardId: TARGET,
      abilityId: 'other-requirement',
    },
    { kind: 'SCORE', playerId: P1, countDelta: 4, sourceCardId: TARGET, abilityId: 'player-score' },
    {
      kind: 'HEART',
      target: 'PLAYER',
      playerId: P1,
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      sourceCardId: TARGET,
      abilityId: 'player-heart',
    },
    {
      kind: 'SUPPRESS_ABILITY',
      sourceCardId: OTHER,
      suppressedAbilityId: 'other-auto',
      abilityId: 'other-suppression',
    },
  ];
  for (const modifier of modifiers) game = addLiveModifier(game, modifier);
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.FREE_ACTION,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      playerScores: new Map([[P1, 17]]),
      liveResults: new Map([
        [TARGET, true],
        [OTHER, true],
      ]),
    },
  };
}

function expectOnlyOldCardEffectsCleared(game: GameState) {
  expect(getLiveCardScoreModifier(game.liveResolution, TARGET)).toBe(0);
  expect(getLiveCardRequirementModifiers(game.liveResolution, TARGET)).toEqual([]);
  expect(game.liveResolution.liveModifiers.map((modifier) => modifier.abilityId)).toEqual([
    'other-score',
    'other-requirement',
    'player-score',
    'player-heart',
    'other-suppression',
  ]);
  expect(game.liveResolution.playerScoreBonuses.get(P1)).toBe(5);
  expect(game.liveResolution.liveRequirementReductions.has(TARGET)).toBe(false);
  expect(game.liveResolution.liveRequirementModifiers.get(OTHER)).toEqual([
    { color: HeartColor.PINK, countDelta: -1 },
  ]);
  expect(game.liveResolution.playerScores.get(P1)).toBe(17);
  expect(game.liveResolution.liveResults.get(TARGET)).toBe(true);
}

describe('temporary modifiers bound to a LIVE card rules object', () => {
  it('clears only the selected LIVE card targets and refreshes compatibility projections without changing settlement or history', () => {
    const game = fixture();
    const cleared = removeLiveCardBoundLiveModifiers(game, [TARGET, TARGET]);
    expectOnlyOldCardEffectsCleared(cleared);
    expect(cleared.liveResolution.playerScores).toBe(game.liveResolution.playerScores);
    expect(cleared.liveResolution.liveResults).toBe(game.liveResolution.liveResults);
    expect(cleared.operationHistory).toBe(game.operationHistory);
    expect(cleared.actionHistory).toBe(game.actionHistory);
    expect(cleared.eventLog).toBe(game.eventLog);
    expect(cleared.pendingAbilities).toBe(game.pendingAbilities);
    expect(removeLiveCardBoundLiveModifiers(game, [])).toBe(game);
    expect(removeLiveCardBoundLiveModifiers(game, ['unrelated'])).toBe(game);
  });

  it('clears the old LIVE card when the runtime return-to-hand action actually moves it', () => {
    const game = fixture();
    const result = returnLiveZoneCardToHandForPlayer(game, P1, TARGET)!;
    expectOnlyOldCardEffectsCleared(result.gameState);
    expect(result.gameState.players[0].hand.cardIds).toContain(TARGET);
    expect(result.gameState.players[0].liveZone.cardIds).not.toContain(TARGET);
    expect(result.enterHandEvent).toMatchObject({
      cardInstanceIds: [TARGET],
      fromZone: ZoneType.LIVE_ZONE,
    });
    expect(returnLiveZoneCardToHandForPlayer(result.gameState, P1, TARGET)).toBeNull();
  });

  it.each([ZoneType.HAND, ZoneType.WAITING_ROOM] as const)(
    'starts a clean LIVE object through the runtime entry from %s',
    (zone) => {
      const game = fixture(zone);
      const options = { candidateCardIds: [TARGET], face: FaceState.FACE_UP };
      const result =
        zone === ZoneType.HAND
          ? placeHandLiveCardInLiveZoneForPlayer(game, P1, TARGET, options)!
          : placeWaitingRoomLiveCardInLiveZoneForPlayer(game, P1, TARGET, options)!;
      expectOnlyOldCardEffectsCleared(result.gameState);
      expect(result.gameState.players[0].liveZone.cardIds).toContain(TARGET);
      expect(result.enterLiveZoneEvent).toMatchObject({
        cardInstanceId: TARGET,
        fromZone: zone,
        toZone: ZoneType.LIVE_ZONE,
        face: FaceState.FACE_UP,
      });
      expect(result.gameState.eventLog.at(-1)?.event).toBe(result.enterLiveZoneEvent);
      expect(getAbilitySourceLifecycleId(result.gameState, STAY_AUTO, TARGET)).toContain(
        result.enterLiveZoneEvent.eventId
      );
    }
  );

  it('clears old card effects when SET_LIVE_CARD creates the new face-down LIVE object', () => {
    const game = {
      ...fixture(ZoneType.HAND),
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.FREE_ACTION,
    };
    const result = new GameService().processAction(game, createSetLiveCardAction(P1, TARGET, true));
    expect(result.success).toBe(true);
    expectOnlyOldCardEffectsCleared(result.gameState);
    expect(result.gameState.players[0].liveZone.cardStates.get(TARGET)?.face).toBe(
      FaceState.FACE_DOWN
    );
    expect(
      result.gameState.eventLog.filter(
        (record) => record.event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE
      )
    ).toHaveLength(1);
  });

  it('preserves modifiers and source lifecycle for a move within the LIVE zone', () => {
    const game = fixture();
    const lifecycle = getAbilitySourceLifecycleId(game, STAY_AUTO, TARGET);
    const moved = moveCardUniversal(game, P1, TARGET, ZoneType.LIVE_ZONE, ZoneType.LIVE_ZONE);
    expect(moved.liveResolution.liveModifiers).toBe(game.liveResolution.liveModifiers);
    expect(moved.eventLog).toBe(game.eventLog);
    expect(getAbilitySourceLifecycleId(moved, STAY_AUTO, TARGET)).toBe(lifecycle);
    expect(moved.players[0].liveZone.cardIds.filter((id) => id === TARGET)).toHaveLength(1);
  });

  it('records a new entry lifecycle on manual re-entry and keeps the previous pending identity pinned to its event', () => {
    const first = moveCardUniversal(
      fixture(ZoneType.WAITING_ROOM),
      P1,
      TARGET,
      ZoneType.WAITING_ROOM,
      ZoneType.LIVE_ZONE
    );
    const firstEvent = first.eventLog.at(-1)!.event;
    const oldLifecycle = getAbilitySourceLifecycleId(first, STAY_AUTO, TARGET, [
      firstEvent.eventId,
    ]);
    const queued = enqueueTriggeredCardEffects(first, [TriggerCondition.ON_ENTER_LIVE_ZONE]);
    expect(queued.pendingAbilities).toHaveLength(1);
    expect(queued.pendingAbilities[0]?.eventIds).toEqual([firstEvent.eventId]);
    const leaving = moveCardUniversal(queued, P1, TARGET, ZoneType.LIVE_ZONE, ZoneType.HAND);
    expectOnlyOldCardEffectsCleared(leaving);
    const reentry = moveCardUniversal(leaving, P1, TARGET, ZoneType.HAND, ZoneType.LIVE_ZONE);
    expect(getAbilitySourceLifecycleId(reentry, STAY_AUTO, TARGET)).not.toBe(oldLifecycle);
    expect(getAbilitySourceLifecycleId(reentry, STAY_AUTO, TARGET, [firstEvent.eventId])).toBe(
      oldLifecycle
    );
    expect(
      reentry.eventLog.filter(
        (record) => record.event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE
      )
    ).toHaveLength(2);
    const resolvedOldPending = resolvePendingCardEffects(reentry).gameState;
    expect(getLiveCardRequirementModifiers(resolvedOldPending.liveResolution, TARGET)).toEqual([]);
    expect(resolvedOldPending.pendingAbilities).toHaveLength(0);
    expect(resolvedOldPending.actionHistory.at(-1)?.payload).toMatchObject({
      sourceLifecycleId: oldLifecycle,
      requirementReduction: 0,
      rewardApplied: false,
    });
  });

  it('does not clear effects or emit an entry for a stale claimed source zone or an invalid destination', () => {
    const game = fixture(ZoneType.WAITING_ROOM);
    expect(moveCardUniversal(game, P1, TARGET, ZoneType.HAND, ZoneType.LIVE_ZONE)).toBe(game);
    const inLive = fixture();
    expect(moveCardUniversal(inLive, P1, TARGET, ZoneType.LIVE_ZONE, ZoneType.MEMBER_SLOT)).toBe(
      inLive
    );
  });

  it('dispatches the real manual waiting-room entry exactly once while the current effect keeps resolving', () => {
    const game = fixture(ZoneType.WAITING_ROOM);
    const busy: GameState = {
      ...game,
      activeEffect: {
        id: 'busy',
        abilityId: 'busy',
        sourceCardId: OTHER,
        controllerId: P1,
        effectText: '处理当前效果',
        stepId: 'busy',
        stepText: '处理当前效果',
        awaitingPlayerId: P1,
      },
    };
    const result = new GameService().processAction(
      busy,
      createManualMoveCardAction(P1, TARGET, ZoneType.WAITING_ROOM, ZoneType.LIVE_ZONE)
    );
    expect(result.success).toBe(true);
    expectOnlyOldCardEffectsCleared(result.gameState);
    expect(result.triggeredEvents).toContain(TriggerCondition.ON_ENTER_LIVE_ZONE);
    expect(result.gameState.activeEffect?.id).toBe('busy');
    const entered = result.gameState.eventLog.flatMap((record) =>
      record.event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE ? [record.event] : []
    );
    expect(entered).toHaveLength(1);
    expect(
      result.gameState.pendingAbilities.filter((pending) => pending.abilityId === STAY_AUTO)
    ).toHaveLength(1);
    const replayed = enqueueTriggeredCardEffects(
      result.gameState,
      [TriggerCondition.ON_ENTER_LIVE_ZONE],
      { enterLiveZoneEvents: entered }
    );
    expect(
      replayed.pendingAbilities.filter((pending) => pending.abilityId === STAY_AUTO)
    ).toHaveLength(1);
    expect(replayed.activeEffect?.id).toBe('busy');
  });
});
