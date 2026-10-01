import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import {
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_PB2_013_ON_ENTER_REVEAL_FOUR_ALL_LILY_WHITE_RECOVER_LIVE_ABILITY_ID as ABILITY_ID,
  N_BP7_011_AUTO_DECK_TO_WAITING_DISCARD_ONE_RECOVER_SELF_ABILITY_ID as DECK_OBSERVER,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { moveRevealedTopDeckSelectionToHandRestToWaitingRoomAndEnqueueTriggers } from '../../src/application/card-effects/runtime/main-deck-waiting-room-triggers';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createPublicObjectId } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';
const P1 = 'p1',
  P2 = 'p2';
const TEXT =
  '【登场】公开自己的卡组顶的4张卡片。那些卡片全部是『lily white』的卡片的场合，从公开的卡片中将1张『lily white』的LIVE卡加入手牌，其余的放置入休息室。';
function member(code: string, unit = 'lily white', cost = 1): MemberCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
    unitName: unit,
    groupNames: ["μ's"],
  };
}
function live(code: string, unit = 'lilywhite'): AnyCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({}),
    unitName: unit,
  };
}
function setup(
  options: {
    code?: string;
    top?: readonly AnyCardData[];
    waiting?: readonly AnyCardData[];
    tail?: boolean;
    triggerCard?: boolean;
  } = {}
) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('umi-pb2', P1, 'P1', P2, 'P2');
  const source = createCardInstance(
    { ...member(options.code ?? 'PL!-pb2-013-P+', 'lily white', 2), name: '園田海未' },
    P1,
    'umi'
  );
  const top = (
    options.top ?? [
      live('live-a'),
      member(options.triggerCard ? 'PL!N-bp7-011-R' : 'member-a'),
      live('live-b'),
      member('member-b'),
    ]
  ).map((data, i) => createCardInstance(data, P1, `top-${i}`));
  const tail =
    options.tail === false ? [] : [createCardInstance(member('private-tail', 'BiBi'), P1, 'tail')];
  const waiting = (options.waiting ?? []).map((data, i) =>
    createCardInstance(data, P1, `waiting-${i}`)
  );
  const discard = createCardInstance(member('discard', 'BiBi'), P1, 'discard');
  const energies = [0, 1].map((i) =>
    createCardInstance(
      { cardCode: `energy-${i}`, name: `energy-${i}`, cardType: CardType.ENERGY },
      P1,
      `energy-${i}`
    )
  );
  let game = registerCards(session.state!, [
    source,
    ...top,
    ...tail,
    ...waiting,
    discard,
    ...energies,
  ]);
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    mainDeck: [...top, ...tail].reduce((z, c) => addCardToZone(z, c.instanceId), p.mainDeck),
    waitingRoom: waiting.reduce((z, c) => addCardToZone(z, c.instanceId), p.waitingRoom),
    hand: [source, discard].reduce((z, c) => addCardToZone(z, c.instanceId), p.hand),
    energyZone: energies.reduce(
      (z, c) =>
        addCardToStatefulZone(z, c.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      p.energyZone
    ),
  }));
  const install = (state: GameState) => {
    (session as unknown as { authorityState: GameState }).authorityState = state;
  };
  install(game);
  return {
    session,
    source: source.instanceId,
    topIds: top.map((c) => c.instanceId),
    waitingIds: waiting.map((c) => c.instanceId),
    install,
    setNow(value: number) {
      now = value;
    },
  };
}
type Scenario = ReturnType<typeof setup>;
function play(s: Scenario) {
  return s.session.executeCommand(createPlayMemberToSlotCommand(P1, s.source, SlotPosition.CENTER));
}
function advanceCommand(s: Scenario) {
  const e = s.session.state!.activeEffect!;
  return createAutoAdvancePublicRevealCommand(
    P2,
    e.id,
    e.publicRevealAutoAdvanceAt!,
    e.publicRevealGeneration!
  );
}
function advance(s: Scenario) {
  const cmd = advanceCommand(s);
  s.setNow(s.session.state!.activeEffect!.publicRevealAutoAdvanceAt!);
  return s.session.executeCommand(cmd);
}
function select(s: Scenario, id: string | null) {
  return s.session.executeCommand(
    createConfirmEffectStepCommand(P1, s.session.state!.activeEffect!.id, id)
  );
}
function waitingEvents(s: Scenario) {
  return s.session
    .state!.eventLog.map((r) => r.event)
    .filter(
      (e) =>
        e.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM && e.fromZone === ZoneType.MAIN_DECK
    );
}
function refreshes(s: Scenario) {
  return s.session.state!.actionHistory.filter(
    (a) => a.type === 'RULE_ACTION' && a.payload.type === 'REFRESH'
  );
}

describe('PL!-pb2-013 费用2 园田海未', () => {
  it.each(['P+', 'R', 'SEC'])('registers full text and real ON_ENTER for rarity %s', (rare) => {
    expect(
      getCardAbilityDefinitionsForCardCode(`PL!-pb2-013-${rare}`).find(
        (d) => d.abilityId === ABILITY_ID
      )
    ).toMatchObject({
      effectText: TEXT,
      baseCardCodes: ['PL!-pb2-013'],
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
    });
    const s = setup({ code: `PL!-pb2-013-${rare}` });
    expect(play(s).success).toBe(true);
    expect(s.session.state!.activeEffect?.abilityId).toBe(ABILITY_ID);
  });
  it('reveals only the unchanged top four to both viewers until the shared deadline', () => {
    const s = setup();
    const deck = [...s.session.state!.players[0].mainDeck.cardIds];
    expect(play(s).success).toBe(true);
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(deck);
    expect(s.session.state!.inspectionZone.cardIds).toEqual([]);
    expect(s.session.state!.inspectionContext).toBeNull();
    expect(s.session.state!.activeEffect).toMatchObject({
      stepId: 'COMMON_PUBLIC_REVEAL_DWELL',
      revealedCardIds: s.topIds,
      publicRevealAutoAdvanceAt: 12_900,
    });
    expect(waitingEvents(s)).toEqual([]);
    expect(refreshes(s)).toEqual([]);
    for (const viewer of [P1, P2]) {
      const view = s.session.getPlayerViewState(viewer);
      for (const id of s.topIds)
        expect(view.objects[createPublicObjectId(id)]).toMatchObject({
          surface: 'FRONT',
          publiclyRevealed: true,
        });
      if (viewer === P1)
        expect(view.objects[createPublicObjectId('tail')]).toMatchObject({
          surface: 'BACK',
          frontInfo: undefined,
        });
      else expect(view.objects[createPublicObjectId('tail')]).toBeUndefined();
    }
    const cmd = advanceCommand(s);
    expect(s.session.executeCommand(cmd).success).toBe(false);
    expect(select(s, s.topIds[0]!).success).toBe(false);
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(deck);
    s.setNow(12_900);
    expect(s.session.executeCommand({ ...cmd, publicRevealGeneration: 'stale' }).success).toBe(
      false
    );
    expect(s.session.executeCommand(cmd).success).toBe(true);
    expect(s.session.executeCommand(cmd).success).toBe(false);
    expect(s.session.state!.activeEffect).toMatchObject({
      selectableCardIds: [s.topIds[0], s.topIds[2]],
      canSkipSelection: false,
      confirmSelectionLabel: '加入手牌',
    });
  });
  it('requires one legal LIVE then moves the exact other three in one deck-to-waiting event', () => {
    const s = setup();
    play(s);
    advance(s);
    expect(select(s, null).success).toBe(false);
    expect(select(s, s.topIds[1]!).success).toBe(false);
    expect(select(s, s.topIds[2]!).success).toBe(true);
    expect(s.session.state!.activeEffect).toBeNull();
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(['tail']);
    expect(s.session.state!.players[0].hand.cardIds).toContain(s.topIds[2]);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual([
      s.topIds[0],
      s.topIds[1],
      s.topIds[3],
    ]);
    expect(waitingEvents(s)).toHaveLength(1);
    expect(waitingEvents(s)[0]).toMatchObject({
      cardInstanceIds: [s.topIds[0], s.topIds[1], s.topIds[3]],
      cause: { kind: 'CARD_EFFECT', sourceCardId: s.source, abilityId: ABILITY_ID },
    });
    expect(
      s.session
        .state!.eventLog.map((r) => r.event)
        .filter((e) => e.eventType === TriggerCondition.ON_ENTER_HAND)
    ).toEqual([
      expect.objectContaining({ fromZone: ZoneType.MAIN_DECK, cardInstanceIds: [s.topIds[2]] }),
    ]);
  });
  it('sends a mixed reveal entirely to waiting after display, even when it contains a recoverable LIVE', () => {
    const s = setup({
      top: [live('live'), member('lily'), member('wrong', 'Printemps'), member('lily2')],
    });
    const deck = [...s.session.state!.players[0].mainDeck.cardIds];
    expect(play(s).success).toBe(true);
    expect(s.session.state!.activeEffect?.stepText).toBe(
      '已公开卡组顶的4张卡牌。展示结束后，若全部是『lily white』的卡片，将其中1张『lily white』的LIVE卡加入手牌，其余放置入休息室；否则将公开的卡片全部放置入休息室。'
    );
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(deck);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual([]);
    expect(waitingEvents(s)).toEqual([]);
    expect(refreshes(s)).toEqual([]);
    expect(select(s, s.topIds[0]!).success).toBe(false);
    expect(s.session.executeCommand(advanceCommand(s)).success).toBe(false);
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(deck);
    expect(advance(s).success).toBe(true);
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(['tail']);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['discard']);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual(s.topIds);
    expect(waitingEvents(s)).toHaveLength(1);
    expect(waitingEvents(s)[0]).toMatchObject({
      cardInstanceIds: s.topIds,
      cause: { kind: 'CARD_EFFECT', sourceCardId: s.source, abilityId: ABILITY_ID },
    });
    expect(
      s.session.state!.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_HAND
      )
    ).toBe(false);
    expect(refreshes(s)).toEqual([]);
    expect(s.session.state!.activeEffect).toBeNull();
    expect(s.session.state!.pendingAbilities).toEqual([]);
  });
  it('refreshes an exactly-four mixed deck only after all four enter waiting in one event', () => {
    const s = setup({
      top: [live('live'), member('lily'), member('wrong', 'Printemps'), member('lily2')],
      tail: false,
      waiting: [member('waiting')],
    });
    expect(play(s).success).toBe(true);
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(s.topIds);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual(s.waitingIds);
    expect(waitingEvents(s)).toEqual([]);
    expect(refreshes(s)).toEqual([]);
    expect(advance(s).success).toBe(true);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['discard']);
    expect(waitingEvents(s)).toHaveLength(1);
    expect(waitingEvents(s)[0]).toMatchObject({ cardInstanceIds: s.topIds });
    expect(refreshes(s)).toHaveLength(1);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual([]);
    expect([...s.session.state!.players[0].mainDeck.cardIds].sort()).toEqual(
      [...s.waitingIds, ...s.topIds].sort()
    );
    expect(s.session.state!.activeEffect).toBeNull();
    expect(s.session.state!.pendingAbilities).toEqual([]);
  });
  it('sends all matching revealed members to waiting when no LIVE exists', () => {
    const s = setup({ top: [member('a'), member('b'), member('c'), member('d')] });
    play(s);
    expect(advance(s).success).toBe(true);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual(s.topIds);
    expect(waitingEvents(s)).toHaveLength(1);
    expect(s.session.state!.activeEffect).toBeNull();
  });
  it('uses the actual short deck and refreshes only after the complete successful partition', () => {
    const s = setup({ top: [live('live'), member('a')], tail: false });
    play(s);
    expect(s.session.state!.activeEffect?.revealedCardIds).toEqual(s.topIds);
    expect(refreshes(s)).toEqual([]);
    advance(s);
    expect(select(s, s.topIds[0]!).success).toBe(true);
    expect(s.session.state!.players[0].hand.cardIds).toContain(s.topIds[0]);
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual([s.topIds[1]]);
    expect(refreshes(s)).toHaveLength(1);
    expect(waitingEvents(s)).toHaveLength(1);
    expect(waitingEvents(s)[0]).toMatchObject({ cardInstanceIds: [s.topIds[1]] });
  });
  it('applies the existing short-deck check-top refresh before taking a public snapshot', () => {
    const s = setup({
      top: [live('one')],
      tail: false,
      waiting: [member('w1'), member('w2'), member('w3'), member('w4')],
    });
    play(s);
    expect(refreshes(s)).toHaveLength(1);
    expect(s.session.state!.activeEffect?.revealedCardIds).toHaveLength(4);
    expect(s.session.state!.activeEffect?.revealedCardIds).toEqual(
      s.session.state!.players[0].mainDeck.cardIds.slice(0, 4)
    );
    expect(s.session.state!.players[0].mainDeck.cardIds).toHaveLength(5);
    expect(waitingEvents(s)).toEqual([]);
  });
  it('ends on zero available cards without an empty reveal window', () => {
    const s = setup({ top: [], tail: false });
    expect(play(s).success).toBe(true);
    expect(s.session.state!.activeEffect).toBeNull();
    expect(waitingEvents(s)).toEqual([]);
  });
  it('does not perform partial movement if the original top prefix changes during dwell or after selection opens', () => {
    for (const after of [false, true]) {
      const s = setup();
      play(s);
      if (after) advance(s);
      s.install(
        updatePlayer(s.session.state!, P1, (p) => ({
          ...p,
          mainDeck: {
            ...p.mainDeck,
            cardIds: [
              p.mainDeck.cardIds[1]!,
              p.mainDeck.cardIds[0]!,
              ...p.mainDeck.cardIds.slice(2),
            ],
          },
        }))
      );
      const deck = [...s.session.state!.players[0].mainDeck.cardIds];
      expect((after ? select(s, s.topIds[0]!) : advance(s)).success).toBe(true);
      expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(deck);
      expect(waitingEvents(s)).toEqual([]);
      expect(s.session.state!.activeEffect).toBeNull();
    }
  });
  it('retains an already triggered source lifecycle when Umi leaves and re-enters before resolution', () => {
    const s = setup();
    play(s);
    const lifecycle = s.session.state!.activeEffect!.sourceLifecycleId;
    expect(lifecycle).toBeTruthy();
    let game = updatePlayer(s.session.state!, P1, (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER),
      waitingRoom: addCardToZone(p.waitingRoom, s.source),
    }));
    s.install(game);
    expect(advance(s).success).toBe(true);
    game = updatePlayer(s.session.state!, P1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, s.source, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      waitingRoom: {
        ...p.waitingRoom,
        cardIds: p.waitingRoom.cardIds.filter((id) => id !== s.source),
      },
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent(s.source, ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    s.install(game);
    expect(select(s, s.topIds[0]!).success).toBe(true);
    expect(
      s.session
        .state!.actionHistory.filter(
          (a) => a.payload.step === 'RECOVER_LIVE_AND_SEND_REST_TO_WAITING'
        )
        .at(-1)?.payload.sourceLifecycleId
    ).toBe(lifecycle);
  });
  it('finishes invalid-owner snapshots without moving any replacement', () => {
    const s = setup();
    play(s);
    const registry = new Map(s.session.state!.cardRegistry);
    const card = registry.get(s.topIds[0]!)!;
    registry.set(s.topIds[0]!, { ...card, ownerId: P2 });
    s.install({ ...s.session.state!, cardRegistry: registry });
    const deck = [...s.session.state!.players[0].mainDeck.cardIds];
    expect(advance(s).success).toBe(true);
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(deck);
    expect(waitingEvents(s)).toEqual([]);
  });
  it('queues newly moved card abilities only after the whole partition and returns to the live pending pool', () => {
    const s = setup({ triggerCard: true });
    play(s);
    expect(s.session.state!.pendingAbilities).toEqual([]);
    advance(s);
    expect(s.session.state!.pendingAbilities).toEqual([]);
    expect(select(s, s.topIds[0]!).success).toBe(true);
    expect(s.session.state!.players[0].hand.cardIds).toContain(s.topIds[0]);
    expect(
      s.session.state!.activeEffect?.abilityId === DECK_OBSERVER ||
        s.session.state!.pendingAbilities.some((a) => a.abilityId === DECK_OBSERVER)
    ).toBe(true);
  });
  it('finishes the complete failed reveal before starting its newly queued observer', () => {
    const s = setup({
      top: [live('live'), member('PL!N-bp7-011-R', 'other-unit'), member('lily'), member('lily2')],
    });
    expect(play(s).success).toBe(true);
    expect(s.session.state!.activeEffect?.abilityId).toBe(ABILITY_ID);
    expect(s.session.state!.pendingAbilities).toEqual([]);
    expect(waitingEvents(s)).toEqual([]);
    expect(
      s.session.state!.actionHistory.some((action) => action.payload.abilityId === DECK_OBSERVER)
    ).toBe(false);
    expect(advance(s).success).toBe(true);
    expect(s.session.state!.players[0].mainDeck.cardIds).toEqual(['tail']);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual(s.topIds);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(['discard']);
    expect(waitingEvents(s)).toHaveLength(1);
    expect(waitingEvents(s)[0]).toMatchObject({ cardInstanceIds: s.topIds });
    expect(s.session.state!.activeEffect?.abilityId).toBe(DECK_OBSERVER);
    const history = s.session.state!.actionHistory;
    const umiFinished = history.findIndex(
      (action) =>
        action.payload.abilityId === ABILITY_ID &&
        action.payload.step === 'RECOVER_LIVE_AND_SEND_REST_TO_WAITING'
    );
    const observerStarted = history.findIndex(
      (action) =>
        action.payload.abilityId === DECK_OBSERVER &&
        action.payload.step === 'SELECT_DISCARD_TO_RECOVER_SELF'
    );
    expect(umiFinished).toBeGreaterThanOrEqual(0);
    expect(observerStarted).toBeGreaterThan(umiFinished);
    expect(select(s, null).success).toBe(true);
    expect(s.session.state!.activeEffect).toBeNull();
    expect(s.session.state!.pendingAbilities).toEqual([]);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual(s.topIds);
  });
  it('handles manual and ordered pending starts through the normal scheduler with no extra confirm-only window', () => {
    for (const ordered of [false, true]) {
      const s = setup();
      let g = s.session.state!;
      g = updatePlayer(g, P1, (p) => ({
        ...p,
        hand: { ...p.hand, cardIds: p.hand.cardIds.filter((id) => id !== s.source) },
        memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, s.source, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      }));
      g = emitGameEvent(
        g,
        createEnterStageEvent(s.source, ZoneType.HAND, SlotPosition.CENTER, P1, P1)
      );
      g = enqueueTriggeredCardEffects(g, [TriggerCondition.ON_ENTER_STAGE]);
      const ability = g.pendingAbilities.find((a) => a.abilityId === ABILITY_ID)!;
      g = { ...g, pendingAbilities: [ability, { ...ability, id: `${ability.id}-second` }] };
      g = resolvePendingCardEffects(g).gameState;
      expect(g.activeEffect?.canResolveInOrder).toBe(true);
      g = confirmActiveEffectStep(
        g,
        P1,
        g.activeEffect!.id,
        ordered ? null : s.source,
        undefined,
        ordered
      );
      expect(g.activeEffect?.stepId).toBe('COMMON_PUBLIC_REVEAL_DWELL');
      expect(g.activeEffect?.revealedCardIds).toEqual(s.topIds);
    }
  });
  it('the reusable move helper rejects duplicate, non-prefix and out-of-selection hand targets atomically', () => {
    const s = setup();
    const g = s.session.state!;
    for (const [ids, selected] of [
      [[s.topIds[0]!, s.topIds[0]!], s.topIds[0]],
      [[s.topIds[1]!], s.topIds[1]],
      [[s.topIds[0]!], 'tail'],
    ] as const) {
      expect(
        moveRevealedTopDeckSelectionToHandRestToWaitingRoomAndEnqueueTriggers(
          g,
          P1,
          ids,
          selected!,
          (x) => x
        )
      ).toBeNull();
    }
    expect(waitingEvents(s)).toEqual([]);
    expect(s.session.state).toBe(g);
  });
});
