import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_PB2_002_ACTIVATED_BOTTOM_AQOURS_LIVES_ACTIVATE_ENERGY_ABILITY_ID as RIKO,
  S_PB2_006_ON_ENTER_OPPONENT_HAND_TWO_TO_DECK_EDGE_ABILITY_ID as YOSHIKO,
  S_PB2_026_ON_ENTER_BOTTOM_THREE_GUILTY_KISS_WAIT_OPPONENT_ABILITY_ID as MARI,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { delegateWaitingRoomMemberOnEnterAbility } from '../../src/application/card-effects/workflows/shared/activate-waiting-room-member-on-enter-ability';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance } from '../../src/domain/entities/card';
import { emitGameEvent, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createEnterStageEvent,
  createEnterWaitingRoomEvent,
} from '../../src/domain/events/game-events';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GameMode,
  GamePhase,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { gameWithCards, live, member, P1, P2 } from '../helpers/card-effect-zone-fixture';
import { getNovember27MemberData } from '../helpers/november-27-draft-effects';

const RIKO_CODE = 'PL!S-pb2-002';
const YOSHIKO_CODE = 'PL!S-pb2-006';
const MARI_CODE = 'PL!S-pb2-026';
const SOURCE = 'new-source';
const CENTER = SlotPosition.CENTER;
const ACTIVE = OrientationState.ACTIVE;
const WAITING = OrientationState.WAITING;
const FACE_UP = { face: FaceState.FACE_UP, orientation: ACTIVE };
const HIS_HAND = ['secret-1', 'secret-2', 'secret-3', 'secret-4', 'secret-5', 'secret-6'];

function energy(id: string) {
  return createCardInstance({ cardType: CardType.ENERGY, cardCode: id, name: id }, P1, id);
}

function waitingMember(id: string, name: string, unitName = 'Guilty Kiss') {
  return member(id, { name, nameJp: name, unitName, groupNames: ['Aqours'] });
}

function setup(
  code: string,
  waiting: readonly string[],
  options: { handCount?: number; withoutTarget?: boolean; energyCount?: number } = {}
): GameState {
  const energies = Array.from({ length: options.energyCount ?? 3 }, (_entry, index) =>
    energy(`e${index}`)
  );
  const cards = [
    member(SOURCE, getNovember27MemberData(code)),
    member('own-deck'),
    member('opponent-deck', {}, P2),
    ...HIS_HAND.map((id) => member(id, {}, P2)),
    live('a', { groupNames: ['Aqours'] }),
    live('b', { groupNames: ['Aqours'] }),
    live('other-live', { groupNames: ['Liella!'] }),
    waitingMember('rikom', '桜内梨子'),
    waitingMember('other-riko', '樱内梨子'),
    waitingMember('mari', '小原鞠莉'),
    waitingMember('yoshiko', '津島善子'),
    waitingMember('other-member', '渡辺曜', 'CYaRon！'),
    member('low', { blade: 2 }, P2),
    member('high', { blade: 3 }, P2),
    ...energies,
  ];
  const game = updatePlayer(gameWithCards(cards), P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, CENTER, SOURCE, FACE_UP),
    mainDeck: { ...player.mainDeck, cardIds: ['own-deck'] },
    waitingRoom: { ...player.waitingRoom, cardIds: waiting },
    energyZone: energies.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, { ...FACE_UP, orientation: WAITING }),
      player.energyZone
    ),
  }));
  return updatePlayer({ ...game, currentPhase: GamePhase.MAIN_PHASE }, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: ['opponent-deck'] },
    hand: { ...player.hand, cardIds: HIS_HAND.slice(0, options.handCount ?? 6) },
    memberSlots: placeCardInSlot(
      options.withoutTarget
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, CENTER, 'low', FACE_UP),
      SlotPosition.RIGHT,
      'high',
      FACE_UP
    ),
  }));
}

function sessionFrom(game: GameState, options: Parameters<typeof createGameSession>[0] = {}) {
  const session = createGameSession(options);
  session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
  return session;
}

function enter(game: GameState) {
  const event = createEnterStageEvent(SOURCE, ZoneType.HAND, CENTER, P1, P1);
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_ENTER_STAGE], {
      enterStageEvents: [event],
    })
  ).gameState;
}

function delegate(game: GameState, abilityId: string) {
  const offStage = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: removeCardFromSlot(player.memberSlots, CENTER),
    waitingRoom: { ...player.waitingRoom, cardIds: [SOURCE, ...player.waitingRoom.cardIds] },
  }));
  return delegateWaitingRoomMemberOnEnterAbility(
    offStage,
    {
      controllerId: P1,
      parentAbilityId: 'test-parent',
      parentSourceCardId: 'parent',
      parentEffectId: 'parent-effect',
      targetCardId: SOURCE,
      delegatedAbilityId: abilityId,
      orderedResolution: false,
    },
    (state, ability) =>
      resolvePendingCardEffects({
        ...state,
        pendingAbilities: [...state.pendingAbilities, ability],
      }).gameState
  );
}

function select(
  game: GameState,
  playerId = P1,
  options: { cards?: readonly string[]; option?: string; card?: string } = {}
) {
  return confirmActiveEffectStep(
    game,
    playerId,
    game.activeEffect!.id,
    options.card,
    undefined,
    undefined,
    options.option,
    options.cards
  );
}

function moves(game: GameState) {
  return game.eventLog
    .map(({ event }) => event)
    .filter(
      (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
}

function costRecords(game: GameState) {
  return game.actionHistory.filter((entry) => entry.type === 'PAY_COST');
}

function fullPublicFacts(session: ReturnType<typeof sessionFrom>) {
  return session.getPublicEventsSince(0).map(({ eventId, seq, timestamp, ...event }) => event);
}

describe('11/27 Aqours private ordering and costs', () => {
  it.each([
    [RIKO_CODE, RIKO],
    [YOSHIKO_CODE, YOSHIKO],
    [MARI_CODE, MARI],
  ])('registers the complete exported text for every rarity of %s', (base, abilityId) => {
    const text = getNovember27MemberData(base).cardTextCn;
    expect(text).toBeTruthy();
    for (const suffix of ['PP', 'R+', 'N']) {
      const [definition] = getCardAbilityDefinitionsForCardCode(`${base}-${suffix}`);
      expect(definition).toMatchObject({ abilityId, effectText: text });
      if (abilityId === RIKO) expect(definition?.activatedUi?.text).toBe(text);
    }
  });

  it('distinguishes Riko cancelling from an explicit zero-card activation with no targets', () => {
    const session = sessionFrom(setup(RIKO_CODE, ['other-live', 'rikom']));
    const activate = createActivateAbilityCommand(P1, SOURCE, RIKO);
    expect(session.executeCommand(activate).success).toBe(true);
    const first = session.state!.activeEffect!;
    expect(first).toMatchObject({ selectableCardIds: [], maxSelectableCards: 0 });
    expect(session.executeCommand(createConfirmEffectStepCommand(P1, first.id)).success).toBe(true);
    expect(costRecords(session.state!)).toEqual([]);
    expect(session.executeCommand(activate).success).toBe(true);
    const second = session.state!.activeEffect!;
    expect(second.id).not.toBe(first.id);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          second.id,
          undefined,
          undefined,
          undefined,
          undefined,
          []
        )
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(moves(session.state!)).toEqual([]);
    expect(costRecords(session.state!)).toHaveLength(1);
    expect(session.executeCommand(activate).success).toBe(false);
  });

  it('pays Riko’s selected LIVE cards before choosing special energy and retains exactly one payment', () => {
    let now = 1000;
    let game = setup(RIKO_CODE, ['a', 'other-live', 'b', 'rikom']);
    game = {
      ...game,
      energyActivePhaseSkips: [
        { playerId: P1, energyCardId: 'e0', sourceCardId: SOURCE, abilityId: 'skip' },
      ],
    };
    const session = sessionFrom(game, { now: () => now });
    expect(session.executeCommand(createActivateAbilityCommand(P1, SOURCE, RIKO)).success).toBe(
      true
    );
    const effect = session.state!.activeEffect!;
    expect(effect.selectableCardIds).toEqual(['a', 'b']);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, effect.id, undefined, undefined, undefined, undefined, [
          'b',
          'a',
        ])
      ).success
    ).toBe(true);
    const revealed = session.state!.activeEffect!;
    expect(revealed).toMatchObject({
      revealedCardIds: ['a', 'b'],
      publicCardSelectionOrdered: false,
    });
    expect(costRecords(session.state!)).toHaveLength(0);
    now = revealed.publicCardSelectionAutoAdvanceAt!;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, revealed.id, now))
        .success
    ).toBe(true);
    const selection = session.state!.activeEffect!;
    expect(selection).toMatchObject({ minSelectableCards: 2, maxSelectableCards: 2 });
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['own-deck', 'b', 'a']);
    expect(moves(session.state!)).toMatchObject([
      { movedCardIds: ['b', 'a'], cause: { abilityId: RIKO } },
    ]);
    expect(costRecords(session.state!)).toHaveLength(1);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          P1,
          selection.id,
          undefined,
          undefined,
          undefined,
          undefined,
          ['e0', 'e2']
        )
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.players[0].energyZone.cardStates.get('e0')?.orientation).toBe(ACTIVE);
    expect(session.state!.players[0].energyZone.cardStates.get('e1')?.orientation).toBe(WAITING);
    expect(session.state!.players[0].energyZone.cardStates.get('e2')?.orientation).toBe(ACTIVE);
    expect(costRecords(session.state!)).toHaveLength(1);
    expect(moves(session.state!)).toHaveLength(1);
  });

  it('does not pay a reentered Riko cost candidate or a replacement Riko object', () => {
    const session = sessionFrom(setup(RIKO_CODE, ['a', 'b']));
    expect(session.executeCommand(createActivateAbilityCommand(P1, SOURCE, RIKO)).success).toBe(
      true
    );
    const reveal = select(session.state!, P1, { cards: ['a'] });
    const staleTarget = emitGameEvent(
      reveal,
      createEnterWaitingRoomEvent(['a'], ZoneType.HAND, P1, P1)
    );
    const staleSource = emitGameEvent(
      reveal,
      createEnterStageEvent(SOURCE, ZoneType.HAND, CENTER, P1, P1)
    );
    for (const stale of [staleTarget, staleSource]) {
      const done = select(stale);
      expect(done.activeEffect).toBeNull();
      expect(done.players[0].waitingRoom.cardIds).toEqual(['a', 'b']);
      expect(moves(done)).toEqual([]);
      expect(costRecords(done)).toEqual([]);
    }
  });

  it('does not expose the resulting top of an empty deck when paying a private ordered cost', () => {
    const source = sessionFrom(setup(RIKO_CODE, ['a', 'b'], { energyCount: 0 }));
    expect(source.executeCommand(createActivateAbilityCommand(P1, SOURCE, RIKO)).success).toBe(
      true
    );
    const opened = updatePlayer(source.state!, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
      hand: { ...player.hand, cardIds: ['own-deck'] },
    }));
    const run = (ids: readonly string[]) => {
      let now = 1000;
      const session = sessionFrom(opened, { now: () => now });
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            P1,
            opened.activeEffect!.id,
            undefined,
            undefined,
            undefined,
            undefined,
            ids
          )
        ).success
      ).toBe(true);
      const reveal = session.state!.activeEffect!;
      now = reveal.publicCardSelectionAutoAdvanceAt!;
      expect(
        session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, reveal.id, now))
          .success
      ).toBe(true);
      expect(session.state!.players[0].mainDeck.cardIds).toEqual(ids);
      expect(session.state!.activeEffect).toBeNull();
      const events = fullPublicFacts(session);
      const transfers = events.filter((event) => event.type === 'CardMovedPublic');
      expect(transfers).toHaveLength(2);
      for (const transfer of transfers) expect(transfer).not.toHaveProperty('to.index');
      return events;
    };
    expect(run(['a', 'b'])).toEqual(run(['b', 'a']));
  });

  it('checks Yoshiko’s six-card threshold at resolution and can be delegated without entering stage', () => {
    expect(enter(setup(YOSHIKO_CODE, [], { handCount: 5 })).activeEffect).toBeNull();
    const game = delegate(setup(YOSHIKO_CODE, []), YOSHIKO);
    expect(game.activeEffect).toMatchObject({
      abilityId: YOSHIKO,
      controllerId: P1,
      awaitingPlayerId: P2,
    });
    expect(
      game.eventLog.some(({ event }) => event.eventType === TriggerCondition.ON_ENTER_STAGE)
    ).toBe(false);
  });

  it.each([true, false])(
    'allows only the opponent to privately order two into one chosen end (nonempty deck: %s)',
    (nonemptyDeck) => {
      const started = enter(setup(YOSHIKO_CODE, []));
      const deck = nonemptyDeck ? ['opponent-deck'] : [];
      const opened = updatePlayer(started, P2, (player) => ({
        ...player,
        mainDeck: { ...player.mainDeck, cardIds: deck },
      }));
      const run = (position: 'TOP' | 'BOTTOM', ids: readonly string[]) => {
        const session = sessionFrom(opened);
        const effectId = session.state!.activeEffect!.id;
        const edge = (playerId: string) =>
          createConfirmEffectStepCommand(
            playerId,
            effectId,
            undefined,
            undefined,
            undefined,
            position
          );
        expect(session.executeCommand(edge(P1)).success).toBe(false);
        expect(session.executeCommand(edge(P2)).success).toBe(true);
        const state = session.state!;
        const publicView = projectPlayerViewState(state, P1);
        const privateView = projectPlayerViewState(state, P2);
        expect(publicView.activeEffect?.selectableObjectIds).toBeUndefined();
        expect(privateView.activeEffect?.selectableObjectIds).toEqual(
          HIS_HAND.map(createPublicObjectId)
        );
        expect(JSON.stringify(publicView.activeEffect)).not.toContain(position);
        const confirm = (playerId: string, cards: readonly string[]) =>
          createConfirmEffectStepCommand(
            playerId,
            effectId,
            undefined,
            undefined,
            undefined,
            undefined,
            cards
          );
        for (const invalid of [
          confirm(P1, ids),
          confirm(P2, ['secret-1']),
          confirm(P2, ['secret-1', 'secret-1']),
          confirm(P2, ['own-deck', 'secret-1']),
          { ...confirm(P2, ids), selectedOptionId: position },
        ])
          expect(session.executeCommand(invalid).success).toBe(false);
        expect(session.executeCommand(confirm(P2, ids)).success).toBe(true);
        expect(session.state!.players[1].mainDeck.cardIds).toEqual(
          position === 'TOP' ? [...ids, ...deck] : [...deck, ...ids]
        );
        expect(session.state!.players[1].hand.cardIds).toEqual(
          HIS_HAND.filter((id) => !ids.includes(id))
        );
        expect(session.state!.activeEffect).toBeNull();
        const events = fullPublicFacts(session);
        expect(JSON.stringify(events)).not.toContain('secret-');
        const after = projectPlayerViewState(session.state!, P1);
        return {
          visibleEffect: publicView.activeEffect,
          events,
          opponentHand: after.table.zones.SECOND_HAND,
          opponentDeck: after.table.zones.SECOND_MAIN_DECK,
        };
      };
      const top = run('TOP', ['secret-5', 'secret-2']);
      expect(top).toEqual(run('TOP', ['secret-2', 'secret-5']));
      expect(top).toEqual(run('BOTTOM', ['secret-2', 'secret-5']));
    }
  );

  it('uses the existing tokenized solitaire decision for Yoshiko without writing private hand IDs into its command log', () => {
    const session = sessionFrom(enter(setup(YOSHIKO_CODE, [])), { gameMode: GameMode.SOLITAIRE });
    (session as unknown as { runModeAutomationLoop(playerId: string): void }).runModeAutomationLoop(
      P1
    );
    expect(session.state!.activeEffect).toBeNull();
    const log = session.getCommandLogSince(0).filter((entry) => entry.playerId === P2);
    expect(log).toHaveLength(2);
    expect(log[1]?.payload).toMatchObject({ selectedCardIds: ['blind-card-0', 'blind-card-1'] });
    expect(JSON.stringify(log)).not.toContain('secret-');
  });

  it('rejects same-name Mari selections before display and waits a legal opponent member only after full payment', () => {
    const started = enter(
      setup(MARI_CODE, ['rikom', 'other-riko', 'mari', 'yoshiko', 'other-member'])
    );
    expect(started.activeEffect?.selectableCardIds).toEqual([
      'rikom',
      'other-riko',
      'mari',
      'yoshiko',
    ]);
    expect(select(started, P1, { cards: ['rikom', 'other-riko', 'mari'] })).toBe(started);
    expect(costRecords(select(started))).toEqual([]);
    const reveal = select(started, P1, { cards: ['yoshiko', 'mari', 'rikom'] });
    expect(reveal.activeEffect).toMatchObject({
      revealedCardIds: ['mari', 'rikom', 'yoshiko'],
      publicCardSelectionOrdered: false,
    });
    expect(costRecords(reveal)).toHaveLength(0);
    const paid = select(reveal);
    expect(paid.players[0].mainDeck.cardIds).toEqual(['own-deck', 'yoshiko', 'mari', 'rikom']);
    expect(paid.activeEffect?.selectableCardIds).toEqual(['low']);
    expect(paid.players[1].memberSlots.cardStates.get('low')?.orientation).toBe(ACTIVE);
    const done = select(paid, P1, { card: 'low' });
    expect(done.players[1].memberSlots.cardStates.get('low')?.orientation).toBe(WAITING);
    expect(done.eventLog).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: TriggerCondition.ON_MEMBER_STATE_CHANGED,
          cardInstanceId: 'low',
        }),
      })
    );
    expect(costRecords(done)).toHaveLength(1);
    expect(moves(done)).toHaveLength(1);
  });

  it('keeps Mari’s delegated cost when there is no target and avoids partial payment if a card becomes stale', () => {
    const ids = ['rikom', 'mari', 'yoshiko'];
    const game = delegate(setup(MARI_CODE, ids, { withoutTarget: true }), MARI);
    const reveal = select(game, P1, { cards: ids });
    const stale = emitGameEvent(
      reveal,
      createEnterWaitingRoomEvent(['mari'], ZoneType.MAIN_DECK, P1, P1)
    );
    expect(costRecords(select(stale))).toEqual([]);
    const done = select(reveal);
    expect(done.players[0].waitingRoom.cardIds).toEqual([SOURCE]);
    expect(done.players[0].mainDeck.cardIds).toEqual(['own-deck', ...ids]);
    expect(done.activeEffect).toBeNull();
    expect(moves(done)).toHaveLength(1);
    expect(costRecords(done)).toHaveLength(1);
  });

  it('checks original Blade replacement for Mari and keeps payment when the selected target reenters', () => {
    const ids = ['rikom', 'mari', 'yoshiko'];
    let scene = setup(MARI_CODE, ids);
    scene = addLiveModifier(scene, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: P2,
      sourceCardId: 'high',
      memberCardId: 'high',
      abilityId: 'original-low',
      count: 2,
    });
    scene = addLiveModifier(scene, {
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: P2,
      sourceCardId: 'high',
      abilityId: 'ordinary-plus',
      countDelta: 10,
    });
    const paid = select(select(enter(scene), P1, { cards: ids }));
    expect(paid.activeEffect?.selectableCardIds).toEqual(['low', 'high']);
    const reentered = emitGameEvent(
      paid,
      createEnterStageEvent('high', ZoneType.HAND, SlotPosition.RIGHT, P2, P2)
    );
    const done = select(reentered, P1, { card: 'high' });
    expect(done.players[1].memberSlots.cardStates.get('high')?.orientation).toBe(ACTIVE);
    expect(done.players[0].mainDeck.cardIds).toEqual(['own-deck', ...ids]);
    expect(costRecords(done)).toHaveLength(1);
    expect(done.activeEffect).toBeNull();
  });
});
