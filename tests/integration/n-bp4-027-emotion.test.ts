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
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { PL_N_BP4_027_LIVE_START_SUCCESS_EMOTION_SCORE_REQUIREMENT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getLiveCardRequirementModifiers, getLiveCardScoreModifier } from '../../src/domain/rules/live-modifiers';
import { CardType, FaceState, HeartColor, OrientationState, TriggerCondition } from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createEmotion(cardCode = 'PL!N-bp4-027-L'): LiveCardData {
  return {
    cardCode,
    name: 'EMOTION',
    groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 3 }),
  };
}

function setupEmotion(options: {
  readonly successEmotionCount: number;
  readonly sourceInLiveZone?: boolean;
}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(createEmotion(), PLAYER1, 'emotion-source');
  const successLives = Array.from({ length: options.successEmotionCount }, (_, index) =>
    createCardInstance(createEmotion(`PL!N-success-emotion-${index}-L`), PLAYER1, `success-emotion-${index}`)
  );
  let game = createGameState(`n-bp4-027-emotion-${options.successEmotionCount}`, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...successLives]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone:
      options.sourceInLiveZone === false
        ? player.liveZone
        : addCardToStatefulZone(player.liveZone, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    successZone: successLives.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, 2]]),
    },
  };
  return { game, source };
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  const state = confirmIfConfirmOnly(result.gameState, PLAYER1);
  expect(state.activeEffect).toBeNull();
  return state;
}

function pendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: `${PL_N_BP4_027_LIVE_START_SUCCESS_EMOTION_SCORE_REQUIREMENT_ABILITY_ID}:${sourceCardId}:test`,
    abilityId: PL_N_BP4_027_LIVE_START_SUCCESS_EMOTION_SCORE_REQUIREMENT_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [],
  };
}

function resolveDirectPending(game: GameState, sourceCardId: string): GameState {
  const result = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility(sourceCardId)],
  });
  return confirmIfConfirmOnly(result.gameState, PLAYER1);
}

function emotionScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        PL_N_BP4_027_LIVE_START_SUCCESS_EMOTION_SCORE_REQUIREMENT_ABILITY_ID
  );
}

function emotionRequirementModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'REQUIREMENT' &&
      modifier.abilityId ===
        PL_N_BP4_027_LIVE_START_SUCCESS_EMOTION_SCORE_REQUIREMENT_ABILITY_ID
  );
}

function latestPayload(game: GameState) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          PL_N_BP4_027_LIVE_START_SUCCESS_EMOTION_SCORE_REQUIREMENT_ABILITY_ID
    )?.payload;
}

describe('PL!N-bp4-027-L EMOTION live-start workflow', () => {
  it('resolves with no modifier when there are zero success-zone EMOTION cards', () => {
    const { game, source } = setupEmotion({ successEmotionCount: 0 });

    const state = resolveLiveStart(game);

    expect(emotionScoreModifiers(state)).toEqual([]);
    expect(emotionRequirementModifiers(state)).toEqual([]);
    expect(getLiveCardScoreModifier(state.liveResolution, source.instanceId)).toBe(0);
    expect(getLiveCardRequirementModifiers(state.liveResolution, source.instanceId)).toEqual([]);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_MODIFIER',
      sourceInLiveZone: true,
      successEmotionCount: 0,
      scoreBonus: 0,
      requirementModifiers: [],
    });
  });

  it('adds score +2 and required no-color Heart +3 for one success-zone EMOTION', () => {
    const { game, source } = setupEmotion({ successEmotionCount: 1 });

    const state = resolveLiveStart(game);

    expect(emotionScoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 2,
        liveCardId: source.instanceId,
        sourceCardId: source.instanceId,
        abilityId: PL_N_BP4_027_LIVE_START_SUCCESS_EMOTION_SCORE_REQUIREMENT_ABILITY_ID,
      },
    ]);
    expect(emotionRequirementModifiers(state)).toEqual([
      {
        kind: 'REQUIREMENT',
        liveCardId: source.instanceId,
        modifiers: [{ color: HeartColor.RAINBOW, countDelta: 3 }],
        sourceCardId: source.instanceId,
        abilityId: PL_N_BP4_027_LIVE_START_SUCCESS_EMOTION_SCORE_REQUIREMENT_ABILITY_ID,
      },
    ]);
    expect(getLiveCardScoreModifier(state.liveResolution, source.instanceId)).toBe(2);
    expect(getLiveCardRequirementModifiers(state.liveResolution, source.instanceId)).toEqual([
      { color: HeartColor.RAINBOW, countDelta: 3 },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(4);
  });

  it('adds score +4 and required no-color Heart +6 for two success-zone EMOTION cards', () => {
    const { game, source } = setupEmotion({ successEmotionCount: 2 });

    const state = resolveLiveStart(game);

    expect(getLiveCardScoreModifier(state.liveResolution, source.instanceId)).toBe(4);
    expect(getLiveCardRequirementModifiers(state.liveResolution, source.instanceId)).toEqual([
      { color: HeartColor.RAINBOW, countDelta: 6 },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(latestPayload(state)).toMatchObject({
      step: 'SUCCESS_EMOTION_MODIFIER',
      successEmotionCount: 2,
      scoreBonus: 4,
      requirementModifiers: [{ color: HeartColor.RAINBOW, countDelta: 6 }],
    });
  });

  it('consumes pending without modifiers when source is not in live zone', () => {
    const { game, source } = setupEmotion({ successEmotionCount: 2, sourceInLiveZone: false });

    const state = resolveDirectPending(game, source.instanceId);

    expect(emotionScoreModifiers(state)).toEqual([]);
    expect(emotionRequirementModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_MODIFIER',
      sourceInLiveZone: false,
      successEmotionCount: 2,
      scoreBonus: 0,
    });
    expect(getLiveCardScoreModifier(state.liveResolution, source.instanceId)).toBe(0);
  });
});
