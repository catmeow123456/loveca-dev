import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_019_AUTO_RELAY_NIJIGASAKI_PLACE_ENERGY_BELOW_REPLACEMENT_ABILITY_ID as SETSUNA,
  N_BP8_024_AUTO_BATON_TOUCH_NIJIGASAKI_PLACE_ENERGY_UNDER_ENTERED_MEMBER_ABILITY_ID as LANZHU,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent, createLeaveStageEvent } from '../../src/domain/events/game-events';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { createNovember07DraftCard } from '../helpers/november-07-draft-effects';
import { choose, gameWithCards, member, P1, P2 } from '../helpers/card-effect-zone-fixture';

const CASES = [
  {
    base: 'PL!N-bp7-019',
    ability: SETSUNA,
    cost: 9,
    text: '【自动】此成员从舞台放置入休息室时，此成员与『虹咲』的成员进行了换手的场合，从自己的能量卡组，将1张能量卡放置于此换手登场的成员下方。',
  },
  {
    base: 'PL!N-bp8-024',
    ability: LANZHU,
    cost: 4,
    text: '【自动】此成员从舞台被放置入休息室时，此成员曾与『虹咲』的成员进行换手的场合，从自己的能量卡组，将１张能量卡放置于因此换手登场的成员的下方。',
  },
] as const;
type Case = (typeof CASES)[number];
function setup(
  entry: Case,
  options: {
    replacementGroup?: string;
    replacementOwner?: string;
    replacementTop?: boolean;
    replacing?: boolean;
    toZone?: ZoneType;
    controller?: string;
    sourceId?: string;
    eventIds?: readonly string[];
    energy?: boolean;
    historyBeforeRelay?: boolean;
  } = {}
): GameState {
  const source = createNovember07DraftCard(entry.base, P1, 'source');
  const replacement = member(
    'replacement',
    { groupNames: [options.replacementGroup ?? '虹ヶ咲'], cost: 5 },
    options.replacementOwner ?? P1
  );
  const energy = createCardInstance(
    { cardCode: 'ENERGY', name: '能量', cardType: CardType.ENERGY },
    P1,
    'energy'
  );
  let game = updatePlayer(
    gameWithCards([source, replacement, member('deck'), energy]),
    P1,
    (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
      waitingRoom: { ...p.waitingRoom, cardIds: ['source'] },
      energyDeck: { ...p.energyDeck, cardIds: options.energy === false ? [] : ['energy'] },
      memberSlots:
        options.replacementTop === false
          ? p.memberSlots
          : placeCardInSlot(p.memberSlots, SlotPosition.RIGHT, 'replacement'),
    })
  );
  game = {
    ...game,
    manualOperationMode: 'RULES',
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  if (options.historyBeforeRelay) {
    game = emitGameEvent(
      game,
      createLeaveStageEvent('replacement', SlotPosition.RIGHT, ZoneType.HAND, P1, P1)
    );
    game = emitGameEvent(
      game,
      createEnterStageEvent('replacement', ZoneType.HAND, SlotPosition.RIGHT, P1, P1)
    );
  }
  const leave = createLeaveStageEvent(
    options.sourceId ?? 'source',
    SlotPosition.CENTER,
    options.toZone ?? ZoneType.WAITING_ROOM,
    P1,
    options.controller ?? P1,
    options.replacing === false ? undefined : 'replacement'
  );
  game = emitGameEvent(game, leave);
  // Normal relay ordering: the incoming card's entry follows the outgoing leave.
  game = emitGameEvent(
    game,
    createEnterStageEvent('replacement', ZoneType.HAND, SlotPosition.RIGHT, P1, P1)
  );
  const pending: PendingAbilityState = {
    id: 'relay-effect',
    abilityId: entry.ability,
    sourceCardId: 'source',
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LEAVE_STAGE,
    eventIds: options.eventIds ?? [leave.eventId],
    sourceSlot: SlotPosition.CENTER,
  };
  return { ...game, pendingAbilities: [pending] };
}
function resolve(game: GameState): GameState {
  const started = resolvePendingCardEffects(game).gameState;
  return started.activeEffect?.stepId === 'CONFIRM_ONLY_EFFECT' ? choose(started) : started;
}
function placedActions(game: GameState, ability: string) {
  return game.actionHistory.filter(
    (a) =>
      a.payload.abilityId === ability && a.payload.step === 'PLACE_ENERGY_BELOW_RELAY_REPLACEMENT'
  );
}
function placementEvents(game: GameState) {
  return game.eventLog.filter(
    ({ event }) =>
      event.eventType === TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER ||
      event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
  );
}

describe.each(CASES)('$base 费用$cost 换手后能量下置 shared family', (entry) => {
  it.each(['N', 'P', 'SEC', 'UNSEEN'])(
    'keeps independent complete text for every rarity: %s',
    (rare) => {
      expect(getCardAbilityDefinitionsForCardCode(`${entry.base}-${rare}`)).toContainEqual(
        expect.objectContaining({
          abilityId: entry.ability,
          baseCardCodes: [entry.base],
          effectText: entry.text,
          category: 'AUTO',
          triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
          queued: true,
          implemented: true,
        })
      );
      expect(
        getCardAbilityDefinitionsForCardCode(`${entry.base}-${rare}`)[0]?.cardCodes
      ).toBeUndefined();
    }
  );
  it('shows one confirmation, then resolves normal leave-before-entry order and no energy-zone placement event', () => {
    const started = resolvePendingCardEffects(setup(entry)).gameState;
    expect(started.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    const confirmation = projectPlayerViewState(started, P1).activeEffect;
    expect(confirmation?.selectableObjectIds ?? []).toEqual([]);
    expect(confirmation?.effectChoice).toBeUndefined();
    expect(confirmation?.selectableOptions).toBeUndefined();
    expect(started.activeEffect?.effectText).toContain(entry.text);
    expect(started.players[0].energyDeck.cardIds).toEqual(['energy']);
    const done = choose(started);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual(['energy']);
    expect(done.players[0].energyDeck.cardIds).toEqual([]);
    expect(done.players[0].energyZone.cardIds).toEqual([]);
    expect(placementEvents(done)).toEqual([]);
    expect(placedActions(done, entry.ability)).toHaveLength(1);
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
    expect(confirmActiveEffectStep(done, P1, started.activeEffect!.id)).toBe(done);
  });
  it('uses a real RULES single relay and keeps the ability bound to the actual leave event', () => {
    const base = setup(entry);
    const energyZoneCard = createCardInstance(
      { cardCode: 'ZONE-ENERGY', name: '能量区能量', cardType: CardType.ENERGY },
      P1,
      'zone-energy'
    );
    let game: GameState = {
      ...base,
      cardRegistry: new Map([...base.cardRegistry, ['zone-energy', energyZoneCard]]),
      pendingAbilities: [],
      eventLog: [],
    };
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: ['replacement'] },
      waitingRoom: { ...p.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(
        removeCardFromSlot(p.memberSlots, SlotPosition.RIGHT),
        SlotPosition.CENTER,
        'source'
      ),
      energyZone: addCardToStatefulZone(p.energyZone, 'zone-energy', {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
    }));
    const session = createGameSession({ cardEntrance: 'LOCAL' });
    session.createGame('relay-rules', P1, 'P1', P2, 'P2');
    session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
    const played = session.executeCommand(
      createPlayMemberToSlotCommand(P1, 'replacement', SlotPosition.CENTER, { relayMode: 'SINGLE' })
    );
    expect(played.success, played.error).toBe(true);
    const entrance = session.state!.entranceRuntime?.pending;
    if (entrance)
      expect(
        session.executeCommand({
          type: GameCommandType.ACK_CARD_ENTRANCE,
          playerId: P1,
          entranceId: entrance.id,
          timestamp: Date.now(),
        }).success
      ).toBe(true);
    expect(session.state!.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    const leaveEntry = session.state!.eventLog.find(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_LEAVE_STAGE && event.cardInstanceId === 'source'
    );
    const entryEvent = session.state!.eventLog.find(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_STAGE &&
        event.cardInstanceId === 'replacement'
    );
    expect(leaveEntry!.sequence).toBeLessThan(entryEvent!.sequence);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id))
        .success
    ).toBe(true);
    expect(session.state!.players[0].memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      'energy',
    ]);
    expect(placedActions(session.state!, entry.ability)[0]?.payload.leaveStageEventId).toBe(
      leaveEntry?.event.eventId
    );
    expect(placementEvents(session.state!)).toEqual([]);
  });
  it.each([
    { replacing: false },
    { replacementGroup: 'Aqours' },
    { replacementOwner: P2 },
    { replacementTop: false },
    { toZone: ZoneType.HAND },
    { controller: P2 },
    { sourceId: 'unrelated' },
    { eventIds: ['unrelated-event'] },
  ])('does not move energy for invalid event or replacement %j', (options) => {
    const done = resolve(setup(entry, options));
    expect(done.players[0].energyDeck.cardIds).toEqual(['energy']);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual([]);
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });
  it('continues if the source leaves waiting room and the replacement changes slot/orientation without leaving', () => {
    let game = resolvePendingCardEffects(setup(entry)).gameState;
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [] },
      hand: { ...p.hand, cardIds: ['source'] },
      memberSlots: placeCardInSlot(
        removeCardFromSlot(p.memberSlots, SlotPosition.RIGHT),
        SlotPosition.LEFT,
        'replacement',
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
      ),
    }));
    const done = choose(game);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual(['energy']);
    expect(done.players[0].hand.cardIds).toEqual(['source']);
  });
  it('rejects the replacement after a real later leave and reentry of the same card', () => {
    let game = resolvePendingCardEffects(setup(entry)).gameState;
    game = emitGameEvent(
      game,
      createLeaveStageEvent('replacement', SlotPosition.RIGHT, ZoneType.HAND, P1, P1)
    );
    game = emitGameEvent(
      game,
      createEnterStageEvent('replacement', ZoneType.HAND, SlotPosition.RIGHT, P1, P1)
    );
    const done = choose(game);
    expect(done.players[0].energyDeck.cardIds).toEqual(['energy']);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual([]);
    expect(done.actionHistory.at(-1)?.payload.replacementLeftAfterRelay).toBe(true);
  });
  it('reports zero actual placements for an empty energy deck', () => {
    const base = setup(entry, { energy: false });
    const done = resolve(base);
    expect(done.players[0].energyDeck.cardIds).toEqual([]);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual([]);
    expect(placedActions(done, entry.ability)[0]?.payload.placedEnergyCardIds).toEqual([]);
    expect(placementEvents(done)).toEqual([]);
  });
  it('accepts replacement history before this relay and selects only the matching pending leave event', () => {
    let game = setup(entry, { historyBeforeRelay: true });
    const leaves = game.eventLog.filter(
      ({ event }) => event.eventType === TriggerCondition.ON_LEAVE_STAGE
    );
    game = {
      ...game,
      pendingAbilities: game.pendingAbilities.map((ability) => ({
        ...ability,
        eventIds: leaves.map(({ event }) => event.eventId),
      })),
    };
    const done = resolve(game);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual(['energy']);
    expect(placedActions(done, entry.ability)[0]?.payload.leaveStageEventId).toBe(
      leaves[1]?.event.eventId
    );
  });
});

describe('relay energy-below queued continuation', () => {
  it('requires confirmation after manual selection but automatically resolves a committed ordered batch', () => {
    const first = setup(CASES[0]);
    const second = createNovember07DraftCard('PL!N-bp8-024', P1, 'source-two');
    let game: GameState = {
      ...first,
      cardRegistry: new Map([...first.cardRegistry, ['source-two', second]]),
    };
    const secondEvent = createLeaveStageEvent(
      'source-two',
      SlotPosition.LEFT,
      ZoneType.WAITING_ROOM,
      P1,
      P1,
      'replacement'
    );
    game = emitGameEvent(game, secondEvent);
    game = {
      ...game,
      pendingAbilities: [
        ...game.pendingAbilities,
        {
          ...game.pendingAbilities[0]!,
          id: 'second-relay',
          abilityId: LANZHU,
          sourceCardId: 'source-two',
          eventIds: [secondEvent.eventId],
        },
      ],
    };
    const order = resolvePendingCardEffects(game).gameState;
    expect(order.activeEffect?.stepId).toBe('SELECT_NEXT_PENDING_ABILITY');
    const manual = confirmActiveEffectStep(order, P1, order.activeEffect!.id, 'source');
    expect(manual.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(manual.players[0].energyDeck.cardIds).toEqual(['energy']);
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
    expect(ordered.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual(['energy']);
    expect(placedActions(ordered, SETSUNA)).toHaveLength(1);
    expect(placedActions(ordered, LANZHU)[0]?.payload.placedEnergyCardIds).toEqual([]);
  });
});
