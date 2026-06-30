import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
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

interface KinakoScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly otherId: string;
  readonly deckCardIds: readonly string[];
}

function setupScenario(mainDeckCount: number): KinakoScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('sp-bp5-006-kinako', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard('PL!SP-bp5-006-R', '桜小路きな子', 11),
    PLAYER1,
    'p1-sp-bp5-006-source'
  );
  const other = createCardInstance(
    createMemberCard('PL!SP-test-other-member', 'Other Liella member', 4),
    PLAYER1,
    'p1-sp-bp5-006-other'
  );
  const deckCards = Array.from({ length: mainDeckCount }, (_, index) =>
    createCardInstance(createMemberCard(`PL!SP-bp5-006-deck-${index}`), PLAYER1, `p1-deck-${index}`)
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
  p1.hand.cardIds = [];
  p1.mainDeck.cardIds = deckCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: other.instanceId,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    [other.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);

  return {
    session,
    sourceId: source.instanceId,
    otherId: other.instanceId,
    deckCardIds: deckCards.map((card) => card.instanceId),
  };
}

function activateKinako(scenario: KinakoScenario, expectedSuccess = true): void {
  const result = scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID
    )
  );
  expect(result.success).toBe(expectedSuccess);
}

describe('PL!SP-bp5-006 Kinako activated mill-three self position-change workflow', () => {
  it('mills exactly the top 3 cards as cost, then opens mandatory self position-change', () => {
    const scenario = setupScenario(4);

    activateKinako(scenario);

    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(
      scenario.deckCardIds.slice(0, 3)
    );
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      scenario.deckCardIds[3],
    ]);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      canSkipSelection: false,
    });
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID &&
          action.payload.milledCardIds?.join(',') === scenario.deckCardIds.slice(0, 3).join(',')
      )
    ).toBe(true);
  });

  it('cannot activate with only 2 cards in the main deck', () => {
    const scenario = setupScenario(2);

    activateKinako(scenario, false);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual(scenario.deckCardIds);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
          SP_BP5_006_ACTIVATED_MILL_THREE_SELF_POSITION_CHANGE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('does not roll back the paid mill cost when a later position selection is illegal', () => {
    const scenario = setupScenario(3);

    activateKinako(scenario);
    const result = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        undefined,
        SlotPosition.CENTER
      )
    );

    expect(result.success).toBe(false);
    expect(scenario.session.state?.activeEffect).not.toBeNull();
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(
      scenario.deckCardIds.slice(0, 3)
    );
  });

  it('moves or swaps after the cost has been paid', () => {
    const scenario = setupScenario(3);

    activateKinako(scenario);
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
  });
});
