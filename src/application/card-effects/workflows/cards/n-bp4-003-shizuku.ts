import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp4003ShizukuWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      resolveShizukuLiveSuccessDraw(game, ability, options, context.continuePendingCardEffects),
    (game, ability) => {
      const context = getShizukuLiveSuccessContext(game, ability);
      const previewText = getShizukuPreviewText(context);
      return {
        effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
        stepText: previewText,
      };
    }
  );
}

function resolveShizukuLiveSuccessDraw(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getShizukuLiveSuccessContext(game, ability);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  let drawnCardIds: readonly string[] = [];

  if (context.conditionMet) {
    const drawResult = drawCardsForPlayer(state, player.id, 1);
    if (!drawResult) {
      return game;
    }
    state = drawResult.gameState;
    drawnCardIds = drawResult.drawnCardIds;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: context.sourceSlot,
      step: context.conditionMet ? 'DRAW_ONE' : context.noOpStep,
      sourceOnStage: context.sourceOnStage,
      ownScore: context.ownScore,
      opponentScore: context.opponentScore,
      scoreHigherThanOpponent: context.scoreHigherThanOpponent,
      drawnCardIds,
    }),
    options.orderedResolution === true
  );
}

function getShizukuLiveSuccessContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceSlot: ReturnType<typeof getSourceMemberSlot>;
  readonly sourceOnStage: boolean;
  readonly ownScore: number;
  readonly opponentScore: number;
  readonly scoreHigherThanOpponent: boolean;
  readonly conditionMet: boolean;
  readonly noOpStep: string;
} {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  const sourceOnStage = sourceSlot !== null;
  const ownScore = game.liveResolution.playerScores.get(ability.controllerId) ?? 0;
  const opponentScore = opponent ? game.liveResolution.playerScores.get(opponent.id) ?? 0 : 0;
  const scoreHigherThanOpponent = ownScore > opponentScore;
  return {
    sourceSlot,
    sourceOnStage,
    ownScore,
    opponentScore,
    scoreHigherThanOpponent,
    conditionMet: sourceOnStage && scoreHigherThanOpponent,
    noOpStep: !sourceOnStage ? 'SOURCE_NOT_ON_STAGE' : 'SCORE_NOT_HIGHER_THAN_OPPONENT',
  };
}

function getShizukuPreviewText(context: ReturnType<typeof getShizukuLiveSuccessContext>): string {
  if (!context.sourceOnStage) {
    return `当前LIVE合计分数为${context.ownScore}对${context.opponentScore}。此成员已不在舞台，不抽牌。`;
  }
  if (!context.scoreHigherThanOpponent) {
    return `当前LIVE合计分数为${context.ownScore}对${context.opponentScore}，自己未高于对方，条件不满足，不抽牌。`;
  }
  return `当前LIVE合计分数为${context.ownScore}对${context.opponentScore}，自己高于对方。抽1张卡。`;
}
