import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import type { DeckConfig } from '../../src/application/game-service';
import {
  HS_BP5_013_LIVE_START_MILL_GAIN_BLADE_ABILITY_ID,
  HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
  HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID,
  HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
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
    groupNames: ['莲之空'],
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

describe('mill-top gain live modifier workflow', () => {
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
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(topCardIds);
    expect(session.state?.activeEffect?.metadata?.milledCardIds).toEqual(topCardIds);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);

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

  it('mills top three and adds pink Heart for PL!HS-PR-021-RM when all revealed cards are pink-Heart members', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-pr-021-condition-true', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const hime = createCardInstance(
      createMemberCard('PL!HS-PR-021-RM', '安養寺 姫芽', HeartColor.PINK),
      PLAYER1,
      'p1-hs-pr-021-hime'
    );
    const topCards = [0, 1, 2].map((index) =>
      createCardInstance(
        createMemberCard(`PL!HS-pr-021-test-pink-${index}`, `Pink ${index}`, HeartColor.PINK),
        PLAYER1,
        `p1-hs-pr-021-top-${index}`
      )
    );
    const state = registerCards(session.state!, [hime, ...topCards]);
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
    p1.hand.cardIds = [hime.instanceId];
    p1.mainDeck.cardIds = [...topCardIds];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, hime.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_PR_021_REVEAL_TOP_THREE');
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(topCardIds);
    expect(session.state?.activeEffect?.metadata?.milledCardIds).toEqual(topCardIds);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: hime.instanceId,
      abilityId: HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID &&
          action.payload.sourceCardId === hime.instanceId &&
          action.payload.step === 'FINISH_MILL_TOP_THREE_CHECK_PINK_HEART_MEMBERS' &&
          action.payload.conditionMet === true
      )
    ).toBe(true);
  });

  it('mills top three and adds blue Heart for PL!HS-sd1-013-SD when all revealed cards are blue-Heart members', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-sd1-013-blue-heart', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const kosuzu = createCardInstance(
      createMemberCard('PL!HS-sd1-013-SD', '徒町小鈴', HeartColor.BLUE),
      PLAYER1,
      'p1-hs-sd1-013-kosuzu'
    );
    const topCards = [0, 1, 2].map((index) =>
      createCardInstance(
        createMemberCard(`PL!HS-sd1-013-test-blue-${index}`, `Blue ${index}`, HeartColor.BLUE),
        PLAYER1,
        `p1-hs-sd1-013-top-${index}`
      )
    );
    const state = registerCards(session.state!, [kosuzu, ...topCards]);
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
    p1.hand.cardIds = [kosuzu.instanceId];
    p1.mainDeck.cardIds = [...topCardIds];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kosuzu.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_SD1_013_REVEAL_TOP_THREE');
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(topCardIds);
    expect(session.state?.activeEffect?.metadata?.milledCardIds).toEqual(topCardIds);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: kosuzu.instanceId,
      abilityId: HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
    });
  });

  it('mills top three and adds BLADE +2 for PL!HS-bp5-013-N when all revealed cards are members', () => {
    const session = createLiveStartSession('hs-bp5-013-blade', {
      topCards: [0, 1, 2].map((index) =>
        createCardInstance(
          createMemberCard(`PL!HS-bp5-013-test-member-${index}`, `Member ${index}`),
          PLAYER1,
          `p1-hs-bp5-013-top-${index}`
        )
      ),
    });

    const timingResult = new GameService().executeCheckTiming(session.state!, [
      TriggerCondition.ON_LIVE_START,
    ]);

    expect(timingResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = timingResult.gameState;
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_013_LIVE_START_MILL_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP5_013_REVEAL_TOP_THREE');
    const topCardIds = session.state!.activeEffect!.metadata!.milledCardIds as readonly string[];
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(topCardIds);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: 'p1-hs-bp5-013-kosuzu',
      abilityId: HS_BP5_013_LIVE_START_MILL_GAIN_BLADE_ABILITY_ID,
      countDelta: 2,
    });
  });

  it('does not add BLADE for PL!HS-bp5-013-N when no cards can be milled', () => {
    const session = createLiveStartSession('hs-bp5-013-short-deck', {
      topCards: [],
    });

    const timingResult = new GameService().executeCheckTiming(session.state!, [
      TriggerCondition.ON_LIVE_START,
    ]);

    expect(timingResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = timingResult.gameState;
    const topCardIds = session.state!.activeEffect!.metadata!.milledCardIds as readonly string[];
    expect(topCardIds).toHaveLength(0);
    expect(session.state?.activeEffect?.metadata?.refreshCount).toBe(0);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === HS_BP5_013_LIVE_START_MILL_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP5_013_LIVE_START_MILL_GAIN_BLADE_ABILITY_ID &&
          action.payload.step === 'FINISH_MILL_TOP_THREE_CHECK_MEMBERS_GAIN_BLADE' &&
          action.payload.conditionMet === false &&
          action.payload.bladeBonus === 0
      )
    ).toBe(true);
  });

  it('refreshes mid-effect and still checks three milled cards for PL!HS-sd1-013-SD', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-sd1-013-short-deck-refresh', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const kosuzu = createCardInstance(
      createMemberCard('PL!HS-sd1-013-SD', '徒町小鈴', HeartColor.BLUE),
      PLAYER1,
      'p1-hs-sd1-013-refresh-kosuzu'
    );
    const topCards = [0, 1].map((index) =>
      createCardInstance(
        createMemberCard(
          `PL!HS-sd1-013-refresh-top-${index}`,
          `Blue Top ${index}`,
          HeartColor.BLUE
        ),
        PLAYER1,
        `p1-hs-sd1-013-refresh-top-${index}`
      )
    );
    const refreshCard = createCardInstance(
      createMemberCard('PL!HS-sd1-013-refresh-waiting', 'Blue Refresh', HeartColor.BLUE),
      PLAYER1,
      'p1-hs-sd1-013-refresh-waiting'
    );
    const state = registerCards(session.state!, [kosuzu, ...topCards, refreshCard]);
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

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [kosuzu.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);
    p1.waitingRoom.cardIds = [refreshCard.instanceId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kosuzu.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    const milledCardIds = session.state!.activeEffect!.metadata!.milledCardIds as readonly string[];
    expect(milledCardIds).toHaveLength(3);
    expect(milledCardIds.slice(0, 2)).toEqual(topCards.map((card) => card.instanceId));
    expect(session.state?.activeEffect?.metadata?.conditionMet).toBe(true);
    expect(session.state?.activeEffect?.metadata?.refreshCount).toBe(1);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1 &&
          action.payload.movedCount === 3
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: kosuzu.instanceId,
      abilityId: HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
    });
  });
});

function createLiveStartSession(
  gameId: string,
  options: { readonly topCards: readonly ReturnType<typeof createCardInstance>[] }
): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(gameId, PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const kosuzu = createCardInstance(
    createMemberCard('PL!HS-bp5-013-N', '徒町 小鈴'),
    PLAYER1,
    'p1-hs-bp5-013-kosuzu'
  );
  const state = registerCards(session.state!, [kosuzu, ...options.topCards]);
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
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };

  removeFromPlayerZones(p1);
  p1.mainDeck.cardIds = options.topCards.map((card) => card.instanceId);
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: kosuzu.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [kosuzu.instanceId, { orientation: OrientationState.ACTIVE }],
  ]);
  mutableState.currentPhase = GamePhase.PERFORMANCE;
  mutableState.currentSubPhase = SubPhase.PERFORMANCE_LIVE_START_EFFECTS;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;

  return session;
}
