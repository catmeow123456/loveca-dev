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
import { HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createKosuzu(cardCode = 'PL!HS-pb1-005-R'): MemberCardData {
  return {
    cardCode,
    name: '徒町小鈴',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 4,
    hearts: [createHeartIcon(HeartColor.BLUE, 2)],
  };
}

function createMemberCard(cardCode: string, cost: number, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
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
    createMemberCard(`MEM-${index}`, 1)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
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

function setupKosuzuLiveStart(options: {
  readonly sourceCardCode?: string;
  readonly topCard?: ReturnType<typeof createCardInstance>;
  readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly emptyMainDeck?: boolean;
}): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('hs-pb1-005-kosuzu', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createKosuzu(options.sourceCardCode ?? 'PL!HS-pb1-005-R'),
    PLAYER1,
    'kosuzu-source'
  );
  const currentLive = createCardInstance(
    createLiveCard('PL!HS-current-live'),
    PLAYER1,
    'kosuzu-current-live'
  );
  const cards = [
    source,
    currentLive,
    ...(options.topCard ? [options.topCard] : []),
    ...(options.waitingRoomCards ?? []),
  ];
  const state = registerCards(session.state!, cards);
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

  p1.hand.cardIds = [];
  p1.mainDeck.cardIds =
    options.emptyMainDeck === true ? [] : options.topCard ? [options.topCard.instanceId] : [];
  p1.waitingRoom.cardIds = (options.waitingRoomCards ?? []).map((card) => card.instanceId);
  p1.successZone.cardIds = [];
  p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);
  p1.liveZone.cardIds = [currentLive.instanceId];
  p1.liveZone.cardStates = new Map([
    [currentLive.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
  ]);

  advanceToLiveStartEffects(session);
  return session;
}

function submitNumber(session: ReturnType<typeof createGameSession>, selectedNumber: number) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedNumber
    )
  );
}

function confirmRevealedTop(session: ReturnType<typeof createGameSession>) {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
  );
}

describe('PL!HS-pb1-005 Kosuzu live-start workflow', () => {
  it('adds a revealed member to hand when selected number is lower than its cost', () => {
    const topMember = createCardInstance(createMemberCard('PL!HS-top-member-high', 5), PLAYER1, 'top-high');
    const session = setupKosuzuLiveStart({ topCard: topMember });

    expect(session.state?.activeEffect?.numericInput).toMatchObject({
      min: 0,
      integerOnly: true,
    });

    expect(submitNumber(session, 3).success).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual([topMember.instanceId]);
    expect(session.state?.activeEffect?.revealedCardIds).toEqual([topMember.instanceId]);

    expect(confirmRevealedTop(session).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topMember.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('returns the revealed member to deck top and gains BLADE when selected number is higher than its cost', () => {
    const topMember = createCardInstance(createMemberCard('PL!HS-top-member-low', 5), PLAYER1, 'top-low');
    const session = setupKosuzuLiveStart({ topCard: topMember });

    expect(submitNumber(session, 7).success).toBe(true);
    expect(confirmRevealedTop(session).success).toBe(true);

    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe(topMember.instanceId);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: 'kosuzu-source',
      abilityId: HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID,
      countDelta: 2,
    });
  });

  it('adds the revealed member to hand and gains BLADE when selected number equals its cost', () => {
    const topMember = createCardInstance(createMemberCard('PL!HS-top-member-equal', 5), PLAYER1, 'top-equal');
    const session = setupKosuzuLiveStart({
      sourceCardCode: 'PL!HS-pb1-005-P＋',
      topCard: topMember,
    });

    expect(submitNumber(session, 5).success).toBe(true);
    expect(confirmRevealedTop(session).success).toBe(true);

    expect(session.state?.players[0].hand.cardIds).toEqual([topMember.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: 'kosuzu-source',
      abilityId: HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID,
      countDelta: 2,
    });
  });

  it('returns a revealed non-member to deck top without hand or BLADE changes', () => {
    const topLive = createCardInstance(createLiveCard('PL!HS-top-live'), PLAYER1, 'top-live');
    const session = setupKosuzuLiveStart({ topCard: topLive });

    expect(submitNumber(session, 1).success).toBe(true);
    expect(confirmRevealedTop(session).success).toBe(true);

    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe(topLive.instanceId);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionContext).toBeNull();
  });

  it('does not open a numeric input window when the main deck has no top card', () => {
    const session = setupKosuzuLiveStart({ emptyMainDeck: true });

    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID &&
          action.payload.step === 'NO_TOP_CARD'
      )
    ).toBe(true);
  });

  it('refreshes the waiting room before revealing when the main deck is empty', () => {
    const waitingMember = createCardInstance(
      createMemberCard('PL!HS-waiting-member', 2),
      PLAYER1,
      'waiting-member'
    );
    const session = setupKosuzuLiveStart({
      emptyMainDeck: true,
      waitingRoomCards: [waitingMember],
    });

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID
    );

    expect(submitNumber(session, 2).success).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual([waitingMember.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1
      )
    ).toBe(true);

    expect(confirmRevealedTop(session).success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([waitingMember.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('rejects invalid numeric input before revealing the top card', () => {
    const topMember = createCardInstance(createMemberCard('PL!HS-top-member-invalid', 5), PLAYER1, 'top-invalid');
    const session = setupKosuzuLiveStart({ topCard: topMember });
    const effectId = session.state!.activeEffect!.id;

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          effectId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          -1
        )
      ).success
    ).toBe(false);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          effectId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          1.5
        )
      ).success
    ).toBe(false);
    expect(session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId)).success).toBe(
      false
    );
    expect(session.state?.activeEffect?.id).toBe(effectId);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topMember.instanceId]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
  });

  it('rejects selectedNumber after the numeric input step has finished', () => {
    const topMember = createCardInstance(createMemberCard('PL!HS-top-member-no-number', 5), PLAYER1, 'top-no-number');
    const session = setupKosuzuLiveStart({ topCard: topMember });

    expect(submitNumber(session, 3).success).toBe(true);
    const effectId = session.state!.activeEffect!.id;
    expect(session.state?.activeEffect?.numericInput).toBeUndefined();

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          effectId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          3
        )
      ).success
    ).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(effectId);
    expect(session.state?.inspectionZone.cardIds).toEqual([topMember.instanceId]);
  });
});
