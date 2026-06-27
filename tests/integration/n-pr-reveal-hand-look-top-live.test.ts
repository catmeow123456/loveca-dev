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
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createPublicObjectId } from '../../src/online/projector';
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
    groupName: '虹ヶ咲学園スクールアイドル同好会',
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
    groupName: '虹ヶ咲学園スクールアイドル同好会',
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
    createMemberCard(`PL!N-test-member-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

interface ScenarioOptions {
  readonly sourceCardCode?: string;
  readonly handCards?: readonly AnyCardData[];
  readonly topCards?: readonly AnyCardData[];
  readonly hasOtherStageMember?: boolean;
}

interface Scenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly handCardIds: readonly string[];
  readonly topCardIds: readonly string[];
}

function setupScenario(options: ScenarioOptions = {}): Scenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('n-pr-reveal-hand-look-top-live', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard(options.sourceCardCode ?? 'PL!N-PR-003-PR', '上原歩夢', 9),
    PLAYER1,
    'p1-n-pr-source'
  );
  const otherStageMember =
    options.hasOtherStageMember === false
      ? null
      : createCardInstance(
          createMemberCard('PL!N-test-other-member', 'Other Member', 1),
          PLAYER1,
          'p1-other-stage-member'
        );
  const handCards = (options.handCards ?? [createMemberCard('PL!N-test-hand-member')]).map(
    (card, index) => createCardInstance(card, PLAYER1, `p1-hand-${index}`)
  );
  const topCards = (options.topCards ?? []).map((card, index) =>
    createCardInstance(card, PLAYER1, `p1-top-${index}`)
  );

  const state = registerCards(
    session.state!,
    [source, otherStageMember, ...handCards, ...topCards].filter(
      (card): card is NonNullable<typeof card> => card !== null
    )
  );
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
  mutableState.waitingPlayerId = null;

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
  p1.hand.cardIds = handCards.map((card) => card.instanceId);
  p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: otherStageMember?.instanceId ?? null,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map(
    [
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      otherStageMember
        ? [
            otherStageMember.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ]
        : null,
    ].filter((entry): entry is [string, { orientation: OrientationState; face: FaceState }] =>
      entry !== null
    )
  );

  return {
    session,
    sourceId: source.instanceId,
    handCardIds: handCards.map((card) => card.instanceId),
    topCardIds: topCards.map((card) => card.instanceId),
  };
}

function activate(scenario: Scenario) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID
    )
  );
}

function confirmCurrentEffect(scenario: Scenario, selectedCardId?: string | null) {
  return scenario.session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      scenario.session.state!.activeEffect!.id,
      selectedCardId
    )
  );
}

function hasAbilityUseAction(state: GameState | null | undefined, sourceId: string): boolean {
  return (
    state?.actionHistory.some(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          N_PR_REVEAL_HAND_NO_LIVE_LOOK_TOP_FIVE_TAKE_LIVE_ABILITY_ID &&
        action.payload.sourceCardId === sourceId &&
        action.payload.step === 'ABILITY_USE'
    ) ?? false
  );
}

describe('PL!N-PR reveal hand no-live look-top activated workflow', () => {
  it('reveals a no-LIVE hand, inspects top five, reveals one LIVE to hand and moves the rest to waiting room', () => {
    const scenario = setupScenario({
      topCards: [
        createMemberCard('PL!N-top-member-0'),
        createLiveCard('PL!N-top-live-1', 'Selected LIVE'),
        createMemberCard('PL!N-top-member-2'),
        createLiveCard('PL!N-top-live-3', 'Unselected LIVE'),
        createMemberCard('PL!N-top-member-4'),
      ],
    });

    expect(activate(scenario).success).toBe(true);
    expect(scenario.session.state?.activeEffect?.revealedCardIds).toEqual(scenario.handCardIds);
    expect(confirmCurrentEffect(scenario).success).toBe(true);
    expect(scenario.session.state?.activeEffect?.inspectionCardIds).toEqual(scenario.topCardIds);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.topCardIds[1],
      scenario.topCardIds[3],
    ]);

    expect(confirmCurrentEffect(scenario, scenario.topCardIds[1]).success).toBe(true);
    expect(scenario.session.state?.inspectionZone.revealedCardIds).toContain(
      scenario.topCardIds[1]
    );
    expect(confirmCurrentEffect(scenario).success).toBe(true);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([
      ...scenario.handCardIds,
      scenario.topCardIds[1],
    ]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.topCardIds[0],
      scenario.topCardIds[2],
      scenario.topCardIds[3],
      scenario.topCardIds[4],
    ]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([]);
  });

  it('does not inspect or move deck cards when the revealed hand contains a LIVE', () => {
    const scenario = setupScenario({
      handCards: [createLiveCard('PL!N-hand-live')],
      topCards: [createLiveCard('PL!N-top-live')],
    });

    expect(activate(scenario).success).toBe(true);
    expect(confirmCurrentEffect(scenario).success).toBe(true);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.inspectionZone.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual(scenario.topCardIds);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(hasAbilityUseAction(scenario.session.state, scenario.sourceId)).toBe(true);
  });

  it('cannot activate without another stage member and does not consume the turn-once limit', () => {
    const scenario = setupScenario({ hasOtherStageMember: false });

    expect(activate(scenario).success).toBe(false);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(hasAbilityUseAction(scenario.session.state, scenario.sourceId)).toBe(false);
  });

  it('treats an empty hand as no LIVE and moves fewer than five inspected non-LIVE cards to waiting room', () => {
    const scenario = setupScenario({
      handCards: [],
      topCards: [
        createMemberCard('PL!N-top-member-0'),
        createMemberCard('PL!N-top-member-1'),
        createMemberCard('PL!N-top-member-2'),
      ],
    });

    expect(activate(scenario).success).toBe(true);
    expect(confirmCurrentEffect(scenario).success).toBe(true);
    expect(scenario.session.state?.activeEffect?.inspectionCardIds).toEqual(scenario.topCardIds);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(confirmCurrentEffect(scenario, null).success).toBe(true);

    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(scenario.topCardIds);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([]);
  });

  it('rejects a second activation from the same source in the same turn', () => {
    const scenario = setupScenario({
      handCards: [createLiveCard('PL!N-hand-live')],
      topCards: [createMemberCard('PL!N-top-member')],
    });

    expect(activate(scenario).success).toBe(true);
    expect(confirmCurrentEffect(scenario).success).toBe(true);

    expect(activate(scenario).success).toBe(false);
  });

  it('keeps top-deck inspection private while revealing hand cards and the selected LIVE only', () => {
    const scenario = setupScenario({
      topCards: [
        createMemberCard('PL!N-top-member-0'),
        createLiveCard('PL!N-top-live-1', 'Selected LIVE'),
      ],
    });

    expect(activate(scenario).success).toBe(true);
    const opponentRevealHandView = scenario.session.getPlayerViewState(PLAYER2)!;
    expect(opponentRevealHandView.activeEffect?.revealedObjectIds).toEqual(
      scenario.handCardIds.map(createPublicObjectId)
    );
    expect(
      opponentRevealHandView.objects[createPublicObjectId(scenario.handCardIds[0]!)]?.surface
    ).toBe('FRONT');

    expect(confirmCurrentEffect(scenario).success).toBe(true);
    const opponentInspectionView = scenario.session.getPlayerViewState(PLAYER2)!;
    const inspectionZone = opponentInspectionView.table.zones.FIRST_INSPECTION_ZONE;
    expect(inspectionZone.objectIds).toEqual(scenario.topCardIds.map(createPublicObjectId));
    expect(inspectionZone.objectIds).not.toContain(scenario.topCardIds[0]);
    expect(
      opponentInspectionView.objects[createPublicObjectId(scenario.topCardIds[0]!)]?.surface
    ).toBe('BACK');
    expect(
      opponentInspectionView.objects[createPublicObjectId(scenario.topCardIds[1]!)]?.surface
    ).toBe('BACK');

    expect(confirmCurrentEffect(scenario, scenario.topCardIds[1]).success).toBe(true);
    const opponentRevealSelectedView = scenario.session.getPlayerViewState(PLAYER2)!;
    expect(
      opponentRevealSelectedView.objects[createPublicObjectId(scenario.topCardIds[1]!)]?.surface
    ).toBe('FRONT');
    expect(
      opponentRevealSelectedView.objects[createPublicObjectId(scenario.topCardIds[0]!)]?.surface
    ).toBe('BACK');
  });
});
