import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_CL1_013_LIVE_START_RECYCLE_AQOURS_GAIN_BLUE_HEART_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { returnLiveZoneCardToHandForPlayer } from '../../src/application/card-effects/runtime/actions';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance, type LiveCardData } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromZone } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { LiveResolver } from '../../src/domain/rules/live-resolver';
import { HeartPool, createHeartCountsFromIcons } from '../../src/domain/value-objects/heart';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  BladeHeartEffect,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { gameWith, liveZone, member, P1, P2, stage } from '../helpers/modifier-workflow-fixtures';
import { getOctober26CardData } from '../helpers/october-26-card-effects';

function setup(count = 6, hasTarget = true) {
  const source = createCardInstance(getOctober26CardData('PL!S-cl1-013-CL'), P1, 'wbnw');
  const target = member('aqours-target', 'target', P1, {
    groupNames: ['Aqours'],
    hearts: [
      { color: HeartColor.BLUE, count: 9 },
      { color: HeartColor.GRAY, count: 9 },
    ],
  });
  const waiting = Array.from({ length: count }, (_, index) =>
    member(`waiting-${index}`, `waiting-${index}`, P1, {
      groupNames: ['Aqours'],
      bladeHearts: undefined,
    })
  );
  const excluded = member('excluded', 'excluded', P1, {
    groupNames: ['Aqours'],
    bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
  });
  const deck = member('deck-top', 'deck-top');
  let raw = liveZone(gameWith([source, target, excluded, deck, ...waiting]), source);
  if (hasTarget) raw = stage(raw, [target]);
  raw = updatePlayer(raw, P1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [...waiting.map((card) => card.instanceId), excluded.instanceId],
    },
    mainDeck: { ...player.mainDeck, cardIds: ['deck-top'] },
  }));
  const queued = enqueueTriggeredCardEffects(raw, [TriggerCondition.ON_LIVE_START]);
  const game = resolvePendingCardEffects(queued).gameState;
  return { game, queued, source, target, waiting };
}

function select(game: GameState, ids: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    ids.length === 0 ? null : undefined,
    undefined,
    undefined,
    undefined,
    ids.length === 0 ? undefined : ids
  );
}

function displayAndMove(game: GameState, ids: readonly string[]): GameState {
  const displayed = select(game, ids);
  if (ids.length === 0) return displayed;
  expect(displayed.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
  return confirmActiveEffectStep(displayed, P1, displayed.activeEffect!.id);
}

function hearts(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (item) => item.kind === 'HEART' && item.abilityId === ABILITY
  );
}

describe('PL!S-cl1-013 分数10「WATER BLUE NEW WORLD」', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])(
    'recycles %i selected cards and grants two blue Hearts for each complete pair of actual moves',
    (count) => {
      const { game, waiting } = setup(7);
      const ids = waiting.slice(0, count).map((card) => card.instanceId);
      let state = displayAndMove(game, ids);
      const expected = Math.floor(count / 2) * 2;
      expect(state.players[0].mainDeck.cardIds[0]).toBe('deck-top');
      expect(new Set(state.players[0].mainDeck.cardIds.slice(1))).toEqual(new Set(ids));
      expect(state.players[0].waitingRoom.cardIds).toHaveLength(8 - count);
      expect(state.players[0].waitingRoom.cardIds).toContain('excluded');
      if (expected > 0) {
        expect(state.activeEffect).toMatchObject({
          selectableCardIds: ['target'],
          canSkipSelection: false,
          confirmSelectionLabel: '获得[青ハート]',
        });
        state = confirmActiveEffectStep(state, P1, state.activeEffect!.id, 'target');
        expect(hearts(state)).toMatchObject([
          {
            target: 'TARGET_MEMBER',
            playerId: P1,
            targetMemberCardId: 'target',
            sourceCardId: 'wbnw',
            hearts: [{ color: HeartColor.BLUE, count: expected }],
          },
        ]);
        expect(
          getMemberEffectiveHeartIcons(state, P1, 'target')
            .filter((heart) => heart.color === HeartColor.BLUE)
            .reduce((sum, heart) => sum + heart.count, 0)
        ).toBe(9 + expected);
      } else expect(hearts(state)).toEqual([]);
      expect(state.activeEffect).toBeNull();
      expect(state.pendingAbilities).toEqual([]);
      const events = state.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      );
      expect(events).toHaveLength(count === 0 ? 0 : 1);
      if (count > 0)
        expect(events[0]!.event).toMatchObject({
          movedCardIds: expect.arrayContaining(ids),
          destination: { kind: 'SHUFFLED_BOTTOM' },
          cause: { kind: 'CARD_EFFECT', abilityId: ABILITY, sourceCardId: 'wbnw' },
        });
    }
  );

  it('shows only the selected public cards and waits for the deadline before moving or granting; either participant advances exactly once', () => {
    const { game, waiting } = setup();
    let now = 10_000;
    const session = createGameSession({ now: () => now });
    session.createGame('wbnw-clock', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;
    const ids = waiting.slice(0, 2).map((card) => card.instanceId);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          game.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          ids
        )
      ).success
    ).toBe(true);
    const effect = session.state!.activeEffect!;
    expect(hearts(session.state!)).toEqual([]);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['deck-top']);
    for (const viewer of [P1, P2])
      expect(
        projectPlayerViewState(session.state!, viewer).activeEffect?.revealedObjectIds
      ).toEqual(ids.map(createPublicObjectId));
    const command = createAutoAdvancePublicCardSelectionCommand(
      P2,
      effect.id,
      effect.publicCardSelectionAutoAdvanceAt!
    );
    expect(session.executeCommand(command).success).toBe(false);
    now = effect.publicCardSelectionAutoAdvanceAt!;
    expect(session.executeCommand(command).success).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toHaveLength(3);
    expect(session.executeCommand(command).success).toBe(false);
    expect(hearts(session.state!)).toEqual([]);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, effect.id, 'target')).success
    ).toBe(true);
    expect(hearts(session.state!)).toHaveLength(1);
  });

  it('recycles the selected subset even without any stage target and never rolls back that move', () => {
    const { game, waiting } = setup(6, false);
    const done = displayAndMove(
      game,
      waiting.map((card) => card.instanceId)
    );
    expect(done.players[0].mainDeck.cardIds).toHaveLength(7);
    expect(done.players[0].waitingRoom.cardIds).toEqual(['excluded']);
    expect(done.activeEffect).toBeNull();
    expect(hearts(done)).toEqual([]);
  });

  it('rejects seven, duplicate, unrelated, and invalid-current-selector selections without partial movement', () => {
    const { game, waiting } = setup(7);
    expect(
      select(
        game,
        waiting.map((card) => card.instanceId)
      )
    ).toBe(game);
    expect(select(game, ['waiting-0', 'waiting-0'])).toBe(game);
    expect(select(game, ['excluded'])).toBe(game);
    const wrongGroup = registerCards(game, [
      { ...waiting[0]!, data: { ...waiting[0]!.data, groupNames: ['虹ヶ咲'] } },
    ]);
    // The initial two-phase public selection may still show the captured set; revalidation owns movement.
    const shown = select(wrongGroup, ['waiting-0', 'waiting-1']);
    const done = confirmActiveEffectStep(shown, P1, shown.activeEffect!.id);
    expect(done.players[0].mainDeck.cardIds).toEqual(['deck-top']);
    expect(done.players[0].waitingRoom.cardIds).toContain('waiting-1');
    expect(hearts(done)).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });

  it('does not partially move a set if one selected card leaves during public display', () => {
    const { game } = setup();
    const shown = select(game, ['waiting-0', 'waiting-1']);
    const changed = updatePlayer(shown, P1, (player) => ({
      ...player,
      waitingRoom: removeCardFromZone(player.waitingRoom, 'waiting-0'),
    }));
    const done = confirmActiveEffectStep(changed, P1, changed.activeEffect!.id);
    expect(done.players[0].mainDeck.cardIds).toEqual(['deck-top']);
    expect(done.players[0].waitingRoom.cardIds).toContain('waiting-1');
    expect(hearts(done)).toEqual([]);
    expect(done.activeEffect).toBeNull();
    expect(
      done.eventLog.some(
        ({ event }) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      )
    ).toBe(false);
  });

  it('keeps independent recycling and grants after the source leaves, then clears target Hearts when that member leaves', () => {
    const { game } = setup();
    let targeting = displayAndMove(returnLiveZoneCardToHandForPlayer(game, P1, 'wbnw')!.gameState, [
      'waiting-0',
      'waiting-1',
    ]);
    targeting = confirmActiveEffectStep(targeting, P1, targeting.activeEffect!.id, 'target');
    expect(hearts(targeting)).toHaveLength(1);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      targeting,
      P1,
      'target',
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(hearts(left)).toEqual([]);
    expect(left.players[0].mainDeck.cardIds).toHaveLength(3);
  });

  it('does not apply a captured target selection to a re-entered stage object', () => {
    const { game } = setup();
    const targeting = displayAndMove(game, ['waiting-0', 'waiting-1']);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      targeting,
      P1,
      'target',
      enqueueTriggeredCardEffects
    )!.gameState;
    let reentered = updatePlayer(left, P1, (player) => ({
      ...player,
      waitingRoom: removeCardFromZone(player.waitingRoom, 'target'),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, 'target', {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
    }));
    reentered = emitGameEvent(
      reentered,
      createEnterStageEvent('target', ZoneType.WAITING_ROOM, SlotPosition.RIGHT, P1, P1)
    );
    const refreshed = confirmActiveEffectStep(reentered, P1, reentered.activeEffect!.id, 'target');
    expect(hearts(refreshed)).toEqual([]);
    expect(refreshed.activeEffect?.selectableCardIds).toEqual(['target']);
    expect(refreshed.players[0].mainDeck.cardIds).toHaveLength(3);
  });

  it('finishes a stale target after recycling without reversing the already completed move', () => {
    const targeting = displayAndMove(setup().game, ['waiting-0', 'waiting-1']);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      targeting,
      P1,
      'target',
      enqueueTriggeredCardEffects
    )!.gameState;
    const done = confirmActiveEffectStep(left, P1, left.activeEffect!.id, 'target');
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].mainDeck.cardIds).toHaveLength(3);
    expect(hearts(done)).toEqual([]);
  });

  it('changes the real fifteen-blue-plus-nine-generic LIVE judgment only after six cards grant six blue Hearts', () => {
    const { game, source, waiting } = setup();
    const live = source.data as LiveCardData;
    expect(live.requirements.totalRequired).toBe(24);
    expect(live.bladeHearts).toEqual([
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
    ]);
    const judge = (state: GameState) =>
      new LiveResolver().judgeSingleLive(
        source.instanceId,
        live,
        new HeartPool(
          createHeartCountsFromIcons(
            getMemberEffectiveHeartIcons(state, P1, 'target', collectLiveModifiers(state))
          )
        )
      ).isSuccess;
    expect(judge(game)).toBe(false);
    const targeting = displayAndMove(
      game,
      waiting.map((card) => card.instanceId)
    );
    expect(judge(targeting)).toBe(false);
    const done = confirmActiveEffectStep(targeting, P1, targeting.activeEffect!.id, 'target');
    expect(judge(done)).toBe(true);
  });

  it('confirms an empty no-op once, while ordered resolution consumes it without a second interaction', () => {
    const { game, queued } = setup(0);
    expect(game.activeEffect?.selectableCardIds).toBeUndefined();
    expect(game.activeEffect?.stepText).toContain('不移动卡片');
    const done = confirmActiveEffectStep(game, P1, game.activeEffect!.id);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    const second = createCardInstance(getOctober26CardData('PL!S-cl1-013-CL'), P1, 'wbnw-second');
    const both = liveZone(registerCards(queued, [second]), second);
    const order = resolvePendingCardEffects(
      enqueueTriggeredCardEffects(both, [TriggerCondition.ON_LIVE_START])
    ).gameState;
    const ordered = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
  });
});
