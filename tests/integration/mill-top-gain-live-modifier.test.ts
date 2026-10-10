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
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import {
  createAutoAdvancePublicRevealCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import type { DeckConfig } from '../../src/application/game-service';
import {
  HS_BP5_013_LIVE_START_MILL_GAIN_BLADE_ABILITY_ID,
  HS_BP6_009_LIVE_START_MILL_FOUR_ALL_HASUNOSORA_GAIN_BLADE_ABILITY_ID,
  HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
  HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID,
  HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID,
  N_BP7_020_ON_ENTER_MILL_THREE_TWO_BLADE_HEART_COLORS_GAIN_GREEN_HEART_ABILITY_ID,
  PL_BP8_007_ON_ENTER_MILL_FOUR_MUSE_LIVE_GAIN_BLADE_ABILITY_ID,
  HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  BladeHeartEffect,
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  name = cardCode,
  heartColor = HeartColor.PINK,
  bladeHearts?: MemberCardData['bladeHearts']
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(heartColor, 1)],
    ...(bladeHearts ? { bladeHearts } : {}),
  };
}

function createBladeLiveCard(cardCode: string, heartColor: HeartColor): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹咲'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor }],
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

function advancePublicRevealDwell(session: ReturnType<typeof createGameSession>) {
  const effect = session.state!.activeEffect!;
  expect(effect.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
  const generation = effect.publicRevealGeneration ?? `test-public-reveal:${effect.id}`;
  (session as unknown as { authorityState: GameState }).authorityState = {
    ...session.state!,
    activeEffect: {
      ...effect,
      publicRevealAutoAdvanceAt: 0,
      publicRevealGeneration: generation,
    },
  };
  return session.executeCommand(
    createAutoAdvancePublicRevealCommand(effect.awaitingPlayerId, effect.id, 0, generation)
  );
}

function getStartedMillPayload(
  session: ReturnType<typeof createGameSession>
): Readonly<Record<string, unknown>> {
  return (
    [...session.state!.actionHistory]
      .reverse()
      .find(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'MILL_TOP_CARDS'
      )?.payload ?? {}
  );
}

function createOnEnterMillSession(options: {
  readonly topCards: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly sourceData?: MemberCardData;
}): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
} {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('n-bp7-020-on-enter', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    options.sourceData ?? createMemberCard('PL!N-bp7-020-N', '艾玛·维尔德'),
    PLAYER1,
    'p1-n-bp7-020-source'
  );
  const state = registerCards(session.state!, [
    source,
    ...options.topCards,
    ...(options.waitingCards ?? []),
  ]);
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
  p1.hand.cardIds = [source.instanceId];
  p1.mainDeck.cardIds = options.topCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = (options.waitingCards ?? []).map((card) => card.instanceId);
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: null,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map();

  session.setManualOperationMode('FREE');
  expect(
    session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    ).success
  ).toBe(true);
  return { session, sourceId: source.instanceId };
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
    const remainingDeckCard = createCardInstance(
      createMemberCard('PL!HS-pr-019-test-remaining', 'Remaining', HeartColor.GREEN),
      PLAYER1,
      'p1-hs-pr-019-remaining'
    );
    const state = registerCards(session.state!, [ginko, ...topCards, remainingDeckCard]);
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
    p1.mainDeck.cardIds = [...topCardIds, remainingDeckCard.instanceId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    session.setManualOperationMode('FREE');
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(topCardIds);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);

    const confirmResult = advancePublicRevealDwell(session);

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
    const remainingDeckCard = createCardInstance(
      createMemberCard('PL!HS-pr-021-test-remaining', 'Remaining', HeartColor.PINK),
      PLAYER1,
      'p1-hs-pr-021-remaining'
    );
    const state = registerCards(session.state!, [hime, ...topCards, remainingDeckCard]);
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
    p1.mainDeck.cardIds = [...topCardIds, remainingDeckCard.instanceId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    session.setManualOperationMode('FREE');
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, hime.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(topCardIds);

    const confirmResult = advancePublicRevealDwell(session);

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
    const remainingDeckCard = createCardInstance(
      createMemberCard('PL!HS-sd1-013-test-remaining', 'Remaining', HeartColor.BLUE),
      PLAYER1,
      'p1-hs-sd1-013-remaining'
    );
    const state = registerCards(session.state!, [kosuzu, ...topCards, remainingDeckCard]);
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
    p1.mainDeck.cardIds = [...topCardIds, remainingDeckCard.instanceId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    session.setManualOperationMode('FREE');
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kosuzu.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(topCardIds);

    const confirmResult = advancePublicRevealDwell(session);

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
      remainingDeckCards: [
        createCardInstance(
          createMemberCard('PL!HS-bp5-013-test-remaining', 'Remaining'),
          PLAYER1,
          'p1-hs-bp5-013-remaining'
        ),
      ],
    });

    const timingResult = new GameService().executeCheckTiming(session.state!, [
      TriggerCondition.ON_LIVE_START,
    ]);

    expect(timingResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = timingResult.gameState;
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_013_LIVE_START_MILL_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    const topCardIds = session.state!.activeEffect!.revealedCardIds!;
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(topCardIds);

    const confirmResult = advancePublicRevealDwell(session);

    expect(confirmResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
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
    const topCardIds = session.state!.activeEffect!.revealedCardIds!;
    expect(topCardIds).toHaveLength(0);

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

    session.setManualOperationMode('FREE');
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kosuzu.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    const startPayload = getStartedMillPayload(session);
    const milledCardIds = startPayload.milledCardIds as readonly string[];
    expect(milledCardIds).toHaveLength(3);
    expect(milledCardIds.slice(0, 2)).toEqual(topCards.map((card) => card.instanceId));
    expect(startPayload.conditionMet).toBe(true);
    expect(startPayload.refreshCount).toBe(1);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1 &&
          action.payload.movedCount === 3
      )
    ).toBe(true);

    const confirmResult = advancePublicRevealDwell(session);

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

  it('mills top four and adds BLADE +1 for PL!HS-bp6-009-R when all cards are Hasunosora', () => {
    const session = createLiveStartSession('hs-bp6-009-hasunosora-blade', {
      sourceCard: createCardInstance(
        createMemberCard('PL!HS-bp6-009-R', '日野下花帆'),
        PLAYER1,
        'p1-hs-bp6-009-kaho'
      ),
      topCards: [0, 1, 2, 3].map((index) =>
        createCardInstance(
          { ...createMemberCard(`PL!HS-bp6-009-hasu-${index}`), groupNames: ['蓮ノ空'] },
          PLAYER1,
          `p1-hs-bp6-009-top-${index}`
        )
      ),
    });

    const timingResult = new GameService().executeCheckTiming(session.state!, [
      TriggerCondition.ON_LIVE_START,
    ]);

    expect(timingResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = timingResult.gameState;
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_009_LIVE_START_MILL_FOUR_ALL_HASUNOSORA_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(getStartedMillPayload(session).conditionMet).toBe(true);

    expect(advancePublicRevealDwell(session).success).toBe(true);

    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: 'p1-hs-bp6-009-kaho',
      abilityId: HS_BP6_009_LIVE_START_MILL_FOUR_ALL_HASUNOSORA_GAIN_BLADE_ABILITY_ID,
      countDelta: 1,
    });
  });

  it('does not add BLADE for PL!HS-bp6-009-R when a milled card is not Hasunosora', () => {
    const session = createLiveStartSession('hs-bp6-009-mixed-no-blade', {
      sourceCard: createCardInstance(
        createMemberCard('PL!HS-bp6-009-R', '日野下花帆'),
        PLAYER1,
        'p1-hs-bp6-009-mixed-kaho'
      ),
      topCards: [
        createCardInstance(
          { ...createMemberCard('PL!HS-bp6-009-mixed-0'), groupNames: ['蓮ノ空'] },
          PLAYER1,
          'p1-hs-bp6-009-mixed-0'
        ),
        createCardInstance(
          { ...createMemberCard('PL!N-bp6-009-mixed-1'), groupNames: ['虹ヶ咲'] },
          PLAYER1,
          'p1-hs-bp6-009-mixed-1'
        ),
        createCardInstance(
          { ...createMemberCard('PL!HS-bp6-009-mixed-2'), groupNames: ['蓮ノ空'] },
          PLAYER1,
          'p1-hs-bp6-009-mixed-2'
        ),
        createCardInstance(
          { ...createMemberCard('PL!HS-bp6-009-mixed-3'), groupNames: ['蓮ノ空'] },
          PLAYER1,
          'p1-hs-bp6-009-mixed-3'
        ),
      ],
    });

    const timingResult = new GameService().executeCheckTiming(session.state!, [
      TriggerCondition.ON_LIVE_START,
    ]);

    expect(timingResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = timingResult.gameState;
    expect(getStartedMillPayload(session).conditionMet).toBe(false);
    expect(advancePublicRevealDwell(session).success).toBe(true);

    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId ===
            HS_BP6_009_LIVE_START_MILL_FOUR_ALL_HASUNOSORA_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('uses existing refresh semantics for PL!HS-bp6-009-R and checks four actually milled cards', () => {
    const waitingCards = [0, 1].map((index) =>
      createCardInstance(
        { ...createMemberCard(`PL!HS-bp6-009-refresh-wait-${index}`), groupNames: ['蓮ノ空'] },
        PLAYER1,
        `p1-hs-bp6-009-refresh-wait-${index}`
      )
    );
    const session = createLiveStartSession('hs-bp6-009-refresh', {
      sourceCard: createCardInstance(
        createMemberCard('PL!HS-bp6-009-R', '日野下花帆'),
        PLAYER1,
        'p1-hs-bp6-009-refresh-kaho'
      ),
      topCards: [0, 1].map((index) =>
        createCardInstance(
          { ...createMemberCard(`PL!HS-bp6-009-refresh-top-${index}`), groupNames: ['蓮ノ空'] },
          PLAYER1,
          `p1-hs-bp6-009-refresh-top-${index}`
        )
      ),
      waitingCards,
    });

    const timingResult = new GameService().executeCheckTiming(session.state!, [
      TriggerCondition.ON_LIVE_START,
    ]);

    expect(timingResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = timingResult.gameState;
    const startPayload = getStartedMillPayload(session);
    expect(startPayload.refreshCount).toBe(1);
    expect(startPayload.milledCardIds).toHaveLength(4);
    expect(startPayload.conditionMet).toBe(true);

    expect(advancePublicRevealDwell(session).success).toBe(true);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: 'p1-hs-bp6-009-refresh-kaho',
      abilityId: HS_BP6_009_LIVE_START_MILL_FOUR_ALL_HASUNOSORA_GAIN_BLADE_ABILITY_ID,
      countDelta: 1,
    });
  });

  it('PL!N-bp7-020 counts distinct printed Blade Heart colors only on actually milled MEMBER cards', () => {
    const pinkMember = createCardInstance(
      createMemberCard('n-bp7-020-pink', 'Pink Member', HeartColor.PINK, [
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK },
      ]),
      PLAYER1,
      'p1-n-bp7-020-pink'
    );
    const redLive = createCardInstance(
      createBladeLiveCard('n-bp7-020-red-live', HeartColor.RED),
      PLAYER1,
      'p1-n-bp7-020-red-live'
    );
    const drawMember = createCardInstance(
      createMemberCard('n-bp7-020-draw', 'Draw Member', HeartColor.BLUE, [
        { effect: BladeHeartEffect.DRAW },
      ]),
      PLAYER1,
      'p1-n-bp7-020-draw'
    );
    const remaining = createCardInstance(
      createEnergyCard('n-bp7-020-remaining'),
      PLAYER1,
      'p1-n-bp7-020-remaining'
    );
    const { session, sourceId } = createOnEnterMillSession({
      topCards: [pinkMember, redLive, drawMember, remaining],
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_BP7_020_ON_ENTER_MILL_THREE_TWO_BLADE_HEART_COLORS_GAIN_GREEN_HEART_ABILITY_ID,
      effectText:
        '【登场】将自己的卡组顶的3张卡片放置入休息室。那些成员卡中存在大于等于2种BLADE HEART的颜色的场合，LIVE结束时为止，获得[緑ハート]。',
      stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
      revealedCardIds: [pinkMember.instanceId, redLive.instanceId, drawMember.instanceId],
    });
    expect(getStartedMillPayload(session)).toMatchObject({
      conditionMet: false,
      bladeHeartColors: [HeartColor.PINK],
    });
    expect(advancePublicRevealDwell(session).success).toBe(true);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.sourceCardId === sourceId &&
          modifier.abilityId ===
            N_BP7_020_ON_ENTER_MILL_THREE_TWO_BLADE_HEART_COLORS_GAIN_GREEN_HEART_ABILITY_ID
      )
    ).toBe(false);
  });

  it('PL!N-bp7-020 keeps refresh semantics, one grouped causal event, and gains green Heart for two MEMBER colors', () => {
    const pinkMember = createCardInstance(
      createMemberCard('n-bp7-020-refresh-pink', 'Refresh Pink', HeartColor.PINK, [
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK },
      ]),
      PLAYER1,
      'p1-n-bp7-020-refresh-pink'
    );
    const greenMember = createCardInstance(
      createMemberCard('n-bp7-020-refresh-green', 'Refresh Green', HeartColor.GREEN, [
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GREEN },
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GREEN },
      ]),
      PLAYER1,
      'p1-n-bp7-020-refresh-green'
    );
    const waitingLive = createCardInstance(
      createBladeLiveCard('n-bp7-020-refresh-live', HeartColor.RED),
      PLAYER1,
      'p1-n-bp7-020-refresh-live'
    );
    const waitingEnergy = createCardInstance(
      createEnergyCard('n-bp7-020-refresh-energy'),
      PLAYER1,
      'p1-n-bp7-020-refresh-energy'
    );
    const { session, sourceId } = createOnEnterMillSession({
      topCards: [pinkMember, greenMember],
      waitingCards: [waitingLive, waitingEnergy],
    });
    const payload = getStartedMillPayload(session);
    const milledCardIds = payload.milledCardIds as string[];

    expect(payload).toMatchObject({
      conditionMet: true,
      bladeHeartColors: [HeartColor.PINK, HeartColor.GREEN],
      refreshCount: 1,
    });
    expect(milledCardIds).toHaveLength(3);
    const events = session
      .state!.eventLog.map((entry) => entry.event)
      .filter(
        (event) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      cardInstanceIds: milledCardIds,
      ownerId: PLAYER1,
      controllerId: PLAYER1,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: PLAYER1,
        sourceCardId: sourceId,
        abilityId: N_BP7_020_ON_ENTER_MILL_THREE_TWO_BLADE_HEART_COLORS_GAIN_GREEN_HEART_ABILITY_ID,
      },
    });

    expect(advancePublicRevealDwell(session).success).toBe(true);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: sourceId,
      abilityId: N_BP7_020_ON_ENTER_MILL_THREE_TWO_BLADE_HEART_COLORS_GAIN_GREEN_HEART_ABILITY_ID,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
    });
  });

  it('PL!N-bp7-020 preserves the completed mill when its source leaves before the dwell finishes', () => {
    const milledCards = [HeartColor.PINK, HeartColor.GREEN, HeartColor.BLUE].map((color, index) =>
      createCardInstance(
        createMemberCard(`n-bp7-020-stale-${index}`, `Stale ${index}`, color, [
          { effect: BladeHeartEffect.HEART, heartColor: color },
        ]),
        PLAYER1,
        `p1-n-bp7-020-stale-${index}`
      )
    );
    const remaining = createCardInstance(
      createEnergyCard('n-bp7-020-stale-remaining'),
      PLAYER1,
      'p1-n-bp7-020-stale-remaining'
    );
    const { session, sourceId } = createOnEnterMillSession({
      topCards: [...milledCards, remaining],
    });
    const beforeFinish = session.state!;
    const p1 = beforeFinish.players[0] as unknown as {
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState }>;
      };
    };
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates.delete(sourceId);
    (session as unknown as { authorityState: GameState }).authorityState = beforeFinish;

    expect(advancePublicRevealDwell(session).success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      milledCards.map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) => modifier.kind === 'HEART' && modifier.sourceCardId === sourceId
      )
    ).toBe(false);
    const finishAction = [...(session.state?.actionHistory ?? [])]
      .reverse()
      .find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP7_020_ON_ENTER_MILL_THREE_TWO_BLADE_HEART_COLORS_GAIN_GREEN_HEART_ABILITY_ID
      );
    expect(finishAction?.payload).toMatchObject({
      conditionMet: true,
      rewardApplied: false,
    });
  });
});

function createLiveStartSession(
  gameId: string,
  options: {
    readonly topCards: readonly ReturnType<typeof createCardInstance>[];
    readonly sourceCard?: ReturnType<typeof createCardInstance>;
    readonly remainingDeckCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
  }
): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(gameId, PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const source =
    options.sourceCard ??
    createCardInstance(
      createMemberCard('PL!HS-bp5-013-N', '徒町 小鈴'),
      PLAYER1,
      'p1-hs-bp5-013-kosuzu'
    );
  const state = registerCards(session.state!, [
    source,
    ...options.topCards,
    ...(options.remainingDeckCards ?? []),
    ...(options.waitingCards ?? []),
  ]);
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
  p1.mainDeck.cardIds = [
    ...options.topCards.map((card) => card.instanceId),
    ...(options.remainingDeckCards ?? []).map((card) => card.instanceId),
  ];
  p1.waitingRoom.cardIds = (options.waitingCards ?? []).map((card) => card.instanceId);
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE }],
  ]);
  mutableState.currentPhase = GamePhase.PERFORMANCE;
  mutableState.currentSubPhase = SubPhase.PERFORMANCE_LIVE_START_EFFECTS;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;

  return session;
}

describe('PL!-bp8-007 费用2「东条希」ANY_MATCH and migrated Kaho', () => {
  const nozomiText =
    '【登场】将自己的卡组顶的４张卡片放置入休息室。那些卡片中存在『μ’s』的LIVE卡的场合，LIVE结束时为止，获得[ブレード]。';
  const kahoText =
    '【登场】将自己卡组顶的4张卡放置入休息室。那些卡片中存在LIVE卡的场合，LIVE结束时为止，获得[ブレード][ブレード]。';
  const sourceData = (cardCode = 'PL!-bp8-007-R'): MemberCardData => ({
    ...createMemberCard(cardCode, cardCode.startsWith('PL!HS') ? '日野下花帆' : '东条希'),
    cost: cardCode.startsWith('PL!HS') ? 11 : 2,
    groupNames: [cardCode.startsWith('PL!HS') ? '蓮ノ空' : 'μ’s'],
  });
  function museLive(id: string, groupNames = ['μ’s']) {
    return createCardInstance(
      { ...createBladeLiveCard(id, HeartColor.PINK), groupNames },
      PLAYER1,
      id
    );
  }
  function filler(id: string) {
    return createCardInstance(createMemberCard(id), PLAYER1, id);
  }

  it('registers the full paragraph for every rarity and corrects only Kaho on-enter text', () => {
    for (const rarity of ['R', 'SEC', 'UNKNOWN']) {
      const definitions = getCardAbilityDefinitionsForCardCode(`PL!-bp8-007-${rarity}`);
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toMatchObject({
        abilityId: PL_BP8_007_ON_ENTER_MILL_FOUR_MUSE_LIVE_GAIN_BLADE_ABILITY_ID,
        baseCardCodes: ['PL!-bp8-007'],
        queued: true,
        implemented: true,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      });
      expect(definitions[0].effectText).toBe(nozomiText);
    }
    expect(
      getCardAbilityDefinitionsForCardCode('PL!HS-bp5-001-AR').find(
        (definition) => definition.abilityId === HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID
      )?.effectText
    ).toBe(kahoText);
  });

  it('mills once, emits a grouped causal event, waits for the display, and gains source BLADE once', () => {
    const topCards = [museLive('muse-live', ["μ's"]), filler('f1'), filler('f2'), filler('f3')];
    const { session, sourceId } = createOnEnterMillSession({
      sourceData: sourceData(),
      topCards: [...topCards, filler('remain')],
    });
    const window = session.state!.activeEffect!;
    expect(window.effectText).toBe(nozomiText);
    expect(window.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    expect(window.revealedCardIds).toEqual(topCards.map((card) => card.instanceId));
    expect(window.stepText).toContain('展示结束后获得[ブレード]');
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId)).toBe(1);
    const events = session
      .state!.eventLog.map((entry) => entry.event)
      .filter(
        (event) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      cardInstanceIds: topCards.map((card) => card.instanceId),
      ownerId: PLAYER1,
      controllerId: PLAYER1,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: PLAYER1,
        sourceCardId: sourceId,
        abilityId: PL_BP8_007_ON_ENTER_MILL_FOUR_MUSE_LIVE_GAIN_BLADE_ABILITY_ID,
      },
    });
    expect(
      session.executeCommand(
        createAutoAdvancePublicRevealCommand(
          PLAYER2,
          window.id,
          window.publicRevealAutoAdvanceAt!,
          window.publicRevealGeneration!
        )
      ).success
    ).toBe(false);
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId)).toBe(1);
    expect(advancePublicRevealDwell(session).success).toBe(true);
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId)).toBe(2);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.executeCommand(createConfirmEffectStepCommand(PLAYER1, window.id)).success).toBe(
      false
    );
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      session.state!,
      PLAYER1,
      sourceId,
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(left.liveResolution.liveModifiers).toEqual([]);
  });

  it('does not count a non-Muse LIVE, a Muse MEMBER, or an unrelated waiting-room Muse LIVE', () => {
    const oldLive = museLive('already-waiting');
    const topCards = [
      museLive('other-live', ['虹ヶ咲']),
      createCardInstance(
        { ...createMemberCard('muse-member'), groupNames: ['μ’s'] },
        PLAYER1,
        'muse-member'
      ),
      filler('negative-1'),
      filler('negative-2'),
    ];
    const { session, sourceId } = createOnEnterMillSession({
      sourceData: sourceData(),
      topCards: [...topCards, filler('negative-remain')],
      waitingCards: [oldLive],
    });
    expect(getStartedMillPayload(session).conditionMet).toBe(false);
    expect(advancePublicRevealDwell(session).success).toBe(true);
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId)).toBe(1);
  });

  it('checks actual refresh-aware moves without counting the whole refreshed waiting room', () => {
    const live = museLive('refresh-live');
    const { session, sourceId } = createOnEnterMillSession({
      sourceData: sourceData(),
      topCards: [live, filler('refresh-top')],
      waitingCards: [filler('refresh-wait-a'), filler('refresh-wait-b')],
    });
    const payload = getStartedMillPayload(session);
    expect(payload.refreshCount).toBe(1);
    expect(payload.milledCardIds).toHaveLength(4);
    expect(payload.conditionMet).toBe(true);
    const events = session
      .state!.eventLog.map((entry) => entry.event)
      .filter(
        (event) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ cardInstanceIds: payload.milledCardIds });
    expect(advancePublicRevealDwell(session).success).toBe(true);
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId)).toBe(2);
  });

  it('has no reward or movement event when no card can be milled', () => {
    const { session, sourceId } = createOnEnterMillSession({
      sourceData: sourceData(),
      topCards: [],
    });
    expect(getStartedMillPayload(session)).toMatchObject({
      milledCardIds: [],
      conditionMet: false,
    });
    expect(session.state?.activeEffect?.stepId).toBe('PL_BP8_007_MILL_TOP_FOUR');
    expect(
      session.state?.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toBe(false);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId)).toBe(1);
  });

  it.each(['PL!-bp8-007-R', 'PL!HS-bp5-001-SEC'])(
    'does not transfer the reward to a re-entered rules object for %s',
    (code) => {
      const topCards = [
        museLive('stale-live'),
        filler('stale-1'),
        filler('stale-2'),
        filler('stale-3'),
      ];
      const { session, sourceId } = createOnEnterMillSession({
        sourceData: sourceData(code),
        topCards: [...topCards, filler('stale-remain')],
      });
      const capturedLifecycle = session.state!.activeEffect!.sourceLifecycleId;
      expect(capturedLifecycle).toBeTruthy();
      let state = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
        session.state!,
        PLAYER1,
        sourceId,
        enqueueTriggeredCardEffects
      )!.gameState;
      state = updatePlayer(state, PLAYER1, (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((id) => id !== sourceId),
        },
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, sourceId),
      }));
      state = emitGameEvent(
        state,
        createEnterStageEvent(
          sourceId,
          ZoneType.WAITING_ROOM,
          SlotPosition.CENTER,
          PLAYER1,
          PLAYER1
        )
      );
      (session as unknown as { authorityState: GameState }).authorityState = state;
      expect(advancePublicRevealDwell(session).success).toBe(true);
      expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId)).toBe(1);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
        topCards.map((card) => card.instanceId)
      );
      expect(session.state?.activeEffect).toBeNull();
    }
  );

  it('resumes the existing Kaho step and original metadata without a version fallback', () => {
    const topCards = [
      museLive('restored-live'),
      filler('restored-1'),
      filler('restored-2'),
      filler('restored-3'),
    ];
    const { session, sourceId } = createOnEnterMillSession({
      sourceData: sourceData('PL!HS-bp5-001-SEC'),
      topCards: [...topCards, filler('restored-remain')],
    });
    const window = session.state!.activeEffect!;
    session.restoreRuntimeState({
      authorityState: {
        ...session.state!,
        activeEffect: {
          id: window.id,
          abilityId: HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
          sourceCardId: sourceId,
          controllerId: PLAYER1,
          effectText: kahoText,
          stepId: 'HS_BP5_001_REVEAL_TOP_FOUR',
          awaitingPlayerId: PLAYER1,
          revealedCardIds: topCards.map((card) => card.instanceId),
          metadata: {
            sourceZone: ZoneType.MAIN_DECK,
            orderedResolution: false,
            milledCardIds: topCards.map((card) => card.instanceId),
            liveCardIds: ['restored-live'],
            bladeBonus: 2,
            refreshCount: 0,
          },
        },
      },
      currentPublicSeq: 0,
    });
    expect(session.state?.activeEffect?.effectText).toBe(
      '【登场】将自己卡组顶的4张卡放置入休息室。那些卡片中存在LIVE卡的场合，LIVE结束时为止，获得[ブレード][ブレード]。'
    );
    expect(session.executeCommand(createConfirmEffectStepCommand(PLAYER1, window.id)).success).toBe(
      true
    );
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, sourceId)).toBe(3);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'MILL_TOP_FOUR_GAIN_BLADE_IF_LIVE',
      liveCardIds: ['restored-live'],
      bladeBonus: 2,
      milledCardIds: topCards.map((card) => card.instanceId),
    });
  });

  it('retains only Kaho manual confirmation and bypasses it for an ordered batch', () => {
    const topCards = [
      museLive('manual-live'),
      filler('manual-1'),
      filler('manual-2'),
      filler('manual-3'),
      filler('manual-remain'),
    ];
    const { session, sourceId } = createOnEnterMillSession({
      sourceData: sourceData('PL!HS-bp5-001-SEC'),
      topCards,
    });
    const reset = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: topCards.map((card) => card.instanceId) },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
    }));
    const pending = {
      id: 'manual-kaho',
      abilityId: HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
      sourceCardId: sourceId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [],
    };
    const nozomi = createCardInstance(sourceData(), PLAYER1, 'manual-nozomi-source');
    const twoSources = updatePlayer(registerCards(reset, [nozomi]), PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, nozomi.instanceId),
    }));
    const other = {
      ...pending,
      id: 'manual-nozomi',
      sourceCardId: nozomi.instanceId,
      abilityId: PL_BP8_007_ON_ENTER_MILL_FOUR_MUSE_LIVE_GAIN_BLADE_ABILITY_ID,
    };
    const orderedWindow = resolvePendingCardEffects({
      ...twoSources,
      activeEffect: null,
      pendingAbilities: [pending, other],
    }).gameState;
    session.restoreRuntimeState({ authorityState: orderedWindow, currentPublicSeq: 0 });
    const selected = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, sourceId)
    );
    expect(selected.error).toBeUndefined();
    expect(selected.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('CONFIRM_ONLY_EFFECT');
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(
      topCards.map((card) => card.instanceId)
    );
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    session.restoreRuntimeState({ authorityState: orderedWindow, currentPublicSeq: 0 });
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          true
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
    session.restoreRuntimeState({ authorityState: orderedWindow, currentPublicSeq: 0 });
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, nozomi.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
  });
});
