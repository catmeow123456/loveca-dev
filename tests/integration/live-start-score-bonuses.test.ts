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
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import { addHeartLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
  PL_N_BP1_029_LIVE_START_LIVE_ZONE_THREE_THIS_LIVE_SCORE_ABILITY_ID,
  PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID,
  PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
  HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID,
  HS_BP2_026_LIVE_START_MIRACRA_FORMATION_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createSolitudeRain(): LiveCardData {
  return {
    cardCode: 'PL!N-bp1-027-L',
    name: 'Solitude Rain',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 0,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEutopia(): LiveCardData {
  return {
    cardCode: 'PL!N-bp1-029-L',
    name: 'Eutopia',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createPsychoHeart(): LiveCardData {
  return { cardCode: 'PL!N-bp3-026-L', name: 'サイコーハート', groupNames: ['虹ヶ咲'], cardType: CardType.LIVE, score: 3, requirements: createHeartRequirement({ [HeartColor.RED]: 1 }) };
}

function createLinkToTheFuture(): LiveCardData {
  return {
    cardCode: 'PL!HS-bp2-020-L',
    name: 'Link to the FUTURE',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.LIVE,
    score: 0,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createMiraCreation(cardCode = 'PL!HS-bp2-026-L'): LiveCardData {
  return {
    cardCode,
    name: 'みらくりえーしょん',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createDummyLive(
  cardCode: string,
  score = 1,
  groupNames: readonly string[] = ['虹ヶ咲']
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createBokuraNoLiveKimiToNoLife(): LiveCardData {
  return {
    cardCode: 'PL!-bp3-019-L',
    name: '僕らのLIVE 君とのLIFE',
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 0,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly name?: string;
  readonly groupNames?: readonly string[];
  readonly hearts: readonly HeartColor[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name ?? options.cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: options.hearts.map((color) => createHeartIcon(color, 1)),
  };
}

function setupState(options: {
  readonly lives: readonly ReturnType<typeof createCardInstance>[];
  readonly successLives?: readonly ReturnType<typeof createCardInstance>[];
  readonly members?: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>>;
  readonly opponentMembers?: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>>;
  readonly initialScore?: number;
  readonly mutateBeforeTrigger?: (game: GameState) => GameState;
}): GameState {
  let game = createGameState('n-live-start-score-bonuses', PLAYER1, 'P1', PLAYER2, 'P2');
  const members = Object.entries(options.members ?? {}) as [
    SlotPosition,
    ReturnType<typeof createCardInstance>,
  ][];
  const opponentMembers = Object.entries(options.opponentMembers ?? {}) as [
    SlotPosition,
    ReturnType<typeof createCardInstance>,
  ][];
  game = registerCards(game, [
    ...options.lives,
    ...(options.successLives ?? []),
    ...members.map(([, card]) => card),
    ...opponentMembers.map(([, card]) => card),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const liveZone = options.lives.reduce(
      (zone, live) => addCardToStatefulZone(zone, live.instanceId),
      player.liveZone
    );
    const successZone = (options.successLives ?? []).reduce(
      (zone, live) => addCardToStatefulZone(zone, live.instanceId),
      player.successZone
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
      successZone,
      memberSlots,
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: opponentMembers.reduce(
      (slots, [slot, member]) =>
        placeCardInSlot(slots, slot, member.instanceId, {
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
      playerScores: new Map([[PLAYER1, options.initialScore ?? 0]]),
      performingPlayerId: PLAYER1,
    },
  };
  return options.mutateBeforeTrigger?.(game) ?? game;
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  const gameState = confirmIfConfirmOnly(result.gameState, PLAYER1);
  if (!gameState.activeEffect?.canResolveInOrder) {
    expect(gameState.activeEffect).toBeNull();
    return gameState;
  }

  const session = createGameSession();
  session.createGame('n-live-start-score-bonuses-order', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = gameState;
  const orderResult = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      gameState.activeEffect.id,
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
      groupNames: [groupName],
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

function scoreModifiersForAbility(game: GameState, abilityId: string) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === abilityId
  );
}

function createHasunosoraMemberInstance(id: string, name: string, groupNames = ['蓮ノ空女学院スクールアイドルクラブ']) {
  return createCardInstance(
    createMember({
      cardCode: `PL!HS-test-${id}`,
      name,
      groupNames,
      hearts: [],
    }),
    PLAYER1,
    id
  );
}

function latestPayload(game: GameState, abilityId: string) {
  return [...game.actionHistory]
    .reverse()
    .find((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    ?.payload;
}

describe("PL!-bp3 μ's live-start score bonus LIVE cards", () => {
  it('confirms PL!-bp3-019-L before counting current structured μ\'s LIVE cards and adding SCORE +1', () => {
    const source = createCardInstance(createBokuraNoLiveKimiToNoLife(), PLAYER1, 'bokura-live');
    const otherMuseLive = createCardInstance(
      createDummyLive('PL!-test-muse-live', 1, ["μ's"]),
      PLAYER1,
      'other-muse-live'
    );
    const game = setupState({ lives: [source, otherMuseLive], initialScore: 3 });

    const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
    expect(result.success).toBe(true);
    expect(result.gameState.activeEffect).toMatchObject({
      abilityId: PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
      sourceCardId: source.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(result.gameState.activeEffect?.effectText).toContain(
      "【LIVE开始时】自己的LIVE中存在大于等于2张『μ's』的卡片的场合，此卡的分数＋１。"
    );
    expect(result.gameState.activeEffect?.effectText).toContain("当前自己LIVE中的『μ's』卡片2张");
    expect(result.gameState.activeEffect?.effectText).toContain('满足条件，实际[スコア]+1');
    expect(result.gameState.activeEffect?.effectText).not.toMatch(/source|pending|stale|来源/);
    expect(
      scoreModifiersForAbility(
        result.gameState,
        PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);

    const state = confirmActiveEffectStep(
      result.gameState,
      PLAYER1,
      result.gameState.activeEffect!.id
    );
    expect(
      scoreModifiersForAbility(
        state,
        PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toContainEqual(
      expect.objectContaining({ liveCardId: source.instanceId, countDelta: 1 })
    );
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(
      latestPayload(state, PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID)
    ).toMatchObject({ museLiveCardCount: 2, conditionMet: true, scoreBonus: 1 });
  });

  it('does not count a non-μ\'s LIVE card for PL!-bp3-019-L', () => {
    const source = createCardInstance(
      createBokuraNoLiveKimiToNoLife(),
      PLAYER1,
      'bokura-unmet'
    );
    const otherLive = createCardInstance(
      createDummyLive('PL!N-test-non-muse'),
      PLAYER1,
      'non-muse-live'
    );
    const result = new GameService().executeCheckTiming(
      setupState({ lives: [source, otherLive], initialScore: 2 }),
      [TriggerCondition.ON_LIVE_START]
    );
    expect(result.gameState.activeEffect?.effectText).toContain("『μ's』卡片1张");
    expect(result.gameState.activeEffect?.effectText).toContain('未满足条件，实际不增加分数');

    const state = confirmActiveEffectStep(
      result.gameState,
      PLAYER1,
      result.gameState.activeEffect!.id
    );
    expect(
      scoreModifiersForAbility(
        state,
        PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });

  it('rechecks that PL!-bp3-019-L is still in the controller LIVE zone on confirmation', () => {
    const source = createCardInstance(createBokuraNoLiveKimiToNoLife(), PLAYER1, 'bokura-left');
    const otherMuseLive = createCardInstance(
      createDummyLive('PL!-test-muse-left', 1, ["μ's"]),
      PLAYER1,
      'other-muse-left'
    );
    const result = new GameService().executeCheckTiming(
      setupState({ lives: [source, otherMuseLive] }),
      [TriggerCondition.ON_LIVE_START]
    );
    const sourceRemoved = updatePlayer(result.gameState, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, source.instanceId),
    }));

    const state = confirmActiveEffectStep(
      sourceRemoved,
      PLAYER1,
      sourceRemoved.activeEffect!.id
    );
    expect(
      scoreModifiersForAbility(
        state,
        PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
    expect(
      latestPayload(state, PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID)
    ).toMatchObject({ sourceInLiveZone: false, conditionMet: false, scoreBonus: 0 });
  });

  it('auto-resolves ordered PL!-bp3-019-L pendings and confirms a manually selected one first', () => {
    const createScenario = (suffix: string) => {
      const first = createCardInstance(
        createBokuraNoLiveKimiToNoLife(),
        PLAYER1,
        `bokura-first-${suffix}`
      );
      const second = createCardInstance(
        createBokuraNoLiveKimiToNoLife(),
        PLAYER1,
        `bokura-second-${suffix}`
      );
      const checked = new GameService().executeCheckTiming(
        setupState({ lives: [first, second] }),
        [TriggerCondition.ON_LIVE_START]
      ).gameState;
      return { first, second, checked };
    };

    const orderedScenario = createScenario('ordered');
    expect(orderedScenario.checked.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      orderedScenario.checked,
      PLAYER1,
      orderedScenario.checked.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(
      scoreModifiersForAbility(
        ordered,
        PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(2);

    const manualScenario = createScenario('manual');
    const preview = confirmActiveEffectStep(
      manualScenario.checked,
      PLAYER1,
      manualScenario.checked.activeEffect!.id,
      manualScenario.second.instanceId
    );
    expect(preview.activeEffect).toMatchObject({
      abilityId: PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
      sourceCardId: manualScenario.second.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(
      scoreModifiersForAbility(
        preview,
        PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
    const confirmed = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(
      scoreModifiersForAbility(
        confirmed,
        PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toContainEqual(expect.objectContaining({ sourceCardId: manualScenario.second.instanceId }));
  });
});

describe('PL!N-bp3-026-L Psycho Heart live-start score bonus', () => {
  function scenario(scores: readonly number[], sourceId = 'psycho-source') {
    const source = createCardInstance(createPsychoHeart(), PLAYER1, sourceId);
    const successLives = scores.map((score, index) => createCardInstance(createDummyLive(`success-${score}-${index}`, score), PLAYER1, `success-${score}-${index}`));
    return { source, game: setupState({ lives: [source], successLives, initialScore: 3 }) };
  }

  it.each([
    [[], 0], [[1], 1], [[5], 1], [[1, 5], 2], [[1, 1], 1], [[5, 5], 1],
  ] as const)('uses printed success-zone scores %j for SCORE +%i', (scores, expected) => {
    const { game } = scenario(scores);
    const state = resolveLiveStart(game);
    expect(scoreModifiersForAbility(state, PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID)).toHaveLength(expected > 0 ? 1 : 0);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(3 + expected);
  });

  it('opens confirm-only before resolving, with realtime player text and no internal terms', () => {
    const { game } = scenario([1, 5]);
    const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
    expect(result.success).toBe(true);
    expect(result.gameState.activeEffect).toMatchObject({ abilityId: PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID, metadata: { confirmOnlyPendingAbility: true } });
    expect(result.gameState.activeEffect?.effectText).toContain('存在分数1的LIVE，存在分数5的LIVE');
    expect(result.gameState.activeEffect?.effectText).toContain('实际[スコア]+2');
    expect(result.gameState.activeEffect?.effectText).not.toMatch(/source|pending|stale|来源.*LIVE区/);
    expect(scoreModifiersForAbility(result.gameState, PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID)).toEqual([]);
    expect(confirmIfConfirmOnly(result.gameState, PLAYER1).liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('ordered resolution auto-resolves and manual selection opens the confirm bridge', () => {
    const first = createCardInstance(createPsychoHeart(), PLAYER1, 'psycho-first');
    const second = createCardInstance(createPsychoHeart(), PLAYER1, 'psycho-second');
    const success = createCardInstance(createDummyLive('success-five', 5), PLAYER1, 'success-five');
    const checked = new GameService().executeCheckTiming(setupState({ lives: [first, second], successLives: [success], initialScore: 6 }), [TriggerCondition.ON_LIVE_START]).gameState;
    const ordered = confirmActiveEffectStep(checked, PLAYER1, checked.activeEffect!.id, undefined, undefined, true);
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.liveResolution.playerScores.get(PLAYER1)).toBe(8);
    const manual = confirmActiveEffectStep(checked, PLAYER1, checked.activeEffect!.id, first.instanceId);
    expect(manual.activeEffect?.metadata).toMatchObject({ confirmOnlyPendingAbility: true });
    expect(scoreModifiersForAbility(manual, PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID)).toEqual([]);
  });

  it('rechecks source validity and replaces an existing source/ability modifier without stacking', () => {
    const { source, game } = scenario([1, 5], 'psycho-dedupe');
    const checked = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]).gameState;
    const departed = updatePlayer(checked, PLAYER1, (player) => ({ ...player, liveZone: removeCardFromStatefulZone(player.liveZone, source.instanceId) }));
    const noOp = confirmIfConfirmOnly(departed, PLAYER1);
    expect(noOp.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(noOp.activeEffect).toBeNull();

    const resolved = resolveLiveStart(game);
    const ability = latestPayload(resolved, PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID);
    const repeated = resolveLiveStart({ ...resolved, pendingAbilities: [{ id: 'repeat', abilityId: PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID, sourceCardId: source.instanceId, controllerId: PLAYER1, triggerCondition: TriggerCondition.ON_LIVE_START }] });
    expect(ability).toBeTruthy();
    expect(scoreModifiersForAbility(repeated, PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID)).toHaveLength(1);
    expect(repeated.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });
});

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

describe('Hasunosora live-start score bonus LIVE cards', () => {
  it('PL!HS-bp2-020-L confirms before counting own different named Hasunosora members and refreshing score', () => {
    const live = createCardInstance(createLinkToTheFuture(), PLAYER1, 'link-future');
    const game = setupState({
      lives: [live],
      members: {
        [SlotPosition.LEFT]: createHasunosoraMemberInstance('rurino', '大沢瑠璃乃'),
        [SlotPosition.CENTER]: createHasunosoraMemberInstance('hime', '安养寺姬芽'),
        [SlotPosition.RIGHT]: createHasunosoraMemberInstance('other', '高坂穂乃果', ['μ\'s']),
      },
      initialScore: 4,
    });

    const checkResult = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
    expect(checkResult.success).toBe(true);
    expect(checkResult.gameState.activeEffect).toMatchObject({
      abilityId: HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(checkResult.gameState.activeEffect?.effectText).toContain("不同名『莲之空』成员2名");
    expect(checkResult.gameState.activeEffect?.effectText).toContain('实际[スコア]+4');
    expect(checkResult.gameState.activeEffect?.effectText).not.toMatch(/source|pending|LIVE区/);
    expect(scoreModifiersForAbility(checkResult.gameState, HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID)).toEqual([]);

    const state = confirmIfConfirmOnly(checkResult.gameState, PLAYER1);
    expect(scoreModifiersForAbility(state, HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID)).toContainEqual(
      expect.objectContaining({ liveCardId: live.instanceId, countDelta: 4 })
    );
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(8);
  });

  it('PL!HS-bp2-020-L uses shared name identity, excludes non-Hasunosora members, and consumes a zero-count no-op', () => {
    const live = createCardInstance(createLinkToTheFuture(), PLAYER1, 'link-future-zero');
    const game = setupState({
      lives: [live],
      members: {
        [SlotPosition.LEFT]: createHasunosoraMemberInstance('same-jp', '大沢瑠璃乃'),
        [SlotPosition.CENTER]: createHasunosoraMemberInstance('same-spaced', '大沢 瑠璃乃'),
        [SlotPosition.RIGHT]: createHasunosoraMemberInstance('non-hs', '高坂穂乃果', ['μ\'s']),
      },
      opponentMembers: {
        [SlotPosition.CENTER]: createHasunosoraMemberInstance('opponent-hime', '安養寺姫芽'),
      },
    });
    const state = resolveLiveStart(game);
    expect(scoreModifiersForAbility(state, HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID)).toContainEqual(
      expect.objectContaining({ countDelta: 2 })
    );

    const noMemberState = resolveLiveStart(
      setupState({ lives: [createCardInstance(createLinkToTheFuture(), PLAYER1, 'link-no-members')] })
    );
    expect(scoreModifiersForAbility(noMemberState, HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID)).toEqual([]);
    expect(latestPayload(noMemberState, HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID)).toMatchObject({ scoreBonus: 0 });

    const departureLive = createCardInstance(createLinkToTheFuture(), PLAYER1, 'link-departed');
    const departureCheck = new GameService().executeCheckTiming(
      setupState({
        lives: [departureLive],
        members: { [SlotPosition.CENTER]: createHasunosoraMemberInstance('departure-hime', '安養寺姫芽') },
      }),
      [TriggerCondition.ON_LIVE_START]
    );
    const departedBeforeConfirmation = updatePlayer(departureCheck.gameState, PLAYER1, (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: player.liveZone.cardIds.filter((cardId) => cardId !== departureLive.instanceId),
      },
    }));
    const departedState = confirmIfConfirmOnly(departedBeforeConfirmation, PLAYER1);
    expect(scoreModifiersForAbility(departedState, HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID)).toEqual([]);
  });

  it.each([
    ['PL!HS-bp2-026-L', '大泽瑠璃乃', '安养寺姬芽', '藤岛 慈'],
    ['PL!HS-bp2-026-L＋', '大沢瑠璃乃', '安養寺姫芽', '藤島慈'],
  ])('covers %s and adds SCORE +2 only for the printed Mira-Cra formation', (cardCode, rurino, hime, megu) => {
    const live = createCardInstance(createMiraCreation(cardCode), PLAYER1, `${cardCode}-source`);
    const game = setupState({
      lives: [live],
      members: {
        [SlotPosition.LEFT]: createHasunosoraMemberInstance('hime', hime),
        [SlotPosition.CENTER]: createHasunosoraMemberInstance('megu', megu),
        [SlotPosition.RIGHT]: createHasunosoraMemberInstance('rurino', rurino),
      },
      initialScore: 5,
    });
    const state = resolveLiveStart(game);
    expect(scoreModifiersForAbility(state, HS_BP2_026_LIVE_START_MIRACRA_FORMATION_THIS_LIVE_SCORE_ABILITY_ID)).toContainEqual(
      expect.objectContaining({ liveCardId: live.instanceId, countDelta: 2 })
    );
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(7);
  });

  it.each([
    ['an empty printed slot', null, '安養寺姫芽', '藤島慈'],
    ['a wrong printed name', '藤島慈', '安養寺姫芽', '藤島慈'],
    ['the three members in swapped slots', '大沢瑠璃乃', '藤島慈', '安養寺姫芽'],
  ])('PL!HS-bp2-026-L consumes a no-op for %s', (_label, rurino, hime, megu) => {
    const live = createCardInstance(createMiraCreation(), PLAYER1, `mira-noop-${String(_label)}`);
    const members: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>> = {};
    if (rurino) members[SlotPosition.RIGHT] = createHasunosoraMemberInstance('right', rurino);
    if (hime) members[SlotPosition.LEFT] = createHasunosoraMemberInstance('left', hime);
    if (megu) members[SlotPosition.CENTER] = createHasunosoraMemberInstance('center', megu);
    const state = resolveLiveStart(setupState({ lives: [live], members, initialScore: 5 }));
    expect(scoreModifiersForAbility(state, HS_BP2_026_LIVE_START_MIRACRA_FORMATION_THIS_LIVE_SCORE_ABILITY_ID)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('resolves ordered pending automatically and shows a confirmation bridge before a manually selected 020 pending', () => {
    const first = createCardInstance(createLinkToTheFuture(), PLAYER1, 'link-ordered-first');
    const second = createCardInstance(createLinkToTheFuture(), PLAYER1, 'link-ordered-second');
    const game = setupState({
      lives: [first, second],
      members: {
        [SlotPosition.LEFT]: createHasunosoraMemberInstance('ordered-rurino', '大沢瑠璃乃'),
      },
    });
    const checkResult = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
    expect(checkResult.success).toBe(true);
    expect(checkResult.gameState.activeEffect?.canResolveInOrder).toBe(true);

    const ordered = confirmActiveEffectStep(
      checkResult.gameState,
      PLAYER1,
      checkResult.gameState.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(scoreModifiersForAbility(ordered, HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID)).toHaveLength(2);

    const preview = confirmActiveEffectStep(
      checkResult.gameState,
      PLAYER1,
      checkResult.gameState.activeEffect!.id,
      first.instanceId
    );
    expect(preview.activeEffect).toMatchObject({
      abilityId: HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(scoreModifiersForAbility(preview, HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID)).toEqual([]);
    const confirmed = confirmIfConfirmOnly(preview, PLAYER1);
    expect(scoreModifiersForAbility(confirmed, HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID)).toHaveLength(1);
  });
});
