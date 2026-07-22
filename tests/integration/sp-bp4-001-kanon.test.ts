import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMemberCard(
  cardCode: string,
  name = cardCode,
  groupName = 'Liella!',
  unitName = 'CatChu!'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
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
  mutableState.currentSubPhase = SubPhase.MAIN_FREE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
}

function setupKanonScenario(options: {
  readonly sourceCardCode?: string;
  readonly energyZoneCount: number;
  readonly energyDeckCount: number;
  readonly includeNonLiellaStageMember?: boolean;
}): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly energyZoneCardIds: readonly string[];
  readonly energyDeckCardIds: readonly string[];
} {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('sp-bp4-001-kanon', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard(options.sourceCardCode ?? 'PL!SP-bp4-001-P', '澁谷かのん'),
    PLAYER1,
    'p1-sp-bp4-001-source'
  );
  const nonLiellaMember = createCardInstance(
    createMemberCard(
      'PL!S-test-non-liella-member',
      'Non Liella member',
      'Aqours',
      'CYaRon!'
    ),
    PLAYER1,
    'p1-non-liella-stage-member'
  );
  const extraCards = options.includeNonLiellaStageMember ? [nonLiellaMember] : [];
  const state = registerCards(session.state!, [source, ...extraCards]);
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
  const energyZoneCardIds = allEnergyCardIds.slice(0, options.energyZoneCount);
  const energyDeckCardIds = allEnergyCardIds.slice(
    options.energyZoneCount,
    options.energyZoneCount + options.energyDeckCount
  );

  p1.hand.cardIds = [source.instanceId];
  p1.mainDeck.cardIds = [];
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
    [SlotPosition.LEFT]: options.includeNonLiellaStageMember ? nonLiellaMember.instanceId : null,
    [SlotPosition.CENTER]: null,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map(
    options.includeNonLiellaStageMember
      ? [
          [
            nonLiellaMember.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ],
        ]
      : []
  );

  return { session, source, energyZoneCardIds, energyDeckCardIds };
}

function playKanon(session: ReturnType<typeof createGameSession>, sourceId: string): void {
  session.setManualOperationMode('FREE');
  const result = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, sourceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(result.success).toBe(true);
  expect(session.state?.activeEffect).toBeNull();
}

describe('PL!SP-bp4-001 Kanon on-enter workflow', () => {
  it('places one waiting energy when all stage members are Liella and energy zone has seven cards', () => {
    const { session, source, energyZoneCardIds, energyDeckCardIds } = setupKanonScenario({
      energyZoneCount: 7,
      energyDeckCount: 2,
    });

    playKanon(session, source.instanceId);

    expect(session.state?.players[0].energyZone.cardIds).toEqual([
      ...energyZoneCardIds,
      energyDeckCardIds[0],
    ]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyDeckCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual([energyDeckCardIds[1]]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.conditionMet === true &&
          action.payload.placedEnergyCardIds?.[0] === energyDeckCardIds[0]
      )
    ).toBe(true);
  });

  it('uses the same base-code workflow for the R rarity', () => {
    const { session, source, energyDeckCardIds } = setupKanonScenario({
      sourceCardCode: 'PL!SP-bp4-001-R',
      energyZoneCount: 7,
      energyDeckCount: 1,
    });

    playKanon(session, source.instanceId);

    expect(session.state?.players[0].energyZone.cardIds).toContain(energyDeckCardIds[0]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.conditionMet === true
      )
    ).toBe(true);
  });

  it('does not place energy when a non-Liella member is on stage', () => {
    const { session, source, energyZoneCardIds, energyDeckCardIds } = setupKanonScenario({
      energyZoneCount: 7,
      energyDeckCount: 1,
      includeNonLiellaStageMember: true,
    });

    playKanon(session, source.instanceId);

    expect(session.state?.players[0].energyZone.cardIds).toEqual(energyZoneCardIds);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(energyDeckCardIds);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.allStageMembersAreLiella === false &&
          action.payload.conditionMet === false &&
          action.payload.placedEnergyCardIds?.length === 0
      )
    ).toBe(true);
  });

  it('does not place energy when the energy zone has fewer than seven cards', () => {
    const { session, source, energyZoneCardIds, energyDeckCardIds } = setupKanonScenario({
      energyZoneCount: 6,
      energyDeckCount: 1,
    });

    playKanon(session, source.instanceId);

    expect(session.state?.players[0].energyZone.cardIds).toEqual(energyZoneCardIds);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(energyDeckCardIds);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.energyZoneCount === 6 &&
          action.payload.conditionMet === false
      )
    ).toBe(true);
  });

  it('resolves normally without placing when the energy deck is empty', () => {
    const { session, source, energyZoneCardIds } = setupKanonScenario({
      energyZoneCount: 7,
      energyDeckCount: 0,
    });

    playKanon(session, source.instanceId);

    expect(session.state?.players[0].energyZone.cardIds).toEqual(energyZoneCardIds);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual([]);
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.conditionMet === true &&
          action.payload.placedEnergyCardIds?.length === 0
      )
    ).toBe(true);
  });
});
