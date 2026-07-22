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
import {
  createConfirmEffectStepCommand,
  createConfirmPerformanceOutcomeCommand,
} from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID,
  SP_PB2_048_LIVE_START_DIFFERENT_NAMED_CATCHU_REQUIREMENT_AND_SCORE_ABILITY_ID,
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
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createDistortion(): LiveCardData {
  return {
    cardCode: 'PL!SP-pb2-048-L',
    name: 'ディストーション',
    groupNames: ['Liella!'],
    unitName: 'CatChu!',
    cardType: CardType.LIVE,
    score: 6,
    requirements: createHeartRequirement({
      [HeartColor.RED]: 6,
      [HeartColor.RAINBOW]: 9,
    }),
  };
}

function createZettaiLover(): LiveCardData {
  return {
    cardCode: 'PL!SP-pb2-045-L',
    name: '絶対的LOVER',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 2 }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly unitName?: string;
  readonly groupNames?: readonly string[];
  readonly purpleHearts?: number;
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, options.purpleHearts ?? 1)],
  };
}

function createCatchuMember(name: string, slot: SlotPosition): MemberCardData {
  return createMember({
    cardCode: `PL!SP-catchu-${slot}`,
    name,
    unitName: 'CatChu!',
    purpleHearts: 4,
  });
}

function setupState(options: {
  readonly members?: Partial<Record<SlotPosition, MemberCardData>>;
  readonly includeZettai?: boolean;
  readonly initialScore?: number;
}): {
  readonly game: GameState;
  readonly distortion: ReturnType<typeof createCardInstance>;
  readonly members: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>>;
} {
  const distortion = createCardInstance(createDistortion(), PLAYER1, 'distortion-live');
  const zettai = options.includeZettai
    ? createCardInstance(createZettaiLover(), PLAYER1, 'zettai-live')
    : null;
  const memberEntries = Object.entries(options.members ?? {}).map(([slot, data]) => {
    const card = createCardInstance(data, PLAYER1, `member-${slot.toLowerCase()}`);
    return [slot as SlotPosition, card] as const;
  });
  const liveCards = [distortion, ...(zettai ? [zettai] : [])];

  let game = createGameState('sp-pb2-048-distortion', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [...liveCards, ...memberEntries.map(([, card]) => card)]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: liveCards.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.liveZone
    ),
    memberSlots: memberEntries.reduce(
      (slots, [slot, card]) =>
        placeCardInSlot(slots, slot, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    ),
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[PLAYER1, options.initialScore ?? 6]]),
      performingPlayerId: PLAYER1,
    },
  };

  return { game, distortion, members: Object.fromEntries(memberEntries) };
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  const gameState = confirmIfConfirmOnly(result.gameState, PLAYER1);
  expect(gameState.activeEffect).toBeNull();
  return gameState;
}

function distortionRequirementModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'REQUIREMENT' &&
      modifier.abilityId ===
        SP_PB2_048_LIVE_START_DIFFERENT_NAMED_CATCHU_REQUIREMENT_AND_SCORE_ABILITY_ID
  );
}

function distortionScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        SP_PB2_048_LIVE_START_DIFFERENT_NAMED_CATCHU_REQUIREMENT_AND_SCORE_ABILITY_ID
  );
}

function latestDistortionPayload(game: GameState) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PB2_048_LIVE_START_DIFFERENT_NAMED_CATCHU_REQUIREMENT_AND_SCORE_ABILITY_ID
    )?.payload;
}

describe('PL!SP-pb2-048-L Distortion workflow', () => {
  it('consumes pending with no requirement modifier or score when there are no CatChu! members', () => {
    const { game } = setupState({
      members: {
        [SlotPosition.CENTER]: createMember({
          cardCode: 'PL!SP-non-catchu',
          name: '非CatChuメンバー',
          unitName: 'KALEIDOSCORE',
        }),
      },
    });

    const state = resolveLiveStart(game);

    expect(state.pendingAbilities).toEqual([]);
    expect(distortionRequirementModifiers(state)).toEqual([]);
    expect(distortionScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(latestDistortionPayload(state)).toMatchObject({
      catchuCount: 0,
      requirementModifiers: [],
      adjustedRedRequirement: 6,
      scoreBonus: 0,
    });
  });

  it('applies generic -2 and RED +1 for one different-named CatChu! member without score', () => {
    const { game, distortion } = setupState({
      members: {
        [SlotPosition.CENTER]: createCatchuMember('澁谷かのん', SlotPosition.CENTER),
      },
    });

    const state = resolveLiveStart(game);

    expect(distortionRequirementModifiers(state)).toEqual([
      {
        kind: 'REQUIREMENT',
        liveCardId: distortion.instanceId,
        modifiers: [
          { color: HeartColor.RAINBOW, countDelta: -2 },
          { color: HeartColor.RED, countDelta: 1 },
        ],
        sourceCardId: distortion.instanceId,
        abilityId: SP_PB2_048_LIVE_START_DIFFERENT_NAMED_CATCHU_REQUIREMENT_AND_SCORE_ABILITY_ID,
      },
    ]);
    expect(distortionScoreModifiers(state)).toEqual([]);
    expect(latestDistortionPayload(state)).toMatchObject({
      catchuCount: 1,
      adjustedRedRequirement: 7,
      scoreBonus: 0,
    });
  });

  it('applies generic -4 and RED +2 for two different-named CatChu! members without score', () => {
    const { game } = setupState({
      members: {
        [SlotPosition.LEFT]: createCatchuMember('澁谷かのん', SlotPosition.LEFT),
        [SlotPosition.RIGHT]: createCatchuMember('米女メイ', SlotPosition.RIGHT),
      },
    });

    const state = resolveLiveStart(game);

    expect(distortionRequirementModifiers(state)[0]).toMatchObject({
      modifiers: [
        { color: HeartColor.RAINBOW, countDelta: -4 },
        { color: HeartColor.RED, countDelta: 2 },
      ],
    });
    expect(distortionScoreModifiers(state)).toEqual([]);
    expect(latestDistortionPayload(state)).toMatchObject({
      catchuCount: 2,
      adjustedRedRequirement: 8,
      scoreBonus: 0,
    });
  });

  it('adds SCORE +1 and refreshes playerScores when three different-named CatChu! members make RED requirement 9', () => {
    const { game, distortion } = setupState({
      members: {
        [SlotPosition.LEFT]: createCatchuMember('澁谷かのん', SlotPosition.LEFT),
        [SlotPosition.CENTER]: createCatchuMember('平安名すみれ', SlotPosition.CENTER),
        [SlotPosition.RIGHT]: createCatchuMember('米女メイ', SlotPosition.RIGHT),
      },
    });

    const state = resolveLiveStart(game);

    expect(distortionRequirementModifiers(state)).toEqual([
      {
        kind: 'REQUIREMENT',
        liveCardId: distortion.instanceId,
        modifiers: [
          { color: HeartColor.RAINBOW, countDelta: -6 },
          { color: HeartColor.RED, countDelta: 3 },
        ],
        sourceCardId: distortion.instanceId,
        abilityId: SP_PB2_048_LIVE_START_DIFFERENT_NAMED_CATCHU_REQUIREMENT_AND_SCORE_ABILITY_ID,
      },
    ]);
    expect(distortionScoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: distortion.instanceId,
        sourceCardId: distortion.instanceId,
        abilityId: SP_PB2_048_LIVE_START_DIFFERENT_NAMED_CATCHU_REQUIREMENT_AND_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    expect(latestDistortionPayload(state)).toMatchObject({
      differentNamedCatchuNames: ['澁谷かのん', '平安名すみれ', '米女メイ'],
      catchuCount: 3,
      adjustedRedRequirement: 9,
      scoreBonus: 1,
    });
  });

  it('clears the score draft when forced failure follows the SCORE +1 live-start effect', () => {
    const { game } = setupState({
      members: {
        [SlotPosition.LEFT]: createCatchuMember('澁谷かのん', SlotPosition.LEFT),
        [SlotPosition.CENTER]: createCatchuMember('平安名すみれ', SlotPosition.CENTER),
        [SlotPosition.RIGHT]: createCatchuMember('米女メイ', SlotPosition.RIGHT),
      },
    });
    const resolvedState = resolveLiveStart(game);
    const stateAfterLiveStart = {
      ...resolvedState,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      liveResolution: {
        ...resolvedState.liveResolution,
        playerRemainingHearts: new Map([[PLAYER1, [{ color: HeartColor.RED, count: 1 }]]]),
        playerLiveJudgmentHearts: new Map([[PLAYER1, [{ color: HeartColor.RED, count: 9 }]]]),
      },
    };
    expect(stateAfterLiveStart.liveResolution.playerScores.get(PLAYER1)).toBe(7);

    const session = createGameSession();
    session.createGame('sp-pb2-048-distortion-forced-fail', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = stateAfterLiveStart;

    session.localFreePlay = true;
    const failResult = session.executeCommand(createConfirmPerformanceOutcomeCommand(PLAYER1, false));

    expect(failResult.success).toBe(true);
    expect(failResult.gameState.liveResolution.playerScores.get(PLAYER1)).toBe(0);
    expect(failResult.gameState.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([]);
    expect(failResult.gameState.liveResolution.playerLiveJudgmentHearts.get(PLAYER1)).toEqual([]);

    const staleScoreState = {
      ...failResult.gameState,
      liveResolution: {
        ...failResult.gameState.liveResolution,
        playerScores: new Map([[PLAYER1, 7]]),
      },
    };
    const resultPhase = new GameService().executeLiveResultPhase(staleScoreState);
    expect(resultPhase.success).toBe(true);
    expect(resultPhase.gameState.liveResolution.playerScores.get(PLAYER1)).toBe(0);
  });

  it('counts same-name CatChu! members only once', () => {
    const { game } = setupState({
      members: {
        [SlotPosition.LEFT]: createCatchuMember('澁谷 かのん', SlotPosition.LEFT),
        [SlotPosition.CENTER]: createCatchuMember('澁谷かのん', SlotPosition.CENTER),
        [SlotPosition.RIGHT]: createCatchuMember('米女メイ', SlotPosition.RIGHT),
      },
    });

    const state = resolveLiveStart(game);

    expect(distortionRequirementModifiers(state)[0]).toMatchObject({
      modifiers: [
        { color: HeartColor.RAINBOW, countDelta: -4 },
        { color: HeartColor.RED, countDelta: 2 },
      ],
    });
    expect(latestDistortionPayload(state)).toMatchObject({
      catchuCount: 2,
      adjustedRedRequirement: 8,
      scoreBonus: 0,
    });
  });

  it('does not count non-CatChu! members', () => {
    const { game } = setupState({
      members: {
        [SlotPosition.LEFT]: createCatchuMember('澁谷かのん', SlotPosition.LEFT),
        [SlotPosition.CENTER]: createMember({
          cardCode: 'PL!SP-kaleidoscore',
          name: '嵐千砂都',
          unitName: 'KALEIDOSCORE',
        }),
        [SlotPosition.RIGHT]: createCatchuMember('米女メイ', SlotPosition.RIGHT),
      },
    });

    const state = resolveLiveStart(game);

    expect(latestDistortionPayload(state)).toMatchObject({
      differentNamedCatchuNames: ['澁谷かのん', '米女メイ'],
      catchuCount: 2,
      adjustedRedRequirement: 8,
      scoreBonus: 0,
    });
  });

  it('continues ordered pending resolution with another LIVE_START live card', () => {
    const { game } = setupState({
      includeZettai: true,
      members: {
        [SlotPosition.LEFT]: createCatchuMember('澁谷かのん', SlotPosition.LEFT),
        [SlotPosition.CENTER]: createCatchuMember('平安名すみれ', SlotPosition.CENTER),
        [SlotPosition.RIGHT]: createCatchuMember('米女メイ', SlotPosition.RIGHT),
      },
    });
    const checkResult = new GameService().executeCheckTiming(game, [
      TriggerCondition.ON_LIVE_START,
    ]);
    expect(checkResult.success).toBe(true);
    expect(checkResult.gameState.activeEffect?.canResolveInOrder).toBe(true);

    const session = createGameSession();
    session.createGame('sp-pb2-048-distortion-order', PLAYER1, 'P1', PLAYER2, 'P2');
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
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_048_LIVE_START_DIFFERENT_NAMED_CATCHU_REQUIREMENT_AND_SCORE_ABILITY_ID
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toBe(true);
  });
});
