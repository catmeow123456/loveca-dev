import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { SP_PB1_008_ON_ENTER_DRAW_SELF_POSITION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMemberCard(cardCode: string, name = cardCode, cost = 2): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
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
  mutableState.currentSubPhase = SubPhase.MAIN_FREE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
}

interface ShikiScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly otherId: string;
  readonly drawCardIds: readonly string[];
}

function setupScenario(options: { readonly mainDeckCount: number }): ShikiScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('sp-pb1-008-shiki', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard('PL!SP-pb1-008-R', '若菜四季', 15),
    PLAYER1,
    'p1-sp-pb1-008-source'
  );
  const other = createCardInstance(
    createMemberCard('PL!SP-test-other-member', 'Other Liella member', 4),
    PLAYER1,
    'p1-sp-pb1-008-other'
  );
  const deckCards = Array.from({ length: options.mainDeckCount }, (_, index) =>
    createCardInstance(createMemberCard(`PL!SP-pb1-008-draw-${index}`), PLAYER1, `p1-draw-${index}`)
  );

  const state = registerCards(session.state!, [source, other, ...deckCards]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.hand.cardIds = [source.instanceId];
  p1.mainDeck.cardIds = deckCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: other.instanceId,
    [SlotPosition.CENTER]: null,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [other.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);

  return {
    session,
    sourceId: source.instanceId,
    otherId: other.instanceId,
    drawCardIds: deckCards.map((card) => card.instanceId),
  };
}

function playShiki(scenario: ShikiScenario): void {
  scenario.session.localFreePlay = true;
  const result = scenario.session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, scenario.sourceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(result.success).toBe(true);
}

describe('PL!SP-pb1-008 Shiki on-enter draw then mandatory self position-change workflow', () => {
  it('draws one before opening a mandatory self position-change window', () => {
    const scenario = setupScenario({ mainDeckCount: 1 });

    playShiki(scenario);

    expect(scenario.session.state?.players[0].hand.cardIds).toContain(scenario.drawCardIds[0]);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: SP_PB1_008_ON_ENTER_DRAW_SELF_POSITION_CHANGE_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      canSkipSelection: false,
    });
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_PB1_008_ON_ENTER_DRAW_SELF_POSITION_CHANGE_ABILITY_ID &&
          action.payload.step === 'DRAW_ONE_START_SELF_POSITION_CHANGE' &&
          action.payload.drawnCardIds?.[0] === scenario.drawCardIds[0]
      )
    ).toBe(true);
  });

  it('continues to mandatory movement when the deck is empty under existing draw helper semantics', () => {
    const scenario = setupScenario({ mainDeckCount: 0 });

    playShiki(scenario);

    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: SP_PB1_008_ON_ENTER_DRAW_SELF_POSITION_CHANGE_ABILITY_ID,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      canSkipSelection: false,
    });
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([]);
  });

  it('swaps with an occupied target and records both movement markers and events', () => {
    const scenario = setupScenario({ mainDeckCount: 1 });

    playShiki(scenario);
    const result = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        undefined,
        SlotPosition.LEFT
      )
    );

    expect(result.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.sourceId
    );
    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      scenario.otherId
    );
    expect(scenario.session.state?.players[0].positionMovedThisTurn).toEqual([
      scenario.sourceId,
      scenario.otherId,
    ]);
    expect(
      scenario.session.state?.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
      )
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            cardInstanceId: scenario.sourceId,
            fromSlot: SlotPosition.CENTER,
            toSlot: SlotPosition.LEFT,
          }),
        }),
        expect.objectContaining({
          event: expect.objectContaining({
            cardInstanceId: scenario.otherId,
            fromSlot: SlotPosition.LEFT,
            toSlot: SlotPosition.CENTER,
          }),
        }),
      ])
    );
  });
});
