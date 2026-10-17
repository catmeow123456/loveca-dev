import { describe, expect, it } from 'vitest';
import { createCardInstance, type MemberCardData } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import { createPlayMemberAction } from '../../src/application/actions';
import {
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { queryNormalMemberPlay } from '../../src/application/normal-member-play';
import { projectPlayerViewState } from '../../src/online/projector';
import { HS_BP8_005_NO_OTHER_DOLLCHESTRA_SEND_SELF_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const INCOMING = 'incoming';
const OLD = 'old';
const KOSUZU = 'kosuzu';
const active = { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };

function member(cardCode: string, cost: number, unitName = 'DOLLCHESTRA'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost,
    unitName,
    blade: 1,
    hearts: [],
  };
}

function fixture(
  options: {
    energy?: number;
    incomingCost?: number;
    oldCost?: number;
    oldCode?: string;
    incomingUnit?: string;
    emptySlot?: boolean;
  } = {}
) {
  const energy = Array.from({ length: options.energy ?? 10 }, (_, index) =>
    createCardInstance(
      { cardCode: 'TEST-energy', name: 'Energy', cardType: CardType.ENERGY },
      P1,
      `e${index}`
    )
  );
  const cards = [
    createCardInstance(
      member('TEST-new-DC', options.incomingCost ?? 8, options.incomingUnit),
      P1,
      INCOMING
    ),
    createCardInstance(member(options.oldCode ?? 'TEST-old-DC', options.oldCost ?? 6), P1, OLD),
    createCardInstance(member('PL!HS-bp8-005-P', 0), P1, KOSUZU),
    createCardInstance(member('TEST-deck1', 1), P1, 'deck1'),
    createCardInstance(member('TEST-deck2', 1), P2, 'deck2'),
    ...energy,
  ];
  let state = registerCards(createGameState('overwrite', P1, 'P1', P2, 'P2'), cards);
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    turnCount: 3,
  };
  state = updatePlayer(state, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [INCOMING] },
    mainDeck: { ...player.mainDeck, cardIds: ['deck1'] },
    memberSlots: placeCardInSlot(
      options.emptySlot
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.LEFT, OLD, active),
      SlotPosition.CENTER,
      KOSUZU,
      active
    ),
    energyZone: {
      ...player.energyZone,
      cardIds: energy.map((card) => card.instanceId),
      cardStates: new Map(energy.map((card) => [card.instanceId, active])),
    },
  }));
  state = updatePlayer(state, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: ['deck2'] },
  }));
  const session = createGameSession();
  session.createGame('overwrite', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function overwriteOptions(state: GameState, playerId = P1): unknown[] {
  const view = projectPlayerViewState(state, playerId);
  const hint = view.permissions.availableCommands.find(
    (item) => item.command === GameCommandType.PLAY_MEMBER_TO_SLOT
  );
  return (hint?.params?.memberOverwriteOptions ?? []) as unknown[];
}

describe('normal member overwrite payment and cost 0 Kosuzu', () => {
  it('honors explicit NONE in the underlying play action without a separate isRelay override', () => {
    const result = new GameService().processAction(
      fixture().state!,
      createPlayMemberAction(P1, INCOMING, SlotPosition.LEFT, { relayMode: 'NONE' })
    );
    expect(result.success).toBe(true);
    expect(result.gameState.players[0].waitingRoom.cardIds).toEqual([OLD]);
    expect(result.gameState.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(KOSUZU);
    expect(
      result.gameState.actionHistory.find((entry) => entry.type === 'PLAY_MEMBER')?.payload.isRelay
    ).toBe(false);
  });

  it.each([
    { mode: undefined, isRelay: true, paid: 2 },
    { mode: 'SINGLE' as const, isRelay: true, paid: 2 },
    { mode: 'NONE' as const, isRelay: false, paid: 8 },
  ])(
    'DC over DC via $mode pays $paid and Kosuzu leaves only for relay',
    ({ mode, isRelay, paid }) => {
      const session = fixture();
      const result = session.executeCommand(
        createPlayMemberToSlotCommand(P1, INCOMING, SlotPosition.LEFT, { relayMode: mode })
      );
      expect(result.success, result.error).toBe(true);
      const state = session.state!;
      const player = state.players[0];
      expect(player.hand.cardIds).not.toContain(INCOMING);
      expect(player.memberSlots.slots[SlotPosition.LEFT]).toBe(INCOMING);
      expect(player.waitingRoom.cardIds).toEqual(isRelay ? [OLD, KOSUZU] : [OLD]);
      expect(player.memberSlots.slots[SlotPosition.CENTER]).toBe(isRelay ? null : KOSUZU);
      expect(
        [...player.energyZone.cardStates.values()].filter(
          (entry) => entry.orientation === OrientationState.WAITING
        )
      ).toHaveLength(paid);
      expect(
        state.actionHistory.find((entry) => entry.type === 'PLAY_MEMBER')?.payload.isRelay
      ).toBe(isRelay);
      expect(
        state.actionHistory.filter(
          (entry) =>
            entry.type === 'TRIGGER_ABILITY' &&
            entry.payload.abilityId === HS_BP8_005_NO_OTHER_DOLLCHESTRA_SEND_SELF_ABILITY_ID
        )
      ).toHaveLength(isRelay ? 1 : 0);
      const enterIndex = state.eventLog.findIndex(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE && event.cardInstanceId === INCOMING
      );
      const leaveIndex = state.eventLog.findIndex(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_LEAVE_STAGE && event.cardInstanceId === OLD
      );
      expect(enterIndex).toBeGreaterThanOrEqual(0);
      expect(leaveIndex).toBeGreaterThanOrEqual(0);
      expect(leaveIndex < enterIndex).toBe(isRelay);
      const enterEvent = state.eventLog[enterIndex]!.event;
      expect(enterEvent).toMatchObject({
        relayReplacements: isRelay
          ? [{ cardId: OLD, slot: SlotPosition.LEFT, effectiveCost: 6 }]
          : undefined,
      });
      expect(state.activeEffect).toBeNull();
      expect(state.pendingAbilities).toHaveLength(0);
    }
  );

  it.each(['SINGLE', 'NONE'] as const)(
    'still self-sends when a non-DC covers the only partner using %s',
    (relayMode) => {
      const session = fixture({ incomingUnit: 'みらくらぱーく！' });
      expect(
        session.executeCommand(
          createPlayMemberToSlotCommand(P1, INCOMING, SlotPosition.LEFT, { relayMode })
        ).success
      ).toBe(true);
      expect(session.state!.players[0].waitingRoom.cardIds).toContain(KOSUZU);
    }
  );

  it('rejects unaffordable full payment atomically instead of falling back to relay', () => {
    const session = fixture({ energy: 2 });
    const before = session.state!;
    expect(
      queryNormalMemberPlay(before, {
        playerId: P1,
        cardId: INCOMING,
        targetSlot: SlotPosition.LEFT,
      }).ok
    ).toBe(true);
    expect(
      session.executeCommand(
        createPlayMemberToSlotCommand(P1, INCOMING, SlotPosition.LEFT, { relayMode: 'NONE' })
      ).success
    ).toBe(false);
    expect(session.state).toEqual(before);
    expect(overwriteOptions(before)).toEqual([]);
  });

  it('permits an explicit zero-cost ordinary overwrite, with no relay trigger or Kosuzu gap', () => {
    const session = fixture({ incomingCost: 0, energy: 0 });
    expect(overwriteOptions(session.state!)).toEqual([]);
    expect(
      session.executeCommand(
        createPlayMemberToSlotCommand(P1, INCOMING, SlotPosition.LEFT, { relayMode: 'NONE' })
      ).success
    ).toBe(true);
    expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(KOSUZU);
    expect(
      session.state!.actionHistory.find((entry) => entry.type === 'PLAY_MEMBER')?.payload.isRelay
    ).toBe(false);
  });

  it('projects both affordable plans to the actor, never the opponent; equal costs remain separate', () => {
    const state = fixture({ oldCost: 0 }).state!;
    expect(overwriteOptions(state)).toContainEqual({
      sourceObjectId: 'obj_incoming',
      targetSlot: SlotPosition.LEFT,
      targetObjectId: 'obj_old',
      choices: [
        { relayMode: 'SINGLE', energyCost: 8 },
        { relayMode: 'NONE', energyCost: 8 },
      ],
    });
    expect(overwriteOptions(state, P2)).toEqual([]);
    expect(
      queryNormalMemberPlay(state, {
        playerId: P1,
        cardId: INCOMING,
        targetSlot: SlotPosition.LEFT,
      })
    ).toMatchObject({ ok: true, plan: { isRelay: true } });
    expect(overwriteOptions({ ...state, manualOperationMode: 'FREE' })).toEqual([]);
  });

  it.each(['LL-bp2-001-R+', 'PL!HS-bp6-006-P'])(
    'offers no two-way choice when %s cannot be relayed away',
    (oldCode) => {
      const state = fixture({ oldCode }).state!;
      expect(
        overwriteOptions(state).some(
          (option) => (option as { targetSlot: SlotPosition }).targetSlot === SlotPosition.LEFT
        )
      ).toBe(false);
      expect(
        queryNormalMemberPlay(state, {
          playerId: P1,
          cardId: INCOMING,
          targetSlot: SlotPosition.LEFT,
        })
      ).toMatchObject({ ok: true, plan: { isRelay: false } });
    }
  );

  it('does not project overwrite alternatives for an empty slot', () => {
    expect(
      overwriteOptions(fixture({ emptySlot: true }).state!).some(
        (option) => (option as { targetSlot: SlotPosition }).targetSlot === SlotPosition.LEFT
      )
    ).toBe(false);
  });

  it('revalidates the selected mode after the target becomes relay-protected', () => {
    const session = fixture();
    expect(overwriteOptions(session.state!).length).toBeGreaterThan(0);
    const state = session.state!;
    const registry = new Map(state.cardRegistry);
    registry.set(OLD, { ...registry.get(OLD)!, data: member('LL-bp2-001-R+', 6) });
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...state,
      cardRegistry: registry,
    };
    const before = session.state!;
    expect(
      session.executeCommand(
        createPlayMemberToSlotCommand(P1, INCOMING, SlotPosition.LEFT, { relayMode: 'SINGLE' })
      ).success
    ).toBe(false);
    expect(session.state).toEqual(before);
  });
});
