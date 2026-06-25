import { describe, expect, it } from 'vitest';
import type { AnyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  registerCards,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
    groupName: 'Liella!',
    unitName: 'KALEIDOSCORE',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`)
  );
  return { mainDeck, energyDeck: [] };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.MAIN_FREE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
}

function clearPlayerZones(player: {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
  memberSlots: {
    slots: Record<SlotPosition, string | null>;
    cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    energyBelow: Record<SlotPosition, string[]>;
    memberBelow: Record<SlotPosition, string[]>;
  };
}): void {
  player.hand.cardIds = [];
  player.mainDeck.cardIds = [];
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
  player.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: null,
    [SlotPosition.RIGHT]: null,
  };
  player.memberSlots.cardStates = new Map();
  player.memberSlots.energyBelow = {
    [SlotPosition.LEFT]: [],
    [SlotPosition.CENTER]: [],
    [SlotPosition.RIGHT]: [],
  };
  player.memberSlots.memberBelow = {
    [SlotPosition.LEFT]: [],
    [SlotPosition.CENTER]: [],
    [SlotPosition.RIGHT]: [],
  };
}

function stageMember(
  player: {
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  },
  slot: SlotPosition,
  cardId: string
): void {
  player.memberSlots.slots[slot] = cardId;
  player.memberSlots.cardStates.set(cardId, {
    orientation: OrientationState.ACTIVE,
    face: FaceState.FACE_UP,
  });
}

function setupSelfPositionChangeSession(
  extraCards: ReturnType<typeof createCardInstance>[] = [],
  sourceCardCode = 'PL!SP-bp4-013-N',
  sourceName = '唐 可可',
  sourceCost = 2
): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly state: GameState;
} {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('self-position-change', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard(sourceCardCode, sourceName, sourceCost),
    PLAYER1,
    'p1-self-position-source'
  );
  const state = registerCards(session.state!, [source, ...extraCards]);
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
      energyBelow: Record<SlotPosition, string[]>;
      memberBelow: Record<SlotPosition, string[]>;
    };
  };
  clearPlayerZones(p1);
  p1.hand.cardIds = [source.instanceId];

  return { session, source, state };
}

describe('self position-change shared workflow', () => {
  it.each([
    ['PL!SP-sd2-005-SD2', '葉月 恋', 5],
    ['PL!SP-sd2-007-SD2', '米女メイ', 4],
    ['PL!SP-sd2-016-SD2', '葉月 恋', 2],
  ] as const)('opens the shared position-change window for %s', (cardCode, name, cost) => {
    const { session, source } = setupSelfPositionChangeSession([], cardCode, name, cost);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID,
      sourceCardId: source.instanceId,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      canSkipSelection: true,
    });
  });

  it('opens an optional PL!SP-bp4-013 position-change window excluding the current slot', () => {
    const { session, source } = setupSelfPositionChangeSession();

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID,
      sourceCardId: source.instanceId,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      canSkipSelection: true,
    });
    expect(session.state?.players[0].positionMovedThisTurn).not.toContain(source.instanceId);
  });

  it('moves PL!SP-bp4-013 to an empty slot and records position movement only after selection', () => {
    const { session, source } = setupSelfPositionChangeSession();

    session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(session.state?.players[0].positionMovedThisTurn).toEqual([]);

    const moveResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        null,
        SlotPosition.RIGHT
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      source.instanceId
    );
    expect(session.state?.players[0].positionMovedThisTurn).toEqual([source.instanceId]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          entry.event.cardInstanceId === source.instanceId &&
          entry.event.fromSlot === SlotPosition.CENTER &&
          entry.event.toSlot === SlotPosition.RIGHT
      )
    ).toBe(true);
  });

  it('swaps PL!SP-bp4-013 with an occupied member slot', () => {
    const other = createCardInstance(
      createMemberCard('PL!SP-test-other-member', 'Other Liella member', 4),
      PLAYER1,
      'p1-other-member'
    );
    const { session, source, state } = setupSelfPositionChangeSession([other]);
    const p1 = state.players[0] as unknown as {
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    stageMember(p1, SlotPosition.LEFT, other.instanceId);

    session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    const moveResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        null,
        SlotPosition.LEFT
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(source.instanceId);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      other.instanceId
    );
    expect(session.state?.players[0].positionMovedThisTurn).toEqual([
      source.instanceId,
      other.instanceId,
    ]);
  });

  it('skips without moving and continues to the next pending ability', () => {
    const nextSource = createCardInstance(
      createMemberCard('PL!SP-bp4-013-N', '唐 可可', 2),
      PLAYER1,
      'p1-sp-bp4-013-next-source'
    );
    const { session, source, state } = setupSelfPositionChangeSession([nextSource]);
    const p1 = state.players[0] as unknown as {
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    stageMember(p1, SlotPosition.RIGHT, nextSource.instanceId);

    session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    const nextPendingAbility: PendingAbilityState = {
      id: 'pending-next-self-position-change',
      abilityId: GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID,
      sourceCardId: nextSource.instanceId,
      controllerId: PLAYER1,
      mandatory: false,
      timingId: 'manual-test-next-position-change',
      eventIds: [],
      sourceSlot: SlotPosition.RIGHT,
    };
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      pendingAbilities: [...session.state!.pendingAbilities, nextPendingAbility],
    };

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      source.instanceId
    );
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      nextSource.instanceId
    );
    expect(session.state?.players[0].positionMovedThisTurn).toEqual([]);
    expect(session.state?.activeEffect).toMatchObject({
      id: nextPendingAbility.id,
      abilityId: GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID,
      sourceCardId: nextSource.instanceId,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.CENTER],
    });
  });
});
