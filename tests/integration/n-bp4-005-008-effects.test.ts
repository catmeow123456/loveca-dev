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
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { addMemberCostLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import { GameService } from '../../src/application/game-service';
import {
  activateCardAbility,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import {
  PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
  PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(
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
    groupNames: options.groupNames ?? ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function card(
  cardCode: string,
  ownerId: string,
  instanceId: string,
  options: Parameters<typeof createMember>[1] = {}
): CardInstance<MemberCardData> {
  return createCardInstance(createMember(cardCode, options), ownerId, instanceId);
}

function setPhaseMain(game: GameState): GameState {
  return { ...game, currentPhase: GamePhase.MAIN_PHASE };
}

function startOnEnterTiming(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_ENTER_STAGE]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function confirmSingle(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  expect(effect).toBeTruthy();
  return confirmActiveEffectStep(game, PLAYER1, effect!.id, selectedCardId);
}

function confirmOption(game: GameState, selectedOptionId: string): GameState {
  const effect = game.activeEffect;
  expect(effect).toBeTruthy();
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    effect!.id,
    undefined,
    undefined,
    undefined,
    selectedOptionId
  );
}

function confirmMany(game: GameState, selectedCardIds: readonly string[]): GameState {
  const effect = game.activeEffect;
  expect(effect).toBeTruthy();
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    effect!.id,
    selectedCardIds[0] ?? null,
    null,
    false,
    null,
    selectedCardIds
  );
}

function setupAiOnEnter(options: {
  readonly handCards?: readonly CardInstance<MemberCardData>[];
  readonly opponentMembers?: readonly {
    readonly card: CardInstance<MemberCardData>;
    readonly slot: SlotPosition;
    readonly orientation?: OrientationState;
  }[];
  readonly ownExtraMember?: CardInstance<MemberCardData>;
} = {}): {
  readonly game: GameState;
  readonly source: CardInstance<MemberCardData>;
  readonly handCards: readonly CardInstance<MemberCardData>[];
  readonly opponentMembers: readonly CardInstance<MemberCardData>[];
  readonly ownExtraMember?: CardInstance<MemberCardData>;
} {
  const source = card('PL!N-bp4-005-R', PLAYER1, 'ai-source', {
    name: '宮下 愛',
    cost: 4,
  });
  const handCards =
    options.handCards ?? [card('hand-cost', PLAYER1, 'ai-hand-cost', { cost: 1 })];
  const opponentMembers =
    options.opponentMembers ??
    [
      { card: card('op-low-left', PLAYER2, 'op-low-left', { cost: 4 }), slot: SlotPosition.LEFT },
      { card: card('op-low-center', PLAYER2, 'op-low-center', { cost: 2 }), slot: SlotPosition.CENTER },
    ];
  const ownExtraMember = options.ownExtraMember;

  let game = createGameState('n-bp4-005-ai', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...handCards,
    ...opponentMembers.map((entry) => entry.card),
    ...(ownExtraMember ? [ownExtraMember] : []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: handCards.reduce((zone, entry) => addCardToZone(zone, entry.instanceId), player.hand),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  if (ownExtraMember) {
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, ownExtraMember.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
  }
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
  game = emitGameEvent(game, {
    eventId: 'enter-ai',
    eventType: TriggerCondition.ON_ENTER_STAGE,
    timestamp: Date.now(),
    cardInstanceId: source.instanceId,
    fromZone: ZoneType.HAND,
    toZone: ZoneType.MEMBER_SLOT,
    toSlot: SlotPosition.CENTER,
    ownerId: PLAYER1,
    controllerId: PLAYER1,
  });

  return {
    game,
    source,
    handCards,
    opponentMembers: opponentMembers.map((entry) => entry.card),
    ownExtraMember,
  };
}

function setupEmmaActivated(options: {
  readonly handCards?: readonly CardInstance<MemberCardData>[];
  readonly energyOrientations?: readonly OrientationState[];
  readonly stageMembers?: readonly {
    readonly card: CardInstance<MemberCardData>;
    readonly slot: SlotPosition;
    readonly orientation?: OrientationState;
  }[];
} = {}): {
  readonly game: GameState;
  readonly source: CardInstance<MemberCardData>;
  readonly handCards: readonly CardInstance<MemberCardData>[];
  readonly energyCards: readonly CardInstance<MemberCardData>[];
  readonly stageMembers: readonly CardInstance<MemberCardData>[];
} {
  const source = card('PL!N-bp4-008-R', PLAYER1, 'emma-source', {
    name: 'エマ・ヴェルデ',
    cost: 5,
  });
  const handCards =
    options.handCards ?? [card('emma-hand-cost', PLAYER1, 'emma-hand-cost', { cost: 1 })];
  const energyOrientations = options.energyOrientations ?? [OrientationState.WAITING];
  const energyCards = energyOrientations.map((_, index) =>
    card(`energy-${index}`, PLAYER1, `emma-energy-${index}`, { cost: 1 })
  );
  const stageMembers = options.stageMembers ?? [];

  let game = createGameState('n-bp4-008-emma', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...handCards,
    ...energyCards,
    ...stageMembers.map((entry) => entry.card),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: handCards.reduce((zone, entry) => addCardToZone(zone, entry.instanceId), player.hand),
    energyZone: energyCards.reduce(
      (zone, entry, index) =>
        addCardToStatefulZone(zone, entry.instanceId, {
          orientation: energyOrientations[index] ?? OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    memberSlots: stageMembers.reduce(
      (slots, entry) =>
        placeCardInSlot(slots, entry.slot, entry.card.instanceId, {
          orientation: entry.orientation ?? OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      })
    ),
  }));

  return {
    game: setPhaseMain(game),
    source,
    handCards,
    energyCards,
    stageMembers: stageMembers.map((entry) => entry.card),
  };
}

describe('PL!N-bp4-005 Ai on-enter workflow', () => {
  it('discards a chosen hand card and waits one or two current low-cost opponent members', () => {
    const setup = setupAiOnEnter();
    const started = startOnEnterTiming(setup.game);
    expect(started.activeEffect?.abilityId).toBe(
      PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID
    );

    const afterDiscard = confirmSingle(started, setup.handCards[0]!.instanceId);
    expect(afterDiscard.players[0].hand.cardIds).toEqual([]);
    expect(afterDiscard.players[0].waitingRoom.cardIds).toEqual([setup.handCards[0]!.instanceId]);
    expect(afterDiscard.activeEffect?.selectableCardIds).toEqual(
      setup.opponentMembers.map((entry) => entry.instanceId)
    );

    const resolved = confirmMany(
      afterDiscard,
      setup.opponentMembers.map((entry) => entry.instanceId)
    );
    expect(resolved.activeEffect).toBeNull();
    for (const target of setup.opponentMembers) {
      expect(resolved.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === setup.handCards[0]!.instanceId &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.toZone === ZoneType.WAITING_ROOM
      )
    ).toBe(true);
    expect(
      resolved.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(2);
  });

  it('declines without discarding or waiting targets, and no-ops when there is no hand card', () => {
    const setup = setupAiOnEnter();
    const started = startOnEnterTiming(setup.game);
    const declined = confirmSingle(started, null);
    expect(declined.activeEffect).toBeNull();
    expect(declined.players[0].hand.cardIds).toEqual([setup.handCards[0]!.instanceId]);
    for (const target of setup.opponentMembers) {
      expect(declined.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }

    const noHandSetup = setupAiOnEnter({ handCards: [] });
    const noHand = startOnEnterTiming(noHandSetup.game);
    expect(noHand.activeEffect).toBeNull();
    expect(noHand.pendingAbilities).toHaveLength(0);
  });

  it('excludes own members and opponent members with effective cost above four', () => {
    const highCost = card('op-high', PLAYER2, 'op-high', { cost: 4 });
    const lowCost = card('op-low', PLAYER2, 'op-low', { cost: 4 });
    const ownExtra = card('own-low', PLAYER1, 'own-low', { cost: 1 });
    let { game, handCards } = setupAiOnEnter({
      opponentMembers: [
        { card: highCost, slot: SlotPosition.LEFT },
        { card: lowCost, slot: SlotPosition.CENTER },
      ],
      ownExtraMember: ownExtra,
    });
    const modifier = addMemberCostLiveModifierForMember(game, {
      playerId: PLAYER2,
      memberCardId: highCost.instanceId,
      sourceCardId: highCost.instanceId,
      abilityId: 'test:cost-plus-one',
      countDelta: 1,
    });
    expect(modifier).toBeTruthy();
    game = modifier!.gameState;

    const afterDiscard = confirmSingle(startOnEnterTiming(game), handCards[0]!.instanceId);
    expect(afterDiscard.activeEffect?.selectableCardIds).toEqual([lowCost.instanceId]);
    expect(afterDiscard.activeEffect?.selectableCardIds).not.toContain(ownExtra.instanceId);
    expect(afterDiscard.activeEffect?.selectableCardIds).not.toContain(highCost.instanceId);
  });

  it('rejects illegal or stale target selections without advancing state after cost', () => {
    const setup = setupAiOnEnter();
    const afterDiscard = confirmSingle(startOnEnterTiming(setup.game), setup.handCards[0]!.instanceId);
    const illegal = confirmMany(afterDiscard, ['not-a-target']);
    expect(illegal).toBe(afterDiscard);

    const staleTargetId = setup.opponentMembers[0]!.instanceId;
    const staleState = updatePlayer(afterDiscard, PLAYER2, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(staleTargetId, {
          ...player.memberSlots.cardStates.get(staleTargetId)!,
          orientation: OrientationState.WAITING,
        }),
      },
    }));
    const staleResult = confirmMany(staleState, [staleTargetId]);
    expect(staleResult).toBe(staleState);
    expect(staleResult.activeEffect).toBeTruthy();
  });
});

describe('PL!N-bp4-008 Emma activated workflow', () => {
  it('discards a hand card, activates one waiting energy, and records the once-per-turn use', () => {
    const setup = setupEmmaActivated();
    const started = activateCardAbility(
      setup.game,
      PLAYER1,
      setup.source.instanceId,
      PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID
    );
    expect(started.activeEffect?.stepId).toBe('PL_N_BP4_008_SELECT_DISCARD_COST');

    const afterDiscard = confirmSingle(started, setup.handCards[0]!.instanceId);
    expect(afterDiscard.players[0].waitingRoom.cardIds).toEqual([setup.handCards[0]!.instanceId]);
    expect(afterDiscard.activeEffect?.selectableCardIds).toEqual([setup.energyCards[0]!.instanceId]);

    const resolved = confirmSingle(afterDiscard, setup.energyCards[0]!.instanceId);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].energyZone.cardStates.get(setup.energyCards[0]!.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);

    const withSecondCost = updatePlayer(resolved, PLAYER1, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, setup.handCards[0]!.instanceId),
      energyZone: {
        ...player.energyZone,
        cardStates: new Map(player.energyZone.cardStates).set(setup.energyCards[0]!.instanceId, {
          ...player.energyZone.cardStates.get(setup.energyCards[0]!.instanceId)!,
          orientation: OrientationState.WAITING,
        }),
      },
    }));
    const secondAttempt = activateCardAbility(
      withSecondCost,
      PLAYER1,
      setup.source.instanceId,
      PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID
    );
    expect(secondAttempt).toBe(withSecondCost);
  });

  it('with only ACTIVE energy, pays the discard cost and resolves zero changes without an energy target window', () => {
    const setup = setupEmmaActivated({
      energyOrientations: Array.from({ length: 4 }, () => OrientationState.ACTIVE),
    });
    const started = activateCardAbility(
      setup.game,
      PLAYER1,
      setup.source.instanceId,
      PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID
    );
    expect(started.activeEffect?.stepId).toBe('PL_N_BP4_008_SELECT_DISCARD_COST');

    const afterDiscard = confirmSingle(started, setup.handCards[0]!.instanceId);
    expect(afterDiscard.players[0].hand.cardIds).toEqual([]);
    expect(afterDiscard.players[0].waitingRoom.cardIds).toEqual([setup.handCards[0]!.instanceId]);
    expect(afterDiscard.activeEffect).toBeNull();
    expect(
      setup.energyCards.map(
        (card) => afterDiscard.players[0].energyZone.cardStates.get(card.instanceId)?.orientation
      )
    ).toEqual(Array.from({ length: 4 }, () => OrientationState.ACTIVE));
    expect(afterDiscard.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID,
      step: 'ACTIVATE_ENERGY',
      selectedTargetType: 'activate-energy',
      activatedEnergyCardIds: [],
      stateChanged: false,
    });
    expect(
      afterDiscard.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID
      )
    ).toBe(true);
  });

  it('offers energy versus member, then choosing all-ACTIVE energy resolves zero without a card window', () => {
    const waitingMember = card('PL!N-test-niji', PLAYER1, 'waiting-niji', {
      groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    });
    const setup = setupEmmaActivated({
      energyOrientations: [OrientationState.ACTIVE, OrientationState.ACTIVE],
      stageMembers: [
        {
          card: waitingMember,
          slot: SlotPosition.LEFT,
          orientation: OrientationState.WAITING,
        },
      ],
    });
    const afterDiscard = confirmSingle(
      activateCardAbility(
        setup.game,
        PLAYER1,
        setup.source.instanceId,
        PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID
      ),
      setup.handCards[0]!.instanceId
    );
    expect(afterDiscard.activeEffect).toMatchObject({
      stepId: 'PL_N_BP4_008_SELECT_TARGET_TYPE',
      selectableCardIds: undefined,
      selectableOptions: [
        { id: 'activate-energy', label: '将1张能量变为活跃状态' },
        { id: 'activate-nijigasaki-member', label: '将1名「虹咲」成员变为活跃状态' },
      ],
    });

    const resolved = confirmOption(afterDiscard, 'activate-energy');
    expect(resolved.activeEffect).toBeNull();
    expect(
      resolved.players[0].memberSlots.cardStates.get(waitingMember.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'ACTIVATE_ENERGY',
      selectedTargetType: 'activate-energy',
      activatedEnergyCardIds: [],
      stateChanged: false,
    });
  });

  it('discards a hand card and activates one waiting Nijigasaki member', () => {
    const nijigasakiTarget = card('PL!N-test-niji', PLAYER1, 'niji-target', {
      groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    });
    const setup = setupEmmaActivated({
      energyOrientations: [OrientationState.ACTIVE],
      stageMembers: [
        {
          card: nijigasakiTarget,
          slot: SlotPosition.LEFT,
          orientation: OrientationState.WAITING,
        },
      ],
    });
    const afterDiscard = confirmSingle(
      activateCardAbility(
        setup.game,
        PLAYER1,
        setup.source.instanceId,
        PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID
      ),
      setup.handCards[0]!.instanceId
    );
    expect(afterDiscard.activeEffect?.stepId).toBe('PL_N_BP4_008_SELECT_TARGET_TYPE');
    const selectingMember = confirmOption(afterDiscard, 'activate-nijigasaki-member');
    expect(selectingMember.activeEffect?.selectableCardIds).toEqual([
      nijigasakiTarget.instanceId,
    ]);

    const resolved = confirmSingle(selectingMember, nijigasakiTarget.instanceId);
    expect(resolved.players[0].memberSlots.cardStates.get(nijigasakiTarget.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === nijigasakiTarget.instanceId
      )
    ).toBe(true);
  });

  it('does not start without hand cards or legal targets, and excludes non-Nijigasaki members', () => {
    const noHand = setupEmmaActivated({ handCards: [] });
    expect(
      activateCardAbility(
        noHand.game,
        PLAYER1,
        noHand.source.instanceId,
        PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID
      )
    ).toBe(noHand.game);

    const nonNiji = card('not-niji', PLAYER1, 'not-niji', {
      groupNames: ['Liella!'],
    });
    const noLegalTarget = setupEmmaActivated({
      energyOrientations: [],
      stageMembers: [
        { card: nonNiji, slot: SlotPosition.LEFT, orientation: OrientationState.WAITING },
      ],
    });
    expect(
      activateCardAbility(
        noLegalTarget.game,
        PLAYER1,
        noLegalTarget.source.instanceId,
        PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID
      )
    ).toBe(noLegalTarget.game);
  });

  it('rejects illegal or stale active target selections without advancing state after cost', () => {
    const setup = setupEmmaActivated();
    const afterDiscard = confirmSingle(
      activateCardAbility(
        setup.game,
        PLAYER1,
        setup.source.instanceId,
        PL_N_BP4_008_ACTIVATED_DISCARD_ACTIVATE_ENERGY_OR_NIJIGASAKI_MEMBER_ABILITY_ID
      ),
      setup.handCards[0]!.instanceId
    );

    const illegal = confirmSingle(afterDiscard, 'not-a-target');
    expect(illegal).toBe(afterDiscard);

    const staleEnergyId = setup.energyCards[0]!.instanceId;
    const staleState = updatePlayer(afterDiscard, PLAYER1, (player) => {
      const cardStates = new Map(player.energyZone.cardStates);
      cardStates.delete(staleEnergyId);
      return {
        ...player,
        energyZone: {
          ...player.energyZone,
          cardIds: player.energyZone.cardIds.filter((cardId) => cardId !== staleEnergyId),
          cardStates,
        },
      };
    });
    const staleResult = confirmSingle(staleState, staleEnergyId);
    expect(staleResult).toBe(staleState);
    expect(staleResult.activeEffect).toBeTruthy();
  });
});
