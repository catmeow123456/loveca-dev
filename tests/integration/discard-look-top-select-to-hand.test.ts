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
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  GamePhase,
  HeartColor,
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
  unitName?: string
): MemberCardData {
  return {
    cardCode,
    name,
    groupName: '虹咲学园学园偶像同好会',
    unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
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

    session.createGame(
      'discard-look-top-two-karin',
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
