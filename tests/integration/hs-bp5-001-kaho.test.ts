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
import { HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
    groupName: '莲之空',
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
}): void {
  player.hand.cardIds = [];
  player.mainDeck.cardIds = [];
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
}

describe('HS-bp5-001 Kaho workflow', () => {
  it('mills top four without adding Blade when no revealed card is Live', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp5-001-no-live-mill', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const kaho = createCardInstance(
      createMemberCard('PL!HS-bp5-001-SEC', '日野下花帆', 11),
      PLAYER1,
      'p1-hs-bp5-001-kaho'
    );
    const topCards = [0, 1, 2, 3].map((index) =>
      createCardInstance(
        createMemberCard(`PL!HS-bp5-001-test-member-${index}`, `Member ${index}`),
        PLAYER1,
        `p1-hs-bp5-001-top-${index}`
      )
    );
    const state = registerCards(session.state!, [kaho, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState }>;
      };
    };
    const topCardIds = topCards.map((card) => card.instanceId);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [kaho.instanceId];
    p1.mainDeck.cardIds = [...topCardIds];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kaho.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP5_001_REVEAL_TOP_FOUR');
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topCardIds);
    expect(session.state?.inspectionZone.cardIds).toEqual(topCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual(topCardIds);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID &&
          modifier.sourceCardId === kaho.instanceId
      )
    ).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === kaho.instanceId &&
          action.payload.step === 'MILL_TOP_FOUR_GAIN_BLADE_IF_LIVE' &&
          action.payload.bladeBonus === 0 &&
          Array.isArray(action.payload.liveCardIds) &&
          action.payload.liveCardIds.length === 0 &&
          Array.isArray(action.payload.milledCardIds) &&
          action.payload.milledCardIds.join(',') === topCardIds.join(',')
      )
    ).toBe(true);
  });
});
