import { describe, expect, it } from 'vitest';
import type { AnyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { collectLiveModifiers } from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP6_001_ON_ENTER_FROM_WAITING_WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER_ABILITY_ID,
  S_BP6_006_ON_ENTER_DRAW_TWO_FROM_WAITING_GAIN_THREE_BLADE_ABILITY_ID,
  S_BP6_011_ON_ENTER_FROM_WAITING_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
  S_BP6_016_ON_ENTER_FROM_WAITING_LOOK_TOP_THREE_TAKE_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  consumeOnEnterSourceZoneMismatch,
  isOnEnterFromWaitingRoom,
} from '../../src/application/card-effects/runtime/on-enter-source-zone';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function baseGame(testId: string): GameState {
  return createGameState(testId, PLAYER1, 'P1', PLAYER2, 'P2');
}

function setupSource(options: {
  readonly testId: string;
  readonly abilityId: string;
  readonly sourceCardCode: string;
  readonly sourceName?: string;
  readonly sourceCost?: number;
  readonly fromZone?: ZoneType;
  readonly handCards?: readonly AnyCardData[];
  readonly deckCards?: readonly AnyCardData[];
  readonly extraCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly extraPending?: readonly PendingAbilityState[];
}): { readonly game: GameState; readonly sourceId: string; readonly handCardIds: readonly string[]; readonly deckCardIds: readonly string[] } {
  const source = createCardInstance(
    createMember(options.sourceCardCode, options.sourceName, options.sourceCost),
    PLAYER1,
    `${options.testId}-source`
  );
  const handCards = (options.handCards ?? []).map((card, index) =>
    createCardInstance(card, PLAYER1, `${options.testId}-hand-${index}`)
  );
  const deckCards = (options.deckCards ?? []).map((card, index) =>
    createCardInstance(card, PLAYER1, `${options.testId}-deck-${index}`)
  );
  let game = registerCards(baseGame(options.testId), [
    source,
    ...handCards,
    ...deckCards,
    ...(options.extraCards ?? []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    mainDeck: deckCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.mainDeck
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));

  return {
    game: {
      ...game,
      pendingAbilities: [
        pending(options.abilityId, source.instanceId, options.fromZone),
        ...(options.extraPending ?? []),
      ],
    },
    sourceId: source.instanceId,
    handCardIds: handCards.map((card) => card.instanceId),
    deckCardIds: deckCards.map((card) => card.instanceId),
  };
}

function pending(
  abilityId: string,
  sourceCardId: string,
  fromZone?: ZoneType,
  id = `${abilityId}:${sourceCardId}:pending`
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['manual-event'],
    sourceSlot: SlotPosition.CENTER,
    metadata: fromZone === undefined ? undefined : { fromZone },
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirmOne(game: GameState, selectedCardId: string | null): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    selectedCardId,
    null,
    undefined,
    null
  );
}

function confirmMany(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    undefined,
    null,
    selectedCardIds
  );
}

function enterWaitingRoomEventCardIds(game: GameState): readonly string[] {
  return game.eventLog.flatMap((entry) =>
    entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      ? (entry.event.cardInstanceIds ?? [entry.event.cardInstanceId])
      : []
  );
}

function latestResolvePayload(game: GameState, abilityId: string): Record<string, unknown> | null {
  const action = [...game.actionHistory]
    .reverse()
    .find(
      (entry) => entry.type === 'RESOLVE_ABILITY' && entry.payload.abilityId === abilityId
    );
  return action?.payload ?? null;
}

function publicEffectSummaryPayload(
  game: GameState,
  summaryStatus: 'STARTED' | 'COMPLETED'
): Record<string, unknown> | undefined {
  return game.actionHistory
    .map((action) => action.payload.publicEffectSummary)
    .find(
      (summary): summary is Record<string, unknown> =>
        typeof summary === 'object' &&
        summary !== null &&
        summary.summaryStatus === summaryStatus
    );
}

function putOpponentStage(
  game: GameState,
  cards: readonly {
    readonly cardId: string;
    readonly slot: SlotPosition;
    readonly orientation?: OrientationState;
  }[]
): GameState {
  return updatePlayer(game, PLAYER2, (player) => {
    let memberSlots = player.memberSlots;
    for (const card of cards) {
      memberSlots = placeCardInSlot(memberSlots, card.slot, card.cardId, {
        orientation: card.orientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });
}

describe('on-enter source-zone helper', () => {
  it('matches WAITING_ROOM and consumes HAND or missing source as no-op with continuation', () => {
    const game = baseGame('source-zone-helper');
    const waitingAbility = pending('test:waiting', 'source-1', ZoneType.WAITING_ROOM);
    const handAbility = pending('test:hand', 'source-2', ZoneType.HAND);
    const missingAbility = pending('test:missing', 'source-3');

    expect(isOnEnterFromWaitingRoom(waitingAbility)).toBe(true);
    expect(isOnEnterFromWaitingRoom(handAbility)).toBe(false);
    expect(isOnEnterFromWaitingRoom(missingAbility)).toBe(false);

    const consumed = consumeOnEnterSourceZoneMismatch(
      { ...game, pendingAbilities: [handAbility, missingAbility] },
      handAbility,
      {
        expectedFromZone: ZoneType.WAITING_ROOM,
        orderedResolution: true,
        continuePendingCardEffects: (state) => state,
      }
    );

    expect(consumed.pendingAbilities).toEqual([missingAbility]);
    expect(consumed.actionHistory.at(-1)?.payload).toMatchObject({
      pendingAbilityId: handAbility.id,
      abilityId: handAbility.abilityId,
      sourceCardId: handAbility.sourceCardId,
      sourceSlot: SlotPosition.CENTER,
      expectedFromZone: ZoneType.WAITING_ROOM,
      actualFromZone: ZoneType.HAND,
    });
  });
});

describe('PL!S-bp6 from waiting-room on-enter effects', () => {
  it('PL!S-bp6-001-P/R waits only opponent LEFT/RIGHT cost 13+ targets and continues pending', () => {
    const nextSource = createCardInstance(createMember('PL!S-bp6-006-P', '津島善子', 17), PLAYER1, 'next-yoshiko');
    const legalLeft = createCardInstance(createMember('TARGET-LEFT', 'Legal Left', 13), PLAYER2, 'target-left');
    const center = createCardInstance(createMember('TARGET-CENTER', 'Center', 20), PLAYER2, 'target-center');
    const lowRight = createCardInstance(createMember('TARGET-RIGHT-LOW', 'Low Right', 12), PLAYER2, 'target-low-right');
    const nextPending = pending(
      S_BP6_006_ON_ENTER_DRAW_TWO_FROM_WAITING_GAIN_THREE_BLADE_ABILITY_ID,
      nextSource.instanceId,
      ZoneType.HAND,
      'next-yoshiko-pending'
    );
    let scenario = setupSource({
      testId: 's-bp6-001-success',
      abilityId: S_BP6_001_ON_ENTER_FROM_WAITING_WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-001-P',
      sourceName: '高海千歌',
      sourceCost: 4,
      fromZone: ZoneType.WAITING_ROOM,
      deckCards: [createMember('DRAW-1'), createMember('DRAW-2')],
      extraCards: [nextSource, legalLeft, center, lowRight],
      extraPending: [nextPending],
    });
    let game = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, nextSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = putOpponentStage(game, [
      { cardId: legalLeft.instanceId, slot: SlotPosition.LEFT },
      { cardId: center.instanceId, slot: SlotPosition.CENTER },
      { cardId: lowRight.instanceId, slot: SlotPosition.RIGHT },
    ]);

    const selection = resolve(game);
    const started = confirmActiveEffectStep(
      selection,
      PLAYER1,
      selection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(started.activeEffect?.abilityId).toBe(
      S_BP6_001_ON_ENTER_FROM_WAITING_WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER_ABILITY_ID
    );
    expect(started.activeEffect?.selectableCardIds).toEqual([legalLeft.instanceId]);

    const finished = confirmOne(started, legalLeft.instanceId);

    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities).toEqual([]);
    expect(finished.players[1].memberSlots.cardStates.get(legalLeft.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(latestResolvePayload(finished, S_BP6_006_ON_ENTER_DRAW_TWO_FROM_WAITING_GAIN_THREE_BLADE_ABILITY_ID)).toMatchObject({
      step: 'DRAW_TWO_SOURCE_ZONE_MISMATCH_NO_BLADE',
      actualFromZone: ZoneType.HAND,
    });
  });

  it('PL!S-bp6-001 no-ops from hand', () => {
    const scenario = setupSource({
      testId: 's-bp6-001-hand',
      abilityId: S_BP6_001_ON_ENTER_FROM_WAITING_WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-001-R',
      sourceName: '高海千歌',
      fromZone: ZoneType.HAND,
    });

    const state = resolve(scenario.game);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(latestResolvePayload(state, S_BP6_001_ON_ENTER_FROM_WAITING_WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER_ABILITY_ID)).toMatchObject({
      expectedFromZone: ZoneType.WAITING_ROOM,
      actualFromZone: ZoneType.HAND,
    });
  });

  it('PL!S-bp6-001 skips when side targets are low cost or already waiting and center is ignored', () => {
    const lowLeft = createCardInstance(createMember('TARGET-LOW-LEFT', 'Low Left', 12), PLAYER2, 'target-low-left');
    const centerHigh = createCardInstance(
      createMember('TARGET-CENTER-HIGH', 'Center High', 20),
      PLAYER2,
      'target-center-high'
    );
    const waitingRight = createCardInstance(
      createMember('TARGET-WAITING-RIGHT', 'Waiting Right', 13),
      PLAYER2,
      'target-waiting-right'
    );
    const scenario = setupSource({
      testId: 's-bp6-001-no-target',
      abilityId: S_BP6_001_ON_ENTER_FROM_WAITING_WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-001-P',
      sourceName: '高海千歌',
      fromZone: ZoneType.WAITING_ROOM,
      extraCards: [lowLeft, centerHigh, waitingRight],
    });
    const game = putOpponentStage(scenario.game, [
      { cardId: lowLeft.instanceId, slot: SlotPosition.LEFT },
      { cardId: centerHigh.instanceId, slot: SlotPosition.CENTER },
      { cardId: waitingRight.instanceId, slot: SlotPosition.RIGHT, orientation: OrientationState.WAITING },
    ]);

    const state = resolve(game);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(latestResolvePayload(state, S_BP6_001_ON_ENTER_FROM_WAITING_WAIT_OPPONENT_SIDE_HIGH_COST_MEMBER_ABILITY_ID)).toMatchObject({
      step: 'SKIP_NO_TARGET',
      allowedSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      minCost: 13,
    });
  });

  it('PL!S-bp6-006 always draws two and only waiting-room source gains BLADE +3', () => {
    const handScenario = setupSource({
      testId: 's-bp6-006-hand',
      abilityId: S_BP6_006_ON_ENTER_DRAW_TWO_FROM_WAITING_GAIN_THREE_BLADE_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-006-R',
      sourceName: '津島善子',
      sourceCost: 17,
      fromZone: ZoneType.HAND,
      deckCards: [createMember('HAND-DRAW-1'), createMember('HAND-DRAW-2')],
    });

    const handState = resolve(handScenario.game);

    expect(handState.players[0].mainDeck.cardIds).toEqual([]);
    expect(handState.players[0].hand.cardIds).toEqual(handScenario.deckCardIds);
    expect(collectLiveModifiers(handState).filter((modifier) => modifier.kind === 'BLADE')).toEqual([]);

    const waitingScenario = setupSource({
      testId: 's-bp6-006-waiting',
      abilityId: S_BP6_006_ON_ENTER_DRAW_TWO_FROM_WAITING_GAIN_THREE_BLADE_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-006-P',
      sourceName: '津島善子',
      sourceCost: 17,
      fromZone: ZoneType.WAITING_ROOM,
      deckCards: [createMember('WAITING-DRAW-1'), createMember('WAITING-DRAW-2')],
    });

    const waitingState = resolve(waitingScenario.game);
    const bladeModifiers = collectLiveModifiers(waitingState).filter(
      (modifier) => modifier.kind === 'BLADE'
    );

    expect(waitingState.players[0].hand.cardIds).toEqual(waitingScenario.deckCardIds);
    expect(bladeModifiers).toHaveLength(1);
    expect(bladeModifiers[0]).toMatchObject({
      sourceCardId: waitingScenario.sourceId,
      countDelta: 3,
    });
  });

  it('PL!S-bp6-006 draw two immediately refreshes when the main deck empties mid-effect', () => {
    const refreshCards = [0, 1, 2].map((index) =>
      createCardInstance(
        createMember(`WAITING-REFRESH-${index}`, `Refresh ${index}`),
        PLAYER1,
        `s-bp6-006-refresh-waiting-${index}`
      )
    );
    const scenario = setupSource({
      testId: 's-bp6-006-refresh-draw',
      abilityId: S_BP6_006_ON_ENTER_DRAW_TWO_FROM_WAITING_GAIN_THREE_BLADE_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-006-P',
      sourceName: '津島善子',
      sourceCost: 17,
      fromZone: ZoneType.WAITING_ROOM,
      deckCards: [createMember('DRAW-BEFORE-REFRESH')],
      extraCards: refreshCards,
    });
    const gameWithWaitingRoom = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: refreshCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.waitingRoom
      ),
    }));

    const state = resolve(gameWithWaitingRoom);

    expect(state.players[0].hand.cardIds).toHaveLength(2);
    expect(state.players[0].hand.cardIds[0]).toBe(scenario.deckCardIds[0]);
    expect(
      state.players[0].hand.cardIds
        .slice(1)
        .every((cardId) => refreshCards.some((card) => card.instanceId === cardId))
    ).toBe(true);
    expect(state.players[0].waitingRoom.cardIds).toEqual([]);
    expect(state.players[0].mainDeck.cardIds).toHaveLength(2);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1 &&
          action.payload.movedCount === 3 &&
          action.payload.mainDeckCountAfter === 3
      )
    ).toBe(true);
  });

  it('PL!S-bp6-011-N draws two, discards one, and enqueues hand enter-waiting-room triggers only from waiting room', () => {
    const handScenario = setupSource({
      testId: 's-bp6-011-hand',
      abilityId: S_BP6_011_ON_ENTER_FROM_WAITING_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-011-N',
      sourceName: '桜内梨子',
      sourceCost: 11,
      fromZone: ZoneType.HAND,
      handCards: [createMember('HAND-ONLY')],
      deckCards: [createMember('NO-DRAW-1'), createMember('NO-DRAW-2')],
    });

    const handState = resolve(handScenario.game);

    expect(handState.activeEffect).toBeNull();
    expect(handState.players[0].hand.cardIds).toEqual(handScenario.handCardIds);
    expect(handState.players[0].mainDeck.cardIds).toEqual(handScenario.deckCardIds);

    const waitingScenario = setupSource({
      testId: 's-bp6-011-waiting',
      abilityId: S_BP6_011_ON_ENTER_FROM_WAITING_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-011-N',
      sourceName: '桜内梨子',
      sourceCost: 11,
      fromZone: ZoneType.WAITING_ROOM,
      handCards: [createMember('DISCARD-ME')],
      deckCards: [createMember('DRAW-A'), createMember('DRAW-B')],
    });

    const started = resolve(waitingScenario.game);

    expect(started.activeEffect?.selectableCardIds).toEqual([
      waitingScenario.handCardIds[0],
      waitingScenario.deckCardIds[0],
      waitingScenario.deckCardIds[1],
    ]);

    const finished = confirmMany(started, [waitingScenario.handCardIds[0]!]);

    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].waitingRoom.cardIds).toEqual([waitingScenario.handCardIds[0]]);
    expect(enterWaitingRoomEventCardIds(finished)).toEqual([waitingScenario.handCardIds[0]]);
  });

  it('PL!S-bp6-016-N selects one inspected top card to hand and moves the rest from main deck to waiting room', () => {
    const scenario = setupSource({
      testId: 's-bp6-016-waiting',
      abilityId: S_BP6_016_ON_ENTER_FROM_WAITING_LOOK_TOP_THREE_TAKE_ONE_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-016-N',
      sourceName: '国木田花丸',
      sourceCost: 4,
      fromZone: ZoneType.WAITING_ROOM,
      deckCards: [createMember('TOP-1'), createMember('TOP-2'), createMember('TOP-3')],
    });

    const started = resolve(scenario.game);

    expect(started.activeEffect?.inspectionCardIds).toEqual(scenario.deckCardIds);
    expect(started.activeEffect?.selectableCardIds).toEqual(scenario.deckCardIds);
    const startedSummary = publicEffectSummaryPayload(started, 'STARTED');
    expect(startedSummary).toMatchObject({
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      summaryStatus: 'STARTED',
      sourceActionLabel: '登场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 3,
      actualInspectedCount: 3,
    });
    expect(startedSummary?.discardedCostCardIds).toBeUndefined();
    expect(startedSummary?.sourceOrientationCost).toBeUndefined();

    const finished = confirmOne(started, scenario.deckCardIds[1]!);

    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].hand.cardIds).toEqual([scenario.deckCardIds[1]]);
    expect(finished.players[0].waitingRoom.cardIds).toEqual([
      scenario.deckCardIds[0],
      scenario.deckCardIds[2],
    ]);
    expect(enterWaitingRoomEventCardIds(finished)).toEqual([
      scenario.deckCardIds[0],
      scenario.deckCardIds[2],
    ]);
    expect(finished.eventLog.at(-1)?.event).toMatchObject({
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
    });
    const completedSummary = publicEffectSummaryPayload(finished, 'COMPLETED');
    expect(completedSummary).toMatchObject({
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      summaryStatus: 'COMPLETED',
      sourceActionLabel: '登场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 3,
      actualInspectedCount: 3,
      selectedCardIds: [scenario.deckCardIds[1]],
      waitingRoomCardIds: [scenario.deckCardIds[0], scenario.deckCardIds[2]],
    });
    expect(completedSummary?.discardedCostCardIds).toBeUndefined();
    expect(completedSummary?.sourceOrientationCost).toBeUndefined();
  });

  it('PL!S-bp6-016-N handles short or empty deck paths', () => {
    const shortDeck = setupSource({
      testId: 's-bp6-016-short',
      abilityId: S_BP6_016_ON_ENTER_FROM_WAITING_LOOK_TOP_THREE_TAKE_ONE_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-016-N',
      sourceName: '国木田花丸',
      sourceCost: 4,
      fromZone: ZoneType.WAITING_ROOM,
      deckCards: [createMember('ONLY-TOP')],
    });
    const shortStarted = resolve(shortDeck.game);
    const shortFinished = confirmOne(shortStarted, shortDeck.deckCardIds[0]!);

    expect(shortFinished.players[0].hand.cardIds).toEqual([shortDeck.deckCardIds[0]]);
    expect(shortFinished.players[0].waitingRoom.cardIds).toEqual([]);
    expect(enterWaitingRoomEventCardIds(shortFinished)).toEqual([]);

    const emptyDeck = setupSource({
      testId: 's-bp6-016-empty',
      abilityId: S_BP6_016_ON_ENTER_FROM_WAITING_LOOK_TOP_THREE_TAKE_ONE_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-016-N',
      sourceName: '国木田花丸',
      sourceCost: 4,
      fromZone: ZoneType.WAITING_ROOM,
    });

    const emptyState = resolve(emptyDeck.game);

    expect(emptyState.activeEffect).toBeNull();
    expect(emptyState.pendingAbilities).toEqual([]);
    expect(latestResolvePayload(emptyState, S_BP6_016_ON_ENTER_FROM_WAITING_LOOK_TOP_THREE_TAKE_ONE_ABILITY_ID)).toMatchObject({
      step: 'TAKE_ONE_REST_TO_WAITING_ROOM',
      inspectedCardIds: [],
    });

    const handEnter = setupSource({
      testId: 's-bp6-016-hand-no-summary',
      abilityId: S_BP6_016_ON_ENTER_FROM_WAITING_LOOK_TOP_THREE_TAKE_ONE_ABILITY_ID,
      sourceCardCode: 'PL!S-bp6-016-N',
      sourceName: '国木田花丸',
      sourceCost: 4,
      fromZone: ZoneType.HAND,
      deckCards: [createMember('HAND-NO-SUMMARY-TOP')],
    });
    const handState = resolve(handEnter.game);

    expect(handState.activeEffect).toBeNull();
    expect(
      latestResolvePayload(
        handState,
        S_BP6_016_ON_ENTER_FROM_WAITING_LOOK_TOP_THREE_TAKE_ONE_ABILITY_ID
      )
    ).toMatchObject({
      step: 'ON_ENTER_SOURCE_ZONE_MISMATCH',
      actualFromZone: ZoneType.HAND,
    });
    expect(publicEffectSummaryPayload(handState, 'STARTED')).toBeUndefined();
    expect(publicEffectSummaryPayload(handState, 'COMPLETED')).toBeUndefined();
  });
});
