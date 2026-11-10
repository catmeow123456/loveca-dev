import { delegateWaitingRoomMemberOnEnterAbility } from '../../src/application/card-effects/workflows/shared/activate-waiting-room-member-on-enter-ability';
import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_AD1_001_ON_ENTER_DISCARD_RECOVER_ALL_OR_ORANGE_LIVE_ABILITY_ID as ENTER,
  PL_AD1_001_LIVE_START_WAITING_ORANGE_TO_FIFTH_ABILITY_ID as START,
} from '../../src/application/card-effects/ability-ids';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import {
  createCardInstance,
  createHeartRequirement,
  type BladeHearts,
  type LiveCardData,
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
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
  createLiveStartEvent,
} from '../../src/domain/events/game-events';
import {
  BladeHeartEffect as B,
  CardType,
  FaceState,
  GamePhase,
  HeartColor as H,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition as T,
  ZoneType,
} from '../../src/shared/types/enums';
import { S_BP7_005_ACTIVATED_DISCARD_TWO_DELEGATE_TWO_ON_ENTER_ABILITY_ID as COPY } from '../../src/application/card-effects/ability-ids';
import { createNovember07DraftCard } from '../helpers/november-07-draft-effects';
import {
  getStageMemberDelegatableOnEnterDefinitions,
  getWaitingRoomDelegatableOnEnterDefinitions,
} from '../../src/application/card-effects/runtime/delegatable-definitions';
import { createNovember10OrangeCard } from '../helpers/november-10-orange-effects';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { createGameSession } from '../../src/application/game-session';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
const P = 'p1';
const ORANGE: BladeHearts = [{ effect: B.HEART, heartColor: H.ORANGE }];
function live(id: string, bladeHearts: BladeHearts) {
  const data: LiveCardData = {
    cardType: CardType.LIVE,
    cardCode: `TEST-${id}`,
    name: id,
    score: 1,
    requirements: createHeartRequirement({}),
    bladeHearts,
  };
  return createCardInstance(data, P, id);
}
function setup(deckCount = 8): GameState {
  const orangeMemberData: MemberCardData = {
    cardType: CardType.MEMBER,
    cardCode: 'TEST-ORANGE-MEMBER',
    name: 'Orange Member',
    cost: 1,
    blade: 1,
    hearts: [],
    bladeHearts: ORANGE,
  };
  let game = registerCards(createGameState('honoka', P, 'P1', 'p2', 'P2'), [
    createNovember10OrangeCard('PL!-ad1-001', P, 'source'),
    createCardInstance(orangeMemberData, P, 'orange-member'),
    live('orange', ORANGE),
    live('all', [{ effect: B.HEART, heartColor: H.RAINBOW }]),
    live('gray', [{ effect: B.HEART, heartColor: H.GRAY }]),
    live('none', []),
    ...Array.from({ length: 8 }, (_, i) => live(`deck-${i}`, [])),
  ]);
  game = updatePlayer(game, P, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source'),
    hand: { ...p.hand, cardIds: ['none'] },
    waitingRoom: { ...p.waitingRoom, cardIds: ['orange', 'all', 'gray', 'orange-member'] },
    mainDeck: { ...p.mainDeck, cardIds: Array.from({ length: deckCount }, (_, i) => `deck-${i}`) },
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
function enter(game = setup()) {
  return resolvePendingCardEffects(enqueueTriggeredCardEffects(game, [T.ON_ENTER_STAGE])).gameState;
}
function start(game = setup()) {
  const event = createLiveStartEvent(P, []);
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(emitGameEvent(game, event), [T.ON_LIVE_START], {
      liveStartEvents: [event],
    })
  ).gameState;
}
function confirm(game: GameState, id?: string | null) {
  return confirmActiveEffectStep(game, P, game.activeEffect!.id, id);
}
function afterPublic(game: GameState) {
  return confirmActiveEffectStepThroughPublicReveal(game, P, game.activeEffect!.id);
}

describe('PL!-ad1-001 费用11「高坂穗乃果」', () => {
  it.each(['orange', 'all'])(
    'pays optional discard then mandatorily recovers printed %s LIVE after public display',
    (target) => {
      const open = enter();
      expect(open.activeEffect).toMatchObject({
        abilityId: ENTER,
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        autoSubmitSingleSelection: true,
      });
      expect(confirm(open, 'illegal')).toBe(open);
      expect(confirm(open, null).players[0].hand.cardIds).toEqual(['none']);
      const paid = confirm(open, 'none');
      expect(paid.players[0].waitingRoom.cardIds).toContain('none');
      expect(paid.activeEffect?.selectableCardIds).toEqual(['orange', 'all']);
      expect(paid.activeEffect).toMatchObject({
        canSkipSelection: false,
        autoSubmitSingleSelection: true,
      });
      expect(confirm(paid, null)).toBe(paid);
      const publicView = confirm(paid, target);
      expect(publicView.activeEffect?.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
      expect(publicView.players[0].hand.cardIds).toEqual([]);
      expect(publicView.players[0].waitingRoom.cardIds).toContain(target);
      const done = afterPublic(publicView);
      expect(done.players[0].hand.cardIds).toEqual([target]);
      expect(done.activeEffect).toBeNull();
      expect(
        done.actionHistory.filter((a) => a.type === 'PAY_COST' && a.payload.abilityId === ENTER)
      ).toHaveLength(1);
    }
  );
  it('offers and pays a legal cost with no recovery target, including recovery of the discarded LIVE itself', () => {
    const none = enter(
      updatePlayer(setup(), P, (p) => ({ ...p, waitingRoom: { ...p.waitingRoom, cardIds: [] } }))
    );
    const paid = confirm(none, 'none');
    expect(paid.activeEffect).toBeNull();
    expect(paid.players[0].waitingRoom.cardIds).toEqual(['none']);
    const self = enter(
      updatePlayer(setup(), P, (p) => ({
        ...p,
        hand: { ...p.hand, cardIds: ['orange'] },
        waitingRoom: { ...p.waitingRoom, cardIds: [] },
      }))
    );
    expect(confirm(self, 'orange').activeEffect?.selectableCardIds).toEqual(['orange']);
  });
  it('finishes an independent recovery when its source leaves and re-enters before payment', () => {
    let game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      enter(),
      P,
      'source',
      enqueueTriggeredCardEffects
    )!.gameState;
    game = updatePlayer(game, P, (p) => ({
      ...p,
      waitingRoom: {
        ...p.waitingRoom,
        cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'source'),
      },
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'source'),
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P, P)
    );
    const paid = confirm(game, 'none');
    const done = confirmActiveEffectStepThroughPublicReveal(paid, P, paid.activeEffect!.id, 'all');
    expect(done.players[0].hand.cardIds).toEqual(['all']);
  });
  it('does not recover a replaced waiting-room object after it leaves and re-enters during the public display', () => {
    let shown = confirm(confirm(enter(), 'none'), 'orange');
    shown = emitGameEvent(shown, createEnterWaitingRoomEvent(['orange'], ZoneType.HAND, P, P));
    const done = afterPublic(shown);
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(done.players[0].waitingRoom.cardIds).toContain('none');
  });
  it.each([0, 2, 4, 8])(
    'places any printed orange card in fifth position with deck length %i',
    (count) => {
      const open = start(setup(count));
      expect(open.activeEffect).toMatchObject({
        abilityId: START,
        canSkipSelection: false,
        selectableCardMode: 'SINGLE',
        autoSubmitSingleSelection: true,
      });
      expect(open.activeEffect?.selectableCardIds).toEqual(['orange', 'orange-member']);
      expect(confirm(open, null)).toBe(open);
      expect(confirm(open, 'all')).toBe(open);
      const shown = confirm(open, 'orange-member');
      expect(shown.activeEffect?.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
      expect(shown.players[0].waitingRoom.cardIds).toContain('orange-member');
      expect(shown.players[0].mainDeck.cardIds).not.toContain('orange-member');
      const done = afterPublic(shown);
      expect(done.players[0].mainDeck.cardIds[Math.min(4, count)]).toBe('orange-member');
      expect(done.activeEffect).toBeNull();
      expect(
        done.eventLog
          .filter(({ event }) => event.eventType === T.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK)
          .at(-1)?.event
      ).toMatchObject({
        movedCardIds: ['orange-member'],
        destination: { kind: 'POSITION', positionFromTop: 5, insertIndex: Math.min(4, count) },
      });
    }
  );
  it('rechecks fifth-position targets after public display and continues pending effects without moving a re-entered object', () => {
    let shown = confirm(start(), 'orange');
    shown = emitGameEvent(shown, createEnterWaitingRoomEvent(['orange'], ZoneType.HAND, P, P));
    const refreshed = afterPublic(shown);
    expect(refreshed.activeEffect?.selectableCardIds).toEqual(['orange-member']);
    expect(refreshed.players[0].mainDeck.cardIds).not.toContain('orange');
    const done = confirmActiveEffectStepThroughPublicReveal(
      refreshed,
      P,
      refreshed.activeEffect!.id,
      'orange-member'
    );
    expect(done.players[0].mainDeck.cardIds[4]).toBe('orange-member');
  });
  it('uses normal confirmation for no target and handles an empty hand without charging a cost', () => {
    const open = start(
      updatePlayer(setup(), P, (p) => ({
        ...p,
        waitingRoom: { ...p.waitingRoom, cardIds: ['all'] },
      }))
    );
    expect(open.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(confirm(open).activeEffect).toBeNull();
    const noHand = enter(
      updatePlayer(setup(), P, (p) => ({ ...p, hand: { ...p.hand, cardIds: [] } }))
    );
    expect(noHand.activeEffect).toBeNull();
    expect(noHand.actionHistory.some((a) => a.type === 'PAY_COST')).toBe(false);
  });
  it('exposes generic delegation while keeping Muse outside You’s Aqours target restriction', () => {
    expect(
      getWaitingRoomDelegatableOnEnterDefinitions('PL!-ad1-001-FUTURE').map((d) => d.abilityId)
    ).toEqual([ENTER]);
    expect(
      getStageMemberDelegatableOnEnterDefinitions('PL!-ad1-001-AD', SlotPosition.RIGHT).map(
        (d) => d.abilityId
      )
    ).toEqual([ENTER]);
    const you = createNovember07DraftCard('PL!S-bp7-005', P, 'you');
    let game = updatePlayer(registerCards(setup(), [you]), P, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: ['none', 'gray'] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'you'),
        SlotPosition.RIGHT,
        'source'
      ),
    }));
    game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
    expect(activateCardAbility(game, P, 'you', COPY)).toBe(game);
    game = updatePlayer(setup(), P, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [...p.waitingRoom.cardIds, 'source'] },
      memberSlots: {
        ...p.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
      },
    }));
    const delegated = delegateWaitingRoomMemberOnEnterAbility(
      game,
      {
        controllerId: P,
        parentAbilityId: 'parent',
        parentSourceCardId: 'parent-source',
        parentEffectId: 'parent-effect',
        targetCardId: 'source',
        delegatedAbilityId: ENTER,
        orderedResolution: false,
      },
      (state, ability) =>
        resolvePendingCardEffects({
          ...state,
          pendingAbilities: [...state.pendingAbilities, ability],
        }).gameState
    );
    expect(delegated.activeEffect).toMatchObject({
      abilityId: ENTER,
      sourceCardId: 'source',
      canSkipSelection: true,
    });
    const paid = confirm(delegated, 'none');
    const done = confirmActiveEffectStepThroughPublicReveal(paid, P, paid.activeEffect!.id, 'all');
    expect(done.players[0].hand.cardIds).toEqual(['all']);
    expect(done.players[0].waitingRoom.cardIds).toContain('source');
    expect(done.activeEffect).toBeNull();
  });
  it('pays the rule-mode entry cost and exposes real single-card actions, then restores the public selection exactly once', () => {
    const energies = Array.from({ length: 11 }, (_, i) =>
      createCardInstance(
        { cardType: CardType.ENERGY, cardCode: `E-${i}`, name: 'Energy' },
        P,
        `energy-${i}`
      )
    );
    let game = updatePlayer(registerCards(setup(), energies), P, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: ['source', 'none'] },
      memberSlots: {
        ...p.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map(),
      },
      energyZone: {
        ...p.energyZone,
        cardIds: energies.map((c) => c.instanceId),
        cardStates: new Map(
          energies.map((c) => [
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
    session.createGame('honoka-rules', P, 'P1', 'p2', 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;
    expect(
      session.executeCommand(createPlayMemberToSlotCommand(P, 'source', SlotPosition.CENTER))
        .success
    ).toBe(true);
    expect(
      [...session.state!.players[0].energyZone.cardStates.values()].filter(
        (s) => s.orientation === OrientationState.WAITING
      )
    ).toHaveLength(11);
    expect(projectPlayerViewState(session.state!, P).activeEffect).toMatchObject({
      selectableObjectIds: [createPublicObjectId('none')],
      autoSubmitSingleSelection: true,
      canSkipSelection: true,
    });
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P, session.state!.activeEffect!.id, 'none')
      ).success
    ).toBe(true);
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P, effectId, 'orange')).success
    ).toBe(true);
    const deadline = session.state!.activeEffect!.publicCardSelectionAutoAdvanceAt!;
    for (const viewer of [P, 'p2'])
      expect(projectPlayerViewState(session.state!, viewer, { now }).activeEffect).toMatchObject({
        revealedObjectIds: [createPublicObjectId('orange')],
        publicCardSelectionAutoAdvanceAfterMs: 2_000,
      });
    expect(session.state!.players[0].hand.cardIds).toEqual([]);
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand('p2', effectId, deadline))
        .success
    ).toBe(false);
    now = deadline;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand('p2', effectId, deadline))
        .success
    ).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(['orange']);
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P, effectId, deadline))
        .success
    ).toBe(false);
  });
});
