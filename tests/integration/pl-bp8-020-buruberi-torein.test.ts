import { describe, expect, it } from 'vitest';
import { PL_BP8_020_LIVE_START_ACTIVATE_KOTORI_WAIT_OPPONENT_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { returnLiveZoneCardToHandForPlayer } from '../../src/application/card-effects/runtime/actions';
import { registerMemberStateChangedObserver } from '../../src/application/card-effects/runtime/member-state-changed-observers';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
  createSetLiveCardCommand,
} from '../../src/application/game-commands';
import { createCardInstance, type CardInstance } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  getPlayerById,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addMemberBelowMember } from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createLiveStartEvent,
  type MemberStateChangedEvent,
} from '../../src/domain/events/game-events';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { addMemberEffectActivationProhibitionUntilTurnEnd } from '../../src/domain/rules/member-effect-activation-prohibitions';
import { addMemberWaitProtectionUntilLiveEnd } from '../../src/domain/rules/member-wait-protections';
import {
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  gameWith,
  hand,
  liveZone,
  member,
  P1,
  P2,
  sessionFor,
  stage,
} from '../helpers/modifier-workflow-fixtures';
import { getNovember04LiveData } from '../helpers/november-04-draft-effects';

const SOURCE = 'blueberry-train';
const BASE = 'PL!-bp8-020';
const EFFECT_TEXT =
  '【LIVE开始时】将存在于自己的舞台的１名待机状态的「南琴梨（南小鸟）」变为活跃状态。如此做时，将存在于对方的舞台的１名费用小于等于４的成员变为待机状态。';

const kotori = (id = 'kotori', name = '南琴梨（南小鸟）') =>
  member('SYNTHETIC-KOTORI', id, P1, { name });
const opponent = (id = 'opponent', cost = 4, groupNames = ['Liella!']) =>
  member('SYNTHETIC-OPPONENT', id, P2, { cost, groupNames });

function setup(
  own: readonly CardInstance[] = [kotori()],
  opposing: readonly CardInstance[] = [opponent()],
  cardCode = 'PL!-bp8-020-L'
) {
  const source = createCardInstance({ ...getNovember04LiveData(BASE), cardCode }, P1, SOURCE);
  const staged = stage(stage(gameWith([source, ...own, ...opposing]), own), opposing, P2);
  const game = own.reduce((state, card) => setWaiting(state, P1, card.instanceId), staged);
  return { game, source };
}

function setWaiting(game: GameState, playerId: string, cardId: string): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      cardStates: new Map(player.memberSlots.cardStates).set(cardId, {
        ...player.memberSlots.cardStates.get(cardId)!,
        orientation: OrientationState.WAITING,
      }),
    },
  }));
}

function queued(game: GameState, liveIds: readonly string[] = [SOURCE]): GameState {
  const state: GameState = {
    ...game,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: P1 },
  };
  const event = createLiveStartEvent(P1, liveIds);
  return enqueueTriggeredCardEffects(emitGameEvent(state, event), [event.eventType], {
    liveStartEvents: [event],
  });
}

function start(scenario = setup()): GameState {
  return resolvePendingCardEffects(queued(liveZone(scenario.game, scenario.source))).gameState;
}

function confirm(game: GameState, cardId?: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId);
}

function orientation(game: GameState, playerId: string, cardId: string) {
  return getPlayerById(game, playerId)?.memberSlots.cardStates.get(cardId)?.orientation;
}

function stateEvents(game: GameState) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is MemberStateChangedEvent =>
        event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
    );
}

function setCost(game: GameState, cardId: string, setTo: number) {
  return addLiveModifier(game, {
    kind: 'MEMBER_COST_SET',
    playerId: P2,
    memberCardId: cardId,
    setTo,
    sourceCardId: 'cost-source',
    abilityId: 'cost-ability',
  });
}

function protectOpponent(game: GameState): GameState {
  return addMemberWaitProtectionUntilLiveEnd(game, {
    affectedPlayerId: P2,
    sourceCardId: 'protection-source',
    abilityId: 'protection-ability',
  });
}

describe('PL!-bp8-020 分数1「蓝莓♡小火车」', () => {
  it('runs two required selections from a RULES live set and records exactly two changes in order', () => {
    const { game, source } = setup();
    const session = sessionFor({
      ...hand(game, [source]),
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
    });
    expect(session.executeCommand(createSetLiveCardCommand(P1, SOURCE)).success).toBe(true);
    const firstReady = session.executeCommand(
      createConfirmStepCommand(P1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );
    expect(firstReady.success, firstReady.error).toBe(true);
    const secondReady = session.executeCommand(
      createConfirmStepCommand(P2, SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(secondReady.success, secondReady.error).toBe(true);
    expect(
      session.state!.eventLog.some(
        ({ event }) => event.eventType === TriggerCondition.ON_LIVE_START
      )
    ).toBe(true);
    const effect = session.state!.activeEffect!;
    expect(effect).toMatchObject({
      abilityId: ABILITY,
      sourceCardId: SOURCE,
      awaitingPlayerId: P1,
      effectText: EFFECT_TEXT,
      selectableCardIds: ['kotori'],
      confirmSelectionLabel: '变为活跃状态',
    });
    expect(effect.canSkipSelection).not.toBe(true);
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, effect.id)).success).toBe(
      false
    );
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effect.id, 'kotori')).success
    ).toBe(true);

    expect(session.state!.activeEffect).toMatchObject({
      id: effect.id,
      awaitingPlayerId: P1,
      selectableCardIds: ['opponent'],
      confirmSelectionLabel: '变为待机状态',
    });
    expect(orientation(session.state!, P1, 'kotori')).toBe(OrientationState.ACTIVE);
    expect(orientation(session.state!, P2, 'opponent')).toBe(OrientationState.ACTIVE);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P2, effect.id, 'opponent')).success
    ).toBe(false);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effect.id, 'opponent')).success
    ).toBe(true);

    const resolved = session.state!;
    expect(orientation(resolved, P2, 'opponent')).toBe(OrientationState.WAITING);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(stateEvents(resolved)).toMatchObject([
      {
        cardInstanceId: 'kotori',
        controllerId: P1,
        previousOrientation: OrientationState.WAITING,
        nextOrientation: OrientationState.ACTIVE,
      },
      {
        cardInstanceId: 'opponent',
        controllerId: P2,
        previousOrientation: OrientationState.ACTIVE,
        nextOrientation: OrientationState.WAITING,
      },
    ]);
    for (const event of stateEvents(resolved)) {
      expect(event.cause).toEqual({
        kind: 'CARD_EFFECT',
        playerId: P1,
        selectionPlayerId: P1,
        sourceCardId: SOURCE,
        abilityId: ABILITY,
        pendingAbilityId: effect.id,
      });
    }
    expect(resolved.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('accepts the Kotori identity of a combination and excludes other names and memberBelow', () => {
    const scenario = setup([
      kotori('combo', '高坂穂乃果＆南ことり'),
      kotori('below'),
      kotori('other', '東條希'),
    ]);
    scenario.game = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(
        {
          ...player.memberSlots,
          slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
        },
        SlotPosition.LEFT,
        'below'
      ),
    }));
    const selection = start(scenario);
    expect(selection.activeEffect?.selectableCardIds).toEqual(['combo']);
    expect(confirm(selection, 'below')).toBe(selection);
    expect(
      confirmActiveEffectStep(selection, P1, selection.activeEffect!.id, 'combo', SlotPosition.LEFT)
    ).toBe(selection);
    expect(confirm(selection, 'combo').activeEffect?.selectableCardIds).toEqual(['opponent']);
  });

  it('rescans the opponent after activation using effective costs and excludes already waiting members', () => {
    const first = start(
      setup([kotori()], [opponent('raised', 4), opponent('lowered', 5), opponent('waiting', 2)])
    );
    let game = setCost(setCost(first, 'raised', 5), 'lowered', 4);
    game = setWaiting(game, P2, 'waiting');
    const second = confirm(game, 'kotori');
    expect(second.activeEffect?.selectableCardIds).toEqual(['lowered']);
    expect(confirm(second)).toBe(second);
    expect(confirm(second, 'waiting')).toBe(second);
    expect(confirm(second, 'raised')).toBe(second);
    expect(orientation(confirm(second, 'lowered'), P2, 'lowered')).toBe(OrientationState.WAITING);
  });

  it('cannot choose a protected opponent or force waiting on a newly protected target', () => {
    const scenario = setup([kotori()], [opponent('protected', 4, ['Aqours']), opponent('open', 4)]);
    const first = start(scenario);
    const second = confirm(first, 'kotori');
    expect(second.activeEffect?.selectableCardIds).toEqual(['protected', 'open']);
    const newlyProtected = protectOpponent(second);
    const refreshed = confirm(newlyProtected, 'protected');
    expect(stateEvents(refreshed)).toHaveLength(1);
    expect(refreshed.activeEffect?.selectableCardIds).toEqual(['open']);
    expect(confirm(refreshed, 'protected')).toBe(refreshed);
    expect(confirm(protectOpponent(first), 'kotori').activeEffect?.selectableCardIds).toEqual([
      'open',
    ]);
  });

  it('does nothing without an eligible Kotori or when activation is prohibited', () => {
    const prohibited = (state: GameState) =>
      addMemberEffectActivationProhibitionUntilTurnEnd(state, {
        affectedPlayerIds: [P1],
        sourceCardId: 'prohibition-source',
        abilityId: 'prohibition-ability',
      });
    const normal = setup();
    for (const confirmation of [
      start(setup([kotori('other', '東條希')])),
      start({ ...normal, game: prohibited(normal.game) }),
    ]) {
      expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
      expect(confirmation.activeEffect?.selectableCardIds).toBeUndefined();
      expect(stateEvents(confirmation)).toEqual([]);
      const game = confirm(confirmation);
      expect(game.activeEffect).toBeNull();
      expect(game.pendingAbilities).toEqual([]);
      expect(stateEvents(game)).toEqual([]);
      expect(orientation(game, P2, 'opponent')).toBe(OrientationState.ACTIVE);
    }
    const becameProhibited = confirm(prohibited(start(normal)), 'kotori');
    expect(becameProhibited.activeEffect).toBeNull();
    expect(stateEvents(becameProhibited)).toEqual([]);
    expect(orientation(becameProhibited, P2, 'opponent')).toBe(OrientationState.ACTIVE);

    const confirmation = start({ ...normal, game: prohibited(normal.game) });
    const becameLegal = confirm({ ...confirmation, memberEffectActivationProhibitions: [] });
    expect(becameLegal.activeEffect?.selectableCardIds).toEqual(['kotori']);
    expect(stateEvents(becameLegal)).toEqual([]);
  });

  it('keeps Kotori active when the opponent has no legal target or its last target becomes too expensive', () => {
    const withoutTarget = confirm(start(setup([kotori()], [opponent('opponent', 5)])), 'kotori');
    const stale = setCost(confirm(start(), 'kotori'), 'opponent', 5);
    const afterStale = confirm(stale, 'opponent');
    for (const game of [withoutTarget, afterStale]) {
      expect(game.activeEffect).toBeNull();
      expect(game.pendingAbilities).toEqual([]);
      expect(orientation(game, P1, 'kotori')).toBe(OrientationState.ACTIVE);
      expect(orientation(game, P2, 'opponent')).toBe(OrientationState.ACTIVE);
      expect(stateEvents(game)).toMatchObject([{ cardInstanceId: 'kotori' }]);
    }
  });

  it('does not apply either old choice to a member that has reentered the stage', () => {
    const first = start();
    const newKotori = emitGameEvent(
      first,
      createEnterStageEvent('kotori', ZoneType.HAND, SlotPosition.LEFT, P1, P1)
    );
    const retryFirst = confirm(newKotori, 'kotori');
    expect(stateEvents(retryFirst)).toEqual([]);
    expect(retryFirst.activeEffect?.selectableCardIds).toEqual(['kotori']);

    const second = confirm(retryFirst, 'kotori');
    const newOpponent = emitGameEvent(
      second,
      createEnterStageEvent('opponent', ZoneType.HAND, SlotPosition.LEFT, P2, P2)
    );
    const retrySecond = confirm(newOpponent, 'opponent');
    expect(stateEvents(retrySecond)).toMatchObject([{ cardInstanceId: 'kotori' }]);
    expect(orientation(retrySecond, P2, 'opponent')).toBe(OrientationState.ACTIVE);
    expect(retrySecond.activeEffect?.selectableCardIds).toEqual(['opponent']);
    expect(orientation(confirm(retrySecond, 'opponent'), P2, 'opponent')).toBe(
      OrientationState.WAITING
    );
  });

  it.each(['before starting', 'after the first choice'] as const)(
    'continues the triggered effect if its LIVE leaves %s',
    (when) => {
      const { game, source } = setup();
      let state = queued(liveZone(game, source));
      if (when === 'after the first choice')
        state = confirm(resolvePendingCardEffects(state).gameState, 'kotori');
      state = returnLiveZoneCardToHandForPlayer(state, P1, SOURCE)!.gameState;
      if (when === 'before starting')
        state = confirm(resolvePendingCardEffects(state).gameState, 'kotori');
      state = confirm(state, 'opponent');
      expect(state.players[0].hand.cardIds).toContain(SOURCE);
      expect(stateEvents(state)).toMatchObject([
        { cardInstanceId: 'kotori' },
        { cardInstanceId: 'opponent' },
      ]);
      expect(state.activeEffect).toBeNull();
    }
  );

  it('resolves both rarities in an ordered batch and defers new pending abilities until the second step finishes', () => {
    const triggerKotori = kotori('observer-test-kotori');
    const { game, source } = setup([triggerKotori]);
    const parallel = createCardInstance(
      { ...getNovember04LiveData(BASE), cardCode: `${BASE}-SECL` },
      P1,
      'parallel-live'
    );
    const followUpId = 'observer-test-pending';
    registerMemberStateChangedObserver((state, { events }) => {
      const activated = events.find(
        (event) =>
          event.cardInstanceId === triggerKotori.instanceId &&
          event.nextOrientation === OrientationState.ACTIVE
      );
      if (!activated) return state;
      return {
        ...state,
        pendingAbilities: [
          ...state.pendingAbilities,
          {
            id: followUpId,
            abilityId: ABILITY,
            sourceCardId: SOURCE,
            controllerId: P1,
            mandatory: true,
            timingId: activated.eventType,
            eventIds: [activated.eventId],
          },
        ],
      };
    });
    const placed = liveZone(
      liveZone(
        { ...game, cardRegistry: new Map(game.cardRegistry).set(parallel.instanceId, parallel) },
        source
      ),
      parallel
    );
    const queuedState = queued(placed, [parallel.instanceId, SOURCE]);
    expect(queuedState.pendingAbilities.map(({ sourceCardId }) => sourceCardId)).toEqual([
      parallel.instanceId,
      SOURCE,
    ]);
    const order = resolvePendingCardEffects(queuedState).gameState;
    const first = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(first.activeEffect?.sourceCardId).toBe(parallel.instanceId);
    const second = confirm(first, triggerKotori.instanceId);
    expect(second.activeEffect?.sourceCardId).toBe(parallel.instanceId);
    expect(second.activeEffect?.selectableCardIds).toEqual(['opponent']);
    expect(second.pendingAbilities.some(({ id }) => id === followUpId)).toBe(true);
    const continued = confirm(second, 'opponent');
    expect(continued.activeEffect?.metadata?.pendingAbilityIds).toEqual([
      queuedState.pendingAbilities[1]?.id,
      followUpId,
    ]);
    const resolved = confirmActiveEffectStep(
      continued,
      P1,
      continued.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(
      resolved.actionHistory
        .filter(
          (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY
        )
        .map((action) => action.payload.step)
    ).toEqual([
      'SELECT_KOTORI_TO_ACTIVE',
      'ACTIVATE_KOTORI',
      'WAIT_OPPONENT_MEMBER',
      'NO_KOTORI_TARGET',
      'NO_KOTORI_TARGET',
    ]);
  });
});
