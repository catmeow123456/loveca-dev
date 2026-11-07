import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID as COPY,
  S_AD2_003_AUTO_ON_CHEER_BLADE_HEART_CARD_THRESHOLDS_GAIN_GREEN_BLUE_ABILITY_ID as AUTO,
  S_AD2_003_ON_ENTER_DISCARD_RECOVER_LIVE_ABILITY_ID as RECOVER,
} from '../../src/application/card-effects/ability-ids';
import { delegateWaitingRoomMemberOnEnterAbility } from '../../src/application/card-effects/workflows/shared/activate-waiting-room-member-on-enter-ability';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { createGameSession } from '../../src/application/game-session';
import {
  createPlayMemberToSlotCommand,
  createConfirmEffectStepCommand,
  createAutoAdvancePublicCardSelectionCommand,
} from '../../src/application/game-commands';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  createCardInstance,
  type BladeHearts,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createCheerEvent,
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
} from '../../src/domain/events/game-events';
import {
  addLiveModifier,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import {
  BladeHeartEffect as B,
  CardType,
  FaceState,
  GamePhase,
  SubPhase,
  HeartColor as H,
  OrientationState,
  SlotPosition,
  TriggerCondition as T,
  ZoneType,
} from '../../src/shared/types/enums';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { createNovember07DraftCard } from '../helpers/november-07-draft-effects';

const P = 'p1';
function card(id: string, bladeHearts: BladeHearts = [{ effect: B.SCORE }, { effect: B.DRAW }]) {
  const data: MemberCardData = {
    cardCode: `TEST-${id}`,
    cardType: CardType.MEMBER,
    name: id,
    cost: 1,
    blade: 1,
    hearts: [],
    bladeHearts,
  };
  return createCardInstance(data, P, id);
}
function setup(): GameState {
  const source = createNovember07DraftCard('PL!S-ad2-003', P, 'source');
  let game = registerCards(createGameState('ruby', P, 'P1', 'p2', 'P2'), [
    source,
    ...Array.from({ length: 11 }, (_, i) => card(`cheer-${i}`)),
    card('none', []),
    createNovember07DraftCard('PL!HS-ad2-004', P, 'live'),
  ]);
  game = updatePlayer(game, P, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'source', {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = emitGameEvent(
    game,
    createEnterStageEvent('source', ZoneType.HAND, SlotPosition.CENTER, P, P)
  );
  return {
    ...game,
    liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: P },
  };
}
function cheer(game: GameState, ids: readonly string[], additional = false, playerId = P) {
  const event = createCheerEvent(playerId, ids, ids.length, { automated: true, additional });
  const key = playerId === P ? 'firstPlayerCheerCardIds' : 'secondPlayerCheerCardIds';
  const state = {
    ...game,
    liveResolution: { ...game.liveResolution, [key]: [...game.liveResolution[key], ...ids] },
  };
  return enqueueTriggeredCardEffects(emitGameEvent(state, event), [T.ON_CHEER], {
    cheerEvents: [event],
  });
}
function confirm(game: GameState, selectedCardId?: string | null) {
  return confirmActiveEffectStep(game, P, game.activeEffect!.id, selectedCardId);
}
function resolve(game: GameState) {
  const open = resolvePendingCardEffects(game).gameState;
  return open.activeEffect ? confirm(open) : open;
}
function gained(game: GameState) {
  return getMemberEffectiveHeartIcons(game, P, 'source')
    .filter((heart) => heart.color === H.GREEN || heart.color === H.BLUE)
    .map((heart) => [heart.color, heart.count]);
}
const ids = (count: number) => Array.from({ length: count }, (_, i) => `cheer-${i}`);

describe('PL!S-ad2-003 费用13「黑泽露比」', () => {
  it('keeps the discard cost paid when the publicly selected LIVE leaves and re-enters waiting room', () => {
    let game = updatePlayer(setup(), P, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: ['none'] },
      waitingRoom: { ...player.waitingRoom, cardIds: ['live'] },
    }));
    game = resolvePendingCardEffects(
      enqueueTriggeredCardEffects(game, [T.ON_ENTER_STAGE])
    ).gameState;
    const paid = confirm(game, 'none');
    const publicSelection = confirm(paid, 'live');
    expect(publicSelection.activeEffect?.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
    const returned = emitGameEvent(
      publicSelection,
      createEnterWaitingRoomEvent(['live'], ZoneType.HAND, P, P)
    );
    const done = confirmActiveEffectStepThroughPublicReveal(returned, P, returned.activeEffect!.id);
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(done.players[0].waitingRoom.cardIds).toEqual(expect.arrayContaining(['none', 'live']));
    expect(
      done.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === RECOVER
      )
    ).toHaveLength(1);
    expect(done.activeEffect).toBeNull();
  });
  it('recounts historical facts at confirmation and resolves an ordered pair without extra confirmations', () => {
    let open = resolvePendingCardEffects(cheer(setup(), ids(4))).gameState;
    open = cheer(open, ids(10).slice(4), true);
    expect(gained(confirm(open))).toEqual([
      [H.GREEN, 1],
      [H.BLUE, 1],
      [H.GREEN, 1],
      [H.BLUE, 1],
    ]);

    let game = registerCards(setup(), [createNovember07DraftCard('PL!S-ad2-003', P, 'source2')]);
    game = updatePlayer(game, P, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'source2'),
    }));
    game = resolvePendingCardEffects(cheer(game, ids(10))).gameState;
    const done = confirmActiveEffectStep(game, P, game.activeEffect!.id, null, undefined, true);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(
      done.actionHistory.filter(
        (action) => action.payload.abilityId === AUTO && action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(2);
  });
  it.each([4, 5, 9, 10])('counts each effective Blade Heart card once at threshold %i', (count) => {
    const queued = cheer(setup(), ids(count));
    const open = resolvePendingCardEffects(queued).gameState;
    expect(open.activeEffect?.effectText).toContain(`有${count}张`);
    expect(gained(open)).toEqual([
      [H.GREEN, 1],
      [H.BLUE, 1],
    ]);
    const done = confirm(open);
    expect(gained(done)).toEqual([
      [H.GREEN, 1],
      [H.BLUE, 1],
      ...(count >= 5 ? [[H.GREEN, 1]] : []),
      ...(count >= 10 ? [[H.BLUE, 1]] : []),
    ]);
    expect(
      done.actionHistory.filter(
        (a) => a.payload.abilityId === AUTO && a.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
    expect(cheer(done, ids(count)).pendingAbilities).toEqual([]);
  });
  it('uses effective judgments and historical cards already moved out of resolution', () => {
    let game = registerCards(setup(), [
      card('cheer-4', [{ effect: B.HEART, heartColor: H.RAINBOW }]),
    ]);
    game = cheer(cheer(game, ids(4), true), ['cheer-4']);
    const done = resolve(game);
    expect(gained(done)).toEqual([
      [H.GREEN, 1],
      [H.BLUE, 1],
      [H.GREEN, 1],
    ]);
    expect(done.resolutionZone.cardIds).toEqual([]);
  });
  it('counts DRAW and SCORE judgments but excludes an empty judgment list', () => {
    let game = registerCards(setup(), [card('cheer-4', [])]);
    expect(gained(resolve(cheer(game, ids(5))))).toEqual([
      [H.GREEN, 1],
      [H.BLUE, 1],
    ]);
  });
  it('consumes a captured lifecycle without awarding Hearts to a re-entered source', () => {
    const queued = cheer(setup(), ids(10));
    const oldLifecycle = queued.pendingAbilities[0]!.sourceLifecycleId;
    let game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      queued,
      P,
      'source',
      enqueueTriggeredCardEffects
    )!.gameState;
    game = updatePlayer(game, P, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'source'),
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P, P)
    );
    const done = resolve(game);
    expect(gained(done)).toEqual([
      [H.GREEN, 1],
      [H.BLUE, 1],
    ]);
    expect(
      done.actionHistory.find(
        (a) => a.payload.abilityId === AUTO && a.payload.step === 'ABILITY_USE'
      )?.payload.sourceLifecycleId
    ).toBe(oldLifecycle);
    expect(cheer(done, ids(10)).pendingAbilities.some((p) => p.abilityId === AUTO)).toBe(true);
  });
  it('ignores opponent and additional trigger facts', () => {
    expect(cheer(setup(), ids(5), true).pendingAbilities).toEqual([]);
    expect(cheer(setup(), ids(5), false, 'p2').pendingAbilities).toEqual([]);
  });
  it('offers discard even without a recovery target, preserves paid cost and rejects stale input', () => {
    let game = updatePlayer(setup(), P, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: ['none'] },
    }));
    game = enqueueTriggeredCardEffects(game, [T.ON_ENTER_STAGE]);
    const open = resolvePendingCardEffects(game).gameState;
    expect(open.activeEffect?.abilityId).toBe(RECOVER);
    expect(confirm(open, 'bad')).toBe(open);
    const done = confirm(open, 'none');
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(done.players[0].waitingRoom.cardIds).toContain('none');
    expect(
      done.actionHistory.some((a) => a.type === 'PAY_COST' && a.payload.abilityId === RECOVER)
    ).toBe(true);
  });
  it('supports optional decline and recovery of a LIVE of any group through delegated source-independent resolution', () => {
    let game = updatePlayer(setup(), P, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: ['none'] },
      waitingRoom: { ...player.waitingRoom, cardIds: ['source', 'live'] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
      },
    }));
    game = delegateWaitingRoomMemberOnEnterAbility(
      game,
      {
        controllerId: P,
        parentAbilityId: 'parent',
        parentSourceCardId: 'parent-source',
        parentEffectId: 'parent-effect',
        targetCardId: 'source',
        delegatedAbilityId: RECOVER,
        orderedResolution: false,
      },
      (state, ability) =>
        resolvePendingCardEffects({
          ...state,
          pendingAbilities: [...state.pendingAbilities, ability],
        }).gameState
    );
    expect(game.activeEffect?.abilityId).toBe(RECOVER);
    expect(confirm(game, null).players[0].hand.cardIds).toEqual(['none']);
    const paid = confirm(game, 'none');
    expect(paid.activeEffect?.selectableCardIds).toEqual(['live']);
    expect(paid.players[0].waitingRoom.cardIds).toContain('source');
    const done = confirmActiveEffectStepThroughPublicReveal(paid, P, paid.activeEffect!.id, 'live');
    expect(done.players[0].hand.cardIds).toEqual(['live']);
    expect(done.players[0].waitingRoom.cardIds).toContain('source');
    expect(done.activeEffect).toBeNull();
  });
  it('pays the real cost13 through a RULES play command before resolving its optional discard and recovery', () => {
    const energy = Array.from({ length: 13 }, (_, i) =>
      createCardInstance(
        { cardType: CardType.ENERGY, cardCode: `ENE-${i}`, name: 'Energy' },
        P,
        `energy-${i}`
      )
    );
    let game = registerCards(setup(), energy);
    game = updatePlayer(game, P, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: ['source', 'none'] },
      mainDeck: { ...player.mainDeck, cardIds: ['cheer-0'] },
      waitingRoom: { ...player.waitingRoom, cardIds: ['live'] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map(),
      },
      energyZone: {
        ...player.energyZone,
        cardIds: energy.map((c) => c.instanceId),
        cardStates: new Map(
          energy.map((c) => [
            c.instanceId,
            { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE },
          ])
        ),
      },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
      waitingPlayerId: null,
      waitingForInput: false,
      manualOperationMode: 'RULES',
      eventLog: [],
      liveResolution: { ...game.liveResolution, isInLive: false, performingPlayerId: null },
    };
    let now = 1_000;
    const session = createGameSession({ now: () => now });
    session.createGame('ruby-rules', P, 'P1', 'p2', 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;
    const played = session.executeCommand(
      createPlayMemberToSlotCommand(P, 'source', SlotPosition.CENTER)
    );
    expect(played.success, played.error).toBe(true);
    expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe('source');
    expect(
      [...session.state!.players[0].energyZone.cardStates.values()].filter(
        (state) => state.orientation === OrientationState.WAITING
      )
    ).toHaveLength(13);
    expect(session.state!.activeEffect?.abilityId).toBe(RECOVER);
    const discardView = projectPlayerViewState(session.state!, P).activeEffect;
    expect(discardView).toMatchObject({
      selectableObjectIds: [createPublicObjectId('none')],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(discardView?.selectableObjectMode).toBeUndefined();
    expect(discardView?.autoSubmitSingleSelection).toBeUndefined();
    expect(discardView?.selectableOptions).toBeUndefined();
    expect(discardView?.effectChoice).toBeUndefined();
    expect(
      projectPlayerViewState(session.state!, 'p2').activeEffect?.selectableObjectIds
    ).toBeUndefined();

    const decline = createGameSession();
    decline.createGame('ruby-decline', P, 'P1', 'p2', 'P2');
    (decline as unknown as { authorityState: GameState }).authorityState = session.state!;
    const skipped = decline.executeCommand(
      createConfirmEffectStepCommand(P, decline.state!.activeEffect!.id, null)
    );
    expect(skipped.success, skipped.error).toBe(true);
    expect(decline.state!.activeEffect).toBeNull();
    expect(decline.state!.players[0].hand.cardIds).toEqual(['none']);
    expect(decline.state!.players[0].waitingRoom.cardIds).toContain('live');

    // GameBoard's ordinary single-card click sends exactly this selectedCardId command.
    const paid = session.executeCommand(
      createConfirmEffectStepCommand(P, session.state!.activeEffect!.id, 'none')
    );
    expect(paid.success, paid.error).toBe(true);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('none');
    const recoveryView = projectPlayerViewState(session.state!, P).activeEffect;
    expect(recoveryView).toMatchObject({
      selectableObjectIds: [createPublicObjectId('live')],
      canSkipSelection: false,
    });
    expect(recoveryView?.selectableObjectMode).toBeUndefined();
    expect(recoveryView?.autoSubmitSingleSelection).toBeUndefined();
    expect(recoveryView?.selectableOptions).toBeUndefined();
    expect(recoveryView?.effectChoice).toBeUndefined();
    const effectId = session.state!.activeEffect!.id;
    const selected = session.executeCommand(createConfirmEffectStepCommand(P, effectId, 'live'));
    expect(selected.success, selected.error).toBe(true);
    const deadline = session.state!.activeEffect!.publicCardSelectionAutoAdvanceAt!;
    expect(session.state!.activeEffect?.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    for (const viewer of [P, 'p2']) {
      expect(projectPlayerViewState(session.state!, viewer, { now }).activeEffect).toMatchObject({
        revealedObjectIds: [createPublicObjectId('live')],
        publicCardSelectionAutoAdvanceAfterMs: 2_000,
      });
    }
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand('p2', effectId, deadline))
        .success
    ).toBe(false);
    now = deadline;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand('p2', effectId, deadline))
        .success
    ).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(['live']);
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P, effectId, deadline))
        .success
    ).toBe(false);
    expect(session.state!.players[0].hand.cardIds).toEqual(['live']);
  });
  it('resolves Ruby through You’s actual two-ON_ENTER delegation after paying both independent discard costs', () => {
    const you = createNovember07DraftCard('PL!S-bp7-005', P, 'you');
    const hand = Array.from({ length: 3 }, (_, i) =>
      createCardInstance(
        { cardType: CardType.ENERGY, cardCode: `PAY-${i}`, name: 'Energy' },
        P,
        `pay-${i}`
      )
    );
    let game = registerCards(setup(), [you, ...hand]);
    game = updatePlayer(game, P, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: hand.map((c) => c.instanceId) },
      waitingRoom: { ...player.waitingRoom, cardIds: ['live'] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, 'you'),
        SlotPosition.RIGHT,
        'source'
      ),
    }));
    game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
    const started = activateCardAbility(game, P, 'you', COPY);
    const paid = confirmActiveEffectStep(
      started,
      P,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ['pay-0', 'pay-1']
    );
    const ordered = confirm(paid, 'source');
    const child = confirmActiveEffectStep(
      ordered,
      P,
      ordered.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'target-first'
    );
    expect(child.activeEffect?.abilityId).toBe(RECOVER);
    expect(child.activeEffect?.sourceCardId).toBe('source');
    const recovery = confirm(child, 'pay-2');
    expect(recovery.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(['pay-0', 'pay-1', 'pay-2'])
    );
    const done = confirmActiveEffectStepThroughPublicReveal(
      recovery,
      P,
      recovery.activeEffect!.id,
      'live'
    );
    expect(done.players[0].hand.cardIds).toEqual(['live']);
    expect(done.delegatedAbilitySequence).toBeNull();
    expect(done.activeEffect).toBeNull();
  });
});
