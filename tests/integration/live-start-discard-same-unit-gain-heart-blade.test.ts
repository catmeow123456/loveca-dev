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
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  HS_PR_016_LIVE_START_DISCARD_SAME_UNIT_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
  HS_PR_017_LIVE_START_DISCARD_SAME_UNIT_GAIN_BLUE_HEART_BLADE_ABILITY_ID,
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
  unitName?: string,
  groupName = '莲之空',
  cost = 1
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, name = cardCode, unitName?: string): LiveCardData {
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

  const advanceResult = new GameService().advancePhase(state);
  expect(advanceResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;
}

function setupSameUnitSession(options: {
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
  readonly includeHandToWaitingTriggerSource?: boolean;
}): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('same-unit-heart-blade', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard(options.sourceCardCode, options.sourceName, 'スリーズブーケ', '莲之空', 17),
    PLAYER1,
    'same-unit-source'
  );
  const triggerSource = createCardInstance(
    createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 'みらくらぱーく！', '莲之空', 15),
    PLAYER1,
    'same-unit-trigger-source'
  );
  const currentLive = createCardInstance(
    createLiveCard('PL!HS-test-current-live', 'Current Live', 'スリーズブーケ'),
    PLAYER1,
    'same-unit-current-live'
  );
  const cards = options.includeHandToWaitingTriggerSource
    ? [source, triggerSource, currentLive, ...options.handCards]
    : [source, currentLive, ...options.handCards];
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

  removeFromPlayerZones(p1);
  p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
  p1.memberSlots.slots[SlotPosition.RIGHT] = options.includeHandToWaitingTriggerSource
    ? triggerSource.instanceId
    : null;
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ...(options.includeHandToWaitingTriggerSource
      ? [
          [
            triggerSource.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ] as const,
        ]
      : []),
  ]);
  p1.hand.cardIds = options.handCards.map((card) => card.instanceId);
  p1.liveZone.cardIds = [currentLive.instanceId];
  p1.liveZone.cardStates = new Map([
    [currentLive.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
  ]);

  advanceToLiveStartEffects(session);
  return session;
}

describe('live-start discard same UNIT gain Heart and BLADE workflow', () => {
  it('PR-016 discards two same-UNIT hand cards, enqueues hand-to-waiting triggers, and gains green Heart plus BLADE', () => {
    const ceriseMember = createCardInstance(
      createMemberCard('PL!HS-test-member-a', 'Cerise Member A', 'Cerise Bouquet'),
      PLAYER1,
      'same-unit-cerise-member'
    );
    const ceriseLive = createCardInstance(
      createLiveCard('PL!HS-test-live-a', 'Cerise Live A', 'スリーズブーケ'),
      PLAYER1,
      'same-unit-cerise-live'
    );
    const groupOnlyMuse = createCardInstance(
      createMemberCard('PL!-test-member', 'Muse Member', undefined, "μ's"),
      PLAYER1,
      'same-unit-group-only'
    );
    const session = setupSameUnitSession({
      sourceCardCode: 'PL!HS-PR-016-PR',
      sourceName: '日野下花帆',
      handCards: [ceriseMember, ceriseLive, groupOnlyMuse],
      includeHandToWaitingTriggerSource: true,
    });

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PR_016_LIVE_START_DISCARD_SAME_UNIT_GAIN_GREEN_HEART_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      ceriseMember.instanceId,
      ceriseLive.instanceId,
    ]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        [ceriseMember.instanceId, ceriseLive.instanceId]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([groupOnlyMuse.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      ceriseMember.instanceId,
      ceriseLive.instanceId,
    ]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: 'same-unit-source',
      abilityId: HS_PR_016_LIVE_START_DISCARD_SAME_UNIT_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.GREEN, count: 2 }],
    });
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: 'same-unit-source',
      abilityId: HS_PR_016_LIVE_START_DISCARD_SAME_UNIT_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
      countDelta: 2,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === 'same-unit-trigger-source'
      )
    ).toBe(true);
  });

  it('PR-017 accepts Mira-Cra Park English and Japanese UNIT aliases', () => {
    const miraCraMemberA = createCardInstance(
      createMemberCard('PL!HS-test-member-b', 'Mira-Cra Member A', 'Mira-Cra Park!'),
      PLAYER1,
      'same-unit-miracra-member-a'
    );
    const miraCraMemberB = createCardInstance(
      createMemberCard('PL!HS-test-member-c', 'Mira-Cra Member B', 'みらくらぱーく!'),
      PLAYER1,
      'same-unit-miracra-member-b'
    );
    const session = setupSameUnitSession({
      sourceCardCode: 'PL!HS-PR-017-PR',
      sourceName: '村野さやか',
      handCards: [miraCraMemberA, miraCraMemberB],
    });

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        [miraCraMemberA.instanceId, miraCraMemberB.instanceId]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      sourceCardId: 'same-unit-source',
      abilityId: HS_PR_017_LIVE_START_DISCARD_SAME_UNIT_GAIN_BLUE_HEART_BLADE_ABILITY_ID,
      target: 'SOURCE_MEMBER',
      hearts: [{ color: HeartColor.BLUE, count: 2 }],
    });
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: 'same-unit-source',
      abilityId: HS_PR_017_LIVE_START_DISCARD_SAME_UNIT_GAIN_BLUE_HEART_BLADE_ABILITY_ID,
      countDelta: 2,
    });
  });

  it.each([
    {
      sourceCardCode: 'PL!HS-PR-016-PR',
      sourceName: '日野下花帆',
      tripleCardCode: 'PL!HS-bp2-020-L',
      tripleCardName: 'Link to the FUTURE',
      ordinaryUnitName: 'スリーズブーケ',
      ordinaryFirst: false,
      expectedUnitKey: 'cerise-bouquet',
      expectedUnitName: 'Cerise Bouquet',
    },
    {
      sourceCardCode: 'PL!HS-PR-017-PR',
      sourceName: '村野さやか',
      tripleCardCode: 'PL!HS-bp5-018-L',
      tripleCardName: 'AURORA FLOWER',
      ordinaryUnitName: 'DOLLCHESTRA',
      ordinaryFirst: true,
      expectedUnitKey: 'dollchestra',
      expectedUnitName: 'DOLLCHESTRA',
    },
    {
      sourceCardCode: 'PL!HS-PR-016-PR',
      sourceName: '日野下花帆',
      tripleCardCode: 'PL!HS-sd1-020-SD',
      tripleCardName: 'Link to the FUTURE（104期Ver.）',
      ordinaryUnitName: 'Mira-Cra Park!',
      ordinaryFirst: false,
      expectedUnitKey: 'mira-cra-park',
      expectedUnitName: 'Mira-Cra Park!',
    },
  ])(
    'accepts $tripleCardName as sharing $ordinaryUnitName regardless of entity unitName or selection order',
    ({
      sourceCardCode,
      sourceName,
      tripleCardCode,
      tripleCardName,
      ordinaryUnitName,
      ordinaryFirst,
      expectedUnitKey,
      expectedUnitName,
    }) => {
      const tripleUnitLive = createCardInstance(
        createLiveCard(tripleCardCode, tripleCardName),
        PLAYER1,
        `same-unit-triple-${tripleCardCode}`
      );
      const ordinaryUnitCard = createCardInstance(
        createMemberCard(
          `PL!HS-test-${expectedUnitKey}`,
          `${ordinaryUnitName} Member`,
          ordinaryUnitName
        ),
        PLAYER1,
        `same-unit-ordinary-${expectedUnitKey}`
      );
      const handCards = ordinaryFirst
        ? [ordinaryUnitCard, tripleUnitLive]
        : [tripleUnitLive, ordinaryUnitCard];
      const session = setupSameUnitSession({
        sourceCardCode,
        sourceName,
        handCards,
      });

      expect(session.state?.activeEffect?.selectableCardIds).toEqual(
        handCards.map((card) => card.instanceId)
      );

      const confirmResult = session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          null,
          undefined,
          null,
          handCards.map((card) => card.instanceId)
        )
      );

      expect(confirmResult.success).toBe(true);
      expect(session.state?.players[0].hand.cardIds).toEqual([]);
      expect(session.state?.actionHistory).toContainEqual(
        expect.objectContaining({
          type: 'RESOLVE_ABILITY',
          payload: expect.objectContaining({
            step: 'DISCARD_SAME_UNIT_HAND_CARDS_GAIN_SOURCE_HEART_BLADE',
            discardedUnitKey: expectedUnitKey,
            discardedUnitName: expectedUnitName,
          }),
        })
      );
    }
  );

  it('allows two continuous triple-UNIT cards to pair in either selection order', () => {
    for (const reversed of [false, true]) {
      const linkToTheFuture = createCardInstance(
        createLiveCard('PL!HS-bp2-020-L', 'Link to the FUTURE'),
        PLAYER1,
        `same-unit-link-${reversed}`
      );
      const auroraFlower = createCardInstance(
        createLiveCard('PL!HS-bp5-018-L', 'AURORA FLOWER'),
        PLAYER1,
        `same-unit-aurora-${reversed}`
      );
      const handCards = reversed
        ? [auroraFlower, linkToTheFuture]
        : [linkToTheFuture, auroraFlower];
      const session = setupSameUnitSession({
        sourceCardCode: reversed ? 'PL!HS-PR-017-PR' : 'PL!HS-PR-016-PR',
        sourceName: reversed ? '村野さやか' : '日野下花帆',
        handCards,
      });

      const confirmResult = session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          null,
          undefined,
          null,
          handCards.map((card) => card.instanceId)
        )
      );

      expect(confirmResult.success).toBe(true);
      expect(session.state?.actionHistory).toContainEqual(
        expect.objectContaining({
          type: 'RESOLVE_ABILITY',
          payload: expect.objectContaining({
            discardedUnitKey: 'cerise-bouquet',
            discardedUnitName: 'Cerise Bouquet',
          }),
        })
      );
    }
  });

  it("does not use group names such as μ's or Aqours as UNIT names", () => {
    const museMemberA = createCardInstance(
      createMemberCard('PL!-test-member-a', 'Muse Member A', undefined, "μ's"),
      PLAYER1,
      'same-unit-muse-a'
    );
    const museMemberB = createCardInstance(
      createMemberCard('PL!-test-member-b', 'Muse Member B', undefined, "μ's"),
      PLAYER1,
      'same-unit-muse-b'
    );
    const aqoursMember = createCardInstance(
      createMemberCard('PL!S-test-member', 'Aqours Member', undefined, 'Aqours'),
      PLAYER1,
      'same-unit-aqours'
    );
    const session = setupSameUnitSession({
      sourceCardCode: 'PL!HS-PR-016-PR',
      sourceName: '日野下花帆',
      handCards: [museMemberA, museMemberB, aqoursMember],
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([
      museMemberA.instanceId,
      museMemberB.instanceId,
      aqoursMember.instanceId,
    ]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PR_016_LIVE_START_DISCARD_SAME_UNIT_GAIN_GREEN_HEART_BLADE_ABILITY_ID &&
          action.payload.step === 'NO_SAME_UNIT_HAND_PAIR'
      )
    ).toBe(true);
  });

  it('skip leaves hand, waiting room, and live modifiers unchanged', () => {
    const ceriseMemberA = createCardInstance(
      createMemberCard('PL!HS-test-member-d', 'Cerise Member D', 'スリーズブーケ'),
      PLAYER1,
      'same-unit-skip-a'
    );
    const ceriseMemberB = createCardInstance(
      createMemberCard('PL!HS-test-member-e', 'Cerise Member E', 'スリーズブーケ'),
      PLAYER1,
      'same-unit-skip-b'
    );
    const session = setupSameUnitSession({
      sourceCardCode: 'PL!HS-PR-016-PR',
      sourceName: '日野下花帆',
      handCards: [ceriseMemberA, ceriseMemberB],
    });

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([
      ceriseMemberA.instanceId,
      ceriseMemberB.instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('rejects different-UNIT selections without moving cards', () => {
    const ceriseMember = createCardInstance(
      createMemberCard('PL!HS-test-member-f', 'Cerise Member F', 'スリーズブーケ'),
      PLAYER1,
      'same-unit-invalid-cerise'
    );
    const dollMember = createCardInstance(
      createMemberCard('PL!HS-test-member-g', 'Doll Member G', 'DOLLCHESTRA'),
      PLAYER1,
      'same-unit-invalid-doll'
    );
    const ceriseLive = createCardInstance(
      createLiveCard('PL!HS-test-live-f', 'Cerise Live F', 'スリーズブーケ'),
      PLAYER1,
      'same-unit-invalid-live'
    );
    const session = setupSameUnitSession({
      sourceCardCode: 'PL!HS-PR-016-PR',
      sourceName: '日野下花帆',
      handCards: [ceriseMember, dollMember, ceriseLive],
    });

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        [ceriseMember.instanceId, dollMember.instanceId]
      )
    );

    expect(confirmResult.success).toBe(false);
    expect(session.state?.activeEffect).not.toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([
      ceriseMember.instanceId,
      dollMember.instanceId,
      ceriseLive.instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });
});
