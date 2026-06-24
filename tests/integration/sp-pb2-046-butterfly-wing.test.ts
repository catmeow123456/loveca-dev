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
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  KOTORI_LIVE_START_HEART_ABILITY_ID,
  SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID,
  SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID,
  SP_PB2_046_LIVE_SUCCESS_STAGE_MEMBER_LIVE_START_THIS_LIVE_SCORE_ABILITY_ID,
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

function createButterflyWing(cardCode = 'PL!SP-pb2-046-L'): LiveCardData {
  return {
    cardCode,
    name: 'Butterfly Wing',
    groupName: 'Liella!',
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 3, [HeartColor.RAINBOW]: 3 }),
  };
}

function createZettaiLover(): LiveCardData {
  return {
    cardCode: 'PL!SP-pb2-045-L',
    name: '絶対的LOVER',
    groupName: 'Liella!',
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 2 }),
  };
}

function createPlainLive(): LiveCardData {
  return {
    cardCode: 'PL!SP-test-live',
    name: 'Test Live',
    groupName: 'Liella!',
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createNatsumi(): MemberCardData {
  return {
    cardCode: 'PL!SP-bp2-009-SEC',
    name: '鬼塚夏美',
    groupName: 'Liella!',
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createKotori(): MemberCardData {
  return {
    cardCode: 'PL!-sd1-003-SD',
    name: '南ことり',
    groupName: "μ's",
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createPlainMember(cardCode = 'PL!SP-test-member'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: 'Liella!',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupLiveStartState(options: {
  readonly includeButterfly?: boolean;
  readonly includeZettai?: boolean;
  readonly member?: MemberCardData;
  readonly handCount?: number;
}): {
  readonly game: GameState;
  readonly butterfly: ReturnType<typeof createCardInstance> | null;
  readonly zettai: ReturnType<typeof createCardInstance> | null;
  readonly live: ReturnType<typeof createCardInstance>;
  readonly member: ReturnType<typeof createCardInstance> | null;
} {
  const butterfly = options.includeButterfly
    ? createCardInstance(createButterflyWing(), PLAYER1, 'butterfly-live')
    : null;
  const zettai = options.includeZettai
    ? createCardInstance(createZettaiLover(), PLAYER1, 'zettai-live')
    : null;
  const live = createCardInstance(createPlainLive(), PLAYER1, 'plain-live');
  const member = options.member
    ? createCardInstance(options.member, PLAYER1, 'stage-member')
    : null;
  const handCards = Array.from({ length: options.handCount ?? 4 }, (_, index) =>
    createCardInstance(createPlainMember(`HAND-${index}`), PLAYER1, `hand-${index}`)
  );
  const liveCards = [butterfly, zettai, live].filter(
    (card): card is ReturnType<typeof createCardInstance> => card !== null
  );

  let game = createGameState('sp-pb2-046-butterfly-wing-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [...liveCards, ...(member ? [member] : []), ...handCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const liveZone = liveCards.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.liveZone
    );
    return {
      ...player,
      hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
      liveZone,
      memberSlots: member
        ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          })
        : player.memberSlots,
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[PLAYER1, 2]]),
      performingPlayerId: PLAYER1,
    },
  };

  return { game, butterfly, zettai, live, member };
}

function setupLiveSuccessState(options: {
  readonly ownMember?: MemberCardData;
  readonly opponentMember?: MemberCardData;
  readonly includeSecondButterfly?: boolean;
  readonly initialScore?: number;
}): {
  readonly game: GameState;
  readonly butterfly: ReturnType<typeof createCardInstance>;
  readonly secondButterfly: ReturnType<typeof createCardInstance> | null;
  readonly ownMember: ReturnType<typeof createCardInstance> | null;
  readonly opponentMember: ReturnType<typeof createCardInstance> | null;
} {
  const butterfly = createCardInstance(createButterflyWing(), PLAYER1, 'butterfly-live');
  const secondButterfly = options.includeSecondButterfly
    ? createCardInstance(createButterflyWing(), PLAYER1, 'butterfly-live-2')
    : null;
  const ownMember = options.ownMember
    ? createCardInstance(options.ownMember, PLAYER1, 'own-stage-member')
    : null;
  const opponentMember = options.opponentMember
    ? createCardInstance(options.opponentMember, PLAYER2, 'opponent-stage-member')
    : null;
  const liveCards = [butterfly, ...(secondButterfly ? [secondButterfly] : [])];
  const cards = [
    ...liveCards,
    ...(ownMember ? [ownMember] : []),
    ...(opponentMember ? [opponentMember] : []),
  ];

  let game = createGameState(
    'sp-pb2-046-butterfly-wing-live-success',
    PLAYER1,
    'P1',
    PLAYER2,
    'P2'
  );
  game = registerCards(game, cards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: liveCards.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.liveZone
    ),
    memberSlots: ownMember
      ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ownMember.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        })
      : player.memberSlots,
  }));
  if (opponentMember) {
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        opponentMember.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    }));
  }
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map(liveCards.map((card) => [card.instanceId, true] as const)),
      playerScores: new Map([[PLAYER1, options.initialScore ?? 2]]),
      performingPlayerId: PLAYER1,
    },
  };

  return { game, butterfly, secondButterfly, ownMember, opponentMember };
}

function hasAbilityAction(
  game: GameState,
  actionType: 'TRIGGER_ABILITY' | 'RESOLVE_ABILITY',
  abilityId: string
): boolean {
  return game.actionHistory.some(
    (action) => action.type === actionType && action.payload.abilityId === abilityId
  );
}

function butterflyScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        SP_PB2_046_LIVE_SUCCESS_STAGE_MEMBER_LIVE_START_THIS_LIVE_SCORE_ABILITY_ID
  );
}

function latestButterflyPayload(game: GameState) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PB2_046_LIVE_SUCCESS_STAGE_MEMBER_LIVE_START_THIS_LIVE_SCORE_ABILITY_ID
    )?.payload;
}

describe('PL!SP-pb2-046-L Butterfly Wing workflow', () => {
  it('prevents own stage member natural LIVE_START from entering pending or resolving', () => {
    const { game } = setupLiveStartState({
      includeButterfly: true,
      member: createNatsumi(),
      handCount: 5,
    });

    const queuedState = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START]);
    const result = resolvePendingCardEffects(queuedState);

    expect(queuedState.pendingAbilities).toEqual([]);
    expect(result.resolvedAbilityIds).toEqual([]);
    expect(result.gameState.pendingAbilities).toEqual([]);
    expect(
      hasAbilityAction(
        result.gameState,
        'TRIGGER_ABILITY',
        SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(
      hasAbilityAction(
        result.gameState,
        'RESOLVE_ABILITY',
        SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(result.gameState.liveResolution.liveModifiers).toEqual([]);
  });

  it('does not prevent LIVE_CARD source LIVE_START abilities in the same LIVE', () => {
    const { game } = setupLiveStartState({
      includeButterfly: true,
      includeZettai: true,
      member: createNatsumi(),
      handCount: 5,
    });

    const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);

    expect(result.success).toBe(true);
    expect(result.gameState.pendingAbilities).toEqual([]);
    expect(
      hasAbilityAction(
        result.gameState,
        'TRIGGER_ABILITY',
        SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(
      hasAbilityAction(
        result.gameState,
        'RESOLVE_ABILITY',
        SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toBe(true);
  });

  it('allows stage member LIVE_START to resolve when Butterfly Wing is not in liveZone', () => {
    const { game, member } = setupLiveStartState({
      includeButterfly: false,
      member: createNatsumi(),
      handCount: 5,
    });

    const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);

    expect(result.success).toBe(true);
    expect(result.gameState.pendingAbilities).toEqual([]);
    expect(
      hasAbilityAction(
        result.gameState,
        'TRIGGER_ABILITY',
        SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(true);
    expect(
      hasAbilityAction(
        result.gameState,
        'RESOLVE_ABILITY',
        SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(true);
    expect(result.gameState.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: member!.instanceId,
      abilityId: SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID,
    });
  });

  it('adds this-live SCORE +1 at LIVE success when own stage has a LIVE_START member even if it was just prevented', () => {
    const { game, butterfly, ownMember } = setupLiveSuccessState({
      ownMember: createKotori(),
      initialScore: 2,
    });
    const afterLiveStart = new GameService().executeCheckTiming(game, [
      TriggerCondition.ON_LIVE_START,
    ]);
    expect(afterLiveStart.success).toBe(true);
    expect(afterLiveStart.gameState.pendingAbilities).toEqual([]);
    expect(
      hasAbilityAction(
        afterLiveStart.gameState,
        'TRIGGER_ABILITY',
        KOTORI_LIVE_START_HEART_ABILITY_ID
      )
    ).toBe(false);

    const result = new GameService().executeCheckTiming(afterLiveStart.gameState, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);

    expect(result.success).toBe(true);
    expect(butterflyScoreModifiers(result.gameState)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: butterfly.instanceId,
        sourceCardId: butterfly.instanceId,
        abilityId: SP_PB2_046_LIVE_SUCCESS_STAGE_MEMBER_LIVE_START_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(result.gameState.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(latestButterflyPayload(result.gameState)).toMatchObject({
      liveStartMemberCardIds: [ownMember!.instanceId],
      conditionMet: true,
      scoreBonus: 1,
    });
  });

  it('records scoreBonus 0 and consumes pending when own stage has no LIVE_START member', () => {
    const { game } = setupLiveSuccessState({
      ownMember: createPlainMember(),
      initialScore: 2,
    });

    const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);

    expect(result.success).toBe(true);
    expect(result.gameState.pendingAbilities).toEqual([]);
    expect(butterflyScoreModifiers(result.gameState)).toEqual([]);
    expect(result.gameState.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(latestButterflyPayload(result.gameState)).toMatchObject({
      liveStartMemberCardIds: [],
      conditionMet: false,
      scoreBonus: 0,
    });
  });

  it('does not count opponent stage members for the LIVE_SUCCESS score condition', () => {
    const { game } = setupLiveSuccessState({
      opponentMember: createKotori(),
      initialScore: 2,
    });

    const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);

    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(butterflyScoreModifiers(result.gameState)).toEqual([]);
    expect(latestButterflyPayload(result.gameState)).toMatchObject({
      liveStartMemberCardIds: [],
      conditionMet: false,
      scoreBonus: 0,
    });
  });

  it('continues ordered pending resolution for multiple Butterfly Wing live-success abilities', () => {
    const { game } = setupLiveSuccessState({
      ownMember: createKotori(),
      includeSecondButterfly: true,
      initialScore: 2,
    });
    const checkResult = new GameService().executeCheckTiming(game, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);
    expect(checkResult.success).toBe(true);
    expect(checkResult.gameState.activeEffect?.canResolveInOrder).toBe(true);

    const session = createGameSession();
    session.createGame('sp-pb2-046-butterfly-wing-order', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;
    const orderResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        checkResult.gameState.activeEffect!.id,
        undefined,
        null,
        true
      )
    );

    expect(orderResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(butterflyScoreModifiers(session.state!)).toHaveLength(2);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_046_LIVE_SUCCESS_STAGE_MEMBER_LIVE_START_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(2);
  });
});
