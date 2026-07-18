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
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import { addHeartLiveModifierForMember } from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
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
  SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID,
  SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
  SP_BP1_027_LIVE_START_ENERGY_TWELVE_SCORE_ABILITY_ID,
  SP_SD1_026_LIVE_START_ENERGY_NINE_SCORE_ABILITY_ID,
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
  return {
    cardCode: 'PL!N-bp3-026-L',
    name: 'サイコーハート',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
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
  readonly unitName?: string;
  readonly hearts: readonly HeartColor[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name ?? options.cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲学園スクールアイドル同好会'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: options.hearts.map((color) => createHeartIcon(color, 1)),
  };
}

function createNeutral(cardCode = 'PL!SP-pb1-024-L'): LiveCardData {
  return {
    cardCode,
    name: 'ニュートラル',
    groupNames: ['Liella!'],
    unitName: 'KALEIDOSCORE',
    cardType: CardType.LIVE,
    score: 6,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
  };
}

function createGoRestart(cardCode = 'PL!SP-bp2-023-L'): LiveCardData {
  return {
    cardCode,
    name: 'Go!! リスタート',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createSingShineSmile(cardCode = 'PL!SP-bp1-027-L'): LiveCardData {
  return {
    cardCode,
    name: 'Sing！Shine！Smile！',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 6,
    requirements: createHeartRequirement({
      [HeartColor.RED]: 3,
      [HeartColor.YELLOW]: 3,
      [HeartColor.PURPLE]: 3,
      [HeartColor.RAINBOW]: 5,
    }),
  };
}

function createMySymphony(cardCode = 'PL!SP-sd1-026-SD'): LiveCardData {
  return {
    cardCode,
    name: '私のSymphony 〜澮谷かのんVer.〜',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 3 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function setupSpBp1027(options: {
  readonly energyCount: number;
  readonly sourceCount?: number;
  readonly initialScore?: number;
}): {
  readonly game: GameState;
  readonly lives: readonly ReturnType<typeof createCardInstance>[];
  readonly energies: readonly ReturnType<typeof createCardInstance>[];
} {
  const lives = Array.from({ length: options.sourceCount ?? 1 }, (_, index) =>
    createCardInstance(createSingShineSmile(), PLAYER1, `sp-bp1-027-live-${index}`)
  );
  const energies = Array.from({ length: options.energyCount }, (_, index) =>
    createCardInstance(
      createEnergy(`sp-bp1-027-energy-${index}`),
      PLAYER1,
      `sp-bp1-027-energy-${index}`
    )
  );
  let game = registerCards(
    setupState({ lives, initialScore: options.initialScore ?? 6 }),
    energies
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    energyZone: energies.reduce(
      (zone, energy) => addCardToStatefulZone(zone, energy.instanceId),
      player.energyZone
    ),
  }));
  return { game, lives, energies };
}

function setupSpSd1026(options: {
  readonly energyCount: number;
  readonly sourceCode?: string;
  readonly sourceOwner?: string;
  readonly sourceInLiveZone?: boolean;
  readonly sourceAsMember?: boolean;
}): {
  readonly game: GameState;
  readonly live: ReturnType<typeof createCardInstance>;
  readonly energies: readonly ReturnType<typeof createCardInstance>[];
} {
  const sourceData = options.sourceAsMember
    ? createMember({ cardCode: options.sourceCode ?? 'PL!SP-sd1-026-SD', hearts: [] })
    : createMySymphony(options.sourceCode);
  const live = createCardInstance(sourceData, options.sourceOwner ?? PLAYER1, 'sp-sd1-026-live');
  const energies = Array.from({ length: options.energyCount }, (_, index) =>
    createCardInstance(
      createEnergy(`sp-sd1-026-energy-${index}`),
      PLAYER1,
      `sp-sd1-026-energy-${index}`
    )
  );
  let game = registerCards(
    setupState({
      lives: options.sourceInLiveZone === false ? [] : [live],
      initialScore: 4,
    }),
    options.sourceInLiveZone === false ? [live, ...energies] : energies
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    energyZone: energies.reduce(
      (zone, energy, index) =>
        addCardToStatefulZone(zone, energy.instanceId, {
          orientation: index % 2 === 0 ? OrientationState.ACTIVE : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  return { game, live, energies };
}

function createKaleidoscoreMember(id: string, name: string, unitName = 'KALEIDOSCORE') {
  return createCardInstance(
    createMember({
      cardCode: `PL!SP-test-${id}`,
      name,
      groupNames: ['Liella!'],
      unitName,
      hearts: [],
    }),
    PLAYER1,
    id
  );
}

function setupState(options: {
  readonly lives: readonly ReturnType<typeof createCardInstance>[];
  readonly successLives?: readonly ReturnType<typeof createCardInstance>[];
  readonly opponentSuccessLives?: readonly ReturnType<typeof createCardInstance>[];
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
    ...(options.opponentSuccessLives ?? []),
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
    successZone: (options.opponentSuccessLives ?? []).reduce(
      (zone, live) => addCardToStatefulZone(zone, live.instanceId),
      player.successZone
    ),
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
    createConfirmEffectStepCommand(PLAYER1, gameState.activeEffect.id, undefined, null, true)
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

function createHasunosoraMemberInstance(
  id: string,
  name: string,
  groupNames = ['蓮ノ空女学院スクールアイドルクラブ']
) {
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
  it("confirms PL!-bp3-019-L before counting current structured μ's LIVE cards and adding SCORE +1", () => {
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
    ).toContainEqual(expect.objectContaining({ liveCardId: source.instanceId, countDelta: 1 }));
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(
      latestPayload(state, PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID)
    ).toMatchObject({ museLiveCardCount: 2, conditionMet: true, scoreBonus: 1 });
  });

  it("does not count a non-μ's LIVE card for PL!-bp3-019-L", () => {
    const source = createCardInstance(createBokuraNoLiveKimiToNoLife(), PLAYER1, 'bokura-unmet');
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

    const state = confirmActiveEffectStep(sourceRemoved, PLAYER1, sourceRemoved.activeEffect!.id);
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
      const checked = new GameService().executeCheckTiming(setupState({ lives: [first, second] }), [
        TriggerCondition.ON_LIVE_START,
      ]).gameState;
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

describe('PL!SP-pb1-024 Neutral shared live-start score bonus', () => {
  function scenario(
    options: {
      readonly cardCode?: string;
      readonly names?: readonly string[];
      readonly units?: readonly string[];
      readonly sourceId?: string;
    } = {}
  ) {
    const source = createCardInstance(
      createNeutral(options.cardCode),
      PLAYER1,
      options.sourceId ?? 'neutral-source'
    );
    const names = options.names ?? ['平安名すみれ', 'ウィーン・マルガレーテ'];
    const members = names.map((name, index) =>
      createKaleidoscoreMember(`kaleidoscore-${index}`, name, options.units?.[index])
    );
    return {
      source,
      game: setupState({
        lives: [source],
        members: Object.fromEntries(
          members.map((card, index) => [
            [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index],
            card,
          ])
        ),
        initialScore: 6,
      }),
    };
  }

  it.each(['PL!SP-pb1-024-L', 'PL!SP-pb1-024-SRL'])(
    'adds source-bound SCORE +1 for two different KALEIDOSCORE names: %s',
    (cardCode) => {
      const { source, game } = scenario({ cardCode });
      const checked = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
      expect(checked.success).toBe(true);
      expect(checked.gameState.activeEffect).toMatchObject({
        abilityId: SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID,
        metadata: { confirmOnlyPendingAbility: true },
      });
      expect(checked.gameState.activeEffect?.effectText).toContain(
        '当前不同名『KALEIDOSCORE』成员2名'
      );
      expect(checked.gameState.activeEffect?.effectText).toContain('满足条件，实际[スコア]+1');
      expect(checked.gameState.activeEffect?.effectText).not.toMatch(
        /source|pending|stale|eventId/
      );
      expect(
        scoreModifiersForAbility(
          checked.gameState,
          SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID
        )
      ).toEqual([]);
      const resolved = confirmIfConfirmOnly(checked.gameState, PLAYER1);
      expect(
        scoreModifiersForAbility(resolved, SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID)
      ).toContainEqual(
        expect.objectContaining({
          playerId: PLAYER1,
          liveCardId: source.instanceId,
          sourceCardId: source.instanceId,
          countDelta: 1,
        })
      );
      expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    }
  );

  it.each([
    { names: ['平安名すみれ'], units: undefined },
    { names: ['平安名すみれ', '平安名すみれ'], units: undefined },
    { names: ['平安名すみれ', 'ウィーン・マルガレーテ'], units: ['KALEIDOSCORE', 'CatChu!'] },
  ])('does not score for one different KALEIDOSCORE name: $names', ({ names, units }) => {
    const { game } = scenario({ names, units });
    const checked = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
    expect(checked.gameState.activeEffect?.effectText).toContain('未满足条件，实际不增加分数');
    const resolved = confirmIfConfirmOnly(checked.gameState, PLAYER1);
    expect(
      scoreModifiersForAbility(resolved, SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID)
    ).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });

  it('does not count opponent stage members or memberBelow', () => {
    const base = scenario({ names: ['平安名すみれ'] });
    const below = createKaleidoscoreMember('neutral-below', 'ウィーン・マルガレーテ');
    const opponent = createCardInstance(
      createMember({
        cardCode: 'PL!SP-test-neutral-opponent',
        name: '鬼塚夏美',
        groupNames: ['Liella!'],
        unitName: 'KALEIDOSCORE',
        hearts: [],
      }),
      PLAYER2,
      'neutral-opponent'
    );
    let game = registerCards(base.game, [below, opponent]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: { ...player.memberSlots.memberBelow, [SlotPosition.LEFT]: [below.instanceId] },
      },
    }));
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, opponent.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const resolved = resolveLiveStart(game);
    expect(
      scoreModifiersForAbility(resolved, SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID)
    ).toEqual([]);
  });

  it('rechecks source validity and does not dynamically revoke an already resolved score', () => {
    const first = scenario({ sourceId: 'neutral-stale' });
    const checked = new GameService().executeCheckTiming(first.game, [
      TriggerCondition.ON_LIVE_START,
    ]).gameState;
    const departed = updatePlayer(checked, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, first.source.instanceId),
    }));
    const noOp = confirmIfConfirmOnly(departed, PLAYER1);
    expect(
      scoreModifiersForAbility(noOp, SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID)
    ).toEqual([]);

    const second = scenario({ sourceId: 'neutral-persistent' });
    const resolved = resolveLiveStart(second.game);
    const stageChanged = updatePlayer(resolved, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, null),
    }));
    expect(
      scoreModifiersForAbility(stageChanged, SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID)
    ).toHaveLength(1);
    expect(stageChanged.liveResolution.playerScores.get(PLAYER1)).toBe(7);
  });

  it('auto-resolves ordered copies and uses confirm-only for a manually selected copy', () => {
    const first = createCardInstance(createNeutral('PL!SP-pb1-024-L'), PLAYER1, 'neutral-first');
    const second = createCardInstance(
      createNeutral('PL!SP-pb1-024-SRL'),
      PLAYER1,
      'neutral-second'
    );
    const memberA = createKaleidoscoreMember('neutral-a', '平安名すみれ');
    const memberB = createKaleidoscoreMember('neutral-b', 'ウィーン・マルガレーテ');
    const checked = new GameService().executeCheckTiming(
      setupState({
        lives: [first, second],
        members: { [SlotPosition.LEFT]: memberA, [SlotPosition.RIGHT]: memberB },
        initialScore: 6,
      }),
      [TriggerCondition.ON_LIVE_START]
    ).gameState;
    const ordered = confirmActiveEffectStep(
      checked,
      PLAYER1,
      checked.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(
      scoreModifiersForAbility(ordered, SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID)
    ).toHaveLength(2);
    const manual = confirmActiveEffectStep(
      checked,
      PLAYER1,
      checked.activeEffect!.id,
      second.instanceId
    );
    expect(manual.activeEffect).toMatchObject({
      sourceCardId: second.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(
      scoreModifiersForAbility(manual, SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID)
    ).toEqual([]);
  });
});

describe('PL!SP-bp2-023 Go!! Restart shared live-start score bonus', () => {
  function scenario(options: {
    readonly cardCode?: string;
    readonly ownCount: number;
    readonly opponentCount: number;
    readonly sourceId?: string;
  }) {
    const source = createCardInstance(
      createGoRestart(options.cardCode),
      PLAYER1,
      options.sourceId ?? 'go-restart-source'
    );
    const successLives = Array.from({ length: options.ownCount }, (_, index) =>
      createCardInstance(createDummyLive(`own-success-${index}`), PLAYER1, `own-success-${index}`)
    );
    const opponentSuccessLives = Array.from({ length: options.opponentCount }, (_, index) =>
      createCardInstance(
        createDummyLive(`opponent-success-${index}`),
        PLAYER2,
        `opponent-success-${index}`
      )
    );
    return {
      source,
      game: setupState({
        lives: [source],
        successLives,
        opponentSuccessLives,
        initialScore: 1,
      }),
    };
  }

  it.each(['PL!SP-bp2-023-L', 'PL!SP-bp2-023-SRL'])(
    'queues %s through the shared handler and resolves only after confirmation',
    (cardCode) => {
      const { source, game } = scenario({ cardCode, ownCount: 1, opponentCount: 2 });
      const checked = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
      expect(checked.success).toBe(true);
      expect(checked.gameState.activeEffect).toMatchObject({
        abilityId: SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
        sourceCardId: source.instanceId,
        metadata: { confirmOnlyPendingAbility: true },
      });
      expect(checked.gameState.activeEffect?.effectText).toContain(
        '当前自己成功LIVE 1张，对方成功LIVE 2张，满足条件，实际[スコア]+1'
      );
      expect(checked.gameState.activeEffect?.effectText).not.toMatch(
        /source|pending|payload|stale|eventId|trigger|来源在LIVE区|来源不在LIVE区/
      );
      expect(
        scoreModifiersForAbility(
          checked.gameState,
          SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID
        )
      ).toEqual([]);
      expect(checked.gameState.liveResolution.playerScores.get(PLAYER1)).toBe(1);

      const resolved = confirmIfConfirmOnly(checked.gameState, PLAYER1);
      expect(
        scoreModifiersForAbility(
          resolved,
          SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID
        )
      ).toContainEqual(
        expect.objectContaining({
          playerId: PLAYER1,
          liveCardId: source.instanceId,
          sourceCardId: source.instanceId,
          countDelta: 1,
        })
      );
      expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
      expect(
        latestPayload(resolved, SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID)
      ).toMatchObject({
        ownSuccessZoneCount: 1,
        opponentSuccessZoneCount: 2,
        conditionMet: true,
        scoreBonus: 1,
      });
      const repeated = confirmActiveEffectStep(
        resolved,
        PLAYER1,
        checked.gameState.activeEffect!.id
      );
      expect(
        scoreModifiersForAbility(
          repeated,
          SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID
        )
      ).toHaveLength(1);
      expect(repeated.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    }
  );

  it.each([
    [0, 1, true],
    [0, 0, false],
    [2, 2, false],
  ] as const)(
    'compares current success zones %i:%i and conditionMet=%s',
    (ownCount, opponentCount, expectedMet) => {
      const { game } = scenario({ ownCount, opponentCount });
      const checked = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
      const expectedText = expectedMet
        ? `当前自己成功LIVE ${ownCount}张，对方成功LIVE ${opponentCount}张，满足条件，实际[スコア]+1`
        : `当前自己成功LIVE ${ownCount}张，对方成功LIVE ${opponentCount}张，未满足条件，实际不增加[スコア]`;
      expect(checked.gameState.activeEffect?.effectText).toContain(expectedText);
      const resolved = confirmIfConfirmOnly(checked.gameState, PLAYER1);
      expect(
        scoreModifiersForAbility(
          resolved,
          SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID
        )
      ).toHaveLength(expectedMet ? 1 : 0);
      expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(expectedMet ? 2 : 1);
      expect(
        latestPayload(resolved, SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID)
      ).toMatchObject({
        ownSuccessZoneCount: ownCount,
        opponentSuccessZoneCount: opponentCount,
        conditionMet: expectedMet,
        scoreBonus: expectedMet ? 1 : 0,
      });
    }
  );

  it('rechecks current counts and source validity when confirmation resolves', () => {
    const { source, game } = scenario({ ownCount: 0, opponentCount: 1 });
    const checked = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
    const departed = updatePlayer(checked.gameState, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, source.instanceId),
    }));
    const resolved = confirmIfConfirmOnly(departed, PLAYER1);
    expect(
      scoreModifiersForAbility(
        resolved,
        SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(
      latestPayload(resolved, SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID)
    ).toMatchObject({ sourceInLiveZone: false, conditionMet: false, scoreBonus: 0 });
  });

  it('does not score when current own success count changes to 3 against opponent 2 before confirmation', () => {
    const { game } = scenario({ ownCount: 2, opponentCount: 2 });
    const extraSuccess = createCardInstance(
      createDummyLive('own-success-extra'),
      PLAYER1,
      'own-success-extra'
    );
    const checked = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
    let changed = registerCards(checked.gameState, [extraSuccess]);
    changed = updatePlayer(changed, PLAYER1, (player) => ({
      ...player,
      successZone: addCardToStatefulZone(player.successZone, extraSuccess.instanceId),
    }));
    const resolved = confirmIfConfirmOnly(changed, PLAYER1);
    expect(
      scoreModifiersForAbility(
        resolved,
        SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
    expect(
      latestPayload(resolved, SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID)
    ).toMatchObject({
      ownSuccessZoneCount: 3,
      opponentSuccessZoneCount: 2,
      conditionMet: false,
      scoreBonus: 0,
    });
  });

  it('auto-resolves ordered copies and opens one confirm-only bridge for a manually selected copy', () => {
    const first = createCardInstance(createGoRestart('PL!SP-bp2-023-L'), PLAYER1, 'go-first');
    const second = createCardInstance(createGoRestart('PL!SP-bp2-023-SRL'), PLAYER1, 'go-second');
    const opponentSuccess = createCardInstance(
      createDummyLive('go-opponent-success'),
      PLAYER2,
      'go-opponent-success'
    );
    const checked = new GameService().executeCheckTiming(
      setupState({
        lives: [first, second],
        opponentSuccessLives: [opponentSuccess],
        initialScore: 2,
      }),
      [TriggerCondition.ON_LIVE_START]
    ).gameState;
    expect(checked.activeEffect?.canResolveInOrder).toBe(true);

    const ordered = confirmActiveEffectStep(
      checked,
      PLAYER1,
      checked.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(
      scoreModifiersForAbility(
        ordered,
        SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(2);
    expect(ordered.liveResolution.playerScores.get(PLAYER1)).toBe(4);

    const manual = confirmActiveEffectStep(
      checked,
      PLAYER1,
      checked.activeEffect!.id,
      second.instanceId
    );
    expect(manual.activeEffect).toMatchObject({
      abilityId: SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
      sourceCardId: second.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(
      scoreModifiersForAbility(
        manual,
        SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
    const confirmed = confirmIfConfirmOnly(manual, PLAYER1);
    expect(
      scoreModifiersForAbility(
        confirmed,
        SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(confirmed.activeEffect).toMatchObject({
      abilityId: SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
      sourceCardId: first.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
  });
});

describe('PL!N-bp3-026-L Psycho Heart live-start score bonus', () => {
  function scenario(scores: readonly number[], sourceId = 'psycho-source') {
    const source = createCardInstance(createPsychoHeart(), PLAYER1, sourceId);
    const successLives = scores.map((score, index) =>
      createCardInstance(
        createDummyLive(`success-${score}-${index}`, score),
        PLAYER1,
        `success-${score}-${index}`
      )
    );
    return { source, game: setupState({ lives: [source], successLives, initialScore: 3 }) };
  }

  it.each([
    [[], 0],
    [[1], 1],
    [[5], 1],
    [[1, 5], 2],
    [[1, 1], 1],
    [[5, 5], 1],
  ] as const)('uses printed success-zone scores %j for SCORE +%i', (scores, expected) => {
    const { game } = scenario(scores);
    const state = resolveLiveStart(game);
    expect(
      scoreModifiersForAbility(
        state,
        PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(expected > 0 ? 1 : 0);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(3 + expected);
  });

  it('opens confirm-only before resolving, with realtime player text and no internal terms', () => {
    const { game } = scenario([1, 5]);
    const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
    expect(result.success).toBe(true);
    expect(result.gameState.activeEffect).toMatchObject({
      abilityId: PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(result.gameState.activeEffect?.effectText).toContain('存在分数1的LIVE，存在分数5的LIVE');
    expect(result.gameState.activeEffect?.effectText).toContain('实际[スコア]+2');
    expect(result.gameState.activeEffect?.effectText).not.toMatch(
      /source|pending|stale|来源.*LIVE区/
    );
    expect(
      scoreModifiersForAbility(
        result.gameState,
        PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
    expect(
      confirmIfConfirmOnly(result.gameState, PLAYER1).liveResolution.playerScores.get(PLAYER1)
    ).toBe(5);
  });

  it('ordered resolution auto-resolves and manual selection opens the confirm bridge', () => {
    const first = createCardInstance(createPsychoHeart(), PLAYER1, 'psycho-first');
    const second = createCardInstance(createPsychoHeart(), PLAYER1, 'psycho-second');
    const success = createCardInstance(createDummyLive('success-five', 5), PLAYER1, 'success-five');
    const checked = new GameService().executeCheckTiming(
      setupState({ lives: [first, second], successLives: [success], initialScore: 6 }),
      [TriggerCondition.ON_LIVE_START]
    ).gameState;
    const ordered = confirmActiveEffectStep(
      checked,
      PLAYER1,
      checked.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.liveResolution.playerScores.get(PLAYER1)).toBe(8);
    const manual = confirmActiveEffectStep(
      checked,
      PLAYER1,
      checked.activeEffect!.id,
      first.instanceId
    );
    expect(manual.activeEffect?.metadata).toMatchObject({ confirmOnlyPendingAbility: true });
    expect(
      scoreModifiersForAbility(
        manual,
        PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
  });

  it('rechecks source validity and replaces an existing source/ability modifier without stacking', () => {
    const { source, game } = scenario([1, 5], 'psycho-dedupe');
    const checked = new GameService().executeCheckTiming(game, [
      TriggerCondition.ON_LIVE_START,
    ]).gameState;
    const departed = updatePlayer(checked, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, source.instanceId),
    }));
    const noOp = confirmIfConfirmOnly(departed, PLAYER1);
    expect(noOp.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(noOp.activeEffect).toBeNull();

    const resolved = resolveLiveStart(game);
    const ability = latestPayload(
      resolved,
      PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID
    );
    const repeated = resolveLiveStart({
      ...resolved,
      pendingAbilities: [
        {
          id: 'repeat',
          abilityId: PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID,
          sourceCardId: source.instanceId,
          controllerId: PLAYER1,
          triggerCondition: TriggerCondition.ON_LIVE_START,
        },
      ],
    });
    expect(ability).toBeTruthy();
    expect(
      scoreModifiersForAbility(
        repeated,
        PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(1);
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
        abilityId: PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(
      latestPayload(
        state,
        PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toMatchObject({
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
        [SlotPosition.LEFT]: createMemberInstance('pink-pink', [HeartColor.PINK, HeartColor.PINK]),
        [SlotPosition.CENTER]: createMemberInstance('pink-red', [HeartColor.PINK, HeartColor.RED]),
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
      abilityId: PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(
      latestPayload(
        state,
        PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toMatchObject({
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
      abilityId: PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
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
      abilityId: PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
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
    expect(
      latestPayload(state, PL_N_BP1_029_LIVE_START_LIVE_ZONE_THREE_THIS_LIVE_SCORE_ABILITY_ID)
    ).toMatchObject({
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
    const dummy = createCardInstance(
      createDummyLive('PL!N-ordered-dummy'),
      PLAYER1,
      'ordered-dummy'
    );
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
        [SlotPosition.RIGHT]: createHasunosoraMemberInstance('other', '高坂穂乃果', ["μ's"]),
      },
      initialScore: 4,
    });

    const checkResult = new GameService().executeCheckTiming(game, [
      TriggerCondition.ON_LIVE_START,
    ]);
    expect(checkResult.success).toBe(true);
    expect(checkResult.gameState.activeEffect).toMatchObject({
      abilityId: HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(checkResult.gameState.activeEffect?.effectText).toContain('不同名『莲之空』成员2名');
    expect(checkResult.gameState.activeEffect?.effectText).toContain('实际[スコア]+4');
    expect(checkResult.gameState.activeEffect?.effectText).not.toMatch(/source|pending|LIVE区/);
    expect(
      scoreModifiersForAbility(
        checkResult.gameState,
        HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);

    const state = confirmIfConfirmOnly(checkResult.gameState, PLAYER1);
    expect(
      scoreModifiersForAbility(
        state,
        HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toContainEqual(expect.objectContaining({ liveCardId: live.instanceId, countDelta: 4 }));
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(8);
  });

  it('PL!HS-bp2-020-L uses shared name identity, excludes non-Hasunosora members, and consumes a zero-count no-op', () => {
    const live = createCardInstance(createLinkToTheFuture(), PLAYER1, 'link-future-zero');
    const game = setupState({
      lives: [live],
      members: {
        [SlotPosition.LEFT]: createHasunosoraMemberInstance('same-jp', '大沢瑠璃乃'),
        [SlotPosition.CENTER]: createHasunosoraMemberInstance('same-spaced', '大沢 瑠璃乃'),
        [SlotPosition.RIGHT]: createHasunosoraMemberInstance('non-hs', '高坂穂乃果', ["μ's"]),
      },
      opponentMembers: {
        [SlotPosition.CENTER]: createHasunosoraMemberInstance('opponent-hime', '安養寺姫芽'),
      },
    });
    const state = resolveLiveStart(game);
    expect(
      scoreModifiersForAbility(
        state,
        HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toContainEqual(expect.objectContaining({ countDelta: 2 }));

    const noMemberState = resolveLiveStart(
      setupState({
        lives: [createCardInstance(createLinkToTheFuture(), PLAYER1, 'link-no-members')],
      })
    );
    expect(
      scoreModifiersForAbility(
        noMemberState,
        HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
    expect(
      latestPayload(
        noMemberState,
        HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toMatchObject({ scoreBonus: 0 });

    const departureLive = createCardInstance(createLinkToTheFuture(), PLAYER1, 'link-departed');
    const departureCheck = new GameService().executeCheckTiming(
      setupState({
        lives: [departureLive],
        members: {
          [SlotPosition.CENTER]: createHasunosoraMemberInstance('departure-hime', '安養寺姫芽'),
        },
      }),
      [TriggerCondition.ON_LIVE_START]
    );
    const departedBeforeConfirmation = updatePlayer(
      departureCheck.gameState,
      PLAYER1,
      (player) => ({
        ...player,
        liveZone: {
          ...player.liveZone,
          cardIds: player.liveZone.cardIds.filter((cardId) => cardId !== departureLive.instanceId),
        },
      })
    );
    const departedState = confirmIfConfirmOnly(departedBeforeConfirmation, PLAYER1);
    expect(
      scoreModifiersForAbility(
        departedState,
        HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
  });

  it.each([
    ['PL!HS-bp2-026-L', '大泽瑠璃乃', '安养寺姬芽', '藤岛 慈'],
    ['PL!HS-bp2-026-L＋', '大沢瑠璃乃', '安養寺姫芽', '藤島慈'],
  ])(
    'covers %s and adds SCORE +2 only for the printed Mira-Cra formation',
    (cardCode, rurino, hime, megu) => {
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
      expect(
        scoreModifiersForAbility(
          state,
          HS_BP2_026_LIVE_START_MIRACRA_FORMATION_THIS_LIVE_SCORE_ABILITY_ID
        )
      ).toContainEqual(expect.objectContaining({ liveCardId: live.instanceId, countDelta: 2 }));
      expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    }
  );

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
    expect(
      scoreModifiersForAbility(
        state,
        HS_BP2_026_LIVE_START_MIRACRA_FORMATION_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
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
    const checkResult = new GameService().executeCheckTiming(game, [
      TriggerCondition.ON_LIVE_START,
    ]);
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
    expect(
      scoreModifiersForAbility(
        ordered,
        HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(2);

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
    expect(
      scoreModifiersForAbility(
        preview,
        HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toEqual([]);
    const confirmed = confirmIfConfirmOnly(preview, PLAYER1);
    expect(
      scoreModifiersForAbility(
        confirmed,
        HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(1);
  });
});

describe('PL!SP-sd1-026 energy threshold score bonus', () => {
  it.each([
    ['PL!SP-sd1-026-SD', 8, false],
    ['PL!SP-sd1-026-SRL', 9, true],
    ['PL!SP-sd1-026-SD', 12, true],
  ])(
    '%s counts all %i energy-zone cards and applies SCORE +1 only at nine',
    (sourceCode, energyCount, met) => {
      const scenario = setupSpSd1026({ sourceCode, energyCount });
      const checked = new GameService().executeCheckTiming(scenario.game, [
        TriggerCondition.ON_LIVE_START,
      ]);
      expect(checked.success).toBe(true);
      expect(checked.gameState.activeEffect?.effectText).toBe(
        `【LIVE开始时】自己的能量大于等于9张的场合，此卡的[${'スコア'}]+1。（当前自己的能量${energyCount}张，${
          met ? `满足条件，实际[${'スコア'}]+1。` : '未满足条件，实际不增加分数。'
        }）`
      );
      const resolved = confirmActiveEffectStep(
        checked.gameState,
        PLAYER1,
        checked.gameState.activeEffect!.id
      );
      expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(met ? 5 : 4);
      expect(
        scoreModifiersForAbility(resolved, SP_SD1_026_LIVE_START_ENERGY_NINE_SCORE_ABILITY_ID)
      ).toHaveLength(met ? 1 : 0);
      if (met) {
        expect(
          scoreModifiersForAbility(resolved, SP_SD1_026_LIVE_START_ENERGY_NINE_SCORE_ABILITY_ID)[0]
        ).toMatchObject({
          liveCardId: scenario.live.instanceId,
          sourceCardId: scenario.live.instanceId,
          abilityId: SP_SD1_026_LIVE_START_ENERGY_NINE_SCORE_ABILITY_ID,
          countDelta: 1,
        });
      }
    }
  );

  it('counts ACTIVE, WAITING, and marked special energy by energyZone.cardIds.length', () => {
    const scenario = setupSpSd1026({ energyCount: 9 });
    const marked = {
      ...scenario.game,
      energyActivePhaseSkips: [
        {
          playerId: PLAYER1,
          energyCardId: scenario.energies[8]!.instanceId,
          sourceCardId: 'special-marker',
          abilityId: 'special-marker',
        },
      ],
    };
    const resolved = resolveLiveStart(marked);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(resolved.players[0].energyZone.cardIds).toHaveLength(9);
    expect(
      resolved.players[0].energyZone.cardStates.get(scenario.energies[1]!.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it.each([
    ['source outside LIVE zone', { sourceInLiveZone: false }],
    ['wrong owner', { sourceOwner: PLAYER2 }],
    ['wrong card type', { sourceAsMember: true }],
  ] as const)('rejects %s without a modifier or score delta', (_label, options) => {
    const scenario = setupSpSd1026({ energyCount: 9, ...options });
    const result = new GameService().executeCheckTiming(scenario.game, [
      TriggerCondition.ON_LIVE_START,
    ]);
    expect(result.success).toBe(true);
    const resolved = result.gameState.activeEffect
      ? confirmActiveEffectStep(
          result.gameState,
          result.gameState.activeEffect.awaitingPlayerId,
          result.gameState.activeEffect.id
        )
      : result.gameState;
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(
      scoreModifiersForAbility(resolved, SP_SD1_026_LIVE_START_ENERGY_NINE_SCORE_ABILITY_ID)
    ).toEqual([]);
  });

  it('rechecks source and energy at confirmation, then keeps the resolved LIVE modifier stable', () => {
    const scenario = setupSpSd1026({ energyCount: 8 });
    const checked = new GameService().executeCheckTiming(scenario.game, [
      TriggerCondition.ON_LIVE_START,
    ]).gameState;
    const ninth = createCardInstance(createEnergy('ninth-energy'), PLAYER1, 'ninth-energy');
    let gained = registerCards(checked, [ninth]);
    gained = updatePlayer(gained, PLAYER1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, ninth.instanceId),
    }));
    const resolved = confirmActiveEffectStep(gained, PLAYER1, gained.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    const laterLostEnergy = updatePlayer(resolved, PLAYER1, (player) => ({
      ...player,
      energyZone: removeCardFromStatefulZone(player.energyZone, ninth.instanceId),
    }));
    expect(laterLostEnergy.liveResolution.playerScores.get(PLAYER1)).toBe(5);

    const staleScenario = setupSpSd1026({ energyCount: 9 });
    const staleChecked = new GameService().executeCheckTiming(staleScenario.game, [
      TriggerCondition.ON_LIVE_START,
    ]).gameState;
    const sourceGone = updatePlayer(staleChecked, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, staleScenario.live.instanceId),
    }));
    const staleResolved = confirmActiveEffectStep(sourceGone, PLAYER1, sourceGone.activeEffect!.id);
    expect(staleResolved.liveResolution.playerScores.get(PLAYER1)).toBe(4);
  });

  it('reentry replaces the same source+ability modifier and preserves unrelated modifiers', () => {
    const scenario = setupSpSd1026({ energyCount: 9 });
    const unrelated = {
      ...scenario.game,
      liveResolution: {
        ...scenario.game.liveResolution,
        liveModifiers: [
          {
            kind: 'SCORE' as const,
            playerId: PLAYER1,
            countDelta: 2,
            liveCardId: scenario.live.instanceId,
            sourceCardId: 'other-source',
            abilityId: 'other-ability',
          },
        ],
        playerScores: new Map([[PLAYER1, 6]]),
      },
    };
    const once = resolveLiveStart(unrelated);
    const repeatedPending = {
      id: 'sp-sd1-026-repeat',
      abilityId: SP_SD1_026_LIVE_START_ENERGY_NINE_SCORE_ABILITY_ID,
      sourceCardId: scenario.live.instanceId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
    };
    const preview = resolvePendingCardEffects({
      ...once,
      pendingAbilities: [repeatedPending],
    }).gameState;
    const twice = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(
      scoreModifiersForAbility(twice, SP_SD1_026_LIVE_START_ENERGY_NINE_SCORE_ABILITY_ID)
    ).toHaveLength(1);
    expect(scoreModifiersForAbility(twice, 'other-ability')).toHaveLength(1);
    expect(twice.liveResolution.playerScores.get(PLAYER1)).toBe(7);
  });

  it('keeps the nine- and twelve-energy configs isolated in the same LIVE start', () => {
    const symphony = createCardInstance(createMySymphony(), PLAYER1, 'symphony');
    const sing = createCardInstance(createSingShineSmile(), PLAYER1, 'sing');
    const energies = Array.from({ length: 9 }, (_, index) =>
      createCardInstance(createEnergy(`joint-energy-${index}`), PLAYER1, `joint-energy-${index}`)
    );
    let game = registerCards(setupState({ lives: [symphony, sing], initialScore: 10 }), energies);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: energies.reduce(
        (zone, energy) => addCardToStatefulZone(zone, energy.instanceId),
        player.energyZone
      ),
    }));
    const resolved = resolveLiveStart(game);
    expect(
      scoreModifiersForAbility(resolved, SP_SD1_026_LIVE_START_ENERGY_NINE_SCORE_ABILITY_ID)
    ).toHaveLength(1);
    expect(
      scoreModifiersForAbility(resolved, SP_BP1_027_LIVE_START_ENERGY_TWELVE_SCORE_ABILITY_ID)
    ).toHaveLength(0);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(11);
  });
});

describe('PL!SP-bp1-027 energy threshold score bonus', () => {
  it.each([
    [11, false],
    [12, true],
    [15, true],
  ])(
    'PL!SP-bp1-027 uses the current %i-card energy count and adds at most SCORE +1',
    (energyCount, expectedMet) => {
      const scenario = setupSpBp1027({ energyCount });
      const checked = new GameService().executeCheckTiming(scenario.game, [
        TriggerCondition.ON_LIVE_START,
      ]);
      expect(checked.success).toBe(true);
      expect(checked.gameState.liveResolution.playerScores.get(PLAYER1)).toBe(6);
      expect(checked.gameState.activeEffect?.effectText).toBe(
        `【LIVE开始时】自己的能量大于等于12张的场合，此卡的[スコア]+1。（当前自己的能量${energyCount}张，${
          expectedMet ? '满足条件，实际[スコア]+1。' : '未满足条件，实际不增加分数。'
        }）`
      );
      const resolved = confirmActiveEffectStep(
        checked.gameState,
        PLAYER1,
        checked.gameState.activeEffect!.id
      );
      expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(expectedMet ? 7 : 6);
      expect(
        scoreModifiersForAbility(resolved, SP_BP1_027_LIVE_START_ENERGY_TWELVE_SCORE_ABILITY_ID)
      ).toEqual(
        expectedMet
          ? [
              expect.objectContaining({
                liveCardId: scenario.lives[0]!.instanceId,
                sourceCardId: scenario.lives[0]!.instanceId,
                countDelta: 1,
              }),
            ]
          : []
      );
    }
  );

  it('PL!SP-bp1-027 rechecks energy and source at confirmation and does not revoke a resolved bonus', () => {
    const scenario = setupSpBp1027({ energyCount: 11 });
    const checked = new GameService().executeCheckTiming(scenario.game, [
      TriggerCondition.ON_LIVE_START,
    ]);
    expect(checked.success).toBe(true);
    const twelfth = createCardInstance(
      createEnergy('sp-bp1-027-energy-11'),
      PLAYER1,
      'sp-bp1-027-energy-11'
    );
    let gainedEnergy = registerCards(checked.gameState, [twelfth]);
    gainedEnergy = updatePlayer(gainedEnergy, PLAYER1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, twelfth.instanceId),
    }));
    const resolved = confirmActiveEffectStep(gainedEnergy, PLAYER1, gainedEnergy.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    const afterEnergyLeaves = updatePlayer(resolved, PLAYER1, (player) => ({
      ...player,
      energyZone: removeCardFromStatefulZone(player.energyZone, twelfth.instanceId),
    }));
    expect(afterEnergyLeaves.liveResolution.playerScores.get(PLAYER1)).toBe(7);

    const staleScenario = setupSpBp1027({ energyCount: 12 });
    const staleChecked = new GameService().executeCheckTiming(staleScenario.game, [
      TriggerCondition.ON_LIVE_START,
    ]);
    const stale = updatePlayer(staleChecked.gameState, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, staleScenario.lives[0]!.instanceId),
    }));
    const staleResolved = confirmActiveEffectStep(stale, PLAYER1, stale.activeEffect!.id);
    expect(staleResolved.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });

  it('PL!SP-bp1-027 resolver replacement is idempotent for the same source and ability', () => {
    const scenario = setupSpBp1027({ energyCount: 12 });
    const resolved = resolveLiveStart(scenario.game);
    const repeatedPending = {
      id: 'sp-bp1-027-repeat',
      abilityId: SP_BP1_027_LIVE_START_ENERGY_TWELVE_SCORE_ABILITY_ID,
      sourceCardId: scenario.lives[0]!.instanceId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
    };
    const repeatPreview = resolvePendingCardEffects({
      ...resolved,
      pendingAbilities: [repeatedPending],
    }).gameState;
    const repeated = confirmActiveEffectStep(
      repeatPreview,
      PLAYER1,
      repeatPreview.activeEffect!.id
    );
    expect(repeated.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    expect(
      scoreModifiersForAbility(repeated, SP_BP1_027_LIVE_START_ENERGY_TWELVE_SCORE_ABILITY_ID)
    ).toHaveLength(1);
  });

  it('PL!SP-bp1-027 auto-resolves an ordered batch and bridges a manually selected pending', () => {
    const scenario = setupSpBp1027({ energyCount: 12, sourceCount: 2 });
    const checked = new GameService().executeCheckTiming(scenario.game, [
      TriggerCondition.ON_LIVE_START,
    ]);
    expect(checked.success).toBe(true);
    expect(checked.gameState.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      checked.gameState,
      PLAYER1,
      checked.gameState.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(
      scoreModifiersForAbility(ordered, SP_BP1_027_LIVE_START_ENERGY_TWELVE_SCORE_ABILITY_ID)
    ).toHaveLength(2);
    expect(ordered.liveResolution.playerScores.get(PLAYER1)).toBe(8);

    const manual = confirmActiveEffectStep(
      checked.gameState,
      PLAYER1,
      checked.gameState.activeEffect!.id,
      scenario.lives[1]!.instanceId
    );
    expect(manual.activeEffect).toMatchObject({
      abilityId: SP_BP1_027_LIVE_START_ENERGY_TWELVE_SCORE_ABILITY_ID,
      sourceCardId: scenario.lives[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(
      scoreModifiersForAbility(manual, SP_BP1_027_LIVE_START_ENERGY_TWELVE_SCORE_ABILITY_ID)
    ).toEqual([]);
  });
});
