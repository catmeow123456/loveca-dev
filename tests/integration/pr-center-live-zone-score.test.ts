import { describe, expect, it } from 'vitest';
import { addCheckTimingRuleSentinel } from '../helpers/check-timing-rule-sentinel';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PR_CENTER_LIVE_ZONE_SCORE_EIGHT_GAIN_LIVE_TOTAL_SCORE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const PR_CARD_CODES = [
  'PL!-PR-020-PR',
  'PL!-PR-020-P',
  'PL!SP-PR-026-PR',
  'PL!SP-PR-026-P',
] as const;

function memberData(cardCode: (typeof PR_CARD_CODES)[number]): MemberCardData {
  return {
    cardCode,
    name: cardCode.startsWith('PL!-PR-020-') ? '高坂穗乃果' : '鬼冢夏美',
    groupNames: [cardCode.startsWith('PL!SP') ? 'Liella!' : "μ's"],
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function liveData(cardCode: string, score: number): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['TEST'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 1 }),
  };
}

function pending(
  sourceCardId: string,
  id = 'pr-center-live-zone-score-pending'
): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY,
    sourceCardId,
    sourceSlot: SlotPosition.CENTER,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
  };
}

function setup(
  options: {
    readonly cardCode?: (typeof PR_CARD_CODES)[number];
    readonly liveScores?: readonly number[];
    readonly sourceSlot?: SlotPosition;
    readonly pendingCount?: number;
  } = {}
): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly liveIds: readonly string[];
} {
  const cardCode = options.cardCode ?? 'PL!-PR-020-PR';
  const source = createCardInstance(memberData(cardCode), P1, 'pr-source');
  const lives = (options.liveScores ?? [4, 4]).map((score, index) =>
    createCardInstance(liveData(`TEST-LIVE-${index}`, score), P1, `live-${index}`)
  );
  let game = registerCards(createGameState('pr-center-live-zone-score', P1, 'P1', P2, 'P2'), [
    source,
    ...lives,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      player.memberSlots,
      options.sourceSlot ?? SlotPosition.CENTER,
      source.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
    liveZone: lives.reduce(
      (zone, live) =>
        addCardToStatefulZone(zone, live.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.liveZone
    ),
  }));
  game = addCheckTimingRuleSentinel(game, P1, `${cardCode}-${options.pendingCount ?? 1}`);
  game = {
    ...game,
    pendingAbilities: Array.from({ length: options.pendingCount ?? 1 }, (_, index) =>
      pending(source.instanceId, `pr-pending-${index}`)
    ),
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: P1,
    },
  };
  return { game, sourceId: source.instanceId, liveIds: lives.map((live) => live.instanceId) };
}

function abilityScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === ABILITY
  );
}

function lastAbilityResolutionPayload(game: GameState) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY)
    .at(-1)?.payload;
}

function resolveSingle(game: GameState): {
  readonly preview: GameState;
  readonly resolved: GameState;
} {
  const preview = resolvePendingCardEffects(game).gameState;
  expect(preview.activeEffect).toMatchObject({
    abilityId: ABILITY,
    metadata: { confirmOnlyPendingAbility: true },
  });
  return {
    preview,
    resolved: confirmActiveEffectStep(preview, P1, preview.activeEffect!.id),
  };
}

describe('PR 中央 LIVE 区分数达到8时获得 LIVE 总分+1', () => {
  it.each(PR_CARD_CODES)(
    '%s uses manual confirmation and grants one source-member-bound player SCORE modifier',
    (cardCode) => {
      const scenario = setup({ cardCode });
      const { preview, resolved } = resolveSingle(scenario.game);

      expect(abilityScoreModifiers(preview)).toEqual([]);
      expect(preview.activeEffect?.effectText).toContain('有效分数合计8');
      expect(preview.activeEffect?.effectText).toContain('满足分数条件');
      expect(preview.activeEffect?.effectText).toContain('实际获得LIVE合计[スコア]+1');
      expect(preview.activeEffect?.effectText).not.toMatch(
        /来源|source|pending|payload|stale|eventId|trigger/
      );
      expect(abilityScoreModifiers(resolved)).toEqual([
        {
          kind: 'SCORE',
          playerId: P1,
          countDelta: 1,
          sourceCardId: scenario.sourceId,
          targetMemberCardId: scenario.sourceId,
          abilityId: ABILITY,
        },
      ]);
    }
  );

  it.each([
    { scores: [4, 3], expected: false },
    { scores: [4, 4], expected: true },
  ])('checks the 7/8 boundary for printed scores $scores', ({ scores, expected }) => {
    const { resolved } = resolveSingle(setup({ liveScores: scores }).game);
    expect(abilityScoreModifiers(resolved)).toHaveLength(expected ? 1 : 0);
    expect(lastAbilityResolutionPayload(resolved)).toMatchObject({
      liveZoneScoreTotal: scores.reduce((total, score) => total + score, 0),
      conditionMet: expected,
      scoreBonus: expected ? 1 : 0,
    });
  });

  it('includes per-LIVE SCORE but excludes player-total SCORE from the threshold', () => {
    const liveScenario = setup({ liveScores: [4, 3] });
    const withLiveScore = addLiveModifier(liveScenario.game, {
      kind: 'SCORE',
      playerId: P1,
      countDelta: 1,
      liveCardId: liveScenario.liveIds[1]!,
      sourceCardId: 'live-score-source',
      abilityId: 'live-score',
    });
    expect(abilityScoreModifiers(resolveSingle(withLiveScore).resolved)).toHaveLength(1);

    const playerScenario = setup({ liveScores: [4, 3] });
    const withPlayerScore = addLiveModifier(playerScenario.game, {
      kind: 'SCORE',
      playerId: P1,
      countDelta: 9,
      sourceCardId: 'player-score-source',
      abilityId: 'player-score',
    });
    const withScoreDraft = {
      ...withPlayerScore,
      liveResolution: {
        ...withPlayerScore.liveResolution,
        playerScores: new Map([[P1, 99]]),
      },
    };
    expect(abilityScoreModifiers(resolveSingle(withScoreDraft).resolved)).toHaveLength(0);
  });

  it('does not grant outside CENTER and rechecks the slot after confirmation opens', () => {
    const side = setup({ sourceSlot: SlotPosition.LEFT });
    expect(abilityScoreModifiers(resolveSingle(side.game).resolved)).toEqual([]);

    const center = setup();
    const preview = resolvePendingCardEffects(center.game).gameState;
    const moved = moveMemberBetweenSlots(preview, P1, center.sourceId, SlotPosition.LEFT);
    expect(moved).not.toBeNull();
    const resolved = confirmActiveEffectStep(
      moved!.gameState,
      P1,
      moved!.gameState.activeEffect!.id
    );
    expect(abilityScoreModifiers(resolved)).toEqual([]);
    expect(lastAbilityResolutionPayload(resolved)).toMatchObject({
      sourceInOwnCenter: false,
      conditionMet: false,
    });
  });

  it('keeps the granted ability after moving the source and removes it when that member leaves', () => {
    const scenario = setup();
    const granted = resolveSingle(scenario.game).resolved;
    const moved = moveMemberBetweenSlots(granted, P1, scenario.sourceId, SlotPosition.LEFT);
    expect(moved).not.toBeNull();
    expect(abilityScoreModifiers(moved!.gameState)).toHaveLength(1);

    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      moved!.gameState,
      P1,
      scenario.sourceId,
      enqueueTriggeredCardEffects
    );
    expect(left).not.toBeNull();
    expect(abilityScoreModifiers(left!.gameState)).toEqual([]);
    expect(left!.gameState.liveResolution.playerScoreBonuses.has(P1)).toBe(false);
  });

  it('resolves an ordered duplicate batch without stacking and bridges manual selection', () => {
    const orderedScenario = setup({ pendingCount: 2 });
    const orderSelection = resolvePendingCardEffects(orderedScenario.game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      orderSelection,
      P1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(abilityScoreModifiers(ordered)).toHaveLength(1);

    const manualScenario = setup({ pendingCount: 2 });
    const manualSelection = resolvePendingCardEffects(manualScenario.game).gameState;
    const preview = confirmActiveEffectStep(
      manualSelection,
      P1,
      manualSelection.activeEffect!.id,
      undefined,
      undefined,
      false,
      'pr-pending-1'
    );
    expect(preview.activeEffect).toMatchObject({
      abilityId: ABILITY,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(abilityScoreModifiers(preview)).toEqual([]);
    const firstResolved = confirmActiveEffectStep(preview, P1, preview.activeEffect!.id);
    expect(abilityScoreModifiers(firstResolved)).toHaveLength(1);
    expect(firstResolved.activeEffect).toMatchObject({
      abilityId: ABILITY,
      metadata: { confirmOnlyPendingAbility: true },
    });
    const allResolved = confirmActiveEffectStep(firstResolved, P1, firstResolved.activeEffect!.id);
    expect(allResolved.pendingAbilities).toEqual([]);
    expect(abilityScoreModifiers(allResolved)).toHaveLength(1);
  });
});
