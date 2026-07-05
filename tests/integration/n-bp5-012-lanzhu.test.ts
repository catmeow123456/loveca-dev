import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  registerCards,
  updateLiveResolution,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addEnergyBelowMember, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createActivateAbilityCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  N_BP5_012_ACTIVATED_STACK_ENERGY_BELOW_DRAW_GAIN_PINK_HEART_ABILITY_ID,
  N_BP5_012_LIVE_SUCCESS_LEADING_SCORE_PLACE_WAITING_ENERGY_BY_BELOW_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
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
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(): MemberCardData {
  return {
    cardCode: 'PL!N-bp5-012-R＋',
    name: '鐘 嵐珠',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createFillerMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupLanzhuScenario(options: {
  readonly energyZoneCount?: number;
  readonly mainDeckCount?: number;
  readonly energyBelowCount?: number;
  readonly energyDeckCount?: number;
  readonly ownScore?: number;
  readonly opponentScore?: number;
  readonly currentPhase?: GamePhase;
  readonly activePlayerIndex?: number;
  readonly removeSource?: boolean;
  readonly secondPending?: boolean;
}) {
  const session = createGameSession();
  session.createGame('n-bp5-012-lanzhu', PLAYER1, 'P1', PLAYER2, 'P2');
  const source = createCardInstance(createMember(), PLAYER1, 'n-bp5-012-source');
  const secondSource = createCardInstance(createMember(), PLAYER1, 'n-bp5-012-source-2');
  const secondBelowEnergy = createCardInstance(
    createEnergy('LANZHU-SECOND-BELOW-ENERGY'),
    PLAYER1,
    'second-below-energy'
  );
  const energyZoneCards = Array.from({ length: options.energyZoneCount ?? 0 }, (_, index) =>
    createCardInstance(createEnergy(`LANZHU-ZONE-ENERGY-${index}`), PLAYER1, `zone-energy-${index}`)
  );
  const energyBelowCards = Array.from({ length: options.energyBelowCount ?? 0 }, (_, index) =>
    createCardInstance(createEnergy(`LANZHU-BELOW-ENERGY-${index}`), PLAYER1, `below-energy-${index}`)
  );
  const energyDeckCards = Array.from({ length: options.energyDeckCount ?? 0 }, (_, index) =>
    createCardInstance(createEnergy(`LANZHU-DECK-ENERGY-${index}`), PLAYER1, `deck-energy-${index}`)
  );
  const mainDeckCards = Array.from({ length: options.mainDeckCount ?? 1 }, (_, index) =>
    createCardInstance(
      createFillerMember(`LANZHU-DRAW-${index}`),
      PLAYER1,
      `main-deck-card-${index}`
    )
  );
  let game = registerCards(session.state!, [
    source,
    secondSource,
    secondBelowEnergy,
    ...energyZoneCards,
    ...energyBelowCards,
    ...energyDeckCards,
    ...mainDeckCards,
  ]);
  game = {
    ...game,
    currentPhase: options.currentPhase ?? GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: options.activePlayerIndex ?? 0,
    waitingPlayerId: null,
  };
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.secondPending) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, secondSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (options.removeSource) {
      memberSlots = removeCardFromSlot(memberSlots, SlotPosition.CENTER);
    }
    for (const card of energyBelowCards) {
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.CENTER, card.instanceId);
    }
    if (options.secondPending) {
      memberSlots = addEnergyBelowMember(memberSlots, SlotPosition.RIGHT, secondBelowEnergy.instanceId);
    }
    return {
      ...player,
      memberSlots,
      mainDeck: {
        ...player.mainDeck,
        cardIds: mainDeckCards.map((card) => card.instanceId),
      },
      energyDeck: {
        ...player.energyDeck,
        cardIds: energyDeckCards.map((card) => card.instanceId),
      },
      energyZone: {
        ...player.energyZone,
        cardIds: energyZoneCards.map((card) => card.instanceId),
        cardStates: new Map(
          energyZoneCards.map((card) => [
            card.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
    };
  });
  game = updateLiveResolution(game, (liveResolution) => {
    const playerScores = new Map(liveResolution.playerScores);
    playerScores.set(PLAYER1, options.ownScore ?? 0);
    playerScores.set(PLAYER2, options.opponentScore ?? 0);
    return { ...liveResolution, playerScores };
  });
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return { session, source, secondSource, energyZoneCards, energyDeckCards, mainDeckCards };
}

function activateLanzhu(session: ReturnType<typeof createGameSession>) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      'n-bp5-012-source',
      N_BP5_012_ACTIVATED_STACK_ENERGY_BELOW_DRAW_GAIN_PINK_HEART_ABILITY_ID
    )
  );
}

function withLiveSuccessPending(
  game: GameState,
  sourceCardIds: readonly string[] = ['n-bp5-012-source']
): GameState {
  return {
    ...game,
    pendingAbilities: sourceCardIds.map((sourceCardId, index) => ({
      id: `n-bp5-012-live-success-${index}`,
      abilityId: N_BP5_012_LIVE_SUCCESS_LEADING_SCORE_PLACE_WAITING_ENERGY_BY_BELOW_ABILITY_ID,
      sourceCardId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_SUCCESS,
      eventIds: [`live-success-${index}`],
      sourceSlot: index === 0 ? SlotPosition.CENTER : SlotPosition.RIGHT,
    })),
  };
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        N_BP5_012_ACTIVATED_STACK_ENERGY_BELOW_DRAW_GAIN_PINK_HEART_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!N-bp5-012 Lanzhu activated and live-success workflows', () => {
  it('stacks one energy below this member, draws one card, and gains PINK Heart', () => {
    const scenario = setupLanzhuScenario({ energyZoneCount: 1, mainDeckCount: 1 });

    expect(activateLanzhu(scenario.session).success).toBe(true);

    const player = scenario.session.state!.players[0]!;
    expect(player.memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      scenario.energyZoneCards[0]!.instanceId,
    ]);
    expect(player.hand.cardIds).toEqual([scenario.mainDeckCards[0]!.instanceId]);
    expect(getMemberEffectiveHeartIcons(scenario.session.state!, PLAYER1, scenario.source.instanceId)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
      createHeartIcon(HeartColor.PINK, 1),
    ]);
    expect(abilityUseCount(scenario.session.state!)).toBe(1);
  });

  it('does not activate or record turn use without energy, outside main phase, or for a non-current player', () => {
    for (const options of [
      { energyZoneCount: 0 },
      { currentPhase: GamePhase.LIVE_SET_PHASE },
      { activePlayerIndex: 1 },
    ] as const) {
      const scenario = setupLanzhuScenario(options);
      const result = activateLanzhu(scenario.session);

      expect(result.success).toBe(false);
      expect(abilityUseCount(scenario.session.state!)).toBe(0);
      expect(scenario.session.state!.players[0]!.memberSlots.energyBelow[SlotPosition.CENTER]).toEqual(
        []
      );
    }
  });

  it('opens confirm-only for a single pending and places energyBelow plus one WAITING energy when leading', () => {
    const scenario = setupLanzhuScenario({
      energyBelowCount: 2,
      energyDeckCount: 3,
      ownScore: 4,
      opponentScore: 2,
    });
    const confirmation = resolvePendingCardEffects(withLiveSuccessPending(scenario.session.state!)).gameState;

    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmation.activeEffect?.effectText).toContain('此成员下方有2张能量');
    expect(confirmation.activeEffect?.effectText).toContain('放置3张待机状态能量');
    expect(confirmation.activeEffect?.effectText).not.toContain('确认后');
    expect(confirmation.activeEffect?.effectText).not.toContain('ウェイト状態');
    expect(confirmation.activeEffect?.effectText).not.toContain('エネルギー');
    expect(confirmation.activeEffect?.stepText).toContain('待机状态能量');
    expect(confirmation.activeEffect?.stepText).not.toContain('WAITING 能量');

    const result = confirmIfConfirmOnly(confirmation, PLAYER1);
    const player = result.players[0]!;
    expect(player.energyZone.cardIds.slice(-3)).toEqual(
      scenario.energyDeckCards.map((card) => card.instanceId)
    );
    expect(
      scenario.energyDeckCards.map(
        (card) => player.energyZone.cardStates.get(card.instanceId)?.orientation
      )
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING, OrientationState.WAITING]);
  });

  it('no-ops when tied, behind, or the source has left stage', () => {
    for (const options of [
      { ownScore: 2, opponentScore: 2 },
      { ownScore: 1, opponentScore: 2 },
      { ownScore: 3, opponentScore: 1, removeSource: true },
    ] as const) {
      const scenario = setupLanzhuScenario({
        ...options,
        energyBelowCount: 1,
        energyDeckCount: 2,
      });
      const result = confirmIfConfirmOnly(
        resolvePendingCardEffects(withLiveSuccessPending(scenario.session.state!)).gameState,
        PLAYER1
      );

      expect(result.players[0]!.energyZone.cardIds).toEqual([]);
      expect(result.pendingAbilities).toEqual([]);
    }
  });

  it('places only available energy when the energy deck is short', () => {
    const scenario = setupLanzhuScenario({
      energyBelowCount: 3,
      energyDeckCount: 2,
      ownScore: 5,
      opponentScore: 1,
    });

    const result = confirmIfConfirmOnly(
      resolvePendingCardEffects(withLiveSuccessPending(scenario.session.state!)).gameState,
      PLAYER1
    );

    expect(result.players[0]!.energyZone.cardIds).toEqual(
      scenario.energyDeckCards.map((card) => card.instanceId)
    );
    expect(
      result.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_012_LIVE_SUCCESS_LEADING_SCORE_PLACE_WAITING_ENERGY_BY_BELOW_ABILITY_ID
      )?.payload
    ).toMatchObject({
      requestedEnergyCount: 4,
      availableEnergyCount: 2,
      placedEnergyCardIds: scenario.energyDeckCards.map((card) => card.instanceId),
    });
    expect(result.pendingAbilities).toEqual([]);
  });

  it('resolves multiple live-success pending abilities in order without confirm-only prompts', () => {
    const scenario = setupLanzhuScenario({
      energyBelowCount: 1,
      energyDeckCount: 4,
      ownScore: 3,
      opponentScore: 1,
      secondPending: true,
    });
    const orderSelection = resolvePendingCardEffects(
      withLiveSuccessPending(scenario.session.state!, [
        scenario.source.instanceId,
        scenario.secondSource.instanceId,
      ])
    ).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe('system:select-pending-card-effect');

    const result = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );
    const resolveActions = result.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          N_BP5_012_LIVE_SUCCESS_LEADING_SCORE_PLACE_WAITING_ENERGY_BY_BELOW_ABILITY_ID
    );

    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
    expect(resolveActions.map((action) => action.payload.requestedEnergyCount)).toEqual([2, 2]);
    expect(result.players[0]!.energyZone.cardIds).toHaveLength(4);
  });
});
