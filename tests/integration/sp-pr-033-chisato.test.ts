import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PR_033_LIVE_SUCCESS_DISCARD_RECOVER_LIELLA_CHEER_BY_SOURCE_BLADE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  createCheerEvent,
  createEnterStageEvent,
  createLiveSuccessEvent,
} from '../../src/domain/events/game-events';
import {
  addLiveModifier,
  addBladeLiveModifierForTargetMember,
  removeStageMemberBoundLiveModifiers,
} from '../../src/domain/rules/live-modifiers';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';
import { createOctober31DraftCard } from '../helpers/october-31-draft-effects';
import {
  confirmActiveEffectStepThroughPublicReveal,
  confirmPublicSelectionIfNeeded,
} from '../helpers/public-card-selection-confirmation';
import {
  P1,
  P2,
  choose,
  gameWith,
  stage,
  start,
  syntheticMember,
  syntheticLive,
} from '../helpers/edelnote-effect-fixture';

function setup() {
  const source = createOctober31DraftCard('PL!SP-PR-033', P1, 'source');
  const live = syntheticLive('live');
  const cards = [
    syntheticMember('equal', { groupNames: ['Liella!'], blade: 4 }),
    syntheticMember('higher', { groupNames: ['Liella!'], blade: 5 }),
    syntheticMember('too-high', { groupNames: ['Liella!'], blade: 6 }),
    syntheticMember('foreign-group', { groupNames: ['虹ヶ咲'], blade: 1 }),
    syntheticMember('foreign-owner', { groupNames: ['Liella!'], blade: 1 }, P2),
    live,
  ];
  let game = stage(gameWith([source, syntheticMember('hand'), ...cards]), 'source');
  game = updatePlayer(game, P1, (p) => ({ ...p, hand: { ...p.hand, cardIds: ['hand'] } }));
  game = {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: cards.map((c) => c.instanceId),
      revealedCardIds: cards.map((c) => c.instanceId),
    },
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds: cards.map((c) => c.instanceId),
    },
  };
  game = emitGameEvent(
    game,
    createEnterStageEvent('source', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
  );
  return emitGameEvent(
    game,
    createCheerEvent(
      P1,
      cards.map((c) => c.instanceId),
      4
    )
  );
}
function finishPublic(game: GameState, selected = 'equal') {
  return confirmActiveEffectStepThroughPublicReveal(game, P1, game.activeEffect!.id, selected);
}
function leave(game: GameState) {
  return removeStageMemberBoundLiveModifiers(
    sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(game, P1, 'source', (state) => state)!
      .gameState,
    ['source']
  );
}

describe('PL!SP-PR-033 费用9「岚千砂都」source-BLADE cheer recovery', () => {
  it('pays once, accepts only the current owned Liella member and displays before moving', () => {
    const event = createLiveSuccessEvent(P1, ['song'], 1);
    const initial = resolvePendingCardEffects(
      enqueueTriggeredCardEffects(
        emitGameEvent(setup(), event),
        [TriggerCondition.ON_LIVE_SUCCESS],
        { liveSuccessEvents: [event] }
      )
    ).gameState;
    expect(initial.activeEffect?.abilityId).toBe(ABILITY);
    const cheerFact = initial.eventLog.find(
      ({ event }) => event.eventType === TriggerCondition.ON_CHEER
    )!.event;
    const session = createGameSession();
    session.createGame('chisato-public', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = initial;
    const confirm = (id: string | null) =>
      session.executeCommand(
        createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, id)
      );
    expect(confirm('hand').success).toBe(true);
    expect(session.state!.activeEffect?.selectableCardIds).toEqual(['equal']);
    expect(session.state!.activeEffect?.canSkipSelection).toBe(true);
    expect(confirm('higher').success).toBe(false);
    expect(confirm('equal').success).toBe(true);
    expect(session.state!.resolutionZone.cardIds).toContain('equal');
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(session.state!.activeEffect?.publicCardSelectionAutoAdvanceAt).toBeTypeOf('number');
    confirmPublicSelectionIfNeeded(session);
    expect(session.state!.players[0].hand.cardIds).toEqual(['equal']);
    expect(session.state!.resolutionZone.cardIds).not.toContain('equal');
    expect(session.state!.resolutionZone.revealedCardIds).not.toContain('equal');
    expect(session.state!.liveResolution.firstPlayerCheerCardIds).toContain('equal');
    expect(
      session.state!.eventLog.find(({ event }) => event.eventId === cheerFact.eventId)?.event
    ).toEqual(cheerFact);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(['hand']);
    expect(
      session.state!.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.HAND
      )
    ).toHaveLength(1);
  });

  it.each(['before-cost', 'after-cost', 'no-target'] as const)(
    'allows %s without reversing an already paid cost',
    (mode) => {
      let game = setup();
      if (mode === 'no-target')
        game = {
          ...game,
          resolutionZone: { ...game.resolutionZone, cardIds: [], revealedCardIds: [] },
        };
      game = start(game, ABILITY);
      game = choose(game, mode === 'before-cost' ? null : 'hand');
      if (mode === 'after-cost') game = choose(game, null);
      expect(game.activeEffect).toBeNull();
      expect(game.players[0].hand.cardIds).toEqual(mode === 'before-cost' ? ['hand'] : []);
      expect(game.players[0].waitingRoom.cardIds).toEqual(mode === 'before-cost' ? [] : ['hand']);
      expect(
        game.actionHistory.filter(
          (a) => a.payload.step === 'START_PUBLIC_CARD_SELECTION_CONFIRMATION'
        )
      ).toEqual([]);
    }
  );

  it('uses effective source BLADE, including original replacement and live modifiers', () => {
    let game = setup();
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: P1,
      sourceCardId: 'source',
      memberCardId: 'source',
      abilityId: 'replacement',
      count: 2,
    });
    game = addBladeLiveModifierForTargetMember(game, {
      playerId: P1,
      sourceCardId: 'source',
      targetMemberCardId: 'source',
      abilityId: 'boost',
      countDelta: 3,
    })!.gameState;
    game = choose(start(game, ABILITY), 'hand');
    expect(game.activeEffect?.selectableCardIds).toEqual(['equal', 'higher']);
    expect(finishPublic(game, 'higher').players[0].hand.cardIds).toEqual(['higher']);
  });

  it.each(['before-pay', 'during-reveal'] as const)(
    'uses the old source final BLADE after leaving and re-entering %s',
    (moment) => {
      let game = start(setup(), ABILITY);
      const originalLifecycle = game.activeEffect!.sourceLifecycleId;
      if (moment === 'during-reveal') game = choose(choose(game, 'hand'), 'equal');
      game = leave(game);
      game = updatePlayer(game, P1, (p) => ({
        ...p,
        waitingRoom: {
          ...p.waitingRoom,
          cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'source'),
        },
        memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.RIGHT, 'source'),
      }));
      game = emitGameEvent(
        game,
        createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.RIGHT, P1, P1)
      );
      game = addLiveModifier(game, {
        kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
        playerId: P1,
        sourceCardId: 'source',
        memberCardId: 'source',
        abilityId: 'new-object',
        count: 1,
      });
      const displayContinuation = game.activeEffect?.metadata
        ?.publicCardSelectionConfirmationContinuation as
        { originalEffect: GameState['activeEffect'] } | undefined;
      expect(
        displayContinuation?.originalEffect?.sourceLifecycleId ??
          game.activeEffect?.sourceLifecycleId
      ).toBe(originalLifecycle);
      if (moment === 'before-pay') {
        game = choose(game, 'hand');
        expect(game.activeEffect?.selectableCardIds).toEqual(['equal']);
        game = finishPublic(game);
      } else game = confirmActiveEffectStep(game, P1, game.activeEffect!.id);
      expect(game.players[0].hand.cardIds).toEqual(['equal']);
      expect(game.activeEffect).toBeNull();
    }
  );

  it.each(['current-cheer', 'public-zone', 'predicate'] as const)(
    'rechecks %s after display and preserves the fee when the target is stale',
    (mutation) => {
      let game = choose(choose(start(setup(), ABILITY), 'hand'), 'equal');
      if (mutation === 'current-cheer')
        game = { ...game, liveResolution: { ...game.liveResolution, firstPlayerCheerCardIds: [] } };
      else if (mutation === 'public-zone')
        game = { ...game, resolutionZone: { ...game.resolutionZone, revealedCardIds: [] } };
      else {
        const card = game.cardRegistry.get('equal')!;
        game = registerCards(game, [{ ...card, data: { ...card.data, groupNames: ['虹ヶ咲'] } }]);
      }
      game = confirmActiveEffectStep(game, P1, game.activeEffect!.id);
      expect(game.players[0].hand.cardIds).toEqual([]);
      expect(game.players[0].waitingRoom.cardIds).toEqual(['hand']);
      expect(game.resolutionZone.cardIds).toContain('equal');
      expect(game.activeEffect).toBeNull();
    }
  );

  it('records an explicit unavailable-information result without printed-value fallback', () => {
    let game = start(setup(), ABILITY);
    game = leave(game);
    game = {
      ...game,
      eventLog: game.eventLog.map((record) => {
        if (record.event.eventType !== TriggerCondition.ON_LEAVE_STAGE) return record;
        const { memberLastKnownInformation: _snapshot, ...event } =
          record.event as import('../../src/domain/events/game-events').LeaveStageEvent;
        return { ...record, event };
      }),
    };
    game = choose(game, 'hand');
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).toEqual([]);
    expect(game.players[0].waitingRoom.cardIds).toContain('hand');
    expect(game.actionHistory.at(-1)?.payload.step).toBe('SOURCE_MEMBER_INFORMATION_UNAVAILABLE');
  });
});
