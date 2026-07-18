import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updateLiveResolution,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, removeCardFromStatefulZone } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { S_BP3_019_LIVE_SUCCESS_NO_NON_BLADE_CHEER_OR_TWO_REMAINING_HEART_SET_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { BladeHeartEffect, CardType, HeartColor, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const ABILITY_ID = S_BP3_019_LIVE_SUCCESS_NO_NON_BLADE_CHEER_OR_TWO_REMAINING_HEART_SET_SCORE_ABILITY_ID;

function miracleWave(): LiveCardData {
  return {
    cardCode: 'PL!S-bp3-019-L', name: 'MIRACLE WAVE', cardType: CardType.LIVE, score: 7,
    requirements: createHeartRequirement({ [HeartColor.RED]: 4 }),
  };
}

function cheerCard(code: string, bladeHeart: boolean): MemberCardData {
  return {
    cardCode: code, name: code, cardType: CardType.MEMBER, cost: 1, blade: 1, hearts: [],
    bladeHearts: bladeHeart ? [{ effect: BladeHeartEffect.DRAW }] : [],
  };
}

function setup(options: {
  readonly cheerBladeHearts?: readonly boolean[];
  readonly extraScoreModifier?: number;
  readonly remainingHeartCount?: number;
  readonly sourceCount?: number;
} = {}) {
  const sources = Array.from({ length: options.sourceCount ?? 1 }, (_, index) =>
    createCardInstance(miracleWave(), P1, `miracle-wave-${index}`)
  );
  const source = sources[0]!;
  const cheerCards = (options.cheerBladeHearts ?? []).map((bladeHeart, index) =>
    createCardInstance(cheerCard(`CHEER-${index}`, bladeHeart), P1, `cheer-${index}`)
  );
  let game = registerCards(createGameState('s-bp3-019', P1, 'P1', P2, 'P2'), [...sources, ...cheerCards]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: sources.reduce((zone, card) => addCardToStatefulZone(zone, card.instanceId), player.liveZone),
  }));
  if (cheerCards.length > 0) {
    game = emitGameEvent(game, createCheerEvent(P1, cheerCards.map((card) => card.instanceId), 2));
  }
  game = updateLiveResolution(game, (liveResolution) => ({
    ...liveResolution,
    playerScores: new Map(liveResolution.playerScores).set(
      P1,
      7 * sources.length + (options.extraScoreModifier ?? 0)
    ),
    liveModifiers: options.extraScoreModifier
      ? [...liveResolution.liveModifiers, { kind: 'SCORE' as const, playerId: P1, countDelta: options.extraScoreModifier, liveCardId: source.instanceId, sourceCardId: 'other', abilityId: 'other' }]
      : liveResolution.liveModifiers,
    playerRemainingHearts: new Map(liveResolution.playerRemainingHearts).set(
      P1,
      options.remainingHeartCount
        ? [createHeartIcon(HeartColor.RAINBOW, options.remainingHeartCount)]
        : []
    ),
  }));
  const pendingAbilities: PendingAbilityState[] = sources.map((card, index) => ({
    id: `pending-019-${index}`, abilityId: ABILITY_ID, sourceCardId: card.instanceId, controllerId: P1,
    mandatory: true, timingId: TriggerCondition.ON_LIVE_SUCCESS, eventIds: ['live-success'],
  }));
  return { game: { ...game, pendingAbilities }, source, sources };
}

function resolve(game: GameState): GameState {
  const preview = resolvePendingCardEffects(game).gameState;
  expect(preview.activeEffect?.metadata).toMatchObject({ confirmOnlyPendingAbility: true });
  return confirmActiveEffectStep(preview, P1, preview.activeEffect!.id);
}

describe('PL!S-bp3-019-L MIRACLE WAVE', () => {
  it('treats zero revealed cards as satisfying FAQ Q182 and changes printed 7 to exact 4', () => {
    const { game, source } = setup();
    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect?.effectText).toContain('本回合声援公开0张卡');
    expect(preview.activeEffect?.effectText).toContain('结算后变为4');
    const state = confirmActiveEffectStep(preview, P1, preview.activeEffect!.id);
    expect(state.liveResolution.playerScores.get(P1)).toBe(4);
    expect(state.liveResolution.liveModifiers).toContainEqual(expect.objectContaining({
      abilityId: ABILITY_ID, liveCardId: source.instanceId, countDelta: -3,
    }));
  });

  it('uses historical CheerEvent facts after cards leave resolution and fails with one non-Blade card', () => {
    const { game } = setup({ cheerBladeHearts: [true, false] });
    const state = resolve(game);
    expect(state.liveResolution.playerScores.get(P1)).toBe(7);
    expect(state.liveResolution.liveModifiers).toHaveLength(0);
  });

  it('uses the remaining-Heart >=2 OR branch when a non-Blade-Heart card was revealed', () => {
    const { game } = setup({ cheerBladeHearts: [false], remainingHeartCount: 2 });
    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect?.effectText).toContain('当前剩余Heart为2个（满足条件）');
    const state = confirmActiveEffectStep(preview, P1, preview.activeEffect!.id);
    expect(state.liveResolution.playerScores.get(P1)).toBe(4);
    expect(state.liveResolution.playerRemainingHearts.get(P1)).toEqual([
      createHeartIcon(HeartColor.RAINBOW, 2),
    ]);
  });

  it('is enqueued by the real LIVE_SUCCESS timing and uses remaining Heart >=2', () => {
    const { game, source } = setup({ cheerBladeHearts: [false], remainingHeartCount: 2 });
    const timingState: GameState = {
      ...game,
      pendingAbilities: [],
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map([[source.instanceId, true]]),
        performingPlayerId: P1,
      },
    };

    const checked = new GameService().executeCheckTiming(timingState, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);
    expect(checked.success, checked.error).toBe(true);
    expect(checked.gameState.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      sourceCardId: source.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(checked.gameState.activeEffect?.effectText).toContain(
      '当前剩余Heart为2个（满足条件）'
    );

    const resolved = confirmActiveEffectStep(
      checked.gameState,
      P1,
      checked.gameState.activeEffect!.id
    );
    expect(resolved.liveResolution.playerScores.get(P1)).toBe(4);
  });

  it('normalizes exact 4 around an existing negative SCORE modifier', () => {
    const { game, source } = setup({ cheerBladeHearts: [true], extraScoreModifier: -2 });
    const state = resolve(game);
    expect(state.liveResolution.playerScores.get(P1)).toBe(4);
    expect(state.liveResolution.liveModifiers).toContainEqual(expect.objectContaining({
      abilityId: ABILITY_ID, liveCardId: source.instanceId, countDelta: -1,
    }));
  });

  it('no-ops when the source LIVE leaves before confirmation', () => {
    const { game, source } = setup();
    const preview = resolvePendingCardEffects(game).gameState;
    const stale = updatePlayer(preview, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, source.instanceId),
    }));
    const state = confirmActiveEffectStep(stale, P1, preview.activeEffect!.id);
    expect(state.liveResolution.playerScores.get(P1)).toBe(7);
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('shows confirm-only after manually selecting 019 from multiple pending', () => {
    const { game, sources } = setup({ sourceCount: 2 });
    const selection = resolvePendingCardEffects(game).gameState;
    expect(selection.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
    const selected = confirmActiveEffectStep(
      selection, P1, selection.activeEffect!.id, sources[1]!.instanceId
    );
    expect(selected.activeEffect).toMatchObject({
      sourceCardId: sources[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(selected.liveResolution.playerScores.get(P1)).toBe(14);
  });

  it('ordered multi-pending resolves both 019 abilities without per-item confirmation', () => {
    const { game } = setup({ sourceCount: 2 });
    const selection = resolvePendingCardEffects(game).gameState;
    const state = confirmActiveEffectStep(
      selection, P1, selection.activeEffect!.id, undefined, undefined, true
    );
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.playerScores.get(P1)).toBe(8);
    expect(state.liveResolution.liveModifiers.filter(
      (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === ABILITY_ID
    )).toHaveLength(2);
  });

  it('normalizes around existing positive and negative score modifiers and is idempotent', () => {
    const { game, source } = setup({ cheerBladeHearts: [true], extraScoreModifier: 2 });
    const first = resolve(game);
    expect(first.liveResolution.playerScores.get(P1)).toBe(4);
    expect(first.liveResolution.liveModifiers).toContainEqual(expect.objectContaining({
      abilityId: ABILITY_ID, liveCardId: source.instanceId, countDelta: -5,
    }));
    const duplicate: PendingAbilityState = { ...game.pendingAbilities[0]!, id: 'pending-019-duplicate' };
    const second = resolve({ ...first, pendingAbilities: [duplicate] });
    expect(second.liveResolution.playerScores.get(P1)).toBe(4);
    expect(second.liveResolution.liveModifiers.filter((modifier) => modifier.kind === 'SCORE' && modifier.abilityId === ABILITY_ID)).toHaveLength(1);
  });
});
