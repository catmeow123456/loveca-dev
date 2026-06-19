import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMemberCard(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupName: '莲之空',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupName: '莲之空',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
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

function removeFromPlayerZones(player: {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
}): void {
  player.hand.cardIds = [];
  player.mainDeck.cardIds = [];
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
}

function setActiveEnergy(
  player: {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  },
  cardIds: readonly string[]
): void {
  player.energyZone.cardIds = [...cardIds];
  player.energyZone.cardStates = new Map(
    cardIds.map((cardId) => [
      cardId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
}

function advanceToLiveStartEffects(session: ReturnType<typeof createGameSession>): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    firstPlayerIndex: number;
    liveSetCompletedPlayers: string[];
  };
  mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
  mutableState.currentSubPhase = SubPhase.LIVE_SET_SECOND_DRAW;
  mutableState.currentTurnType = TurnType.LIVE_PHASE;
  mutableState.activePlayerIndex = 0;
  mutableState.firstPlayerIndex = 0;
  mutableState.liveSetCompletedPlayers = [PLAYER1, PLAYER2];

  const service = new GameService();
  const advanceResult = service.advancePhase(state);
  expect(advanceResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;
}

describe('pay energy gain Blade workflow', () => {
  it('uses current live-zone count for HS-bp1-004 Blade bonus after paying energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'pay-energy-gain-blade-hs-bp1-004-live-zone-count',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp1-004-P', '夕霧綴理', 15),
      PLAYER1,
      'p1-hs-bp1-004-source'
    );
    const liveCards = [0, 1, 2].map((index) =>
      createCardInstance(
        createLiveCard(`PL!HS-test-live-${index}`, `Live ${index}`),
        PLAYER1,
        `p1-hs-bp1-004-live-${index}`
      )
    );
    let state = registerCards(session.state!, [source, ...liveCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const energyCardId = state.players[0].energyDeck.cardIds[0]!;

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = liveCards.map((card) => card.instanceId);
    p1.liveZone.cardStates = new Map(
      liveCards.map((card) => [
        card.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
      ])
    );
    setActiveEnergy(p1, [energyCardId]);

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP1_004_LIVE_START_PAY_ENERGY');
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'pay', label: '支付1能量' },
      { id: 'decline', label: '不发动' },
    ]);
    expect(session.state?.activeEffect?.metadata?.activeEnergyCardIds).toEqual([energyCardId]);
    expect(session.state?.activeEffect?.metadata?.liveZoneCardCount).toBe(3);

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 3,
      sourceCardId: source.instanceId,
      abilityId: HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.step === 'PAY_ENERGY_GAIN_BLADE' &&
          action.payload.bladeBonus === 3 &&
          Array.isArray(action.payload.paidEnergyCardIds) &&
          action.payload.paidEnergyCardIds[0] === energyCardId
      )
    ).toBe(true);
  });
});
