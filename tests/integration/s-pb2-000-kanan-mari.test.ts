import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type AnyCardData,
  type MemberCardData,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createLeaveStageEvent,
  createLiveStartEvent,
  createTurnStartEvent,
} from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import {
  S_PB2_000_CONTINUOUS_DOUBLE_RELAY_ABILITY_ID,
  S_PB2_000_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  S_PB2_000_LIVE_START_DOUBLE_AQOURS_RELAY_STACK_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const LIVE_ABILITY = S_PB2_000_LIVE_START_DOUBLE_AQOURS_RELAY_STACK_LIVE_ABILITY_ID;
const SOURCE = 'source';
function member(code: string, group = 'Aqours', cost = 1): MemberCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    groupNames: [group],
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}
function live(code: string, group = 'Aqours'): LiveCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.LIVE,
    groupNames: [group],
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}
function fixture(options: { group?: string; count?: number; empty?: boolean } = {}) {
  const cards = [
    createCardInstance(member('PL!S-pb2-000-DUO', 'Aqours', 15), P1, SOURCE),
    createCardInstance(member('REPLACEMENT-A', 'Aqours', 7), P1, 'a'),
    createCardInstance(member('REPLACEMENT-B', options.group ?? 'Aqours', 5), P1, 'b'),
    createCardInstance(live('LIVE-A'), P1, 'live-a'),
    createCardInstance(live('LIVE-B'), P1, 'live-b'),
    createCardInstance(live('OTHER-LIVE', 'Liella!'), P1, 'other-live'),
    createCardInstance(member('AQOURS-MEMBER'), P1, 'not-live'),
    createCardInstance(live('OPPONENT-LIVE'), P2, 'opponent-live'),
    createCardInstance(member('DECK'), P1, 'deck'),
  ];
  let game = registerCards(createGameState('kanan-mari', P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, SOURCE),
    mainDeck: { ...p.mainDeck, cardIds: ['deck'] },
    waitingRoom: {
      ...p.waitingRoom,
      cardIds: options.empty
        ? ['a', 'b']
        : ['a', 'b', 'live-a', 'live-b', 'other-live', 'not-live', 'opponent-live'],
    },
  }));
  game = emitGameEvent(game, createTurnStartEvent(1, P1));
  const entry = createEnterStageEvent(SOURCE, ZoneType.HAND, SlotPosition.CENTER, P1, P1, {
    relayReplacements: [
      { cardId: 'a', slot: SlotPosition.CENTER, effectiveCost: 7 },
      { cardId: 'b', slot: SlotPosition.LEFT, effectiveCost: 5 },
    ].slice(0, options.count ?? 2),
  });
  game = emitGameEvent(game, entry);
  const trigger = createLiveStartEvent(P1, []);
  game = emitGameEvent(game, trigger);
  const pending: PendingAbilityState = {
    id: 'live-pending',
    abilityId: LIVE_ABILITY,
    sourceCardId: SOURCE,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [trigger.eventId],
  };
  return { game: { ...game, pendingAbilities: [pending] }, entry, trigger };
}
const resolve = (game: GameState) => resolvePendingCardEffects(game).gameState;
function select(game: GameState, ids: readonly string[]) {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    ids
  );
}
function finishManualNoOp(game: GameState) {
  const started = resolve(game);
  expect(started.activeEffect?.effectText).toContain('实际不放置卡片');
  return confirmActiveEffectStep(started, P1, started.activeEffect!.id);
}

describe('PL!S-pb2-000 费用15「松浦果南&小原鞠莉」', () => {
  it('covers all rarities with three exact-text abilities', () => {
    const expected = new Map([
      [
        S_PB2_000_CONTINUOUS_DOUBLE_RELAY_ABILITY_ID,
        '【常时】打出此卡时，可以与２名成员进行换手。',
      ],
      [
        S_PB2_000_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
        '【登场】抽２张卡，将２张手牌放置入休息室。',
      ],
      [
        LIVE_ABILITY,
        '【LIVE开始时】此回合，此成员与２名『Aqours』的成员换手登场的场合，将存在于自己的休息室的至多２张『Aqours』的LIVE卡按任意顺序放置于卡组顶。',
      ],
    ]);
    for (const code of ['PL!S-pb2-000-DUO', 'PL!S-pb2-000-UNSEEN']) {
      const definitions = getCardAbilityDefinitionsForCardCode(code);
      expect(definitions).toHaveLength(3);
      for (const def of definitions) expect(def.effectText).toBe(expected.get(def.abilityId));
    }
  });

  it('queues the LIVE-start ability through the real trigger, filtering own Aqours LIVE candidates', () => {
    const { game } = fixture();
    const queued = enqueueTriggeredCardEffects({ ...game, pendingAbilities: [] }, [
      TriggerCondition.ON_LIVE_START,
    ]);
    expect(queued.pendingAbilities).toHaveLength(1);
    expect(queued.pendingAbilities[0]?.eventIds).toEqual([game.eventLog.at(-1)!.event.eventId]);
    const selecting = resolve(queued);
    expect(selecting.activeEffect).toMatchObject({
      abilityId: LIVE_ABILITY,
      selectableCardIds: ['live-a', 'live-b'],
      minSelectableCards: 0,
      maxSelectableCards: 2,
      selectableCardMode: 'ORDERED_MULTI',
    });
  });

  it('reveals [B,A] without moving, then accepts either player deadline and emits one ordered movement event', () => {
    const selecting = resolve(fixture().game);
    const session = createGameSession();
    session.createGame('ordered', P1, 'P1', P2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = selecting;
    const id = selecting.activeEffect!.id;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(P1, id, undefined, undefined, undefined, undefined, [
          'live-b',
          'live-a',
        ])
      ).success
    ).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: ['live-b', 'live-a'],
    });
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('live-b');
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['deck']);
    expect(
      session.state!.eventLog.some(
        ({ event }) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      )
    ).toBe(false);
    const deadline = session.state!.activeEffect!.publicCardSelectionAutoAdvanceAt!;
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, id, deadline)).success
    ).toBe(false);
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      activeEffect: { ...session.state!.activeEffect!, publicCardSelectionAutoAdvanceAt: 0 },
    };
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, id, 0)).success
    ).toBe(true);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual(['live-b', 'live-a', 'deck']);
    const events = session.state!.eventLog.filter(
      ({ event }) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toMatchObject({
      movedCardIds: ['live-b', 'live-a'],
      destination: { kind: 'TOP' },
      cause: { abilityId: LIVE_ABILITY, sourceCardId: SOURCE, pendingAbilityId: id },
    });
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, id, 0)).success
    ).toBe(false);
  });

  it('skips zero without a public window and rejects duplicate, over-limit, wrong-group and foreign selections', () => {
    const selecting = resolve(fixture().game);
    for (const ids of [
      ['live-a', 'live-a'],
      ['live-a', 'live-b', 'other-live'],
      ['other-live'],
      ['not-live'],
      ['opponent-live'],
    ]) {
      expect(select(selecting, ids)).toBe(selecting);
    }
    const skipped = select(selecting, []);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.players[0].mainDeck.cardIds).toEqual(['deck']);
  });

  it('never partially moves a stale public selection, and reopens only the remaining legal targets', () => {
    let game = select(resolve(fixture().game), ['live-a', 'live-b']);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: {
        ...p.waitingRoom,
        cardIds: p.waitingRoom.cardIds.filter((id) => id !== 'live-a'),
      },
      hand: { ...p.hand, cardIds: ['live-a'] },
    }));
    const restored = confirmActiveEffectStep(game, P1, game.activeEffect!.id);
    expect(restored.players[0].mainDeck.cardIds).toEqual(['deck']);
    expect(restored.activeEffect).toMatchObject({
      selectableCardIds: ['live-b'],
      maxSelectableCards: 1,
    });
    const renewed = select(restored, ['live-b']);
    expect(renewed.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
  });

  it.each([{ count: 0 }, { count: 1 }, { group: 'Liella!' }, { empty: true }])(
    'safely confirms a failed relay condition or absent targets: %j',
    (options) => {
      const finished = finishManualNoOp(fixture(options).game);
      expect(finished.activeEffect).toBeNull();
      expect(finished.players[0].mainDeck.cardIds).toEqual(['deck']);
    }
  );

  it('rejects old-turn relay history and ordinary re-entry before LIVE start while preserving triggered provenance', () => {
    const base = fixture();
    let oldTurn = emitGameEvent(base.game, createTurnStartEvent(2, P2));
    const laterLive = createLiveStartEvent(P1, []);
    oldTurn = emitGameEvent(oldTurn, laterLive);
    oldTurn = {
      ...oldTurn,
      pendingAbilities: [{ ...oldTurn.pendingAbilities[0]!, eventIds: [laterLive.eventId] }],
    };
    expect(finishManualNoOp(oldTurn).activeEffect).toBeNull();

    let reentered = emitGameEvent(
      base.game,
      createLeaveStageEvent(SOURCE, SlotPosition.CENTER, ZoneType.WAITING_ROOM, P1, P1)
    );
    reentered = emitGameEvent(
      reentered,
      createEnterStageEvent(SOURCE, ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    const nextLive = createLiveStartEvent(P1, []);
    reentered = emitGameEvent(reentered, nextLive);
    const ordinaryPending = { ...reentered.pendingAbilities[0]!, eventIds: [nextLive.eventId] };
    expect(
      finishManualNoOp({ ...reentered, pendingAbilities: [ordinaryPending] }).activeEffect
    ).toBeNull();
    // The original pending belongs to the old rules object at its triggering LIVE start.
    expect(resolve(reentered).activeEffect?.selectableCardIds).toEqual(['live-a', 'live-b']);
  });

  it('keeps historical relay qualification when replaced cards move away and the queued source leaves', () => {
    let game = fixture().game;
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: {
        ...p.waitingRoom,
        cardIds: p.waitingRoom.cardIds.filter((id) => !['a', 'b'].includes(id)),
      },
      hand: { ...p.hand, cardIds: ['a', 'b', SOURCE] },
      memberSlots: {
        ...p.memberSlots,
        slots: { ...p.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    game = emitGameEvent(
      game,
      createLeaveStageEvent(SOURCE, SlotPosition.CENTER, ZoneType.HAND, P1, P1)
    );
    expect(resolve(game).activeEffect?.selectableCardIds).toEqual(['live-a', 'live-b']);
  });

  it.each(['card', 'slot'] as const)('rejects malformed duplicate relay %s snapshots', (kind) => {
    const { game, entry } = fixture();
    const first = entry.relayReplacements![0]!;
    const second = entry.relayReplacements![1]!;
    const changed: GameState = {
      ...game,
      eventLog: game.eventLog.map((item) =>
        item.event.eventId === entry.eventId
          ? {
              ...item,
              event: {
                ...entry,
                relayReplacements: [
                  first,
                  {
                    ...second,
                    ...(kind === 'card' ? { cardId: first.cardId } : { slot: first.slot }),
                  },
                ],
              },
            }
          : item
      ),
    };
    expect(finishManualNoOp(changed).activeEffect).toBeNull();
  });

  it('discards only the available hand when the draw cannot produce two cards', () => {
    const base = updatePlayer(fixture().game, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [] },
    }));
    const game: GameState = {
      ...base,
      pendingAbilities: [
        {
          ...base.pendingAbilities[0]!,
          abilityId: S_PB2_000_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
        },
      ],
    };
    const started = resolve(game);
    expect(started.activeEffect).toMatchObject({
      selectableCardIds: ['deck'],
      minSelectableCards: 1,
      maxSelectableCards: 1,
    });
    const done = select(started, ['deck']);
    expect(done.players[0].waitingRoom.cardIds).toContain('deck');
    expect(done.activeEffect).toBeNull();
  });

  it.each(['ordinary', 'single', 'double'] as const)(
    'draws two and discards two on a real %s play',
    (mode) => {
      const session = createGameSession();
      const deck = {
        mainDeck: Array.from({ length: 61 }, (_, i) => member(`DECK-${i}`)) as AnyCardData[],
        energyDeck: Array.from({ length: 12 }, (_, i) => ({
          cardCode: `E-${i}`,
          name: `E-${i}`,
          cardType: CardType.ENERGY as const,
        })),
      };
      session.createGame('real-play', P1, 'P1', P2, 'P2');
      session.initializeGame(deck, deck);
      const source = createCardInstance(member('PL!S-pb2-000-DUO', 'Aqours', 15), P1, SOURCE);
      const a = createCardInstance(member('A', 'Liella!', 7), P1, 'a');
      const b = createCardInstance(member('B', "μ's", 5), P1, 'b');
      const draws = ['draw-a', 'draw-b', 'sentinel'].map((id) =>
        createCardInstance(member(id), P1, id)
      );
      const energies = Array.from({ length: 15 }, (_, i) =>
        createCardInstance(
          {
            cardCode: `TEST-E-${i}`,
            name: `E${i}`,
            cardType: CardType.ENERGY,
          },
          P1,
          `test-e-${i}`
        )
      );
      let game = registerCards(session.state!, [source, a, b, ...draws, ...energies]);
      game = updatePlayer(game, P1, (p) => ({
        ...p,
        hand: { ...p.hand, cardIds: [SOURCE] },
        mainDeck: { ...p.mainDeck, cardIds: draws.map((c) => c.instanceId) },
        energyZone: {
          ...p.energyZone,
          cardIds: energies.map((c) => c.instanceId),
          cardStates: new Map(
            energies.map((c) => [
              c.instanceId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
          ),
        },
        memberSlots:
          mode === 'ordinary'
            ? p.memberSlots
            : placeCardInSlot(
                mode === 'double'
                  ? placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'b')
                  : p.memberSlots,
                SlotPosition.CENTER,
                'a'
              ),
        movedToStageThisTurn: [],
      }));
      (session as unknown as { authorityState: GameState }).authorityState = {
        ...game,
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
        currentTurnType: TurnType.NORMAL,
        activePlayerIndex: 0,
        waitingPlayerId: null,
      };
      const play = session.executeCommand(
        createPlayMemberToSlotCommand(
          P1,
          SOURCE,
          SlotPosition.CENTER,
          mode === 'double'
            ? {
                relayMode: 'DOUBLE',
                relayReplacementSlots: [SlotPosition.CENTER, SlotPosition.LEFT],
              }
            : undefined
        )
      );
      expect(play.success, play.error).toBe(true);
      const effect = session.state!.activeEffect!;
      expect(effect).toMatchObject({
        abilityId: S_PB2_000_ON_ENTER_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
        selectableCardIds: ['draw-a', 'draw-b'],
        minSelectableCards: 2,
        maxSelectableCards: 2,
      });
      const entry = session.state!.eventLog.find(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE && event.cardInstanceId === SOURCE
      )!.event;
      expect('relayReplacements' in entry ? (entry.relayReplacements?.length ?? 0) : 0).toBe(
        mode === 'double' ? 2 : mode === 'single' ? 1 : 0
      );
      expect(
        session.state!.actionHistory.find(
          (a) => a.type === 'PAY_COST' && a.payload.sourceCardId === SOURCE
        )?.payload.amount
      ).toBe(mode === 'double' ? 3 : mode === 'single' ? 8 : 15);
      const discarded = session.executeCommand(
        createConfirmEffectStepCommand(P1, effect.id, undefined, undefined, undefined, undefined, [
          'draw-a',
          'draw-b',
        ])
      );
      expect(discarded.success, discarded.error).toBe(true);
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual(
        expect.arrayContaining(['draw-a', 'draw-b'])
      );
      const discardEvents = session.state!.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          'cardInstanceIds' in event &&
          event.cardInstanceIds?.includes('draw-a')
      );
      expect(discardEvents).toHaveLength(1);
      expect(session.state!.activeEffect).toBeNull();
    }
  );
});
