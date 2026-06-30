import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createIzumiData(): MemberCardData {
  return {
    cardCode: 'PL!HS-bp5-016-N',
    name: '桂城 泉',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'EdelNote',
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function createMember(cardCode: string, cost = 4): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function startOnEnter(options: {
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
  readonly ownStageCards?: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
    readonly orientation?: OrientationState;
  }[];
  readonly opponentStageCards: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
    readonly orientation?: OrientationState;
  }[];
}): {
  readonly session: GameSession;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(createIzumiData(), PLAYER1, 'izumi-source');
  const ownStageCards = options.ownStageCards ?? [];
  let game = createGameState('hs-bp5-016-izumi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...options.handCards,
    ...ownStageCards.map((entry) => entry.card),
    ...options.opponentStageCards.map((entry) => entry.card),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    for (const entry of ownStageCards) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, {
        orientation: entry.orientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    return {
      ...player,
      hand: {
        ...player.hand,
        cardIds: options.handCards.map((card) => card.instanceId),
      },
      memberSlots,
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => {
    let memberSlots = player.memberSlots;
    for (const entry of options.opponentStageCards) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, {
        orientation: entry.orientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
    };
  });
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );

  const stateWithPending = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  const resolveResult = resolvePendingCardEffects(stateWithPending);
  const session = createGameSession();
  session.createGame('hs-bp5-016-izumi-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = resolveResult.gameState;
  return { session, source };
}

function confirmDiscard(session: GameSession, cardId: string | null): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, activeEffect.id, cardId)
  );
  expect(result.success).toBe(true);
}

function confirmTargets(session: GameSession, selectedCardIds: readonly string[]): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      activeEffect.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds
    )
  );
  expect(result.success).toBe(true);
}

describe('PL!HS-bp5-016 Izumi workflow', () => {
  it('skips without discarding or changing opponent orientations', () => {
    const discard = createCardInstance(createMember('PL!HS-test-skip-discard'), PLAYER1, 'skip-discard');
    const target = createCardInstance(createMember('PL!HS-test-skip-target'), PLAYER2, 'skip-target');
    const { session } = startOnEnter({
      handCards: [discard],
      opponentStageCards: [{ card: target, slot: SlotPosition.LEFT }],
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
      selectableCardIds: [discard.instanceId],
      canSkipSelection: true,
    });

    confirmDiscard(session, null);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([discard.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('discards one card then waits up to two active opponent members with cost four or less', () => {
    const discard = createCardInstance(createMember('PL!HS-test-discard'), PLAYER1, 'discard');
    const targetOne = createCardInstance(createMember('PL!HS-test-target-one', 4), PLAYER2, 'target-one');
    const targetTwo = createCardInstance(createMember('PL!HS-test-target-two', 1), PLAYER2, 'target-two');
    const { session } = startOnEnter({
      handCards: [discard],
      opponentStageCards: [
        { card: targetOne, slot: SlotPosition.LEFT },
        { card: targetTwo, slot: SlotPosition.RIGHT },
      ],
    });

    confirmDiscard(session, discard.instanceId);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
      selectableCardIds: [targetOne.instanceId, targetTwo.instanceId],
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 2,
      canSkipSelection: true,
    });

    confirmTargets(session, [targetOne.instanceId, targetTwo.instanceId]);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(session.state?.players[1].memberSlots.cardStates.get(targetOne.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[1].memberSlots.cardStates.get(targetTwo.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    for (const [cardId, slot] of [
      [targetOne.instanceId, SlotPosition.LEFT],
      [targetTwo.instanceId, SlotPosition.RIGHT],
    ] as const) {
      expect(
        session.state?.eventLog.some(
          (entry) =>
            entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
            entry.event.cardInstanceId === cardId &&
            entry.event.controllerId === PLAYER2 &&
            entry.event.slot === slot &&
            entry.event.previousOrientation === OrientationState.ACTIVE &&
            entry.event.nextOrientation === OrientationState.WAITING &&
            entry.event.cause?.kind === 'CARD_EFFECT'
        )
      ).toBe(true);
    }
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID &&
          action.payload.step === 'WAIT_OPPONENT_LOW_COST_MEMBERS' &&
          action.payload.waitedMemberCardIds?.includes(targetOne.instanceId) &&
          action.payload.waitedMemberCardIds?.includes(targetTwo.instanceId)
      )
    ).toBe(true);
  });

  it('allows waiting one target when only one legal opponent member exists', () => {
    const discard = createCardInstance(createMember('PL!HS-test-one-discard'), PLAYER1, 'one-discard');
    const onlyTarget = createCardInstance(createMember('PL!HS-test-only-target', 4), PLAYER2, 'only-target');
    const { session } = startOnEnter({
      handCards: [discard],
      opponentStageCards: [{ card: onlyTarget, slot: SlotPosition.CENTER }],
    });

    confirmDiscard(session, discard.instanceId);

    expect(session.state?.activeEffect).toMatchObject({
      selectableCardIds: [onlyTarget.instanceId],
      maxSelectableCards: 1,
    });

    confirmTargets(session, [onlyTarget.instanceId]);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[1].memberSlots.cardStates.get(onlyTarget.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('filters out waiting low-cost members, high-cost members, and own members', () => {
    const discard = createCardInstance(createMember('PL!HS-test-filter-discard'), PLAYER1, 'filter-discard');
    const ownLowCost = createCardInstance(createMember('PL!HS-test-own-low-cost', 4), PLAYER1, 'own-low-cost');
    const legalTarget = createCardInstance(createMember('PL!HS-test-legal-target', 4), PLAYER2, 'legal-target');
    const waitingLowCost = createCardInstance(
      createMember('PL!HS-test-waiting-low-cost', 4),
      PLAYER2,
      'waiting-low-cost'
    );
    const highCost = createCardInstance(createMember('PL!HS-test-high-cost', 5), PLAYER2, 'high-cost');
    const { session } = startOnEnter({
      handCards: [discard],
      ownStageCards: [{ card: ownLowCost, slot: SlotPosition.LEFT }],
      opponentStageCards: [
        { card: legalTarget, slot: SlotPosition.LEFT },
        {
          card: waitingLowCost,
          slot: SlotPosition.CENTER,
          orientation: OrientationState.WAITING,
        },
        { card: highCost, slot: SlotPosition.RIGHT },
      ],
    });

    confirmDiscard(session, discard.instanceId);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([legalTarget.instanceId]);
    const actionHistoryBeforeInvalidSelection = session.state?.actionHistory;
    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [waitingLowCost.instanceId]
      )
    );

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([legalTarget.instanceId]);
    expect(session.state?.actionHistory).toBe(actionHistoryBeforeInvalidSelection);
    expect(session.state?.players[1].memberSlots.cardStates.get(waitingLowCost.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[1].memberSlots.cardStates.get(highCost.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );

    confirmTargets(session, [legalTarget.instanceId]);
    expect(session.state?.players[1].memberSlots.cardStates.get(legalTarget.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('consumes pending without opening a window when hand is empty', () => {
    const target = createCardInstance(createMember('PL!HS-test-no-hand-target'), PLAYER2, 'no-hand-target');
    const { session } = startOnEnter({
      handCards: [],
      opponentStageCards: [{ card: target, slot: SlotPosition.LEFT }],
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID &&
          action.payload.step === 'NOT_ENOUGH_HAND_TO_DISCARD'
      )
    ).toBe(true);
  });

  it('keeps the discard cost paid when no legal opponent target exists after payment', () => {
    const discard = createCardInstance(createMember('PL!HS-test-no-target-discard'), PLAYER1, 'no-target-discard');
    const highCost = createCardInstance(createMember('PL!HS-test-no-target-high-cost', 5), PLAYER2, 'no-target-high-cost');
    const { session } = startOnEnter({
      handCards: [discard],
      opponentStageCards: [{ card: highCost, slot: SlotPosition.LEFT }],
    });

    confirmDiscard(session, discard.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);
    expect(session.state?.players[1].memberSlots.cardStates.get(highCost.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_016_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID &&
          action.payload.step === 'NO_OPPONENT_LOW_COST_ACTIVE_TARGET'
      )
    ).toBe(true);
  });
});
