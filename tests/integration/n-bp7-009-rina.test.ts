import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_009_ON_ENTER_EACH_PLAYER_MILL_TOP_SEVEN_ABILITY_ID,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import type { EnterWaitingRoomEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY = N_BP7_009_ON_ENTER_EACH_PLAYER_MILL_TOP_SEVEN_ABILITY_ID;

function member(code: string, id: string, ownerId: string) {
  return createCardInstance(
    {
      cardCode: code,
      name: id,
      groupNames: ['虹ヶ咲'],
      cardType: CardType.MEMBER,
      cost: code === 'PL!N-bp7-009-P' ? 4 : 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    ownerId,
    id
  );
}

function setup(
  options: {
    readonly p1Main?: number;
    readonly p1Waiting?: number;
    readonly p2Main?: number;
    readonly p2Waiting?: number;
    readonly activePlayerIndex?: number;
    readonly waitingRoomWatcher?: boolean;
  } = {}
) {
  const source = member('PL!N-bp7-009-P', 'rina', P1);
  const watcher = options.waitingRoomWatcher
    ? member('PL!SP-bp5-005-R', 'waiting-room-watcher', P1)
    : null;
  const p1Main = Array.from({ length: options.p1Main ?? 8 }, (_, i) =>
    member(`P1-M-${i}`, `p1-main-${i}`, P1)
  );
  const p1Waiting = Array.from({ length: options.p1Waiting ?? 0 }, (_, i) =>
    member(`P1-W-${i}`, `p1-wait-${i}`, P1)
  );
  const p2Main = Array.from({ length: options.p2Main ?? 8 }, (_, i) =>
    member(`P2-M-${i}`, `p2-main-${i}`, P2)
  );
  const p2Waiting = Array.from({ length: options.p2Waiting ?? 0 }, (_, i) =>
    member(`P2-W-${i}`, `p2-wait-${i}`, P2)
  );
  let game = registerCards(createGameState('n-bp7-009', P1, 'P1', P2, 'P2'), [
    source,
    ...(watcher ? [watcher] : []),
    ...p1Main,
    ...p1Waiting,
    ...p2Main,
    ...p2Waiting,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: p1Main.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: p1Waiting.map((card) => card.instanceId) },
    memberSlots: watcher
      ? placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
          SlotPosition.RIGHT,
          watcher.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
        )
      : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
  }));
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: p2Main.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: p2Waiting.map((card) => card.instanceId) },
  }));
  const pending: PendingAbilityState = {
    id: 'rina-on-enter',
    abilityId: ABILITY,
    sourceCardId: source.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['rina-enter-event'],
    sourceSlot: SlotPosition.CENTER,
  };
  return {
    game: {
      ...game,
      activePlayerIndex: options.activePlayerIndex ?? 0,
      pendingAbilities: [pending],
    },
    source,
    watcher,
    pending,
    p1Main,
    p1Waiting,
    p2Main,
    p2Waiting,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirmCurrent(game: GameState): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id);
}

function waitingEvents(game: GameState): readonly EnterWaitingRoomEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is EnterWaitingRoomEvent =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        event.cause?.abilityId === ABILITY
    );
}

describe('PL!N-bp7-009-P 天王寺璃奈', () => {
  it('双方都无需刷新时先各移动7张并建立两个 owner 事件，再由发动方分两次确认公开', () => {
    const scenario = setup();
    const revealing = start(scenario.game);
    expect(revealing.players[0].waitingRoom.cardIds).toEqual(
      scenario.p1Main.slice(0, 7).map((card) => card.instanceId)
    );
    expect(revealing.players[1].waitingRoom.cardIds).toEqual(
      scenario.p2Main.slice(0, 7).map((card) => card.instanceId)
    );
    const events = waitingEvents(revealing);
    expect(events).toHaveLength(2);
    expect(
      events.map((event) => ({
        ownerId: event.ownerId,
        controllerId: event.controllerId,
        ids: event.cardInstanceIds,
      }))
    ).toEqual([
      {
        ownerId: P1,
        controllerId: P1,
        ids: scenario.p1Main.slice(0, 7).map((card) => card.instanceId),
      },
      {
        ownerId: P2,
        controllerId: P2,
        ids: scenario.p2Main.slice(0, 7).map((card) => card.instanceId),
      },
    ]);
    expect(events.some((event) => event.cardInstanceIds?.length === 14)).toBe(false);
    expect(events.every((event) => event.fromZone === ZoneType.MAIN_DECK)).toBe(true);
    expect(events.every((event) => event.cause?.sourceCardId === scenario.source.instanceId)).toBe(
      true
    );
    expect(events.every((event) => event.cause?.abilityId === ABILITY)).toBe(true);

    const expectedP1Objects = scenario.p1Main.slice(0, 7).map((card) => `obj_${card.instanceId}`);
    const expectedP2Objects = scenario.p2Main.slice(0, 7).map((card) => `obj_${card.instanceId}`);
    for (const viewerId of [P1, P2]) {
      const view = projectPlayerViewState(revealing, viewerId);
      expect(view.table.zones.FIRST_WAITING_ROOM?.objectIds).toEqual(expectedP1Objects);
      expect(view.table.zones.SECOND_WAITING_ROOM?.objectIds).toEqual(expectedP2Objects);
      expect(view.activeEffect?.revealedObjectIds).toEqual(expectedP1Objects);
    }
    expect(revealing.activeEffect).toMatchObject({
      stepId: 'N_BP7_009_REVEAL_EACH_PLAYER_MILL_RESULT',
      awaitingPlayerId: P1,
      selectionLabel: '发动方公开的卡片',
      confirmSelectionLabel: '确认公开结果',
      metadata: {
        orderedResolution: false,
        revealOrderPlayerIds: [P1, P2],
        currentRevealPlayerId: P1,
      },
    });
    expect(revealing.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();

    const opponentAttempt = confirmActiveEffectStep(revealing, P2, revealing.activeEffect!.id);
    expect(opponentAttempt).toBe(revealing);

    const revealingOpponent = confirmCurrent(revealing);
    expect(revealingOpponent.activeEffect).toMatchObject({
      stepId: 'N_BP7_009_REVEAL_EACH_PLAYER_MILL_RESULT',
      awaitingPlayerId: P1,
      selectionLabel: '对方公开的卡片',
      confirmSelectionLabel: '确认公开结果',
      metadata: { currentRevealPlayerId: P2 },
    });
    for (const viewerId of [P1, P2]) {
      expect(
        projectPlayerViewState(revealingOpponent, viewerId).activeEffect?.revealedObjectIds
      ).toEqual(expectedP2Objects);
    }
    expect(
      revealingOpponent.actionHistory.filter(
        (action) =>
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'FINISH_EACH_PLAYER_MILL_TOP_SEVEN'
      )
    ).toHaveLength(0);

    const secondOpponentAttempt = confirmActiveEffectStep(
      revealingOpponent,
      P2,
      revealingOpponent.activeEffect!.id
    );
    expect(secondOpponentAttempt).toBe(revealingOpponent);
    const done = confirmCurrent(revealingOpponent);
    expect(done.activeEffect).toBeNull();
    expect(
      done.actionHistory.filter(
        (action) =>
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'FINISH_EACH_PLAYER_MILL_TOP_SEVEN'
      )
    ).toHaveLength(1);
  });

  it.each([
    { label: '仅控制者', p1Main: 7, p1Waiting: 0, p2Main: 8, p2Waiting: 0, expected: [1, 0] },
    { label: '仅对方', p1Main: 8, p1Waiting: 0, p2Main: 7, p2Waiting: 0, expected: [0, 1] },
    { label: '双方', p1Main: 7, p1Waiting: 0, p2Main: 7, p2Waiting: 0, expected: [1, 1] },
  ])(
    '$label需要刷新时，双方 projector 仍看到刷新前实际移动卡',
    ({ p1Main, p1Waiting, p2Main, p2Waiting, expected }) => {
      const scenario = setup({ p1Main, p1Waiting, p2Main, p2Waiting });
      const revealing = start(scenario.game);
      const resolution = revealing.actionHistory.find(
        (action) =>
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'REVEAL_EACH_PLAYER_MILL_TOP_SEVEN'
      );
      expect(resolution?.payload.refreshCountsByPlayer).toEqual([
        { playerId: P1, refreshCount: expected[0] },
        { playerId: P2, refreshCount: expected[1] },
      ]);
      expect(waitingEvents(revealing).map((event) => event.cardInstanceIds?.length)).toEqual([
        7, 7,
      ]);
      const expectedP1Objects = scenario.p1Main.slice(0, 7).map((card) => `obj_${card.instanceId}`);
      const expectedP2Objects = scenario.p2Main.slice(0, 7).map((card) => `obj_${card.instanceId}`);
      expect(projectPlayerViewState(revealing, P1).activeEffect?.revealedObjectIds).toEqual(
        expectedP1Objects
      );
      expect(projectPlayerViewState(revealing, P2).activeEffect?.revealedObjectIds).toEqual(
        expectedP1Objects
      );
      const revealingOpponent = confirmCurrent(revealing);
      expect(projectPlayerViewState(revealingOpponent, P1).activeEffect?.revealedObjectIds).toEqual(
        expectedP2Objects
      );
      expect(projectPlayerViewState(revealingOpponent, P2).activeEffect?.revealedObjectIds).toEqual(
        expectedP2Objects
      );
      if (expected[0] === 1) {
        expect(revealing.players[0].waitingRoom.cardIds).toEqual([]);
      }
      if (expected[1] === 1) {
        expect(revealing.players[1].waitingRoom.cardIds).toEqual([]);
      }
    }
  );

  it('双方同时需刷新时按主动玩家优先，不用来源 controller 冒充', () => {
    const scenario = setup({
      p1Main: 1,
      p1Waiting: 8,
      p2Main: 1,
      p2Waiting: 8,
      activePlayerIndex: 1,
    });
    const revealing = start(scenario.game);
    expect(
      revealing.actionHistory
        .filter((action) => action.type === 'RULE_ACTION' && action.payload.type === 'REFRESH')
        .map((action) => action.payload.affectedPlayerId)
    ).toEqual([P2, P1]);
    expect(waitingEvents(revealing).map((event) => event.ownerId)).toEqual([P2, P1]);
    expect(revealing.activeEffect).toMatchObject({
      awaitingPlayerId: P1,
      metadata: { currentRevealPlayerId: P1 },
    });
    expect(confirmCurrent(revealing).activeEffect).toMatchObject({
      awaitingPlayerId: P1,
      metadata: { currentRevealPlayerId: P2 },
    });
  });

  it('一方完全无法移动不阻止另一方，并只展示有实际移动的一方', () => {
    const scenario = setup({ p1Main: 0, p1Waiting: 0, p2Main: 8, p2Waiting: 0 });
    const revealing = start(scenario.game);
    expect(revealing.players[0].waitingRoom.cardIds).toEqual([]);
    expect(revealing.players[1].waitingRoom.cardIds).toEqual(
      scenario.p2Main.slice(0, 7).map((card) => card.instanceId)
    );
    expect(waitingEvents(revealing)).toHaveLength(1);
    expect(waitingEvents(revealing)[0]).toMatchObject({
      ownerId: P2,
      cardInstanceIds: scenario.p2Main.slice(0, 7).map((card) => card.instanceId),
    });
    expect(revealing.activeEffect?.revealedCardIds).toEqual(
      scenario.p2Main.slice(0, 7).map((card) => card.instanceId)
    );
    const resolution = revealing.actionHistory.find(
      (action) =>
        action.payload.abilityId === ABILITY &&
        action.payload.step === 'REVEAL_EACH_PLAYER_MILL_TOP_SEVEN'
    );
    expect(resolution?.payload.movedCardIdsByPlayer).toEqual([
      { playerId: P1, movedCardIds: [] },
      { playerId: P2, movedCardIds: scenario.p2Main.slice(0, 7).map((card) => card.instanceId) },
    ]);
    const done = confirmCurrent(revealing);
    expect(done.activeEffect).toBeNull();
    expect(
      done.actionHistory.filter(
        (action) =>
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'FINISH_EACH_PLAYER_MILL_TOP_SEVEN'
      )
    ).toHaveLength(1);
  });

  it('展示集合去重不改变每位玩家原始 movedCardIds 与事件事实', () => {
    const scenario = setup({ p1Main: 1, p1Waiting: 1, p2Main: 0, p2Waiting: 0 });
    const revealing = start(scenario.game);
    const p1Event = waitingEvents(revealing).find((event) => event.ownerId === P1)!;
    expect(p1Event.cardInstanceIds).toHaveLength(7);
    expect(new Set(p1Event.cardInstanceIds).size).toBeLessThan(p1Event.cardInstanceIds!.length);
    expect(revealing.activeEffect?.revealedCardIds).toEqual([...new Set(p1Event.cardInstanceIds)]);
    expect(revealing.activeEffect?.metadata?.movedCardIdsByPlayer).toEqual([
      { playerId: P1, movedCardIds: p1Event.cardInstanceIds },
      { playerId: P2, movedCardIds: [] },
    ]);

    const done = confirmCurrent(revealing);
    expect(done.activeEffect).toBeNull();
    const final = done.actionHistory.find(
      (action) =>
        action.payload.abilityId === ABILITY &&
        action.payload.step === 'FINISH_EACH_PLAYER_MILL_TOP_SEVEN'
    );
    expect(final?.payload.movedCardIdsByPlayer).toEqual([
      { playerId: P1, movedCardIds: p1Event.cardInstanceIds },
      { playerId: P2, movedCardIds: [] },
    ]);
  });

  it('公开确认前不推进 waiting-room pending；确认后 continuation 只推进一次', () => {
    const scenario = setup({ waitingRoomWatcher: true });
    const revealing = start(scenario.game);
    expect(revealing.activeEffect?.stepId).toBe('N_BP7_009_REVEAL_EACH_PLAYER_MILL_RESULT');
    expect(
      revealing.pendingAbilities.some(
        (ability) =>
          ability.abilityId ===
          SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(true);
    expect(
      revealing.actionHistory.filter(
        (action) =>
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'FINISH_EACH_PLAYER_MILL_TOP_SEVEN'
      )
    ).toHaveLength(0);

    const eventCount = waitingEvents(revealing).length;
    const revealingOpponent = confirmCurrent(revealing);
    expect(revealingOpponent.activeEffect?.metadata?.currentRevealPlayerId).toBe(P2);
    expect(
      revealingOpponent.actionHistory.filter(
        (action) =>
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'FINISH_EACH_PLAYER_MILL_TOP_SEVEN'
      )
    ).toHaveLength(0);
    expect(
      revealingOpponent.pendingAbilities.some(
        (ability) =>
          ability.abilityId ===
          SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(true);
    expect(waitingEvents(revealingOpponent)).toHaveLength(eventCount);

    const done = confirmCurrent(revealingOpponent);
    const resolutionActions = done.actionHistory.filter(
      (action) =>
        action.payload.abilityId === ABILITY &&
        action.payload.step === 'FINISH_EACH_PLAYER_MILL_TOP_SEVEN'
    );
    expect(resolutionActions).toHaveLength(1);
    expect(done.pendingAbilities.some((ability) => ability.id === scenario.pending.id)).toBe(false);
    expect(waitingEvents(done)).toHaveLength(eventCount);

    const repeated = confirmActiveEffectStep(done, P1, revealing.activeEffect!.id);
    expect(repeated).toBe(done);
    expect(waitingEvents(repeated)).toHaveLength(eventCount);
    expect(
      repeated.actionHistory.filter(
        (action) =>
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'FINISH_EACH_PLAYER_MILL_TOP_SEVEN'
      )
    ).toHaveLength(1);
  });

  it('双方均无资源时直接安全结束，不建立空公开窗口', () => {
    const scenario = setup({ p1Main: 0, p1Waiting: 0, p2Main: 0, p2Waiting: 0 });
    const done = start(scenario.game);
    expect(done.activeEffect).toBeNull();
    expect(waitingEvents(done)).toEqual([]);
    expect(
      done.actionHistory.filter(
        (action) =>
          action.payload.abilityId === ABILITY &&
          action.payload.step === 'FINISH_EACH_PLAYER_MILL_TOP_SEVEN_NO_CARDS'
      )
    ).toHaveLength(1);
  });
});
