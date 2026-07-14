import {
  addAction,
  getPlayerById,
  updateLiveResolution,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { getRemainingHeartTotalCount } from '../../../effects/remaining-hearts.js';
import { PL_BP3_025_LIVE_SUCCESS_NO_REMAINING_HEART_THIS_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const SCORE_BONUS = 1;

export function registerPlBp3025TakaramonozuWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_BP3_025_LIVE_SUCCESS_NO_REMAINING_HEART_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveTakaramonozuLiveSuccess(game, ability, options, context.continuePendingCardEffects),
    getTakaramonozuConfirmationConfig
  );
}

function getTakaramonozuConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string; readonly stepText: string } {
  const evaluation = evaluateTakaramonozu(game, ability);
  const previewText = getTakaramonozuPreviewText(evaluation);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
    stepText: previewText,
  };
}

function resolveTakaramonozuLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const evaluation = evaluateTakaramonozu(game, ability);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (evaluation.shouldNormalizeModifier) {
    state = replaceLiveModifier(
      state,
      {
        kind: 'SCORE',
        playerId: player.id,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      },
      {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: SCORE_BONUS,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      }
    );
  }

  if (evaluation.scoreDelta !== 0) {
    state = updateLiveResolution(state, (liveResolution) => {
      const playerScores = new Map(liveResolution.playerScores);
      playerScores.set(player.id, evaluation.currentScore + evaluation.scoreDelta);
      return { ...liveResolution, playerScores };
    });
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: evaluation.conditionMet ? 'NO_REMAINING_HEART_THIS_LIVE_SCORE' : 'CONDITION_NOT_MET',
      sourceInLiveZone: evaluation.sourceInLiveZone,
      remainingHeartCount: evaluation.remainingHeartCount,
      conditionMet: evaluation.conditionMet,
      existingModifierCount: evaluation.existingModifierCount,
      existingScoreBonus: evaluation.existingScoreBonus,
      scoreBonus: evaluation.scoreDelta,
      previousScore: evaluation.currentScore,
      nextScore: evaluation.currentScore + evaluation.scoreDelta,
    }),
    options.orderedResolution === true
  );
}

function evaluateTakaramonozu(
  game: GameState,
  ability: Pick<PendingAbilityState, 'abilityId' | 'controllerId' | 'sourceCardId'>
): {
  readonly sourceInLiveZone: boolean;
  readonly remainingHeartCount: number;
  readonly conditionMet: boolean;
  readonly existingModifierCount: number;
  readonly existingScoreBonus: number;
  readonly shouldNormalizeModifier: boolean;
  readonly currentScore: number;
  readonly scoreDelta: number;
} {
  const player = getPlayerById(game, ability.controllerId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const remainingHeartCount = getRemainingHeartTotalCount(game, ability.controllerId);
  const conditionMet = sourceInLiveZone && remainingHeartCount === 0;
  const matchingModifiers = game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.playerId === ability.controllerId &&
      modifier.liveCardId === ability.sourceCardId &&
      modifier.sourceCardId === ability.sourceCardId &&
      modifier.abilityId === ability.abilityId
  );
  const existingScoreBonus = matchingModifiers.reduce(
    (total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0),
    0
  );
  const shouldNormalizeModifier =
    matchingModifiers.length > 1 || (conditionMet && matchingModifiers.length === 0);
  const desiredScoreBonus = matchingModifiers.length > 0 || conditionMet ? SCORE_BONUS : 0;

  return {
    sourceInLiveZone,
    remainingHeartCount,
    conditionMet,
    existingModifierCount: matchingModifiers.length,
    existingScoreBonus,
    shouldNormalizeModifier,
    currentScore: game.liveResolution.playerScores.get(ability.controllerId) ?? 0,
    scoreDelta: shouldNormalizeModifier ? desiredScoreBonus - existingScoreBonus : 0,
  };
}

function getTakaramonozuPreviewText(evaluation: ReturnType<typeof evaluateTakaramonozu>): string {
  const cardTextConditionMet = evaluation.remainingHeartCount === 0;
  const actualScoreDelta = evaluation.scoreDelta > 0 ? '+1' : '不变';
  return `当前余剩 Heart 为${evaluation.remainingHeartCount}个，${
    cardTextConditionMet ? '满足条件' : '未满足条件'
  }，实际[スコア]${actualScoreDelta}。`;
}
