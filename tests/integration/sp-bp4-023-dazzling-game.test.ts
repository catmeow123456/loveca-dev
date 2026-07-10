import { describe, expect, it } from 'vitest';
import type { BladeHeartItem, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createEmptyLiveResolutionState,
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID,
  SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { GameService } from '../../src/application/game-service';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  addLiveModifier,
  getCheerCardEffectiveBladeHearts,
  getMemberEffectiveBladeCount,
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
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

interface PerformanceService {
  autoRevealPerformanceCheer(game: GameState, playerId: string): GameState;
  finalizeAutomaticPerformanceJudgment(game: GameState, playerId: string): GameState;
}

function createDazzlingGame(requirementColor = HeartColor.PURPLE, count = 1): LiveCardData {
  return {
    cardCode: 'PL!SP-bp4-023-L',
    name: 'Dazzling Game',
    groupNames: ['Liella!'],
    unitName: 'Liella!',
    cardType: CardType.LIVE,
    score: 8,
    requirements: createHeartRequirement({ [requirementColor]: count }),
  };
}

function createLive(cardCode: string, requirementColor = HeartColor.PURPLE): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [requirementColor]: 1 }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly groupNames?: readonly string[];
  readonly blade?: number;
  readonly hearts?: readonly ReturnType<typeof createHeartIcon>[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: 'Liella!',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: options.blade ?? 1,
    hearts: options.hearts ?? [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createCheerMember(
  cardCode: string,
  heartColor: HeartColor,
  ownerId: string,
  instanceId: string
) {
  return createCardInstance(
    {
      ...createMember({
        cardCode,
        name: cardCode,
        groupNames: ['Liella!'],
        blade: 0,
        hearts: [],
      }),
      bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor }] satisfies readonly BladeHeartItem[],
    },
    ownerId,
    instanceId
  );
}

function pendingAbility(abilityId: string, sourceCardId: string): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`${abilityId}:event`],
  };
}

function setupBladeSelectionState(options: {
  readonly includeNamed?: boolean;
  readonly includeOtherLiella?: boolean;
  readonly includeSameNameOtherLiella?: boolean;
  readonly sourceInLiveZone?: boolean;
} = {}) {
  const live = createCardInstance(createDazzlingGame(), PLAYER1, 'dazzling-live');
  const named = createCardInstance(
    createMember({ cardCode: 'LIELLA-KANON', name: '澁谷かのん' }),
    PLAYER1,
    'named-kanon'
  );
  const otherLiella = createCardInstance(
    createMember({ cardCode: 'LIELLA-KEKE', name: '唐 可可' }),
    PLAYER1,
    'other-keke'
  );
  const sameNameOther = createCardInstance(
    createMember({ cardCode: 'LIELLA-KANON-OTHER', name: '澁谷かのん' }),
    PLAYER1,
    'same-name-kanon'
  );
  const nonLiella = createCardInstance(
    createMember({ cardCode: 'AQOURS-CHIKA', name: '高海千歌', groupNames: ['Aqours'] }),
    PLAYER1,
    'non-liella'
  );
  const cards = [
    live,
    nonLiella,
    ...(options.includeNamed === false ? [] : [named]),
    ...(options.includeOtherLiella === false ? [] : [otherLiella]),
    ...(options.includeSameNameOtherLiella ? [sameNameOther] : []),
  ];

  let game = createGameState('sp-bp4-023-blade-selection', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, cards);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, nonLiella.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.includeNamed !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, named.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (options.includeOtherLiella !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, otherLiella.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    } else if (options.includeSameNameOtherLiella) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, sameNameOther.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone:
        options.sourceInLiveZone === false
          ? player.liveZone
          : addCardToStatefulZone(player.liveZone, live.instanceId),
      memberSlots,
    };
  });
  return { game, live, named, otherLiella, sameNameOther, nonLiella };
}

function resolveBladeAbility(game: GameState, liveId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pendingAbility(
        SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
        liveId
      ),
    ],
  }).gameState;
}

function resolveCheerReplacementAbility(game: GameState, liveId: string): GameState {
  return confirmIfConfirmOnly(
    resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pendingAbility(SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID, liveId),
      ],
    }).gameState,
    PLAYER1
  );
}

function setupCheerJudgmentState(options: { readonly opponentPerforms?: boolean } = {}) {
  const owner = options.opponentPerforms ? PLAYER2 : PLAYER1;
  const live = createCardInstance(createDazzlingGame(HeartColor.PURPLE, 6), owner, 'purple-live');
  const bladeSource = createCardInstance(
    createMember({ cardCode: 'BLADE-SOURCE', name: 'Blade Source', blade: 6, hearts: [] }),
    owner,
    'blade-source'
  );
  const cheerColors = [
    HeartColor.PINK,
    HeartColor.RED,
    HeartColor.YELLOW,
    HeartColor.GREEN,
    HeartColor.BLUE,
    HeartColor.RAINBOW,
  ];
  const cheerCards = cheerColors.map((color, index) =>
    createCheerMember(`CHEER-${color}`, color, owner, `cheer-${index}`)
  );
  let game = createGameState('sp-bp4-023-cheer-replacement', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, bladeSource, ...cheerCards]);
  game = updatePlayer(game, owner, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, bladeSource.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    mainDeck: {
      ...player.mainDeck,
      cardIds: cheerCards.map((card) => card.instanceId),
    },
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: owner,
    },
  };
  return { game, live, bladeSource, cheerCards, owner };
}

function setupFullLiveStartState() {
  const live = createCardInstance(createDazzlingGame(HeartColor.PURPLE, 6), PLAYER1, 'full-live');
  const named = createCardInstance(
    createMember({ cardCode: 'LIELLA-KANON', name: '澁谷かのん', blade: 6, hearts: [] }),
    PLAYER1,
    'full-kanon'
  );
  const otherLiella = createCardInstance(
    createMember({ cardCode: 'LIELLA-KEKE', name: '唐 可可', blade: 0, hearts: [] }),
    PLAYER1,
    'full-keke'
  );
  const cheerColors = [
    HeartColor.PINK,
    HeartColor.RED,
    HeartColor.YELLOW,
    HeartColor.GREEN,
    HeartColor.BLUE,
    HeartColor.RAINBOW,
  ];
  const cheerCards = cheerColors.map((color, index) =>
    createCheerMember(`FULL-CHEER-${color}`, color, PLAYER1, `full-cheer-${index}`)
  );
  let game = createGameState('sp-bp4-023-full-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, named, otherLiella, ...cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, named.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.RIGHT,
      otherLiella.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
    mainDeck: {
      ...player.mainDeck,
      cardIds: cheerCards.map((card) => card.instanceId),
    },
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
    },
  };
  return { game, live, named, otherLiella, cheerCards };
}

function performAutomaticJudgment(game: GameState, playerId: string): GameState {
  const service = new GameService() as unknown as PerformanceService;
  return service.finalizeAutomaticPerformanceJudgment(
    service.autoRevealPerformanceCheer(game, playerId),
    playerId
  );
}

describe('PL!SP-bp4-023 Dazzling Game', () => {
  it('selects a named member and another Liella member, and both gain one BLADE', () => {
    const scenario = setupBladeSelectionState();
    const started = resolveBladeAbility(scenario.game, scenario.live.instanceId);

    expect(started.activeEffect).toMatchObject({
      abilityId: SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
      stepId: 'SP_BP4_023_SELECT_NAMED_MEMBER_GAIN_BLADE',
      selectableCardIds: [scenario.named.instanceId],
    });

    const secondStep = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.named.instanceId
    );
    expect(secondStep.activeEffect).toMatchObject({
      stepId: 'SP_BP4_023_SELECT_OTHER_LIELLA_MEMBER_GAIN_BLADE',
      selectableCardIds: [scenario.otherLiella.instanceId],
    });

    const resolved = confirmActiveEffectStep(
      secondStep,
      PLAYER1,
      secondStep.activeEffect!.id,
      scenario.otherLiella.instanceId
    );
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, scenario.named.instanceId)).toBe(2);
    expect(getMemberEffectiveBladeCount(resolved, PLAYER1, scenario.otherLiella.instanceId)).toBe(2);
  });

  it('excludes the selected named card itself but allows another same-name Liella member', () => {
    const scenario = setupBladeSelectionState({
      includeOtherLiella: false,
      includeSameNameOtherLiella: true,
    });
    const started = resolveBladeAbility(scenario.game, scenario.live.instanceId);
    const secondStep = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.named.instanceId
    );

    expect(secondStep.activeEffect?.selectableCardIds).not.toContain(scenario.named.instanceId);
    expect(secondStep.activeEffect?.selectableCardIds).toContain(scenario.sameNameOther.instanceId);
  });

  it('no-ops without opening an empty target selection when no named member exists', () => {
    const scenario = setupBladeSelectionState({ includeNamed: false });
    const started = resolveBladeAbility(scenario.game, scenario.live.instanceId);
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);

    const resolved = confirmIfConfirmOnly(started, PLAYER1);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_NO_TARGET',
      namedMemberCount: 0,
      willGainBlade: false,
    });
  });

  it('no-ops when a named member exists but there is no other Liella member', () => {
    const scenario = setupBladeSelectionState({ includeOtherLiella: false });
    const started = resolveBladeAbility(scenario.game, scenario.live.instanceId);
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);

    const resolved = confirmIfConfirmOnly(started, PLAYER1);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      namedMemberCount: 1,
      otherLiellaCandidateCount: 0,
      willGainBlade: false,
    });
  });

  it('no-ops when the source LIVE has left liveZone', () => {
    const scenario = setupBladeSelectionState({ sourceInLiveZone: false });
    const started = resolveBladeAbility(scenario.game, scenario.live.instanceId);
    const resolved = confirmIfConfirmOnly(started, PLAYER1);

    expect(resolved.liveResolution.liveModifiers).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      sourceInLiveZone: false,
      bladeBonus: 0,
    });
  });

  it('writes a this-live own cheer Heart color replacement modifier', () => {
    const scenario = setupCheerJudgmentState();
    const started = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [
        pendingAbility(
          SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID,
          scenario.live.instanceId
        ),
      ],
    }).gameState;
    expect(started.activeEffect?.effectText).toContain('全部视为[紫ハート]');
    expect(started.activeEffect?.effectText).not.toContain('本次 LIVE 中自己的声援公开卡 Heart');
    expect(started.activeEffect?.effectText).not.toContain('来源LIVE');
    expect(started.activeEffect?.effectText).not.toContain('确认后');

    const resolved = confirmIfConfirmOnly(started, PLAYER1);

    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: PLAYER1,
      fromColors: [
        HeartColor.PINK,
        HeartColor.RED,
        HeartColor.YELLOW,
        HeartColor.GREEN,
        HeartColor.BLUE,
        HeartColor.RAINBOW,
      ],
      toColor: HeartColor.PURPLE,
      sourceCardId: scenario.live.instanceId,
      abilityId: SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID,
    });
  });

  it('projects the cheer Heart color replacement for the judgment panel', () => {
    const scenario = setupCheerJudgmentState();
    const resolved = resolveCheerReplacementAbility(scenario.game, scenario.live.instanceId);
    const view = projectPlayerViewState(resolved, PLAYER1);

    expect(view.match.liveResult?.cheerHeartColorReplacements.FIRST).toEqual({
      fromColors: [
        HeartColor.PINK,
        HeartColor.RED,
        HeartColor.YELLOW,
        HeartColor.GREEN,
        HeartColor.BLUE,
        HeartColor.RAINBOW,
      ],
      toColor: HeartColor.PURPLE,
    });
  });

  it('treats own cheer pink/red/yellow/green/blue/ALL Hearts as purple for live judgment', () => {
    const scenario = setupCheerJudgmentState();
    const modified = resolveCheerReplacementAbility(scenario.game, scenario.live.instanceId);
    const judged = performAutomaticJudgment(modified, PLAYER1);

    expect(judged.liveResolution.firstPlayerCheerCardIds).toHaveLength(6);
    expect(judged.liveResolution.liveResults.get(scenario.live.instanceId)).toBe(true);
    expect(judged.liveResolution.playerLiveJudgmentHearts.get(PLAYER1)).toEqual([
      createHeartIcon(HeartColor.PURPLE, 6),
    ]);
  });

  it('keeps the purple cheer replacement effective when both LIVE start abilities resolve in order', () => {
    const scenario = setupFullLiveStartState();
    const stateWithPending: GameState = {
      ...scenario.game,
      pendingAbilities: [
        pendingAbility(
          SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
          scenario.live.instanceId
        ),
        pendingAbility(
          SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID,
          scenario.live.instanceId
        ),
      ],
    };
    const orderSelection = resolvePendingCardEffects(stateWithPending).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);

    const firstStarted = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );
    expect(firstStarted.activeEffect).toMatchObject({
      abilityId: SP_BP4_023_LIVE_START_SELECT_NAMED_AND_OTHER_LIELLA_GAIN_BLADE_ABILITY_ID,
      stepText: '请选择自己舞台上1名「涩谷香音」「薇恩・玛格丽特」「鬼冢冬毬」获得[BLADE]。',
    });

    const secondStep = confirmActiveEffectStep(
      firstStarted,
      PLAYER1,
      firstStarted.activeEffect!.id,
      scenario.named.instanceId
    );
    const bothResolved = confirmActiveEffectStep(
      secondStep,
      PLAYER1,
      secondStep.activeEffect!.id,
      scenario.otherLiella.instanceId
    );

    expect(bothResolved.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
        playerId: PLAYER1,
        toColor: HeartColor.PURPLE,
      })
    );

    const judged = performAutomaticJudgment(bothResolved, PLAYER1);
    expect(judged.liveResolution.liveResults.get(scenario.live.instanceId)).toBe(true);
    expect(judged.liveResolution.playerLiveJudgmentHearts.get(PLAYER1)).toEqual([
      createHeartIcon(HeartColor.PURPLE, 6),
    ]);
  });

  it('does not affect opponent cheer cards', () => {
    const scenario = setupCheerJudgmentState({ opponentPerforms: true });
    const opponentState = addLiveModifier(scenario.game, {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: PLAYER1,
      fromColors: [
        HeartColor.PINK,
        HeartColor.RED,
        HeartColor.YELLOW,
        HeartColor.GREEN,
        HeartColor.BLUE,
        HeartColor.RAINBOW,
      ],
      toColor: HeartColor.PURPLE,
      sourceCardId: 'player1-source-live',
      abilityId: SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID,
    });
    const judged = performAutomaticJudgment(opponentState, PLAYER2);

    expect(judged.liveResolution.secondPlayerCheerCardIds).toHaveLength(6);
    expect(judged.liveResolution.liveResults.get(scenario.live.instanceId)).toBe(false);
  });

  it('does not change ordinary BLADE gained by the first ability', () => {
    const scenario = setupBladeSelectionState();
    const started = resolveBladeAbility(scenario.game, scenario.live.instanceId);
    const secondStep = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.named.instanceId
    );
    const bladed = confirmActiveEffectStep(
      secondStep,
      PLAYER1,
      secondStep.activeEffect!.id,
      scenario.otherLiella.instanceId
    );
    const replaced = resolveCheerReplacementAbility(bladed, scenario.live.instanceId);

    expect(getMemberEffectiveBladeCount(replaced, PLAYER1, scenario.named.instanceId)).toBe(2);
    expect(getMemberEffectiveBladeCount(replaced, PLAYER1, scenario.otherLiella.instanceId)).toBe(2);
  });

  it('clears the cheer Heart replacement when the live resolution is reset for the next LIVE', () => {
    const scenario = setupCheerJudgmentState();
    const modified = resolveCheerReplacementAbility(scenario.game, scenario.live.instanceId);
    const nextLive = {
      ...modified,
      liveResolution: createEmptyLiveResolutionState(),
    };

    expect(nextLive.liveResolution.liveModifiers).toEqual([]);
    expect(
      getCheerCardEffectiveBladeHearts(nextLive, PLAYER1, scenario.cheerCards[0].instanceId)
    ).toEqual(scenario.cheerCards[0].data.bladeHearts);
  });
});
