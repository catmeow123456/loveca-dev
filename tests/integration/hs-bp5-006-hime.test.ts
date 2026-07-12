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
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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
  groupName = '莲之空',
  cost = 1
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, name = cardCode, groupName = '莲之空'): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
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
  const ruleSentinelCardId = player.mainDeck.cardIds.at(-1);
  player.hand.cardIds = [];
  player.mainDeck.cardIds = ruleSentinelCardId ? [ruleSentinelCardId] : [];
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

describe('HS-bp5-006 Hime workflow', () => {
  it('discards two same-group hand cards and gives the source member two pink Hearts', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp5-006-live-start', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp5-006-R', '安養寺 姫芽', '莲之空', 11),
      PLAYER1,
      'p1-hs-bp5-006-source'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', '莲之空', 15),
      PLAYER1,
      'p1-hs-bp5-006-pb1-003'
    );
    const hasunosoraMember = createCardInstance(
      createMemberCard('PL!HS-test-member', '莲之空 Member', '莲之空', 4),
      PLAYER1,
      'p1-hs-bp5-006-hand-member'
    );
    const hasunosoraLive = createCardInstance(
      createLiveCard('PL!HS-test-live', '莲之空 Live', '莲之空'),
      PLAYER1,
      'p1-hs-bp5-006-hand-live'
    );
    const liellaMember = createCardInstance(
      createMemberCard('PL!SP-test-member', 'Liella Member', 'Liella!', 4),
      PLAYER1,
      'p1-hs-bp5-006-hand-liella'
    );
    const currentLive = createCardInstance(
      createLiveCard('PL!HS-test-current-live', 'Current Live', '莲之空'),
      PLAYER1,
      'p1-hs-bp5-006-live'
    );
    const state = registerCards(session.state!, [
      source,
      pb1003Source,
      hasunosoraMember,
      hasunosoraLive,
      liellaMember,
      currentLive,
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
    p1.memberSlots.slots[SlotPosition.RIGHT] = pb1003Source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [pb1003Source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [
      hasunosoraMember.instanceId,
      hasunosoraLive.instanceId,
      liellaMember.instanceId,
    ];
    p1.liveZone.cardIds = [currentLive.instanceId];
    p1.liveZone.cardStates = new Map([
      [currentLive.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP5_006_SELECT_SAME_GROUP_HAND_CARDS');
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      hasunosoraMember.instanceId,
      hasunosoraLive.instanceId,
    ]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        [hasunosoraMember.instanceId, hasunosoraLive.instanceId]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([liellaMember.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      hasunosoraMember.instanceId,
      hasunosoraLive.instanceId,
    ]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: source.instanceId,
      abilityId: HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.PINK, count: 2 }],
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.step === 'DISCARD_SAME_GROUP_HAND_CARDS_GAIN_SOURCE_HEART' &&
          Array.isArray(action.payload.discardedCardIds) &&
          action.payload.discardedCardIds.join(',') ===
            [hasunosoraMember.instanceId, hasunosoraLive.instanceId].join(',')
      )
    ).toBe(true);
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
