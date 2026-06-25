import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { SP_BP5_014_ON_ENTER_OTHER_STAGE_MEMBER_MOVED_DRAW_ONE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, cost = 2): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: 'Liella!',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMember(`MEM-${index}`)
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

interface ChisatoScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly otherId: string;
  readonly departedId: string;
  readonly drawCardId: string;
}

function setupScenario(options: {
  readonly movedOtherCurrentStage?: boolean;
  readonly movedSourceOnly?: boolean;
  readonly movedDepartedOnly?: boolean;
} = {}): ChisatoScenario {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('sp-bp5-014-chisato', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(createMember('PL!SP-bp5-014-N', 2), PLAYER1, 'chisato-source');
  const other = createCardInstance(createMember('PL!SP-test-other', 4), PLAYER1, 'other-member');
  const departed = createCardInstance(
    createMember('PL!SP-test-departed', 4),
    PLAYER1,
    'departed-member'
  );
  const drawCard = createCardInstance(createMember('PL!SP-test-draw'), PLAYER1, 'draw-card');
  const state = registerCards(session.state!, [source, other, departed, drawCard]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    positionMovedThisTurn: string[];
  };
  p1.hand.cardIds = [source.instanceId];
  p1.mainDeck.cardIds = [drawCard.instanceId];
  p1.waitingRoom.cardIds = options.movedDepartedOnly ? [departed.instanceId] : [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: other.instanceId,
    [SlotPosition.CENTER]: null,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [other.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);
  p1.positionMovedThisTurn = [
    ...(options.movedOtherCurrentStage ? [other.instanceId] : []),
    ...(options.movedSourceOnly ? [source.instanceId] : []),
    ...(options.movedDepartedOnly ? [departed.instanceId] : []),
  ];

  return {
    session,
    sourceId: source.instanceId,
    otherId: other.instanceId,
    departedId: departed.instanceId,
    drawCardId: drawCard.instanceId,
  };
}

function playChisato(scenario: ChisatoScenario): void {
  const result = scenario.session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, scenario.sourceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(result.success).toBe(true);
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_BP5_014_ON_ENTER_OTHER_STAGE_MEMBER_MOVED_DRAW_ONE_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!SP-bp5-014 Chisato on-enter moved-other draw workflow', () => {
  it('draws one when another current stage member moved this turn', () => {
    const scenario = setupScenario({ movedOtherCurrentStage: true });
    playChisato(scenario);

    expect(scenario.session.state?.players[0].hand.cardIds).toContain(scenario.drawCardId);
    expect(latestPayload(scenario.session.state!)).toMatchObject({
      conditionMet: true,
      movedOtherMemberCardIds: [scenario.otherId],
      drawnCardIds: [scenario.drawCardId],
    });
  });

  it('does not draw when only the source card id is marked as moved', () => {
    const scenario = setupScenario({ movedSourceOnly: true });
    playChisato(scenario);

    expect(scenario.session.state?.players[0].hand.cardIds).not.toContain(scenario.drawCardId);
    expect(latestPayload(scenario.session.state!)).toMatchObject({
      conditionMet: false,
      movedOtherMemberCardIds: [],
      drawnCardIds: [],
    });
  });

  it('does not count a moved member that is no longer on stage', () => {
    const scenario = setupScenario({ movedDepartedOnly: true });
    playChisato(scenario);

    expect(scenario.session.state?.players[0].hand.cardIds).not.toContain(scenario.drawCardId);
    expect(latestPayload(scenario.session.state!)).toMatchObject({
      conditionMet: false,
      movedOtherMemberCardIds: [],
    });
  });

  it('consumes pending and records the unmet condition payload', () => {
    const scenario = setupScenario();
    playChisato(scenario);

    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(latestPayload(scenario.session.state!)).toMatchObject({
      conditionMet: false,
      movedOtherMemberCardIds: [],
      drawnCardIds: [],
    });
  });
});
