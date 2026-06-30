import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  registerCards,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID,
  SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID,
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
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
    readonly cost?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: options.unitName ?? 'Liella!',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
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

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
}

interface MargareteScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly secondSourceId: string;
  readonly watcherId: string;
  readonly handCardIds: readonly string[];
  readonly drawCardIds: readonly string[];
  readonly energyDeckCardIds: readonly string[];
  readonly energyZoneCardIds: readonly string[];
}

function setupMargareteScenario(
  options: {
    readonly handCount?: number;
    readonly mainDeckCount?: number;
    readonly energyDeckCount?: number;
    readonly energyZoneCount?: number;
  } = {}
): MargareteScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('sp-pb2-010-margarete', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard('PL!SP-pb2-010-R', {
      name: 'ウィーン・マルガレーテ',
      cost: 11,
    }),
    PLAYER1,
    'p1-sp-pb2-010-source'
  );
  const secondSource = createCardInstance(
    createMemberCard('PL!SP-pb2-010-PP', {
      name: 'ウィーン・マルガレーテ',
      cost: 11,
    }),
    PLAYER1,
    'p1-sp-pb2-010-second-source'
  );
  const watcher = createCardInstance(
    createMemberCard('PL!HS-pb1-003-R', {
      name: '大泽瑠璃乃',
      groupNames: ['莲之空'],
      unitName: 'みらくらぱーく！',
    }),
    PLAYER1,
    'p1-sp-pb2-010-watcher'
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(createMemberCard(`PL!SP-test-hand-${index}`), PLAYER1, `p1-hand-${index}`)
  );
  const drawCards = Array.from({ length: options.mainDeckCount ?? 3 }, (_, index) =>
    createCardInstance(createMemberCard(`PL!SP-test-draw-${index}`), PLAYER1, `p1-draw-${index}`)
  );

  const state = registerCards(session.state!, [
    source,
    secondSource,
    watcher,
    ...handCards,
    ...drawCards,
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
    energyDeck: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  const allEnergyCardIds = [...p1.energyDeck.cardIds];
  const energyZoneCardIds = allEnergyCardIds.slice(0, options.energyZoneCount ?? 1);
  const energyDeckCardIds = allEnergyCardIds.slice(
    energyZoneCardIds.length,
    energyZoneCardIds.length + (options.energyDeckCount ?? 2)
  );

  p1.hand.cardIds = handCards.map((card) => card.instanceId);
  p1.mainDeck.cardIds = drawCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.energyDeck.cardIds = [...energyDeckCardIds];
  p1.energyZone.cardIds = [...energyZoneCardIds];
  p1.energyZone.cardStates = new Map(
    energyZoneCardIds.map((cardId) => [
      cardId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: watcher.instanceId,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: secondSource.instanceId,
  };
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    [secondSource.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    [watcher.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);

  return {
    session,
    sourceId: source.instanceId,
    secondSourceId: secondSource.instanceId,
    watcherId: watcher.instanceId,
    handCardIds: handCards.map((card) => card.instanceId),
    drawCardIds: drawCards.map((card) => card.instanceId),
    energyDeckCardIds,
    energyZoneCardIds,
  };
}

function pendingAbility(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  idSuffix = sourceCardId
): PendingAbilityState {
  return {
    id: `${abilityId}:${idSuffix}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`event:${idSuffix}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function startPending(
  session: ReturnType<typeof createGameSession>,
  ability: PendingAbilityState
): void {
  (session as unknown as { authorityState: GameState }).authorityState = {
    ...session.state!,
    pendingAbilities: [ability],
  };
  const result = resolvePendingCardEffects(session.state!);
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
}

function appendPending(
  session: ReturnType<typeof createGameSession>,
  ability: PendingAbilityState
): void {
  (session as unknown as { authorityState: GameState }).authorityState = {
    ...session.state!,
    pendingAbilities: [...session.state!.pendingAbilities, ability],
  };
}

function confirmOption(session: ReturnType<typeof createGameSession>, optionId: string): void {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, undefined, undefined, undefined, optionId)
  );
  expect(result.success).toBe(true);
}

function confirmCard(session: ReturnType<typeof createGameSession>, cardId: string): void {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, cardId));
  expect(result.success).toBe(true);
}

describe('PL!SP-pb2-010 Margarete workflows', () => {
  it('discards one hand card at LIVE start and enqueues enter-waiting-room triggers', () => {
    const scenario = setupMargareteScenario({ handCount: 1, energyZoneCount: 1 });
    startPending(
      scenario.session,
      pendingAbility(
        SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_LIVE_START
      )
    );

    expect(scenario.session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'discard', label: '弃1张手牌' },
      { id: 'decline-discard', label: '不弃手，返回1张能量' },
    ]);

    confirmOption(scenario.session, 'discard');
    expect(scenario.session.state?.activeEffect).toMatchObject({
      selectableCardIds: [scenario.handCardIds[0]],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });

    confirmCard(scenario.session, scenario.handCardIds[0]!);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(
      scenario.handCardIds[0]
    );
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === scenario.watcherId
      )
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD' &&
          action.payload.discardedCardId === scenario.handCardIds[0] &&
          action.payload.returnedEnergyCardId === null &&
          action.payload.declinedDiscard === false &&
          action.payload.noHand === false
      )
    ).toBe(true);
  });

  it('automatically returns the first energy to the energy deck when discard is declined', () => {
    const scenario = setupMargareteScenario({ handCount: 1, energyZoneCount: 2 });
    startPending(
      scenario.session,
      pendingAbility(
        SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_LIVE_START
      )
    );

    confirmOption(scenario.session, 'decline-discard');
    expect(scenario.session.state?.activeEffect).toBeNull();

    expect(scenario.session.state?.players[0].energyZone.cardIds).not.toContain(
      scenario.energyZoneCardIds[0]
    );
    expect(scenario.session.state?.players[0].energyDeck.cardIds).toContain(
      scenario.energyZoneCardIds[0]
    );
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID &&
          action.payload.step === 'RETURN_ENERGY_TO_DECK' &&
          action.payload.returnedEnergyCardId === scenario.energyZoneCardIds[0] &&
          action.payload.declinedDiscard === true &&
          action.payload.noHand === false
      )
    ).toBe(true);
  });

  it('automatically returns the first energy at LIVE start when there is no hand', () => {
    const scenario = setupMargareteScenario({ handCount: 0, energyZoneCount: 1 });
    startPending(
      scenario.session,
      pendingAbility(
        SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_LIVE_START
      )
    );

    expect(scenario.session.state?.activeEffect).toBeNull();

    expect(scenario.session.state?.players[0].energyDeck.cardIds).toContain(
      scenario.energyZoneCardIds[0]
    );
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID &&
          action.payload.step === 'RETURN_ENERGY_TO_DECK' &&
          action.payload.noHand === true &&
          action.payload.declinedDiscard === false
      )
    ).toBe(true);
  });

  it('consumes the LIVE start pending ability as a no-op with no hand and no energy', () => {
    const scenario = setupMargareteScenario({ handCount: 0, energyZoneCount: 0 });
    startPending(
      scenario.session,
      pendingAbility(
        SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_LIVE_START
      )
    );

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID &&
          action.payload.step === 'NO_OP_NO_ENERGY' &&
          action.payload.noHand === true &&
          action.payload.reason === 'NO_HAND_NO_ENERGY'
      )
    ).toBe(true);
  });

  it('keeps no-op semantics when discard is declined but there is no energy', () => {
    const scenario = setupMargareteScenario({ handCount: 1, energyZoneCount: 0 });
    startPending(
      scenario.session,
      pendingAbility(
        SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_LIVE_START
      )
    );

    confirmOption(scenario.session, 'decline-discard');

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID &&
          action.payload.step === 'NO_OP_NO_ENERGY' &&
          action.payload.noHand === false &&
          action.payload.declinedDiscard === true &&
          action.payload.reason === 'DECLINED_DISCARD_NO_ENERGY'
      )
    ).toBe(true);
  });

  it('draws two cards from the LIVE success option', () => {
    const scenario = setupMargareteScenario({ mainDeckCount: 3, energyDeckCount: 0 });
    startPending(
      scenario.session,
      pendingAbility(
        SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_LIVE_SUCCESS
      )
    );

    expect(scenario.session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'draw-two', label: '抽2张卡' },
    ]);

    confirmOption(scenario.session, 'draw-two');

    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(
      expect.arrayContaining(scenario.drawCardIds.slice(0, 2))
    );
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.step === 'DRAW_TWO' &&
          action.payload.drawnCardIds?.length === 2
      )
    ).toBe(true);
  });

  it('places waiting energy from the LIVE success option', () => {
    const scenario = setupMargareteScenario({ energyDeckCount: 1 });
    startPending(
      scenario.session,
      pendingAbility(
        SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_LIVE_SUCCESS
      )
    );

    expect(scenario.session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'draw-two', label: '抽2张卡' },
      { id: 'place-waiting-energy', label: '放置1张待机能量' },
    ]);

    confirmOption(scenario.session, 'place-waiting-energy');

    expect(scenario.session.state?.players[0].energyZone.cardIds).toContain(
      scenario.energyDeckCardIds[0]
    );
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyDeckCardIds[0]!)
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.step === 'PLACE_WAITING_ENERGY' &&
          action.payload.placedEnergyCardIds?.[0] === scenario.energyDeckCardIds[0]
      )
    ).toBe(true);
  });

  it('continues to the next pending ability after resolving LIVE success', () => {
    const scenario = setupMargareteScenario({ mainDeckCount: 4, energyDeckCount: 0 });
    startPending(
      scenario.session,
      pendingAbility(
        SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID,
        scenario.sourceId,
        TriggerCondition.ON_LIVE_SUCCESS,
        'first'
      )
    );
    appendPending(
      scenario.session,
      pendingAbility(
        SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID,
        scenario.secondSourceId,
        TriggerCondition.ON_LIVE_SUCCESS,
        'second'
      )
    );

    confirmOption(scenario.session, 'draw-two');

    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID,
      sourceCardId: scenario.secondSourceId,
    });
  });
});
