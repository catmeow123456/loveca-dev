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
import { addCardToStatefulZone, removeCardFromStatefulZone } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { PL_N_PB1_038_LIVE_START_EXACT_PINK_REQUIREMENT_THIS_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function phoenix(cardCode = 'PL!N-pb1-038-L'): LiveCardData {
  return {
    cardCode,
    name: 'PHOENIX',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 3,
      [HeartColor.RED]: 1,
      [HeartColor.PURPLE]: 1,
      [HeartColor.RAINBOW]: 2,
    }),
  };
}

function stellarStream(): LiveCardData {
  return {
    cardCode: 'PL!N-pb1-039-L',
    name: 'Stellar Stream',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 4,
      [HeartColor.PURPLE]: 4,
      [HeartColor.RAINBOW]: 6,
    }),
  };
}

function setup(options: {
  readonly sources?: readonly ReturnType<typeof createCardInstance>[];
  readonly current?: readonly ReturnType<typeof createCardInstance>[];
  readonly success?: readonly ReturnType<typeof createCardInstance>[];
  readonly initialScore?: number;
}): GameState {
  const sources = options.sources ?? [createCardInstance(phoenix(), P1, 'phoenix')];
  const current = [...sources, ...(options.current ?? [])];
  const success = options.success ?? [];
  let game = registerCards(createGameState('n-pb1-038', P1, 'P1', P2, 'P2'), [
    ...current,
    ...success,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: current.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.liveZone
    ),
    successZone: success.reduce(
      (zone, card) => addCardToStatefulZone(zone, card.instanceId),
      player.successZone
    ),
  }));
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: P1,
      playerScores: new Map([[P1, options.initialScore ?? 3]]),
    },
  };
}

function check(game: GameState, sourceCardId?: string): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  if (
    sourceCardId &&
    result.gameState.activeEffect?.abilityId === 'system:select-pending-card-effect'
  ) {
    return confirmActiveEffectStep(
      result.gameState,
      P1,
      result.gameState.activeEffect.id,
      sourceCardId
    );
  }
  return result.gameState;
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        PL_N_PB1_038_LIVE_START_EXACT_PINK_REQUIREMENT_THIS_LIVE_SCORE_ABILITY_ID
  );
}

function confirm(game: GameState): GameState {
  expect(game.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id);
}

describe('PL!N-pb1-038 PHOENIX shared live-start score bonus', () => {
  it.each(['success', 'current'] as const)(
    'enters through real ON_LIVE_START and scores when only the %s zone supplies the exact match',
    (zone) => {
      const source = createCardInstance(phoenix(), P1, `phoenix-${zone}`);
      const match = createCardInstance(stellarStream(), P1, `stellar-stream-${zone}`);
      const preview = check(
        setup({
          sources: [source],
          current: zone === 'current' ? [match] : [],
          success: zone === 'success' ? [match] : [],
        }),
        source.instanceId
      );
      expect(preview.activeEffect).toMatchObject({
        abilityId: PL_N_PB1_038_LIVE_START_EXACT_PINK_REQUIREMENT_THIS_LIVE_SCORE_ABILITY_ID,
        sourceCardId: source.instanceId,
      });
      expect(preview.activeEffect?.effectText).toContain('满足条件，实际分数+1');
      expect(preview.activeEffect?.effectText).not.toMatch(/source|pending|modifier|resolver|来源/);
      const resolved = confirm(preview);
      expect(scoreModifiers(resolved)).toEqual([
        expect.objectContaining({
          countDelta: 1,
          liveCardId: source.instanceId,
          sourceCardId: source.instanceId,
        }),
      ]);
      expect(resolved.liveResolution.playerScores.get(P1)).toBe(4);
    }
  );

  it('shows no-score copy and writes no modifier when the exact condition is not met', () => {
    const source = createCardInstance(phoenix(), P1, 'phoenix-no-match');
    const preview = check(setup({ sources: [source] }));
    expect(preview.activeEffect?.effectText).toContain('未满足条件，实际分数不增加');
    const resolved = confirm(preview);
    expect(scoreModifiers(resolved)).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(P1)).toBe(3);
  });

  it('replaces repeated resolution instead of stacking and removes the old score when the source becomes stale', () => {
    const source = createCardInstance(phoenix(), P1, 'phoenix-repeat');
    const match = createCardInstance(stellarStream(), P1, 'stellar-stream-repeat');
    const first = confirm(check(setup({ sources: [source], success: [match] })));
    const repeatedPending: PendingAbilityState = {
      id: 'phoenix-repeat-pending',
      abilityId: PL_N_PB1_038_LIVE_START_EXACT_PINK_REQUIREMENT_THIS_LIVE_SCORE_ABILITY_ID,
      sourceCardId: source.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
    };
    const repeatedPreview = resolvePendingCardEffects({
      ...first,
      pendingAbilities: [repeatedPending],
    }).gameState;
    const repeated = confirm(repeatedPreview);
    expect(scoreModifiers(repeated)).toHaveLength(1);
    expect(repeated.liveResolution.playerScores.get(P1)).toBe(4);

    const stalePreview = resolvePendingCardEffects({
      ...repeated,
      pendingAbilities: [{ ...repeatedPending, id: 'phoenix-stale-pending' }],
    }).gameState;
    const stale = updatePlayer(stalePreview, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, source.instanceId),
    }));
    const resolvedStale = confirm(stale);
    expect(scoreModifiers(resolvedStale)).toEqual([]);
    expect(resolvedStale.liveResolution.playerScores.get(P1)).toBe(3);
  });

  it('clears the old score when an effective requirement modifier makes the condition fail before confirmation', () => {
    const source = createCardInstance(phoenix(), P1, 'phoenix-condition-change');
    const match = createCardInstance(stellarStream(), P1, 'stellar-stream-condition-change');
    const first = confirm(check(setup({ sources: [source], success: [match] })));
    const pending: PendingAbilityState = {
      id: 'phoenix-condition-change-pending',
      abilityId: PL_N_PB1_038_LIVE_START_EXACT_PINK_REQUIREMENT_THIS_LIVE_SCORE_ABILITY_ID,
      sourceCardId: source.instanceId,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
    };
    const preview = resolvePendingCardEffects({ ...first, pendingAbilities: [pending] }).gameState;
    const changed = addLiveModifier(preview, {
      kind: 'REQUIREMENT',
      liveCardId: match.instanceId,
      modifiers: [{ color: HeartColor.PINK, countDelta: 1 }],
      sourceCardId: 'condition-change',
      abilityId: 'condition-change',
    });
    const resolved = confirm(changed);
    expect(scoreModifiers(resolved)).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(P1)).toBe(3);
  });

  it('auto-resolves ordered copies and bridges a manually selected copy', () => {
    const first = createCardInstance(phoenix(), P1, 'phoenix-first');
    const second = createCardInstance(phoenix(), P1, 'phoenix-second');
    const match = createCardInstance(stellarStream(), P1, 'stellar-stream-ordered');
    const checked = check(setup({ sources: [first, second], success: [match] }));
    expect(checked.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      checked,
      P1,
      checked.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(scoreModifiers(ordered)).toHaveLength(2);

    const manual = confirmActiveEffectStep(
      checked,
      P1,
      checked.activeEffect!.id,
      second.instanceId
    );
    expect(manual.activeEffect).toMatchObject({
      sourceCardId: second.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(scoreModifiers(manual)).toEqual([]);
  });
});
