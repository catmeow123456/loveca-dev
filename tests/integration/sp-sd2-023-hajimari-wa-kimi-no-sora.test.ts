import { describe, expect, it } from 'vitest';
import type { LiveCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone } from '../../src/domain/entities/zone';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_SD2_023_LIVE_START_SUCCESS_ZONE_TWO_SCORE_AND_SET_REQUIREMENT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  HeartColor,
  OrientationState,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createHajimari(cardCode = 'PL!SP-sd2-023-P'): LiveCardData {
  return {
    cardCode,
    name: '始まりは君の空',
    groupName: 'Liella!',
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({
      [HeartColor.YELLOW]: 1,
      [HeartColor.RAINBOW]: 2,
    }),
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: 'Liella!',
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
  };
}

function createPendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: SP_SD2_023_LIVE_START_SUCCESS_ZONE_TWO_SCORE_AND_SET_REQUIREMENT_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
  };
}

function setupState(
  options: {
    readonly ownSuccessCount?: number;
    readonly opponentSuccessCount?: number;
    readonly includeOtherLive?: boolean;
    readonly initialScore?: number;
  } = {}
): {
  readonly game: GameState;
  readonly sourceLive: ReturnType<typeof createCardInstance>;
  readonly otherLive: ReturnType<typeof createCardInstance> | null;
} {
  const sourceLive = createCardInstance(createHajimari(), PLAYER1, 'hajimari-live');
  const otherLive = options.includeOtherLive
    ? createCardInstance(createLive('PL!SP-other-live'), PLAYER1, 'other-live')
    : null;
  const ownSuccessLives = Array.from({ length: options.ownSuccessCount ?? 0 }, (_, index) =>
    createCardInstance(createLive(`PL!SP-own-success-${index}`), PLAYER1, `own-success-${index}`)
  );
  const opponentSuccessLives = Array.from(
    { length: options.opponentSuccessCount ?? 0 },
    (_, index) =>
      createCardInstance(
        createLive(`PL!SP-opponent-success-${index}`),
        PLAYER2,
        `opponent-success-${index}`
      )
  );
  const liveCards = [
    sourceLive,
    ...(otherLive ? [otherLive] : []),
    ...ownSuccessLives,
    ...opponentSuccessLives,
  ];

  let game = createGameState('sp-sd2-023-hajimari-wa-kimi-no-sora', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, liveCards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: [sourceLive, ...(otherLive ? [otherLive] : [])].reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
        }),
      player.liveZone
    ),
    successZone: ownSuccessLives.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    successZone: opponentSuccessLives.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, options.initialScore ?? 1]]),
    },
  };

  return { game, sourceLive, otherLive };
}

function startAbility(game: GameState, sourceLiveId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [createPendingAbility(sourceLiveId)],
  }).gameState;
}

function hajimariRequirementModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'REQUIREMENT' &&
      modifier.abilityId ===
        SP_SD2_023_LIVE_START_SUCCESS_ZONE_TWO_SCORE_AND_SET_REQUIREMENT_ABILITY_ID
  );
}

function hajimariScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        SP_SD2_023_LIVE_START_SUCCESS_ZONE_TWO_SCORE_AND_SET_REQUIREMENT_ABILITY_ID
  );
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_SD2_023_LIVE_START_SUCCESS_ZONE_TWO_SCORE_AND_SET_REQUIREMENT_ABILITY_ID
    )
    .at(-1)?.payload;
}

function colorRequirementCount(
  requirement: ReturnType<typeof applyHeartRequirementModifiers>,
  color: HeartColor
): number {
  return requirement.colorRequirements.get(color) ?? 0;
}

describe('PL!SP-sd2-023 始まりは君の空 LIVE start workflow', () => {
  it('adds SCORE +5 to this LIVE, refreshes playerScores, and sets final requirement shape when own success zone has two LIVE cards', () => {
    const { game, sourceLive } = setupState({ ownSuccessCount: 2, initialScore: 1 });

    const state = startAbility(game, sourceLive.instanceId);

    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
    expect(hajimariScoreModifiers(state)).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 5,
      liveCardId: sourceLive.instanceId,
      sourceCardId: sourceLive.instanceId,
      abilityId: SP_SD2_023_LIVE_START_SUCCESS_ZONE_TWO_SCORE_AND_SET_REQUIREMENT_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);

    const requirementModifier = hajimariRequirementModifiers(state)[0];
    expect(requirementModifier).toEqual({
      kind: 'REQUIREMENT',
      liveCardId: sourceLive.instanceId,
      modifiers: [
        { color: HeartColor.RED, countDelta: 3 },
        { color: HeartColor.YELLOW, countDelta: 2 },
        { color: HeartColor.PURPLE, countDelta: 3 },
        { color: HeartColor.RAINBOW, countDelta: 1 },
      ],
      sourceCardId: sourceLive.instanceId,
      abilityId: SP_SD2_023_LIVE_START_SUCCESS_ZONE_TWO_SCORE_AND_SET_REQUIREMENT_ABILITY_ID,
    });
    const adjustedRequirement = applyHeartRequirementModifiers(
      sourceLive.data.requirements,
      requirementModifier.modifiers
    );
    expect(colorRequirementCount(adjustedRequirement, HeartColor.RED)).toBe(3);
    expect(colorRequirementCount(adjustedRequirement, HeartColor.YELLOW)).toBe(3);
    expect(colorRequirementCount(adjustedRequirement, HeartColor.PURPLE)).toBe(3);
    expect(colorRequirementCount(adjustedRequirement, HeartColor.RAINBOW)).toBe(3);
    expect(adjustedRequirement.totalRequired).toBe(12);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      ownSuccessLiveCount: 2,
      scoreBonus: 5,
      adjustedTotalRequired: 12,
    });
  });

  it('consumes the pending ability without modifiers when own success zone has fewer than two LIVE cards', () => {
    const { game, sourceLive } = setupState({ ownSuccessCount: 1, initialScore: 1 });

    const state = startAbility(game, sourceLive.instanceId);

    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
    expect(hajimariScoreModifiers(state)).toEqual([]);
    expect(hajimariRequirementModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      ownSuccessLiveCount: 1,
      scoreBonus: 0,
    });
  });

  it('auto-resolves remaining pending abilities after choosing ordered resolution', () => {
    const { game, sourceLive, otherLive } = setupState({
      ownSuccessCount: 2,
      includeOtherLive: true,
      initialScore: 1,
    });
    expect(otherLive).not.toBeNull();
    const orderSelection = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        createPendingAbility(sourceLive.instanceId),
        createPendingAbility(otherLive!.instanceId),
      ],
    }).gameState;

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
    expect(hajimariScoreModifiers(state)).toHaveLength(2);
    expect(hajimariRequirementModifiers(state)).toHaveLength(2);
  });

  it('shows a confirm-only bridge before resolving a manually selected pending ability', () => {
    const { game, sourceLive, otherLive } = setupState({
      ownSuccessCount: 2,
      includeOtherLive: true,
      initialScore: 1,
    });
    expect(otherLive).not.toBeNull();
    const orderSelection = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        createPendingAbility(sourceLive.instanceId),
        createPendingAbility(otherLive!.instanceId),
      ],
    }).gameState;

    const preview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      sourceLive.instanceId
    );

    expect(preview.activeEffect).toMatchObject({
      abilityId: SP_SD2_023_LIVE_START_SUCCESS_ZONE_TWO_SCORE_AND_SET_REQUIREMENT_ABILITY_ID,
      sourceCardId: sourceLive.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(hajimariScoreModifiers(preview)).toEqual([]);
    expect(hajimariRequirementModifiers(preview)).toEqual([]);

    const state = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);

    expect(state.activeEffect).toBeNull();
    expect(hajimariScoreModifiers(state)).toContainEqual(
      expect.objectContaining({
        kind: 'SCORE',
        liveCardId: sourceLive.instanceId,
        countDelta: 5,
      })
    );
    expect(hajimariRequirementModifiers(state)).toContainEqual(
      expect.objectContaining({
        kind: 'REQUIREMENT',
        liveCardId: sourceLive.instanceId,
      })
    );
  });

  it('does not count opponent successful LIVE cards for the condition', () => {
    const { game, sourceLive } = setupState({
      ownSuccessCount: 1,
      opponentSuccessCount: 2,
      initialScore: 1,
    });

    const state = startAbility(game, sourceLive.instanceId);

    expect(hajimariScoreModifiers(state)).toEqual([]);
    expect(hajimariRequirementModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      ownSuccessLiveCount: 1,
    });
  });

  it('binds SCORE and REQUIREMENT modifiers to the source LIVE only', () => {
    const { game, sourceLive, otherLive } = setupState({
      ownSuccessCount: 2,
      includeOtherLive: true,
      initialScore: 1,
    });

    const state = startAbility(game, sourceLive.instanceId);

    expect(otherLive).not.toBeNull();
    expect(
      hajimariScoreModifiers(state).every(
        (modifier) => modifier.liveCardId === sourceLive.instanceId
      )
    ).toBe(true);
    expect(
      hajimariRequirementModifiers(state).every(
        (modifier) => modifier.liveCardId === sourceLive.instanceId
      )
    ).toBe(true);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' && modifier.liveCardId === otherLive?.instanceId
      )
    ).toBe(false);
  });
});
