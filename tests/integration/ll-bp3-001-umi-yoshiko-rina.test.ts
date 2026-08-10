import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  LL_BP3_001_ACTIVATED_SHUFFLE_NAMED_MEMBERS_ACTIVATE_ENERGY_ABILITY_ID,
  LL_BP3_001_LIVE_START_PAY_SIX_ENERGY_GAIN_THREE_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const ACTIVATED = LL_BP3_001_ACTIVATED_SHUFFLE_NAMED_MEMBERS_ACTIVATE_ENERGY_ABILITY_ID;
const LIVE_START = LL_BP3_001_LIVE_START_PAY_SIX_ENERGY_GAIN_THREE_BLADE_ABILITY_ID;

function member(cardCode: string, id: string, name: string): ReturnType<typeof createCardInstance> {
  const data: MemberCardData = {
    cardCode,
    name,
    groupNames: ['μ’s'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, P1, id);
}

function energy(index: number): ReturnType<typeof createCardInstance> {
  const data: EnergyCardData = {
    cardCode: `ENERGY-${index}`,
    name: `Energy ${index}`,
    cardType: CardType.ENERGY,
  };
  return createCardInstance(data, P1, `energy-${index}`);
}

function setup(
  options: {
    readonly waitingNames?: readonly string[];
    readonly energyOrientations?: readonly OrientationState[];
    readonly markedEnergyIndex?: number;
  } = {}
) {
  const source = member('LL-bp3-001-R+', 'll-bp3-001-source', '園田海未&津島善子&天王寺璃奈');
  const waitingNames =
    options.waitingNames ??
    Array.from({ length: 12 }, (_, index) =>
      index === 0
        ? '園田海未&津島善子&天王寺璃奈'
        : ['園田海未', '津島善子', '天王寺璃奈'][index % 3]!
    );
  const waitingCards = waitingNames.map((name, index) =>
    member(`WAITING-${index}`, `waiting-${index}`, name)
  );
  const unrelated = member('WAITING-NOISE', 'waiting-noise', '高坂穗乃果');
  const orientations =
    options.energyOrientations ?? Array.from({ length: 7 }, () => OrientationState.WAITING);
  const energies = orientations.map((_orientation, index) => energy(index));
  let game = registerCards(createGameState('ll-bp3-001', P1, 'P1', P2, 'P2'), [
    source,
    ...waitingCards,
    unrelated,
    ...energies,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [...waitingCards.map((card) => card.instanceId), unrelated.instanceId],
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: {
      ...player.energyZone,
      cardIds: energies.map((card) => card.instanceId),
      cardStates: new Map(
        energies.map((card, index) => [
          card.instanceId,
          { orientation: orientations[index]!, face: FaceState.FACE_UP },
        ])
      ),
    },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    activePlayerIndex: 0,
    ...(options.markedEnergyIndex === undefined
      ? {}
      : {
          energyActivePhaseSkips: [
            {
              playerId: P1,
              energyCardId: energies[options.markedEnergyIndex]!.instanceId,
              sourceCardId: 'special-marker-source',
              abilityId: 'special-marker-ability',
            },
          ],
        }),
  };
  return { game, source, waitingCards, unrelated, energies };
}

function confirmCards(game: GameState, cardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    cardIds
  );
}

function confirmCurrent(game: GameState, optionId?: string): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    optionId
  );
}

function abilityUseCount(game: GameState, abilityId: string): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === abilityId &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

function withLiveStartPending(game: GameState): GameState {
  const pending: PendingAbilityState = {
    id: `${LIVE_START}:pending`,
    abilityId: LIVE_START,
    sourceCardId: 'll-bp3-001-source',
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
    sourceSlot: SlotPosition.CENTER,
  };
  return {
    ...game,
    currentPhase: GamePhase.LIVE_PHASE,
    pendingAbilities: [pending],
  };
}

describe('LL-bp3-001 Umi & Yoshiko & Rina workflows', () => {
  it('publicly confirms an unordered exact six-card cost, shuffles it to deck bottom, then activates up to six energy', () => {
    const scenario = setup();
    const selectedCardIds = scenario.waitingCards.slice(0, 6).map((card) => card.instanceId);
    const choosing = activateCardAbility(scenario.game, P1, scenario.source.instanceId, ACTIVATED);

    expect(choosing.activeEffect).toMatchObject({
      abilityId: ACTIVATED,
      stepId: 'LL_BP3_001_SELECT_NAMED_MEMBERS_TO_SHUFFLE_BOTTOM',
      selectableCardIds: scenario.waitingCards.map((card) => card.instanceId),
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 6,
      maxSelectableCards: 6,
      selectionLabel: '选择要洗牌并放置于卡组底的卡',
      confirmSelectionLabel: '洗牌并放置于卡组底',
      canSkipSelection: false,
      metadata: {
        publicCardSelectionConfirmation: { destination: 'MAIN_DECK_BOTTOM' },
      },
    });
    expect(choosing.activeEffect?.selectableCardIds).not.toContain(scenario.unrelated.instanceId);

    const publicConfirmation = confirmCards(choosing, selectedCardIds);
    expect(publicConfirmation.activeEffect).toMatchObject({
      stepId: 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION',
      revealedCardIds: selectedCardIds,
      publicCardSelectionOrdered: false,
    });
    expect(publicConfirmation.players[0].waitingRoom.cardIds).toEqual(
      choosing.players[0].waitingRoom.cardIds
    );
    expect(publicConfirmation.players[0].mainDeck.cardIds).toEqual(
      choosing.players[0].mainDeck.cardIds
    );
    expect(abilityUseCount(publicConfirmation, ACTIVATED)).toBe(0);

    const done = confirmCurrent(publicConfirmation);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).not.toEqual(
      expect.arrayContaining(selectedCardIds)
    );
    expect(done.players[0].mainDeck.cardIds.slice(-6)).toEqual(
      expect.arrayContaining(selectedCardIds)
    );
    expect(
      scenario.energies.map(
        (card) => done.players[0].energyZone.cardStates.get(card.instanceId)?.orientation
      )
    ).toEqual([
      OrientationState.ACTIVE,
      OrientationState.ACTIVE,
      OrientationState.ACTIVE,
      OrientationState.ACTIVE,
      OrientationState.ACTIVE,
      OrientationState.ACTIVE,
      OrientationState.WAITING,
    ]);
    expect(abilityUseCount(done, ACTIVATED)).toBe(1);
    expect(
      done.actionHistory.find(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === ACTIVATED
      )?.payload
    ).toMatchObject({
      costType: 'SHUFFLE_WAITING_ROOM_CARDS_TO_DECK_BOTTOM',
      selectedCardIds,
    });
    const movementEvent = done.eventLog
      .map((entry) => entry.event)
      .find(
        (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      );
    expect(movementEvent).toMatchObject({
      playerId: P1,
      movedCardIds: expect.arrayContaining(selectedCardIds),
      destination: { kind: 'SHUFFLED_BOTTOM' },
      cause: {
        kind: 'CARD_EFFECT',
        sourceCardId: scenario.source.instanceId,
        abilityId: ACTIVATED,
      },
    });
    expect(movementEvent?.movedCardIds).toHaveLength(selectedCardIds.length);
    expect(
      done.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === ACTIVATED &&
          action.payload.step === 'SHUFFLE_NAMED_MEMBERS_BOTTOM_ACTIVATE_ENERGY'
      )?.payload.activatedEnergyCardIds
    ).toEqual(scenario.energies.slice(0, 6).map((card) => card.instanceId));
    expect(activateCardAbility(done, P1, scenario.source.instanceId, ACTIVATED)).toBe(done);
  });

  it('requires six legal waiting-room members but preserves a paid cost when no waiting energy exists', () => {
    const insufficient = setup({
      waitingNames: ['園田海未', '津島善子', '天王寺璃奈', '園田海未', '津島善子'],
      energyOrientations: [],
    });
    expect(
      activateCardAbility(insufficient.game, P1, insufficient.source.instanceId, ACTIVATED)
    ).toBe(insufficient.game);

    const exact = setup({
      waitingNames: ['園田海未', '津島善子', '天王寺璃奈', '園田海未', '津島善子', '天王寺璃奈'],
      energyOrientations: [],
    });
    const selectedCardIds = exact.waitingCards.map((card) => card.instanceId);
    const publicConfirmation = confirmCards(
      activateCardAbility(exact.game, P1, exact.source.instanceId, ACTIVATED),
      selectedCardIds
    );
    const done = confirmCurrent(publicConfirmation);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).not.toEqual(
      expect.arrayContaining(selectedCardIds)
    );
    expect(
      done.actionHistory.find(
        (action) => action.payload.step === 'SHUFFLE_NAMED_MEMBERS_BOTTOM_ACTIVATE_ENERGY'
      )?.payload.activatedEnergyCardIds
    ).toEqual([]);
    expect(abilityUseCount(done, ACTIVATED)).toBe(1);
  });

  it('rejects duplicate, forged, and stale named-member cost selections without payment or turn use', () => {
    const scenario = setup({
      waitingNames: ['園田海未', '津島善子', '天王寺璃奈', '園田海未', '津島善子', '天王寺璃奈'],
    });
    const choosing = activateCardAbility(scenario.game, P1, scenario.source.instanceId, ACTIVATED);
    const ids = scenario.waitingCards.map((card) => card.instanceId);
    const duplicate = confirmCards(choosing, [ids[0]!, ids[0]!, ...ids.slice(1, 5)]);
    expect(duplicate).toBe(choosing);
    const forged = confirmCards(choosing, [...ids.slice(0, 5), 'forged-card']);
    expect(forged).toBe(choosing);

    const publicConfirmation = confirmCards(choosing, ids);
    const stale = updatePlayer(publicConfirmation, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== ids[0]),
      },
    }));
    const done = confirmCurrent(stale);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].mainDeck.cardIds).not.toEqual(expect.arrayContaining(ids.slice(1)));
    expect(abilityUseCount(done, ACTIVATED)).toBe(0);
    expect(
      done.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === ACTIVATED
      )
    ).toBe(false);
  });

  it('uses the shared exact energy-selection continuation without half-committing the six-card cost', () => {
    const scenario = setup({
      waitingNames: ['園田海未', '津島善子', '天王寺璃奈', '園田海未', '津島善子', '天王寺璃奈'],
      markedEnergyIndex: 6,
    });
    const selectedCardIds = scenario.waitingCards.map((card) => card.instanceId);
    const publicConfirmation = confirmCards(
      activateCardAbility(scenario.game, P1, scenario.source.instanceId, ACTIVATED),
      selectedCardIds
    );
    const energySelection = confirmCurrent(publicConfirmation);
    expect(energySelection.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择要变为活跃状态的待机能量。',
      selectionLabel: '选择要变为活跃的能量',
      confirmSelectionLabel: '变为活跃',
      minSelectableCards: 6,
      maxSelectableCards: 6,
    });
    expect(energySelection.players[0].waitingRoom.cardIds).toEqual(
      scenario.game.players[0].waitingRoom.cardIds
    );
    expect(abilityUseCount(energySelection, ACTIVATED)).toBe(0);

    const duplicate = confirmCards(energySelection, [
      scenario.energies[0]!.instanceId,
      scenario.energies[0]!.instanceId,
      ...scenario.energies.slice(1, 5).map((card) => card.instanceId),
    ]);
    expect(duplicate.activeEffect).toEqual(energySelection.activeEffect);
    const forged = confirmCards(energySelection, [
      ...scenario.energies.slice(0, 5).map((card) => card.instanceId),
      'forged-energy',
    ]);
    expect(forged.activeEffect).toEqual(energySelection.activeEffect);

    const chosenEnergyCardIds = scenario.energies.slice(1).map((card) => card.instanceId);
    const done = confirmCards(energySelection, chosenEnergyCardIds);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].waitingRoom.cardIds).not.toEqual(
      expect.arrayContaining(selectedCardIds)
    );
    expect(abilityUseCount(done, ACTIVATED)).toBe(1);
    expect(
      done.actionHistory.find(
        (action) => action.payload.step === 'SHUFFLE_NAMED_MEMBERS_BOTTOM_ACTIVATE_ENERGY'
      )?.payload.activatedEnergyCardIds
    ).toEqual(chosenEnergyCardIds);
    expect(
      done.players[0].energyZone.cardStates.get(scenario.energies[0]!.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('pays six active energy in the shared LIVE-start family and gives the source member Blade +3', () => {
    const scenario = setup({
      waitingNames: [],
      energyOrientations: Array.from({ length: 7 }, () => OrientationState.ACTIVE),
      markedEnergyIndex: 6,
    });
    const choosing = resolvePendingCardEffects(withLiveStartPending(scenario.game)).gameState;
    expect(choosing.activeEffect).toMatchObject({
      abilityId: LIVE_START,
      stepId: 'LL_BP3_001_LIVE_START_PAY_ENERGY',
      effectText:
        '【LIVE开始时】可以支付[E][E][E][E][E][E]：LIVE结束时为止，获得[ブレード][ブレード][ブレード]。',
      selectableOptions: [{ id: 'pay', label: '支付[E][E][E][E][E][E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    const energySelection = confirmCurrent(choosing, 'pay');
    expect(energySelection.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E][E][E][E][E][E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      minSelectableCards: 6,
      maxSelectableCards: 6,
    });
    const paidEnergyCardIds = scenario.energies.slice(1).map((card) => card.instanceId);
    const done = confirmCards(energySelection, paidEnergyCardIds);
    expect(done.activeEffect).toBeNull();
    expect(done.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      target: 'SOURCE_MEMBER',
      playerId: P1,
      countDelta: 3,
      sourceCardId: scenario.source.instanceId,
      abilityId: LIVE_START,
    });
    expect(
      done.actionHistory.find(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === LIVE_START
      )?.payload.energyCardIds
    ).toEqual(paidEnergyCardIds);
    expect(
      done.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === LIVE_START &&
          action.payload.step === 'PAY_ENERGY_GAIN_BLADE'
      )?.payload
    ).toMatchObject({ paidEnergyCardIds, bladeBonus: 3 });
  });

  it('offers only decline when the LIVE-start fixed cost cannot be paid', () => {
    const scenario = setup({
      waitingNames: [],
      energyOrientations: Array.from({ length: 5 }, () => OrientationState.ACTIVE),
    });
    const choosing = resolvePendingCardEffects(withLiveStartPending(scenario.game)).gameState;
    expect(choosing.activeEffect?.selectableOptions).toEqual([]);
    expect(choosing.activeEffect?.stepText).toContain('可以不发动');
    const done = confirmCurrent(choosing);
    expect(done.activeEffect).toBeNull();
    expect(done.liveResolution.liveModifiers).toEqual([]);
    expect(
      done.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === LIVE_START
      )
    ).toBe(false);
  });
});
