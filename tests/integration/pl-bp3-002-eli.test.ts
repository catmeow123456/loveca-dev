import { describe, expect, it } from 'vitest';
import type { CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { addMemberCostLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
  PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function member(
  cardCode: string,
  ownerId: string,
  instanceId: string,
  cost = 4
): CardInstance<MemberCardData> {
  return createCardInstance(
    {
      cardCode,
      name: cardCode,
      groupNames: ["μ's"],
      cardType: CardType.MEMBER,
      cost,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
    },
    ownerId,
    instanceId
  );
}

interface OpponentMemberSetup {
  readonly card: CardInstance<MemberCardData>;
  readonly slot: SlotPosition;
  readonly orientation?: OrientationState;
}

function setup(options: {
  readonly sourceCount?: 1 | 2;
  readonly handCards?: readonly CardInstance<MemberCardData>[];
  readonly opponentMembers?: readonly OpponentMemberSetup[];
} = {}): {
  readonly game: GameState;
  readonly sources: readonly CardInstance<MemberCardData>[];
  readonly handCards: readonly CardInstance<MemberCardData>[];
  readonly opponentMembers: readonly CardInstance<MemberCardData>[];
} {
  const sourceCount = options.sourceCount ?? 1;
  const sources = Array.from({ length: sourceCount }, (_, index) =>
    member(
      index === 0 ? 'PL!-bp3-002-R' : 'PL!-bp3-002-P',
      PLAYER1,
      `eli-source-${index}`,
      9
    )
  );
  const handCards =
    options.handCards ?? [member('PL!-test-hand-cost', PLAYER1, 'hand-cost', 1)];
  const opponentMembers =
    options.opponentMembers ??
    [
      { card: member('PL!-test-target-left', PLAYER2, 'target-left', 4), slot: SlotPosition.LEFT },
      {
        card: member('PL!-test-target-center', PLAYER2, 'target-center', 2),
        slot: SlotPosition.CENTER,
      },
    ];

  let game = createGameState('pl-bp3-002-eli', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    ...sources,
    ...handCards,
    ...opponentMembers.map((entry) => entry.card),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    sources.forEach((source, index) => {
      memberSlots = placeCardInSlot(
        memberSlots,
        index === 0 ? SlotPosition.CENTER : SlotPosition.LEFT,
        source.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      );
    });
    return {
      ...player,
      hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
      memberSlots,
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: opponentMembers.reduce(
      (slots, entry) =>
        placeCardInSlot(slots, entry.slot, entry.card.instanceId, {
          orientation: entry.orientation ?? OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  sources.forEach((source, index) => {
    const slot = index === 0 ? SlotPosition.CENTER : SlotPosition.LEFT;
    game = emitGameEvent(
      game,
      createEnterStageEvent(source.instanceId, ZoneType.HAND, slot, PLAYER1, PLAYER1)
    );
  });
  game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  return {
    game,
    sources,
    handCards,
    opponentMembers: opponentMembers.map((entry) => entry.card),
  };
}

function confirmOne(game: GameState, selectedCardId: string | null): GameState {
  expect(game.activeEffect).toBeTruthy();
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

function confirmMany(game: GameState, selectedCardIds: readonly string[]): GameState {
  expect(game.activeEffect).toBeTruthy();
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    selectedCardIds[0] ?? null,
    null,
    false,
    null,
    selectedCardIds
  );
}

function startFirstPending(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

describe('PL!-bp3-002 絢瀬絵里 ON_ENTER', () => {
  it('pays one discard and waits two legal members with exactly one event per real change', () => {
    const scenario = setup();
    const started = startFirstPending(scenario.game);
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
      selectableCardIds: [scenario.handCards[0]!.instanceId],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    const afterDiscard = confirmOne(started, scenario.handCards[0]!.instanceId);
    expect(afterDiscard.players[0].hand.cardIds).toEqual([]);
    expect(afterDiscard.players[0].waitingRoom.cardIds).toEqual([
      scenario.handCards[0]!.instanceId,
    ]);
    expect(afterDiscard.activeEffect).toMatchObject({
      selectableCardIds: scenario.opponentMembers.map((card) => card.instanceId),
      minSelectableCards: 0,
      maxSelectableCards: 2,
      canSkipSelection: true,
    });

    const resolved = confirmMany(
      afterDiscard,
      scenario.opponentMembers.map((card) => card.instanceId)
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    for (const target of scenario.opponentMembers) {
      expect(resolved.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(
        resolved.eventLog.filter(
          (entry) =>
            entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
            entry.event.cardInstanceId === target.instanceId
        )
      ).toHaveLength(1);
    }
    expect(
      resolved.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === scenario.handCards[0]!.instanceId &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.toZone === ZoneType.WAITING_ROOM
      )
    ).toHaveLength(1);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID &&
          action.payload.step === 'WAIT_OPPONENT_LOW_COST_MEMBERS'
      )
    ).toHaveLength(1);
  });

  it('supports declining, no hand, and paid no-target completion without fake events', () => {
    const declinedScenario = setup();
    const declined = confirmOne(startFirstPending(declinedScenario.game), null);
    expect(declined.players[0].hand.cardIds).toEqual([
      declinedScenario.handCards[0]!.instanceId,
    ]);
    expect(declined.pendingAbilities).toEqual([]);
    expect(
      declined.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(0);

    const noHand = startFirstPending(setup({ handCards: [] }).game);
    expect(noHand.activeEffect).toBeNull();
    expect(noHand.pendingAbilities).toEqual([]);
    expect(noHand.actionHistory.at(-1)?.payload.step).toBe('NO_HAND_TO_DISCARD');

    const highCost = member('PL!-test-high-cost', PLAYER2, 'high-cost', 5);
    const noTargetScenario = setup({
      opponentMembers: [{ card: highCost, slot: SlotPosition.CENTER }],
    });
    const paidNoTarget = confirmOne(
      startFirstPending(noTargetScenario.game),
      noTargetScenario.handCards[0]!.instanceId
    );
    expect(paidNoTarget.activeEffect).toBeNull();
    expect(paidNoTarget.players[0].waitingRoom.cardIds).toContain(
      noTargetScenario.handCards[0]!.instanceId
    );
    expect(
      paidNoTarget.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(0);
  });

  it('allows choosing zero or one target as Q144 permits', () => {
    const zeroScenario = setup();
    const zeroAfterCost = confirmOne(
      startFirstPending(zeroScenario.game),
      zeroScenario.handCards[0]!.instanceId
    );
    const choseZero = confirmMany(zeroAfterCost, []);
    expect(choseZero.activeEffect).toBeNull();
    expect(
      choseZero.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(0);

    const oneScenario = setup();
    const oneAfterCost = confirmOne(
      startFirstPending(oneScenario.game),
      oneScenario.handCards[0]!.instanceId
    );
    const choseOne = confirmMany(oneAfterCost, [oneScenario.opponentMembers[0]!.instanceId]);
    expect(
      choseOne.players[1].memberSlots.cardStates.get(
        oneScenario.opponentMembers[0]!.instanceId
      )?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      choseOne.players[1].memberSlots.cardStates.get(
        oneScenario.opponentMembers[1]!.instanceId
      )?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('uses live effective cost, excludes WAITING, and rejects stale or duplicate targets', () => {
    const printedFourRaised = member('PL!-test-four-raised', PLAYER2, 'four-raised', 4);
    const printedFiveReduced = member('PL!-test-five-reduced', PLAYER2, 'five-reduced', 5);
    const alreadyWaiting = member('PL!-test-waiting', PLAYER2, 'already-waiting', 2);
    const scenario = setup({
      opponentMembers: [
        { card: printedFourRaised, slot: SlotPosition.LEFT },
        { card: printedFiveReduced, slot: SlotPosition.CENTER },
        {
          card: alreadyWaiting,
          slot: SlotPosition.RIGHT,
          orientation: OrientationState.WAITING,
        },
      ],
    });
    let game = addMemberCostLiveModifierForMember(scenario.game, {
      playerId: PLAYER2,
      memberCardId: printedFourRaised.instanceId,
      sourceCardId: printedFourRaised.instanceId,
      abilityId: 'test:raise-cost',
      countDelta: 1,
    })!.gameState;
    game = addMemberCostLiveModifierForMember(game, {
      playerId: PLAYER2,
      memberCardId: printedFiveReduced.instanceId,
      sourceCardId: printedFiveReduced.instanceId,
      abilityId: 'test:reduce-cost',
      countDelta: -1,
    })!.gameState;

    const afterCost = confirmOne(startFirstPending(game), scenario.handCards[0]!.instanceId);
    expect(afterCost.activeEffect?.selectableCardIds).toEqual([printedFiveReduced.instanceId]);

    const duplicate = confirmMany(afterCost, [
      printedFiveReduced.instanceId,
      printedFiveReduced.instanceId,
    ]);
    expect(duplicate).toBe(afterCost);

    const costChanged = addMemberCostLiveModifierForMember(afterCost, {
      playerId: PLAYER2,
      memberCardId: printedFiveReduced.instanceId,
      sourceCardId: printedFiveReduced.instanceId,
      abilityId: 'test:raise-again',
      countDelta: 1,
    })!.gameState;
    expect(confirmMany(costChanged, [printedFiveReduced.instanceId])).toBe(costChanged);

    const targetLeftStage = updatePlayer(afterCost, PLAYER2, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(confirmMany(targetLeftStage, [printedFiveReduced.instanceId])).toBe(targetLeftStage);
  });

  it('rejects a stale hand choice but continues after the source left once the trigger was queued', () => {
    const staleScenario = setup();
    const started = startFirstPending(staleScenario.game);
    const staleHand = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));
    expect(confirmOne(staleHand, staleScenario.handCards[0]!.instanceId)).toBe(staleHand);

    const leftScenario = setup();
    const sourceLeft = updatePlayer(leftScenario.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: addCardToZone(player.waitingRoom, leftScenario.sources[0]!.instanceId),
    }));
    const afterSourceLeft = startFirstPending(sourceLeft);
    expect(afterSourceLeft.activeEffect?.selectableCardIds).toEqual([
      leftScenario.handCards[0]!.instanceId,
    ]);
    const afterCost = confirmOne(afterSourceLeft, leftScenario.handCards[0]!.instanceId);
    const resolved = confirmMany(afterCost, [leftScenario.opponentMembers[0]!.instanceId]);
    expect(
      resolved.players[1].memberSlots.cardStates.get(
        leftScenario.opponentMembers[0]!.instanceId
      )?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('handles manual choice and ordered resolution in a multiple-pending window', () => {
    const createMixedPendingGame = () => {
      const scenario = setup();
      return {
        scenario,
        game: {
          ...scenario.game,
          pendingAbilities: [
            ...scenario.game.pendingAbilities,
            {
              id: 'other-on-enter-pending',
              abilityId:
                PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
              sourceCardId: 'other-on-enter-source',
              controllerId: PLAYER1,
              mandatory: true,
              timingId: TriggerCondition.ON_ENTER_STAGE,
              eventIds: [],
            },
          ],
        },
      };
    };

    const manual = createMixedPendingGame();
    const manualOrderSelection = startFirstPending(manual.game);
    expect(manualOrderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const manuallySelected = confirmActiveEffectStep(
      manualOrderSelection,
      PLAYER1,
      manualOrderSelection.activeEffect!.id,
      manual.scenario.sources[0]!.instanceId
    );
    expect(manuallySelected.activeEffect).toMatchObject({
      abilityId: PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
      metadata: expect.objectContaining({ orderedResolution: false }),
    });

    const ordered = createMixedPendingGame();
    const orderSelection = startFirstPending(ordered.game);
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    let state = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );
    expect(state.activeEffect).toMatchObject({
      abilityId: PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
      metadata: expect.objectContaining({ orderedResolution: true }),
    });

    state = confirmOne(state, ordered.scenario.handCards[0]!.instanceId);
    state = confirmMany(state, []);

    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
    expect(
      state.actionHistory.filter(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(
      state.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP3_002_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID &&
          action.payload.step === 'NO_TARGET_SELECTED'
      )
    ).toHaveLength(1);
  });

});
