import { describe, expect, it } from 'vitest';
import type { HeartIcon, LiveCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updateLiveResolution,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, removeCardFromStatefulZone } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_BP3_025_LIVE_SUCCESS_NO_REMAINING_HEART_THIS_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createTakaramonozu(): LiveCardData {
  return {
    cardCode: 'PL!-bp3-025-L',
    name: 'タカラモノズ',
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 2,
      [HeartColor.YELLOW]: 2,
      [HeartColor.PURPLE]: 2,
      [HeartColor.RAINBOW]: 4,
    }),
  };
}

function pendingAbility(id: string, sourceCardId: string): PendingAbilityState {
  return {
    id,
    abilityId: PL_BP3_025_LIVE_SUCCESS_NO_REMAINING_HEART_THIS_LIVE_SCORE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`event-${id}`],
  };
}

function setup(
  options: {
    readonly remainingHearts?: readonly HeartIcon[];
    readonly sourceCount?: number;
    readonly duplicateFirstPending?: boolean;
  } = {}
): { readonly game: GameState; readonly sourceIds: readonly string[] } {
  const sourceCount = options.sourceCount ?? 1;
  const sources = Array.from({ length: sourceCount }, (_, index) =>
    createCardInstance(createTakaramonozu(), PLAYER1, `takaramonozu-${index + 1}`)
  );
  let game = createGameState('pl-bp3-025-takaramonozu', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, sources);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: sources.reduce(
      (zone, source) => addCardToStatefulZone(zone, source.instanceId),
      player.liveZone
    ),
  }));
  game = updateLiveResolution(game, (liveResolution) => ({
    ...liveResolution,
    playerScores: new Map(liveResolution.playerScores).set(PLAYER1, 4 * sourceCount),
    playerRemainingHearts: new Map(liveResolution.playerRemainingHearts).set(
      PLAYER1,
      options.remainingHearts ?? []
    ),
  }));

  const pendingAbilities = sources.map((source, index) =>
    pendingAbility(`takaramonozu-pending-${index + 1}`, source.instanceId)
  );
  if (options.duplicateFirstPending) {
    pendingAbilities.push(pendingAbility('takaramonozu-pending-duplicate', sources[0]!.instanceId));
  }
  game = { ...game, pendingAbilities };

  return { game, sourceIds: sources.map((source) => source.instanceId) };
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId === PL_BP3_025_LIVE_SUCCESS_NO_REMAINING_HEART_THIS_LIVE_SCORE_ABILITY_ID
  );
}

function confirmCurrentEffect(game: GameState): GameState {
  expect(game.activeEffect).not.toBeNull();
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id);
}

describe('PL!-bp3-025-L タカラモノズ LIVE-success workflow', () => {
  it('shows realtime zero-Heart confirmation and adds this-LIVE SCORE only after confirmation', () => {
    const { game, sourceIds } = setup();
    const preview = resolvePendingCardEffects(game).gameState;

    expect(preview.activeEffect).toMatchObject({
      abilityId: PL_BP3_025_LIVE_SUCCESS_NO_REMAINING_HEART_THIS_LIVE_SCORE_ABILITY_ID,
      sourceCardId: sourceIds[0],
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('当前余剩 Heart 为0个');
    expect(preview.activeEffect?.effectText).toContain('满足条件，实际[スコア]+1');
    expect(preview.activeEffect?.stepText).toContain('满足条件，实际[スコア]+1');
    expect(preview.activeEffect?.effectText).not.toMatch(/source|pending|stale|来源|LIVE区/);
    expect(scoreModifiers(preview)).toEqual([]);
    expect(preview.liveResolution.playerScores.get(PLAYER1)).toBe(4);

    const state = confirmCurrentEffect(preview);
    expect(scoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: sourceIds[0],
        sourceCardId: sourceIds[0],
        abilityId: PL_BP3_025_LIVE_SUCCESS_NO_REMAINING_HEART_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(state.pendingAbilities).toEqual([]);
  });

  it('counts RAINBOW in the current remaining-Heart total without consuming it', () => {
    const remainingHearts = [
      createHeartIcon(HeartColor.RED, 1),
      createHeartIcon(HeartColor.RAINBOW, 2),
    ];
    const { game } = setup({ remainingHearts });
    const preview = resolvePendingCardEffects(game).gameState;

    expect(preview.activeEffect?.effectText).toContain('当前余剩 Heart 为3个');
    expect(preview.activeEffect?.effectText).toContain('未满足条件，实际[スコア]不变');
    const state = confirmCurrentEffect(preview);

    expect(scoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(state.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual(remainingHearts);
  });

  it('rechecks current remaining Hearts when confirming in both directions', () => {
    const startsWithOne = setup({
      remainingHearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    }).game;
    const unmetPreview = resolvePendingCardEffects(startsWithOne).gameState;
    expect(unmetPreview.activeEffect?.effectText).toContain('未满足条件');
    const becameZero = updateLiveResolution(unmetPreview, (liveResolution) => ({
      ...liveResolution,
      playerRemainingHearts: new Map(liveResolution.playerRemainingHearts).set(PLAYER1, []),
    }));
    const nowMet = confirmCurrentEffect(becameZero);
    expect(scoreModifiers(nowMet)).toHaveLength(1);
    expect(nowMet.liveResolution.playerScores.get(PLAYER1)).toBe(5);

    const startsWithZero = setup().game;
    const metPreview = resolvePendingCardEffects(startsWithZero).gameState;
    expect(metPreview.activeEffect?.effectText).toContain('满足条件');
    const becameNonzero = updateLiveResolution(metPreview, (liveResolution) => ({
      ...liveResolution,
      playerRemainingHearts: new Map(liveResolution.playerRemainingHearts).set(PLAYER1, [
        createHeartIcon(HeartColor.RAINBOW, 1),
      ]),
    }));
    const nowUnmet = confirmCurrentEffect(becameNonzero);
    expect(scoreModifiers(nowUnmet)).toEqual([]);
    expect(nowUnmet.liveResolution.playerScores.get(PLAYER1)).toBe(4);
  });

  it('no-ops if the source LIVE leaves before confirmation', () => {
    const { game, sourceIds } = setup();
    const preview = resolvePendingCardEffects(game).gameState;
    const sourceRemoved = updatePlayer(preview, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, sourceIds[0]!),
    }));
    const state = confirmCurrentEffect(sourceRemoved);

    expect(scoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(
      state.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP3_025_LIVE_SUCCESS_NO_REMAINING_HEART_THIS_LIVE_SCORE_ABILITY_ID
      )?.payload
    ).toMatchObject({ sourceInLiveZone: false, conditionMet: false, scoreBonus: 0 });
  });

  it('auto-resolves ordered duplicate pending without stacking the same source modifier', () => {
    const { game, sourceIds } = setup({ duplicateFirstPending: true });
    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe('system:select-pending-card-effect');

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
    expect(scoreModifiers(state)).toEqual([
      expect.objectContaining({
        sourceCardId: sourceIds[0],
        liveCardId: sourceIds[0],
        countDelta: 1,
      }),
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('uses confirm-only for a manually selected pending and continues the remaining pending', () => {
    const { game, sourceIds } = setup({ sourceCount: 2 });
    const orderSelection = resolvePendingCardEffects(game).gameState;
    const selectedPreview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      sourceIds[1]
    );

    expect(selectedPreview.activeEffect).toMatchObject({
      sourceCardId: sourceIds[1],
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(scoreModifiers(selectedPreview)).toEqual([]);

    const afterSelected = confirmCurrentEffect(selectedPreview);
    expect(scoreModifiers(afterSelected)).toContainEqual(
      expect.objectContaining({ sourceCardId: sourceIds[1], liveCardId: sourceIds[1] })
    );
    expect(afterSelected.activeEffect).toMatchObject({
      sourceCardId: sourceIds[0],
      metadata: { confirmOnlyPendingAbility: true },
    });

    const finished = confirmCurrentEffect(afterSelected);
    expect(finished.pendingAbilities).toEqual([]);
    expect(scoreModifiers(finished)).toHaveLength(2);
    expect(finished.liveResolution.playerScores.get(PLAYER1)).toBe(10);
  });
});
