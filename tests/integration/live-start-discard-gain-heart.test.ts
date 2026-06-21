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
import { HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID } from '../../src/application/card-effect-runner';
import { HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

describe('live-start discard gain Heart workflow', () => {
  it('keeps HS-bp1-006 Heart color options at the six standard colors', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'live-start-discard-gain-heart-hs-bp1-006-options',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp1-006-P', '藤島慈', 4),
      PLAYER1,
      'p1-hs-bp1-006-source'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'p1-live-start-heart-pb1-003'
    );
    const otherMember = createCardInstance(
      createMemberCard('PL!HS-test-other', '乙宗梢', 4),
      PLAYER1,
      'p1-hs-bp1-006-other'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!HS-test-discard', '日野下花帆', 3),
      PLAYER1,
      'p1-hs-bp1-006-discard'
    );
    const liveCard = createCardInstance(
      createLiveCard('PL!HS-test-live', 'Live Start'),
      PLAYER1,
      'p1-hs-bp1-006-live'
    );
    const state = registerCards(session.state!, [
      source,
      pb1003Source,
      otherMember,
      discardCard,
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
    p1.memberSlots.slots[SlotPosition.LEFT] = otherMember.instanceId;
    p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
    p1.memberSlots.slots[SlotPosition.RIGHT] = pb1003Source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [otherMember.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [pb1003Source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [discardCard.instanceId];
    p1.liveZone.cardIds = [liveCard.instanceId];
    p1.liveZone.cardStates = new Map([
      [liveCard.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID
    );

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: HeartColor.PINK, label: '粉心' },
      { id: HeartColor.RED, label: '红心' },
      { id: HeartColor.YELLOW, label: '黄心' },
      { id: HeartColor.GREEN, label: '绿心' },
      { id: HeartColor.BLUE, label: '蓝心' },
      { id: HeartColor.PURPLE, label: '紫心' },
    ]);

    const heartResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        HeartColor.PINK
      )
    );

    expect(heartResult.success).toBe(true);
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
