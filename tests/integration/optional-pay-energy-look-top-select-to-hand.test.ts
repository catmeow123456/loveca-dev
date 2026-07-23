import { describe, expect, it } from 'vitest';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
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
  SP_SD1_009_ON_ENTER_PAY_ONE_ENERGY_NINE_LOOK_TOP_FIVE_ABILITY_ID,
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
    readonly sourceCode?: string;
    readonly abilityId?: string;
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
    abilityId:
      options.abilityId ?? SP_BP1_012_ON_ENTER_PAY_ENERGY_LOOK_TOP_THREE_SELECT_ONE_ABILITY_ID,
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

describe('PL!SP-sd1-009-SD 费用13「鬼塚夏美」', () => {
  const setup009 = (options: Parameters<typeof setup>[0] = {}) =>
    setup({
      sourceCode: 'PL!SP-sd1-009-SD',
      abilityId: SP_SD1_009_ON_ENTER_PAY_ONE_ENERGY_NINE_LOOK_TOP_FIVE_ABILITY_ID,
      activeEnergyCount: 1,
      waitingEnergyCount: 8,
      mainDeckCount: 5,
      ...options,
    });

  it('uses real PLAY_MEMBER -> ON_ENTER_STAGE with exact source instance, slot, timing, and ability id', () => {
    const session = createGameSession();
    session.createGame('sp-sd1-009-real-play', P1, 'P1', P2, 'P2');
    const scenario = setup009();
    const game = updatePlayer({ ...scenario.game, pendingAbilities: [] }, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [scenario.source.instanceId] },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...game,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    };

    session.setManualOperationMode('FREE');
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(P1, scenario.source.instanceId, SlotPosition.RIGHT, {
        freePlay: true,
      })
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: SP_SD1_009_ON_ENTER_PAY_ONE_ENERGY_NINE_LOOK_TOP_FIVE_ABILITY_ID,
      sourceCardId: scenario.source.instanceId,
      stepId: 'SP_SD1_009_OPTIONAL_PAY_ENERGY',
    });
    expect(
      session.state!.actionHistory.find(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            SP_SD1_009_ON_ENTER_PAY_ONE_ENERGY_NINE_LOOK_TOP_FIVE_ABILITY_ID
      )?.payload
    ).toMatchObject({
      abilityId: SP_SD1_009_ON_ENTER_PAY_ONE_ENERGY_NINE_LOOK_TOP_FIVE_ABILITY_ID,
      sourceCardId: scenario.source.instanceId,
      sourceSlot: SlotPosition.RIGHT,
      timingId: TriggerCondition.ON_ENTER_STAGE,
    });
  });

  it('offers the exact payment copy, allows decline, and keeps the deck untouched', () => {
    const scenario = setup009();
    const started = start(scenario.game);
    expect(started.activeEffect).toMatchObject({
      stepText: '可以支付[E]。支付后自己的能量大于等于9张时，检视自己卡组顶的5张卡。',
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      skipSelectionLabel: '不发动',
    });
    const declined = confirmActiveEffectStep(started, P1, started.activeEffect!.id, null);
    expect(declined.players[0].mainDeck.cardIds).toEqual(
      scenario.mainCards.map((card) => card.instanceId)
    );
    expect(declined.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('shows only decline with no ACTIVE energy', () => {
    const scenario = setup009({ activeEnergyCount: 0, waitingEnergyCount: 9 });
    const started = start(scenario.game);
    expect(started.activeEffect).toMatchObject({
      stepText: '当前活跃能量不足，无法支付[E]，可以不发动。',
      selectableOptions: [],
      skipSelectionLabel: '不发动',
    });
    expect(pay(started)).toEqual(started);
  });

  it('allows payment below nine, keeps the paid cost, and ends without inspection', () => {
    const scenario = setup009({ activeEnergyCount: 1, waitingEnergyCount: 7 });
    const done = pay(start(scenario.game));
    expect(done.activeEffect).toBeNull();
    expect(done.inspectionZone.cardIds).toEqual([]);
    expect(done.players[0].mainDeck.cardIds).toEqual(
      scenario.mainCards.map((card) => card.instanceId)
    );
    expect(done.players[0].energyZone.cardStates.get('active-energy-0')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(done.actionHistory.find((action) => action.type === 'PAY_COST')?.payload).toMatchObject({
      energyCardIds: ['active-energy-0'],
      amount: 1,
    });
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'ENERGY_COUNT_CONDITION_NOT_MET',
      energyCount: 8,
      requiredEnergyCount: 9,
    });
  });

  it('counts ACTIVE, WAITING, and marker-bearing energy cards toward nine and inspects top five', () => {
    const scenario = setup009({
      activeEnergyCount: 2,
      waitingEnergyCount: 7,
      markSpecialEnergy: true,
    });
    const choosingEnergy = pay(start(scenario.game));
    const selecting = confirmActiveEffectStep(
      choosingEnergy,
      P1,
      choosingEnergy.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ['active-energy-1']
    );
    expect(selecting.activeEffect).toMatchObject({
      stepId: 'SP_SD1_009_SELECT_ONE_FROM_TOP_FIVE',
      inspectionCardIds: scenario.mainCards.map((card) => card.instanceId),
      selectableCardIds: scenario.mainCards.map((card) => card.instanceId),
      stepText: '请选择1张检视到的卡加入手牌，其余卡片放置入休息室。',
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
    });
    expect(
      selecting.actionHistory.find((action) => action.type === 'PAY_COST')?.payload
    ).toMatchObject({
      energyCardIds: ['active-energy-1'],
    });
  });

  it('preserves the special-energy window atomically on stale selection, then accepts a legal choice', () => {
    const scenario = setup009({
      activeEnergyCount: 2,
      waitingEnergyCount: 7,
      markSpecialEnergy: true,
    });
    let choosingEnergy = pay(start(scenario.game));
    choosingEnergy = updatePlayer(choosingEnergy, P1, (player) => {
      const cardStates = new Map(player.energyZone.cardStates);
      cardStates.set('active-energy-1', {
        ...cardStates.get('active-energy-1')!,
        orientation: OrientationState.WAITING,
      });
      return { ...player, energyZone: { ...player.energyZone, cardStates } };
    });
    const stale = confirmActiveEffectStep(
      choosingEnergy,
      P1,
      choosingEnergy.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ['active-energy-1']
    );
    expect(stale).toEqual(choosingEnergy);
    expect(stale.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(stale.inspectionZone.cardIds).toEqual([]);
    expect(stale.players[0].mainDeck.cardIds).toEqual(
      scenario.mainCards.map((card) => card.instanceId)
    );

    const selecting = confirmActiveEffectStep(
      stale,
      P1,
      stale.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ['active-energy-0']
    );
    expect(selecting.activeEffect?.stepId).toBe('SP_SD1_009_SELECT_ONE_FROM_TOP_FIVE');
  });

  it('rechecks the current energy count after a paused special payment resumes', () => {
    const scenario = setup009({
      activeEnergyCount: 2,
      waitingEnergyCount: 7,
      markSpecialEnergy: true,
    });
    let choosingEnergy = pay(start(scenario.game));
    choosingEnergy = updatePlayer(choosingEnergy, P1, (player) => {
      const cardStates = new Map(player.energyZone.cardStates);
      cardStates.delete('waiting-energy-0');
      return {
        ...player,
        energyZone: {
          ...player.energyZone,
          cardIds: player.energyZone.cardIds.filter((cardId) => cardId !== 'waiting-energy-0'),
          cardStates,
        },
      };
    });
    const done = confirmActiveEffectStep(
      choosingEnergy,
      P1,
      choosingEnergy.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ['active-energy-1']
    );
    expect(done.activeEffect).toBeNull();
    expect(done.inspectionZone.cardIds).toEqual([]);
    expect(done.actionHistory.find((action) => action.type === 'PAY_COST')?.payload).toMatchObject({
      energyCardIds: ['active-energy-1'],
    });
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'ENERGY_COUNT_CONDITION_NOT_MET',
      energyCount: 8,
    });
  });

  it.each([0, 1, 2, 3, 4, 5])(
    'handles an actual deck size of %i after payment',
    (mainDeckCount) => {
      const scenario = setup009({ mainDeckCount });
      const result = pay(start(scenario.game));
      if (mainDeckCount === 0) {
        expect(result.activeEffect).toBeNull();
        expect(result.inspectionZone.cardIds).toEqual([]);
        return;
      }
      expect(result.activeEffect?.inspectionCardIds).toEqual(
        scenario.mainCards.map((card) => card.instanceId)
      );
      expect(result.activeEffect?.canSkipSelection).toBe(false);
    }
  );

  it('refreshes to five, atomically rejects invalid picks, keeps candidates private, and groups remainder', () => {
    const scenario = setup009({ mainDeckCount: 1, waitingRoomCount: 4 });
    let selecting = pay(start(scenario.game));
    expect(selecting.activeEffect?.inspectionCardIds).toHaveLength(5);
    expect(projectPlayerViewState(selecting, P2).activeEffect?.selectableObjectIds).toBeUndefined();
    expect(
      projectPlayerViewState(selecting, P2).objects[
        createPublicObjectId(selecting.activeEffect!.inspectionCardIds![0]!)
      ]?.surface
    ).toBe('BACK');
    const effectId = selecting.activeEffect!.id;
    const inspected = selecting.activeEffect!.inspectionCardIds!;
    for (const invalidIds of [
      [],
      [inspected[0]!, inspected[1]!],
      [inspected[0]!, inspected[0]!],
      ['forged'],
      [scenario.source.instanceId],
    ]) {
      expect(
        confirmActiveEffectStep(
          selecting,
          P1,
          effectId,
          invalidIds[0] ?? null,
          undefined,
          undefined,
          undefined,
          invalidIds
        )
      ).toEqual(selecting);
    }
    const staleId = inspected[0]!;
    const staleState = {
      ...selecting,
      inspectionZone: {
        ...selecting.inspectionZone,
        cardIds: selecting.inspectionZone.cardIds.filter((cardId) => cardId !== staleId),
      },
    };
    expect(confirmActiveEffectStep(staleState, P1, effectId, staleId)).toEqual(staleState);

    const selectedId = inspected[1]!;
    const done = confirmActiveEffectStep(selecting, P1, effectId, selectedId);
    expect(done.players[0].hand.cardIds).toContain(selectedId);
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
      cardInstanceIds: inspected.filter((cardId) => cardId !== selectedId),
    });
  });

  it('resolves after the queued source has left the stage', () => {
    const scenario = setup009();
    const staged = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        scenario.source.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    const sourceLeft = updatePlayer(staged, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    expect(pay(start(sourceLeft)).activeEffect?.inspectionCardIds).toHaveLength(5);
  });

  it('does not let grouped-remainder pending preempt or disappear before 009 finishes', () => {
    const scenario = setup009();
    const watcher = createCardInstance(member('PL!SP-bp5-005-P'), P1, '009-watcher');
    let game = registerCards(scenario.game, [watcher]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, watcher.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = { ...game, currentPhase: GamePhase.MAIN_PHASE, currentSubPhase: SubPhase.MAIN_FREE };
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
    const currentFinishIndex = done.actionHistory.findIndex(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_SD1_009_ON_ENTER_PAY_ONE_ENERGY_NINE_LOOK_TOP_FIVE_ABILITY_ID &&
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
