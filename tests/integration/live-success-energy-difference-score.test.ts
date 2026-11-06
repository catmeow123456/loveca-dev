import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type EnergyCardData,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, removeCardFromStatefulZone } from '../../src/domain/entities/zone';
import { createLiveSuccessEvent } from '../../src/domain/events/game-events';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID,
  SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID,
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
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

const WE_WILL_LIVE: LiveCardData = {
  cardCode: 'PL!SP-bp7-024-SECL',
  name: 'WE WILL!!',
  groupNames: ['Liella!'],
  cardType: CardType.LIVE,
  score: 2,
  requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
};

// L is from the 2026-11-06 export; SECL is a synthetic rarity of the same card.
const HAPPY_END_LIVE: LiveCardData = {
  cardCode: 'PL!S-bp6-022-L',
  name: '近未来ハッピーエンド',
  groupNames: ['Aqours'],
  cardType: CardType.LIVE,
  score: 7,
  requirements: createHeartRequirement({
    [HeartColor.RED]: 5,
    [HeartColor.GREEN]: 2,
    [HeartColor.BLUE]: 2,
    [HeartColor.RAINBOW]: 7,
  }),
};

const HAPPY_END_ABILITY_ID = S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID;
const SYNTHETIC_HAPPY_END_CODE = 'PL!S-bp6-022-SECL';

function energyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function pending(abilityId: string, sourceCardId: string, index = 0): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:${index}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`event:${index}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: {
  readonly sourceLive?: LiveCardData;
  readonly abilityId?: string;
  readonly ownEnergyCount: number;
  readonly opponentEnergyCount: number;
  readonly secondSource?: boolean;
}): {
  readonly game: GameState;
  readonly sourceCardId: string;
  readonly secondSourceCardId?: string;
  readonly spareOpponentEnergyCardId: string;
} {
  const sourceLive = options.sourceLive ?? WE_WILL_LIVE;
  const abilityId = options.abilityId ?? SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID;
  const source = createCardInstance(sourceLive, PLAYER1, 'source');
  const secondSource = options.secondSource
    ? createCardInstance(sourceLive, PLAYER1, 'second-source')
    : null;
  const ownEnergy = Array.from({ length: options.ownEnergyCount }, (_, index) =>
    createCardInstance(energyCard(`own-energy-${index}`), PLAYER1, `own-energy-${index}`)
  );
  const opponentEnergy = Array.from({ length: options.opponentEnergyCount }, (_, index) =>
    createCardInstance(energyCard(`opponent-energy-${index}`), PLAYER2, `opponent-energy-${index}`)
  );
  const spareOpponentEnergy = createCardInstance(
    energyCard('opponent-energy-spare'),
    PLAYER2,
    'opponent-energy-spare'
  );
  let game = registerCards(
    createGameState('live-success-energy-difference-score', PLAYER1, 'P1', PLAYER2, 'P2'),
    [
      source,
      ...(secondSource ? [secondSource] : []),
      ...ownEnergy,
      ...opponentEnergy,
      spareOpponentEnergy,
    ]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: [source.instanceId, ...(secondSource ? [secondSource.instanceId] : [])],
      cardStates: new Map([
        [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ...(secondSource
          ? [
              [
                secondSource.instanceId,
                { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
              ] as const,
            ]
          : []),
      ]),
    },
    energyZone: ownEnergy.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.energyZone
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    energyZone: opponentEnergy.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.energyZone
    ),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    activePlayerIndex: 0,
    firstPlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      liveResults: new Map([
        [source.instanceId, true],
        ...(secondSource ? ([[secondSource.instanceId, true]] as const) : []),
      ]),
      playerScores: new Map([[PLAYER1, sourceLive.score * (secondSource ? 2 : 1)]]),
    },
    pendingAbilities: [
      pending(abilityId, source.instanceId),
      ...(secondSource ? [pending(abilityId, secondSource.instanceId, 1)] : []),
    ],
  };
  return {
    game,
    sourceCardId: source.instanceId,
    ...(secondSource ? { secondSourceCardId: secondSource.instanceId } : {}),
    spareOpponentEnergyCardId: spareOpponentEnergy.instanceId,
  };
}

function resolveSingle(
  game: GameState,
  abilityId = SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID
): GameState {
  const started = resolvePendingCardEffects(game).gameState;
  expect(started.activeEffect).toMatchObject({
    abilityId,
    metadata: { confirmOnlyPendingAbility: true },
  });
  return confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
}

function scoreModifiers(game: GameState, abilityId: string) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === abilityId
  );
}

function abilityActions(game: GameState, abilityId: string) {
  return game.actionHistory.filter(
    (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId
  );
}

describe('LIVE_SUCCESS energy-difference SCORE shared workflow', () => {
  it.each([
    { ownEnergyCount: 4, opponentEnergyCount: 2, expectedBonus: 1 },
    { ownEnergyCount: 5, opponentEnergyCount: 2, expectedBonus: 1 },
    { ownEnergyCount: 3, opponentEnergyCount: 2, expectedBonus: 0 },
    { ownEnergyCount: 2, opponentEnergyCount: 2, expectedBonus: 0 },
    { ownEnergyCount: 1, opponentEnergyCount: 2, expectedBonus: 0 },
  ])(
    'PL!SP-bp7-024-SECL resolves own $ownEnergyCount vs opponent $opponentEnergyCount',
    ({ ownEnergyCount, opponentEnergyCount, expectedBonus }) => {
      const { game, sourceCardId } = setup({ ownEnergyCount, opponentEnergyCount });
      const resolved = resolveSingle(game);

      expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2 + expectedBonus);
      expect(
        scoreModifiers(resolved, SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID)
      ).toEqual(
        expectedBonus > 0
          ? [
              expect.objectContaining({
                countDelta: 1,
                liveCardId: sourceCardId,
                sourceCardId,
              }),
            ]
          : []
      );
    }
  );

  it('shows current energy counts and actual tokenized result before changing score', () => {
    const { game } = setup({ ownEnergyCount: 4, opponentEnergyCount: 2 });
    const started = resolvePendingCardEffects(game).gameState;

    expect(started.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(started.activeEffect?.effectText).toContain(
      '当前自己能量4张，对方能量2张，满足条件，实际[スコア]+1'
    );
    expect(started.activeEffect?.effectText).not.toContain('来源');
    expect(started.activeEffect?.stepText).toBe('确认后结算此效果。');
  });

  it('recomputes the energy difference after the confirmation window opens', () => {
    const { game, spareOpponentEnergyCardId } = setup({
      ownEnergyCount: 4,
      opponentEnergyCount: 2,
    });
    let started = resolvePendingCardEffects(game).gameState;
    started = updatePlayer(started, PLAYER2, (player) => ({
      ...player,
      energyZone: addCardToZone(player.energyZone, spareOpponentEnergyCardId),
    }));

    const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(
      scoreModifiers(resolved, SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID)
    ).toHaveLength(0);
  });

  it('manual pending selection opens the bridge before resolving the selected ability', () => {
    const { game, sourceCardId } = setup({
      ownEnergyCount: 4,
      opponentEnergyCount: 2,
      secondSource: true,
    });
    const order = resolvePendingCardEffects(game).gameState;
    expect(order.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);

    const selected = confirmActiveEffectStep(order, PLAYER1, order.activeEffect!.id, sourceCardId);
    expect(selected.activeEffect).toMatchObject({
      abilityId: SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID,
      sourceCardId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(selected.liveResolution.playerScores.get(PLAYER1)).toBe(4);
  });

  it('ordered resolution resolves two abilities without per-card confirmation', () => {
    const { game } = setup({
      ownEnergyCount: 4,
      opponentEnergyCount: 2,
      secondSource: true,
    });
    const order = resolvePendingCardEffects(game).gameState;
    const resolved = confirmActiveEffectStep(
      order,
      PLAYER1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toHaveLength(0);
    expect(
      abilityActions(resolved, SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID).map(
        (action) => action.payload
      )
    ).toEqual([
      expect.objectContaining({ scoreBonus: 1 }),
      expect.objectContaining({ scoreBonus: 1 }),
    ]);
    expect(
      scoreModifiers(resolved, SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID)
    ).toHaveLength(2);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });

  it('stale source consumes the pending without adding SCORE', () => {
    const { game } = setup({ ownEnergyCount: 4, opponentEnergyCount: 2 });
    const stale = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    const resolved = resolveSingle(stale);

    expect(resolved.pendingAbilities).toHaveLength(0);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(
      scoreModifiers(resolved, SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID)
    ).toHaveLength(0);
  });

  it('re-entry replaces the same modifier and applies only the score delta', () => {
    const { game, sourceCardId } = setup({ ownEnergyCount: 4, opponentEnergyCount: 2 });
    const first = resolveSingle(game);
    const repeated: GameState = {
      ...first,
      pendingAbilities: [
        pending(SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID, sourceCardId, 2),
      ],
    };
    const second = resolveSingle(repeated);

    expect(second.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(
      scoreModifiers(second, SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID)
    ).toHaveLength(1);
  });

  it('re-entry removes the old modifier and rolls back its score when the condition stops matching', () => {
    const { game, sourceCardId, spareOpponentEnergyCardId } = setup({
      ownEnergyCount: 4,
      opponentEnergyCount: 2,
    });
    const first = resolveSingle(game);
    let repeated: GameState = {
      ...first,
      pendingAbilities: [
        pending(SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID, sourceCardId, 2),
      ],
    };
    repeated = updatePlayer(repeated, PLAYER2, (player) => ({
      ...player,
      energyZone: addCardToZone(player.energyZone, spareOpponentEnergyCardId),
    }));
    const second = resolveSingle(repeated);

    expect(second.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(
      scoreModifiers(second, SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID)
    ).toHaveLength(0);
    expect(
      abilityActions(second, SP_BP7_024_LIVE_SUCCESS_ENERGY_TWO_MORE_SCORE_ABILITY_ID).at(-1)
        ?.payload
    ).toMatchObject({
      scoreBonus: 0,
      scoreDelta: -1,
    });
  });

  describe.each([HAPPY_END_LIVE.cardCode, SYNTHETIC_HAPPY_END_CODE])('%s', (cardCode) => {
    it.each([
      { opponentEnergyCount: 3, expectedBonus: 1, step: 'OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE' },
      { opponentEnergyCount: 2, expectedBonus: 0, step: 'NO_OPPONENT_ENERGY_MORE' },
      { opponentEnergyCount: 1, expectedBonus: 0, step: 'NO_OPPONENT_ENERGY_MORE' },
    ])(
      'triggers on LIVE success with 2 own and $opponentEnergyCount opposing energy',
      ({ opponentEnergyCount, expectedBonus, step }) => {
        const { game, sourceCardId } = setup({
          sourceLive: { ...HAPPY_END_LIVE, cardCode },
          abilityId: HAPPY_END_ABILITY_ID,
          ownEnergyCount: 2,
          opponentEnergyCount,
        });
        const withTrigger = enqueueTriggeredCardEffects(
          { ...game, pendingAbilities: [] },
          [TriggerCondition.ON_LIVE_SUCCESS],
          { liveSuccessEvents: [createLiveSuccessEvent(PLAYER1, [sourceCardId], 7)] }
        );
        expect(withTrigger.pendingAbilities).toEqual([
          expect.objectContaining({ abilityId: HAPPY_END_ABILITY_ID, sourceCardId }),
        ]);

        const started = resolvePendingCardEffects(withTrigger).gameState;
        expect(started.activeEffect?.effectText).toContain(
          `当前自己能量2张，对方能量${opponentEnergyCount}张，${
            expectedBonus > 0 ? '满足条件' : '未满足条件'
          }，实际[スコア]+${expectedBonus}`
        );
        const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);

        expect(resolved.pendingAbilities).toEqual([]);
        expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(7 + expectedBonus);
        expect(scoreModifiers(resolved, HAPPY_END_ABILITY_ID)).toEqual(
          expectedBonus > 0
            ? [
                {
                  kind: 'SCORE',
                  playerId: PLAYER1,
                  countDelta: 1,
                  liveCardId: sourceCardId,
                  sourceCardId,
                  abilityId: HAPPY_END_ABILITY_ID,
                },
              ]
            : []
        );
        expect(
          abilityActions(resolved, HAPPY_END_ABILITY_ID).map((action) => action.payload)
        ).toEqual([expect.objectContaining({ step, scoreBonus: expectedBonus })]);
      }
    );
  });

  it('rejects a different base card even when the queued ability and energy counts match', () => {
    const { game } = setup({
      sourceLive: { ...HAPPY_END_LIVE, cardCode: 'PL!-bp6-022-L' },
      abilityId: HAPPY_END_ABILITY_ID,
      ownEnergyCount: 2,
      opponentEnergyCount: 3,
    });
    const resolved = resolveSingle(game, HAPPY_END_ABILITY_ID);

    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    expect(scoreModifiers(resolved, HAPPY_END_ABILITY_ID)).toEqual([]);
    expect(abilityActions(resolved, HAPPY_END_ABILITY_ID).at(-1)?.payload).toMatchObject({
      step: 'SOURCE_LIVE_NOT_IN_OWN_LIVE_ZONE',
      scoreBonus: 0,
    });
  });

  it('replaces SCORE on re-entry and removes it when the source leaves LIVE', () => {
    const { game, sourceCardId } = setup({
      sourceLive: { ...HAPPY_END_LIVE, cardCode: SYNTHETIC_HAPPY_END_CODE },
      abilityId: HAPPY_END_ABILITY_ID,
      ownEnergyCount: 2,
      opponentEnergyCount: 3,
    });
    const first = resolveSingle(game, HAPPY_END_ABILITY_ID);
    const repeated = resolveSingle(
      {
        ...first,
        pendingAbilities: [pending(HAPPY_END_ABILITY_ID, sourceCardId, 1)],
      },
      HAPPY_END_ABILITY_ID
    );

    expect(repeated.liveResolution.playerScores.get(PLAYER1)).toBe(8);
    expect(scoreModifiers(repeated, HAPPY_END_ABILITY_ID)).toHaveLength(1);
    expect(abilityActions(repeated, HAPPY_END_ABILITY_ID).at(-1)?.payload).toMatchObject({
      scoreBonus: 1,
      scoreDelta: 0,
    });

    const withoutSource = updatePlayer(repeated, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, sourceCardId),
      waitingRoom: addCardToZone(player.waitingRoom, sourceCardId),
    }));
    const stale = resolveSingle(
      {
        ...withoutSource,
        pendingAbilities: [pending(HAPPY_END_ABILITY_ID, sourceCardId, 2)],
      },
      HAPPY_END_ABILITY_ID
    );
    expect(stale.pendingAbilities).toEqual([]);
    expect(stale.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    expect(scoreModifiers(stale, HAPPY_END_ABILITY_ID)).toEqual([]);
    expect(abilityActions(stale, HAPPY_END_ABILITY_ID).at(-1)?.payload).toMatchObject({
      step: 'SOURCE_LIVE_NOT_IN_OWN_LIVE_ZONE',
      scoreBonus: 0,
      scoreDelta: -1,
    });
  });
});
