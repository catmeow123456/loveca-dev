import { describe, expect, it } from 'vitest';
import type { HeartIcon, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  S_BP6_020_GRANTED_LIVE_SUCCESS_DRAW_ONE_ABILITY_ID,
  S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
  S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID,
  S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
  S_BP6_024_LIVE_SUCCESS_OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
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

function createLiveCard(cardCode: string, score: number): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createMemberCard(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createPendingAbility(
  abilityId: string,
  sourceCardId: string,
  index = 0
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:${index}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`${abilityId}:event:${index}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function prepareLiveSuccessGame(options: {
  readonly sourceCardCode: string;
  readonly sourceScore: number;
  readonly abilityId: string;
  readonly initialScore?: number;
  readonly ownEnergyCount?: number;
  readonly opponentEnergyCount?: number;
  readonly ownRemainingHearts?: readonly HeartIcon[];
  readonly opponentRemainingHearts?: readonly HeartIcon[];
}): { readonly game: GameState; readonly sourceLiveCardId: string } {
  const sourceLive = createCardInstance(
    createLiveCard(options.sourceCardCode, options.sourceScore),
    PLAYER1,
    options.sourceCardCode
  );
  const ownEnergyCards = Array.from({ length: options.ownEnergyCount ?? 0 }, (_, index) =>
    createCardInstance(createMemberCard(`PL!S-own-energy-${index}`), PLAYER1, `own-energy-${index}`)
  );
  const opponentEnergyCards = Array.from(
    { length: options.opponentEnergyCount ?? 0 },
    (_, index) =>
      createCardInstance(
        createMemberCard(`PL!S-opponent-energy-${index}`),
        PLAYER2,
        `opponent-energy-${index}`
      )
  );
  let game = registerCards(
    createGameState(options.sourceCardCode, PLAYER1, 'P1', PLAYER2, 'P2'),
    [sourceLive, ...ownEnergyCards, ...opponentEnergyCards]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: [sourceLive.instanceId],
      cardStates: new Map([
        [sourceLive.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
    energyZone: ownEnergyCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.energyZone
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    energyZone: opponentEnergyCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.energyZone
    ),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      liveResults: new Map([[sourceLive.instanceId, true]]),
      playerScores: new Map([[PLAYER1, options.initialScore ?? options.sourceScore]]),
      playerRemainingHearts: new Map([
        [PLAYER1, options.ownRemainingHearts ?? []],
        [PLAYER2, options.opponentRemainingHearts ?? []],
      ]),
    },
    pendingAbilities: [createPendingAbility(options.abilityId, sourceLive.instanceId)],
  };
  return { game, sourceLiveCardId: sourceLive.instanceId };
}

function resolveSinglePending(game: GameState): GameState {
  const started = resolvePendingCardEffects(game).gameState;
  expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  const resolved = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
  expect(resolved.activeEffect).toBeNull();
  return resolved;
}

function abilityActions(game: GameState, abilityId: string) {
  return game.actionHistory.filter(
    (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId
  );
}

function scoreModifierFor(game: GameState, abilityId: string) {
  return game.liveResolution.liveModifiers.find(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === abilityId
  );
}

function setOwnCheerResolution(
  game: GameState,
  cardIds: readonly string[],
  resolutionCardIds: readonly string[],
  revealedCardIds: readonly string[] = resolutionCardIds
): GameState {
  const withEvent = emitGameEvent(game, createCheerEvent(PLAYER1, cardIds, cardIds.length));
  return {
    ...withEvent,
    resolutionZone: {
      ...withEvent.resolutionZone,
      cardIds: [...resolutionCardIds],
      revealedCardIds: [...revealedCardIds],
    },
    liveResolution: {
      ...withEvent.liveResolution,
      firstPlayerCheerCardIds: [...cardIds],
    },
  };
}

describe('PL!S-bp6 LIVE_SUCCESS focused effects', () => {
  it('PL!S-bp6-020-L granted LIVE_SUCCESS draws one for the same source live and turn', () => {
    const { game, sourceLiveCardId } = prepareLiveSuccessGame({
      sourceCardCode: 'PL!S-bp6-020-L',
      sourceScore: 4,
      abilityId: S_BP6_020_GRANTED_LIVE_SUCCESS_DRAW_ONE_ABILITY_ID,
    });
    const drawCard = createCardInstance(createMemberCard('PL!S-bp6-020-draw'), PLAYER1, 'bp6-020-draw');
    let state = registerCards(game, [drawCard]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
    }));
    state = addAction(state, 'RESOLVE_ABILITY', PLAYER1, {
      abilityId: S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
      sourceCardId: sourceLiveCardId,
      step: 'GRANT_LIVE_SUCCESS_DRAW_ONE',
      grantedTurnCount: state.turnCount,
      sourceLiveCardId,
    });

    const resolved = resolvePendingCardEffects(state).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toHaveLength(0);
    expect(resolved.players[0].hand.cardIds).toEqual([drawCard.instanceId]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([]);
    expect(abilityActions(resolved, S_BP6_020_GRANTED_LIVE_SUCCESS_DRAW_ONE_ABILITY_ID)[0]?.payload).toMatchObject({
      step: 'GRANTED_LIVE_SUCCESS_DRAW_ONE',
      sourceLiveCardId,
      grantedTurnCount: state.turnCount,
      sourceLiveSucceeded: true,
      drawnCardIds: [drawCard.instanceId],
    });
  });

  it('PL!S-bp6-020-L granted LIVE_SUCCESS no-ops without option A and does not open confirmation', () => {
    const { game } = prepareLiveSuccessGame({
      sourceCardCode: 'PL!S-bp6-020-L',
      sourceScore: 4,
      abilityId: S_BP6_020_GRANTED_LIVE_SUCCESS_DRAW_ONE_ABILITY_ID,
    });
    const drawCard = createCardInstance(
      createMemberCard('PL!S-bp6-020-not-drawn'),
      PLAYER1,
      'bp6-020-not-drawn'
    );
    let state = registerCards(game, [drawCard]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
    }));

    const resolved = resolvePendingCardEffects(state).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toHaveLength(0);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([drawCard.instanceId]);
    expect(abilityActions(resolved, S_BP6_020_GRANTED_LIVE_SUCCESS_DRAW_ONE_ABILITY_ID)[0]?.payload).toMatchObject({
      step: 'GRANTED_DRAW_GUARD_NOT_MET',
      grantedTurnCount: null,
      sourceLiveSucceeded: true,
      drawnCardIds: [],
    });
  });

  it('PL!S-bp6-020-L granted LIVE_SUCCESS no-ops when the source live did not succeed this time', () => {
    const { game, sourceLiveCardId } = prepareLiveSuccessGame({
      sourceCardCode: 'PL!S-bp6-020-L',
      sourceScore: 4,
      abilityId: S_BP6_020_GRANTED_LIVE_SUCCESS_DRAW_ONE_ABILITY_ID,
    });
    const drawCard = createCardInstance(
      createMemberCard('PL!S-bp6-020-failed-live-draw'),
      PLAYER1,
      'bp6-020-failed-live-draw'
    );
    let state = registerCards(game, [drawCard]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
    }));
    state = {
      ...state,
      liveResolution: {
        ...state.liveResolution,
        liveResults: new Map([[sourceLiveCardId, false]]),
      },
    };
    state = addAction(state, 'RESOLVE_ABILITY', PLAYER1, {
      abilityId: S_BP6_020_LIVE_START_CHOOSE_ADVENTURE_TYPE_ABILITY_ID,
      sourceCardId: sourceLiveCardId,
      step: 'GRANT_LIVE_SUCCESS_DRAW_ONE',
      grantedTurnCount: state.turnCount,
      sourceLiveCardId,
    });

    const resolved = resolvePendingCardEffects(state).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([drawCard.instanceId]);
    expect(abilityActions(resolved, S_BP6_020_GRANTED_LIVE_SUCCESS_DRAW_ONE_ABILITY_ID)[0]?.payload).toMatchObject({
      step: 'GRANTED_DRAW_GUARD_NOT_MET',
      sourceLiveSucceeded: false,
      drawnCardIds: [],
    });
  });

  it('PL!S-bp6-022-L adds this-live SCORE +1 when opponent energy is greater', () => {
    const { game, sourceLiveCardId } = prepareLiveSuccessGame({
      sourceCardCode: 'PL!S-bp6-022-L',
      sourceScore: 7,
      abilityId: S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID,
      ownEnergyCount: 2,
      opponentEnergyCount: 3,
    });

    const state = resolveSinglePending(game);

    expect(scoreModifierFor(
      state,
      S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID
    )).toEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: sourceLiveCardId,
      sourceCardId: sourceLiveCardId,
      abilityId: S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(8);
  });

  it.each([
    { ownEnergyCount: 2, opponentEnergyCount: 2 },
    { ownEnergyCount: 3, opponentEnergyCount: 2 },
  ])(
    'PL!S-bp6-022-L consumes without scoring when opponent energy is not greater',
    ({ ownEnergyCount, opponentEnergyCount }) => {
      const { game } = prepareLiveSuccessGame({
        sourceCardCode: 'PL!S-bp6-022-L',
        sourceScore: 7,
        abilityId: S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID,
        ownEnergyCount,
        opponentEnergyCount,
      });

      const state = resolveSinglePending(game);

      expect(scoreModifierFor(
        state,
        S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID
      )).toBeUndefined();
      expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(7);
      expect(abilityActions(
        state,
        S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID
      )).toHaveLength(1);
    }
  );

  it('PL!S-bp6-023-L adds this-live SCORE +1 for own cheer-revealed LIVE still in this resolution', () => {
    const { game, sourceLiveCardId } = prepareLiveSuccessGame({
      sourceCardCode: 'PL!S-bp6-023-L',
      sourceScore: 4,
      abilityId: S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
    });
    const cheerLive = createCardInstance(createLiveCard('PL!S-cheer-live', 1), PLAYER1, 'cheer-live');
    let state = registerCards(game, [cheerLive]);
    state = setOwnCheerResolution(state, [cheerLive.instanceId], [cheerLive.instanceId]);

    const resolved = resolveSinglePending(state);

    expect(scoreModifierFor(
      resolved,
      S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID
    )).toEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: sourceLiveCardId,
      sourceCardId: sourceLiveCardId,
      abilityId: S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('PL!S-bp6-023-L counts additional cheer LIVE cards appended to current cheer ids', () => {
    const { game, sourceLiveCardId } = prepareLiveSuccessGame({
      sourceCardCode: 'PL!S-bp6-023-L',
      sourceScore: 4,
      abilityId: S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
    });
    const ordinaryCheerMember = createCardInstance(
      createMemberCard('PL!S-ordinary-cheer-member'),
      PLAYER1,
      'ordinary-cheer-member'
    );
    const additionalCheerLive = createCardInstance(
      createLiveCard('PL!S-additional-cheer-live', 1),
      PLAYER1,
      'additional-cheer-live'
    );
    let state = registerCards(game, [ordinaryCheerMember, additionalCheerLive]);
    state = emitGameEvent(
      state,
      createCheerEvent(PLAYER1, [ordinaryCheerMember.instanceId], 1, { additional: false })
    );
    state = emitGameEvent(
      state,
      createCheerEvent(PLAYER1, [additionalCheerLive.instanceId], 1, { additional: true })
    );
    state = {
      ...state,
      resolutionZone: {
        ...state.resolutionZone,
        cardIds: [ordinaryCheerMember.instanceId, additionalCheerLive.instanceId],
        revealedCardIds: [ordinaryCheerMember.instanceId, additionalCheerLive.instanceId],
      },
      liveResolution: {
        ...state.liveResolution,
        firstPlayerCheerCardIds: [ordinaryCheerMember.instanceId, additionalCheerLive.instanceId],
      },
    };

    const resolved = resolveSinglePending(state);

    expect(scoreModifierFor(
      resolved,
      S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID
    )).toEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: sourceLiveCardId,
      sourceCardId: sourceLiveCardId,
      abilityId: S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(abilityActions(
      resolved,
      S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID
    )[0]?.payload).toMatchObject({
      ownCheerCardIds: [ordinaryCheerMember.instanceId, additionalCheerLive.instanceId],
      matchingCardIds: [additionalCheerLive.instanceId],
      scoreBonus: 1,
    });
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('PL!S-bp6-023-L ignores non-LIVE, opponent-only, stale, and unrevealed cheer ids', () => {
    const cases: readonly {
      readonly label: string;
      readonly configure: (game: GameState) => GameState;
    }[] = [
      {
        label: 'own non-LIVE',
        configure: (game) => {
          const member = createCardInstance(createMemberCard('PL!S-cheer-member'), PLAYER1, 'cheer-member');
          return setOwnCheerResolution(registerCards(game, [member]), [member.instanceId], [member.instanceId]);
        },
      },
      {
        label: 'opponent only',
        configure: (game) => {
          const opponentLive = createCardInstance(
            createLiveCard('PL!S-opponent-cheer-live', 1),
            PLAYER2,
            'opponent-cheer-live'
          );
          const registered = registerCards(game, [opponentLive]);
          const withOpponentEvent = emitGameEvent(
            registered,
            createCheerEvent(PLAYER2, [opponentLive.instanceId], 1)
          );
          return {
            ...withOpponentEvent,
            resolutionZone: {
              ...withOpponentEvent.resolutionZone,
              cardIds: [opponentLive.instanceId],
              revealedCardIds: [opponentLive.instanceId],
            },
            liveResolution: {
              ...withOpponentEvent.liveResolution,
              secondPlayerCheerCardIds: [opponentLive.instanceId],
            },
          };
        },
      },
      {
        label: 'stale not in resolution',
        configure: (game) => {
          const staleLive = createCardInstance(createLiveCard('PL!S-stale-live', 1), PLAYER1, 'stale-live');
          return setOwnCheerResolution(registerCards(game, [staleLive]), [staleLive.instanceId], []);
        },
      },
      {
        label: 'not revealed in resolution',
        configure: (game) => {
          const unrevealedLive = createCardInstance(
            createLiveCard('PL!S-unrevealed-live', 1),
            PLAYER1,
            'unrevealed-live'
          );
          return setOwnCheerResolution(
            registerCards(game, [unrevealedLive]),
            [unrevealedLive.instanceId],
            [unrevealedLive.instanceId],
            []
          );
        },
      },
    ];

    for (const testCase of cases) {
      const { game } = prepareLiveSuccessGame({
        sourceCardCode: 'PL!S-bp6-023-L',
        sourceScore: 4,
        abilityId: S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
      });
      const state = resolveSinglePending(testCase.configure(game));

      expect(
        scoreModifierFor(state, S_BP6_023_LIVE_SUCCESS_OWN_CHEER_LIVE_THIS_LIVE_SCORE_ABILITY_ID),
        testCase.label
      ).toBeUndefined();
      expect(state.liveResolution.playerScores.get(PLAYER1), testCase.label).toBe(4);
    }
  });

  it.each([
    { label: 'zero', opponentRemainingHearts: [], expectedScore: 5, expectedLost: 0 },
    {
      label: 'one',
      opponentRemainingHearts: [{ color: HeartColor.BLUE, count: 1 }],
      expectedScore: 5,
      expectedLost: 1,
    },
    {
      label: 'two or more',
      opponentRemainingHearts: [
        { color: HeartColor.BLUE, count: 1 },
        { color: HeartColor.RAINBOW, count: 2 },
      ],
      expectedScore: 6,
      expectedLost: 3,
    },
  ])(
    'PL!S-bp6-024-L clears opponent remaining hearts for $label and scores only at 2+',
    ({ opponentRemainingHearts, expectedScore, expectedLost }) => {
      const ownRemainingHearts = [{ color: HeartColor.RED, count: 2 }];
      const { game, sourceLiveCardId } = prepareLiveSuccessGame({
        sourceCardCode: 'PL!S-bp6-024-L',
        sourceScore: 5,
        abilityId: S_BP6_024_LIVE_SUCCESS_OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
        ownRemainingHearts,
        opponentRemainingHearts,
      });

      const state = resolveSinglePending(game);

      expect(state.liveResolution.playerRemainingHearts.get(PLAYER2)).toEqual([]);
      expect(state.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual(ownRemainingHearts);
      expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(expectedScore);
      expect(abilityActions(
        state,
        S_BP6_024_LIVE_SUCCESS_OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE_ABILITY_ID
      )[0]?.payload).toMatchObject({
        lostTotalCount: expectedLost,
        scoreBonus: expectedLost >= 2 ? 1 : 0,
      });
      if (expectedLost >= 2) {
        expect(scoreModifierFor(
          state,
          S_BP6_024_LIVE_SUCCESS_OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE_ABILITY_ID
        )).toEqual({
          kind: 'SCORE',
          playerId: PLAYER1,
          countDelta: 1,
          liveCardId: sourceLiveCardId,
          sourceCardId: sourceLiveCardId,
          abilityId: S_BP6_024_LIVE_SUCCESS_OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
        });
      }
    }
  );

  it('continues ordered LIVE_SUCCESS resolution after no-interaction pending abilities', () => {
    const firstLive = createCardInstance(createLiveCard('PL!S-bp6-022-L', 7), PLAYER1, 'ordered-022');
    const secondLive = createCardInstance(createLiveCard('PL!S-bp6-024-L', 5), PLAYER1, 'ordered-024');
    const opponentEnergyCards = [0, 1, 2].map((index) =>
      createCardInstance(createMemberCard(`PL!S-opponent-energy-${index}`), PLAYER2, `ordered-energy-${index}`)
    );
    let game = registerCards(createGameState('s-bp6-ordered', PLAYER1, 'P1', PLAYER2, 'P2'), [
      firstLive,
      secondLive,
      ...opponentEnergyCards,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: [firstLive.instanceId, secondLive.instanceId],
      },
    }));
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      energyZone: opponentEnergyCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.energyZone
      ),
    }));
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([[PLAYER1, 12]]),
        playerRemainingHearts: new Map([[PLAYER2, [{ color: HeartColor.GREEN, count: 1 }]]]),
      },
      pendingAbilities: [
        createPendingAbility(
          S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID,
          firstLive.instanceId,
          1
        ),
        createPendingAbility(
          S_BP6_024_LIVE_SUCCESS_OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
          secondLive.instanceId,
          2
        ),
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      null,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toHaveLength(0);
    expect(abilityActions(
      resolved,
      S_BP6_022_LIVE_SUCCESS_OPPONENT_ENERGY_MORE_THIS_LIVE_SCORE_ABILITY_ID
    )).toHaveLength(1);
    expect(abilityActions(
      resolved,
      S_BP6_024_LIVE_SUCCESS_OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE_ABILITY_ID
    )).toHaveLength(1);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(13);
  });
});
