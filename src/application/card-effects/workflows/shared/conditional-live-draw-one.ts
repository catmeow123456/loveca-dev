import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { sumStageMemberEffectiveCostMatching } from '../../../effects/conditions.js';
import {
  getRemainingHeartCount,
  rebalanceRemainingHeartColorForPlayer,
} from '../../../effects/remaining-hearts.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import {
  PL_BP4_001_LIVE_START_LOWER_STAGE_COST_DRAW_ONE_ABILITY_ID,
  PL_BP4_023_LIVE_SUCCESS_PINK_REMAINING_HEART_DRAW_ONE_ABILITY_ID,
  PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID,
  S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID,
} from '../../ability-ids.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type ConditionalLiveDrawConfig =
  | {
      readonly abilityId: typeof PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID;
      readonly expectedBaseCardCodes: readonly ['PL!N-bp4-003'];
      readonly sourceKind: 'STAGE_MEMBER';
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
      readonly sourceKind: 'STAGE_MEMBER';
      readonly conditionType: 'OWN_REVEALED_CHEER_COUNT_LESS_THAN_OPPONENT';
      readonly actionStep: 'DRAW_ONE';
      readonly noOpSteps: {
        readonly sourceMissing: 'SOURCE_NOT_ON_STAGE';
        readonly conditionNotMet: 'REVEALED_CHEER_COUNT_NOT_LOWER';
      };
    }
  | {
      readonly abilityId: typeof PL_BP4_001_LIVE_START_LOWER_STAGE_COST_DRAW_ONE_ABILITY_ID;
      readonly expectedBaseCardCodes: readonly ['PL!-bp4-001'];
      readonly sourceKind: 'STAGE_MEMBER';
      readonly conditionType: 'OWN_STAGE_EFFECTIVE_COST_LESS_THAN_OPPONENT';
      readonly actionStep: 'DRAW_ONE';
      readonly noOpSteps: {
        readonly sourceMissing: 'SOURCE_NOT_ON_STAGE';
        readonly conditionNotMet: 'STAGE_EFFECTIVE_COST_NOT_LOWER';
      };
    }
  | {
      readonly abilityId: typeof PL_BP4_023_LIVE_SUCCESS_PINK_REMAINING_HEART_DRAW_ONE_ABILITY_ID;
      readonly expectedBaseCardCodes: readonly ['PL!-bp4-023'];
      readonly sourceKind: 'LIVE_CARD';
      readonly conditionType: 'PINK_REMAINING_HEART_AT_LEAST_ONE';
      readonly actionStep: 'DRAW_ONE';
      readonly noOpSteps: {
        readonly sourceMissing: 'SOURCE_NOT_IN_LIVE_ZONE';
        readonly conditionNotMet: 'PINK_REMAINING_HEART_NOT_FOUND';
      };
    };

const CONDITIONAL_LIVE_DRAW_CONFIGS: readonly ConditionalLiveDrawConfig[] = [
  {
    abilityId: PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID,
    expectedBaseCardCodes: ['PL!N-bp4-003'],
    sourceKind: 'STAGE_MEMBER',
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
    sourceKind: 'STAGE_MEMBER',
    conditionType: 'OWN_REVEALED_CHEER_COUNT_LESS_THAN_OPPONENT',
    actionStep: 'DRAW_ONE',
    noOpSteps: {
      sourceMissing: 'SOURCE_NOT_ON_STAGE',
      conditionNotMet: 'REVEALED_CHEER_COUNT_NOT_LOWER',
    },
  },
  {
    abilityId: PL_BP4_001_LIVE_START_LOWER_STAGE_COST_DRAW_ONE_ABILITY_ID,
    expectedBaseCardCodes: ['PL!-bp4-001'],
    sourceKind: 'STAGE_MEMBER',
    conditionType: 'OWN_STAGE_EFFECTIVE_COST_LESS_THAN_OPPONENT',
    actionStep: 'DRAW_ONE',
    noOpSteps: {
      sourceMissing: 'SOURCE_NOT_ON_STAGE',
      conditionNotMet: 'STAGE_EFFECTIVE_COST_NOT_LOWER',
    },
  },
  {
    abilityId: PL_BP4_023_LIVE_SUCCESS_PINK_REMAINING_HEART_DRAW_ONE_ABILITY_ID,
    expectedBaseCardCodes: ['PL!-bp4-023'],
    sourceKind: 'LIVE_CARD',
    conditionType: 'PINK_REMAINING_HEART_AT_LEAST_ONE',
    actionStep: 'DRAW_ONE',
    noOpSteps: {
      sourceMissing: 'SOURCE_NOT_IN_LIVE_ZONE',
      conditionNotMet: 'PINK_REMAINING_HEART_NOT_FOUND',
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
    }
  | {
      readonly conditionType: 'OWN_STAGE_EFFECTIVE_COST_LESS_THAN_OPPONENT';
      readonly ownStageEffectiveCostTotal: number;
      readonly opponentStageEffectiveCostTotal: number;
      readonly conditionMet: boolean;
    }
  | {
      readonly conditionType: 'PINK_REMAINING_HEART_AT_LEAST_ONE';
      readonly stateAfterRebalance: GameState;
      readonly remainingPinkHeartCount: number;
      readonly rebalancedRemainingHeartCount: number;
      readonly remainingPinkHeartCountBeforeRebalance: number;
      readonly remainingRainbowHeartCountBeforeRebalance: number;
      readonly conditionMet: boolean;
    };

interface ConditionalLiveDrawContext {
  readonly sourceSlot: ReturnType<typeof getSourceMemberSlot>;
  readonly sourceOnStage: boolean;
  readonly sourceInLiveZone: boolean;
  readonly sourceValid: boolean;
  readonly sourceCardMatchesExpectedBase: boolean;
  readonly condition: EvaluatedCondition;
}

export function registerConditionalLiveDrawOneWorkflowHandlers(): void {
  for (const config of CONDITIONAL_LIVE_DRAW_CONFIGS) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, context) =>
        resolveConditionalLiveDrawOne(
          game,
          ability,
          config,
          options,
          context.continuePendingCardEffects
        ),
      (game, ability) => {
        const config = CONDITIONAL_LIVE_DRAW_CONFIGS.find(
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

function resolveConditionalLiveDrawOne(
  game: GameState,
  ability: PendingAbilityState,
  config: ConditionalLiveDrawConfig,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getConditionalLiveDrawContext(game, ability, config);
  const canDraw =
    context.sourceValid &&
    context.sourceCardMatchesExpectedBase &&
    context.condition.conditionMet;
  const resolutionBaseState =
    context.sourceValid &&
    context.sourceCardMatchesExpectedBase &&
    context.condition.conditionType === 'PINK_REMAINING_HEART_AT_LEAST_ONE'
      ? context.condition.stateAfterRebalance
      : game;
  const stateWithoutPending: GameState = {
    ...resolutionBaseState,
    pendingAbilities: resolutionBaseState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
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

function getConditionalLiveDrawContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>,
  config: ConditionalLiveDrawConfig
): ConditionalLiveDrawContext {
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

  const sourceOnStage = sourceSlot !== null;
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;

  return {
    sourceSlot,
    sourceOnStage,
    sourceInLiveZone,
    sourceValid: config.sourceKind === 'STAGE_MEMBER' ? sourceOnStage : sourceInLiveZone,
    sourceCardMatchesExpectedBase,
    condition: evaluateCondition(game, ability.controllerId, config.conditionType),
  };
}

function evaluateCondition(
  game: GameState,
  playerId: string,
  conditionType: ConditionalLiveDrawConfig['conditionType']
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

  if (conditionType === 'OWN_STAGE_EFFECTIVE_COST_LESS_THAN_OPPONENT') {
    const player = getPlayerById(game, playerId);
    const opponent = player ? getOpponent(game, player.id) : null;
    const ownStageEffectiveCostTotal = player
      ? sumStageMemberEffectiveCostMatching(game, player.id)
      : 0;
    const opponentStageEffectiveCostTotal = opponent
      ? sumStageMemberEffectiveCostMatching(game, opponent.id)
      : 0;
    return {
      conditionType,
      ownStageEffectiveCostTotal,
      opponentStageEffectiveCostTotal,
      conditionMet: ownStageEffectiveCostTotal < opponentStageEffectiveCostTotal,
    };
  }

  if (conditionType === 'PINK_REMAINING_HEART_AT_LEAST_ONE') {
    const rebalanceResult = rebalanceRemainingHeartColorForPlayer(
      game,
      playerId,
      HeartColor.PINK,
      1
    );
    const remainingPinkHeartCount = getRemainingHeartCount(
      rebalanceResult.gameState,
      playerId,
      HeartColor.PINK
    );
    return {
      conditionType,
      stateAfterRebalance: rebalanceResult.gameState,
      remainingPinkHeartCount,
      rebalancedRemainingHeartCount: rebalanceResult.rebalancedCount,
      remainingPinkHeartCountBeforeRebalance: rebalanceResult.remainingColorCountBefore,
      remainingRainbowHeartCountBeforeRebalance: rebalanceResult.remainingRainbowCountBefore,
      conditionMet: remainingPinkHeartCount >= 1,
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
  config: ConditionalLiveDrawConfig
): { readonly effectText: string; readonly stepText: string } {
  const context = getConditionalLiveDrawContext(game, ability, config);
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

  if (context.condition.conditionType === 'OWN_STAGE_EFFECTIVE_COST_LESS_THAN_OPPONENT') {
    const actualDrawCount =
      context.sourceValid &&
      context.sourceCardMatchesExpectedBase &&
      context.condition.conditionMet
        ? getActualDrawCount(game, ability.controllerId)
        : 0;
    const previewText = `当前双方舞台成员的有效费用合计为${context.condition.ownStageEffectiveCostTotal}对${context.condition.opponentStageEffectiveCostTotal}，${context.condition.conditionMet ? '满足条件' : '未满足条件'}，实际抽${actualDrawCount}张卡。`;
    return {
      effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
      stepText: '确认后按双方当前舞台成员的有效费用合计结算此效果。',
    };
  }

  if (context.condition.conditionType === 'PINK_REMAINING_HEART_AT_LEAST_ONE') {
    const actualDrawCount =
      context.sourceValid &&
      context.sourceCardMatchesExpectedBase &&
      context.condition.conditionMet
        ? getActualDrawCount(game, ability.controllerId)
        : 0;
    const previewText = `当前持有${context.condition.conditionMet ? '至少1个' : '0个'}粉色剩余HEART，抽${actualDrawCount}张卡。`;
    return {
      effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
      stepText: '确认后结算此效果。',
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
  config: ConditionalLiveDrawConfig,
  context: ConditionalLiveDrawContext,
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


  if (context.condition.conditionType === 'OWN_STAGE_EFFECTIVE_COST_LESS_THAN_OPPONENT') {
    if (config.conditionType !== 'OWN_STAGE_EFFECTIVE_COST_LESS_THAN_OPPONENT') {
      throw new Error(`Mismatched conditional draw config: ${config.abilityId}`);
    }
    return {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: context.sourceSlot,
      step: canDraw
        ? config.actionStep
        : context.sourceOnStage
          ? config.noOpSteps.conditionNotMet
          : config.noOpSteps.sourceMissing,
      ownStageEffectiveCostTotal: context.condition.ownStageEffectiveCostTotal,
      opponentStageEffectiveCostTotal: context.condition.opponentStageEffectiveCostTotal,
      conditionMet: context.condition.conditionMet,
      drawnCardIds,
    };
  }

  if (context.condition.conditionType === 'PINK_REMAINING_HEART_AT_LEAST_ONE') {
    if (config.conditionType !== 'PINK_REMAINING_HEART_AT_LEAST_ONE') {
      throw new Error(`Mismatched conditional draw config: ${config.abilityId}`);
    }
    return {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: canDraw
        ? config.actionStep
        : context.sourceInLiveZone
          ? config.noOpSteps.conditionNotMet
          : config.noOpSteps.sourceMissing,
      sourceInLiveZone: context.sourceInLiveZone,
      remainingPinkHeartCount: context.condition.remainingPinkHeartCount,
      rebalancedRemainingHeartCount: context.condition.rebalancedRemainingHeartCount,
      remainingPinkHeartCountBeforeRebalance:
        context.condition.remainingPinkHeartCountBeforeRebalance,
      remainingRainbowHeartCountBeforeRebalance:
        context.condition.remainingRainbowHeartCountBeforeRebalance,
      conditionMet: context.condition.conditionMet,
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
