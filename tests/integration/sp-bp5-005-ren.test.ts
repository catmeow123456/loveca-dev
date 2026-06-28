import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  type GameState,
} from '../../src/domain/entities/game';
import { createEnterWaitingRoomEvent } from '../../src/domain/events/game-events';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  name = cardCode,
  cost = 2,
  groupName = 'Liella!'
): MemberCardData {
  return {
    cardCode,
    name,
    groupName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forcePhaseForPlayer(
  session: ReturnType<typeof createGameSession>,
  phase: GamePhase,
  activePlayerIndex = 0
): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };
  mutableState.currentPhase = phase;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = activePlayerIndex;
}

interface RenScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly deckCardIds: readonly string[];
  readonly energyCardIds: readonly string[];
  readonly movedCardIds: readonly string[];
  readonly unrelatedWaitingCardId: string;
}

function setupScenario(options: {
  readonly mainDeckCards?: readonly MemberCardData[];
  readonly energyCount?: number;
  readonly movedCardCount?: number;
} = {}): RenScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('sp-bp5-005-ren', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forcePhaseForPlayer(session, GamePhase.MAIN_PHASE);

  const source = createCardInstance(
    createMemberCard('PL!SP-bp5-005-SEC', '葉月 恋', 11),
    PLAYER1,
    'p1-sp-bp5-005-source'
  );
  const deckCards = (options.mainDeckCards ?? [
    createMemberCard('PL!SP-bp5-005-liella-1', 'Liella member 1'),
    createMemberCard('PL!SP-bp5-005-liella-2', 'Liella member 2'),
    createMemberCard('PL!S-bp5-005-aqours', 'Aqours member', 2, 'Aqours'),
  ]).map((card, index) => createCardInstance(card, PLAYER1, `p1-ren-deck-${index}`));
  const energyCards = Array.from({ length: options.energyCount ?? 2 }, (_, index) =>
    createCardInstance(createEnergyCard(`REN-ENE-${index}`), PLAYER1, `p1-ren-energy-${index}`)
  );
  const movedCards = Array.from({ length: options.movedCardCount ?? 2 }, (_, index) =>
    createCardInstance(
      createMemberCard(`PL!SP-bp5-005-moved-${index}`, `Moved ${index}`),
      PLAYER1,
      `p1-ren-moved-${index}`
    )
  );
  const unrelatedWaiting = createCardInstance(
    createMemberCard('PL!SP-bp5-005-unrelated-waiting', 'Unrelated'),
    PLAYER1,
    'p1-ren-unrelated-waiting'
  );

  const state = registerCards(session.state!, [
    source,
    ...deckCards,
    ...energyCards,
    ...movedCards,
    unrelatedWaiting,
  ]);
  setAuthorityState(session, state);

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.hand.cardIds = [];
  p1.mainDeck.cardIds = deckCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = [
    ...movedCards.map((card) => card.instanceId),
    unrelatedWaiting.instanceId,
  ];
  p1.energyZone.cardIds = energyCards.map((card) => card.instanceId);
  p1.energyZone.cardStates = new Map(
    energyCards.map((card) => [
      card.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);

  return {
    session,
    sourceId: source.instanceId,
    deckCardIds: deckCards.map((card) => card.instanceId),
    energyCardIds: energyCards.map((card) => card.instanceId),
    movedCardIds: movedCards.map((card) => card.instanceId),
    unrelatedWaitingCardId: unrelatedWaiting.instanceId,
  };
}

function setAuthorityState(
  session: ReturnType<typeof createGameSession>,
  state: GameState
): void {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

function activateRen(scenario: RenScenario, expectedSuccess = true): void {
  const result = scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID
    )
  );
  expect(result.success).toBe(expectedSuccess);
}

function enqueueRenEnterWaitingRoomEvent(
  scenario: RenScenario,
  options: {
    readonly movedCardIds?: readonly string[];
    readonly fromZone?: ZoneType;
    readonly ownerId?: string;
    readonly controllerId?: string;
  } = {}
): void {
  const movedCardIds = options.movedCardIds ?? scenario.movedCardIds;
  const controllerId = options.controllerId ?? PLAYER1;
  const event = createEnterWaitingRoomEvent(
    movedCardIds,
    options.fromZone ?? ZoneType.MAIN_DECK,
    options.ownerId ?? controllerId,
    controllerId
  );
  let state = emitGameEvent(scenario.session.state!, event);
  state = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
    enterWaitingRoomEvents: [event],
  });
  setAuthorityState(scenario.session, state);
}

function resolvePending(scenario: RenScenario): void {
  setAuthorityState(scenario.session, resolvePendingCardEffects(scenario.session.state!).gameState);
}

function declineAuto(scenario: RenScenario): void {
  const effect = scenario.session.state!.activeEffect!;
  const result = scenario.session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effect.id, undefined, undefined, undefined, 'decline')
  );
  expect(result.success).toBe(true);
}

describe('PL!SP-bp5-005 Ren activated and auto workflows', () => {
  it('mills the top 3 cards and gains BLADE for each milled Liella member', () => {
    const scenario = setupScenario();

    activateRen(scenario);

    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      ...scenario.movedCardIds,
      scenario.unrelatedWaitingCardId,
      ...scenario.deckCardIds.slice(0, 3),
    ]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(
      scenario.session.state?.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId ===
            SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID
      )
    ).toMatchObject([{ sourceCardId: scenario.sourceId, countDelta: 2 }]);
    expect(scenario.session.state?.pendingAbilities).toHaveLength(1);
    expect(scenario.session.state?.pendingAbilities[0]).toMatchObject({
      abilityId: SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      metadata: { movedCardIds: scenario.deckCardIds.slice(0, 3), fromZone: ZoneType.MAIN_DECK },
    });
  });

  it('pays the mill cost without adding BLADE when no milled card is a Liella member', () => {
    const scenario = setupScenario({
      mainDeckCards: [
        createMemberCard('PL!S-bp5-005-aqours-1', 'Aqours 1', 2, 'Aqours'),
        createMemberCard('PL!N-bp5-005-niji', 'Niji', 2, '虹ヶ咲'),
        createMemberCard('PL!HS-bp5-005-hasu', 'Hasu', 2, '蓮ノ空'),
      ],
    });

    activateRen(scenario);

    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(
      scenario.deckCardIds[0]
    );
    expect(
      scenario.session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId ===
            SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID
      )
    ).toBe(false);
  });

  it('cannot activate with fewer than 3 cards in the main deck', () => {
    const scenario = setupScenario({
      mainDeckCards: [
        createMemberCard('PL!SP-bp5-005-liella-1'),
        createMemberCard('PL!SP-bp5-005-liella-2'),
      ],
    });

    activateRen(scenario, false);

    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual(scenario.deckCardIds);
  });

  it('can activate only once per source each turn', () => {
    const scenario = setupScenario({
      mainDeckCards: [
        createMemberCard('PL!SP-bp5-005-liella-1'),
        createMemberCard('PL!SP-bp5-005-liella-2'),
        createMemberCard('PL!SP-bp5-005-liella-3'),
        createMemberCard('PL!SP-bp5-005-liella-4'),
      ],
    });

    activateRen(scenario);
    activateRen(scenario, false);

    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      scenario.deckCardIds[3],
    ]);
  });

  it('queues during own main phase when own cards enter waiting room from a non-hand zone', () => {
    const scenario = setupScenario();

    enqueueRenEnterWaitingRoomEvent(scenario, { fromZone: ZoneType.MAIN_DECK });

    expect(scenario.session.state?.pendingAbilities).toHaveLength(1);
    expect(scenario.session.state?.pendingAbilities[0]).toMatchObject({
      abilityId: SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      metadata: { movedCardIds: scenario.movedCardIds, fromZone: ZoneType.MAIN_DECK },
    });
  });

  it('still queues hand-to-waiting-room events through the existing event path', () => {
    const scenario = setupScenario();

    enqueueRenEnterWaitingRoomEvent(scenario, { fromZone: ZoneType.HAND });

    expect(scenario.session.state?.pendingAbilities).toHaveLength(1);
  });

  it('does not queue for opponent cards and consumes stale non-main-phase pending as no-op', () => {
    const scenario = setupScenario();

    enqueueRenEnterWaitingRoomEvent(scenario, { controllerId: PLAYER2, ownerId: PLAYER2 });
    expect(scenario.session.state?.pendingAbilities).toHaveLength(0);

    enqueueRenEnterWaitingRoomEvent(scenario);
    forcePhaseForPlayer(scenario.session, GamePhase.LIVE_PHASE);
    resolvePending(scenario);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toHaveLength(0);
    forcePhaseForPlayer(scenario.session, GamePhase.MAIN_PHASE);
    enqueueRenEnterWaitingRoomEvent(scenario, { movedCardIds: [scenario.movedCardIds[1]] });
    expect(scenario.session.state?.pendingAbilities).toHaveLength(1);
  });

  it('pays 1 energy and recovers only a card from this event movedCardIds', () => {
    const scenario = setupScenario();

    enqueueRenEnterWaitingRoomEvent(scenario);
    resolvePending(scenario);

    const payResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );
    expect(payResult.success).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual(
      scenario.movedCardIds
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.unrelatedWaitingCardId
    );

    const recoverResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        scenario.movedCardIds[0]
      )
    );
    expect(recoverResult.success).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(scenario.movedCardIds[0]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).not.toContain(
      scenario.movedCardIds[0]
    );
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCardIds[0])
        ?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('decline, insufficient energy, and no legal candidates consume the pending ability', () => {
    const declineScenario = setupScenario();
    enqueueRenEnterWaitingRoomEvent(declineScenario);
    resolvePending(declineScenario);
    declineAuto(declineScenario);
    expect(declineScenario.session.state?.activeEffect).toBeNull();

    const noEnergyScenario = setupScenario({ energyCount: 0 });
    enqueueRenEnterWaitingRoomEvent(noEnergyScenario);
    resolvePending(noEnergyScenario);
    expect(noEnergyScenario.session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'decline', label: '不发动' },
    ]);
    declineAuto(noEnergyScenario);
    expect(noEnergyScenario.session.state?.pendingAbilities).toHaveLength(0);
    enqueueRenEnterWaitingRoomEvent(noEnergyScenario, {
      movedCardIds: [noEnergyScenario.movedCardIds[1]],
      fromZone: ZoneType.HAND,
    });
    expect(noEnergyScenario.session.state?.pendingAbilities).toHaveLength(1);

    const noCandidateScenario = setupScenario({ movedCardCount: 0 });
    enqueueRenEnterWaitingRoomEvent(noCandidateScenario, { movedCardIds: ['already-gone'] });
    resolvePending(noCandidateScenario);
    expect(noCandidateScenario.session.state?.activeEffect).toBeNull();
    expect(noCandidateScenario.session.state?.pendingAbilities).toHaveLength(0);
    enqueueRenEnterWaitingRoomEvent(noCandidateScenario, {
      movedCardIds: [noCandidateScenario.unrelatedWaitingCardId],
    });
    expect(noCandidateScenario.session.state?.pendingAbilities).toHaveLength(1);
  });

  it('decline does not consume the auto turn limit, so a second same-turn event can queue again', () => {
    const scenario = setupScenario();

    enqueueRenEnterWaitingRoomEvent(scenario);
    resolvePending(scenario);
    declineAuto(scenario);
    enqueueRenEnterWaitingRoomEvent(scenario, {
      movedCardIds: [scenario.movedCardIds[1]],
      fromZone: ZoneType.HAND,
    });

    expect(scenario.session.state?.pendingAbilities).toHaveLength(1);
    expect(scenario.session.state?.pendingAbilities[0]).toMatchObject({
      abilityId: SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
      metadata: { movedCardIds: [scenario.movedCardIds[1]], fromZone: ZoneType.HAND },
    });
  });

  it('after paying energy, the auto turn limit blocks another event from the same source', () => {
    const scenario = setupScenario();

    enqueueRenEnterWaitingRoomEvent(scenario);
    resolvePending(scenario);
    const payResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );
    expect(payResult.success).toBe(true);
    const recoverResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        scenario.movedCardIds[0]
      )
    );
    expect(recoverResult.success).toBe(true);

    enqueueRenEnterWaitingRoomEvent(scenario, {
      movedCardIds: [scenario.movedCardIds[1]],
      fromZone: ZoneType.HAND,
    });

    expect(scenario.session.state?.pendingAbilities).toHaveLength(0);
  });
});
