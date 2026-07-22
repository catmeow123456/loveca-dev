import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
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
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID,
  HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID,
  HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID,
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
  cost = 1,
  unitName = 'みらくらぱーく！'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空'],
    unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(
  cardCode: string,
  name = cardCode,
  unitName = 'みらくらぱーく！'
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空'],
    unitName,
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

describe('HS-bp6-003 Rurino workflow', () => {
  it('activates a waiting Mira-Cra member then recovers a Mira-Cra LIVE on enter', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp6-003-on-enter', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp6-003-R', '大沢瑠璃乃', 11),
      PLAYER1,
      'p1-hs-bp6-003-source'
    );
    const waitingMember = createCardInstance(
      createMemberCard('PL!HS-test-waiting-miracra', 'Mira-Cra waiting', 4),
      PLAYER1,
      'p1-hs-bp6-003-waiting'
    );
    const liveToRecover = createCardInstance(
      createLiveCard('PL!HS-test-miracra-live', 'Mira-Cra Live'),
      PLAYER1,
      'p1-hs-bp6-003-live-recover'
    );
    const state = registerCards(session.state!, [source, waitingMember, liveToRecover]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const mainDeckCardIds = [...p1.mainDeck.cardIds];
    removeFromPlayerZones(p1);
    p1.mainDeck.cardIds = mainDeckCardIds;
    p1.hand.cardIds = [source.instanceId];
    p1.waitingRoom.cardIds = [liveToRecover.instanceId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: waitingMember.instanceId,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map([
      [
        waitingMember.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
      ],
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    session.setManualOperationMode('FREE');
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP6_003_SELECT_WAITING_MIRACRA_MEMBER');

    const activateResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        waitingMember.instanceId
      )
    );

    expect(activateResult.success).toBe(true);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(waitingMember.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(session.state?.activeEffect?.stepId).toBe(
      'HS_BP6_003_SELECT_MIRACRA_LIVE_FROM_WAITING_ROOM'
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([liveToRecover.instanceId]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        liveToRecover.instanceId
      )
    );

    expect(recoverResult.success).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(liveToRecover.instanceId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(liveToRecover.instanceId);
  });

  it('safely ends the on-enter effect when there is no waiting Mira-Cra member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp6-003-no-waiting-target', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp6-003-R', '大沢瑠璃乃', 11),
      PLAYER1,
      'p1-hs-bp6-003-no-target-source'
    );
    const state = registerCards(session.state!, [source]);
    (session as unknown as { authorityState: GameState }).authorityState = state;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();
    (session as unknown as { authorityState: GameState }).authorityState = state;

    session.setManualOperationMode('FREE');
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_003_ON_ENTER_ACTIVATE_MIRACRA_MEMBER_RECOVER_LIVE_ABILITY_ID &&
          action.payload.step === 'NO_WAITING_MIRACRA_MEMBER_TARGET'
      )
    ).toBe(true);
  });

  it('discards a hand card and gives a Mira-Cra stage member pink Heart on live start', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp6-003-live-start-heart', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp6-003-R', '大沢瑠璃乃', 11),
      PLAYER1,
      'p1-hs-bp6-003-live-source'
    );
    const target = createCardInstance(
      createMemberCard('PL!HS-test-target-miracra', 'Mira-Cra target', 4),
      PLAYER1,
      'p1-hs-bp6-003-live-target'
    );
    const discard = createCardInstance(
      createMemberCard('PL!HS-test-discard', 'Discard', 1),
      PLAYER1,
      'p1-hs-bp6-003-discard'
    );
    const live = createCardInstance(
      createLiveCard('PL!HS-test-current-live', 'Current Live'),
      PLAYER1,
      'p1-hs-bp6-003-current-live'
    );
    const state = registerCards(session.state!, [source, target, discard, live]);
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
    p1.memberSlots.slots[SlotPosition.LEFT] = source.instanceId;
    p1.memberSlots.slots[SlotPosition.CENTER] = target.instanceId;
    p1.memberSlots.cardStates = new Map([
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [discard.instanceId];
    p1.liveZone.cardIds = [live.instanceId];
    p1.liveZone.cardStates = new Map([
      [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID
    );

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP6_003_SELECT_MIRACRA_HEART_TARGET');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      source.instanceId,
      target.instanceId,
    ]);

    const targetResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );

    expect(targetResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: source.instanceId,
      abilityId: HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID,
      target: 'TARGET_MEMBER',
      targetMemberCardId: target.instanceId,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
  });

  it('triggers PB1-003 auto once from another card effect hand discard', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'hs-bp6-003-discard-triggers-pb1-003',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp6-003-R', '大沢瑠璃乃', 11),
      PLAYER1,
      'p1-hs-bp6-003-other-discard-source'
    );
    const target = createCardInstance(
      createMemberCard('PL!HS-test-other-discard-target', 'Mira-Cra target', 4),
      PLAYER1,
      'p1-hs-bp6-003-other-discard-target'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'p1-hs-pb1-003-auto-source'
    );
    const discard = createCardInstance(
      createMemberCard('PL!HS-test-other-discard', 'Discard', 1),
      PLAYER1,
      'p1-hs-bp6-003-other-discard'
    );
    const live = createCardInstance(
      createLiveCard('PL!HS-test-other-discard-live', 'Current Live'),
      PLAYER1,
      'p1-hs-bp6-003-other-discard-live'
    );
    const state = registerCards(session.state!, [source, target, pb1003Source, discard, live]);
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
    p1.memberSlots.slots[SlotPosition.LEFT] = source.instanceId;
    p1.memberSlots.slots[SlotPosition.CENTER] = target.instanceId;
    p1.memberSlots.slots[SlotPosition.RIGHT] = pb1003Source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [pb1003Source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [discard.instanceId];
    p1.liveZone.cardIds = [live.instanceId];
    p1.liveZone.cardStates = new Map([
      [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID
    );

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP6_003_SELECT_MIRACRA_HEART_TARGET');

    const targetResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );

    expect(targetResult.success).toBe(true);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toHaveLength(1);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: pb1003Source.instanceId,
      abilityId: HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: pb1003Source.instanceId,
      abilityId: HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
      countDelta: 1,
    });
  });

  it('continues to the next live-start pending ability when skipped', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp6-003-live-start-skip', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp6-003-R', '大沢瑠璃乃', 11),
      PLAYER1,
      'p1-hs-bp6-003-skip-source'
    );
    const nextSource = createCardInstance(
      createMemberCard('PL!HS-bp5-006-R', '安養寺 姫芽', 11),
      PLAYER1,
      'p1-hs-bp6-003-skip-next-source'
    );
    const discard = createCardInstance(
      createMemberCard('PL!HS-test-skip-discard', 'Discard', 1),
      PLAYER1,
      'p1-hs-bp6-003-skip-discard'
    );
    const secondDiscard = createCardInstance(
      createMemberCard('PL!HS-test-skip-second-discard', 'Second discard', 1),
      PLAYER1,
      'p1-hs-bp6-003-skip-second-discard'
    );
    const live = createCardInstance(
      createLiveCard('PL!HS-test-skip-live', 'Current Live'),
      PLAYER1,
      'p1-hs-bp6-003-skip-live'
    );
    const state = registerCards(session.state!, [source, nextSource, discard, secondDiscard, live]);
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
    p1.memberSlots.slots[SlotPosition.LEFT] = source.instanceId;
    p1.memberSlots.slots[SlotPosition.CENTER] = nextSource.instanceId;
    p1.memberSlots.cardStates = new Map([
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [nextSource.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [discard.instanceId, secondDiscard.instanceId];
    p1.liveZone.cardIds = [live.instanceId];
    p1.liveZone.cardStates = new Map([
      [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe('system:select-pending-card-effect');

    const selectBp6003Result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, source.instanceId)
    );

    expect(selectBp6003Result.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID
    );

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_006_LIVE_START_DISCARD_SAME_GROUP_CARDS_SOURCE_HEART_ABILITY_ID
    );
  });
});
