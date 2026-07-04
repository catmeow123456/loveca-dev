import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  S_BP6_012_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID,
  S_BP6_017_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
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

function createMemberCard(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
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

function prepareDirectMillSession(params: {
  readonly testId: string;
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly sourceCost: number;
  readonly topCards: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly stageObserver?: ReturnType<typeof createCardInstance>;
}): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(params.testId, PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard(params.sourceCardCode, params.sourceName, params.sourceCost),
    PLAYER1,
    `${params.testId}-source`
  );
  const extraCards = [
    source,
    ...params.topCards,
    ...(params.waitingRoomCards ?? []),
    ...(params.stageObserver ? [params.stageObserver] : []),
  ];
  const state = registerCards(session.state!, extraCards);
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
  p1.hand.cardIds = [source.instanceId];
  p1.mainDeck.cardIds = params.topCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = (params.waitingRoomCards ?? []).map((card) => card.instanceId);
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: null,
    [SlotPosition.RIGHT]: params.stageObserver?.instanceId ?? null,
  };
  p1.memberSlots.cardStates = new Map(
    params.stageObserver
      ? [
          [
            params.stageObserver.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ],
        ]
      : []
  );

  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(playResult.success, playResult.error).toBe(true);

  return session;
}

describe('direct mill top shared workflow', () => {
  it('mills top five for PL!S-bp6-012-N and enqueues main-deck enter-waiting-room triggers', () => {
    const topCards = [0, 1, 2, 3, 4].map((index) =>
      createCardInstance(
        createMemberCard(`PL!S-bp6-012-top-${index}`, `Top ${index}`),
        PLAYER1,
        `p1-s-bp6-012-top-${index}`
      )
    );
    const observer = createCardInstance(
      createMemberCard('PL!SP-bp5-005-AR', '嵐 千砂都', 17),
      PLAYER1,
      'p1-s-bp6-012-observer'
    );

    const session = prepareDirectMillSession({
      testId: 's-bp6-012-direct-mill',
      sourceCardCode: 'PL!S-bp6-012-N',
      sourceName: '松浦果南',
      sourceCost: 2,
      topCards,
      stageObserver: observer,
    });
    const topCardIds = topCards.map((card) => card.instanceId);

    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_012_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('S_BP6_012_REVEAL_MILLED_TOP_FIVE');
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(topCardIds);
    expect(session.state?.activeEffect?.metadata?.milledCardIds).toEqual(topCardIds);
    expect(session.state?.activeEffect?.metadata?.refreshCount).toBe(1);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toHaveLength(5);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1 &&
          action.payload.movedCount === 5 &&
          action.payload.mainDeckCountAfter === 5
      )
    ).toBe(true);
    expect(
      session.state?.eventLog.some((entry) => {
        const event = entry.event;
        return (
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK &&
          event.toZone === ZoneType.WAITING_ROOM &&
          event.cardInstanceIds?.join(',') === topCardIds.join(',')
        );
      })
    ).toBe(true);
    expect(
      session.state?.pendingAbilities.some(
        (ability) =>
          ability.abilityId ===
            SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID &&
          ability.metadata?.fromZone === ZoneType.MAIN_DECK &&
          ability.metadata?.toZone === ZoneType.WAITING_ROOM &&
          (ability.metadata?.movedCardIds as readonly string[] | undefined)?.join(',') ===
            topCardIds.join(',')
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(confirmResult.success, confirmResult.error).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_BP6_012_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID &&
          action.payload.step === 'FINISH_MILL_TOP_FIVE' &&
          action.payload.refreshCount === 1 &&
          Array.isArray(action.payload.milledCardIds) &&
          action.payload.milledCardIds.join(',') === topCardIds.join(',')
      )
    ).toBe(true);
  });

  it('mills top five for PL!S-bp6-017-N with the same direct-mill workflow', () => {
    const topCards = [0, 1, 2, 3, 4].map((index) =>
      createCardInstance(
        createMemberCard(`PL!S-bp6-017-top-${index}`, `Top ${index}`),
        PLAYER1,
        `p1-s-bp6-017-top-${index}`
      )
    );

    const session = prepareDirectMillSession({
      testId: 's-bp6-017-direct-mill',
      sourceCardCode: 'PL!S-bp6-017-N',
      sourceName: '小原鞠莉',
      sourceCost: 4,
      topCards,
    });
    const topCardIds = topCards.map((card) => card.instanceId);

    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_017_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('S_BP6_017_REVEAL_MILLED_TOP_FIVE');
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(topCardIds);
    expect(session.state?.activeEffect?.metadata?.refreshCount).toBe(1);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toHaveLength(5);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1 &&
          action.payload.movedCount === 5 &&
          action.payload.mainDeckCountAfter === 5
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );
    expect(confirmResult.success, confirmResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('uses refresh-aware top milling without treating all refresh cards as movedCardIds', () => {
    const topCards = [0, 1].map((index) =>
      createCardInstance(
        createMemberCard(`PL!S-bp6-012-refresh-top-${index}`, `Top ${index}`),
        PLAYER1,
        `p1-s-bp6-012-refresh-top-${index}`
      )
    );
    const refreshCards = [0, 1, 2, 3].map((index) =>
      createCardInstance(
        createMemberCard(`PL!S-bp6-012-refresh-waiting-${index}`, `Refresh ${index}`),
        PLAYER1,
        `p1-s-bp6-012-refresh-waiting-${index}`
      )
    );

    const session = prepareDirectMillSession({
      testId: 's-bp6-012-direct-mill-refresh',
      sourceCardCode: 'PL!S-bp6-012-N',
      sourceName: '松浦果南',
      sourceCost: 2,
      topCards,
      waitingRoomCards: refreshCards,
    });
    const milledCardIds = session.state!.activeEffect!.metadata!.milledCardIds as readonly string[];
    const refreshCardIds = refreshCards.map((card) => card.instanceId);

    expect(milledCardIds).toHaveLength(5);
    expect(milledCardIds.slice(0, 2)).toEqual(topCards.map((card) => card.instanceId));
    expect(session.state?.activeEffect?.metadata?.refreshCount).toBe(1);
    expect(milledCardIds).not.toEqual(expect.arrayContaining(refreshCardIds));
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1 &&
          action.payload.movedCount === topCards.length + refreshCards.length
      )
    ).toBe(true);
  });
});
