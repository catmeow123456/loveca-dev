import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
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

describe('opponent wait target shared workflow', () => {
  it('waits only an opponent stage member with cost less than or equal to four for PL!-bp5-013', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('opponent-wait-target-bp5-013', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!-bp5-013-N', '園田海未', 9),
      PLAYER1,
      'p1-bp5-013-source'
    );
    const lowCostTarget = createCardInstance(
      createMemberCard('PL!-test-cost-4', 'Cost 4', 4),
      PLAYER2,
      'p2-cost-4-target'
    );
    const waitingLowCostTarget = createCardInstance(
      createMemberCard('PL!-test-cost-4-waiting', 'Cost 4 Waiting', 4),
      PLAYER2,
      'p2-cost-4-waiting-target'
    );
    const highCostTarget = createCardInstance(
      createMemberCard('PL!-test-cost-5', 'Cost 5', 5),
      PLAYER2,
      'p2-cost-5-target'
    );

    let state = registerCards(session.state!, [
      source,
      lowCostTarget,
      waitingLowCostTarget,
      highCostTarget,
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const p2 = state.players[1] as unknown as {
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
    clearPlayerZones(p2);
    p1.hand.cardIds = [source.instanceId];
    p2.memberSlots.slots[SlotPosition.LEFT] = lowCostTarget.instanceId;
    p2.memberSlots.slots[SlotPosition.CENTER] = waitingLowCostTarget.instanceId;
    p2.memberSlots.slots[SlotPosition.RIGHT] = highCostTarget.instanceId;
    p2.memberSlots.cardStates = new Map([
      [lowCostTarget.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [
        waitingLowCostTarget.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
      ],
      [
        highCostTarget.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
      ],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowCostTarget.instanceId]);

    const waitResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        lowCostTarget.instanceId
      )
    );

    expect(waitResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[1].memberSlots.cardStates.get(lowCostTarget.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(highCostTarget.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(waitingLowCostTarget.instanceId)
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.step === 'WAIT_OPPONENT_MEMBER' &&
          action.payload.targetPlayerId === PLAYER2 &&
          action.payload.targetCardId === lowCostTarget.instanceId
      )
    ).toBe(true);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === lowCostTarget.instanceId &&
          entry.event.controllerId === PLAYER2 &&
          entry.event.slot === SlotPosition.LEFT &&
          entry.event.previousOrientation === OrientationState.ACTIVE &&
          entry.event.nextOrientation === OrientationState.WAITING
      )
    ).toBe(true);
  });

  it('skips PL!-bp5-013 when every matching opponent member is already waiting', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'opponent-wait-target-bp5-013-no-active-target',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!-bp5-013-N', '園田海未', 9),
      PLAYER1,
      'p1-bp5-013-no-target-source'
    );
    const waitingLowCostTarget = createCardInstance(
      createMemberCard('PL!-test-waiting-cost-4', 'Waiting Cost 4', 4),
      PLAYER2,
      'p2-waiting-cost-4-target'
    );
    const activeHighCostTarget = createCardInstance(
      createMemberCard('PL!-test-active-cost-5', 'Active Cost 5', 5),
      PLAYER2,
      'p2-active-cost-5-target'
    );

    let state = registerCards(session.state!, [source, waitingLowCostTarget, activeHighCostTarget]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const p2 = state.players[1] as unknown as {
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
    clearPlayerZones(p2);
    p1.hand.cardIds = [source.instanceId];
    p2.memberSlots.slots[SlotPosition.LEFT] = waitingLowCostTarget.instanceId;
    p2.memberSlots.slots[SlotPosition.RIGHT] = activeHighCostTarget.instanceId;
    p2.memberSlots.cardStates = new Map([
      [
        waitingLowCostTarget.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
      ],
      [
        activeHighCostTarget.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
      ],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[1].memberSlots.cardStates.get(waitingLowCostTarget.instanceId)
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(activeHighCostTarget.instanceId)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.step === 'SKIP_NO_TARGET' &&
          action.payload.targetPlayerId === PLAYER2
      )
    ).toBe(true);
  });
});
