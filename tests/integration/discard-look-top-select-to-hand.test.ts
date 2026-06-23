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
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
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
  unitName?: string,
  hearts: readonly ReturnType<typeof createHeartIcon>[] = [createHeartIcon(HeartColor.PINK, 1)]
): MemberCardData {
  return {
    cardCode,
    name,
    groupName: '虹咲学园学园偶像同好会',
    unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts,
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createLiveCard(cardCode: string, name = cardCode, unitName?: string): LiveCardData {
  return {
    cardCode,
    name,
    groupName: '莲之空女学院学园偶像俱乐部',
    unitName,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
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
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.MAIN_FREE;
  state.currentTurnType = TurnType.NORMAL;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

function clearPlayerZones(player: {
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

describe('discard look top select to hand shared workflow', () => {
  it('lets top five LIVE cards discard one, inspect five, reveal a selected LIVE, and take it', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-five-live-sayaka',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp1-011-N', '村野さやか', 9),
      PLAYER1,
      'p1-hs-bp1-011-source'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'p1-discard-look-pb1-003'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!HS-test-discard', 'Discard target'),
      PLAYER1,
      'p1-hs-bp1-011-discard'
    );
    const topCards = [
      createCardInstance(createMemberCard('PL!HS-test-member-0', 'Member 0'), PLAYER1, 'top-0'),
      createCardInstance(createLiveCard('PL!HS-test-live-1', 'Live 1'), PLAYER1, 'top-1-live'),
      createCardInstance(createMemberCard('PL!HS-test-member-2', 'Member 2'), PLAYER1, 'top-2'),
      createCardInstance(createLiveCard('PL!HS-test-live-3', 'Live 3'), PLAYER1, 'top-3-live'),
      createCardInstance(createMemberCard('PL!HS-test-member-4', 'Member 4'), PLAYER1, 'top-4'),
      createCardInstance(createMemberCard('PL!HS-test-extra-5', 'Extra 5'), PLAYER1, 'top-5'),
    ];

    let state = registerCards(session.state!, [source, pb1003Source, discardCard, ...topCards]);
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
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);
    p1.memberSlots.slots[SlotPosition.RIGHT] = pb1003Source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [pb1003Source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCard.instanceId]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(
      topCards.slice(0, 5).map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[1]!.instanceId,
      topCards[3]!.instanceId,
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        topCards[3]!.instanceId
      )
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(topCards[3]!.instanceId);

    const revealConfirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(revealConfirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[3]!.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCard.instanceId,
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
      topCards[2]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[5]!.instanceId]);
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

  it('lets PL!HS-bp1-009 inspect top five and reveal a Mira-Cra Park card including LIVE', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-five-miracra-card-hime',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp1-009-R', '安養寺 姫芽', 4, 'みらくらぱーく！'),
      PLAYER1,
      'p1-hs-bp1-009-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!HS-bp1-009-discard', 'Discard target'),
      PLAYER1,
      'p1-hs-bp1-009-discard'
    );
    const topCards = [
      createCardInstance(
        createMemberCard('PL!HS-miracra-member-0', 'Mira-Cra member', 1, 'みらくらぱーく!'),
        PLAYER1,
        'miracra-top-0-member'
      ),
      createCardInstance(
        createLiveCard('PL!HS-miracra-live-1', 'Mira-Cra live', 'みらくらぱーく！'),
        PLAYER1,
        'miracra-top-1-live'
      ),
      createCardInstance(
        createMemberCard('PL!HS-doll-member-2', 'DOLLCHESTRA member', 1, 'DOLLCHESTRA'),
        PLAYER1,
        'miracra-top-2-wrong-member'
      ),
      createCardInstance(
        createLiveCard('PL!HS-doll-live-3', 'DOLLCHESTRA live', 'DOLLCHESTRA'),
        PLAYER1,
        'miracra-top-3-wrong-live'
      ),
      createCardInstance(
        createMemberCard('PL!HS-miracra-member-4', 'Mira-Cra member 2', 1, 'みらくらぱーく！'),
        PLAYER1,
        'miracra-top-4-member'
      ),
      createCardInstance(
        createLiveCard('PL!HS-miracra-extra-5', 'Extra Mira-Cra live', 'みらくらぱーく！'),
        PLAYER1,
        'miracra-top-5-extra'
      ),
    ];

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCard.instanceId]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(
      topCards.slice(0, 5).map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        topCards[1]!.instanceId
      )
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(topCards[1]!.instanceId);

    const revealConfirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(revealConfirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[1]!.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCard.instanceId,
      topCards[0]!.instanceId,
      topCards[2]!.instanceId,
      topCards[3]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[5]!.instanceId]);
  });

  it('uses the DOLLCHESTRA unit-card selector for PL!HS-pb1-018', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-five-dollchestra-card-sayaka',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-pb1-018-N', '村野さやか', 4, 'DOLLCHESTRA'),
      PLAYER1,
      'p1-hs-pb1-018-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!HS-pb1-018-discard', 'Discard target'),
      PLAYER1,
      'p1-hs-pb1-018-discard'
    );
    const topCards = [
      createCardInstance(
        createMemberCard('PL!HS-doll-member-0', 'DOLLCHESTRA member', 1, 'DOLLCHESTRA'),
        PLAYER1,
        'doll-top-0-member'
      ),
      createCardInstance(
        createLiveCard('PL!HS-doll-live-1', 'DOLLCHESTRA live', 'DOLLCHESTRA'),
        PLAYER1,
        'doll-top-1-live'
      ),
      createCardInstance(
        createMemberCard('PL!HS-miracra-member-2', 'Mira-Cra member', 1, 'みらくらぱーく！'),
        PLAYER1,
        'doll-top-2-wrong-member'
      ),
      createCardInstance(
        createLiveCard('PL!HS-miracra-live-3', 'Mira-Cra live', 'みらくらぱーく！'),
        PLAYER1,
        'doll-top-3-wrong-live'
      ),
      createCardInstance(
        createMemberCard('PL!HS-doll-member-4', 'DOLLCHESTRA member 2', 1, 'DOLLCHESTRA'),
        PLAYER1,
        'doll-top-4-member'
      ),
    ];

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(playResult.success).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(
      topCards.map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
      topCards[4]!.instanceId,
    ]);
  });

  it('lets PL!SP-pb1-015 inspect top five and reveal a CatChu! card including LIVE', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-five-catchu-card-sumire',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!SP-pb1-015-N', '平安名すみれ', 4, 'CatChu!'),
      PLAYER1,
      'p1-sp-pb1-015-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!SP-pb1-015-discard', 'Discard target'),
      PLAYER1,
      'p1-sp-pb1-015-discard'
    );
    const topCards = [
      createCardInstance(
        createMemberCard('PL!SP-catchu-member-0', 'CatChu member', 1, 'CatChu!'),
        PLAYER1,
        'catchu-top-0-member'
      ),
      createCardInstance(
        createLiveCard('PL!SP-catchu-live-1', 'CatChu live', 'CatChu!'),
        PLAYER1,
        'catchu-top-1-live'
      ),
      createCardInstance(
        createMemberCard('PL!SP-kaleido-member-2', 'KALEIDOSCORE member', 1, 'KALEIDOSCORE'),
        PLAYER1,
        'catchu-top-2-wrong-member'
      ),
      createCardInstance(
        createLiveCard('PL!SP-5yncri5e-live-3', '5yncri5e live', '5yncri5e!'),
        PLAYER1,
        'catchu-top-3-wrong-live'
      ),
      createCardInstance(
        createMemberCard('PL!SP-catchu-member-4', 'CatChu member 2', 1, 'CatChu!'),
        PLAYER1,
        'catchu-top-4-member'
      ),
      createCardInstance(
        createLiveCard('PL!SP-catchu-extra-5', 'Extra CatChu live', 'CatChu!'),
        PLAYER1,
        'catchu-top-5-extra'
      ),
    ];

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(
      topCards.slice(0, 5).map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        topCards[1]!.instanceId
      )
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(topCards[1]!.instanceId);

    const revealConfirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(revealConfirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[1]!.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCard.instanceId,
      topCards[0]!.instanceId,
      topCards[2]!.instanceId,
      topCards[3]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[5]!.instanceId]);
  });

  it('lets PL!SP-bp1-005 inspect top five and reveal a Liella! card including LIVE', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-five-liella-card-ren',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!SP-bp1-005-P', '葉月 恋', 2),
      PLAYER1,
      'p1-sp-bp1-005-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!SP-bp1-005-discard', 'Discard target'),
      PLAYER1,
      'p1-sp-bp1-005-discard'
    );
    const topCards = [
      createCardInstance(
        createMemberCard('PL!SP-catchu-member-0', 'CatChu member', 1, 'CatChu!'),
        PLAYER1,
        'liella-top-0-catchu-member'
      ),
      createCardInstance(
        createLiveCard('PL!SP-kaleidoscore-live-1', 'KALEIDOSCORE live', 'KALEIDOSCORE'),
        PLAYER1,
        'liella-top-1-kaleidoscore-live'
      ),
      createCardInstance(
        createMemberCard('PL!SP-5yncri5e-member-2', '5yncri5e member', 1, '5yncri5e!'),
        PLAYER1,
        'liella-top-2-5yncri5e-member'
      ),
      createCardInstance(
        createLiveCard('PL!N-other-live-3', 'Nijigasaki live', 'A・ZU・NA'),
        PLAYER1,
        'liella-top-3-wrong-live'
      ),
      createCardInstance(
        createMemberCard('PL!SP-no-unit-member-4', 'No unit Liella member', 1),
        PLAYER1,
        'liella-top-4-no-unit-member'
      ),
      createCardInstance(
        createLiveCard('PL!SP-liella-extra-5', 'Extra Liella live', 'Liella!'),
        PLAYER1,
        'liella-top-5-extra'
      ),
    ];

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(
      topCards.slice(0, 5).map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
      topCards[2]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        topCards[2]!.instanceId
      )
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(topCards[2]!.instanceId);

    const revealConfirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(revealConfirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[2]!.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCard.instanceId,
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
      topCards[3]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[5]!.instanceId]);
  });

  it('lets PL!-pb1-016 inspect top four and reveal a lilywhite card including LIVE', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-four-lilywhite-card-nozomi',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!-pb1-016-R', '東條 希', 9, 'lilywhite'),
      PLAYER1,
      'p1-pb1-016-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!-pb1-016-discard', 'Discard target'),
      PLAYER1,
      'p1-pb1-016-discard'
    );
    const topCards = [
      createCardInstance(
        createMemberCard('PL!-lilywhite-member-0', 'lilywhite member', 1, 'lilywhite'),
        PLAYER1,
        'lilywhite-top-0-member'
      ),
      createCardInstance(
        createLiveCard('PL!-lilywhite-live-1', 'lilywhite live', 'lilywhite'),
        PLAYER1,
        'lilywhite-top-1-live'
      ),
      createCardInstance(
        createMemberCard('PL!-bibi-member-2', 'BiBi member', 1, 'BiBi'),
        PLAYER1,
        'lilywhite-top-2-wrong-member'
      ),
      createCardInstance(
        createLiveCard('PL!-printemps-live-3', 'Printemps live', 'Printemps'),
        PLAYER1,
        'lilywhite-top-3-wrong-live'
      ),
      createCardInstance(
        createMemberCard('PL!-lilywhite-extra-4', 'Extra lilywhite member', 1, 'lilywhite'),
        PLAYER1,
        'lilywhite-top-4-extra'
      ),
    ];

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(
      topCards.slice(0, 4).map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        topCards[1]!.instanceId
      )
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(topCards[1]!.instanceId);

    const revealConfirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(revealConfirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[1]!.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCard.instanceId,
      topCards[0]!.instanceId,
      topCards[2]!.instanceId,
      topCards[3]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[4]!.instanceId]);
  });

  it('lets PL!S-bp2-005 discard one, inspect top seven, and reveal up to three red green blue Heart members', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('discard-look-top-seven-yohane', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!S-bp2-005-R+', '渡辺 曜', 13, 'CYaRon！', [
        createHeartIcon(HeartColor.RED, 2),
        createHeartIcon(HeartColor.GREEN, 2),
        createHeartIcon(HeartColor.BLUE, 2),
      ]),
      PLAYER1,
      'p1-s-bp2-005-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!S-bp2-005-discard', 'Discard target'),
      PLAYER1,
      'p1-s-bp2-005-discard'
    );
    const topCards = [
      createCardInstance(
        createMemberCard('PL!S-red-member', 'Red member', 1, undefined, [
          createHeartIcon(HeartColor.RED, 1),
        ]),
        PLAYER1,
        's-bp2-005-top-red'
      ),
      createCardInstance(
        createMemberCard('PL!S-green-member', 'Green member', 1, undefined, [
          createHeartIcon(HeartColor.GREEN, 1),
        ]),
        PLAYER1,
        's-bp2-005-top-green'
      ),
      createCardInstance(
        createMemberCard('PL!S-blue-member', 'Blue member', 1, undefined, [
          createHeartIcon(HeartColor.BLUE, 1),
        ]),
        PLAYER1,
        's-bp2-005-top-blue'
      ),
      createCardInstance(
        createMemberCard('PL!S-yellow-member', 'Yellow member', 1, undefined, [
          createHeartIcon(HeartColor.YELLOW, 1),
        ]),
        PLAYER1,
        's-bp2-005-top-yellow'
      ),
      createCardInstance(createLiveCard('PL!S-red-live', 'Red live'), PLAYER1, 's-bp2-005-top-live'),
      createCardInstance(createEnergyCard('PL!S-energy'), PLAYER1, 's-bp2-005-top-energy'),
      createCardInstance(
        createMemberCard('PL!S-purple-member', 'Purple member', 1, undefined, [
          createHeartIcon(HeartColor.PURPLE, 1),
        ]),
        PLAYER1,
        's-bp2-005-top-purple'
      ),
      createCardInstance(
        createMemberCard('PL!S-extra-red-member', 'Extra red member', 1, undefined, [
          createHeartIcon(HeartColor.RED, 1),
        ]),
        PLAYER1,
        's-bp2-005-top-extra'
      ),
    ];

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
      effectText:
        '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的7张卡。可以将至多3张其中的持有[赤ハート]或[緑ハート]或[青ハート]的成员卡公开并加入手牌。其余的卡片放置入休息室。',
      selectableCardIds: [discardCard.instanceId],
      canSkipSelection: true,
    });

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      inspectionCardIds: topCards.slice(0, 7).map((card) => card.instanceId),
      selectableCardIds: [
        topCards[0]!.instanceId,
        topCards[1]!.instanceId,
        topCards[2]!.instanceId,
      ],
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 3,
      canSkipSelection: true,
    });

    const selectedCardIds = [
      topCards[2]!.instanceId,
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
    ];
    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        selectedCardIds
      )
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual(selectedCardIds);

    const revealConfirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(revealConfirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual(selectedCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCard.instanceId,
      topCards[3]!.instanceId,
      topCards[4]!.instanceId,
      topCards[5]!.instanceId,
      topCards[6]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[7]!.instanceId]);
  });

  it('moves all inspected PL!S-bp2-005 cards to waiting room when no red green blue Heart member is found', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('discard-look-top-seven-yohane-no-target', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!S-bp2-005-P', '渡辺 曜', 13),
      PLAYER1,
      'p1-s-bp2-005-no-target-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!S-bp2-005-no-target-discard', 'Discard target'),
      PLAYER1,
      'p1-s-bp2-005-no-target-discard'
    );
    const topCards = [
      createCardInstance(
        createMemberCard('PL!S-yellow-member', 'Yellow member', 1, undefined, [
          createHeartIcon(HeartColor.YELLOW, 1),
        ]),
        PLAYER1,
        's-bp2-005-no-target-yellow'
      ),
      createCardInstance(
        createMemberCard('PL!S-purple-member', 'Purple member', 1, undefined, [
          createHeartIcon(HeartColor.PURPLE, 1),
        ]),
        PLAYER1,
        's-bp2-005-no-target-purple'
      ),
      createCardInstance(createLiveCard('PL!S-live-no-target'), PLAYER1, 's-bp2-005-no-target-live'),
      createCardInstance(createEnergyCard('PL!S-energy-no-target'), PLAYER1, 's-bp2-005-no-target-energy'),
    ];

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    expect(
      session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      ).success
    ).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          discardCard.instanceId
        )
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toMatchObject({
      selectableCardIds: [],
      canSkipSelection: true,
      skipSelectionLabel: '确认',
    });

    const confirmNoTargetResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmNoTargetResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCard.instanceId,
      ...topCards.map((card) => card.instanceId),
    ]);
  });

  it('does not inspect the deck when PL!S-bp2-005 optional discard is declined', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('discard-look-top-seven-yohane-decline', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!S-bp2-005-SEC', '渡辺 曜', 13),
      PLAYER1,
      'p1-s-bp2-005-decline-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!S-bp2-005-decline-discard', 'Discard target'),
      PLAYER1,
      'p1-s-bp2-005-decline-discard'
    );
    const topCards = [0, 1, 2, 3, 4, 5, 6].map((index) =>
      createCardInstance(
        createMemberCard(`PL!S-decline-red-${index}`, `Red member ${index}`, 1, undefined, [
          createHeartIcon(HeartColor.RED, 1),
        ]),
        PLAYER1,
        `s-bp2-005-decline-top-${index}`
      )
    );

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    expect(
      session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      ).success
    ).toBe(true);

    const declineResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(declineResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([discardCard.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(
      topCards.map((card) => card.instanceId)
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('does not inspect the deck when a top five LIVE optional discard is declined', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-five-live-decline',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp6-022-N', '安養寺 姫芽', 9),
      PLAYER1,
      'p1-hs-bp6-022-decline-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!HS-test-decline-discard', 'Discard target'),
      PLAYER1,
      'p1-hs-bp6-022-decline-discard'
    );
    const topCards = [0, 1, 2, 3, 4].map((index) =>
      createCardInstance(
        createLiveCard(`PL!HS-test-decline-live-${index}`, `Live ${index}`),
        PLAYER1,
        `p1-hs-bp6-022-decline-top-${index}`
      )
    );

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(playResult.success).toBe(true);

    const declineResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(declineResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([discardCard.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(
      topCards.map((card) => card.instanceId)
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('does not inspect the deck when a top five LIVE card has no hand card to discard', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-five-live-no-discard',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp1-011-N', '村野さやか', 9),
      PLAYER1,
      'p1-hs-bp1-011-no-discard-source'
    );
    const topCards = [0, 1, 2, 3, 4].map((index) =>
      createCardInstance(
        createLiveCard(`PL!HS-test-no-discard-live-${index}`, `Live ${index}`),
        PLAYER1,
        `p1-hs-bp1-011-no-discard-top-${index}`
      )
    );

    let state = registerCards(session.state!, [source, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(
      topCards.map((card) => card.instanceId)
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('lets top five member cards discard one, inspect five, reveal a selected member, and take it', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-five-member-kaho',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp2-010-N', '日野下花帆', 9),
      PLAYER1,
      'p1-hs-bp2-010-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!HS-test-member-discard', 'Discard target'),
      PLAYER1,
      'p1-hs-bp2-010-discard'
    );
    const topCards = [
      createCardInstance(createMemberCard('PL!HS-test-member-0', 'Member 0'), PLAYER1, 'm-top-0'),
      createCardInstance(createLiveCard('PL!HS-test-live-1', 'Live 1'), PLAYER1, 'm-top-1-live'),
      createCardInstance(createMemberCard('PL!HS-test-member-2', 'Member 2'), PLAYER1, 'm-top-2'),
      createCardInstance(createLiveCard('PL!HS-test-live-3', 'Live 3'), PLAYER1, 'm-top-3-live'),
      createCardInstance(createMemberCard('PL!HS-test-member-4', 'Member 4'), PLAYER1, 'm-top-4'),
      createCardInstance(createMemberCard('PL!HS-test-extra-5', 'Extra 5'), PLAYER1, 'm-top-5'),
    ];

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(
      topCards.slice(0, 5).map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[2]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        topCards[2]!.instanceId
      )
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(topCards[2]!.instanceId);

    const revealConfirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(revealConfirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[2]!.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCard.instanceId,
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
      topCards[3]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[5]!.instanceId]);
  });

  it('lets PL!S-bp3-004 inspect only top four cards for member reveal selection', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-four-member-dia',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!S-bp3-004-P', '黒澤ダイヤ', 5),
      PLAYER1,
      'p1-s-bp3-004-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!S-test-member-discard', 'Discard target'),
      PLAYER1,
      'p1-s-bp3-004-discard'
    );
    const topCards = [
      createCardInstance(createLiveCard('PL!S-test-live-0', 'Live 0'), PLAYER1, 'dia-top-0-live'),
      createCardInstance(createMemberCard('PL!S-test-member-1', 'Member 1'), PLAYER1, 'dia-top-1'),
      createCardInstance(createMemberCard('PL!S-test-member-2', 'Member 2'), PLAYER1, 'dia-top-2'),
      createCardInstance(createMemberCard('PL!S-test-member-3', 'Member 3'), PLAYER1, 'dia-top-3'),
      createCardInstance(createMemberCard('PL!S-test-extra-4', 'Extra 4'), PLAYER1, 'dia-top-4'),
    ];

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(
      topCards.slice(0, 4).map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[1]!.instanceId,
      topCards[2]!.instanceId,
      topCards[3]!.instanceId,
    ]);

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        topCards[1]!.instanceId
      )
    );
    expect(selectResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(topCards[1]!.instanceId);

    const revealConfirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(revealConfirmResult.success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[1]!.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCard.instanceId,
      topCards[0]!.instanceId,
      topCards[2]!.instanceId,
      topCards[3]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[4]!.instanceId]);
  });

  it('lets PL!N-pb1-028 discard one, inspect top two, and must take one card', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('discard-look-top-two-karin', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!N-pb1-028-N', '朝香果林', 4),
      PLAYER1,
      'p1-n-pb1-028-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!N-test-discard', 'Discard target'),
      PLAYER1,
      'p1-n-pb1-028-discard'
    );
    const topCards = [0, 1, 2].map((index) =>
      createCardInstance(
        createMemberCard(`PL!N-test-top-${index}`, `Top ${index}`),
        PLAYER1,
        `p1-n-pb1-028-top-${index}`
      )
    );

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCard.instanceId]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);

    const takeResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        topCards[1]!.instanceId
      )
    );

    expect(takeResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[1]!.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCard.instanceId,
      topCards[0]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[2]!.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID &&
          action.payload.step === 'START_INSPECTION' &&
          Array.isArray(action.payload.inspectedCardIds) &&
          action.payload.inspectedCardIds.length === 2
      )
    ).toBe(true);
  });

  it('does not inspect the deck when the optional discard is declined', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-two-karin-decline',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!N-pb1-028-N', '朝香果林', 4),
      PLAYER1,
      'p1-n-pb1-028-decline-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!N-test-decline-discard', 'Discard target'),
      PLAYER1,
      'p1-n-pb1-028-decline-discard'
    );
    const topCards = [0, 1].map((index) =>
      createCardInstance(
        createMemberCard(`PL!N-test-decline-top-${index}`, `Top ${index}`),
        PLAYER1,
        `p1-n-pb1-028-decline-top-${index}`
      )
    );

    let state = registerCards(session.state!, [source, discardCard, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId, discardCard.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(playResult.success).toBe(true);

    const declineResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(declineResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([discardCard.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(
      topCards.map((card) => card.instanceId)
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('does not inspect the deck when there is no hand card to discard', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-two-karin-no-discard',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!N-pb1-035-N', 'ミア・テイラー', 4),
      PLAYER1,
      'p1-n-pb1-035-source'
    );
    const topCards = [0, 1].map((index) =>
      createCardInstance(
        createMemberCard(`PL!N-test-no-discard-top-${index}`, `Top ${index}`),
        PLAYER1,
        `p1-n-pb1-035-top-${index}`
      )
    );

    let state = registerCards(session.state!, [source, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    clearPlayerZones(p1);
    p1.hand.cardIds = [source.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(
      topCards.map((card) => card.instanceId)
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });
});
