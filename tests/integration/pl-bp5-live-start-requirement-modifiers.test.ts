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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP5_020_LIVE_START_CENTER_MUSE_YELLOW_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
  PL_BP5_022_LIVE_START_SUCCESS_ZONE_SCORE_AND_REQUIREMENT_ABILITY_ID,
  PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
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

function createLive(cardCode: string, name: string, score: number): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    unitName: 'μ’s',
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 5 }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly hearts: readonly ReturnType<typeof createHeartIcon>[];
  readonly groupNames?: readonly string[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupNames: options.groupNames ?? ["μ's"],
    unitName: 'Printemps',
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: options.hearts,
  };
}

function createPending(
  abilityId: string,
  sourceCardId: string,
  id = `pending-${abilityId}-${sourceCardId}`
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`event-${sourceCardId}`],
  };
}

function setupLiveStartState(options: {
  readonly liveCards: readonly ReturnType<typeof createCardInstance>[];
  readonly pendingAbilities: readonly PendingAbilityState[];
  readonly stageMembers?: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
  }[];
  readonly successLives?: readonly ReturnType<typeof createCardInstance>[];
}): GameState {
  const stageMembers = options.stageMembers ?? [];
  const successLives = options.successLives ?? [];
  let game = createGameState('pl-bp5-live-start-requirements', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    ...options.liveCards,
    ...stageMembers.map((member) => member.card),
    ...successLives,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    const liveZone = options.liveCards.reduce(
      (zone, live) =>
        addCardToStatefulZone(zone, live.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.liveZone
    );
    const successZone = successLives.reduce(
      (zone, live) => addCardToZone(zone, live.instanceId),
      player.successZone
    );
    const memberSlots = stageMembers.reduce(
      (slots, member) =>
        placeCardInSlot(slots, member.slot, member.card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    );
    return { ...player, liveZone, successZone, memberSlots };
  });
  return {
    ...game,
    pendingAbilities: [...options.pendingAbilities],
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, options.liveCards[0]?.data.score ?? 0]]),
    },
  };
}

function resolveSinglePending(game: GameState): GameState {
  const preview = resolvePendingCardEffects(game).gameState;
  expect(preview.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
}

describe('PL!-bp5 LIVE start requirement modifiers', () => {
  it.each([
    { label: 'no center', yellowHearts: null, groupNames: ["μ's"], expectedReduction: 0 },
    { label: 'non Muse center', yellowHearts: 6, groupNames: ['Aqours'], expectedReduction: 0 },
    { label: 'zero yellow', yellowHearts: 0, groupNames: ["μ's"], expectedReduction: 0 },
    { label: 'one yellow', yellowHearts: 1, groupNames: ["μ's"], expectedReduction: 0 },
    { label: 'two yellow', yellowHearts: 2, groupNames: ["μ's"], expectedReduction: 1 },
    { label: 'six yellow caps', yellowHearts: 6, groupNames: ["μ's"], expectedReduction: 3 },
  ])('resolves PL!-bp5-020 Wonder zone center condition: $label', (scenario) => {
    const live = createCardInstance(
      createLive('PL!-bp5-020-L', 'Wonder zone', 5),
      PLAYER1,
      `wonder-zone-${scenario.label}`
    );
    const center =
      scenario.yellowHearts === null
        ? null
        : createCardInstance(
            createMember({
              cardCode: `member-${scenario.label}`,
              name: `Center ${scenario.label}`,
              groupNames: scenario.groupNames,
              hearts:
                scenario.yellowHearts > 0
                  ? [createHeartIcon(HeartColor.YELLOW, scenario.yellowHearts)]
                  : [],
            }),
            PLAYER1,
            `center-${scenario.label}`
          );
    const game = setupLiveStartState({
      liveCards: [live],
      pendingAbilities: [
        createPending(
          PL_BP5_020_LIVE_START_CENTER_MUSE_YELLOW_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
          live.instanceId
        ),
      ],
      stageMembers: center ? [{ card: center, slot: SlotPosition.CENTER }] : [],
    });

    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect?.effectText).toContain(
      `实际减少${scenario.expectedReduction}个[無ハート]`
    );
    if (scenario.yellowHearts !== null) {
      expect(preview.activeEffect?.effectText).toContain(
        `当前[黄ハート] ${scenario.expectedReduction > 0 ? scenario.yellowHearts : scenario.groupNames[0] === "μ's" ? scenario.yellowHearts : 0}个`
      );
    }

    const state = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    const modifier = state.liveResolution.liveModifiers.find(
      (candidate) => candidate.abilityId === PL_BP5_020_LIVE_START_CENTER_MUSE_YELLOW_HEART_REDUCE_REQUIREMENT_ABILITY_ID
    );
    if (scenario.expectedReduction > 0) {
      expect(modifier).toMatchObject({
        kind: 'REQUIREMENT',
        liveCardId: live.instanceId,
        modifiers: [{ color: HeartColor.RAINBOW, countDelta: -scenario.expectedReduction }],
      });
    } else {
      expect(modifier).toBeUndefined();
    }
  });

  it('uses effective yellow Hearts for PL!-bp5-020 Wonder zone', () => {
    const live = createCardInstance(createLive('PL!-bp5-020-L', 'Wonder zone', 5), PLAYER1, 'wz');
    const center = createCardInstance(
      createMember({
        cardCode: 'PL!-test-honoka',
        name: '高坂穂乃果',
        hearts: [createHeartIcon(HeartColor.YELLOW, 2)],
      }),
      PLAYER1,
      'honoka'
    );
    let game = setupLiveStartState({
      liveCards: [live],
      pendingAbilities: [
        createPending(
          PL_BP5_020_LIVE_START_CENTER_MUSE_YELLOW_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
          live.instanceId
        ),
      ],
      stageMembers: [{ card: center, slot: SlotPosition.CENTER }],
    });
    game = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.YELLOW, count: 4 }],
      sourceCardId: center.instanceId,
      abilityId: 'test-yellow-heart-modifier',
    });

    const state = resolveSinglePending(game);

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: live.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -3 }],
      sourceCardId: live.instanceId,
      abilityId: PL_BP5_020_LIVE_START_CENTER_MUSE_YELLOW_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
    });
  });

  it('resolves PL!-bp5-022 success-zone score and all requirement increases', () => {
    const live = createCardInstance(
      createLive('PL!-bp5-022-L', 'A song for You! You? You!!', 5),
      PLAYER1,
      'song-live'
    );
    const successLives = [
      createCardInstance(createLive('success-1', 'Success 1', 1), PLAYER1, 'success-1'),
      createCardInstance(createLive('success-2', 'Success 2', 1), PLAYER1, 'success-2'),
    ];
    const game = setupLiveStartState({
      liveCards: [live],
      successLives,
      pendingAbilities: [
        createPending(
          PL_BP5_022_LIVE_START_SUCCESS_ZONE_SCORE_AND_REQUIREMENT_ABILITY_ID,
          live.instanceId
        ),
      ],
    });

    const state = resolveSinglePending(game);

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 4,
      liveCardId: live.instanceId,
      sourceCardId: live.instanceId,
      abilityId: PL_BP5_022_LIVE_START_SUCCESS_ZONE_SCORE_AND_REQUIREMENT_ABILITY_ID,
    });
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: live.instanceId,
      modifiers: [
        { color: HeartColor.PINK, countDelta: 2 },
        { color: HeartColor.YELLOW, countDelta: 2 },
        { color: HeartColor.PURPLE, countDelta: 2 },
        { color: HeartColor.RAINBOW, countDelta: 2 },
      ],
      sourceCardId: live.instanceId,
      abilityId: PL_BP5_022_LIVE_START_SUCCESS_ZONE_SCORE_AND_REQUIREMENT_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(9);
  });

  it('no-ops PL!-bp5-022 when there are no successful LIVE cards', () => {
    const live = createCardInstance(
      createLive('PL!-bp5-022-L', 'A song for You! You? You!!', 5),
      PLAYER1,
      'song-live-empty'
    );
    const game = setupLiveStartState({
      liveCards: [live],
      pendingAbilities: [
        createPending(
          PL_BP5_022_LIVE_START_SUCCESS_ZONE_SCORE_AND_REQUIREMENT_ABILITY_ID,
          live.instanceId
        ),
      ],
    });

    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect?.effectText).toContain('成功LIVE 0张');
    const state = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);

    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('counts PL!-bp5-023 stage members with non-pink-purple effective Hearts once each', () => {
    const live = createCardInstance(
      createLive('PL!-bp5-023-L', '乙姫心で恋宮殿', 3),
      PLAYER1,
      'otohime'
    );
    const redYellow = createCardInstance(
      createMember({
        cardCode: 'red-yellow-member',
        name: 'Red Yellow',
        hearts: [createHeartIcon(HeartColor.RED, 1), createHeartIcon(HeartColor.YELLOW, 1)],
      }),
      PLAYER1,
      'red-yellow'
    );
    const green = createCardInstance(
      createMember({
        cardCode: 'green-member',
        name: 'Green',
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      }),
      PLAYER1,
      'green'
    );
    const blue = createCardInstance(
      createMember({
        cardCode: 'blue-member',
        name: 'Blue',
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      }),
      PLAYER1,
      'blue'
    );
    const game = setupLiveStartState({
      liveCards: [live],
      pendingAbilities: [
        createPending(
          PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
          live.instanceId
        ),
      ],
      stageMembers: [
        { card: redYellow, slot: SlotPosition.LEFT },
        { card: green, slot: SlotPosition.CENTER },
        { card: blue, slot: SlotPosition.RIGHT },
      ],
    });

    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect?.effectText).toContain('符合条件成员 3名');
    expect(preview.activeEffect?.effectText).toContain('实际减少3个[無ハート]');
    const state = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: live.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -3 }],
      sourceCardId: live.instanceId,
      abilityId: PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
    });
  });

  it('does not count PL!-bp5-023 members that only have pink or purple Hearts', () => {
    const live = createCardInstance(
      createLive('PL!-bp5-023-L', '乙姫心で恋宮殿', 3),
      PLAYER1,
      'otohime-pink-purple'
    );
    const pink = createCardInstance(
      createMember({
        cardCode: 'pink-member',
        name: 'Pink',
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      }),
      PLAYER1,
      'pink'
    );
    const purple = createCardInstance(
      createMember({
        cardCode: 'purple-member',
        name: 'Purple',
        hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
      }),
      PLAYER1,
      'purple'
    );
    const both = createCardInstance(
      createMember({
        cardCode: 'pink-purple-member',
        name: 'Pink Purple',
        hearts: [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.PURPLE, 1)],
      }),
      PLAYER1,
      'pink-purple'
    );
    const game = setupLiveStartState({
      liveCards: [live],
      pendingAbilities: [
        createPending(
          PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
          live.instanceId
        ),
      ],
      stageMembers: [
        { card: pink, slot: SlotPosition.LEFT },
        { card: purple, slot: SlotPosition.CENTER },
        { card: both, slot: SlotPosition.RIGHT },
      ],
    });

    const state = resolveSinglePending(game);

    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('auto-resolves ordered PL!-bp5-023 pending abilities without confirm-only bridges', () => {
    const lives = [
      createCardInstance(createLive('PL!-bp5-023-L', '乙姫心で恋宮殿', 3), PLAYER1, 'otohime-a'),
      createCardInstance(createLive('PL!-bp5-023-L', '乙姫心で恋宮殿', 3), PLAYER1, 'otohime-b'),
    ];
    const red = createCardInstance(
      createMember({
        cardCode: 'red-member',
        name: 'Red',
        hearts: [createHeartIcon(HeartColor.RED, 1)],
      }),
      PLAYER1,
      'red'
    );
    const game = setupLiveStartState({
      liveCards: lives,
      pendingAbilities: lives.map((live, index) =>
        createPending(
          PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
          live.instanceId,
          `ordered-${index}`
        )
      ),
      stageMembers: [{ card: red, slot: SlotPosition.CENTER }],
    });
    const orderSelection = resolvePendingCardEffects(game).gameState;

    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const state = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    for (const live of lives) {
      expect(state.liveResolution.liveModifiers).toContainEqual({
        kind: 'REQUIREMENT',
        liveCardId: live.instanceId,
        modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
        sourceCardId: live.instanceId,
        abilityId: PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
      });
    }
  });

  it('shows a confirm-only bridge before resolving a manually selected PL!-bp5-023 pending ability', () => {
    const lives = [
      createCardInstance(createLive('PL!-bp5-023-L', '乙姫心で恋宮殿', 3), PLAYER1, 'manual-a'),
      createCardInstance(createLive('PL!-bp5-023-L', '乙姫心で恋宮殿', 3), PLAYER1, 'manual-b'),
    ];
    const red = createCardInstance(
      createMember({
        cardCode: 'red-member',
        name: 'Red',
        hearts: [createHeartIcon(HeartColor.RED, 1)],
      }),
      PLAYER1,
      'manual-red'
    );
    const game = setupLiveStartState({
      liveCards: lives,
      pendingAbilities: lives.map((live, index) =>
        createPending(
          PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
          live.instanceId,
          `manual-${index}`
        )
      ),
      stageMembers: [{ card: red, slot: SlotPosition.CENTER }],
    });
    const orderSelection = resolvePendingCardEffects(game).gameState;

    const preview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      lives[1]!.instanceId
    );

    expect(preview.activeEffect).toMatchObject({
      abilityId: PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
      sourceCardId: lives[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.liveResolution.liveModifiers).toEqual([]);

    const state = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: lives[1]!.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
      sourceCardId: lives[1]!.instanceId,
      abilityId: PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
    });
  });
});
