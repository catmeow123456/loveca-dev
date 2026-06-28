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
import { addHeartLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
  PL_N_BP1_029_LIVE_START_LIVE_ZONE_THREE_THIS_LIVE_SCORE_ABILITY_ID,
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

function createSolitudeRain(): LiveCardData {
  return {
    cardCode: 'PL!N-bp1-027-L',
    name: 'Solitude Rain',
    groupName: '虹ヶ咲',
    cardType: CardType.LIVE,
    score: 0,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEutopia(): LiveCardData {
  return {
    cardCode: 'PL!N-bp1-029-L',
    name: 'Eutopia',
    groupName: '虹ヶ咲',
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createDummyLive(cardCode: string, score = 1): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: '虹ヶ咲',
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly groupName?: string;
  readonly hearts: readonly HeartColor[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.cardCode,
    groupName: options.groupName ?? '虹ヶ咲学園スクールアイドル同好会',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: options.hearts.map((color) => createHeartIcon(color, 1)),
  };
}

function setupState(options: {
  readonly lives: readonly ReturnType<typeof createCardInstance>[];
  readonly members?: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>>;
  readonly initialScore?: number;
  readonly mutateBeforeTrigger?: (game: GameState) => GameState;
}): GameState {
  let game = createGameState('n-live-start-score-bonuses', PLAYER1, 'P1', PLAYER2, 'P2');
  const members = Object.entries(options.members ?? {}) as [
    SlotPosition,
    ReturnType<typeof createCardInstance>,
  ][];
  game = registerCards(game, [...options.lives, ...members.map(([, card]) => card)]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const liveZone = options.lives.reduce(
      (zone, live) => addCardToStatefulZone(zone, live.instanceId),
      player.liveZone
    );
    const memberSlots = members.reduce(
      (slots, [slot, member]) =>
        placeCardInSlot(slots, slot, member.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    );
    return {
      ...player,
      liveZone,
      memberSlots,
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[PLAYER1, options.initialScore ?? 0]]),
      performingPlayerId: PLAYER1,
    },
  };
  return options.mutateBeforeTrigger?.(game) ?? game;
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  if (!result.gameState.activeEffect?.canResolveInOrder) {
    expect(result.gameState.activeEffect).toBeNull();
    return result.gameState;
  }

  const session = createGameSession();
  session.createGame('n-live-start-score-bonuses-order', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
  const orderResult = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      result.gameState.activeEffect.id,
      undefined,
      null,
      true
    )
  );
  expect(orderResult.success, orderResult.error).toBe(true);
  expect(session.state?.activeEffect).toBeNull();
  return session.state!;
}

function createMemberInstance(
  id: string,
  hearts: readonly HeartColor[],
  groupName = '虹ヶ咲学園スクールアイドル同好会'
) {
  return createCardInstance(
    createMember({
      cardCode: groupName === 'Aqours' ? `PL!S-${id}` : `PL!N-${id}`,
      groupName,
      hearts,
    }),
    PLAYER1,
    id
  );
}

function solitudeScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID
  );
}

function eutopiaScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId === PL_N_BP1_029_LIVE_START_LIVE_ZONE_THREE_THIS_LIVE_SCORE_ABILITY_ID
  );
}

function latestPayload(game: GameState, abilityId: string) {
  return [...game.actionHistory]
    .reverse()
    .find((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    ?.payload;
}

describe('Nijigasaki live-start score bonus LIVE cards', () => {
  it('adds SCORE +6 for Solitude Rain when Nijigasaki stage members cover all six colors', () => {
    const solitudeRain = createCardInstance(createSolitudeRain(), PLAYER1, 'solitude-rain');
    const game = setupState({
      lives: [solitudeRain],
      members: {
        [SlotPosition.LEFT]: createMemberInstance('pink-red', [HeartColor.PINK, HeartColor.RED]),
        [SlotPosition.CENTER]: createMemberInstance('yellow-green', [
          HeartColor.YELLOW,
          HeartColor.GREEN,
        ]),
        [SlotPosition.RIGHT]: createMemberInstance('blue-purple', [
          HeartColor.BLUE,
          HeartColor.PURPLE,
        ]),
      },
    });

    const state = resolveLiveStart(game);

    expect(solitudeScoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 6,
        liveCardId: solitudeRain.instanceId,
        sourceCardId: solitudeRain.instanceId,
        abilityId:
          PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(latestPayload(state, PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      effectiveHeartColors: [
        HeartColor.PINK,
        HeartColor.RED,
        HeartColor.YELLOW,
        HeartColor.GREEN,
        HeartColor.BLUE,
        HeartColor.PURPLE,
      ],
      scoreBonus: 6,
    });
  });

  it('counts only unique normal colors for Solitude Rain when colors are missing or repeated', () => {
    const solitudeRain = createCardInstance(createSolitudeRain(), PLAYER1, 'solitude-repeat');
    const game = setupState({
      lives: [solitudeRain],
      members: {
        [SlotPosition.LEFT]: createMemberInstance('pink-pink', [
          HeartColor.PINK,
          HeartColor.PINK,
        ]),
        [SlotPosition.CENTER]: createMemberInstance('pink-red', [
          HeartColor.PINK,
          HeartColor.RED,
        ]),
        [SlotPosition.RIGHT]: createMemberInstance('rainbow-only', [HeartColor.RAINBOW]),
      },
    });

    const state = resolveLiveStart(game);

    expect(solitudeScoreModifiers(state)).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 2,
      liveCardId: solitudeRain.instanceId,
      sourceCardId: solitudeRain.instanceId,
      abilityId:
        PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(latestPayload(state, PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      effectiveHeartColors: [HeartColor.PINK, HeartColor.RED],
      scoreBonus: 2,
    });
  });

  it('ignores non-Nijigasaki members for Solitude Rain', () => {
    const solitudeRain = createCardInstance(createSolitudeRain(), PLAYER1, 'solitude-non-niji');
    const game = setupState({
      lives: [solitudeRain],
      members: {
        [SlotPosition.LEFT]: createMemberInstance('niji-pink', [HeartColor.PINK]),
        [SlotPosition.CENTER]: createMemberInstance(
          'aqours-red-yellow-green',
          [HeartColor.RED, HeartColor.YELLOW, HeartColor.GREEN],
          'Aqours'
        ),
        [SlotPosition.RIGHT]: createMemberInstance('niji-blue', [HeartColor.BLUE]),
      },
    });

    const state = resolveLiveStart(game);

    expect(solitudeScoreModifiers(state)).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 2,
      liveCardId: solitudeRain.instanceId,
      sourceCardId: solitudeRain.instanceId,
      abilityId:
        PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });

  it('counts effective Heart modifiers for Solitude Rain', () => {
    const solitudeRain = createCardInstance(createSolitudeRain(), PLAYER1, 'solitude-modifier');
    const blueMember = createMemberInstance('blue-member', [HeartColor.BLUE]);
    const game = setupState({
      lives: [solitudeRain],
      members: {
        [SlotPosition.LEFT]: createMemberInstance('pink-red-yellow', [
          HeartColor.PINK,
          HeartColor.RED,
          HeartColor.YELLOW,
        ]),
        [SlotPosition.CENTER]: createMemberInstance('green', [HeartColor.GREEN]),
        [SlotPosition.RIGHT]: blueMember,
      },
      mutateBeforeTrigger: (state) =>
        addHeartLiveModifierForMember(state, {
          playerId: PLAYER1,
          memberCardId: blueMember.instanceId,
          sourceCardId: blueMember.instanceId,
          abilityId: 'test:add-purple-heart',
          hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
        })!.gameState,
    });

    const state = resolveLiveStart(game);

    expect(solitudeScoreModifiers(state)).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 6,
      liveCardId: solitudeRain.instanceId,
      sourceCardId: solitudeRain.instanceId,
      abilityId:
        PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });

  it('adds SCORE +2 for Eutopia when own liveZone has at least three cards', () => {
    const eutopia = createCardInstance(createEutopia(), PLAYER1, 'eutopia');
    const dummyA = createCardInstance(createDummyLive('PL!N-dummy-live-a'), PLAYER1, 'dummy-a');
    const dummyB = createCardInstance(createDummyLive('PL!N-dummy-live-b'), PLAYER1, 'dummy-b');
    const game = setupState({
      lives: [eutopia, dummyA, dummyB],
      initialScore: 5,
    });

    const state = resolveLiveStart(game);

    expect(eutopiaScoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 2,
        liveCardId: eutopia.instanceId,
        sourceCardId: eutopia.instanceId,
        abilityId: PL_N_BP1_029_LIVE_START_LIVE_ZONE_THREE_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    expect(latestPayload(state, PL_N_BP1_029_LIVE_START_LIVE_ZONE_THREE_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({
      liveZoneCardCount: 3,
      conditionMet: true,
      scoreBonus: 2,
    });
  });

  it('does not add SCORE for Eutopia when own liveZone has only one or two cards', () => {
    for (const liveCount of [1, 2]) {
      const eutopia = createCardInstance(createEutopia(), PLAYER1, `eutopia-${liveCount}`);
      const dummy = createCardInstance(
        createDummyLive(`PL!N-dummy-live-${liveCount}`),
        PLAYER1,
        `dummy-${liveCount}`
      );
      const game = setupState({
        lives: liveCount === 1 ? [eutopia] : [eutopia, dummy],
        initialScore: 5,
      });

      const state = resolveLiveStart(game);

      expect(eutopiaScoreModifiers(state)).toEqual([]);
      expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
      expect(
        latestPayload(state, PL_N_BP1_029_LIVE_START_LIVE_ZONE_THREE_THIS_LIVE_SCORE_ABILITY_ID)
      ).toMatchObject({
        liveZoneCardCount: liveCount,
        conditionMet: false,
        scoreBonus: 0,
      });
    }
  });

  it('continues ordered pending resolution across Solitude Rain and Eutopia without opening selection', () => {
    const solitudeRain = createCardInstance(createSolitudeRain(), PLAYER1, 'ordered-solitude');
    const eutopia = createCardInstance(createEutopia(), PLAYER1, 'ordered-eutopia');
    const dummy = createCardInstance(createDummyLive('PL!N-ordered-dummy'), PLAYER1, 'ordered-dummy');
    const game = setupState({
      lives: [solitudeRain, eutopia, dummy],
      initialScore: 5,
      members: {
        [SlotPosition.LEFT]: createMemberInstance('ordered-pink-red', [
          HeartColor.PINK,
          HeartColor.RED,
        ]),
        [SlotPosition.CENTER]: createMemberInstance('ordered-yellow-green', [
          HeartColor.YELLOW,
          HeartColor.GREEN,
        ]),
        [SlotPosition.RIGHT]: createMemberInstance('ordered-blue-purple', [
          HeartColor.BLUE,
          HeartColor.PURPLE,
        ]),
      },
    });

    const state = resolveLiveStart(game);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(solitudeScoreModifiers(state)).toHaveLength(1);
    expect(eutopiaScoreModifiers(state)).toHaveLength(1);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(13);
    expect(
      state.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          (action.payload.abilityId ===
            PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID ||
            action.payload.abilityId ===
              PL_N_BP1_029_LIVE_START_LIVE_ZONE_THREE_THIS_LIVE_SCORE_ABILITY_ID)
      )
    ).toHaveLength(2);
  });
});
