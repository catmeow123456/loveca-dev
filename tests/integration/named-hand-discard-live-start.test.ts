import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
} from '../../src/application/card-effect-runner';
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
    groupName: "μ's",
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
    groupName: "μ's",
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

describe('named hand discard live-start workflow', () => {
  it('uses current selectable count as LL-bp2-001 max and gains blade per discarded card', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'named-hand-discard-live-start-ll-bp2-one-card',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('LL-bp2-001-R+', '渡辺曜&鬼塚夏美&大沢瑠璃乃', 20),
      PLAYER1,
      'p1-ll-bp2-source'
    );
    const matchingHandCard = createCardInstance(
      createMemberCard('PL!S-test-you', '渡边 曜', 4),
      PLAYER1,
      'p1-ll-bp2-you'
    );
    const nonMatchingHandCard = createCardInstance(
      createMemberCard('PL!N-test-karin', '朝香果林', 4),
      PLAYER1,
      'p1-ll-bp2-karin'
    );
    const liveCard = createCardInstance(
      createLiveCard('PL!-test-live', 'Live Start'),
      PLAYER1,
      'p1-ll-bp2-live'
    );
    const state = registerCards(session.state!, [
      source,
      matchingHandCard,
      nonMatchingHandCard,
      liveCard,
    ]);
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
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [matchingHandCard.instanceId, nonMatchingHandCard.instanceId];
    p1.liveZone.cardIds = [liveCard.instanceId];
    p1.liveZone.cardStates = new Map([
      [liveCard.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([matchingHandCard.instanceId]);
    expect(session.state?.activeEffect?.minSelectableCards).toBe(1);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(1);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        [matchingHandCard.instanceId]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([nonMatchingHandCard.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([matchingHandCard.instanceId]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: source.instanceId,
      abilityId: LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
    });
  });
});
