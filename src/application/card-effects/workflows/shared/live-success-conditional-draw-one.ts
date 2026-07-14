import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import {
  PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID,
  S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID,
} from '../../ability-ids.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type LiveSuccessConditionalDrawConfig =
  | {
      readonly abilityId: typeof PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID;
      readonly expectedBaseCardCodes: readonly ['PL!N-bp4-003'];
      readonly conditionType: 'HIGHER_LIVE_SCORE';
      readonly actionStep: 'DRAW_ONE';
      readonly noOpSteps: {
        readonly sourceMissing: 'SOURCE_NOT_ON_STAGE';
        readonly conditionNotMet: 'SCORE_NOT_HIGHER_THAN_OPPONENT';
      };
    }
  | {
      readonly abilityId: typeof S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID;
      readonly expectedBaseCardCodes: readonly ['PL!S-bp3-005'];
      readonly conditionType: 'OWN_REVEALED_CHEER_COUNT_LESS_THAN_OPPONENT';
      readonly actionStep: 'DRAW_ONE';
      readonly noOpSteps: {
        readonly sourceMissing: 'SOURCE_NOT_ON_STAGE';
        readonly conditionNotMet: 'REVEALED_CHEER_COUNT_NOT_LOWER';
      };
    };

const LIVE_SUCCESS_CONDITIONAL_DRAW_CONFIGS: readonly LiveSuccessConditionalDrawConfig[] = [
  {
    abilityId: PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID,
    expectedBaseCardCodes: ['PL!N-bp4-003'],
    conditionType: 'HIGHER_LIVE_SCORE',
    actionStep: 'DRAW_ONE',
    noOpSteps: {
      sourceMissing: 'SOURCE_NOT_ON_STAGE',
      conditionNotMet: 'SCORE_NOT_HIGHER_THAN_OPPONENT',
    },
  },
  {
    abilityId: S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID,
    expectedBaseCardCodes: ['PL!S-bp3-005'],
    conditionType: 'OWN_REVEALED_CHEER_COUNT_LESS_THAN_OPPONENT',
    actionStep: 'DRAW_ONE',
    noOpSteps: {
      sourceMissing: 'SOURCE_NOT_ON_STAGE',
      conditionNotMet: 'REVEALED_CHEER_COUNT_NOT_LOWER',
    },
  },
];

type EvaluatedCondition =
  | {
      readonly conditionType: 'HIGHER_LIVE_SCORE';
      readonly ownScore: number;
      readonly opponentScore: number;
      readonly scoreHigherThanOpponent: boolean;
      readonly conditionMet: boolean;
    }
  | {
      readonly conditionType: 'OWN_REVEALED_CHEER_COUNT_LESS_THAN_OPPONENT';
      readonly ownRevealedCheerCardIds: readonly string[];
      readonly opponentRevealedCheerCardIds: readonly string[];
      readonly ownRevealedCheerCount: number;
      readonly opponentRevealedCheerCount: number;
      readonly conditionMet: boolean;
    };

interface LiveSuccessConditionalDrawContext {
  readonly sourceSlot: ReturnType<typeof getSourceMemberSlot>;
  readonly sourceOnStage: boolean;
  readonly sourceCardMatchesExpectedBase: boolean;
  readonly condition: EvaluatedCondition;
}

export function registerLiveSuccessConditionalDrawOneWorkflowHandlers(): void {
  for (const config of LIVE_SUCCESS_CONDITIONAL_DRAW_CONFIGS) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, context) =>
        resolveLiveSuccessConditionalDrawOne(
          game,
          ability,
          config,
          options,
          context.continuePendingCardEffects
        ),
      (game, ability) => {
        const config = LIVE_SUCCESS_CONDITIONAL_DRAW_CONFIGS.find(
          (candidate) => candidate.abilityId === ability.abilityId
        );
        if (!config) {
          return {};
        }
        return getConfirmationConfig(game, ability, config);
      }
    );
  }
}

function resolveLiveSuccessConditionalDrawOne(
  game: GameState,
  ability: PendingAbilityState,
  config: LiveSuccessConditionalDrawConfig,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getLiveSuccessConditionalDrawContext(game, ability, config);
  const canDraw =
    context.sourceOnStage &&
    context.sourceCardMatchesExpectedBase &&
    context.condition.conditionMet;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  let state = stateWithoutPending;
  let drawnCardIds: readonly string[] = [];

  if (canDraw) {
    const drawResult = drawCardsForPlayer(state, player.id, 1);
    if (!drawResult) {
      return game;
    }
    state = drawResult.gameState;
    drawnCardIds = drawResult.drawnCardIds;
  }

  const actionPayload = createActionPayload(
    ability,
    config,
    context,
    canDraw,
    drawnCardIds
  );
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, actionPayload),
    options.orderedResolution === true
  );
}

function getLiveSuccessConditionalDrawContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>,
  config: LiveSuccessConditionalDrawConfig
): LiveSuccessConditionalDrawContext {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  const sourceCard = getCardById(game, ability.sourceCardId);
  const sourceCardMatchesExpectedBase =
    sourceCard !== null &&
    config.expectedBaseCardCodes.some((baseCardCode) =>
      cardCodeMatchesBase(sourceCard.data.cardCode, baseCardCode)
    );

  return {
    sourceSlot,
    sourceOnStage: sourceSlot !== null,
    sourceCardMatchesExpectedBase,
    condition: evaluateCondition(game, ability.controllerId, config.conditionType),
  };
}

function evaluateCondition(
  game: GameState,
  playerId: string,
  conditionType: LiveSuccessConditionalDrawConfig['conditionType']
): EvaluatedCondition {
  if (conditionType === 'HIGHER_LIVE_SCORE') {
    const player = getPlayerById(game, playerId);
    const opponent = player ? getOpponent(game, player.id) : null;
    const ownScore = game.liveResolution.playerScores.get(playerId) ?? 0;
    const opponentScore = opponent
      ? game.liveResolution.playerScores.get(opponent.id) ?? 0
      : 0;
    const scoreHigherThanOpponent = ownScore > opponentScore;
    return {
      conditionType,
      ownScore,
      opponentScore,
      scoreHigherThanOpponent,
      conditionMet: scoreHigherThanOpponent,
    };
  }

  const player = getPlayerById(game, playerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const ownRevealedCheerCardIds = player
    ? selectCurrentLiveRevealedCheerCardIds(game, player.id)
    : [];
  const opponentRevealedCheerCardIds = opponent
    ? selectCurrentLiveRevealedCheerCardIds(game, opponent.id)
    : [];
  const ownRevealedCheerCount = ownRevealedCheerCardIds.length;
  const opponentRevealedCheerCount = opponentRevealedCheerCardIds.length;
  return {
    conditionType,
    ownRevealedCheerCardIds,
    opponentRevealedCheerCardIds,
    ownRevealedCheerCount,
    opponentRevealedCheerCount,
    conditionMet: ownRevealedCheerCount < opponentRevealedCheerCount,
  };
}

function getConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState,
  config: LiveSuccessConditionalDrawConfig
): { readonly effectText: string; readonly stepText: string } {
  const context = getLiveSuccessConditionalDrawContext(game, ability, config);
  if (context.condition.conditionType === 'HIGHER_LIVE_SCORE') {
    const actualDrawCount =
      context.sourceOnStage &&
      context.sourceCardMatchesExpectedBase &&
      context.condition.conditionMet
        ? getActualDrawCount(game, ability.controllerId)
        : 0;
    const previewText = getHigherScorePreviewText(context.condition, actualDrawCount);
    return {
      effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
      stepText: previewText,
    };
  }

  const { ownRevealedCheerCount, opponentRevealedCheerCount, conditionMet } =
    context.condition;
  const actualDrawCount = context.sourceOnStage && context.sourceCardMatchesExpectedBase && conditionMet
    ? getActualDrawCount(game, ability.controllerId)
    : 0;
  const previewText = `本次自己因声援公开${ownRevealedCheerCount}张，对方${opponentRevealedCheerCount}张，${conditionMet ? '满足条件' : '未满足条件'}，实际抽${actualDrawCount}张卡。`;
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
    stepText: '确认后按当前声援公开张数结算此效果。',
  };
}

function getHigherScorePreviewText(
  condition: Extract<EvaluatedCondition, { conditionType: 'HIGHER_LIVE_SCORE' }>,
  actualDrawCount: number
): string {
  return `当前LIVE合计分数为${condition.ownScore}对${condition.opponentScore}，${condition.conditionMet ? '满足条件' : '未满足条件'}，实际抽${actualDrawCount}张卡。`;
}

function getActualDrawCount(game: GameState, playerId: string): number {
  return drawCardsForPlayer(game, playerId, 1)?.drawnCardIds.length ?? 0;
}

function createActionPayload(
  ability: PendingAbilityState,
  config: LiveSuccessConditionalDrawConfig,
  context: LiveSuccessConditionalDrawContext,
  canDraw: boolean,
  drawnCardIds: readonly string[]
): Readonly<Record<string, unknown>> {
  if (context.condition.conditionType === 'HIGHER_LIVE_SCORE') {
    if (config.conditionType !== 'HIGHER_LIVE_SCORE') {
      throw new Error(`Mismatched conditional draw config: ${config.abilityId}`);
    }
    const noOpStep = !context.sourceOnStage
      ? config.noOpSteps.sourceMissing
      : config.noOpSteps.conditionNotMet;
    return {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: context.sourceSlot,
      step: canDraw ? config.actionStep : noOpStep,
      sourceOnStage: context.sourceOnStage,
      ownScore: context.condition.ownScore,
      opponentScore: context.condition.opponentScore,
      scoreHigherThanOpponent: context.condition.scoreHigherThanOpponent,
      drawnCardIds,
    };
  }

  if (config.conditionType !== 'OWN_REVEALED_CHEER_COUNT_LESS_THAN_OPPONENT') {
    throw new Error(`Mismatched conditional draw config: ${config.abilityId}`);
  }
  const noOpStep = !context.sourceOnStage
    ? config.noOpSteps.sourceMissing
    : config.noOpSteps.conditionNotMet;
  return {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    sourceSlot: context.sourceSlot,
    step: canDraw ? config.actionStep : noOpStep,
    ownRevealedCheerCardIds: context.condition.ownRevealedCheerCardIds,
    opponentRevealedCheerCardIds: context.condition.opponentRevealedCheerCardIds,
    ownRevealedCheerCount: context.condition.ownRevealedCheerCount,
    opponentRevealedCheerCount: context.condition.opponentRevealedCheerCount,
    conditionMet: context.condition.conditionMet,
    drawnCardIds,
  };
}
