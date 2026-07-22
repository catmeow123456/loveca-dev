import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { CostCalculator } from '../../src/domain/rules/cost-calculator';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
  PL_PR_015_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
  SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
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

function createMemberData(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createMember(
  cardCode: string,
  instanceId: string,
  options: Parameters<typeof createMemberData>[1] = {},
  ownerId = PLAYER1
) {
  return createCardInstance(createMemberData(cardCode, options), ownerId, instanceId);
}

function setupState(options: {
  readonly sourceCost?: number;
  readonly replacementEffectiveCost?: number;
  readonly includeRelayMetadata?: boolean;
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly fillAllSlots?: boolean;
  readonly sourceCardCode?: string;
}) {
  const source = createMember(options.sourceCardCode ?? 'PL!SP-PR-020-PR', 'sp-pr-020-source', {
    name: '桜小路きな子',
    cost: options.sourceCost ?? 17,
  });
  const replacement = createMember('PL!SP-test-replacement', 'sp-pr-020-replacement', {
    cost: options.replacementEffectiveCost ?? 9,
  });
  const left = createMember('PL!SP-test-left', 'sp-pr-020-left');
  const right = createMember('PL!SP-test-right', 'sp-pr-020-right');
  const handCards = options.handCards ?? [
    createMember('PL!SP-bp4-001-P', 'sp-pr-020-low-cost-enter', {
      name: '澁谷かのん',
      cost: 4,
    }),
  ];

  let game = createGameState('sp-pr-020-kinako', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, replacement, left, right, ...handCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.fillAllSlots) {
      memberSlots = placeCardInSlot(
        placeCardInSlot(memberSlots, SlotPosition.LEFT, left.instanceId),
        SlotPosition.RIGHT,
        right.instanceId
      );
    }
    return {
      ...player,
      memberSlots,
      hand: handCards.reduce((hand, card) => addCardToZone(hand, card.instanceId), player.hand),
      waitingRoom: addCardToZone(player.waitingRoom, replacement.instanceId),
    };
  });

  return { game, source, replacement, handCards, left, right };
}

function startAbility(
  game: GameState,
  sourceCardId: string,
  replacementCardId: string,
  options: {
    readonly includeRelayMetadata?: boolean;
    readonly replacementEffectiveCost?: number;
    readonly abilityId?: string;
  } = {}
): GameState {
  const pendingAbility: PendingAbilityState = {
    id: 'sp-pr-020-pending',
    abilityId:
      options.abilityId ?? SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-stage'],
    sourceSlot: SlotPosition.CENTER,
    metadata:
      options.includeRelayMetadata === false
        ? undefined
        : {
            relayReplacements: [
              {
                cardId: replacementCardId,
                effectiveCost: options.replacementEffectiveCost ?? 9,
              },
            ],
          },
  };
  return resolvePendingCardEffects({ ...game, pendingAbilities: [pendingAbility] }).gameState;
}

function latestPayload(
  game: GameState,
  abilityId = SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID
) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === abilityId
    )
    .at(-1)?.payload;
}

function createEnergy(index: number): EnergyCardData {
  return { cardCode: `ENERGY-${index}`, name: `Energy ${index}`, cardType: CardType.ENERGY };
}

function createDeck(): DeckConfig {
  return {
    mainDeck: Array.from({ length: 60 }, (_, index) =>
      createMemberData(`DECK-MEMBER-${index}`, { cost: 1 })
    ) as AnyCardData[],
    energyDeck: Array.from({ length: 12 }, (_, index) => createEnergy(index)),
  };
}

function setupRealRelayScenario(replacementCost: number) {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('pr-015-real-relay', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);

  const source = createMember('PL!-PR-015-PR', 'pr-015-source', {
    name: '西木野真姫',
    cost: 17,
    groupNames: ["μ's"],
  });
  const replacement = createMember('PL!-test-replacement', 'pr-015-replacement', {
    cost: replacementCost,
    groupNames: ["μ's"],
  });
  const handTarget = createMember('PL!SP-bp4-001-P', 'pr-015-hand-target', {
    name: '澁谷かのん',
    cost: 4,
    groupNames: ['Liella!'],
  });
  let state = registerCards(session.state!, [source, replacement, handTarget]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId, handTarget.instanceId] },
    memberSlots: placeCardInSlot(
      {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map(),
      },
      SlotPosition.CENTER,
      replacement.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
  }));
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const mutable = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutable.currentPhase = GamePhase.MAIN_PHASE;
  mutable.currentSubPhase = SubPhase.MAIN_FREE;
  mutable.currentTurnType = TurnType.NORMAL;
  mutable.activePlayerIndex = 0;
  mutable.waitingPlayerId = null;
  return { session, source, replacement, handTarget };
}

describe('PL!SP-PR-020 Kinako low-cost relay hand play workflow', () => {
  it('optionally plays a cost 4 or lower member from hand to an empty slot and triggers its ON_ENTER ability', () => {
    const scenario = setupState({});
    const started = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );

    expect(started.activeEffect).toMatchObject({
      abilityId: SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [scenario.handCards[0].instanceId],
      canSkipSelection: true,
      selectionLabel: '选择要登场的成员',
      confirmSelectionLabel: '登场',
      skipSelectionLabel: '不登场',
    });

    const afterCardSelection = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handCards[0].instanceId
    );
    expect(afterCardSelection.activeEffect).toMatchObject({
      stepId: 'LOW_COST_RELAY_PLAY_HAND_MEMBER_SELECT_SLOT',
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      selectableCardIds: undefined,
      selectionLabel: '选择登场区域',
      confirmSelectionLabel: '登场',
    });

    const state = confirmActiveEffectStep(
      afterCardSelection,
      PLAYER1,
      afterCardSelection.activeEffect!.id,
      undefined,
      SlotPosition.LEFT
    );

    expect(state.players[0].hand.cardIds).not.toContain(scenario.handCards[0].instanceId);
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.handCards[0].instanceId
    );
    expect(state.players[0].memberSlots.cardStates.get(scenario.handCards[0].instanceId)).toEqual({
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.sourceCardId === scenario.handCards[0].instanceId
      )
    ).toBe(true);
    expect(latestPayload(state)).toMatchObject({
      step: 'PLAY_HAND_LOW_COST_MEMBER_TO_EMPTY_SLOT',
      selectedCardId: scenario.handCards[0].instanceId,
      toSlot: SlotPosition.LEFT,
    });
    const resolveIndex = state.actionHistory.findIndex(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.step === 'PLAY_HAND_LOW_COST_MEMBER_TO_EMPTY_SLOT'
    );
    const childTriggerIndex = state.actionHistory.findIndex(
      (action) =>
        action.type === 'TRIGGER_ABILITY' &&
        action.payload.sourceCardId === scenario.handCards[0].instanceId
    );
    expect(resolveIndex).toBeGreaterThanOrEqual(0);
    expect(childTriggerIndex).toBeGreaterThan(resolveIndex);
  });

  it('routes the independent PL!-PR-015 ability identity through the same shared workflow', () => {
    const scenario = setupState({ sourceCardCode: 'PL!-PR-015-PR' });
    const started = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId,
      { abilityId: PL_PR_015_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID }
    );

    expect(started.activeEffect).toMatchObject({
      abilityId: PL_PR_015_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
      effectText:
        '【登场】因与小于此成员费用的成员换手登场的场合，从手牌将1张费用小于等于4的成员卡登场至舞台。',
      selectionLabel: '选择要登场的成员',
      confirmSelectionLabel: '登场',
      skipSelectionLabel: '不登场',
    });
  });

  it.each([
    { name: 'non-relay enter', includeRelayMetadata: false, replacementEffectiveCost: 9 },
    {
      name: 'replacement cost is not lower',
      includeRelayMetadata: true,
      replacementEffectiveCost: 17,
    },
    {
      name: 'replacement cost is higher',
      includeRelayMetadata: true,
      replacementEffectiveCost: 18,
    },
  ])(
    'consumes pending as no-op for $name',
    ({ includeRelayMetadata, replacementEffectiveCost }) => {
      const scenario = setupState({ replacementEffectiveCost });
      const state = startAbility(
        scenario.game,
        scenario.source.instanceId,
        scenario.replacement.instanceId,
        {
          includeRelayMetadata,
          replacementEffectiveCost,
        }
      );

      expect(state.activeEffect).toBeNull();
      expect(state.pendingAbilities).toHaveLength(0);
      expect(state.players[0].hand.cardIds).toEqual([scenario.handCards[0].instanceId]);
      expect(latestPayload(state)).toMatchObject({
        conditionMet: false,
      });
    }
  );

  it('compares the captured replacement cost with the source effective cost at resolution', () => {
    const scenario = setupState({ replacementEffectiveCost: 18 });
    const withSourceCostModifier = addLiveModifier(scenario.game, {
      kind: 'MEMBER_COST',
      playerId: PLAYER1,
      memberCardId: scenario.source.instanceId,
      countDelta: 2,
      sourceCardId: scenario.source.instanceId,
      abilityId: 'test:source-effective-cost-plus-two',
    });
    const started = startAbility(
      withSourceCostModifier,
      scenario.source.instanceId,
      scenario.replacement.instanceId,
      { replacementEffectiveCost: 18 }
    );

    expect(started.activeEffect).not.toBeNull();
  });

  it('consumes pending as no-op when there is no legal hand target', () => {
    const highCostMember = createMember('PL!SP-test-high-cost', 'sp-pr-020-high-cost', {
      cost: 5,
    });
    const liveCard = createCardInstance(
      {
        cardCode: 'PL!SP-test-live',
        name: 'Live',
        groupNames: ['Liella!'],
        cardType: CardType.LIVE,
        score: 1,
        requirements: [],
      },
      PLAYER1,
      'sp-pr-020-live'
    );
    const scenario = setupState({ handCards: [highCostMember, liveCard] });
    const state = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_OP_NO_LOW_COST_HAND_MEMBER',
      selectableCardIds: [],
    });
  });

  it('keeps the hand threshold on printed cost even when play-cost reduction reaches 4', () => {
    const reducedToFour = createMember('LL-bp2-001-R＋', 'play-cost-reduced-to-four', {
      cost: 5,
    });
    const otherHandCard = createCardInstance(
      {
        cardCode: 'PL!-test-live',
        name: 'Other hand card',
        groupNames: ["μ's"],
        cardType: CardType.LIVE,
        score: 1,
        requirements: [],
      },
      PLAYER1,
      'other-hand-card'
    );
    const calculator = new CostCalculator();
    const costCheck = calculator.checkCanPayCost(
      reducedToFour.data as MemberCardData,
      SlotPosition.LEFT,
      {
        activeEnergyIds: ['e1', 'e2', 'e3', 'e4'],
        stageMembers: [],
        sourceCardId: reducedToFour.instanceId,
        handCardIds: [reducedToFour.instanceId, otherHandCard.instanceId],
      }
    );
    expect(costCheck.availablePlans.some((plan) => plan.modifiedCost === 4)).toBe(true);

    const scenario = setupState({ handCards: [reducedToFour, otherHandCard] });
    const state = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );
    expect(state.activeEffect).toBeNull();
    expect(latestPayload(state)).toMatchObject({ step: 'NO_OP_NO_LOW_COST_HAND_MEMBER' });
  });

  it('consumes pending as no-op when there is no empty member slot', () => {
    const scenario = setupState({ fillAllSlots: true });
    const state = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_OP_NO_EMPTY_STAGE_SLOT',
      emptySlots: [],
    });
  });

  it('lets the player skip without changing hand or stage', () => {
    const scenario = setupState({});
    const started = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );
    const state = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].hand.cardIds).toEqual([scenario.handCards[0].instanceId]);
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(latestPayload(state)).toMatchObject({
      step: 'DECLINE_PLAY_HAND_LOW_COST_MEMBER',
    });
  });

  it('rejects forged targets and refreshes a stale hand selection', () => {
    const valid = createMember('PL!SP-test-valid-low-cost', 'sp-pr-020-valid', { cost: 4 });
    const otherValid = createMember('PL!SP-test-other-valid', 'sp-pr-020-other-valid', { cost: 3 });
    const highCost = createMember('PL!SP-test-high-cost', 'sp-pr-020-high-cost', { cost: 5 });
    const opponentMember = createMember(
      'PL!SP-test-opponent-member',
      'sp-pr-020-opponent-member',
      { cost: 4 },
      PLAYER2
    );
    const scenario = setupState({ handCards: [valid, otherValid, highCost, opponentMember] });
    let started = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );

    expect(started.activeEffect?.selectableCardIds).toEqual([valid.instanceId, otherValid.instanceId]);
    expect(
      confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, highCost.instanceId)
    ).toBe(started);
    expect(
      confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, opponentMember.instanceId)
    ).toBe(started);

    started = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: player.hand.cardIds.filter((cardId) => cardId !== valid.instanceId),
      },
    }));
    const refreshed = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      valid.instanceId
    );
    expect(refreshed.activeEffect).toMatchObject({
      selectableCardIds: [otherValid.instanceId],
      selectionLabel: '选择要登场的成员',
      confirmSelectionLabel: '登场',
      skipSelectionLabel: '不登场',
    });
  });

  it('refreshes a slot that became occupied and safely rejects duplicate confirmation', () => {
    const scenario = setupState({});
    const started = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );
    let slotSelection = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handCards[0].instanceId
    );
    slotSelection = updatePlayer(slotSelection, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, scenario.left.instanceId),
    }));
    const refreshed = confirmActiveEffectStep(
      slotSelection,
      PLAYER1,
      slotSelection.activeEffect!.id,
      undefined,
      SlotPosition.LEFT
    );
    expect(refreshed.activeEffect).toMatchObject({
      selectableSlots: [SlotPosition.RIGHT],
      selectionLabel: '选择登场区域',
      confirmSelectionLabel: '登场',
    });
    const resolved = confirmActiveEffectStep(
      refreshed,
      PLAYER1,
      refreshed.activeEffect!.id,
      undefined,
      SlotPosition.RIGHT
    );
    expect(resolved.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      scenario.handCards[0].instanceId
    );
    expect(
      confirmActiveEffectStep(
        resolved,
        PLAYER1,
        refreshed.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    ).toBe(resolved);
  });

  it('resolves from the queued source identity after the source leaves the stage', () => {
    const scenario = setupState({ sourceCardCode: 'PL!-PR-015-PR' });
    const sourceInWaitingRoom = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: addCardToZone(player.waitingRoom, scenario.source.instanceId),
    }));
    const started = startAbility(
      sourceInWaitingRoom,
      scenario.source.instanceId,
      scenario.replacement.instanceId,
      { abilityId: PL_PR_015_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID }
    );
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_PR_015_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
      selectableCardIds: [scenario.handCards[0].instanceId],
    });
  });

  it.each([
    { name: 'lower', replacementCost: 16, shouldOpen: true },
    { name: 'equal', replacementCost: 17, shouldOpen: false },
    { name: 'higher', replacementCost: 18, shouldOpen: false },
  ])(
    'uses the production play/relay command for a $name-cost replacement',
    ({ replacementCost, shouldOpen }) => {
      const scenario = setupRealRelayScenario(replacementCost);
      scenario.session.localFreePlay = true;
      const result = scenario.session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, scenario.source.instanceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      );
      expect(result.success).toBe(true);
      expect(
        scenario.session.state?.actionHistory.some(
          (action) =>
            action.type === 'PLAY_MEMBER' &&
            action.payload.cardId === scenario.source.instanceId &&
            action.payload.relayReplacements?.[0]?.effectiveCost === replacementCost
        )
      ).toBe(true);
      if (!shouldOpen) {
        expect(scenario.session.state?.activeEffect).toBeNull();
        expect(scenario.session.state?.pendingAbilities).toEqual([]);
        return;
      }

      expect(scenario.session.state?.activeEffect).toMatchObject({
        abilityId: PL_PR_015_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
        selectableCardIds: [scenario.handTarget.instanceId],
        selectionLabel: '选择要登场的成员',
        confirmSelectionLabel: '登场',
        skipSelectionLabel: '不登场',
      });
      const selectCard = scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          scenario.handTarget.instanceId
        )
      );
      expect(selectCard.success).toBe(true);
      const selectSlot = scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          undefined,
          SlotPosition.LEFT
        )
      );
      expect(selectSlot.success).toBe(true);
      expect(scenario.session.state?.players[0].hand.cardIds).not.toContain(
        scenario.handTarget.instanceId
      );
      expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
        scenario.handTarget.instanceId
      );
      expect(
        scenario.session.state?.eventLog.some(
          (entry) =>
            entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
            entry.event.cardInstanceId === scenario.handTarget.instanceId &&
            entry.event.fromZone === ZoneType.HAND
        )
      ).toBe(true);
    }
  );

  it('does not open for an ordinary non-relay production play', () => {
    const scenario = setupRealRelayScenario(16);
    let state = updatePlayer(scenario.session.state!, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    (scenario.session as unknown as { authorityState: GameState }).authorityState = state;
    scenario.session.localFreePlay = true;
    const result = scenario.session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, scenario.source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(result.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
  });
});
