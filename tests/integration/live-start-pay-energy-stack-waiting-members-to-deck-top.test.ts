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
import { HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
    groupNames: ['莲之空'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLiveCard(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
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

  const advanceResult = new GameService().advancePhase(state);
  expect(advanceResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;
}

function setupStackWaitingMembersSession(options: {
  readonly sourceCardCode: string;
  readonly waitingCards: readonly ReturnType<typeof createCardInstance>[];
  readonly deckTopCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly activeEnergy?: boolean;
}): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('stack-waiting-members', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard(options.sourceCardCode, '徒町 小鈴', 11),
    PLAYER1,
    'stack-source'
  );
  const currentLive = createCardInstance(
    createLiveCard('PL!HS-test-current-live', 'Current Live'),
    PLAYER1,
    'stack-current-live'
  );
  const deckTopCards =
    options.deckTopCards ??
    [
      createCardInstance(createMemberCard('PL!HS-deck-a', 'Deck A'), PLAYER1, 'stack-deck-a'),
      createCardInstance(createMemberCard('PL!HS-deck-b', 'Deck B'), PLAYER1, 'stack-deck-b'),
    ];
  const state = registerCards(session.state!, [
    source,
    currentLive,
    ...options.waitingCards,
    ...deckTopCards,
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
    energyZone: {
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
  p1.waitingRoom.cardIds = options.waitingCards.map((card) => card.instanceId);
  p1.mainDeck.cardIds = deckTopCards.map((card) => card.instanceId);
  p1.liveZone.cardIds = [currentLive.instanceId];
  p1.liveZone.cardStates = new Map([
    [currentLive.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
  ]);

  const energyOrientation =
    options.activeEnergy === false ? OrientationState.WAITING : OrientationState.ACTIVE;
  p1.energyZone.cardStates = new Map(
    p1.energyZone.cardIds.map((cardId) => [
      cardId,
      { orientation: energyOrientation, face: FaceState.FACE_UP },
    ])
  );

  advanceToLiveStartEffects(session);
  return session;
}

describe('live-start pay energy stack waiting members to deck top workflow', () => {
  it('does not open a payment window when waiting room has fewer than two members', () => {
    const waitingMember = createCardInstance(
      createMemberCard('PL!HS-waiting-a', 'Waiting A'),
      PLAYER1,
      'stack-waiting-a'
    );
    const session = setupStackWaitingMembersSession({
      sourceCardCode: 'PL!HS-PR-020-PR',
      waitingCards: [waitingMember],
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID &&
          action.payload.step === 'NO_WAITING_ROOM_MEMBER_PAIR'
      )
    ).toBe(true);
  });

  it('does not pay energy when no active energy is available', () => {
    const waitingMemberA = createCardInstance(
      createMemberCard('PL!HS-waiting-b', 'Waiting B'),
      PLAYER1,
      'stack-waiting-b'
    );
    const waitingMemberC = createCardInstance(
      createMemberCard('PL!HS-waiting-c', 'Waiting C'),
      PLAYER1,
      'stack-waiting-c'
    );
    const session = setupStackWaitingMembersSession({
      sourceCardCode: 'PL!HS-PR-020-PR',
      waitingCards: [waitingMemberA, waitingMemberC],
      activeEnergy: false,
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID &&
          action.payload.step === 'CANNOT_PAY'
      )
    ).toBe(true);
    expect(session.state?.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('decline leaves energy, waiting room, and deck unchanged', () => {
    const waitingMemberA = createCardInstance(
      createMemberCard('PL!HS-waiting-d', 'Waiting D'),
      PLAYER1,
      'stack-waiting-d'
    );
    const waitingMemberB = createCardInstance(
      createMemberCard('PL!HS-waiting-e', 'Waiting E'),
      PLAYER1,
      'stack-waiting-e'
    );
    const session = setupStackWaitingMembersSession({
      sourceCardCode: 'PL!HS-PR-020-PR',
      waitingCards: [waitingMemberA, waitingMemberB],
    });
    const originalEnergyStates = new Map(session.state!.players[0].energyZone.cardStates);
    const originalMainDeck = [...session.state!.players[0].mainDeck.cardIds];

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        'decline'
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      waitingMemberA.instanceId,
      waitingMemberB.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(originalMainDeck);
    expect(session.state?.players[0].energyZone.cardStates).toEqual(originalEnergyStates);
    expect(session.state?.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('PR-020 pays energy and puts exactly two selected members on top in selection order', () => {
    const waitingMemberA = createCardInstance(
      createMemberCard('PL!HS-waiting-f', 'Waiting F'),
      PLAYER1,
      'stack-waiting-f'
    );
    const waitingMemberB = createCardInstance(
      createMemberCard('PL!HS-waiting-g', 'Waiting G'),
      PLAYER1,
      'stack-waiting-g'
    );
    const waitingMemberC = createCardInstance(
      createMemberCard('PL!HS-waiting-h', 'Waiting H'),
      PLAYER1,
      'stack-waiting-h'
    );
    const session = setupStackWaitingMembersSession({
      sourceCardCode: 'PL!HS-PR-020-PR',
      waitingCards: [waitingMemberA, waitingMemberB, waitingMemberC],
    });

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        'pay'
      )
    );
    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.selectableCardVisibility).toBe('PUBLIC');
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);

    const paidEnergyCardIds = session.state?.actionHistory.find(
      (action) => action.type === 'PAY_COST'
    )?.payload.energyCardIds as readonly string[];
    expect(paidEnergyCardIds).toHaveLength(1);
    expect(session.state?.players[0].energyZone.cardStates.get(paidEnergyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        [waitingMemberB.instanceId, waitingMemberA.instanceId]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds.slice(0, 4)).toEqual([
      waitingMemberB.instanceId,
      waitingMemberA.instanceId,
      'stack-deck-a',
      'stack-deck-b',
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([waitingMemberC.instanceId]);
  });

  it('PR-023 uses the same ability and JP-shaped behavior', () => {
    const waitingMemberA = createCardInstance(
      createMemberCard('PL!HS-waiting-i', 'Waiting I'),
      PLAYER1,
      'stack-waiting-i'
    );
    const waitingMemberB = createCardInstance(
      createMemberCard('PL!HS-waiting-j', 'Waiting J'),
      PLAYER1,
      'stack-waiting-j'
    );
    const session = setupStackWaitingMembersSession({
      sourceCardCode: 'PL!HS-PR-023-PR',
      waitingCards: [waitingMemberA, waitingMemberB],
    });

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID
    );
  });

  it('rejects non-member, duplicate, or no-longer-waiting selections without moving cards', () => {
    const waitingMemberA = createCardInstance(
      createMemberCard('PL!HS-waiting-k', 'Waiting K'),
      PLAYER1,
      'stack-waiting-k'
    );
    const waitingMemberB = createCardInstance(
      createMemberCard('PL!HS-waiting-l', 'Waiting L'),
      PLAYER1,
      'stack-waiting-l'
    );
    const waitingLive = createCardInstance(
      createLiveCard('PL!HS-waiting-live', 'Waiting Live'),
      PLAYER1,
      'stack-waiting-live'
    );
    const session = setupStackWaitingMembersSession({
      sourceCardCode: 'PL!HS-PR-020-PR',
      waitingCards: [waitingMemberA, waitingLive, waitingMemberB],
    });

    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        'pay'
      )
    );
    const paidEnergyCardIds = session.state?.actionHistory.find(
      (action) => action.type === 'PAY_COST'
    )?.payload.energyCardIds as readonly string[];
    const effectId = session.state!.activeEffect!.id;
    const mainDeckBefore = [...session.state!.players[0].mainDeck.cardIds];
    const waitingBefore = [...session.state!.players[0].waitingRoom.cardIds];

    const duplicateResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        effectId,
        undefined,
        null,
        undefined,
        null,
        [waitingMemberA.instanceId, waitingMemberA.instanceId]
      )
    );
    expect(duplicateResult.success).toBe(false);
    expect(session.state?.activeEffect).not.toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(mainDeckBefore);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(waitingBefore);

    const nonMemberResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        effectId,
        undefined,
        null,
        undefined,
        null,
        [waitingMemberA.instanceId, waitingLive.instanceId]
      )
    );
    expect(nonMemberResult.success).toBe(false);
    expect(session.state?.activeEffect).not.toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(mainDeckBefore);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(waitingBefore);

    const stateBeforeTargetLoss = session.state!;
    (stateBeforeTargetLoss.players[0] as unknown as { waitingRoom: { cardIds: string[] } })
      .waitingRoom.cardIds = [waitingLive.instanceId, waitingMemberB.instanceId];
    (session as unknown as { authorityState: GameState }).authorityState = stateBeforeTargetLoss;
    const staleResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        effectId,
        undefined,
        null,
        undefined,
        null,
        [waitingMemberA.instanceId, waitingMemberB.instanceId]
      )
    );
    expect(staleResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(mainDeckBefore);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      waitingLive.instanceId,
      waitingMemberB.instanceId,
    ]);
    expect(session.state?.players[0].energyZone.cardStates.get(paidEnergyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PR_020_LIVE_START_PAY_ENERGY_STACK_WAITING_MEMBERS_TO_DECK_TOP_ABILITY_ID &&
          action.payload.step === 'NO_WAITING_ROOM_MEMBER_PAIR_AFTER_PAYMENT'
      )
    ).toBe(true);
  });
});
