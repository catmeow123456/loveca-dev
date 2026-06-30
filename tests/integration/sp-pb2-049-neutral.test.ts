import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_PB2_049_LIVE_SUCCESS_CHEER_KALEIDOSCORE_FIVE_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_PB2_049_LIVE_SUCCESS_ENERGY_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createNeutral(): LiveCardData {
  return {
    cardCode: 'PL!SP-pb2-049-L',
    name: 'ニュートラル',
    groupNames: ['Liella!'],
    unitName: 'KALEIDOSCORE',
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createCheerMember(cardCode: string, unitName = 'KALEIDOSCORE'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupNeutralState(options: {
  readonly kaleidoscoreCheerCount: number;
  readonly energyZoneCount: number;
  readonly energyDeckCount?: number;
  readonly initialScore?: number;
}): {
  readonly game: GameState;
  readonly liveId: string;
  readonly energyDeckCardIds: readonly string[];
} {
  const live = createCardInstance(createNeutral(), PLAYER1, 'neutral-live');
  const cheerCards = Array.from({ length: 6 }, (_, index) =>
    createCardInstance(
      createCheerMember(
        `PL!SP-cheer-${index}`,
        index < options.kaleidoscoreCheerCount ? 'KALEIDOSCORE' : 'CatChu!'
      ),
      PLAYER1,
      `cheer-${index}`
    )
  );
  const energyCards = Array.from({ length: 12 }, (_, index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `energy-${index}`)
  );
  const energyZoneCards = energyCards.slice(0, options.energyZoneCount);
  const energyDeckCards = energyCards.slice(
    options.energyZoneCount,
    options.energyZoneCount + (options.energyDeckCount ?? 1)
  );

  let game = createGameState('sp-pb2-049-neutral', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ...cheerCards, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: [live.instanceId],
      cardStates: new Map([
        [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
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
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds: cheerCards.map((card) => card.instanceId),
      playerScores: new Map([[PLAYER1, options.initialScore ?? 5]]),
    },
  };

  return {
    game,
    liveId: live.instanceId,
    energyDeckCardIds: energyDeckCards.map((card) => card.instanceId),
  };
}

function pendingAbility(abilityId: string, sourceCardId: string, suffix: string): PendingAbilityState {
  return {
    id: `${abilityId}:${suffix}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`live-success:${suffix}`],
  };
}

function resolveSingle(game: GameState, abilityId: string, sourceCardId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility(abilityId, sourceCardId, 'single')],
  }).gameState;
}

function resolveBothInSelectedOrder(
  game: GameState,
  liveId: string,
  firstAbilityId: string
): GameState {
  const cheerAbility = pendingAbility(
    SP_PB2_049_LIVE_SUCCESS_CHEER_KALEIDOSCORE_FIVE_PLACE_WAITING_ENERGY_ABILITY_ID,
    liveId,
    'cheer'
  );
  const scoreAbility = pendingAbility(
    SP_PB2_049_LIVE_SUCCESS_ENERGY_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID,
    liveId,
    'score'
  );
  let state = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [cheerAbility, scoreAbility],
  }).gameState;
  const firstPendingId =
    firstAbilityId === cheerAbility.abilityId ? cheerAbility.id : scoreAbility.id;
  state = confirmActiveEffectStep(
    state,
    PLAYER1,
    state.activeEffect!.id,
    undefined,
    undefined,
    false,
    firstPendingId
  );
  if (state.activeEffect?.metadata?.confirmOnlyPendingAbility === true) {
    expect(state.activeEffect.abilityId).toBe(firstAbilityId);
    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect.id,
      undefined,
      undefined,
      false
    );
  }
  return state;
}

describe('PL!SP-pb2-049 Neutral live success workflows', () => {
  it('places one WAITING energy when own revealed cheer has five KALEIDOSCORE cards', () => {
    const { game, liveId, energyDeckCardIds } = setupNeutralState({
      kaleidoscoreCheerCount: 5,
      energyZoneCount: 0,
    });
    const state = resolveSingle(
      game,
      SP_PB2_049_LIVE_SUCCESS_CHEER_KALEIDOSCORE_FIVE_PLACE_WAITING_ENERGY_ABILITY_ID,
      liveId
    );

    expect(state.players[0].energyZone.cardIds).toEqual([energyDeckCardIds[0]]);
    expect(state.players[0].energyZone.cardStates.get(energyDeckCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('does not place energy when fewer than five KALEIDOSCORE cards were revealed', () => {
    const { game, liveId } = setupNeutralState({
      kaleidoscoreCheerCount: 4,
      energyZoneCount: 0,
    });
    const state = resolveSingle(
      game,
      SP_PB2_049_LIVE_SUCCESS_CHEER_KALEIDOSCORE_FIVE_PLACE_WAITING_ENERGY_ABILITY_ID,
      liveId
    );

    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.conditionMet === false &&
          action.payload.kaleidoscoreCheerCardCount === 4
      )
    ).toBe(true);
  });

  it('adds this Live SCORE +1 and refreshes playerScores with eleven energy', () => {
    const { game, liveId } = setupNeutralState({
      kaleidoscoreCheerCount: 0,
      energyZoneCount: 11,
      initialScore: 5,
    });
    const state = resolveSingle(
      game,
      SP_PB2_049_LIVE_SUCCESS_ENERGY_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID,
      liveId
    );

    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: liveId,
      sourceCardId: liveId,
      abilityId: SP_PB2_049_LIVE_SUCCESS_ENERGY_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID,
    });
  });

  it('at ten energy, resolving energy placement before score gives +1', () => {
    const { game, liveId } = setupNeutralState({
      kaleidoscoreCheerCount: 5,
      energyZoneCount: 10,
      energyDeckCount: 1,
      initialScore: 5,
    });
    const state = resolveBothInSelectedOrder(
      game,
      liveId,
      SP_PB2_049_LIVE_SUCCESS_CHEER_KALEIDOSCORE_FIVE_PLACE_WAITING_ENERGY_ABILITY_ID
    );

    expect(state.players[0].energyZone.cardIds).toHaveLength(11);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });

  it('at ten energy, resolving score before energy does not give +1', () => {
    const { game, liveId } = setupNeutralState({
      kaleidoscoreCheerCount: 5,
      energyZoneCount: 10,
      energyDeckCount: 1,
      initialScore: 5,
    });
    const state = resolveBothInSelectedOrder(
      game,
      liveId,
      SP_PB2_049_LIVE_SUCCESS_ENERGY_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID
    );

    expect(state.players[0].energyZone.cardIds).toHaveLength(11);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_049_LIVE_SUCCESS_ENERGY_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID &&
          action.payload.energyCount === 10 &&
          action.payload.scoreBonus === 0
      )
    ).toBe(true);
  });
});
