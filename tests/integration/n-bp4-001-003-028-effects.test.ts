import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
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
  PL_N_BP4_001_LIVE_SUCCESS_LESS_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
  PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID,
  PL_N_BP4_028_LIVE_START_DIFFERENT_NIJIGASAKI_LIVE_SCORE_ABILITY_ID,
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

function createNijigasakiMember(
  cardCode: string,
  name: string,
  cost: number
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
  };
}

function createNijigasakiLive(cardCode: string, name: string, score = 2): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(index: string) {
  return createCardInstance(
    {
      cardCode: `energy-${index}`,
      name: `Energy ${index}`,
      cardType: CardType.ENERGY,
    },
    PLAYER1,
    `energy-${index}`
  );
}

function pendingAbility(options: {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly timingId: TriggerCondition;
  readonly controllerId?: string;
}): PendingAbilityState {
  return {
    id: options.id,
    abilityId: options.abilityId,
    sourceCardId: options.sourceCardId,
    controllerId: options.controllerId ?? PLAYER1,
    mandatory: true,
    timingId: options.timingId,
    eventIds: [`event-${options.id}`],
  };
}

function resolveSinglePending(game: GameState, ability: PendingAbilityState): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [ability],
  }).gameState;
}

function setupAyumu(options: {
  readonly ownEnergyCount: number;
  readonly opponentEnergyCount: number;
  readonly energyDeckCount: number;
}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly energyDeckIds: readonly string[];
} {
  const source = createCardInstance(
    createNijigasakiMember('PL!N-bp4-001-R', '上原歩夢', 2),
    PLAYER1,
    'n-bp4-001-source'
  );
  const ownEnergy = Array.from({ length: options.ownEnergyCount }, (_, index) =>
    createEnergy(`ayumu-own-${index}`)
  );
  const opponentEnergy = Array.from({ length: options.opponentEnergyCount }, (_, index) =>
    createCardInstance(
      { cardCode: `opponent-energy-${index}`, name: 'Opponent Energy', cardType: CardType.ENERGY },
      PLAYER2,
      `opponent-energy-${index}`
    )
  );
  const energyDeck = Array.from({ length: options.energyDeckCount }, (_, index) =>
    createEnergy(`ayumu-deck-${index}`)
  );

  let game = createGameState('n-bp4-001-ayumu', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...ownEnergy, ...opponentEnergy, ...energyDeck]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: ownEnergy.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    energyDeck: { ...player.energyDeck, cardIds: energyDeck.map((card) => card.instanceId) },
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    energyZone: opponentEnergy.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));

  return {
    game,
    sourceId: source.instanceId,
    energyDeckIds: energyDeck.map((card) => card.instanceId),
  };
}

function setupShizuku(options: {
  readonly ownScore: number;
  readonly opponentScore: number;
  readonly deckCount: number;
}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly drawIds: readonly string[];
} {
  const source = createCardInstance(
    createNijigasakiMember('PL!N-bp4-003-P', '桜坂しずく', 4),
    PLAYER1,
    'n-bp4-003-source'
  );
  const drawCards = Array.from({ length: options.deckCount }, (_, index) =>
    createCardInstance(
      createNijigasakiMember(`PL!N-bp4-003-draw-${index}`, `Draw ${index}`, 1),
      PLAYER1,
      `n-bp4-003-draw-${index}`
    )
  );

  let game = createGameState('n-bp4-003-shizuku', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...drawCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      playerScores: new Map([
        [PLAYER1, options.ownScore],
        [PLAYER2, options.opponentScore],
      ]),
    },
  };

  return {
    game,
    sourceId: source.instanceId,
    drawIds: drawCards.map((card) => card.instanceId),
  };
}

function setupStarsWeChase(options: {
  readonly differentLiveNames: number;
  readonly duplicateLiveNames?: number;
  readonly includeSecondPending?: boolean;
}): {
  readonly game: GameState;
  readonly live: ReturnType<typeof createCardInstance>;
  readonly secondLive: ReturnType<typeof createCardInstance> | null;
} {
  const live = createCardInstance(
    createNijigasakiLive('PL!N-bp4-028-L', 'stars we chase'),
    PLAYER1,
    'n-bp4-028-live'
  );
  const secondLive = options.includeSecondPending
    ? createCardInstance(
        createNijigasakiLive('PL!N-bp4-028-L', 'stars we chase'),
        PLAYER1,
        'n-bp4-028-live-2'
      )
    : null;
  const waitingLives = [
    ...Array.from({ length: options.differentLiveNames }, (_, index) =>
      createCardInstance(
        createNijigasakiLive(`PL!N-bp4-028-wr-${index}`, `虹咲 LIVE ${index}`),
        PLAYER1,
        `n-bp4-028-wr-${index}`
      )
    ),
    ...Array.from({ length: options.duplicateLiveNames ?? 0 }, (_, index) =>
      createCardInstance(
        createNijigasakiLive(`PL!N-bp4-028-wr-dupe-${index}`, '虹咲 LIVE 0'),
        PLAYER1,
        `n-bp4-028-wr-dupe-${index}`
      )
    ),
  ];

  let game = createGameState('n-bp4-028-stars-we-chase', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ...(secondLive ? [secondLive] : []), ...waitingLives]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: secondLive
      ? addCardToStatefulZone(
          addCardToStatefulZone(player.liveZone, live.instanceId),
          secondLive.instanceId
        )
      : addCardToStatefulZone(player.liveZone, live.instanceId),
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingLives.map((card) => card.instanceId),
    },
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, 2]]),
    },
  };

  return { game, live, secondLive };
}

function scoreModifiers(game: GameState, abilityId: string) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === abilityId
  );
}

describe('PL!N-bp4 001 / 003 / 028 effects', () => {
  it('PL!N-bp4-001 places one waiting energy after confirm-only when own energy is lower', () => {
    const { game, sourceId, energyDeckIds } = setupAyumu({
      ownEnergyCount: 1,
      opponentEnergyCount: 2,
      energyDeckCount: 1,
    });
    const started = resolveSinglePending(
      game,
      pendingAbility({
        id: 'n-bp4-001-pending',
        abilityId: PL_N_BP4_001_LIVE_SUCCESS_LESS_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
        sourceCardId: sourceId,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
      })
    );

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain('当前能量数量：自己1张，对方2张');
    expect(started.players[0].energyZone.cardIds).toHaveLength(1);

    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].energyZone.cardIds).toEqual(['energy-ayumu-own-0', energyDeckIds[0]]);
    expect(resolved.players[0].energyZone.cardStates.get(energyDeckIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(resolved.players[0].energyDeck.cardIds).toEqual([]);
  });

  it('PL!N-bp4-001 consumes pending as no-op when own energy is not lower', () => {
    const { game, sourceId, energyDeckIds } = setupAyumu({
      ownEnergyCount: 2,
      opponentEnergyCount: 2,
      energyDeckCount: 1,
    });
    const started = resolveSinglePending(
      game,
      pendingAbility({
        id: 'n-bp4-001-pending',
        abilityId: PL_N_BP4_001_LIVE_SUCCESS_LESS_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
        sourceCardId: sourceId,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
      })
    );
    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.players[0].energyZone.cardIds).toHaveLength(2);
    expect(resolved.players[0].energyDeck.cardIds).toEqual(energyDeckIds);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('PL!N-bp4-001 safely no-ops when the energy deck is empty', () => {
    const { game, sourceId } = setupAyumu({
      ownEnergyCount: 1,
      opponentEnergyCount: 2,
      energyDeckCount: 0,
    });
    const started = resolveSinglePending(
      game,
      pendingAbility({
        id: 'n-bp4-001-pending',
        abilityId: PL_N_BP4_001_LIVE_SUCCESS_LESS_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
        sourceCardId: sourceId,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
      })
    );
    expect(started.activeEffect?.effectText).toContain('能量卡组为空，不放置能量');

    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
    expect(resolved.players[0].energyZone.cardIds).toHaveLength(1);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('PL!N-bp4-003 draws one only after confirm when own LIVE score is higher', () => {
    const { game, sourceId, drawIds } = setupShizuku({
      ownScore: 5,
      opponentScore: 4,
      deckCount: 1,
    });
    const started = resolveSinglePending(
      game,
      pendingAbility({
        id: 'n-bp4-003-pending',
        abilityId: PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID,
        sourceCardId: sourceId,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
      })
    );

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain('当前LIVE合计分数为5对4');
    expect(started.players[0].hand.cardIds).toEqual([]);
    expect(started.players[0].mainDeck.cardIds).toEqual(drawIds);

    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
    expect(resolved.players[0].hand.cardIds).toEqual(drawIds);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([]);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('PL!N-bp4-003 consumes pending as no-op when own LIVE score is not higher', () => {
    const { game, sourceId, drawIds } = setupShizuku({
      ownScore: 4,
      opponentScore: 4,
      deckCount: 1,
    });
    const started = resolveSinglePending(
      game,
      pendingAbility({
        id: 'n-bp4-003-pending',
        abilityId: PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID,
        sourceCardId: sourceId,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
      })
    );
    expect(started.activeEffect?.effectText).toContain('自己未高于对方');

    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual(drawIds);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it.each([
    { differentLiveNames: 0, expectedBonus: 0 },
    { differentLiveNames: 3, expectedBonus: 0 },
    { differentLiveNames: 4, expectedBonus: 1 },
    { differentLiveNames: 5, expectedBonus: 1 },
    { differentLiveNames: 6, expectedBonus: 2 },
  ])(
    'PL!N-bp4-028 applies SCORE +$expectedBonus for $differentLiveNames different Nijigasaki LIVE names',
    ({ differentLiveNames, expectedBonus }) => {
      const { game, live } = setupStarsWeChase({
        differentLiveNames,
        duplicateLiveNames: differentLiveNames > 0 ? 1 : 0,
      });
      const started = resolveSinglePending(
        game,
        pendingAbility({
          id: 'n-bp4-028-pending',
          abilityId: PL_N_BP4_028_LIVE_START_DIFFERENT_NIJIGASAKI_LIVE_SCORE_ABILITY_ID,
          sourceCardId: live.instanceId,
          timingId: TriggerCondition.ON_LIVE_START,
        })
      );

      expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
      expect(started.activeEffect?.effectText).toContain(
        `不同名『虹ヶ咲』LIVE ${differentLiveNames}种`
      );
      expect(
        scoreModifiers(
          started,
          PL_N_BP4_028_LIVE_START_DIFFERENT_NIJIGASAKI_LIVE_SCORE_ABILITY_ID
        )
      ).toEqual([]);

      const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
      expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2 + expectedBonus);
      expect(
        scoreModifiers(
          resolved,
          PL_N_BP4_028_LIVE_START_DIFFERENT_NIJIGASAKI_LIVE_SCORE_ABILITY_ID
        )
      ).toHaveLength(expectedBonus > 0 ? 1 : 0);
      if (expectedBonus > 0) {
        expect(
          scoreModifiers(
            resolved,
            PL_N_BP4_028_LIVE_START_DIFFERENT_NIJIGASAKI_LIVE_SCORE_ABILITY_ID
          )[0]
        ).toMatchObject({
          kind: 'SCORE',
          playerId: PLAYER1,
          countDelta: expectedBonus,
          liveCardId: live.instanceId,
        });
      }
    }
  );

  it('PL!N-bp4-028 ordered resolution resolves multiple pending abilities without per-effect confirm-only', () => {
    const { game, live, secondLive } = setupStarsWeChase({
      differentLiveNames: 6,
      includeSecondPending: true,
    });
    const orderSelection = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [live.instanceId, secondLive!.instanceId].map((liveId, index) =>
        pendingAbility({
          id: `n-bp4-028-pending-${index}`,
          abilityId: PL_N_BP4_028_LIVE_START_DIFFERENT_NIJIGASAKI_LIVE_SCORE_ABILITY_ID,
          sourceCardId: liveId,
          timingId: TriggerCondition.ON_LIVE_START,
        })
      ),
    }).gameState;

    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(
      scoreModifiers(resolved, PL_N_BP4_028_LIVE_START_DIFFERENT_NIJIGASAKI_LIVE_SCORE_ABILITY_ID)
    ).toHaveLength(2);
  });
});
