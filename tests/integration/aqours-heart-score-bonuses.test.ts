import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  addAction,
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { addHeartLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID,
  PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID,
  S_BP6_024_LIVE_SUCCESS_OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
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

function createLive(cardCode: string, score: number): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createMember(id: string, hearts: readonly { color: HeartColor; count: number }[]): MemberCardData {
  return {
    cardCode: `PL!S-${id}`,
    name: id,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: hearts.map((heart) => createHeartIcon(heart.color, heart.count)),
  };
}

function createPendingAbility(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  index = 0
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:${index}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`${abilityId}:event:${index}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setupAqoursHeartScoreGame(options: {
  readonly abilityId: string;
  readonly timingId: TriggerCondition.ON_LIVE_START | TriggerCondition.ON_LIVE_SUCCESS;
  readonly sourceCardCode: string;
  readonly sourceScore: number;
  readonly memberHearts: readonly { color: HeartColor; count: number }[];
  readonly sourceInLiveZone?: boolean;
  readonly opponentLiveSucceeded?: boolean;
  readonly opponentRemainingHeartCount?: number;
  readonly opponentJudgmentRemainingHeartCount?: number;
  readonly activePlayerIndex?: number;
  readonly secondSource?: boolean;
}): {
  readonly game: GameState;
  readonly sourceLiveCardId: string;
  readonly secondSourceLiveCardId: string | null;
  readonly memberCardIds: readonly string[];
} {
  const sourceLive = createCardInstance(
    createLive(options.sourceCardCode, options.sourceScore),
    PLAYER1,
    'source-live'
  );
  const secondSourceLive = options.secondSource
    ? createCardInstance(createLive(options.sourceCardCode, options.sourceScore), PLAYER1, 'source-live-2')
    : null;
  const opponentLive = createCardInstance(createLive('PL!S-opponent-live', 1), PLAYER2, 'opponent-live');
  const members = options.memberHearts.map((heart, index) =>
    createCardInstance(createMember(`aqours-member-${index}`, [heart]), PLAYER1, `aqours-member-${index}`)
  );

  let game = createGameState('aqours-heart-score-bonuses', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    sourceLive,
    ...(secondSourceLive ? [secondSourceLive] : []),
    opponentLive,
    ...members,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone:
      options.sourceInLiveZone === false
        ? player.liveZone
        : [sourceLive, ...(secondSourceLive ? [secondSourceLive] : [])].reduce(
            (zone, liveCard) =>
              addCardToStatefulZone(zone, liveCard.instanceId, {
                orientation: OrientationState.ACTIVE,
                face: FaceState.FACE_UP,
              }),
            player.liveZone
          ),
    memberSlots: members.reduce((slots, member, index) => {
      const slot = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!;
      return placeCardInSlot(slots, slot, member.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }, player.memberSlots),
  }));
  const liveResults = new Map<string, boolean>([[sourceLive.instanceId, true]]);
  if (secondSourceLive) {
    liveResults.set(secondSourceLive.instanceId, true);
  }
  if (options.opponentLiveSucceeded === true) {
    liveResults.set(opponentLive.instanceId, true);
  }
  game = {
    ...game,
    activePlayerIndex: options.activePlayerIndex ?? 0,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: options.activePlayerIndex === 1 ? PLAYER2 : PLAYER1,
      liveResults,
      playerScores: new Map([[PLAYER1, options.sourceScore]]),
      playerRemainingHearts: new Map([
        [
          PLAYER2,
          options.opponentRemainingHeartCount && options.opponentRemainingHeartCount > 0
            ? [createHeartIcon(HeartColor.RED, options.opponentRemainingHeartCount)]
            : [],
        ],
      ]),
    },
    pendingAbilities: [
      createPendingAbility(
        options.abilityId,
        sourceLive.instanceId,
        options.timingId
      ),
      ...(secondSourceLive
        ? [
            createPendingAbility(
              options.abilityId,
              secondSourceLive.instanceId,
              options.timingId,
              1
            ),
          ]
        : []),
    ],
  };
  if (options.opponentLiveSucceeded === true) {
    const judgmentRemainingHeartCount =
      options.opponentJudgmentRemainingHeartCount ?? options.opponentRemainingHeartCount ?? 0;
    game = addAction(game, 'LIVE_JUDGMENT', PLAYER2, {
      action: 'AUTO_PERFORMANCE_JUDGMENT',
      liveResults: { [opponentLive.instanceId]: true },
      remainingHearts:
        judgmentRemainingHeartCount > 0
          ? [createHeartIcon(HeartColor.RED, judgmentRemainingHeartCount)]
          : [],
      remainingHeartTotalCount: judgmentRemainingHeartCount,
      automated: true,
    });
  }
  return {
    game,
    sourceLiveCardId: sourceLive.instanceId,
    secondSourceLiveCardId: secondSourceLive?.instanceId ?? null,
    memberCardIds: members.map((member) => member.instanceId),
  };
}

function resolveSinglePending(game: GameState): GameState {
  const started = resolvePendingCardEffects(game).gameState;
  expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
}

function scoreModifierFor(game: GameState, abilityId: string) {
  return game.liveResolution.liveModifiers.find(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === abilityId
  );
}

function latestPayload(game: GameState, abilityId: string) {
  return [...game.actionHistory]
    .reverse()
    .find((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    ?.payload;
}

describe('Aqours Heart score bonus LIVE cards', () => {
  it('PL!S-pb1-020-L adds SCORE +2 when Aqours members have ten effective green Hearts', () => {
    const { game, sourceLiveCardId } = setupAqoursHeartScoreGame({
      abilityId: PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_START,
      sourceCardCode: 'PL!S-pb1-020-L',
      sourceScore: 6,
      memberHearts: [
        { color: HeartColor.GREEN, count: 4 },
        { color: HeartColor.GREEN, count: 3 },
        { color: HeartColor.GREEN, count: 3 },
      ],
    });

    const resolved = resolveSinglePending(game);

    expect(scoreModifierFor(resolved, PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID)).toEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: sourceLiveCardId,
      abilityId: PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID,
      liveCardId: sourceLiveCardId,
    });
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(8);
    expect(latestPayload(resolved, PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      heartTotal: 10,
      scoreBonus: 2,
    });
  });

  it('PL!S-pb1-020-L does not add score below ten green Hearts', () => {
    const { game } = setupAqoursHeartScoreGame({
      abilityId: PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_START,
      sourceCardCode: 'PL!S-pb1-020-L',
      sourceScore: 6,
      memberHearts: [
        { color: HeartColor.GREEN, count: 4 },
        { color: HeartColor.GREEN, count: 3 },
        { color: HeartColor.GREEN, count: 2 },
      ],
    });

    const resolved = resolveSinglePending(game);

    expect(scoreModifierFor(resolved, PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID)).toBeUndefined();
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(latestPayload(resolved, PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      heartTotal: 9,
      scoreBonus: 0,
    });
  });

  it('PL!S-pb1-020-L counts effective Heart modifiers and manual pending selection opens confirm-only first', () => {
    const { game, sourceLiveCardId, memberCardIds } = setupAqoursHeartScoreGame({
      abilityId: PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_START,
      sourceCardCode: 'PL!S-pb1-020-L',
      sourceScore: 6,
      memberHearts: [
        { color: HeartColor.GREEN, count: 4 },
        { color: HeartColor.GREEN, count: 3 },
        { color: HeartColor.GREEN, count: 2 },
      ],
      secondSource: true,
    });
    const modifierResult = addHeartLiveModifierForMember(game, {
      playerId: PLAYER1,
      memberCardId: memberCardIds[0]!,
      sourceCardId: memberCardIds[0]!,
      abilityId: 'test:add-green-heart',
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
    });
    expect(modifierResult).not.toBeNull();

    const orderSelection = resolvePendingCardEffects(modifierResult!.gameState).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const confirmOnly = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      sourceLiveCardId
    );
    expect(confirmOnly.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmOnly.activeEffect?.effectText).toContain('[緑ハート]合计10个');
    expect(confirmOnly.activeEffect?.effectText).toContain('此LIVE分数+2');
    expect(confirmOnly.activeEffect?.effectText).not.toContain('满足阈值');
    expect(confirmOnly.activeEffect?.effectText).not.toContain('实际分数+2');
    expect(confirmOnly.liveResolution.playerScores.get(PLAYER1)).toBe(6);

    const resolved = confirmActiveEffectStep(confirmOnly, PLAYER1, confirmOnly.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(8);
  });

  it('PL!S-pb1-020-L consumes pending safely when the source is not in the LIVE zone', () => {
    const { game } = setupAqoursHeartScoreGame({
      abilityId: PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_START,
      sourceCardCode: 'PL!S-pb1-020-L',
      sourceScore: 6,
      memberHearts: [{ color: HeartColor.GREEN, count: 10 }],
      sourceInLiveZone: false,
    });

    const resolved = resolveSinglePending(game);

    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(latestPayload(resolved, PL_S_PB1_020_LIVE_START_AQOURS_GREEN_HEART_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      sourceInLiveZone: false,
      scoreBonus: 0,
    });
  });

  it('PL!S-pb1-021-L adds SCORE +2 with four blue Hearts and opponent no-surplus successful LIVE', () => {
    const { game } = setupAqoursHeartScoreGame({
      abilityId:
        PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_SUCCESS,
      sourceCardCode: 'PL!S-pb1-021-L',
      sourceScore: 1,
      memberHearts: [
        { color: HeartColor.BLUE, count: 2 },
        { color: HeartColor.BLUE, count: 1 },
        { color: HeartColor.BLUE, count: 1 },
      ],
      opponentLiveSucceeded: true,
      opponentRemainingHeartCount: 0,
    });

    const resolved = resolveSinglePending(game);

    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(latestPayload(resolved, PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      heartTotal: 4,
      opponentNoSurplusSuccessfulLiveThisTurn: true,
      scoreBonus: 2,
    });
    expect(resolved.liveResolution.playerRemainingHearts.get(PLAYER2)).toEqual([]);
  });

  it('PL!S-pb1-021-L does not add score when blue Hearts are below four', () => {
    const { game } = setupAqoursHeartScoreGame({
      abilityId:
        PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_SUCCESS,
      sourceCardCode: 'PL!S-pb1-021-L',
      sourceScore: 1,
      memberHearts: [{ color: HeartColor.BLUE, count: 3 }],
      opponentLiveSucceeded: true,
      opponentRemainingHeartCount: 0,
    });

    const resolved = resolveSinglePending(game);

    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(latestPayload(resolved, PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      heartTotal: 3,
      opponentNoSurplusSuccessfulLiveThisTurn: true,
      scoreBonus: 0,
    });
  });

  it('PL!S-pb1-021-L does not add score when opponent succeeded with surplus Hearts', () => {
    const { game } = setupAqoursHeartScoreGame({
      abilityId:
        PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_SUCCESS,
      sourceCardCode: 'PL!S-pb1-021-L',
      sourceScore: 1,
      memberHearts: [{ color: HeartColor.BLUE, count: 4 }],
      opponentLiveSucceeded: true,
      opponentRemainingHeartCount: 1,
    });

    const resolved = resolveSinglePending(game);

    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(resolved.liveResolution.playerRemainingHearts.get(PLAYER2)).toEqual([
      createHeartIcon(HeartColor.RED, 1),
    ]);
    expect(latestPayload(resolved, PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      opponentNoSurplusSuccessfulLiveThisTurn: false,
      scoreBonus: 0,
    });
  });

  it('PL!S-pb1-021-L uses judgment-time surplus even if an earlier LIVE_SUCCESS effect clears current surplus', () => {
    const { game } = setupAqoursHeartScoreGame({
      abilityId:
        PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_SUCCESS,
      sourceCardCode: 'PL!S-pb1-021-L',
      sourceScore: 1,
      memberHearts: [{ color: HeartColor.BLUE, count: 4 }],
      opponentLiveSucceeded: true,
      opponentRemainingHeartCount: 1,
      opponentJudgmentRemainingHeartCount: 1,
    });
    const clearOpponentSurplusLive = createCardInstance(
      createLive('PL!S-bp6-024-L', 5),
      PLAYER1,
      'clear-opponent-surplus-live'
    );
    let state = registerCards(game, [clearOpponentSurplusLive]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, clearOpponentSurplusLive.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    state = {
      ...state,
      pendingAbilities: [
        createPendingAbility(
          S_BP6_024_LIVE_SUCCESS_OPPONENT_LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
          clearOpponentSurplusLive.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS,
          99
        ),
        ...state.pendingAbilities,
      ],
    };

    const orderSelection = resolvePendingCardEffects(state).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      null,
      true
    );

    expect(resolved.liveResolution.playerRemainingHearts.get(PLAYER2)).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(
      latestPayload(
        resolved,
        PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toMatchObject({
      opponentNoSurplusSuccessfulLiveThisTurn: false,
      scoreBonus: 0,
    });
  });

  it('PL!S-pb1-021-L does not add score when opponent has no successful LIVE', () => {
    const { game } = setupAqoursHeartScoreGame({
      abilityId:
        PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_SUCCESS,
      sourceCardCode: 'PL!S-pb1-021-L',
      sourceScore: 1,
      memberHearts: [{ color: HeartColor.BLUE, count: 4 }],
      opponentLiveSucceeded: false,
      opponentRemainingHeartCount: 0,
    });

    const resolved = resolveSinglePending(game);

    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(latestPayload(resolved, PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      opponentNoSurplusSuccessfulLiveThisTurn: false,
      scoreBonus: 0,
    });
  });

  it('PL!S-pb1-021-L accepts opponent no-surplus success regardless of turn order facts', () => {
    const { game } = setupAqoursHeartScoreGame({
      abilityId:
        PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_SUCCESS,
      sourceCardCode: 'PL!S-pb1-021-L',
      sourceScore: 1,
      memberHearts: [{ color: HeartColor.BLUE, count: 4 }],
      opponentLiveSucceeded: true,
      opponentRemainingHeartCount: 0,
      activePlayerIndex: 1,
    });

    const resolved = resolveSinglePending(game);

    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(latestPayload(resolved, PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      opponentNoSurplusSuccessfulLiveThisTurn: true,
      scoreBonus: 2,
    });
  });

  it('PL!S-pb1-021-L consumes pending safely when the source is not in the LIVE zone', () => {
    const { game } = setupAqoursHeartScoreGame({
      abilityId:
        PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID,
      timingId: TriggerCondition.ON_LIVE_SUCCESS,
      sourceCardCode: 'PL!S-pb1-021-L',
      sourceScore: 1,
      memberHearts: [{ color: HeartColor.BLUE, count: 4 }],
      sourceInLiveZone: false,
      opponentLiveSucceeded: true,
      opponentRemainingHeartCount: 0,
    });

    const resolved = resolveSinglePending(game);

    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(latestPayload(resolved, PL_S_PB1_021_LIVE_SUCCESS_AQOURS_BLUE_HEART_OPPONENT_NO_SURPLUS_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      sourceInLiveZone: false,
      scoreBonus: 0,
    });
  });
});
