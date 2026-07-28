import { describe, expect, it } from 'vitest';
import { enqueueTriggeredCardEffects } from '../../src/application/card-effect-runner';
import { HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { GameService } from '../../src/application/game-service';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createLiveSuccessEvent, type LiveSuccessEvent } from '../../src/domain/events/game-events';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import {
  CardType,
  GamePhase,
  HeartColor,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function watercolorWorld(): LiveCardData {
  return {
    cardCode: 'PL!HS-cl1-009-CL',
    name: '水彩世界',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupLiveSuccessWindow(playerId: string, subPhase: SubPhase) {
  const live = createCardInstance(watercolorWorld(), playerId, `${playerId}-watercolor-world`);
  let game = registerCards(createGameState('live-success-window', P1, 'P1', P2, 'P2'), [live]);
  game = updatePlayer(game, playerId, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
  }));
  game = {
    ...game,
    turnCount: 3,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: subPhase,
    firstPlayerIndex: 0,
    activePlayerIndex: playerId === P1 ? 0 : 1,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[live.instanceId, true]]),
      playerScores: new Map([[playerId, 1]]),
      performingPlayerId: playerId,
    },
  };

  return { game, live };
}

function emitForCurrentResultWindow(
  service: GameService,
  game: GameState,
  subPhase: SubPhase,
  eventLogStartIndex: number
): GameState {
  return (
    service as unknown as {
      emitLiveSuccessEventForResultSubPhase(
        state: GameState,
        resultSubPhase: SubPhase,
        startIndex: number
      ): GameState;
    }
  ).emitLiveSuccessEventForResultSubPhase(game, subPhase, eventLogStartIndex);
}

function liveSuccessEvents(game: GameState): readonly LiveSuccessEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is LiveSuccessEvent => event.eventType === TriggerCondition.ON_LIVE_SUCCESS
    );
}

describe('LIVE success event-log window', () => {
  it('emits and consumes a new event when the same physical LIVE succeeds again next turn', () => {
    const service = new GameService();
    const scenario = setupLiveSuccessWindow(P1, SubPhase.RESULT_FIRST_SUCCESS_EFFECTS);

    const firstWindowStartIndex = scenario.game.eventLog.length;
    const firstEventState = emitForCurrentResultWindow(
      service,
      scenario.game,
      SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      firstWindowStartIndex
    );
    const firstTriggered = enqueueTriggeredCardEffects(
      firstEventState,
      [TriggerCondition.ON_LIVE_SUCCESS],
      { triggerEventLogStartIndex: firstWindowStartIndex }
    );
    expect(firstTriggered.pendingAbilities).toHaveLength(1);

    const nextTurnState: GameState = {
      ...firstTriggered,
      turnCount: firstTriggered.turnCount + 1,
      pendingAbilities: [],
      activeEffect: null,
    };
    const secondWindowStartIndex = nextTurnState.eventLog.length;
    const secondEventState = emitForCurrentResultWindow(
      service,
      nextTurnState,
      SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      secondWindowStartIndex
    );
    const secondTriggered = enqueueTriggeredCardEffects(
      secondEventState,
      [TriggerCondition.ON_LIVE_SUCCESS],
      { triggerEventLogStartIndex: secondWindowStartIndex }
    );
    const events = liveSuccessEvents(secondTriggered);

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      playerId: P1,
      successfulLiveCardIds: [scenario.live.instanceId],
    });
    expect(events[1]?.eventId).not.toBe(events[0]?.eventId);
    expect(secondTriggered.pendingAbilities).toEqual([
      expect.objectContaining({
        abilityId: HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
        sourceCardId: scenario.live.instanceId,
        controllerId: P1,
        eventIds: [events[1]?.eventId],
      }),
    ]);
  });

  it('does not emit the same LIVE success event twice inside one event window', () => {
    const service = new GameService();
    const scenario = setupLiveSuccessWindow(P1, SubPhase.RESULT_FIRST_SUCCESS_EFFECTS);
    const eventLogStartIndex = scenario.game.eventLog.length;

    const emittedOnce = emitForCurrentResultWindow(
      service,
      scenario.game,
      SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      eventLogStartIndex
    );
    const emittedTwice = emitForCurrentResultWindow(
      service,
      emittedOnce,
      SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      eventLogStartIndex
    );

    expect(liveSuccessEvents(emittedTwice)).toHaveLength(1);
  });

  it('uses a fresh event window when advancePhase enters LIVE result with historical success', () => {
    const service = new GameService();
    const scenario = setupLiveSuccessWindow(P1, SubPhase.NONE);
    const historicalEvent = createLiveSuccessEvent(P1, [scenario.live.instanceId], 1);
    const withHistory = emitGameEvent(
      {
        ...scenario.game,
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        currentSubPhase: SubPhase.NONE,
        currentTurnType: TurnType.SECOND_PLAYER_TURN,
        activePlayerIndex: 1,
      },
      historicalEvent
    );

    const result = service.advancePhase(withHistory);
    const events = liveSuccessEvents(result.gameState);

    expect(result.success).toBe(true);
    expect(result.gameState.currentPhase).toBe(GamePhase.LIVE_RESULT_PHASE);
    expect(result.gameState.currentSubPhase).toBe(SubPhase.RESULT_FIRST_SUCCESS_EFFECTS);
    expect(events).toHaveLength(2);
    expect(events[1]?.eventId).not.toBe(historicalEvent.eventId);
    expect(
      result.gameState.actionHistory.filter(
        (action) => action.type === 'TRIGGER_ABILITY' && action.playerId === P1
      )
    ).toHaveLength(1);
  });

  it('does not revive a historical LIVE success event when the bounded window is empty', () => {
    const scenario = setupLiveSuccessWindow(P1, SubPhase.RESULT_FIRST_SUCCESS_EFFECTS);
    const historicalEvent = createLiveSuccessEvent(P1, [scenario.live.instanceId], 1);
    const withHistory = emitGameEvent(scenario.game, historicalEvent);

    const triggered = enqueueTriggeredCardEffects(
      {
        ...withHistory,
        turnCount: withHistory.turnCount + 1,
      },
      [TriggerCondition.ON_LIVE_SUCCESS],
      { triggerEventLogStartIndex: withHistory.eventLog.length }
    );

    expect(triggered.pendingAbilities).toEqual([]);
    expect(triggered.actionHistory.filter((action) => action.type === 'TRIGGER_ABILITY')).toEqual(
      []
    );
  });

  it('treats an explicitly empty LIVE success event list as authoritative', () => {
    const scenario = setupLiveSuccessWindow(P1, SubPhase.RESULT_FIRST_SUCCESS_EFFECTS);

    const triggered = enqueueTriggeredCardEffects(
      scenario.game,
      [TriggerCondition.ON_LIVE_SUCCESS],
      { liveSuccessEvents: [] }
    );

    expect(triggered.pendingAbilities).toEqual([]);
  });

  it('keeps the legacy liveResults fallback when no event input or window is provided', () => {
    const scenario = setupLiveSuccessWindow(P1, SubPhase.RESULT_FIRST_SUCCESS_EFFECTS);

    const triggered = enqueueTriggeredCardEffects(scenario.game, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);

    expect(triggered.pendingAbilities).toEqual([
      expect.objectContaining({
        abilityId: HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
        sourceCardId: scenario.live.instanceId,
        controllerId: P1,
        eventIds: [`live-success:3:${P1}:${scenario.live.instanceId}`],
      }),
    ]);
  });

  it('consumes only the second player event from the second success window', () => {
    const scenario = setupLiveSuccessWindow(P2, SubPhase.RESULT_SECOND_SUCCESS_EFFECTS);
    const historicalFirstPlayerEvent = createLiveSuccessEvent(P1, ['p1-old-live'], 2);
    let game = emitGameEvent(scenario.game, historicalFirstPlayerEvent);
    const secondWindowStartIndex = game.eventLog.length;
    const secondPlayerEvent = createLiveSuccessEvent(P2, [scenario.live.instanceId], 1);
    game = emitGameEvent(game, secondPlayerEvent);

    const triggered = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS], {
      triggerEventLogStartIndex: secondWindowStartIndex,
    });

    expect(triggered.pendingAbilities).toEqual([
      expect.objectContaining({
        abilityId: HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
        sourceCardId: scenario.live.instanceId,
        controllerId: P2,
        eventIds: [secondPlayerEvent.eventId],
      }),
    ]);
  });
});
