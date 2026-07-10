import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP4_003_ON_ENTER_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  SP_BP4_028_LIVE_START_ACTIVE_ENERGY_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode, cost = 7): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    unitName: '5yncri5e!',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode = 'PL!SP-bp4-028-L'): LiveCardData {
  return {
    cardCode,
    name: 'DAISUKI FULL POWER',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 2 }),
  };
}

function pendingAbility(options: {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly timingId: TriggerCondition;
  readonly sourceSlot?: SlotPosition;
}): PendingAbilityState {
  return {
    id: options.id,
    abilityId: options.abilityId,
    sourceCardId: options.sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: options.timingId,
    eventIds: [`event-${options.id}`],
    sourceSlot: options.sourceSlot,
  };
}

function setupChisatoOnEnter(sourceSlot: SlotPosition): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly handIds: readonly string[];
  readonly drawIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!SP-bp4-003-P', '嵐 千砂都'),
    PLAYER1,
    'sp-bp4-003-source'
  );
  const handCards = [0, 1].map((index) =>
    createCardInstance(
      createMember(`PL!SP-bp4-003-hand-${index}`, `Hand ${index}`),
      PLAYER1,
      `sp-bp4-003-hand-${index}`
    )
  );
  const drawCards = [0, 1].map((index) =>
    createCardInstance(
      createMember(`PL!SP-bp4-003-draw-${index}`, `Draw ${index}`),
      PLAYER1,
      `sp-bp4-003-draw-${index}`
    )
  );

  let game = createGameState('sp-bp4-003-on-enter', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...handCards, ...drawCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, sourceSlot, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));

  return {
    game,
    sourceId: source.instanceId,
    handIds: handCards.map((card) => card.instanceId),
    drawIds: drawCards.map((card) => card.instanceId),
  };
}

function startChisatoOnEnter(
  game: GameState,
  sourceId: string,
  sourceSlot: SlotPosition
): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pendingAbility({
        id: 'sp-bp4-003-pending',
        abilityId: SP_BP4_003_ON_ENTER_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
        sourceCardId: sourceId,
        timingId: TriggerCondition.ON_ENTER_STAGE,
        sourceSlot,
      }),
    ],
  }).gameState;
}

function finishDiscard(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    selectedCardIds
  );
}

function setupDaisukiFullPower(options: {
  readonly activeEnergyCount: number;
  readonly waitingEnergyCount?: number;
  readonly includeSecondPending?: boolean;
}): {
  readonly game: GameState;
  readonly live: ReturnType<typeof createCardInstance>;
  readonly secondLive: ReturnType<typeof createCardInstance> | null;
} {
  const live = createCardInstance(createLive('PL!SP-bp4-028-L'), PLAYER1, 'sp-bp4-028-live');
  const secondLive = options.includeSecondPending
    ? createCardInstance(createLive('PL!SP-bp4-028-SRL'), PLAYER1, 'sp-bp4-028-live-2')
    : null;
  const energyCards = [
    ...Array.from({ length: options.activeEnergyCount }, (_, index) => ({
      orientation: OrientationState.ACTIVE,
      card: createCardInstance(
        { cardCode: `PL!SP-bp4-028-active-energy-${index}`, name: 'Energy', cardType: CardType.ENERGY },
        PLAYER1,
        `sp-bp4-028-active-energy-${index}`
      ),
    })),
    ...Array.from({ length: options.waitingEnergyCount ?? 0 }, (_, index) => ({
      orientation: OrientationState.WAITING,
      card: createCardInstance(
        { cardCode: `PL!SP-bp4-028-waiting-energy-${index}`, name: 'Energy', cardType: CardType.ENERGY },
        PLAYER1,
        `sp-bp4-028-waiting-energy-${index}`
      ),
    })),
  ];

  let game = createGameState('sp-bp4-028-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    live,
    ...(secondLive ? [secondLive] : []),
    ...energyCards.map((entry) => entry.card),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: secondLive
      ? addCardToStatefulZone(
          addCardToStatefulZone(player.liveZone, live.instanceId),
          secondLive.instanceId
        )
      : addCardToStatefulZone(player.liveZone, live.instanceId),
    energyZone: energyCards.reduce(
      (zone, entry) =>
        addCardToStatefulZone(zone, entry.card.instanceId, {
          orientation: entry.orientation,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));

  return {
    game: {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([[PLAYER1, 5]]),
        performingPlayerId: PLAYER1,
      },
    },
    live,
    secondLive,
  };
}

function resolveDaisukiPending(
  game: GameState,
  liveIds: readonly string[],
  manual = false
): GameState {
  const stateWithPending: GameState = {
    ...game,
    pendingAbilities: liveIds.map((liveId, index) =>
      pendingAbility({
        id: `sp-bp4-028-pending-${index}`,
        abilityId: SP_BP4_028_LIVE_START_ACTIVE_ENERGY_SCORE_ABILITY_ID,
        sourceCardId: liveId,
        timingId: TriggerCondition.ON_LIVE_START,
      })
    ),
  };
  const started = resolvePendingCardEffects(stateWithPending).gameState;
  if (manual) {
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    return confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
  }
  if (started.activeEffect?.canResolveInOrder === true) {
    return confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect.id,
      null,
      null,
      true
    );
  }
  return started;
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId === SP_BP4_028_LIVE_START_ACTIVE_ENERGY_SCORE_ABILITY_ID
  );
}

describe('PL!SP-bp4 first batch effects', () => {
  it.each([SlotPosition.LEFT, SlotPosition.RIGHT] as const)(
    'PL!SP-bp4-003 draws two then lets the player discard two from %s',
    (sourceSlot) => {
      const scenario = setupChisatoOnEnter(sourceSlot);
      let state = startChisatoOnEnter(scenario.game, scenario.sourceId, sourceSlot);

      expect(state.activeEffect).toMatchObject({
        abilityId: SP_BP4_003_ON_ENTER_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
        minSelectableCards: 2,
        maxSelectableCards: 2,
      });
      expect(state.activeEffect?.selectableCardIds).toEqual([
        ...scenario.handIds,
        ...scenario.drawIds,
      ]);

      const discardedIds = [scenario.handIds[0]!, scenario.drawIds[0]!];
      state = finishDiscard(state, discardedIds);

      expect(state.activeEffect).toBeNull();
      expect(state.pendingAbilities).toEqual([]);
      expect(state.players[0].waitingRoom.cardIds).toEqual(discardedIds);
      expect(state.players[0].hand.cardIds).toEqual([
        scenario.handIds[1]!,
        scenario.drawIds[1]!,
      ]);
    }
  );

  it('PL!SP-bp4-003 consumes the pending ability without drawing from CENTER', () => {
    const scenario = setupChisatoOnEnter(SlotPosition.CENTER);
    const state = startChisatoOnEnter(scenario.game, scenario.sourceId, SlotPosition.CENTER);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual(scenario.handIds);
    expect(state.players[0].mainDeck.cardIds).toEqual(scenario.drawIds);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_003_ON_ENTER_SIDE_DRAW_TWO_DISCARD_TWO_ABILITY_ID &&
          action.payload.step === 'DRAW_DISCARD_SOURCE_SLOT_CONDITION_NOT_MET'
      )
    ).toBe(true);
  });

  it('PL!SP-bp4-028 shows confirm-only text and adds SCORE +1 with active energy', () => {
    const { game, live } = setupDaisukiFullPower({ activeEnergyCount: 1 });
    const started = resolveDaisukiPending(game, [live.instanceId]);

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain('当前活跃能量 1张');
    expect(started.activeEffect?.effectText).toContain('满足条件，实际[スコア]+1');
    expect(started.activeEffect?.effectText).not.toContain('来源');

    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
    expect(scoreModifiers(resolved)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: live.instanceId,
        sourceCardId: live.instanceId,
        abilityId: SP_BP4_028_LIVE_START_ACTIVE_ENERGY_SCORE_ABILITY_ID,
      },
    ]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });

  it('PL!SP-bp4-028 resolves as no-op when all energy is waiting', () => {
    const { game, live } = setupDaisukiFullPower({
      activeEnergyCount: 0,
      waitingEnergyCount: 2,
    });
    const started = resolveDaisukiPending(game, [live.instanceId]);

    expect(started.activeEffect?.effectText).toContain('当前活跃能量 0张');
    expect(started.activeEffect?.effectText).toContain('未满足条件，实际不增加[スコア]');
    expect(started.activeEffect?.effectText).not.toContain('来源');

    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
    expect(scoreModifiers(resolved)).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('PL!SP-bp4-028 manual pending selection bridges confirm-only before resolving', () => {
    const { game, live, secondLive } = setupDaisukiFullPower({
      activeEnergyCount: 1,
      includeSecondPending: true,
    });
    const stateWithPending: GameState = {
      ...game,
      pendingAbilities: [live.instanceId, secondLive!.instanceId].map((liveId, index) =>
        pendingAbility({
          id: `sp-bp4-028-pending-${index}`,
          abilityId: SP_BP4_028_LIVE_START_ACTIVE_ENERGY_SCORE_ABILITY_ID,
          sourceCardId: liveId,
          timingId: TriggerCondition.ON_LIVE_START,
        })
      ),
    };
    const orderSelection = resolvePendingCardEffects(stateWithPending).gameState;
    const confirmOnly = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      live.instanceId
    );

    expect(confirmOnly.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmOnly.activeEffect?.sourceCardId).toBe(live.instanceId);

    const resolved = confirmActiveEffectStep(confirmOnly, PLAYER1, confirmOnly.activeEffect!.id);
    expect(resolved.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(resolved.activeEffect?.sourceCardId).toBe(secondLive!.instanceId);
    expect(resolved.pendingAbilities).toHaveLength(1);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });

  it('PL!SP-bp4-028 ordered resolution resolves automatically for both pending abilities', () => {
    const { game, live, secondLive } = setupDaisukiFullPower({
      activeEnergyCount: 1,
      includeSecondPending: true,
    });
    const resolved = resolveDaisukiPending(game, [live.instanceId, secondLive!.instanceId]);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(scoreModifiers(resolved)).toHaveLength(2);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(7);
  });
});
