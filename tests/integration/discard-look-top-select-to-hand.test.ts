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
  N_BP5_009_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  PL_N_BP3_012_ON_ENTER_DISCARD_LOOK_TOP_NIJIGASAKI_CARD_ABILITY_ID,
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
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

// 真实团体身份必须由结构化 groupNames 决定（卡号前缀不再作为 fallback）。
function groupNamesFromCardCode(cardCode: string): readonly string[] {
  if (cardCode.startsWith('PL!SP-')) return ['Liella!'];
  if (cardCode.startsWith('PL!HS-')) return ['蓮ノ空'];
  if (cardCode.startsWith('PL!N-')) return ['虹ヶ咲'];
  if (cardCode.startsWith('PL!S-')) return ['Aqours'];
  if (cardCode.startsWith('PL!-')) return ["μ's"];
  return ['虹咲学园学园偶像同好会'];
}

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
    groupNames: groupNamesFromCardCode(cardCode),
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

function createLiveCard(
  cardCode: string,
  name = cardCode,
  unitName?: string,
  requirements = createHeartRequirement({ [HeartColor.PINK]: 1 })
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: groupNamesFromCardCode(cardCode),
    unitName,
    cardType: CardType.LIVE,
    score: 3,
    requirements,
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

    const beforeSeq = session.getCurrentPublicEventSeq();
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

    const summary = session
      .getPublicEventsSince(beforeSeq)
      .find((event) => event.type === 'CardEffectSummary' && event.summaryStatus === 'COMPLETED');
    expect(summary?.type).toBe('CardEffectSummary');
    if (summary?.type === 'CardEffectSummary') {
      expect(summary.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
      expect(summary.effectKind).toBe('DISCARD_LOOK_TOP_SELECT_TO_HAND');
      expect(summary.summaryStatus).toBe('COMPLETED');
      expect(summary.sourceCard?.publicObjectId).toBe(`obj_${source.instanceId}`);
      expect(summary.discardedCostCards?.map((card) => card.publicObjectId)).toEqual([
        `obj_${discardCard.instanceId}`,
      ]);
      expect(summary.hiddenDiscardedCostCardCount).toBe(0);
      expect(summary.inspectSourceZone).toBe('MAIN_DECK');
      expect(summary.requestedInspectCount).toBe(5);
      expect(summary.actualInspectedCount).toBe(5);
      expect(summary.selectedCards?.map((card) => card.publicObjectId)).toEqual([
        `obj_${topCards[1]!.instanceId}`,
      ]);
      expect(summary.hiddenSelectedCardCount).toBe(0);
      expect(summary.noSelectedCards).toBe(false);
      expect(summary.waitingRoomCardCount).toBe(4);
    }
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

  it("lets PL!-bp6-004 reveal only a μ's member from top five", () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-five-muse-member-umi',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!-bp6-004-P', '園田海未', 5, 'lilywhite'),
      PLAYER1,
      'p1-bp6-004-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!-bp6-004-discard', 'Discard target'),
      PLAYER1,
      'p1-bp6-004-discard'
    );
    const topCards = [
      createCardInstance(
        createMemberCard('PL!-bp6-004-muse-member-0', "μ's member", 1, 'lilywhite'),
        PLAYER1,
        'muse-member-top-0'
      ),
      createCardInstance(
        createLiveCard('PL!-bp6-004-muse-live-1', "μ's live", 'lilywhite'),
        PLAYER1,
        'muse-live-top-1'
      ),
      createCardInstance(
        createMemberCard('PL!SP-bp2-007-liella-member-2', 'Liella member', 1, 'CatChu!'),
        PLAYER1,
        'muse-wrong-member-top-2'
      ),
      createCardInstance(
        createMemberCard('PL!-bp6-004-muse-member-3', "μ's member 2", 1, 'BiBi'),
        PLAYER1,
        'muse-member-top-3'
      ),
      createCardInstance(
        createLiveCard('PL!SP-bp2-007-liella-live-4', 'Liella live', 'CatChu!'),
        PLAYER1,
        'muse-wrong-live-top-4'
      ),
      createCardInstance(
        createMemberCard('PL!-bp6-004-extra-5', 'Extra member', 1, 'lilywhite'),
        PLAYER1,
        'muse-extra-top-5'
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
      topCards[3]!.instanceId,
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        topCards[0]!.instanceId
      )
    );
    expect(selectResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(topCards[0]!.instanceId);

    const revealConfirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(revealConfirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[0]!.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCard.instanceId,
      topCards[1]!.instanceId,
      topCards[2]!.instanceId,
      topCards[3]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[5]!.instanceId]);
  });

  it('lets PL!SP-bp2-007 reveal only a Liella! member from top five', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-five-liella-member-mei',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!SP-bp2-007-P', '米女メイ', 5, 'CatChu!'),
      PLAYER1,
      'p1-sp-bp2-007-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!SP-bp2-007-discard', 'Discard target'),
      PLAYER1,
      'p1-sp-bp2-007-discard'
    );
    const topCards = [
      createCardInstance(
        createMemberCard('PL!SP-bp2-007-liella-member-0', 'Liella member', 1, 'CatChu!'),
        PLAYER1,
        'liella-member-top-0'
      ),
      createCardInstance(
        createLiveCard('PL!SP-bp2-007-liella-live-1', 'Liella live', 'CatChu!'),
        PLAYER1,
        'liella-live-top-1'
      ),
      createCardInstance(
        createMemberCard('PL!-bp6-004-muse-member-2', "μ's member", 1, 'lilywhite'),
        PLAYER1,
        'liella-wrong-member-top-2'
      ),
      createCardInstance(
        createMemberCard('PL!SP-bp2-007-liella-member-3', 'Liella member 2', 1, '5yncri5e!'),
        PLAYER1,
        'liella-member-top-3'
      ),
      createCardInstance(
        createLiveCard('PL!-bp6-004-muse-live-4', "μ's live", 'lilywhite'),
        PLAYER1,
        'liella-wrong-live-top-4'
      ),
      createCardInstance(
        createMemberCard('PL!SP-bp2-007-extra-5', 'Extra member', 1, 'CatChu!'),
        PLAYER1,
        'liella-extra-top-5'
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

    const meiBeforeSeq = session.getCurrentPublicEventSeq();
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
      topCards[3]!.instanceId,
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const startedSummary = session
      .getPublicEventsSince(meiBeforeSeq)
      .find((event) => event.type === 'CardEffectSummary' && event.summaryStatus === 'STARTED');
    expect(startedSummary?.type).toBe('CardEffectSummary');
    if (startedSummary?.type === 'CardEffectSummary') {
      expect(startedSummary.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
      expect(startedSummary.effectKind).toBe('DISCARD_LOOK_TOP_SELECT_TO_HAND');
      expect(startedSummary.summaryStatus).toBe('STARTED');
      expect(startedSummary.sourceCard?.publicObjectId).toBe(`obj_${source.instanceId}`);
      expect(startedSummary.discardedCostCards?.map((card) => card.publicObjectId)).toEqual([
        `obj_${discardCard.instanceId}`,
      ]);
      expect(startedSummary.hiddenDiscardedCostCardCount).toBe(0);
      expect(startedSummary.inspectSourceZone).toBe('MAIN_DECK');
      expect(startedSummary.requestedInspectCount).toBe(5);
      expect(startedSummary.actualInspectedCount).toBe(5);
      expect(startedSummary.selectedCards).toEqual([]);
      expect(startedSummary.hiddenSelectedCardCount).toBe(0);
      expect(startedSummary.noSelectedCards).toBe(false);
      expect(startedSummary.waitingRoomCardCount).toBe(0);
    }

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        topCards[3]!.instanceId
      )
    );
    expect(selectResult.success).toBe(true);
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

    const meiSummary = session
      .getPublicEventsSince(meiBeforeSeq)
      .find((event) => event.type === 'CardEffectSummary' && event.summaryStatus === 'COMPLETED');
    expect(meiSummary?.type).toBe('CardEffectSummary');
    if (meiSummary?.type === 'CardEffectSummary') {
      expect(meiSummary.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
      expect(meiSummary.effectKind).toBe('DISCARD_LOOK_TOP_SELECT_TO_HAND');
      expect(meiSummary.summaryStatus).toBe('COMPLETED');
      expect(meiSummary.sourceCard?.publicObjectId).toBe(`obj_${source.instanceId}`);
      expect(meiSummary.discardedCostCards?.map((card) => card.publicObjectId)).toEqual([
        `obj_${discardCard.instanceId}`,
      ]);
      expect(meiSummary.hiddenDiscardedCostCardCount).toBe(0);
      expect(meiSummary.inspectSourceZone).toBe('MAIN_DECK');
      expect(meiSummary.requestedInspectCount).toBe(5);
      expect(meiSummary.actualInspectedCount).toBe(5);
      expect(meiSummary.selectedCards?.map((card) => card.publicObjectId)).toEqual([
        `obj_${topCards[3]!.instanceId}`,
      ]);
      expect(meiSummary.hiddenSelectedCardCount).toBe(0);
      expect(meiSummary.noSelectedCards).toBe(false);
      expect(meiSummary.waitingRoomCardCount).toBe(4);
    }
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
      createCardInstance(
        createLiveCard('PL!S-red-live', 'Red live'),
        PLAYER1,
        's-bp2-005-top-live'
      ),
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

    session.createGame(
      'discard-look-top-seven-yohane-no-target',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
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
      createCardInstance(
        createLiveCard('PL!S-live-no-target'),
        PLAYER1,
        's-bp2-005-no-target-live'
      ),
      createCardInstance(
        createEnergyCard('PL!S-energy-no-target'),
        PLAYER1,
        's-bp2-005-no-target-energy'
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
      ...topCards.map((card) => card.instanceId),
      discardCard.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
  });

  it('does not inspect the deck when PL!S-bp2-005 optional discard is declined', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'discard-look-top-seven-yohane-decline',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
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
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
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
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(
      topCards.map((card) => card.instanceId)
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  function setupAqoursPb1HeartCountScenario(options: {
    readonly sourceCardCode: 'PL!S-pb1-013-N' | 'PL!S-pb1-014-N' | 'PL!S-pb1-015-N';
    readonly sourceName: string;
    readonly topCards: readonly ReturnType<typeof createCardInstance>[];
  }): {
    readonly session: ReturnType<typeof createGameSession>;
    readonly source: ReturnType<typeof createCardInstance>;
    readonly discardCard: ReturnType<typeof createCardInstance>;
  } {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      `${options.sourceCardCode}-discard-look-top-heart-count`,
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard(options.sourceCardCode, options.sourceName, 4),
      PLAYER1,
      `${options.sourceCardCode}-source`
    );
    const discardCard = createCardInstance(
      createMemberCard(`${options.sourceCardCode}-discard`, 'Discard target'),
      PLAYER1,
      `${options.sourceCardCode}-discard`
    );

    let state = registerCards(session.state!, [source, discardCard, ...options.topCards]);
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
    p1.mainDeck.cardIds = options.topCards.map((card) => card.instanceId);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(playResult.success, playResult.error).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCard.instanceId]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    return { session, source, discardCard };
  }

  it('lets PL!S-pb1-013 inspect four and reveal a green Heart-count member or LIVE', () => {
    const topCards = [
      createCardInstance(
        createMemberCard(
          'PL!S-pb1-013-green-member',
          'Green two member',
          1,
          undefined,
          [createHeartIcon(HeartColor.GREEN, 2)]
        ),
        PLAYER1,
        's-pb1-013-top-green-member'
      ),
      createCardInstance(
        createLiveCard(
          'PL!S-pb1-013-green-live',
          'Green two live',
          undefined,
          createHeartRequirement({ [HeartColor.GREEN]: 2 })
        ),
        PLAYER1,
        's-pb1-013-top-green-live'
      ),
      createCardInstance(
        createMemberCard('PL!S-pb1-013-red-member', 'Red two member', 1, undefined, [
          createHeartIcon(HeartColor.RED, 2),
        ]),
        PLAYER1,
        's-pb1-013-top-red-member'
      ),
      createCardInstance(createEnergyCard('PL!S-pb1-013-energy'), PLAYER1, 's-pb1-013-top-energy'),
      createCardInstance(
        createMemberCard('PL!S-pb1-013-extra', 'Extra'),
        PLAYER1,
        's-pb1-013-extra'
      ),
    ];
    const scenario = setupAqoursPb1HeartCountScenario({
      sourceCardCode: 'PL!S-pb1-013-N',
      sourceName: '黒澤ダイヤ',
      topCards,
    });

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.discardCard.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.inspectionCardIds).toEqual(
      topCards.slice(0, 4).map((card) => card.instanceId)
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
    ]);

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          topCards[1]!.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.inspectionZone.revealedCardIds).toContain(
      topCards[1]!.instanceId
    );

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([topCards[1]!.instanceId]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardCard.instanceId,
      topCards[0]!.instanceId,
      topCards[2]!.instanceId,
      topCards[3]!.instanceId,
    ]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      topCards[4]!.instanceId,
    ]);
  });

  it('lets PL!S-pb1-014 inspect four and reveal a red Heart-count member or LIVE', () => {
    const topCards = [
      createCardInstance(
        createMemberCard('PL!S-pb1-014-red-member', 'Red two member', 1, undefined, [
          createHeartIcon(HeartColor.RED, 2),
        ]),
        PLAYER1,
        's-pb1-014-top-red-member'
      ),
      createCardInstance(
        createLiveCard(
          'PL!S-pb1-014-red-live',
          'Red two live',
          undefined,
          createHeartRequirement({ [HeartColor.RED]: 2 })
        ),
        PLAYER1,
        's-pb1-014-top-red-live'
      ),
      createCardInstance(
        createMemberCard('PL!S-pb1-014-green-member', 'Green two member', 1, undefined, [
          createHeartIcon(HeartColor.GREEN, 2),
        ]),
        PLAYER1,
        's-pb1-014-top-green-member'
      ),
      createCardInstance(createEnergyCard('PL!S-pb1-014-energy'), PLAYER1, 's-pb1-014-top-energy'),
      createCardInstance(
        createMemberCard('PL!S-pb1-014-extra', 'Extra'),
        PLAYER1,
        's-pb1-014-extra'
      ),
    ];
    const scenario = setupAqoursPb1HeartCountScenario({
      sourceCardCode: 'PL!S-pb1-014-N',
      sourceName: '渡辺 曜',
      topCards,
    });

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.discardCard.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
    ]);

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          topCards[0]!.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.inspectionZone.revealedCardIds).toContain(
      topCards[0]!.instanceId
    );

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([topCards[0]!.instanceId]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardCard.instanceId,
      topCards[1]!.instanceId,
      topCards[2]!.instanceId,
      topCards[3]!.instanceId,
    ]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      topCards[4]!.instanceId,
    ]);
  });

  it('lets PL!S-pb1-015 inspect four and reveal a blue Heart-count member or LIVE', () => {
    const topCards = [
      createCardInstance(
        createMemberCard('PL!S-pb1-015-blue-member', 'Blue two member', 1, undefined, [
          createHeartIcon(HeartColor.BLUE, 2),
        ]),
        PLAYER1,
        's-pb1-015-top-blue-member'
      ),
      createCardInstance(
        createLiveCard(
          'PL!S-pb1-015-blue-live',
          'Blue two live',
          undefined,
          createHeartRequirement({ [HeartColor.BLUE]: 2 })
        ),
        PLAYER1,
        's-pb1-015-top-blue-live'
      ),
      createCardInstance(
        createMemberCard('PL!S-pb1-015-red-member', 'Red two member', 1, undefined, [
          createHeartIcon(HeartColor.RED, 2),
        ]),
        PLAYER1,
        's-pb1-015-top-red-member'
      ),
      createCardInstance(createEnergyCard('PL!S-pb1-015-energy'), PLAYER1, 's-pb1-015-top-energy'),
      createCardInstance(
        createMemberCard('PL!S-pb1-015-extra', 'Extra'),
        PLAYER1,
        's-pb1-015-extra'
      ),
    ];
    const scenario = setupAqoursPb1HeartCountScenario({
      sourceCardCode: 'PL!S-pb1-015-N',
      sourceName: '津島善子',
      topCards,
    });

    expect(scenario.session.state?.activeEffect?.effectText).toContain('[青ハート]');
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.discardCard.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.inspectionCardIds).toEqual(
      topCards.slice(0, 4).map((card) => card.instanceId)
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
    ]);

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          topCards[1]!.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.inspectionZone.revealedCardIds).toContain(
      topCards[1]!.instanceId
    );

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([topCards[1]!.instanceId]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardCard.instanceId,
      topCards[0]!.instanceId,
      topCards[2]!.instanceId,
      topCards[3]!.instanceId,
    ]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      topCards[4]!.instanceId,
    ]);
  });

  it('rejects a non-blue Heart-count target for PL!S-pb1-015', () => {
    const topCards = [
      createCardInstance(
        createMemberCard('PL!S-pb1-015-legal-blue-member', 'Blue two member', 1, undefined, [
          createHeartIcon(HeartColor.BLUE, 2),
        ]),
        PLAYER1,
        's-pb1-015-illegal-blue-member'
      ),
      createCardInstance(
        createMemberCard('PL!S-pb1-015-illegal-red-member', 'Red two member', 1, undefined, [
          createHeartIcon(HeartColor.RED, 2),
        ]),
        PLAYER1,
        's-pb1-015-illegal-red-member'
      ),
      createCardInstance(
        createLiveCard(
          'PL!S-pb1-015-legal-blue-live',
          'Blue two live',
          undefined,
          createHeartRequirement({ [HeartColor.BLUE]: 2 })
        ),
        PLAYER1,
        's-pb1-015-illegal-blue-live'
      ),
      createCardInstance(createEnergyCard('PL!S-pb1-015-illegal-energy'), PLAYER1, 'energy-015'),
      createCardInstance(
        createMemberCard('PL!S-pb1-015-illegal-extra', 'Extra'),
        PLAYER1,
        's-pb1-015-illegal-extra'
      ),
    ];
    const scenario = setupAqoursPb1HeartCountScenario({
      sourceCardCode: 'PL!S-pb1-015-N',
      sourceName: '津島善子',
      topCards,
    });

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.discardCard.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[2]!.instanceId,
    ]);

    const illegalResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        topCards[1]!.instanceId
      )
    );

    expect(illegalResult.success).toBe(false);
    expect(illegalResult.error).toBe('选择的卡牌不能用于当前效果');
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[0]!.instanceId,
      topCards[2]!.instanceId,
    ]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardCard.instanceId,
    ]);
  });

  it('moves all inspected cards to waiting room when PL!S-pb1-013 has no green legal target', () => {
    const topCards = [
      createCardInstance(
        createMemberCard('PL!S-pb1-013-one-green', 'One green member', 1, undefined, [
          createHeartIcon(HeartColor.GREEN, 1),
        ]),
        PLAYER1,
        's-pb1-013-no-target-one-green'
      ),
      createCardInstance(
        createMemberCard('PL!S-pb1-013-two-red', 'Two red member', 1, undefined, [
          createHeartIcon(HeartColor.RED, 2),
        ]),
        PLAYER1,
        's-pb1-013-no-target-red'
      ),
      createCardInstance(
        createLiveCard(
          'PL!S-pb1-013-one-green-live',
          'One green live',
          undefined,
          createHeartRequirement({ [HeartColor.GREEN]: 1 })
        ),
        PLAYER1,
        's-pb1-013-no-target-live'
      ),
      createCardInstance(createEnergyCard('PL!S-pb1-013-no-target-energy'), PLAYER1, 'energy-013'),
      createCardInstance(
        createMemberCard('PL!S-pb1-013-no-target-extra', 'Extra'),
        PLAYER1,
        's-pb1-013-no-target-extra'
      ),
    ];
    const scenario = setupAqoursPb1HeartCountScenario({
      sourceCardCode: 'PL!S-pb1-013-N',
      sourceName: '黒澤ダイヤ',
      topCards,
    });

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.discardCard.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([]);

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardCard.instanceId,
      ...topCards.slice(0, 4).map((card) => card.instanceId),
    ]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      topCards[4]!.instanceId,
    ]);
  });

  it('moves all inspected cards to waiting room when PL!S-pb1-014 has no red legal target', () => {
    const topCards = [
      createCardInstance(
        createMemberCard('PL!S-pb1-014-one-red', 'One red member', 1, undefined, [
          createHeartIcon(HeartColor.RED, 1),
        ]),
        PLAYER1,
        's-pb1-014-no-target-one-red'
      ),
      createCardInstance(
        createMemberCard('PL!S-pb1-014-two-green', 'Two green member', 1, undefined, [
          createHeartIcon(HeartColor.GREEN, 2),
        ]),
        PLAYER1,
        's-pb1-014-no-target-green'
      ),
      createCardInstance(
        createLiveCard(
          'PL!S-pb1-014-one-red-live',
          'One red live',
          undefined,
          createHeartRequirement({ [HeartColor.RED]: 1 })
        ),
        PLAYER1,
        's-pb1-014-no-target-live'
      ),
      createCardInstance(createEnergyCard('PL!S-pb1-014-no-target-energy'), PLAYER1, 'energy-014'),
      createCardInstance(
        createMemberCard('PL!S-pb1-014-no-target-extra', 'Extra'),
        PLAYER1,
        's-pb1-014-no-target-extra'
      ),
    ];
    const scenario = setupAqoursPb1HeartCountScenario({
      sourceCardCode: 'PL!S-pb1-014-N',
      sourceName: '渡辺 曜',
      topCards,
    });

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.discardCard.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([]);

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardCard.instanceId,
      ...topCards.slice(0, 4).map((card) => card.instanceId),
    ]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      topCards[4]!.instanceId,
    ]);
  });

  it('moves all inspected cards to waiting room when PL!S-pb1-015 has no blue legal target', () => {
    const topCards = [
      createCardInstance(
        createMemberCard('PL!S-pb1-015-one-blue', 'One blue member', 1, undefined, [
          createHeartIcon(HeartColor.BLUE, 1),
        ]),
        PLAYER1,
        's-pb1-015-no-target-one-blue'
      ),
      createCardInstance(
        createMemberCard('PL!S-pb1-015-two-red', 'Two red member', 1, undefined, [
          createHeartIcon(HeartColor.RED, 2),
        ]),
        PLAYER1,
        's-pb1-015-no-target-red'
      ),
      createCardInstance(
        createLiveCard(
          'PL!S-pb1-015-one-blue-live',
          'One blue live',
          undefined,
          createHeartRequirement({ [HeartColor.BLUE]: 1 })
        ),
        PLAYER1,
        's-pb1-015-no-target-live'
      ),
      createCardInstance(createEnergyCard('PL!S-pb1-015-no-target-energy'), PLAYER1, 'energy-015'),
      createCardInstance(
        createMemberCard('PL!S-pb1-015-no-target-extra', 'Extra'),
        PLAYER1,
        's-pb1-015-no-target-extra'
      ),
    ];
    const scenario = setupAqoursPb1HeartCountScenario({
      sourceCardCode: 'PL!S-pb1-015-N',
      sourceName: '津島善子',
      topCards,
    });

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.discardCard.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([]);

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardCard.instanceId,
      ...topCards.slice(0, 4).map((card) => card.instanceId),
    ]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      topCards[4]!.instanceId,
    ]);
  });

  it('declines PL!S-pb1-013 before discarding or inspecting', () => {
    const topCards = [
      createCardInstance(
        createMemberCard('PL!S-pb1-013-decline-green', 'Green two member', 1, undefined, [
          createHeartIcon(HeartColor.GREEN, 2),
        ]),
        PLAYER1,
        's-pb1-013-decline-top'
      ),
    ];
    const scenario = setupAqoursPb1HeartCountScenario({
      sourceCardCode: 'PL!S-pb1-013-N',
      sourceName: '黒澤ダイヤ',
      topCards,
    });

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.inspectionZone.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([
      scenario.discardCard.instanceId,
    ]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      topCards[0]!.instanceId,
    ]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('declines PL!S-pb1-015 before discarding or inspecting', () => {
    const topCards = [
      createCardInstance(
        createMemberCard('PL!S-pb1-015-decline-blue', 'Blue two member', 1, undefined, [
          createHeartIcon(HeartColor.BLUE, 2),
        ]),
        PLAYER1,
        's-pb1-015-decline-top'
      ),
    ];
    const scenario = setupAqoursPb1HeartCountScenario({
      sourceCardCode: 'PL!S-pb1-015-N',
      sourceName: '津島善子',
      topCards,
    });

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.inspectionZone.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([
      scenario.discardCard.instanceId,
    ]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      topCards[0]!.instanceId,
    ]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });
});

describe('PL!N-bp3-012 Lanzhu shared discard-look-top config', () => {
  const effectText =
    '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的4张卡。可以将1张其中的『虹咲』的卡片公开并加入手牌。其余的卡片放置入休息室。';

  function setup(options: {
    readonly topCards: readonly ReturnType<typeof createCardInstance>[];
    readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly withDiscard?: boolean;
  }) {
    const session = createGameSession();
    const deck = createDeck();
    session.createGame('n-bp3-012-lanzhu', PLAYER1, 'P1', PLAYER2, 'P2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);
    const source = createCardInstance(
      createMemberCard('PL!N-bp3-012-R', '鐘 嵐珠', 4),
      PLAYER1,
      'n-bp3-012-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!N-bp3-012-discard', 'Discard'),
      PLAYER1,
      'n-bp3-012-discard'
    );
    const waitingCards = options.waitingCards ?? [];
    const state = registerCards(session.state!, [
      source,
      discardCard,
      ...options.topCards,
      ...waitingCards,
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;
    const player = state.players[0]!;
    clearPlayerZones(player);
    player.hand.cardIds =
      options.withDiscard === false
        ? [source.instanceId]
        : [source.instanceId, discardCard.instanceId];
    player.mainDeck.cardIds = options.topCards.map((card) => card.instanceId);
    player.waitingRoom.cardIds = waitingCards.map((card) => card.instanceId);
    expect(
      session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      ).success
    ).toBe(true);
    return { session, source, discardCard };
  }

  function payDiscard(session: ReturnType<typeof createGameSession>, discardCardId: string): void {
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          discardCardId
        )
      ).success
    ).toBe(true);
  }

  it('selects Nijigasaki member or LIVE but excludes other groups, then reveals before hand', () => {
    const cards = [
      createCardInstance(createMemberCard('PL!N-member'), PLAYER1, 'n012-member'),
      createCardInstance(createLiveCard('PL!N-live'), PLAYER1, 'n012-live'),
      createCardInstance(createMemberCard('PL!SP-member'), PLAYER1, 'n012-other-member'),
      createCardInstance(createLiveCard('PL!S-live'), PLAYER1, 'n012-other-live'),
      createCardInstance(createMemberCard('PL!N-extra'), PLAYER1, 'n012-extra'),
    ];
    const { session, discardCard } = setup({ topCards: cards });
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: PL_N_BP3_012_ON_ENTER_DISCARD_LOOK_TOP_NIJIGASAKI_CARD_ABILITY_ID,
      effectText,
      selectableCardIds: [discardCard.instanceId],
      skipSelectionLabel: '不发动',
    });
    payDiscard(session, discardCard.instanceId);
    expect(session.state?.activeEffect).toMatchObject({
      effectText,
      inspectionCardIds: cards.slice(0, 4).map((card) => card.instanceId),
      selectableCardIds: [cards[0]!.instanceId, cards[1]!.instanceId],
      confirmSelectionLabel: '加入手牌',
      skipSelectionLabel: '不加入',
    });

    const beforeIllegal = session.state;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          cards[2]!.instanceId
        )
      ).success
    ).toBe(false);
    expect(session.state).toBe(beforeIllegal);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          cards[1]!.instanceId
        )
      ).success
    ).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([cards[1]!.instanceId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.activeEffect?.selectableCardMode).toBeUndefined();
    expect(session.state?.activeEffect?.confirmSelectionLabel).toBeUndefined();
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(session.state?.activeEffect?.skipSelectionLabel).toBeUndefined();

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([cards[1]!.instanceId]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.eventLog.at(-1)?.event).toMatchObject({
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      cardInstanceIds: [cards[0]!.instanceId, cards[2]!.instanceId, cards[3]!.instanceId],
    });
  });

  it('inspects remaining deck cards first, refreshes, and can inspect the discarded cost card', () => {
    const originalTop = [
      createCardInstance(createMemberCard('PL!SP-original-0'), PLAYER1, 'n012-original-0'),
      createCardInstance(createMemberCard('PL!SP-original-1'), PLAYER1, 'n012-original-1'),
    ];
    const waitingCards = [
      createCardInstance(createMemberCard('PL!SP-waiting-0'), PLAYER1, 'n012-waiting-0'),
    ];
    const { session, discardCard } = setup({ topCards: originalTop, waitingCards });
    payDiscard(session, discardCard.instanceId);
    const inspected = session.state!.activeEffect!.inspectionCardIds!;
    expect(inspected).toHaveLength(4);
    expect(inspected.slice(0, 2)).toEqual(originalTop.map((card) => card.instanceId));
    expect(new Set(inspected.slice(2))).toEqual(
      new Set([waitingCards[0]!.instanceId, discardCard.instanceId])
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.movedCount === 2
      )
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toContain(discardCard.instanceId);
  });

  it('can skip after payment, preserves the cost with no legal target, and groups the remainder event', () => {
    const cards = [
      createCardInstance(createMemberCard('PL!SP-no-0'), PLAYER1, 'n012-no-0'),
      createCardInstance(createLiveCard('PL!S-no-1'), PLAYER1, 'n012-no-1'),
      createCardInstance(createMemberCard('PL!HS-no-2'), PLAYER1, 'n012-no-2'),
      createCardInstance(createLiveCard('PL!-no-3'), PLAYER1, 'n012-no-3'),
    ];
    const { session, discardCard } = setup({ topCards: cards });
    payDiscard(session, discardCard.instanceId);
    expect(session.state?.activeEffect).toMatchObject({
      selectableCardIds: [],
      skipSelectionLabel: '确认',
    });
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      ...cards.map((card) => card.instanceId),
    ]);
    expect(session.state?.players[0].hand.cardIds).not.toContain(discardCard.instanceId);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([discardCard.instanceId]);
    expect(session.state?.eventLog.at(-1)?.event).toMatchObject({
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      cardInstanceIds: cards.map((card) => card.instanceId),
    });
  });

  it('declines without paying and safely consumes pending with no hand or no cards', () => {
    const declineTop = createCardInstance(createMemberCard('PL!N-decline'), PLAYER1, 'n012-decline');
    const declined = setup({ topCards: [declineTop] });
    expect(
      declined.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, declined.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(declined.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(declined.session.state?.inspectionZone.cardIds).toEqual([]);

    const noHandTop = createCardInstance(createMemberCard('PL!N-no-hand'), PLAYER1, 'n012-no-hand');
    const noHand = setup({ topCards: [noHandTop], withDiscard: false });
    expect(noHand.session.state?.activeEffect).toBeNull();
    expect(noHand.session.state?.pendingAbilities).toEqual([]);

    const empty = setup({ topCards: [] });
    payDiscard(empty.session, empty.discardCard.instanceId);
    expect(empty.session.state?.activeEffect?.inspectionCardIds).toEqual([
      empty.discardCard.instanceId,
    ]);
    expect(
      empty.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, empty.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(empty.session.state?.activeEffect).toBeNull();
    expect(empty.session.state?.players[0].hand.cardIds).toEqual([]);
  });

  it('rejects multi, duplicate, and stale selections without false events, then skips safely', () => {
    const cards = [
      createCardInstance(createMemberCard('PL!N-legal-0'), PLAYER1, 'n012-legal-0'),
      createCardInstance(createLiveCard('PL!N-legal-1'), PLAYER1, 'n012-legal-1'),
      createCardInstance(createMemberCard('PL!SP-other'), PLAYER1, 'n012-stale-other'),
      createCardInstance(createMemberCard('PL!SP-other-2'), PLAYER1, 'n012-stale-other-2'),
    ];
    const { session, discardCard } = setup({ topCards: cards });
    payDiscard(session, discardCard.instanceId);
    for (const selectedCardIds of [
      [cards[0]!.instanceId, cards[1]!.instanceId],
      [cards[0]!.instanceId, cards[0]!.instanceId],
    ]) {
      const before = session.state;
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            PLAYER1,
            session.state!.activeEffect!.id,
            undefined,
            undefined,
            undefined,
            undefined,
            selectedCardIds
          )
        ).success
      ).toBe(false);
      expect(session.state).toBe(before);
    }

    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      inspectionZone: {
        ...session.state!.inspectionZone,
        cardIds: session.state!.inspectionZone.cardIds.filter(
          (cardId) => cardId !== cards[0]!.instanceId
        ),
      },
    };
    const eventCount = session.state!.eventLog.length;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          cards[0]!.instanceId
        )
      ).success
    ).toBe(false);
    expect(session.state?.inspectionZone.revealedCardIds).not.toContain(cards[0]!.instanceId);
    expect(session.state?.eventLog).toHaveLength(eventCount);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(cards[0]!.instanceId);
    expect(session.state?.eventLog.at(-1)?.event).toMatchObject({
      cardInstanceIds: [cards[1]!.instanceId, cards[2]!.instanceId, cards[3]!.instanceId],
    });
  });
});

describe('PL!N-bp5-009 Rina wait-discard look top shared workflow', () => {
  function setupRinaScenario(options: {
    readonly topCards: readonly ReturnType<typeof createCardInstance>[];
    readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly includeWaitingRoomTriggerSource?: boolean;
  }) {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('n-bp5-009-rina-wait-discard-look-top', PLAYER1, 'P1', PLAYER2, 'P2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!N-bp5-009-R', '天王寺璃奈', 4),
      PLAYER1,
      'p1-n-bp5-009-source'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!N-test-discard', 'Discard target'),
      PLAYER1,
      'p1-n-bp5-009-discard'
    );
    const triggerSource = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'p1-rina-discard-trigger-source'
    );
    const registeredCards = [
      source,
      discardCard,
      ...options.topCards,
      ...(options.handCards ?? []),
      ...(options.includeWaitingRoomTriggerSource === true ? [triggerSource] : []),
    ];

    let state = registerCards(session.state!, registeredCards);
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
    p1.mainDeck.cardIds = options.topCards.map((card) => card.instanceId);
    if (options.includeWaitingRoomTriggerSource === true) {
      p1.memberSlots.slots[SlotPosition.RIGHT] = triggerSource.instanceId;
      p1.memberSlots.cardStates.set(triggerSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    return { session, source, discardCard, triggerSource };
  }

  function playRina(session: ReturnType<typeof createGameSession>, sourceId: string): void {
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(playResult.success, playResult.error).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      N_BP5_009_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID
    );
  }

  it('pays source-wait and hand discard costs, then reveals a high-cost Nijigasaki member', () => {
    const topCards = [
      createCardInstance(createMemberCard('PL!N-low-cost', 'Low cost', 8), PLAYER1, 'rina-top-0'),
      createCardInstance(
        createMemberCard('PL!N-high-cost', 'High cost Nijigasaki', 9),
        PLAYER1,
        'rina-top-1'
      ),
      createCardInstance(createLiveCard('PL!N-live', 'Nijigasaki live'), PLAYER1, 'rina-top-2'),
      createCardInstance(createMemberCard('PL!SP-high', 'Liella high', 11), PLAYER1, 'rina-top-3'),
      createCardInstance(createMemberCard('PL!N-high-2', 'High cost 2', 10), PLAYER1, 'rina-top-4'),
      createCardInstance(createMemberCard('PL!N-extra', 'Extra', 9), PLAYER1, 'rina-top-5'),
    ];
    const scenario = setupRinaScenario({ topCards, includeWaitingRoomTriggerSource: true });

    playRina(scenario.session, scenario.source.instanceId);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.discardCard.instanceId,
    ]);

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.discardCard.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.inspectionCardIds).toEqual(
      topCards.slice(0, 5).map((card) => card.instanceId)
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      topCards[1]!.instanceId,
      topCards[4]!.instanceId,
    ]);

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          topCards[4]!.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.inspectionZone.revealedCardIds).toContain(
      topCards[4]!.instanceId
    );

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);

    const player = scenario.session.state!.players[0]!;
    expect(player.memberSlots.cardStates.get(scenario.source.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(player.hand.cardIds).toEqual([topCards[4]!.instanceId]);
    expect(player.waitingRoom.cardIds).toEqual([
      scenario.discardCard.instanceId,
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
      topCards[2]!.instanceId,
      topCards[3]!.instanceId,
    ]);
    expect(player.mainDeck.cardIds).toEqual([topCards[5]!.instanceId]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === scenario.triggerSource.instanceId
      )
    ).toBe(true);
  });

  it('declines before paying any cost', () => {
    const topCards = [
      createCardInstance(createMemberCard('PL!N-high-cost', 'High cost', 9), PLAYER1, 'decline-0'),
    ];
    const scenario = setupRinaScenario({ topCards });

    playRina(scenario.session, scenario.source.instanceId);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);

    const player = scenario.session.state!.players[0]!;
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(player.memberSlots.cardStates.get(scenario.source.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(player.hand.cardIds).toEqual([scenario.discardCard.instanceId]);
    expect(player.waitingRoom.cardIds).toEqual([]);
    expect(player.mainDeck.cardIds).toEqual([topCards[0]!.instanceId]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === N_BP5_009_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID
      )
    ).toBe(false);
  });

  it('moves inspected cards to waiting room when there is no legal target', () => {
    const topCards = [
      createCardInstance(createMemberCard('PL!N-low-cost', 'Low cost', 8), PLAYER1, 'no-target-0'),
      createCardInstance(createLiveCard('PL!N-live', 'Nijigasaki live'), PLAYER1, 'no-target-1'),
      createCardInstance(createMemberCard('PL!SP-high', 'Liella high', 11), PLAYER1, 'no-target-2'),
      createCardInstance(createMemberCard('PL!N-low-2', 'Low cost 2', 1), PLAYER1, 'no-target-3'),
      createCardInstance(createEnergyCard('ENERGY-no-target'), PLAYER1, 'no-target-4'),
      createCardInstance(createMemberCard('PL!N-extra', 'Extra', 9), PLAYER1, 'no-target-5'),
    ];
    const scenario = setupRinaScenario({ topCards });

    playRina(scenario.session, scenario.source.instanceId);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.discardCard.instanceId
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([]);

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardCard.instanceId,
      ...topCards.slice(0, 5).map((card) => card.instanceId),
    ]);
    expect(scenario.session.state?.players[0].mainDeck.cardIds).toEqual([
      topCards[5]!.instanceId,
    ]);
  });
});
