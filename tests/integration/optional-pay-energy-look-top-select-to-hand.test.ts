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
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP1_012_ON_ENTER_PAY_ENERGY_LOOK_TOP_THREE_SELECT_ONE_ABILITY_ID,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const FAMILY_CODES = ['PL!SP-bp1-012-N', 'PL!SP-sd1-008-SD', 'PL!SP-sd1-017-SD'] as const;

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function setup(
  options: {
    readonly sourceCode?: (typeof FAMILY_CODES)[number];
    readonly activeEnergyCount?: number;
    readonly waitingEnergyCount?: number;
    readonly mainDeckCount?: number;
    readonly waitingRoomCount?: number;
    readonly markSpecialEnergy?: boolean;
  } = {}
) {
  const source = createCardInstance(member(options.sourceCode ?? FAMILY_CODES[0]), P1, 'source');
  const activeEnergies = Array.from({ length: options.activeEnergyCount ?? 1 }, (_, index) =>
    createCardInstance(energy(`ACTIVE-${index}`), P1, `active-energy-${index}`)
  );
  const waitingEnergies = Array.from({ length: options.waitingEnergyCount ?? 0 }, (_, index) =>
    createCardInstance(energy(`WAITING-${index}`), P1, `waiting-energy-${index}`)
  );
  const mainCards = Array.from({ length: options.mainDeckCount ?? 3 }, (_, index) =>
    createCardInstance(member(`MAIN-${index}`), P1, `main-${index}`)
  );
  const waitingCards = Array.from({ length: options.waitingRoomCount ?? 0 }, (_, index) =>
    createCardInstance(member(`REFRESH-${index}`), P1, `refresh-${index}`)
  );
  let game = registerCards(createGameState('sp-bp1-012-family', P1, 'P1', P2, 'P2'), [
    source,
    ...activeEnergies,
    ...waitingEnergies,
    ...mainCards,
    ...waitingCards,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: mainCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), {
      ...player.mainDeck,
      cardIds: [],
    }),
    waitingRoom: waitingCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), {
      ...player.waitingRoom,
      cardIds: [],
    }),
    energyZone: [...activeEnergies, ...waitingEnergies].reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation:
            index < activeEnergies.length ? OrientationState.ACTIVE : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      { ...player.energyZone, cardIds: [], cardStates: new Map() }
    ),
  }));
  if (options.markSpecialEnergy && activeEnergies[1]) {
    game = {
      ...game,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: activeEnergies[1].instanceId,
          sourceCardId: 'special-marker',
          abilityId: 'special-marker',
        },
      ],
    };
  }
  const pending: PendingAbilityState = {
    id: 'pending-012',
    abilityId: SP_BP1_012_ON_ENTER_PAY_ENERGY_LOOK_TOP_THREE_SELECT_ONE_ABILITY_ID,
    sourceCardId: source.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-event'],
  };
  return {
    game: { ...game, pendingAbilities: [pending] },
    source,
    activeEnergies,
    waitingEnergies,
    mainCards,
    waitingCards,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function pay(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    'pay'
  );
}

describe('optional pay-energy look-top-select-to-hand shared family', () => {
  for (const sourceCode of FAMILY_CODES) {
    it(`keeps ${sourceCode} on the identical shared behavior`, () => {
      const scenario = setup({ sourceCode });
      const selecting = pay(start(scenario.game));
      expect(selecting.activeEffect).toMatchObject({
        abilityId: SP_BP1_012_ON_ENTER_PAY_ENERGY_LOOK_TOP_THREE_SELECT_ONE_ABILITY_ID,
        inspectionCardIds: scenario.mainCards.map((card) => card.instanceId),
        selectableCardIds: scenario.mainCards.map((card) => card.instanceId),
        selectionLabel: '选择要加入手牌的卡',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
      });
      const selectedCardId = scenario.mainCards[1]!.instanceId;
      const done = confirmActiveEffectStep(
        selecting,
        P1,
        selecting.activeEffect!.id,
        selectedCardId
      );
      expect(done.players[0].hand.cardIds).toEqual([selectedCardId]);
      expect(done.players[0].waitingRoom.cardIds).toEqual(
        scenario.mainCards
          .map((card) => card.instanceId)
          .filter((cardId) => cardId !== selectedCardId)
      );
    });
  }

  it('offers pay [E] and decline, records the actual energy id, and does not pay on decline', () => {
    const scenario = setup();
    const started = start(scenario.game);
    expect(started.activeEffect).toMatchObject({
      stepText: '可以支付[E]，检视自己卡组顶的3张卡。',
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    const declined = confirmActiveEffectStep(started, P1, started.activeEffect!.id, null);
    expect(declined.activeEffect).toBeNull();
    expect(
      declined.players[0].energyZone.cardStates.get(scenario.activeEnergies[0]!.instanceId)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(declined.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);

    const paid = pay(start(setup().game));
    expect(paid.actionHistory.find((action) => action.type === 'PAY_COST')?.payload).toMatchObject({
      energyCardIds: ['active-energy-0'],
      amount: 1,
    });
  });

  it('shows only decline with no ACTIVE energy and rejects a forged pay option without changes', () => {
    const scenario = setup({ activeEnergyCount: 0, waitingEnergyCount: 1 });
    const started = start(scenario.game);
    expect(started.activeEffect).toMatchObject({
      stepText: '当前活跃能量不足，无法支付[E]，可以不发动。',
      selectableOptions: [],
      skipSelectionLabel: '不发动',
    });
    const forged = pay(started);
    expect(forged).toEqual(started);
  });

  it('uses the common exact special-energy payment selection and pays only once', () => {
    const scenario = setup({ activeEnergyCount: 2, markSpecialEnergy: true });
    const started = start(scenario.game);
    const choosingEnergy = pay(started);
    expect(choosingEnergy.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E]的活跃能量卡。',
      selectableCardIds: ['active-energy-0', 'active-energy-1'],
      minSelectableCards: 1,
      maxSelectableCards: 1,
      confirmSelectionLabel: '支付费用',
    });
    const selectingCard = confirmActiveEffectStep(
      choosingEnergy,
      P1,
      choosingEnergy.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ['active-energy-1']
    );
    expect(selectingCard.players[0].energyZone.cardStates.get('active-energy-1')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(selectingCard.actionHistory.filter((action) => action.type === 'PAY_COST')).toHaveLength(
      1
    );
    const duplicate = confirmActiveEffectStep(
      selectingCard,
      P1,
      selectingCard.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'pay'
    );
    expect(duplicate).toEqual(selectingCard);
  });

  it.each([0, 1, 2, 3])('handles an actual deck size of %i after payment', (mainDeckCount) => {
    const scenario = setup({ mainDeckCount });
    const result = pay(start(scenario.game));
    if (mainDeckCount === 0) {
      expect(result.activeEffect).toBeNull();
      expect(result.inspectionZone.cardIds).toEqual([]);
      return;
    }
    expect(result.activeEffect?.inspectionCardIds).toEqual(
      scenario.mainCards.map((card) => card.instanceId)
    );
    expect(result.activeEffect?.minSelectableCards).toBeUndefined();
    expect(result.activeEffect?.canSkipSelection).toBe(false);
  });

  it('keeps refresh semantics and selects exactly one from the actual inspected cards', () => {
    const scenario = setup({ mainDeckCount: 1, waitingRoomCount: 2 });
    const selecting = pay(start(scenario.game));
    expect(selecting.activeEffect?.inspectionCardIds).toHaveLength(3);
    expect(selecting.activeEffect?.selectableCardIds).toHaveLength(3);
    expect(selecting.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('rejects zero, forged, duplicate, non-inspected, and stale selections without moving cards', () => {
    const scenario = setup();
    let selecting = pay(start(scenario.game));
    const effectId = selecting.activeEffect!.id;
    for (const invalidIds of [
      [],
      ['forged'],
      [scenario.mainCards[0]!.instanceId, scenario.mainCards[0]!.instanceId],
      [scenario.source.instanceId],
    ]) {
      const invalid = confirmActiveEffectStep(
        selecting,
        P1,
        effectId,
        invalidIds[0] ?? null,
        undefined,
        undefined,
        undefined,
        invalidIds
      );
      expect(invalid).toEqual(selecting);
    }
    const staleId = scenario.mainCards[0]!.instanceId;
    selecting = {
      ...selecting,
      inspectionZone: {
        ...selecting.inspectionZone,
        cardIds: selecting.inspectionZone.cardIds.filter((cardId) => cardId !== staleId),
      },
    };
    expect(confirmActiveEffectStep(selecting, P1, effectId, staleId)).toEqual(selecting);
  });

  it('keeps the selected card private and emits one grouped MAIN_DECK to WAITING_ROOM event', () => {
    const scenario = setup();
    const selecting = pay(start(scenario.game));
    const selectedCardId = scenario.mainCards[0]!.instanceId;
    const opponentView = projectPlayerViewState(selecting, P2);
    expect(opponentView.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(opponentView.objects[createPublicObjectId(selectedCardId)]?.surface).toBe('BACK');
    expect(selecting.activeEffect?.metadata?.publicCardSelectionConfirmation).toBeUndefined();

    const done = confirmActiveEffectStep(selecting, P1, selecting.activeEffect!.id, selectedCardId);
    expect(done.inspectionZone.revealedCardIds).toEqual([]);
    expect(
      done.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            event.fromZone === ZoneType.MAIN_DECK &&
            event.toZone === ZoneType.WAITING_ROOM
        )
    ).toMatchObject({
      cardInstanceIds: scenario.mainCards.slice(1).map((card) => card.instanceId),
    });
  });

  it('uses existing ON_ENTER semantics when the source has left after queueing', () => {
    const scenario = setup();
    const staged = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        scenario.source.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    const sourceLeftAfterQueue = updatePlayer(staged, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(
      sourceLeftAfterQueue.players[0].memberSlots.cardStates.has(scenario.source.instanceId)
    ).toBe(false);
    const selecting = pay(start(sourceLeftAfterQueue));
    expect(selecting.activeEffect?.inspectionCardIds).toHaveLength(3);
    expect(
      selecting.players[0].energyZone.cardStates.get(scenario.activeEnergies[0]!.instanceId)
        ?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('schedules pending created by the grouped remainder only after this ability finishes', () => {
    const scenario = setup();
    const watcher = createCardInstance(member('PL!SP-bp5-005-P'), P1, 'waiting-room-watcher');
    let game = registerCards(scenario.game, [watcher]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, watcher.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.MAIN_FREE,
    };
    const selecting = pay(start(game));
    expect(
      selecting.pendingAbilities.some(
        (ability) =>
          ability.abilityId ===
          SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(false);
    const done = confirmActiveEffectStep(
      selecting,
      P1,
      selecting.activeEffect!.id,
      scenario.mainCards[0]!.instanceId
    );
    expect(
      done.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(true);
    const currentFinishIndex = done.actionHistory.findIndex(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_BP1_012_ON_ENTER_PAY_ENERGY_LOOK_TOP_THREE_SELECT_ONE_ABILITY_ID &&
        action.payload.step === 'SELECT_ONE_TO_HAND_REST_TO_WAITING_ROOM'
    );
    const watcherResolutionIndex = done.actionHistory.findIndex(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
    );
    expect(currentFinishIndex).toBeGreaterThanOrEqual(0);
    expect(watcherResolutionIndex).toBeGreaterThan(currentFinishIndex);
  });
});
