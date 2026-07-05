import {
  addAction,
  getPlayerById,
  updateLiveResolution,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { getRemainingHeartTotalCount } from '../../../effects/remaining-hearts.js';
import { N_BP5_010_LIVE_SUCCESS_REMAINING_HEART_SCORE_ABILITY_ID } from '../../ability-ids.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5010ShiorikoWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    N_BP5_010_LIVE_SUCCESS_REMAINING_HEART_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveShiorikoRemainingHeartScore(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      ),
    getShiorikoConfirmationConfig
  );
}

function getShiorikoConfirmationConfig(game: GameState, ability: PendingAbilityState): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const context = getShiorikoScoreContext(game, ability);
  const previewText = getShiorikoPreviewText(context);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
    stepText: previewText,
  };
}

function resolveShiorikoRemainingHeartScore(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getShiorikoScoreContext(game, ability);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (context.actualScoreDelta !== 0) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: player.id,
      countDelta: context.actualScoreDelta,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    });
    state = updateLiveResolution(state, (liveResolution) => {
      const playerScores = new Map(liveResolution.playerScores);
      playerScores.set(player.id, context.currentScore + context.actualScoreDelta);
      return { ...liveResolution, playerScores };
    });
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: context.sourceSlot,
      step: context.sourceOnStage ? 'REMAINING_HEART_SCORE' : 'SOURCE_NOT_ON_STAGE',
      sourceOnStage: context.sourceOnStage,
      remainingHeartCount: context.remainingHeartCount,
      requestedScoreDelta: context.requestedScoreDelta,
      actualScoreDelta: context.actualScoreDelta,
      previousScore: context.currentScore,
      nextScore: context.currentScore + context.actualScoreDelta,
    }),
    options.orderedResolution === true
  );
}

function getShiorikoScoreContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceSlot: ReturnType<typeof findMemberSlot>;
  readonly sourceOnStage: boolean;
  readonly remainingHeartCount: number;
  readonly currentScore: number;
  readonly requestedScoreDelta: number;
  readonly actualScoreDelta: number;
} {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? findMemberSlot(player, ability.sourceCardId) : null;
  const sourceOnStage = sourceSlot !== null;
  const remainingHeartCount = getRemainingHeartTotalCount(game, ability.controllerId);
  const currentScore = game.liveResolution.playerScores.get(ability.controllerId) ?? 0;
  const requestedScoreDelta =
    !sourceOnStage || remainingHeartCount === 1 ? 0 : remainingHeartCount === 0 ? 1 : -1;
  const actualScoreDelta =
    requestedScoreDelta < 0 ? -Math.min(Math.abs(requestedScoreDelta), currentScore) : requestedScoreDelta;

  return {
    sourceSlot,
    sourceOnStage,
    remainingHeartCount,
    currentScore,
    requestedScoreDelta,
    actualScoreDelta,
  };
}

function formatScoreDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

function getShiorikoPreviewText(
  context: ReturnType<typeof getShiorikoScoreContext>
): string {
  if (!context.sourceOnStage) {
    return '此成员已不在舞台，本能力不改变分数。';
  }
  if (context.remainingHeartCount === 1) {
    return '当前余剩 Heart 为1个，不满足加减分条件，本次LIVE合计分数不变。';
  }
  if (context.requestedScoreDelta < 0 && context.actualScoreDelta === 0) {
    return `当前余剩 Heart 为${context.remainingHeartCount}个，但LIVE合计分数已经为0，本次LIVE合计分数不变。`;
  }
  if (context.actualScoreDelta === 0) {
    return `当前余剩 Heart 为${context.remainingHeartCount}个，本次LIVE合计分数不变。`;
  }
  return `当前余剩 Heart 为${context.remainingHeartCount}个，LIVE合计分数为${
    context.currentScore
  }。本次LIVE合计分数${formatScoreDelta(context.actualScoreDelta)}。`;
}
