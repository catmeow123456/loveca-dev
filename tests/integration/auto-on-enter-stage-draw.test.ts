import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent, type EnterStageEvent } from '../../src/domain/events/game-events';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  N_PR_025_AUTO_TWICE_PER_TURN_OWN_RELAY_MEMBER_ENTER_DRAW_ONE_ABILITY_ID,
  PL_N_PB1_005_AUTO_TURN_ONCE_COST_TEN_MEMBER_ENTER_DRAW_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { playMemberFromZoneToEmptySlot } from '../../src/application/card-effects/runtime/play-member-to-stage';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
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

const P1 = 'player1';
const P2 = 'player2';
const EFFECT_TEXT = '【自动】【1回合2次】自己的舞台中，此成员，或其他成员换手登场时，抽1张卡。';

function member(cardCode: string, name = cardCode, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function live(cardCode: string, score = 1): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score,
    requirements: { colorRequirements: new Map(), totalRequired: 0 },
  };
}

function deck(): DeckConfig {
  return {
    mainDeck: Array.from({ length: 60 }, (_, index) => member(`DECK-${index}`)),
    energyDeck: Array.from({ length: 12 }, (_, index) => energy(`ENERGY-${index}`)),
  };
}

function pending(sourceCardId: string, id: string): PendingAbilityState {
  return {
    id,
    abilityId: N_PR_025_AUTO_TWICE_PER_TURN_OWN_RELAY_MEMBER_ENTER_DRAW_ONE_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot: SlotPosition.CENTER,
  };
}

function relayEvent(
  enteredCardId: string,
  options: { fromZone?: ZoneType; controllerId?: string; legacyOnly?: boolean } = {}
): EnterStageEvent {
  const relay = options.legacyOnly
    ? { replacedMemberCardId: 'legacy-replaced' }
    : {
        relayReplacements: [
          { cardId: 'replaced-member', slot: SlotPosition.LEFT, effectiveCost: 4 },
        ],
      };
  return createEnterStageEvent(
    enteredCardId,
    options.fromZone ?? ZoneType.HAND,
    SlotPosition.LEFT,
    options.controllerId ?? P1,
    options.controllerId ?? P1,
    relay
  );
}

function setupLowLevel(
  sourceCount = 1,
  drawCount = 8
): {
  game: GameState;
  sourceIds: string[];
  enteredId: string;
  drawIds: string[];
} {
  const sources = Array.from({ length: sourceCount }, (_, index) =>
    createCardInstance(member('PL!N-PR-025-PR', '優木せつ菜', 15), P1, `setsuna-${index}`)
  );
  const entered = createCardInstance(member('TEST-INCOMING'), P1, 'incoming');
  const draws = Array.from({ length: drawCount }, (_, index) =>
    createCardInstance(member(`DRAW-${index}`), P1, `draw-${index}`)
  );
  let game = registerCards(createGameState('n-pr-025', P1, 'P1', P2, 'P2'), [
    ...sources,
    entered,
    ...draws,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    const slots = [SlotPosition.CENTER, SlotPosition.RIGHT, SlotPosition.LEFT];
    for (const [index, source] of sources.entries()) {
      memberSlots = placeCardInSlot(memberSlots, slots[index]!, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      mainDeck: draws.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.mainDeck),
    };
  });
  return {
    game,
    sourceIds: sources.map((source) => source.instanceId),
    enteredId: entered.instanceId,
    drawIds: draws.map((card) => card.instanceId),
  };
}

function pbPending(sourceCardId: string, id: string): PendingAbilityState {
  return {
    id,
    abilityId: PL_N_PB1_005_AUTO_TURN_ONCE_COST_TEN_MEMBER_ENTER_DRAW_ONE_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot: SlotPosition.CENTER,
  };
}

function setupPbLowLevel(
  options: {
    readonly sourceCount?: number;
    readonly enteredCost?: number;
    readonly drawCount?: number;
    readonly enteredControllerId?: string;
    readonly enteredData?: AnyCardData;
  } = {}
): {
  game: GameState;
  sourceIds: string[];
  enteredId: string;
  drawIds: string[];
} {
  const sourceCount = options.sourceCount ?? 1;
  const sources = Array.from({ length: sourceCount }, (_, index) =>
    createCardInstance(
      member(index % 2 === 0 ? 'PL!N-pb1-005-P＋' : 'PL!N-pb1-005-R', '宮下 爱', 2),
      P1,
      `ai-${index}`
    )
  );
  const enteredControllerId = options.enteredControllerId ?? P1;
  const entered = createCardInstance(
    options.enteredData ?? member('TEST-COST-ENTERED', 'Cost member', options.enteredCost ?? 10),
    enteredControllerId,
    'cost-entered'
  );
  const draws = Array.from({ length: options.drawCount ?? 8 }, (_, index) =>
    createCardInstance(member(`PB-DRAW-${index}`), P1, `pb-draw-${index}`)
  );
  let game = registerCards(createGameState('n-pb1-005', P1, 'P1', P2, 'P2'), [
    ...sources,
    entered,
    ...draws,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    const slots = [SlotPosition.CENTER, SlotPosition.RIGHT, SlotPosition.LEFT];
    for (const [index, source] of sources.entries()) {
      memberSlots = placeCardInSlot(memberSlots, slots[index]!, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      mainDeck: draws.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.mainDeck),
    };
  });
  return {
    game,
    sourceIds: sources.map((source) => source.instanceId),
    enteredId: entered.instanceId,
    drawIds: draws.map((card) => card.instanceId),
  };
}

function normalEnterEvent(
  enteredCardId: string,
  options: { readonly fromZone?: ZoneType; readonly controllerId?: string } = {}
): EnterStageEvent {
  const controllerId = options.controllerId ?? P1;
  return createEnterStageEvent(
    enteredCardId,
    options.fromZone ?? ZoneType.HAND,
    SlotPosition.LEFT,
    controllerId,
    controllerId
  );
}

function pbAbilityActions(game: GameState, step?: string) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        PL_N_PB1_005_AUTO_TURN_ONCE_COST_TEN_MEMBER_ENTER_DRAW_ONE_ABILITY_ID &&
      (step === undefined || action.payload.step === step)
  );
}

function enqueueEvent(game: GameState, event: EnterStageEvent): GameState {
  const withEvent = emitGameEvent(game, event);
  return enqueueTriggeredCardEffects(withEvent, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: [event],
  });
}

function abilityActions(game: GameState, step?: string) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        N_PR_025_AUTO_TWICE_PER_TURN_OWN_RELAY_MEMBER_ENTER_DRAW_ONE_ABILITY_ID &&
      (step === undefined || action.payload.step === step)
  );
}

function forceMainPhase(
  session: ReturnType<typeof createGameSession>,
  activePlayerIndex = 0
): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.MAIN_FREE;
  state.currentTurnType = TurnType.NORMAL;
  state.activePlayerIndex = activePlayerIndex;
  state.waitingPlayerId = null;
}

function setAuthorityState(session: ReturnType<typeof createGameSession>, state: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

function clearPublicZones(player: GameState['players'][number]): void {
  player.hand.cardIds = [];
  player.mainDeck.cardIds = [];
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
}

function productionScenario(selfRelay: boolean): {
  session: ReturnType<typeof createGameSession>;
  sourceId: string;
  incomingId: string;
  drawId: string;
} {
  const session = createGameSession();
  const config = deck();
  session.createGame(`n-pr-025-production-${selfRelay}`, P1, 'P1', P2, 'P2');
  session.initializeGame(config, config);
  forceMainPhase(session);

  const source = createCardInstance(member('PL!N-PR-025-PR', '優木せつ菜', 15), P1, 'source');
  const incoming = selfRelay
    ? source
    : createCardInstance(member('TEST-OTHER-INCOMING', 'Other Member', 6), P1, 'other-incoming');
  const replaced = createCardInstance(
    member('TEST-REPLACED', 'Replaced Member', 4),
    P1,
    'replaced'
  );
  const draw = createCardInstance(member('TEST-DRAW', 'Draw Card', 1), P1, 'draw');
  const cards = selfRelay ? [source, replaced, draw] : [source, incoming, replaced, draw];
  const state = registerCards(session.state!, cards);
  setAuthorityState(session, state);
  clearPublicZones(state.players[0]!);
  clearPublicZones(state.players[1]!);
  state.players[0]!.hand.cardIds = [incoming.instanceId];
  state.players[0]!.mainDeck.cardIds = [draw.instanceId];
  const sourceSlot = selfRelay ? SlotPosition.CENTER : SlotPosition.RIGHT;
  const targetSlot = selfRelay ? SlotPosition.CENTER : SlotPosition.LEFT;
  state.players[0]!.memberSlots = placeCardInSlot(
    state.players[0]!.memberSlots,
    targetSlot,
    replaced.instanceId,
    { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
  );
  if (!selfRelay) {
    state.players[0]!.memberSlots = placeCardInSlot(
      state.players[0]!.memberSlots,
      sourceSlot,
      source.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );
  }

  return {
    session,
    sourceId: source.instanceId,
    incomingId: incoming.instanceId,
    drawId: draw.instanceId,
  };
}

function pbProductionScenario(): {
  session: ReturnType<typeof createGameSession>;
  sourceId: string;
  incomingId: string;
  drawId: string;
} {
  const session = createGameSession();
  const config = deck();
  session.createGame('n-pb1-005-production', P1, 'P1', P2, 'P2');
  session.initializeGame(config, config);
  forceMainPhase(session);

  const source = createCardInstance(member('PL!N-pb1-005-P＋', '宮下 爱', 2), P1, 'pb-source');
  const incoming = createCardInstance(member('TEST-COST-TEN', 'Cost ten', 10), P1, 'pb-incoming');
  const draw = createCardInstance(member('TEST-PB-DRAW', 'Draw Card', 1), P1, 'pb-draw');
  const state = registerCards(session.state!, [source, incoming, draw]);
  setAuthorityState(session, state);
  clearPublicZones(state.players[0]!);
  clearPublicZones(state.players[1]!);
  state.players[0]!.hand.cardIds = [incoming.instanceId];
  state.players[0]!.mainDeck.cardIds = [draw.instanceId];
  state.players[0]!.memberSlots = placeCardInSlot(
    state.players[0]!.memberSlots,
    SlotPosition.CENTER,
    source.instanceId,
    { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
  );

  return {
    session,
    sourceId: source.instanceId,
    incomingId: incoming.instanceId,
    drawId: draw.instanceId,
  };
}

describe('PL!N-PR-025-PR 费用15「優木せつ菜」', () => {
  it.each([
    { selfRelay: true, label: '自身' },
    { selfRelay: false, label: '其他成员' },
  ])('通过真实生产换手路径让$label换手登场时触发并抽1', ({ selfRelay }) => {
    const scenario = productionScenario(selfRelay);
    const targetSlot = selfRelay ? SlotPosition.CENTER : SlotPosition.LEFT;
    const result = scenario.session.executeCommand(
      createPlayMemberToSlotCommand(P1, scenario.incomingId, targetSlot, { freePlay: true })
    );

    expect(result.success).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(scenario.drawId);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(abilityActions(scenario.session.state!, 'ABILITY_USE')).toHaveLength(1);
    const enterEvent = scenario.session.state?.eventLog
      .map((entry) => entry.event)
      .find(
        (event): event is EnterStageEvent =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          'cardInstanceId' in event &&
          event.cardInstanceId === scenario.incomingId
      );
    expect(enterEvent).toMatchObject({ fromZone: ZoneType.HAND });
    expect(enterEvent?.relayReplacements).toHaveLength(1);
  });

  it('uses only the first two of three real same-turn relay entries for one source', () => {
    const session = createGameSession();
    const config = deck();
    session.createGame('n-pr-025-real-turn2', P1, 'P1', P2, 'P2');
    session.initializeGame(config, config);
    forceMainPhase(session);
    const source = createCardInstance(
      member('PL!N-PR-025-PR', '優木せつ菜', 15),
      P1,
      'turn2-source'
    );
    const replaced = createCardInstance(member('TURN2-REPLACED'), P1, 'turn2-replaced');
    const incoming = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(member(`TURN2-INCOMING-${index}`), P1, `turn2-incoming-${index}`)
    );
    const draws = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(member(`TURN2-DRAW-${index}`), P1, `turn2-draw-${index}`)
    );
    const state = registerCards(session.state!, [source, replaced, ...incoming, ...draws]);
    setAuthorityState(session, state);
    clearPublicZones(state.players[0]!);
    clearPublicZones(state.players[1]!);
    state.players[0]!.hand.cardIds = incoming.map((card) => card.instanceId);
    state.players[0]!.mainDeck.cardIds = draws.map((card) => card.instanceId);
    state.players[0]!.memberSlots = placeCardInSlot(
      placeCardInSlot(state.players[0]!.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.LEFT,
      replaced.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );

    for (const card of incoming) {
      expect(
        session.executeCommand(
          createPlayMemberToSlotCommand(P1, card.instanceId, SlotPosition.LEFT, { freePlay: true })
        ).success
      ).toBe(true);
    }
    expect(abilityActions(session.state!, 'ABILITY_USE')).toHaveLength(2);
    expect(session.state?.players[0].hand.cardIds).toEqual(
      expect.arrayContaining(draws.slice(0, 2).map((card) => card.instanceId))
    );
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([draws[2]!.instanceId]);
  });

  it('does not trigger for ordinary empty-slot entry, opponent entry, non-HAND replacement, or no relay fact', () => {
    const scenario = setupLowLevel();
    const events = [
      createEnterStageEvent(scenario.enteredId, ZoneType.HAND, SlotPosition.LEFT, P1, P1),
      relayEvent(scenario.enteredId, { controllerId: P2 }),
      relayEvent(scenario.enteredId, { fromZone: ZoneType.WAITING_ROOM }),
    ];
    let game = scenario.game;
    for (const event of events) {
      game = enqueueEvent(game, event);
    }
    expect(game.pendingAbilities).toEqual([]);
  });

  it('accepts the legacy replacedMemberCardId relay fact but does not listen from hand, waiting room, or memberBelow', () => {
    const scenario = setupLowLevel();
    const legacyQueued = enqueueEvent(
      scenario.game,
      relayEvent(scenario.enteredId, { legacyOnly: true })
    );
    expect(legacyQueued.pendingAbilities).toHaveLength(1);

    const sourceId = scenario.sourceIds[0]!;
    const noStageStates = [
      updatePlayer(scenario.game, P1, (player) => ({
        ...player,
        hand: addCardToZone(player.hand, sourceId),
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      })),
      updatePlayer(scenario.game, P1, (player) => ({
        ...player,
        waitingRoom: addCardToZone(player.waitingRoom, sourceId),
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      })),
      updatePlayer(scenario.game, P1, (player) => {
        const memberSlots = removeCardFromSlot(player.memberSlots, SlotPosition.CENTER);
        return {
          ...player,
          memberSlots: {
            ...memberSlots,
            memberBelow: {
              ...memberSlots.memberBelow,
              [SlotPosition.CENTER]: [sourceId],
            },
          },
        };
      }),
    ];
    for (const noStageSource of noStageStates) {
      expect(enqueueEvent(noStageSource, relayEvent(scenario.enteredId)).pendingAbilities).toEqual(
        []
      );
    }
  });

  it('deduplicates one eventId and lets two queued pending uses occupy the turn2 limit', () => {
    const scenario = setupLowLevel();
    const firstEvent = relayEvent(scenario.enteredId);
    let game = enqueueEvent(scenario.game, firstEvent);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE], {
      enterStageEvents: [firstEvent],
    });
    expect(game.pendingAbilities).toHaveLength(1);

    game = enqueueEvent(game, relayEvent(scenario.enteredId));
    expect(game.pendingAbilities).toHaveLength(2);
    game = enqueueEvent(game, relayEvent(scenario.enteredId));
    expect(game.pendingAbilities).toHaveLength(2);
  });

  it('resolves twice, blocks the third use, resets next turn, and tracks source instances independently', () => {
    const scenario = setupLowLevel(2, 12);
    let game = scenario.game;
    for (let index = 0; index < 3; index += 1) {
      game = enqueueEvent(game, relayEvent(scenario.enteredId));
      game = resolvePendingCardEffects(game).gameState;
      if (game.activeEffect?.abilityId === ABILITY_ORDER_SELECTION_ID) {
        game = confirmActiveEffectStep(game, P1, game.activeEffect.id, null, null, true);
      }
    }
    expect(abilityActions(game, 'ABILITY_USE')).toHaveLength(4);
    expect(
      abilityActions(game, 'ABILITY_USE').filter(
        (action) => action.payload.sourceCardId === scenario.sourceIds[0]
      )
    ).toHaveLength(2);
    expect(
      abilityActions(game, 'ABILITY_USE').filter(
        (action) => action.payload.sourceCardId === scenario.sourceIds[1]
      )
    ).toHaveLength(2);

    game = { ...game, turnCount: game.turnCount + 1 };
    game = resolvePendingCardEffects(enqueueEvent(game, relayEvent(scenario.enteredId))).gameState;
    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id, null, null, true);
    expect(abilityActions(game, 'ABILITY_USE')).toHaveLength(6);
  });

  it('still draws after the source leaves once its pending ability is queued', () => {
    const scenario = setupLowLevel(1, 1);
    const queued = enqueueEvent(scenario.game, relayEvent(scenario.enteredId));
    const withoutSource = updatePlayer(queued, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const resolved = resolvePendingCardEffects(withoutSource).gameState;
    expect(resolved.pendingAbilities).toEqual([]);
    expect(abilityActions(resolved, 'ABILITY_USE')).toHaveLength(1);
    expect(resolved.players[0].hand.cardIds).toContain(scenario.drawIds[0]);
  });

  it('records use and consumes the pending ability even when zero cards can be drawn', () => {
    const scenario = setupLowLevel(1, 0);
    const resolved = resolvePendingCardEffects(
      enqueueEvent(scenario.game, relayEvent(scenario.enteredId))
    ).gameState;
    expect(resolved.pendingAbilities).toEqual([]);
    expect(abilityActions(resolved, 'ABILITY_USE')).toHaveLength(1);
    expect(
      abilityActions(resolved, 'DRAW_ONE_AFTER_OWN_RELAY_MEMBER_ENTER')[0]?.payload
    ).toMatchObject({
      drawnCardIds: [],
    });
  });

  it('auto-resolves a single pending and an ordered batch without confirmation', () => {
    const scenario = setupLowLevel(1, 4);
    const single = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [pending(scenario.sourceIds[0]!, 'single')],
    }).gameState;
    expect(single.activeEffect).toBeNull();
    expect(single.pendingAbilities).toEqual([]);

    const orderSelection = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [
        pending(scenario.sourceIds[0]!, 'ordered-1'),
        pending(scenario.sourceIds[0]!, 'ordered-2'),
      ],
    }).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const ordered = confirmActiveEffectStep(
      orderSelection,
      P1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(abilityActions(ordered, 'DRAW_ONE_AFTER_OWN_RELAY_MEMBER_ENTER')).toHaveLength(2);
  });

  it('uses exact confirm-only copy for manual queue selection and confirms only once', () => {
    const scenario = setupLowLevel(3, 6);
    const selection = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [
        pending(scenario.sourceIds[0]!, 'manual-1'),
        pending(scenario.sourceIds[1]!, 'manual-2'),
        pending(scenario.sourceIds[2]!, 'manual-3'),
      ],
    }).gameState;
    const bridge = confirmActiveEffectStep(
      selection,
      P1,
      selection.activeEffect!.id,
      scenario.sourceIds[0]
    );
    expect(bridge.activeEffect).toMatchObject({
      id: 'manual-1',
      effectText: EFFECT_TEXT,
      stepText: '确认后结算此效果。',
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(bridge.players[0].hand.cardIds).toEqual([]);

    const afterConfirm = confirmActiveEffectStep(bridge, P1, bridge.activeEffect!.id);
    expect(abilityActions(afterConfirm, 'DRAW_ONE_AFTER_OWN_RELAY_MEMBER_ENTER')).toHaveLength(1);
    expect(afterConfirm.players[0].hand.cardIds).toHaveLength(1);
    expect(afterConfirm.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(afterConfirm.pendingAbilities.map((ability) => ability.id)).toEqual([
      'manual-2',
      'manual-3',
    ]);
  });
});

describe('PL!N-pb1-005-P＋ / R 费用2「宮下 爱」', () => {
  const effectText = '【自动】【1回合1次】费用为10的成员登场至自己的舞台时，抽1张卡。';

  it('通过真实 PLAY_MEMBER -> ON_ENTER_STAGE 生产路径匹配印刷费用10并抽1', () => {
    const scenario = pbProductionScenario();
    const result = scenario.session.executeCommand(
      createPlayMemberToSlotCommand(P1, scenario.incomingId, SlotPosition.LEFT, { freePlay: true })
    );

    expect(result.success).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(scenario.drawId);
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(pbAbilityActions(scenario.session.state!, 'ABILITY_USE')).toHaveLength(1);
    expect(
      scenario.session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          'cardInstanceId' in entry.event &&
          entry.event.cardInstanceId === scenario.incomingId
      )
    ).toBe(true);
  });

  it('通过真实卡效从检视区登场也匹配，不错误限制 triggerFromZones', () => {
    const scenario = setupPbLowLevel({ drawCount: 1 });
    const withInspectionCard: GameState = {
      ...scenario.game,
      inspectionZone: {
        ...scenario.game.inspectionZone,
        cardIds: [scenario.enteredId],
      },
    };
    const played = playMemberFromZoneToEmptySlot(withInspectionCard, P1, {
      cardId: scenario.enteredId,
      sourceZone: ZoneType.INSPECTION_ZONE,
      toSlot: SlotPosition.LEFT,
    });
    const enterStageEvent = played?.gameState.eventLog.at(-1)?.event as EnterStageEvent | undefined;
    expect(enterStageEvent?.fromZone).toBe(ZoneType.INSPECTION_ZONE);
    const queued = enqueueTriggeredCardEffects(
      played!.gameState,
      [TriggerCondition.ON_ENTER_STAGE],
      { enterStageEvents: [enterStageEvent!] }
    );
    const resolved = resolvePendingCardEffects(queued).gameState;
    expect(resolved.players[0].hand.cardIds).toContain(scenario.drawIds[0]);
    expect(pbAbilityActions(resolved, 'DRAW_ONE_AFTER_COST_TEN_MEMBER_ENTER')).toHaveLength(1);
  });

  it.each([
    { label: '印刷费用9成员', enteredCost: 9 },
    { label: '印刷费用11成员', enteredCost: 11 },
  ])('$label 不匹配且不记录 ABILITY_USE', ({ enteredCost }) => {
    const scenario = setupPbLowLevel({ enteredCost });
    const game = enqueueEvent(scenario.game, normalEnterEvent(scenario.enteredId));
    expect(game.pendingAbilities).toEqual([]);
    expect(pbAbilityActions(game, 'ABILITY_USE')).toEqual([]);
  });

  it('LIVE 卡即使伪造 cost 10 字段也不匹配', () => {
    const forgedLive = { ...live('FORGED-COST-TEN-LIVE'), cost: 10 } as unknown as AnyCardData;
    const scenario = setupPbLowLevel({ enteredData: forgedLive });
    const game = enqueueEvent(scenario.game, normalEnterEvent(scenario.enteredId));
    expect(game.pendingAbilities).toEqual([]);
    expect(pbAbilityActions(game, 'ABILITY_USE')).toEqual([]);
  });

  it('对方印刷费用10成员登场不匹配', () => {
    const scenario = setupPbLowLevel({ enteredControllerId: P2 });
    const game = enqueueEvent(
      scenario.game,
      normalEnterEvent(scenario.enteredId, { controllerId: P2 })
    );
    expect(game.pendingAbilities).toEqual([]);
    expect(pbAbilityActions(game, 'ABILITY_USE')).toEqual([]);
  });

  it('只比较成员 data.cost，有效费用修正为3时仍按印刷费用10匹配', () => {
    const scenario = setupPbLowLevel();
    const modified = addLiveModifier(scenario.game, {
      kind: 'MEMBER_COST',
      playerId: P1,
      memberCardId: scenario.enteredId,
      sourceCardId: scenario.sourceIds[0]!,
      abilityId: 'test:effective-cost-reduction',
      countDelta: -7,
    });
    expect(getMemberEffectiveCost(modified, P1, scenario.enteredId)).toBe(3);
    expect(
      enqueueEvent(modified, normalEnterEvent(scenario.enteredId)).pendingAbilities
    ).toHaveLength(1);
  });

  it('同一来源同回合第二次不入队，新回合恢复', () => {
    const scenario = setupPbLowLevel({ drawCount: 3 });
    let game = resolvePendingCardEffects(
      enqueueEvent(scenario.game, normalEnterEvent(scenario.enteredId))
    ).gameState;
    expect(pbAbilityActions(game, 'ABILITY_USE')).toHaveLength(1);

    game = enqueueEvent(game, normalEnterEvent(scenario.enteredId));
    expect(game.pendingAbilities).toEqual([]);
    expect(pbAbilityActions(game, 'ABILITY_USE')).toHaveLength(1);

    game = { ...game, turnCount: game.turnCount + 1 };
    game = resolvePendingCardEffects(
      enqueueEvent(game, normalEnterEvent(scenario.enteredId))
    ).gameState;
    expect(pbAbilityActions(game, 'ABILITY_USE')).toHaveLength(2);
  });

  it('两张来源分别拥有自己的每回合1次，pending 预占后同回合不再入队', () => {
    const scenario = setupPbLowLevel({ sourceCount: 2 });
    let game = enqueueEvent(scenario.game, normalEnterEvent(scenario.enteredId));
    expect(game.pendingAbilities).toHaveLength(2);
    expect(new Set(game.pendingAbilities.map((ability) => ability.sourceCardId))).toEqual(
      new Set(scenario.sourceIds)
    );
    game = enqueueEvent(game, normalEnterEvent(scenario.enteredId));
    expect(game.pendingAbilities).toHaveLength(2);
  });

  it('单 pending 和 ordered batch 自动结算，不打开 confirm-only', () => {
    const scenario = setupPbLowLevel({ drawCount: 4 });
    const single = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [pbPending(scenario.sourceIds[0]!, 'pb-single')],
    }).gameState;
    expect(single.activeEffect).toBeNull();
    expect(single.pendingAbilities).toEqual([]);

    const orderSelection = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [
        pbPending(scenario.sourceIds[0]!, 'pb-ordered-1'),
        pbPending(scenario.sourceIds[0]!, 'pb-ordered-2'),
      ],
    }).gameState;
    const ordered = confirmActiveEffectStep(
      orderSelection,
      P1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(pbAbilityActions(ordered, 'DRAW_ONE_AFTER_COST_TEN_MEMBER_ENTER')).toHaveLength(2);
  });

  it('多 pending 手动选择时只打开一次 confirm-only bridge', () => {
    const scenario = setupPbLowLevel({ sourceCount: 3, drawCount: 6 });
    const selection = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: scenario.sourceIds.map((sourceId, index) =>
        pbPending(sourceId, `pb-manual-${index}`)
      ),
    }).gameState;
    const bridge = confirmActiveEffectStep(
      selection,
      P1,
      selection.activeEffect!.id,
      scenario.sourceIds[0]
    );
    expect(bridge.activeEffect).toMatchObject({
      id: 'pb-manual-0',
      effectText,
      stepText: '确认后结算此效果。',
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(bridge.players[0].hand.cardIds).toEqual([]);

    const afterConfirm = confirmActiveEffectStep(bridge, P1, bridge.activeEffect!.id);
    expect(pbAbilityActions(afterConfirm, 'DRAW_ONE_AFTER_COST_TEN_MEMBER_ENTER')).toHaveLength(1);
    expect(afterConfirm.players[0].hand.cardIds).toHaveLength(1);
    expect(afterConfirm.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(afterConfirm.pendingAbilities).toHaveLength(2);
  });

  it('入队后来源离场仍抽1', () => {
    const scenario = setupPbLowLevel({ drawCount: 1 });
    const queued = enqueueEvent(scenario.game, normalEnterEvent(scenario.enteredId));
    const withoutSource = updatePlayer(queued, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const resolved = resolvePendingCardEffects(withoutSource).gameState;
    expect(resolved.players[0].hand.cardIds).toContain(scenario.drawIds[0]);
    expect(pbAbilityActions(resolved, 'ABILITY_USE')).toHaveLength(1);
  });

  it('空牌库抽0仍消费 pending、记录使用并继续实时 pending 池', () => {
    const scenario = setupPbLowLevel({ drawCount: 0 });
    const continuationSource = createCardInstance(
      member('TEST-CONTINUATION-SOURCE'),
      P1,
      'pb-continuation-source'
    );
    let game = registerCards(scenario.game, [continuationSource]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.RIGHT,
        continuationSource.instanceId
      ),
    }));
    const order = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pbPending(scenario.sourceIds[0]!, 'pb-empty-deck'),
        {
          id: 'pb-live-pool-continuation',
          abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
          sourceCardId: continuationSource.instanceId,
          controllerId: P1,
          mandatory: true,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.RIGHT,
        },
      ],
    }).gameState;
    const resolved = confirmActiveEffectStep(order, P1, order.activeEffect!.id, null, null, true);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(pbAbilityActions(resolved, 'ABILITY_USE')).toHaveLength(1);
    expect(
      pbAbilityActions(resolved, 'DRAW_ONE_AFTER_COST_TEN_MEMBER_ENTER')[0]?.payload
    ).toMatchObject({ drawnCardIds: [] });
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID
      )
    ).toBe(true);
  });
});
