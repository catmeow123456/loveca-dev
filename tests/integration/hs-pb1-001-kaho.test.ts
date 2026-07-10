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
import {
  addCardToStatefulZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_001_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY_ACTIVATE_TWO_ABILITY_ID,
  HS_PB1_001_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import type { PendingAbilityState } from '../../src/domain/entities/game';
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

function createMember(
  cardCode: string,
  name = cardCode,
  unitName = 'Cerise Bouquet'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function pending(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [],
    sourceSlot: SlotPosition.CENTER,
  };
}

function putStageAndEnergy(
  game: GameState,
  options: {
    readonly sourceId: string;
    readonly enteredId?: string;
    readonly activeEnergyIds?: readonly string[];
    readonly waitingEnergyIds?: readonly string[];
  }
): GameState {
  return updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      options.sourceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    );
    if (options.enteredId) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, options.enteredId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    const activeEnergyIds = options.activeEnergyIds ?? [];
    const waitingEnergyIds = options.waitingEnergyIds ?? [];
    const energyZone = [...activeEnergyIds, ...waitingEnergyIds].reduce(
      (zone, cardId) =>
        addCardToStatefulZone(zone, cardId, {
          orientation: activeEnergyIds.includes(cardId)
            ? OrientationState.ACTIVE
            : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      { ...player.energyZone, cardIds: [], cardStates: new Map() }
    );

    return {
      ...player,
      memberSlots,
      energyZone,
    };
  });
}

function setupKaho(options: {
  readonly enteredCardCode?: string;
  readonly enteredUnitName?: string;
  readonly activeEnergyCount?: number;
  readonly waitingEnergyCount?: number;
}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly enteredId: string;
  readonly activeEnergyIds: readonly string[];
  readonly waitingEnergyIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!HS-pb1-001-R', '日野下花帆'),
    PLAYER1,
    'pb1-001-kaho'
  );
  const entered = createCardInstance(
    createMember(
      options.enteredCardCode ?? 'PL!HS-test-other-cerise',
      'Other Cerise',
      options.enteredUnitName
    ),
    PLAYER1,
    'pb1-001-entered'
  );
  const activeEnergy = Array.from({ length: options.activeEnergyCount ?? 1 }, (_, index) =>
    createCardInstance(createMember(`PL!HS-test-active-energy-${index}`), PLAYER1, `active-${index}`)
  );
  const waitingEnergy = Array.from({ length: options.waitingEnergyCount ?? 1 }, (_, index) =>
    createCardInstance(
      createMember(`PL!HS-test-waiting-energy-${index}`),
      PLAYER1,
      `waiting-${index}`
    )
  );
  let game = registerCards(
    createGameState('hs-pb1-001-kaho', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, entered, ...activeEnergy, ...waitingEnergy]
  );
  game = putStageAndEnergy(game, {
    sourceId: source.instanceId,
    enteredId: entered.instanceId,
    activeEnergyIds: activeEnergy.map((card) => card.instanceId),
    waitingEnergyIds: waitingEnergy.map((card) => card.instanceId),
  });

  return {
    game,
    sourceId: source.instanceId,
    enteredId: entered.instanceId,
    activeEnergyIds: activeEnergy.map((card) => card.instanceId),
    waitingEnergyIds: waitingEnergy.map((card) => card.instanceId),
  };
}

function chooseOption(game: GameState, selectedOptionId: string | null): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    false,
    selectedOptionId
  );
}

function enqueueOtherCeriseEnter(game: GameState, enteredId: string): GameState {
  return enqueueTriggeredCardEffects(
    emitGameEvent(
      game,
      createEnterStageEvent(enteredId, ZoneType.HAND, SlotPosition.LEFT, PLAYER1, PLAYER1)
    ),
    [TriggerCondition.ON_ENTER_STAGE]
  );
}

function autoAbilityUseActions(game: GameState) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.step === 'ABILITY_USE' &&
      action.payload.abilityId ===
        HS_PB1_001_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY_ACTIVATE_TWO_ABILITY_ID
  );
}

function autoTriggerActionCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'TRIGGER_ABILITY' &&
      action.payload.abilityId ===
        HS_PB1_001_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY_ACTIVATE_TWO_ABILITY_ID
  ).length;
}

describe('PL!HS-pb1-001-R/P+ Hino Kaho workflow', () => {
  it('opens only for another own Cerise Bouquet enter-stage event, then pays energy and activates two energy', () => {
    const scenario = setupKaho({ activeEnergyCount: 1, waitingEnergyCount: 1 });
    const queued = enqueueOtherCeriseEnter(scenario.game, scenario.enteredId);

    expect(queued.pendingAbilities).toHaveLength(1);
    expect(queued.pendingAbilities[0]?.abilityId).toBe(
      HS_PB1_001_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY_ACTIVATE_TWO_ABILITY_ID
    );

    const started = resolvePendingCardEffects(queued).gameState;
    expect(started.activeEffect).toMatchObject({
      abilityId: HS_PB1_001_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY_ACTIVATE_TWO_ABILITY_ID,
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    const resolved = chooseOption(started, 'pay');

    for (const cardId of [...scenario.activeEnergyIds, ...scenario.waitingEnergyIds]) {
      expect(resolved.players[0]!.energyZone.cardStates.get(cardId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
    expect(resolved.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(true);
    expect(autoAbilityUseActions(resolved)).toContainEqual(
      expect.objectContaining({
        playerId: PLAYER1,
        payload: expect.objectContaining({
          step: 'ABILITY_USE',
          abilityId: HS_PB1_001_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY_ACTIVATE_TWO_ABILITY_ID,
          sourceCardId: scenario.sourceId,
          turnCount: resolved.turnCount,
        }),
      })
    );
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: HS_PB1_001_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY_ACTIVATE_TWO_ABILITY_ID,
      step: 'PAY_ENERGY_ACTIVATE_TWO',
      activatedEnergyCardIds: [...scenario.activeEnergyIds, ...scenario.waitingEnergyIds],
    });
  });

  it('queues only the already-on-stage Kaho when another Kaho enters', () => {
    const scenario = setupKaho({
      enteredCardCode: 'PL!HS-pb1-001-P＋',
      activeEnergyCount: 1,
      waitingEnergyCount: 1,
    });

    const queued = enqueueOtherCeriseEnter(scenario.game, scenario.enteredId);

    expect(queued.pendingAbilities).toHaveLength(1);
    expect(queued.pendingAbilities[0]).toMatchObject({
      abilityId: HS_PB1_001_AUTO_OTHER_CERISE_ENTER_PAY_ENERGY_ACTIVATE_TWO_ABILITY_ID,
      sourceCardId: scenario.sourceId,
    });
    expect(queued.pendingAbilities[0]?.sourceCardId).not.toBe(scenario.enteredId);
  });

  it('consumes the auto pending without a payment window for self, non-Cerise, or no active energy', () => {
    const selfEventScenario = setupKaho({ activeEnergyCount: 1 });
    const selfEventGame = emitGameEvent(
      selfEventScenario.game,
      createEnterStageEvent(
        selfEventScenario.sourceId,
        ZoneType.HAND,
        SlotPosition.CENTER,
        PLAYER1,
        PLAYER1
      )
    );
    expect(
      resolvePendingCardEffects(
        enqueueTriggeredCardEffects(selfEventGame, [TriggerCondition.ON_ENTER_STAGE])
      ).gameState.activeEffect
    ).toBeNull();

    const nonCerise = setupKaho({ enteredUnitName: 'DOLLCHESTRA', activeEnergyCount: 1 });
    const nonCeriseEventGame = emitGameEvent(
      nonCerise.game,
      createEnterStageEvent(nonCerise.enteredId, ZoneType.HAND, SlotPosition.LEFT, PLAYER1, PLAYER1)
    );
    expect(
      resolvePendingCardEffects(
        enqueueTriggeredCardEffects(nonCeriseEventGame, [TriggerCondition.ON_ENTER_STAGE])
      ).gameState.activeEffect
    ).toBeNull();

    const noEnergy = setupKaho({ activeEnergyCount: 0 });
    const noEnergyEventGame = emitGameEvent(
      noEnergy.game,
      createEnterStageEvent(noEnergy.enteredId, ZoneType.HAND, SlotPosition.LEFT, PLAYER1, PLAYER1)
    );
    expect(
      resolvePendingCardEffects(
        enqueueTriggeredCardEffects(noEnergyEventGame, [TriggerCondition.ON_ENTER_STAGE])
      ).gameState.activeEffect
    ).toBeNull();
  });

  it('counts only paid AUTO uses toward the twice-per-turn limit', () => {
    const scenario = setupKaho({ activeEnergyCount: 1, waitingEnergyCount: 1 });

    const firstStarted = resolvePendingCardEffects(
      enqueueOtherCeriseEnter(scenario.game, scenario.enteredId)
    ).gameState;
    const afterFirstPay = chooseOption(firstStarted, 'pay');
    expect(autoAbilityUseActions(afterFirstPay)).toHaveLength(1);

    const secondQueued = enqueueOtherCeriseEnter(afterFirstPay, scenario.enteredId);
    expect(secondQueued.pendingAbilities).toHaveLength(1);
    const secondStarted = resolvePendingCardEffects(secondQueued).gameState;
    const afterSecondPay = chooseOption(secondStarted, 'pay');
    expect(autoAbilityUseActions(afterSecondPay)).toHaveLength(2);

    const triggerCountBeforeThird = autoTriggerActionCount(afterSecondPay);
    const thirdQueued = enqueueOtherCeriseEnter(afterSecondPay, scenario.enteredId);
    expect(thirdQueued.pendingAbilities).toEqual([]);
    expect(autoTriggerActionCount(thirdQueued)).toBe(triggerCountBeforeThird);
  });

  it('does not count declining the AUTO payment window as an ability use', () => {
    const scenario = setupKaho({ activeEnergyCount: 1, waitingEnergyCount: 1 });
    const started = resolvePendingCardEffects(
      enqueueOtherCeriseEnter(scenario.game, scenario.enteredId)
    ).gameState;

    const declined = chooseOption(started, null);

    expect(declined.activeEffect).toBeNull();
    expect(autoAbilityUseActions(declined)).toEqual([]);
    expect(declined.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'DECLINE_AUTO_PAY_ENERGY',
    });
  });

  it('may pay two active energy at LIVE start to give the source green Heart and BLADE', () => {
    const scenario = setupKaho({ activeEnergyCount: 2, waitingEnergyCount: 0 });
    const started = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [
        pending(
          HS_PB1_001_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
          scenario.sourceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    }).gameState;

    expect(started.activeEffect).toMatchObject({
      abilityId: HS_PB1_001_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
      selectableOptions: [{ id: 'pay', label: '支付[E][E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    const resolved = chooseOption(started, 'pay');

    for (const cardId of scenario.activeEnergyIds) {
      expect(resolved.players[0]!.energyZone.cardStates.get(cardId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: scenario.sourceId,
      abilityId: HS_PB1_001_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
    });
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: scenario.sourceId,
      abilityId: HS_PB1_001_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
      countDelta: 1,
    });
  });

  it('lets the LIVE-start payment be declined without adding modifiers', () => {
    const scenario = setupKaho({ activeEnergyCount: 2, waitingEnergyCount: 0 });
    const started = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [
        pending(
          HS_PB1_001_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_BLADE_ABILITY_ID,
          scenario.sourceId,
          TriggerCondition.ON_LIVE_START
        ),
      ],
    }).gameState;

    const declined = chooseOption(started, null);

    expect(declined.activeEffect).toBeNull();
    expect(declined.liveResolution.liveModifiers).toEqual([]);
    expect(declined.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'DECLINE_LIVE_START_PAY_TWO_ENERGY',
    });
  });
});
