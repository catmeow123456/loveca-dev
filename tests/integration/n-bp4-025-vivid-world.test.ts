import { describe, expect, it } from 'vitest';
import type {
  BladeHeartItem,
  CardInstance,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  updateResolutionZone,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { addCardToZone } from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_N_BP4_025_LIVE_START_CHEER_HEART_COLORS_TO_BLUE_ABILITY_ID,
  PL_N_BP4_025_LIVE_SUCCESS_NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE_ABILITY_ID,
  SP_BP5_023_LIVE_SUCCESS_SUCCESS_ZONE_TWO_SCORE_CHEER_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { GameService } from '../../src/application/game-service';
import {
  addLiveModifier,
  getCheerCardEffectiveBladeHearts,
} from '../../src/domain/rules/live-modifiers';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

interface PerformanceService {
  autoRevealPerformanceCheer(game: GameState, playerId: string): GameState;
  finalizeAutomaticPerformanceJudgment(game: GameState, playerId: string): GameState;
}

function createVividWorld(requirementColor = HeartColor.BLUE, count = 1): LiveCardData {
  return {
    cardCode: 'PL!N-bp4-025-L',
    name: 'VIVID WORLD',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 6,
    requirements: createHeartRequirement({ [requirementColor]: count }),
  };
}

function createOtherLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly name?: string;
  readonly groupNames?: readonly string[];
  readonly blade?: number;
  readonly hearts?: readonly ReturnType<typeof createHeartIcon>[];
  readonly bladeHearts?: readonly BladeHeartItem[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name ?? options.cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: options.blade ?? 0,
    hearts: options.hearts ?? [],
    bladeHearts: options.bladeHearts,
  };
}

function createCheerHeartMember(
  cardCode: string,
  heartColor: HeartColor,
  ownerId: string,
  instanceId: string
) {
  return createCardInstance(
    {
      ...createMember({
        cardCode,
        groupNames: ['虹ヶ咲'],
        hearts: [],
      }),
      bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor }] satisfies readonly BladeHeartItem[],
    },
    ownerId,
    instanceId
  );
}

function pendingAbility(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition = TriggerCondition.ON_LIVE_START
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:${timingId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`${abilityId}:event`],
  };
}

function resolveSinglePending(game: GameState, abilityId: string, sourceCardId: string): GameState {
  const timingId =
    abilityId ===
    PL_N_BP4_025_LIVE_SUCCESS_NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE_ABILITY_ID
      ? TriggerCondition.ON_LIVE_SUCCESS
      : TriggerCondition.ON_LIVE_START;
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility(abilityId, sourceCardId, timingId)],
  }).gameState;
}

function resolveAndConfirmSinglePending(
  game: GameState,
  abilityId: string,
  sourceCardId: string
): GameState {
  return confirmIfConfirmOnly(resolveSinglePending(game, abilityId, sourceCardId), PLAYER1);
}

function setupReplacementJudgmentState(options: {
  readonly opponentPerforms?: boolean;
  readonly sourceInLiveZone?: boolean;
} = {}) {
  const owner = options.opponentPerforms ? PLAYER2 : PLAYER1;
  const live = createCardInstance(createVividWorld(HeartColor.BLUE, 7), owner, 'vivid-live');
  const bladeSource = createCardInstance(
    createMember({
      cardCode: 'BLADE-SOURCE',
      groupNames: ['虹ヶ咲'],
      blade: 7,
      hearts: [],
    }),
    owner,
    'blade-source'
  );
  const cheerColors = [
    HeartColor.PINK,
    HeartColor.RED,
    HeartColor.YELLOW,
    HeartColor.GREEN,
    HeartColor.PURPLE,
    HeartColor.RAINBOW,
    HeartColor.BLUE,
  ];
  const cheerCards = cheerColors.map((color, index) =>
    createCheerHeartMember(`CHEER-${color}`, color, owner, `cheer-${index}`)
  );
  let game = createGameState('n-bp4-025-replacement', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, bladeSource, ...cheerCards]);
  game = updatePlayer(game, owner, (player) => ({
    ...player,
    liveZone:
      options.sourceInLiveZone === false
        ? player.liveZone
        : { ...player.liveZone, cardIds: [live.instanceId] },
    mainDeck: {
      ...player.mainDeck,
      cardIds: cheerCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, bladeSource.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: owner,
    },
  };
  return { game, live, cheerCards, owner };
}

function setupLiveSuccessState(options: {
  readonly missingColor?: HeartColor;
  readonly includeNonNijigasakiPurple?: boolean;
  readonly includeLivePurple?: boolean;
  readonly includeBladeHeartPurple?: boolean;
  readonly sourceInLiveZone?: boolean;
} = {}) {
  const live = createCardInstance(createVividWorld(), PLAYER1, 'vivid-success-live');
  const memberCards = [
    HeartColor.PINK,
    HeartColor.RED,
    HeartColor.YELLOW,
    HeartColor.GREEN,
    HeartColor.BLUE,
    HeartColor.PURPLE,
  ]
    .filter((color) => color !== options.missingColor)
    .map((color) =>
      createCardInstance(
        createMember({
          cardCode: `NIJI-${color}`,
          hearts: [createHeartIcon(color, 1)],
        }),
        PLAYER1,
        `niji-${color}`
      )
    );
  const extraCards = [
    options.includeNonNijigasakiPurple
      ? createCardInstance(
          createMember({
            cardCode: 'AQOURS-PURPLE',
            groupNames: ['Aqours'],
            hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
          }),
          PLAYER1,
          'aqours-purple'
        )
      : null,
    options.includeLivePurple
      ? createCardInstance(createOtherLive('OTHER-LIVE-PURPLE'), PLAYER1, 'other-live-purple')
      : null,
    options.includeBladeHeartPurple
      ? createCardInstance(
          createMember({
            cardCode: 'NIJI-BLADE-PURPLE',
            hearts: [],
            bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.PURPLE }],
          }),
          PLAYER1,
          'niji-blade-purple'
        )
      : null,
  ].filter((card): card is CardInstance => card !== null);
  const cheerCards = [...memberCards, ...extraCards];

  let game = createGameState('n-bp4-025-live-success', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ...cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone:
      options.sourceInLiveZone === false
        ? player.liveZone
        : { ...player.liveZone, cardIds: [live.instanceId] },
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds: cheerCards.map((card) => card.instanceId),
    },
  };
  game = updateResolutionZone(game, (zone) => ({
    ...zone,
    cardIds: cheerCards.slice(1).map((card) => card.instanceId),
    revealedCardIds: cheerCards.slice(1).map((card) => card.instanceId),
  }));
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand:
      cheerCards[0] === undefined
        ? player.hand
        : addCardToZone(player.hand, cheerCards[0].instanceId),
  }));
  game = emitGameEvent(
    game,
    createCheerEvent(
      PLAYER1,
      cheerCards.map((card) => card.instanceId),
      cheerCards.length,
      { automated: true }
    )
  );

  return { game, live, cheerCards };
}

function performAutomaticJudgment(game: GameState, playerId: string): GameState {
  const service = new GameService() as unknown as PerformanceService;
  return service.finalizeAutomaticPerformanceJudgment(
    service.autoRevealPerformanceCheer(game, playerId),
    playerId
  );
}

describe('PL!N-bp4-025 VIVID WORLD', () => {
  it('LIVE_START writes a blue Heart replacement modifier after confirm-only resolution', () => {
    const scenario = setupReplacementJudgmentState();
    const started = resolveSinglePending(
      scenario.game,
      PL_N_BP4_025_LIVE_START_CHEER_HEART_COLORS_TO_BLUE_ABILITY_ID,
      scenario.live.instanceId
    );
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain(
      '因声援公开的自己的卡持有的[桃ハート]'
    );
    expect(started.activeEffect?.effectText).not.toContain('本次 LIVE 中自己的声援公开卡 Heart');
    expect(started.activeEffect?.effectText).not.toContain('来源LIVE');
    expect(started.activeEffect?.effectText).not.toContain('确认后');
    expect(started.liveResolution.liveModifiers).toEqual([]);

    const resolved = confirmIfConfirmOnly(started, PLAYER1);
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: PLAYER1,
      fromColors: [
        HeartColor.PINK,
        HeartColor.RED,
        HeartColor.YELLOW,
        HeartColor.GREEN,
        HeartColor.PURPLE,
        HeartColor.RAINBOW,
      ],
      toColor: HeartColor.BLUE,
      sourceCardId: scenario.live.instanceId,
      abilityId: PL_N_BP4_025_LIVE_START_CHEER_HEART_COLORS_TO_BLUE_ABILITY_ID,
    });
  });

  it('treats own cheer pink/red/yellow/green/purple/ALL Hearts as blue and keeps printed blue blue', () => {
    const scenario = setupReplacementJudgmentState();
    const modified = resolveAndConfirmSinglePending(
      scenario.game,
      PL_N_BP4_025_LIVE_START_CHEER_HEART_COLORS_TO_BLUE_ABILITY_ID,
      scenario.live.instanceId
    );
    const judged = performAutomaticJudgment(modified, PLAYER1);

    expect(judged.liveResolution.firstPlayerCheerCardIds).toHaveLength(7);
    expect(judged.liveResolution.liveResults.get(scenario.live.instanceId)).toBe(true);
    expect(judged.liveResolution.playerLiveJudgmentHearts.get(PLAYER1)).toEqual([
      createHeartIcon(HeartColor.BLUE, 7),
    ]);
  });

  it('does not affect opponent cheer cards', () => {
    const scenario = setupReplacementJudgmentState({ opponentPerforms: true });
    const opponentState = addLiveModifier(scenario.game, {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: PLAYER1,
      fromColors: [
        HeartColor.PINK,
        HeartColor.RED,
        HeartColor.YELLOW,
        HeartColor.GREEN,
        HeartColor.PURPLE,
        HeartColor.RAINBOW,
      ],
      toColor: HeartColor.BLUE,
      sourceCardId: 'player1-live',
      abilityId: PL_N_BP4_025_LIVE_START_CHEER_HEART_COLORS_TO_BLUE_ABILITY_ID,
    });
    const judged = performAutomaticJudgment(opponentState, PLAYER2);

    expect(judged.liveResolution.secondPlayerCheerCardIds).toHaveLength(7);
    expect(judged.liveResolution.liveResults.get(scenario.live.instanceId)).toBe(false);
  });

  it('does not write the replacement when the source LIVE has left liveZone', () => {
    const scenario = setupReplacementJudgmentState({ sourceInLiveZone: false });
    const resolved = resolveAndConfirmSinglePending(
      scenario.game,
      PL_N_BP4_025_LIVE_START_CHEER_HEART_COLORS_TO_BLUE_ABILITY_ID,
      scenario.live.instanceId
    );

    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'CHEER_HEART_COLORS_TO_BLUE',
      sourceInLiveZone: false,
      applied: false,
    });
  });

  it('LIVE_SUCCESS gives this LIVE score +1 when current own Niji cheer printed Hearts cover six colors', () => {
    const scenario = setupLiveSuccessState();
    const resolved = resolveAndConfirmSinglePending(
      scenario.game,
      PL_N_BP4_025_LIVE_SUCCESS_NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE_ABILITY_ID,
      scenario.live.instanceId
    );

    expect(resolved.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'SCORE',
        playerId: PLAYER1,
        liveCardId: scenario.live.instanceId,
        countDelta: 1,
      })
    );
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE',
      conditionMet: true,
      scoreBonus: 1,
    });
  });

  it('counts current cheer facts even when a revealed Niji member has left resolutionZone', () => {
    const scenario = setupLiveSuccessState();
    expect(scenario.game.resolutionZone.cardIds).not.toContain(scenario.cheerCards[0].instanceId);

    const resolved = resolveAndConfirmSinglePending(
      scenario.game,
      PL_N_BP4_025_LIVE_SUCCESS_NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE_ABILITY_ID,
      scenario.live.instanceId
    );

    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      conditionMet: true,
      nijigasakiCheerMemberCardIds: scenario.cheerCards.map((card) => card.instanceId),
    });
  });

  it('does not add score when a printed color is missing', () => {
    const scenario = setupLiveSuccessState({ missingColor: HeartColor.PURPLE });
    const resolved = resolveAndConfirmSinglePending(
      scenario.game,
      PL_N_BP4_025_LIVE_SUCCESS_NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE_ABILITY_ID,
      scenario.live.instanceId
    );

    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBeUndefined();
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      conditionMet: false,
      missingHeartColors: [HeartColor.PURPLE],
      scoreBonus: 0,
    });
  });

  it('does not count non-Nijigasaki members, LIVE cards, or BLADE HEART colors as printed Hearts', () => {
    const cases = [
      setupLiveSuccessState({
        missingColor: HeartColor.PURPLE,
        includeNonNijigasakiPurple: true,
      }),
      setupLiveSuccessState({ missingColor: HeartColor.PURPLE, includeLivePurple: true }),
      setupLiveSuccessState({ missingColor: HeartColor.PURPLE, includeBladeHeartPurple: true }),
    ];

    for (const scenario of cases) {
      const resolved = resolveAndConfirmSinglePending(
        scenario.game,
        PL_N_BP4_025_LIVE_SUCCESS_NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE_ABILITY_ID,
        scenario.live.instanceId
      );

      expect(resolved.liveResolution.liveModifiers).toEqual([]);
      expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
        conditionMet: false,
        missingHeartColors: [HeartColor.PURPLE],
      });
    }
  });

  it('does not add score when the source LIVE has left liveZone', () => {
    const scenario = setupLiveSuccessState({ sourceInLiveZone: false });
    const resolved = resolveAndConfirmSinglePending(
      scenario.game,
      PL_N_BP4_025_LIVE_SUCCESS_NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE_ABILITY_ID,
      scenario.live.instanceId
    );

    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      sourceInLiveZone: false,
      conditionMet: false,
    });
  });

  it('confirm-only shows current colors and resolves only after confirmation', () => {
    const scenario = setupLiveSuccessState({ missingColor: HeartColor.PURPLE });
    const started = resolveSinglePending(
      scenario.game,
      PL_N_BP4_025_LIVE_SUCCESS_NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE_ABILITY_ID,
      scenario.live.instanceId
    );

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain('[桃ハート]');
    expect(started.activeEffect?.effectText).toContain('[紫ハート]');
    expect(started.activeEffect?.effectText).toContain('未满足条件');
    expect(started.liveResolution.liveModifiers).toEqual([]);

    const resolved = confirmIfConfirmOnly(started, PLAYER1);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      conditionMet: false,
    });
  });

  it('ordered resolution resolves no-input LIVE_SUCCESS pending abilities without double confirm-only windows', () => {
    const scenario = setupLiveSuccessState();
    const stateWithPending: GameState = {
      ...scenario.game,
      pendingAbilities: [
        pendingAbility(
          PL_N_BP4_025_LIVE_SUCCESS_NIJIGASAKI_CHEER_PRINTED_SIX_HEART_COLORS_SCORE_ABILITY_ID,
          scenario.live.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
        pendingAbility(
          SP_BP5_023_LIVE_SUCCESS_SUCCESS_ZONE_TWO_SCORE_CHEER_THIS_LIVE_SCORE_ABILITY_ID,
          scenario.live.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
      ],
    };
    const orderSelection = resolvePendingCardEffects(stateWithPending).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);

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
    expect(resolved.liveResolution.liveModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'SCORE',
          countDelta: 1,
        }),
      ])
    );
  });

  it('reads replaced BLADE HEART colors through the effective cheer helper', () => {
    const scenario = setupReplacementJudgmentState();
    const modified = resolveAndConfirmSinglePending(
      scenario.game,
      PL_N_BP4_025_LIVE_START_CHEER_HEART_COLORS_TO_BLUE_ABILITY_ID,
      scenario.live.instanceId
    );

    expect(
      getCheerCardEffectiveBladeHearts(modified, PLAYER1, scenario.cheerCards[0].instanceId)
    ).toEqual([{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE }]);
  });
});
