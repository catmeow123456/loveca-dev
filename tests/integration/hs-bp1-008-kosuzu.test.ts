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
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createKosuzu(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: '徒町 小鈴',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createMemberCard(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
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

function setupOnEnter(options: {
  readonly sourceCardCode: string;
  readonly deckCards: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
}): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('hs-bp1-008-kosuzu', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createKosuzu(options.sourceCardCode),
    PLAYER1,
    'p1-hs-bp1-008-source'
  );
  const waitingRoomCards = options.waitingRoomCards ?? [];
  let state = registerCards(session.state!, [source, ...options.deckCards, ...waitingRoomCards]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId] },
    mainDeck: {
      ...player.mainDeck,
      cardIds: options.deckCards.map((card) => card.instanceId),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingRoomCards.map((card) => card.instanceId),
    },
    successZone: { ...player.successZone, cardIds: [] },
    liveZone: { ...player.liveZone, cardIds: [], cardStates: new Map() },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: null,
        [SlotPosition.CENTER]: null,
        [SlotPosition.RIGHT]: null,
      },
      cardStates: new Map<string, { orientation: OrientationState; face: FaceState }>(),
    },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(playResult.success).toBe(true);
  expect(session.state?.activeEffect?.abilityId).toBe(
    HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID
  );

  return session;
}

function confirmActiveEffect(session: ReturnType<typeof createGameSession>): void {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
  );
  expect(result.success).toBe(true);
}

describe('PL!HS-bp1-008 Kosuzu workflow', () => {
  it('mills three members and draws one card for R rarity', () => {
    const topCards = [
      createCardInstance(createMemberCard('PL!HS-test-member-0'), PLAYER1, 'top-0'),
      createCardInstance(createMemberCard('PL!HS-test-member-1'), PLAYER1, 'top-1'),
      createCardInstance(createMemberCard('PL!HS-test-member-2'), PLAYER1, 'top-2'),
      createCardInstance(createMemberCard('PL!HS-test-draw'), PLAYER1, 'draw-card'),
    ];
    const session = setupOnEnter({
      sourceCardCode: 'PL!HS-bp1-008-R',
      deckCards: topCards,
    });

    expect(session.state?.activeEffect?.revealedCardIds).toEqual(
      topCards.slice(0, 3).map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect?.metadata?.milledCardIds).toEqual(
      topCards.slice(0, 3).map((card) => card.instanceId)
    );
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      topCards.slice(0, 3).map((card) => card.instanceId)
    );
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[3]!.instanceId]);

    confirmActiveEffect(session);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      topCards.slice(0, 3).map((card) => card.instanceId)
    );
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[3]!.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID &&
          action.payload.conditionMet === true &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.includes(topCards[3]!.instanceId)
      )
    ).toBe(true);
  });

  it('uses the base-code definition for P rarity and does not draw when a milled card is LIVE', () => {
    const topCards = [
      createCardInstance(createMemberCard('PL!HS-test-member-0'), PLAYER1, 'top-0'),
      createCardInstance(createLiveCard('PL!HS-test-live-1'), PLAYER1, 'top-1-live'),
      createCardInstance(createMemberCard('PL!HS-test-member-2'), PLAYER1, 'top-2'),
      createCardInstance(createMemberCard('PL!HS-test-draw'), PLAYER1, 'draw-card'),
    ];
    const session = setupOnEnter({
      sourceCardCode: 'PL!HS-bp1-008-P',
      deckCards: topCards,
    });

    confirmActiveEffect(session);

    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      topCards.slice(0, 3).map((card) => card.instanceId)
    );
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[3]!.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID &&
          action.payload.conditionMet === false &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.length === 0
      )
    ).toBe(true);
  });

  it('refreshes mid-effect and still draws when three milled cards are members', () => {
    const topCards = [
      createCardInstance(createMemberCard('PL!HS-test-member-0'), PLAYER1, 'top-0'),
      createCardInstance(createMemberCard('PL!HS-test-member-1'), PLAYER1, 'top-1'),
    ];
    const waitingRoomCard = createCardInstance(
      createMemberCard('PL!HS-test-member-refresh'),
      PLAYER1,
      'refresh-member'
    );
    const session = setupOnEnter({
      sourceCardCode: 'PL!HS-bp1-008-R',
      deckCards: topCards,
      waitingRoomCards: [waitingRoomCard],
    });

    const activeEffect = session.state?.activeEffect;
    const milledCardIds = activeEffect?.metadata?.milledCardIds;

    expect(milledCardIds).toEqual(expect.any(Array));
    expect(milledCardIds).toHaveLength(3);
    expect((milledCardIds as readonly string[]).slice(0, 2)).toEqual(
      topCards.map((card) => card.instanceId)
    );
    expect(
      [waitingRoomCard.instanceId, ...topCards.map((card) => card.instanceId)].includes(
        (milledCardIds as readonly string[])[2]!
      )
    ).toBe(true);
    expect(activeEffect?.metadata?.conditionMet).toBe(true);
    expect(activeEffect?.metadata?.refreshCount).toBe(1);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.movedCount === 3
      )
    ).toBe(true);

    confirmActiveEffect(session);

    expect(session.state?.players[0].hand.cardIds).toHaveLength(1);
    expect(session.state?.players[0].mainDeck.cardIds).toHaveLength(1);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID &&
          action.payload.conditionMet === true &&
          action.payload.refreshCount === 1 &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.length === 1
      )
    ).toBe(true);
  });
});
