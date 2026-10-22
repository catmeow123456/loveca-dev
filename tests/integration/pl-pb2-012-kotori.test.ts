import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicCardSelectionCommand,
  createBeginSpecialMemberPlayCommand,
  createCancelSpecialMemberPlayCommand,
  createConfirmEffectStepCommand,
  createConfirmSpecialMemberPlayCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import {
  PL_PB2_012_ACTIVATED_WAIT_SELF_ADDITIONAL_COST_RECOVER_PRINTEMPS_LIVE_ABILITY_ID as ACT,
  PL_PB2_012_CONTINUOUS_PLAY_WAIT_TWO_PRINTEMPS_COST_MINUS_TWO_ABILITY_ID as COST,
  PL_PR_023_AUTO_TURN_THREE_MEMBER_WAITED_GAIN_BLADE_ABILITY_ID as WAIT_OBSERVER,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
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
} from '../../src/domain/entities/zone';
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
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  PL_PB2_012_SPECIAL_PLAY_MODE as MODE,
  isPlPb2012SpecialPlayMemberSelection,
} from '../../src/application/effects/special-member-play';

const P1 = 'p1',
  P2 = 'p2';
const cardState = { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };
const CONTINUOUS_TEXT =
  '【常时】打出此卡时，可以将存在于自己的舞台的2名名称互不相同的『Printemps』的成员变为待机状态。如此做时，此卡的费用减少2。';
const ACTIVATED_TEXT =
  '【起动】【1回合1次】将此成员变为待机状态：作为起动此能力的追加费用，将2张手牌放置入休息室，或将2名『Printemps』的成员变为待机状态。从自己的休息室将1张『Printemps』的LIVE卡加入手牌。';
function member(code: string, name = code, cost = 3, unit = 'Printemps'): MemberCardData {
  return {
    cardCode: code,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
    groupNames: ["μ's"],
    unitName: unit,
  };
}
function live(code = 'target', unit = 'Printemps'): AnyCardData {
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
    activated?: boolean;
    energies?: number;
    marker?: boolean;
    handCount?: number;
    target?: boolean;
    observer?: boolean;
    code?: string;
    names?: readonly [string, string];
    firstCost?: number;
    firstUnit?: string;
  } = {}
) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('kotori-pb2', P1, 'P1', P2, 'P2');
  const source = createCardInstance(
    member(options.code ?? 'PL!-pb2-012-P+', '南ことり', 13),
    P1,
    'source'
  );
  const first = createCardInstance(
    member(
      options.observer ? 'PL!-PR-023-PR' : 'first',
      options.names?.[0] ?? '高坂穂乃果',
      options.firstCost ?? 3,
      options.firstUnit
    ),
    P1,
    'first'
  );
  const second = createCardInstance(
    member('second', options.names?.[1] ?? '小泉花陽'),
    P1,
    'second'
  );
  const target = createCardInstance(live(), P1, 'target');
  const otherLive = createCardInstance(live('other-live', 'BiBi'), P1, 'other-live');
  const deckCards = Array.from({ length: 5 }, (_, i) =>
    createCardInstance(member(`deck-${i}`), P1, `deck-${i}`)
  );
  const hand = Array.from({ length: options.handCount ?? 2 }, (_, i) =>
    createCardInstance(member(`hand-${i}`), P1, `hand-${i}`)
  );
  const energies = Array.from({ length: options.energies ?? 13 }, (_, i) =>
    createCardInstance(
      { cardCode: `energy-${i}`, name: `energy-${i}`, cardType: CardType.ENERGY },
      P1,
      `energy-${i}`
    )
  );
  let game = registerCards(session.state!, [
    source,
    first,
    second,
    target,
    otherLive,
    ...hand,
    ...energies,
    ...deckCards,
  ]);
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    energyActivePhaseSkips: options.marker
      ? [
          {
            playerId: P1,
            energyCardId: energies[0]!.instanceId,
            sourceCardId: 'marker',
            abilityId: 'marker',
          },
        ]
      : [],
  };
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    memberSlots: [first, second, ...(options.activated ? [source] : [])].reduce(
      (slots, c, i) =>
        placeCardInSlot(
          slots,
          [SlotPosition.LEFT, SlotPosition.RIGHT, SlotPosition.CENTER][i]!,
          c.instanceId,
          cardState
        ),
      p.memberSlots
    ),
    hand: [...hand, ...(options.activated ? [] : [source])].reduce(
      (z, c) => addCardToZone(z, c.instanceId),
      p.hand
    ),
    waitingRoom: [otherLive, ...(options.target !== false ? [target] : [])].reduce(
      (z, c) => addCardToZone(z, c.instanceId),
      p.waitingRoom
    ),
    mainDeck: deckCards.reduce((z, c) => addCardToZone(z, c.instanceId), p.mainDeck),
    energyZone: energies.reduce(
      (z, c) => addCardToStatefulZone(z, c.instanceId, cardState),
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
    memberIds: [first.instanceId, second.instanceId],
    handIds: hand.map((c) => c.instanceId),
    target: target.instanceId,
    energies: energies.map((c) => c.instanceId),
    install,
    setNow(value: number) {
      now = value;
    },
  };
}
type Scenario = ReturnType<typeof setup>;
function begin(s: Scenario, slot = SlotPosition.CENTER) {
  return s.session.executeCommand(createBeginSpecialMemberPlayCommand(P1, s.source, slot, MODE));
}
function confirmPlay(s: Scenario, ids: readonly string[]) {
  return s.session.executeCommand(
    createConfirmSpecialMemberPlayCommand(P1, s.session.state!.pendingSpecialMemberPlay!.id, ids)
  );
}
function activate(s: Scenario, player = P1) {
  return s.session.executeCommand(createActivateAbilityCommand(player, s.source, ACT));
}
function choose(s: Scenario, branch: string) {
  return s.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      s.session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      branch
    )
  );
}
function select(s: Scenario, ids: readonly string[]) {
  return s.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      s.session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ids
    )
  );
}
function recover(s: Scenario, target = s.target) {
  return s.session.executeCommand(
    createConfirmEffectStepCommand(P1, s.session.state!.activeEffect!.id, target)
  );
}
function advance(s: Scenario) {
  const e = s.session.state!.activeEffect!;
  s.setNow(e.publicCardSelectionAutoAdvanceAt!);
  return s.session.executeCommand(
    createAutoAdvancePublicCardSelectionCommand(P2, e.id, e.publicCardSelectionAutoAdvanceAt!)
  );
}
function energyPaid(s: Scenario) {
  return s.energies.filter(
    (id) =>
      s.session.state!.players[0].energyZone.cardStates.get(id)?.orientation ===
      OrientationState.WAITING
  );
}
function uses(s: Scenario) {
  return s.session.state!.actionHistory.filter(
    (a) =>
      a.type === 'RESOLVE_ABILITY' &&
      a.payload.step === 'ABILITY_USE' &&
      a.payload.abilityId === ACT
  );
}
function waits(s: Scenario) {
  return s.session
    .state!.eventLog.map((r) => r.event)
    .filter((e) => e.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED);
}
function setOrientation(s: Scenario, id: string, orientation: OrientationState) {
  s.install(
    updatePlayer(s.session.state!, P1, (p) => ({
      ...p,
      memberSlots: {
        ...p.memberSlots,
        cardStates: new Map(p.memberSlots.cardStates).set(id, { ...cardState, orientation }),
      },
    }))
  );
}

describe('PL!-pb2-012 费用13 南琴梨（南小鸟）', () => {
  it.each(['P+', 'R', 'SEC'])('registers both full text paragraphs for rarity %s', (rarity) => {
    const defs = getCardAbilityDefinitionsForCardCode(`PL!-pb2-012-${rarity}`);
    expect(defs.find((d) => d.abilityId === COST)?.effectText).toBe(CONTINUOUS_TEXT);
    const act = defs.find((d) => d.abilityId === ACT);
    expect(act?.effectText).toBe(ACTIVATED_TEXT);
    expect(act?.activatedUi?.text).toBe(ACTIVATED_TEXT);
    expect(act).toMatchObject({
      perTurnLimit: 1,
      requiredSourceOrientation: OrientationState.ACTIVE,
      baseCardCodes: ['PL!-pb2-012'],
    });
  });
  it('ordinary play pays thirteen without waiting any stage member', () => {
    const s = setup();
    expect(
      s.session.executeCommand(createPlayMemberToSlotCommand(P1, s.source, SlotPosition.CENTER))
        .success
    ).toBe(true);
    expect(energyPaid(s)).toHaveLength(13);
    expect(waits(s)).toHaveLength(0);
  });
  it.each(['P+', 'R'])('waits exactly two before playing at eleven across rarity %s', (rarity) => {
    const s = setup({ code: `PL!-pb2-012-${rarity}` });
    expect(begin(s).success).toBe(true);
    expect(s.session.getPlayerViewState(P1).pendingSpecialMemberPlay).toMatchObject({
      minSelectableObjects: 2,
      maxSelectableObjects: 2,
      confirmSelectionLabel: '选择成员',
    });
    expect(s.session.getPlayerViewState(P2).pendingSpecialMemberPlay).toEqual({
      id: s.session.state!.pendingSpecialMemberPlay!.id,
      playerSeat: 'FIRST',
      waiting: true,
    });
    expect(confirmPlay(s, s.memberIds).success).toBe(true);
    expect(energyPaid(s)).toEqual(s.energies.slice(0, 11));
    expect(waits(s)).toHaveLength(2);
    expect(
      waits(s).every(
        (e) => 'cause' in e && e.cause?.kind === 'CARD_EFFECT' && e.cause.sourceCardId === s.source
      )
    ).toBe(true);
    expect(s.session.state!.players[0].memberSlots.slots.CENTER).toBe(s.source);
    expect(s.session.state!.pendingSpecialMemberPlay).toBeNull();
  });
  it('applies the selected member relay after its WAIT and reduces eleven by its cost', () => {
    const s = setup();
    begin(s, SlotPosition.LEFT);
    expect(confirmPlay(s, s.memberIds).success).toBe(true);
    expect(energyPaid(s)).toHaveLength(8);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toContain(s.memberIds[0]);
    const events = s.session.state!.eventLog.map((r) => r.event);
    expect(
      events.findIndex((e) => e.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)
    ).toBeLessThan(events.findIndex((e) => e.eventType === TriggerCondition.ON_LEAVE_STAGE));
    expect(s.session.state!.cardRegistry.get(s.source)?.data).toMatchObject({ cost: 13 });
  });
  it('supports zero energy after relay without creating an energy prompt', () => {
    const s = setup({ firstCost: 13, energies: 0 });
    begin(s, SlotPosition.LEFT);
    expect(confirmPlay(s, s.memberIds).success).toBe(true);
    expect(energyPaid(s)).toEqual([]);
    expect(s.session.state!.pendingSpecialMemberPlay).toBeNull();
  });
  it.each([
    ['高坂穂乃果', '高坂穂乃果'],
    ['高坂穂乃果', '高坂穗乃果'],
    ['高坂穗乃果', '高坂穂乃果'],
  ])(
    'rejects same-member payment %s / %s and accepts a combined-name assignment',
    (first, second) => {
      const s = setup({ names: [first, second] });
      expect(begin(s).success).toBe(false);
      const combined = setup({ names: ['高坂穂乃果&小泉花陽', '高坂穂乃果'] });
      expect(
        isPlPb2012SpecialPlayMemberSelection(combined.session.state!, P1, combined.memberIds)
      ).toBe(true);
      begin(combined);
      expect(confirmPlay(combined, combined.memberIds).success).toBe(true);
    }
  );
  it('rejects duplicate and foreign IDs without paying and preserves pending for cancellation', () => {
    const s = setup();
    begin(s);
    const before = s.session.state;
    expect(confirmPlay(s, [s.memberIds[0]!, s.memberIds[0]!]).success).toBe(false);
    expect(confirmPlay(s, [s.memberIds[0]!, s.handIds[0]!]).success).toBe(false);
    expect(s.session.state).toBe(before);
    expect(waits(s)).toEqual([]);
    expect(
      s.session.executeCommand(
        createCancelSpecialMemberPlayCommand(P1, s.session.state!.pendingSpecialMemberPlay!.id)
      ).success
    ).toBe(true);
    expect(energyPaid(s)).toEqual([]);
  });
  it('rejects insufficient energy without committing preview orientations or events', () => {
    const s = setup({ energies: 10 });
    begin(s);
    const before = s.session.state;
    expect(confirmPlay(s, s.memberIds).success).toBe(false);
    expect(s.session.state).toBe(before);
    expect(waits(s)).toEqual([]);
    expect(energyPaid(s)).toEqual([]);
  });
  it('does not offer unavailable unit/orientation/adjacent-base special play', () => {
    for (const s of [setup({ firstUnit: 'BiBi' }), setup({ code: 'PL!-pb2-013-P+' })])
      expect(begin(s).success).toBe(false);
    const s = setup();
    setOrientation(s, s.memberIds[0]!, OrientationState.WAITING);
    expect(begin(s).success).toBe(false);
  });
  it('keeps both special-payment steps uncommitted and lets the player choose marked energy exactly', () => {
    const s = setup({ energies: 12, marker: true });
    begin(s);
    expect(s.session.getPlayerViewState(P1).pendingSpecialMemberPlay).toMatchObject({
      confirmSelectionLabel: '选择成员',
    });
    const oldId = s.session.state!.pendingSpecialMemberPlay!.id;
    expect(confirmPlay(s, s.memberIds).success).toBe(true);
    const pending = s.session.state!.pendingSpecialMemberPlay!;
    expect(pending).toMatchObject({
      step: 'SELECT_ENERGY',
      requiredEnergyCount: 11,
      selectedMemberCardIds: s.memberIds,
    });
    expect(pending.id).not.toBe(oldId);
    expect(s.session.getPlayerViewState(P1).pendingSpecialMemberPlay).toMatchObject({
      confirmSelectionLabel: '支付费用',
    });
    expect(waits(s)).toEqual([]);
    expect(energyPaid(s)).toEqual([]);
    expect(s.session.state!.players[0].hand.cardIds).toContain(s.source);
    expect(
      s.session.executeCommand(createConfirmSpecialMemberPlayCommand(P1, oldId, s.memberIds))
        .success
    ).toBe(false);
    expect(confirmPlay(s, s.energies.slice(1)).success).toBe(true);
    expect(energyPaid(s)).toEqual(s.energies.slice(1));
    expect(waits(s)).toHaveLength(2);
    expect(
      s.session.executeCommand(
        createConfirmSpecialMemberPlayCommand(P1, pending.id, s.energies.slice(1))
      ).success
    ).toBe(false);
  });
  it('cancels the energy-selection step without any cost and rejects stale/duplicate energy', () => {
    const s = setup({ energies: 12, marker: true });
    begin(s);
    confirmPlay(s, s.memberIds);
    const before = s.session.state;
    expect(confirmPlay(s, Array(11).fill(s.energies[0])).success).toBe(false);
    expect(s.session.state).toBe(before);
    expect(
      s.session.executeCommand(
        createCancelSpecialMemberPlayCommand(P1, s.session.state!.pendingSpecialMemberPlay!.id)
      ).success
    ).toBe(true);
    expect(waits(s)).toEqual([]);
    expect(energyPaid(s)).toEqual([]);
    begin(s);
    confirmPlay(s, s.memberIds);
    setOrientation(s, s.memberIds[0]!, OrientationState.WAITING);
    const stale = s.session.state;
    expect(confirmPlay(s, s.energies.slice(1)).success).toBe(false);
    expect(s.session.state).toBe(stale);
  });
  it('does not require selection for marked energy that is exactly sufficient', () => {
    const s = setup({ energies: 11, marker: true });
    begin(s);
    expect(confirmPlay(s, s.memberIds).success).toBe(true);
    expect(energyPaid(s)).toHaveLength(11);
    expect(s.session.state!.pendingSpecialMemberPlay).toBeNull();
  });
  it('keeps FREE mode explicit card WAIT costs while ignoring the energy requirement', () => {
    const s = setup({ energies: 0 });
    expect(s.session.setManualOperationMode('FREE').success).toBe(true);
    begin(s);
    expect(confirmPlay(s, s.memberIds).success).toBe(true);
    expect(waits(s)).toHaveLength(2);
    expect(energyPaid(s)).toEqual([]);
  });
  it('queues a waited observer before it leaves by relay and resumes only after complete play', () => {
    const s = setup({ observer: true });
    begin(s, SlotPosition.LEFT);
    expect(confirmPlay(s, s.memberIds).success).toBe(true);
    const g = s.session.state!;
    expect(g.players[0].memberSlots.slots.LEFT).toBe(s.source);
    expect(g.players[0].waitingRoom.cardIds).toContain(s.memberIds[0]);
    expect(energyPaid(s)).toHaveLength(8);
    expect(
      g.pendingAbilities.some((a) => a.abilityId === WAIT_OBSERVER) ||
        g.activeEffect?.abilityId === WAIT_OBSERVER ||
        g.actionHistory.some((a) => a.payload.abilityId === WAIT_OBSERVER)
    ).toBe(true);
  });

  it('pays source WAIT and two discarded cards atomically before mandatory public recovery', () => {
    const s = setup({ activated: true });
    expect(activate(s).success).toBe(true);
    expect(s.session.state!.activeEffect?.selectableOptions).toHaveLength(2);
    expect(waits(s)).toEqual([]);
    expect(choose(s, 'DISCARD').success).toBe(true);
    expect(s.session.getPlayerViewState(P1).activeEffect?.confirmSelectionLabel).toBe(
      '放置入休息室'
    );
    expect(select(s, s.handIds).success).toBe(true);
    expect(uses(s)).toHaveLength(1);
    expect(waits(s)).toHaveLength(1);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(s.handIds)
    );
    const discardEvents = s.session
      .state!.eventLog.map((r) => r.event)
      .filter((e) => e.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);
    expect(discardEvents).toHaveLength(1);
    expect(s.session.state!.activeEffect).toMatchObject({
      selectableCardIds: [s.target],
      canSkipSelection: false,
    });
    expect(recover(s).success).toBe(true);
    expect(s.session.state!.players[0].waitingRoom.cardIds).toContain(s.target);
    expect(s.session.state!.activeEffect?.stepId).toBe('COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION');
    expect(advance(s).success).toBe(true);
    expect(s.session.state!.players[0].hand.cardIds).toContain(s.target);
    expect(s.session.state!.activeEffect).toBeNull();
    expect(uses(s)).toHaveLength(1);
    setOrientation(s, s.source, OrientationState.ACTIVE);
    expect(activate(s).success).toBe(false);
  });
  it('pays three total waits, excludes source from the extra payment, and does not require distinct names for that payment', () => {
    const s = setup({ activated: true, handCount: 0, names: ['高坂穂乃果', '高坂穂乃果'] });
    expect(activate(s).success).toBe(true);
    expect(s.session.state!.activeEffect?.selectableCardIds).toEqual(s.memberIds);
    expect(s.session.getPlayerViewState(P1).activeEffect?.confirmSelectionLabel).toBe(
      '变为待机状态'
    );
    expect(select(s, [s.source, s.memberIds[0]!]).success).toBe(false);
    expect(waits(s)).toEqual([]);
    expect(select(s, s.memberIds).success).toBe(true);
    expect(waits(s)).toHaveLength(3);
    expect(uses(s)).toHaveLength(1);
    recover(s);
    expect(advance(s).success).toBe(true);
  });
  it('allows complete cost with no recovery target, and can recover a LIVE just discarded as cost', () => {
    const empty = setup({ activated: true, target: false });
    activate(empty);
    choose(empty, 'WAIT');
    expect(select(empty, empty.memberIds).success).toBe(true);
    expect(uses(empty)).toHaveLength(1);
    expect(waits(empty)).toHaveLength(3);
    expect(empty.session.state!.activeEffect).toBeNull();
    const s = setup({ activated: true, target: false });
    s.install(
      registerCards(s.session.state!, [createCardInstance(live('hand-live'), P1, s.handIds[0]!)])
    );
    activate(s);
    choose(s, 'DISCARD');
    expect(select(s, s.handIds).success).toBe(true);
    expect(s.session.state!.activeEffect?.selectableCardIds).toEqual([s.handIds[0]]);
    recover(s, s.handIds[0]);
    expect(advance(s).success).toBe(true);
    expect(s.session.state!.players[0].hand.cardIds).toEqual([s.handIds[0]]);
  });
  it('rejects unpaid invalid/stale choices without waiting the source or using the turn limit', () => {
    const s = setup({ activated: true });
    activate(s);
    choose(s, 'DISCARD');
    const before = s.session.state;
    expect(select(s, [s.handIds[0]!, s.handIds[0]!]).success).toBe(false);
    expect(s.session.state).toBe(before);
    setOrientation(s, s.source, OrientationState.WAITING);
    const stale = s.session.state;
    expect(select(s, s.handIds).success).toBe(false);
    expect(s.session.state).toBe(stale);
    expect(uses(s)).toEqual([]);
    expect(s.session.state!.players[0].hand.cardIds).toEqual(s.handIds);
  });
  it('rejects source WAITING, missing both extra costs and opponent activation', () => {
    const s = setup({ activated: true, handCount: 1 });
    setOrientation(s, s.memberIds[0]!, OrientationState.WAITING);
    expect(activate(s).success).toBe(false);
    const waiting = setup({ activated: true });
    setOrientation(waiting, waiting.source, OrientationState.WAITING);
    expect(activate(waiting).success).toBe(false);
    expect(activate(setup({ activated: true }), P2).success).toBe(false);
  });
  it('rejects source re-entry during an unpaid choice and preserves captured lifecycle through public recovery', () => {
    const stale = setup({ activated: true });
    activate(stale);
    choose(stale, 'DISCARD');
    stale.install(
      emitGameEvent(
        stale.session.state!,
        createEnterStageEvent(stale.source, ZoneType.HAND, SlotPosition.CENTER, P1, P1)
      )
    );
    const before = stale.session.state;
    expect(select(stale, stale.handIds).success).toBe(false);
    expect(stale.session.state).toBe(before);
    expect(uses(stale)).toEqual([]);
    const s = setup({ activated: true });
    activate(s);
    const lifecycle = s.session.state!.activeEffect!.sourceLifecycleId;
    expect(lifecycle).toBeTruthy();
    choose(s, 'DISCARD');
    expect(s.session.state!.activeEffect!.sourceLifecycleId).toBe(lifecycle);
    select(s, s.handIds);
    expect(uses(s)[0]?.payload.sourceLifecycleId).toBe(lifecycle);
    recover(s);
    expect(s.session.state!.activeEffect!.sourceLifecycleId).toBe(lifecycle);
    expect(advance(s).success).toBe(true);
    expect(uses(s)[0]?.payload.sourceLifecycleId).toBe(lifecycle);
  });
  it('revalidates public recovery at its deadline and rejects early or repeated completion', () => {
    const s = setup({ activated: true });
    activate(s);
    choose(s, 'DISCARD');
    select(s, s.handIds);
    recover(s);
    const effect = s.session.state!.activeEffect!;
    const command = createAutoAdvancePublicCardSelectionCommand(
      P2,
      effect.id,
      effect.publicCardSelectionAutoAdvanceAt!
    );
    expect(s.session.executeCommand(command).success).toBe(false);
    s.install(
      updatePlayer(s.session.state!, P1, (p) => ({
        ...p,
        waitingRoom: {
          ...p.waitingRoom,
          cardIds: p.waitingRoom.cardIds.filter((id) => id !== s.target),
        },
        hand: addCardToZone(p.hand, s.target),
      }))
    );
    s.setNow(effect.publicCardSelectionAutoAdvanceAt!);
    expect(s.session.executeCommand(command).success).toBe(true);
    expect(s.session.state!.players[0].hand.cardIds.filter((id) => id === s.target)).toHaveLength(
      1
    );
    expect(s.session.state!.activeEffect).toBeNull();
    expect(uses(s)).toHaveLength(1);
    expect(s.session.executeCommand(command).success).toBe(false);
  });
  it('rejects energy that becomes WAITING after the payment prompt without partially committing members', () => {
    const s = setup({ energies: 12, marker: true });
    begin(s);
    confirmPlay(s, s.memberIds);
    s.install(
      updatePlayer(s.session.state!, P1, (p) => ({
        ...p,
        energyZone: {
          ...p.energyZone,
          cardStates: new Map(p.energyZone.cardStates).set(s.energies[1]!, {
            ...cardState,
            orientation: OrientationState.WAITING,
          }),
        },
      }))
    );
    const before = s.session.state;
    expect(confirmPlay(s, s.energies.slice(1)).success).toBe(false);
    expect(s.session.state).toBe(before);
    expect(waits(s)).toEqual([]);
  });
  it('opens the only payable discard branch directly and rejects mandatory recovery skip', () => {
    const s = setup({ activated: true });
    setOrientation(s, s.memberIds[0]!, OrientationState.WAITING);
    expect(activate(s).success).toBe(true);
    expect(s.session.state!.activeEffect?.selectableCardIds).toEqual(s.handIds);
    expect(select(s, s.handIds).success).toBe(true);
    expect(
      s.session.executeCommand(
        createConfirmEffectStepCommand(P1, s.session.state!.activeEffect!.id, null)
      ).success
    ).toBe(false);
    recover(s);
    expect(advance(s).success).toBe(true);
  });
  it('keeps cost-generated triggers waiting throughout recovery and public display', () => {
    const s = setup({ activated: true, observer: true });
    activate(s);
    choose(s, 'WAIT');
    expect(select(s, s.memberIds).success).toBe(true);
    expect(s.session.state!.activeEffect?.abilityId).toBe(ACT);
    expect(
      s.session.state!.pendingAbilities.filter((a) => a.abilityId === WAIT_OBSERVER)
    ).toHaveLength(3);
    recover(s);
    expect(s.session.state!.activeEffect?.abilityId).toBe(ACT);
    expect(
      s.session.state!.pendingAbilities.filter((a) => a.abilityId === WAIT_OBSERVER)
    ).toHaveLength(3);
    expect(advance(s).success).toBe(true);
    expect(s.session.state!.activeEffect?.abilityId).not.toBe(ACT);
  });
});
