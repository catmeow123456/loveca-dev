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
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
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
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
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

function removeFromPlayerZones(player: {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
  energyZone: { cardIds: string[]; cardStates: Map<string, { orientation: OrientationState }> };
}): void {
  const ruleSentinelCardId = player.mainDeck.cardIds.at(-1);
  player.hand.cardIds = [];
  player.mainDeck.cardIds = ruleSentinelCardId ? [ruleSentinelCardId] : [];
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
  player.energyZone.cardIds = [];
  player.energyZone.cardStates = new Map();
}

describe('KEKE on-enter place waiting energy workflow', () => {
  it('excludes the source card from discard candidates and skips without placing energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('keke-source-only-skip', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const keke = createCardInstance(
      createMemberCard('PL!SP-PR-004-PR', '唐可可', 4),
      PLAYER1,
      'p1-keke-source'
    );
    const state = registerCards(session.state!, [keke]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: { cardIds: string[]; cardStates: Map<string, { orientation: OrientationState }> };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState }>;
      };
    };
    const energyDeckBefore = [...p1.energyDeck.cardIds];

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [keke.instanceId];
    p1.energyDeck.cardIds = energyDeckBefore;
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    session.setManualOperationMode('FREE');
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, keke.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('KEKE_SELECT_DISCARD_FOR_WAITING_ENERGY');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(energyDeckBefore);
    expect(session.state?.players[0].energyZone.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.sourceCardId === keke.instanceId &&
          action.payload.step === 'SKIP'
      )
    ).toBe(true);
  });

  it('triggers PB1-003 auto once after discarding a hand card for waiting energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('keke-discard-triggers-pb1-003', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const keke = createCardInstance(
      createMemberCard('PL!SP-PR-004-PR', '唐可可', 4),
      PLAYER1,
      'p1-keke-positive-source'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'p1-keke-pb1-003'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!SP-test-discard', 'Discard', 1),
      PLAYER1,
      'p1-keke-discard'
    );
    const state = registerCards(session.state!, [keke, pb1003Source, discardCard]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: { cardIds: string[]; cardStates: Map<string, { orientation: OrientationState }> };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face?: unknown }>;
      };
    };
    const energyDeckBefore = [...p1.energyDeck.cardIds];
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [keke.instanceId, discardCard.instanceId];
    p1.energyDeck.cardIds = energyDeckBefore;
    p1.memberSlots.slots[SlotPosition.RIGHT] = pb1003Source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [pb1003Source.instanceId, { orientation: OrientationState.ACTIVE }],
    ]);

    session.setManualOperationMode('FREE');
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, keke.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID
    );

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCard.instanceId]);
    expect(session.state?.players[0].energyZone.cardIds).toHaveLength(1);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === pb1003Source.instanceId &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toHaveLength(1);
  });
});
