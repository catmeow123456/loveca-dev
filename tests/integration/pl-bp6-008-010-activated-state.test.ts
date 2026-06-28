import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID,
  BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
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
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMuseMember(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupName: "μ's",
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupScenario(options: {
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly sourceCost: number;
  readonly ownOtherOrientation?: OrientationState;
  readonly opponentCost?: number;
  readonly opponentOrientation?: OrientationState;
}) {
  const session = createGameSession();
  session.createGame('pl-bp6-008-010-activated-state', PLAYER1, 'P1', PLAYER2, 'P2');

  const source = createCardInstance(
    createMuseMember(options.sourceCardCode, options.sourceName, options.sourceCost),
    PLAYER1,
    'bp6-activated-source'
  );
  const ownOther = createCardInstance(
    createMuseMember('PL!-bp6-own-other', 'Own Other', 3),
    PLAYER1,
    'bp6-own-other'
  );
  const opponent = createCardInstance(
    createMuseMember('PL!-bp6-opponent', 'Opponent', options.opponentCost ?? 4),
    PLAYER2,
    'bp6-opponent'
  );

  let state = registerCards(session.state!, [source, ownOther, opponent]);
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: [] },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.LEFT,
      ownOther.instanceId,
      {
        orientation: options.ownOtherOrientation ?? OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }
    ),
  }));
  state = updatePlayer(state, PLAYER2, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: [] },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId, {
      orientation: options.opponentOrientation ?? OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  (session as unknown as { authorityState: GameState }).authorityState = state;

  return {
    session,
    sourceId: source.instanceId,
    ownOtherId: ownOther.instanceId,
    opponentId: opponent.instanceId,
  };
}

describe('PL!-bp6-008/010 activated state workflows', () => {
  it('PL!-bp6-008-R waits itself, then activates another waiting member', () => {
    const { session, sourceId, ownOtherId } = setupScenario({
      sourceCardCode: 'PL!-bp6-008-R',
      sourceName: '小泉花陽',
      sourceCost: 7,
    });

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceId,
        BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.cardStates.get(sourceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([ownOtherId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, ownOtherId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.cardStates.get(sourceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].memberSlots.cardStates.get(ownOtherId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      session.state?.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(2);
  });

  it('PL!-bp6-008-P pays its self-wait cost and resolves no-op without another waiting member', () => {
    const { session, sourceId } = setupScenario({
      sourceCardCode: 'PL!-bp6-008-P',
      sourceName: '小泉花陽',
      sourceCost: 7,
      ownOtherOrientation: OrientationState.ACTIVE,
    });

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceId,
        BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.cardStates.get(sourceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === BP6_008_ACTIVATED_WAIT_SELF_ACTIVATE_OTHER_MEMBER_ABILITY_ID &&
          action.payload.step === 'NO_TARGET_AFTER_COST'
      )
    ).toBe(true);
  });

  it('PL!-bp6-010-N sends itself to waiting room, then waits an opponent low-cost member', () => {
    const { session, sourceId, opponentId } = setupScenario({
      sourceCardCode: 'PL!-bp6-010-N',
      sourceName: '高坂穂乃果',
      sourceCost: 2,
      opponentCost: 4,
    });

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceId,
        BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(sourceId);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([opponentId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, opponentId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[1].memberSlots.cardStates.get(opponentId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
          entry.event.cardInstanceId === sourceId
      )
    ).toBe(true);
  });

  it('PL!-bp6-010-N pays its self-send cost and resolves no-op without a legal opponent target', () => {
    const { session, sourceId } = setupScenario({
      sourceCardCode: 'PL!-bp6-010-N',
      sourceName: '高坂穂乃果',
      sourceCost: 2,
      opponentCost: 5,
    });

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceId,
        BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(sourceId);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
          entry.event.cardInstanceId === sourceId
      )
    ).toBe(true);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === sourceId
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            BP6_010_ACTIVATED_SEND_SELF_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID &&
          action.payload.step === 'NO_TARGET_AFTER_COST'
      )
    ).toBe(true);
  });
});
