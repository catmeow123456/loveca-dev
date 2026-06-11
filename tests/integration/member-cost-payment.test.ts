import { describe, expect, it } from 'vitest';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import type { DeckConfig } from '../../src/application/game-service';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(cardCode: string, name: string, cost: number): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: `Live ${cardCode}`,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `Energy ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  for (let i = 0; i < 48; i++) {
    mainDeck.push(createMemberCard(`MEM-${i}`, `Member ${i}`, 2));
  }
  for (let i = 0; i < 12; i++) {
    mainDeck.push(createLiveCard(`LIVE-${i}`));
  }

  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.NONE;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

describe('member cost payment', () => {
  it('automatically taps energy and plays member when paying entry cost', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('member-cost-payment', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0];
    const memberCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardIds = player.energyZone.cardIds.slice(0, 2);

    expect(memberCardId).toBeTruthy();
    expect(energyCardIds).toHaveLength(2);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(memberCardId);
    expect(session.state?.players[0].hand.cardIds).not.toContain(memberCardId);
    for (const energyCardId of energyCardIds) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }

    const undoResult = session.undoLastStep();

    expect(undoResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(memberCardId);
    for (const energyCardId of energyCardIds) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
  });

  it('debug free play skips entry cost validation and payment', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('member-debug-free-play', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const player = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    const memberCardId = player.hand.cardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(memberCardId).toBeTruthy();
    player.energyZone.cardIds = [];
    player.energyZone.cardStates = new Map();

    const normalResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.CENTER)
    );

    expect(normalResult.success).toBe(false);
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBeNull();

    session.debugFreePlay = true;
    const debugResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, memberCardId!, SlotPosition.CENTER)
    );

    expect(debugResult.success).toBe(true);
    expect(session.state?.pendingCostPayment).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(memberCardId);
    expect(session.state?.players[0].energyZone.cardIds).toEqual([]);
  });
});
