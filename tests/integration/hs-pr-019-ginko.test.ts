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
import { HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMemberCard(
  cardCode: string,
  name = cardCode,
  heartColor = HeartColor.PINK
): MemberCardData {
  return {
    cardCode,
    name,
    groupName: '莲之空',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(heartColor, 1)],
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

describe('HS-PR-019 Ginko workflow', () => {
  it('mills top three without adding green Heart when one revealed card is not a green-Heart member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-pr-019-condition-false', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const ginko = createCardInstance(
      createMemberCard('PL!HS-PR-019-PR', '百生吟子', HeartColor.GREEN),
      PLAYER1,
      'p1-hs-pr-019-ginko'
    );
    const topCards = [
      createCardInstance(
        createMemberCard('PL!HS-pr-019-test-green-0', 'Green 0', HeartColor.GREEN),
        PLAYER1,
        'p1-hs-pr-019-top-0'
      ),
      createCardInstance(
        createMemberCard('PL!HS-pr-019-test-pink', 'Pink', HeartColor.PINK),
        PLAYER1,
        'p1-hs-pr-019-top-1'
      ),
      createCardInstance(
        createMemberCard('PL!HS-pr-019-test-green-1', 'Green 1', HeartColor.GREEN),
        PLAYER1,
        'p1-hs-pr-019-top-2'
      ),
    ];
    const state = registerCards(session.state!, [ginko, ...topCards]);
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
    p1.hand.cardIds = [ginko.instanceId];
    p1.mainDeck.cardIds = [...topCardIds];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_PR_019_REVEAL_TOP_THREE');
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topCardIds);
    expect(session.state?.inspectionZone.cardIds).toEqual(topCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual(topCardIds);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.abilityId === HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID &&
          modifier.sourceCardId === ginko.instanceId
      )
    ).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID &&
          action.payload.sourceCardId === ginko.instanceId &&
          action.payload.step === 'FINISH_MILL_TOP_THREE_CHECK_GREEN_HEART_MEMBERS' &&
          action.payload.conditionMet === false &&
          Array.isArray(action.payload.heartBonus) &&
          action.payload.heartBonus.length === 0 &&
          Array.isArray(action.payload.milledCardIds) &&
          action.payload.milledCardIds.join(',') === topCardIds.join(',')
      )
    ).toBe(true);
  });
});
