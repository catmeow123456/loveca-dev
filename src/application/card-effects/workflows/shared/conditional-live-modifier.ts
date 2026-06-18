import { CardType, HeartColor, ZoneType } from '../../../../shared/types/enums.js';
import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addLiveModifier,
  replaceLiveModifier,
} from '../../../../domain/rules/live-modifiers.js';
import {
  and,
  groupAliasIs,
  groupIs,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import {
  countCardsMatchingSelector,
  countOtherLiveZoneCardsMatching,
  countSuccessfulLiveCards,
  getCardIdsInZone,
  hasAtLeastCardsMatchingSelector,
  successLiveScoreAtLeast,
  sumSuccessfulLiveScore,
} from '../../../effects/conditions.js';
import {
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
  BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
  HS_BP2_022_LIVE_START_SCORE_ABILITY_ID,
  HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
  NICO_LIVE_START_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { startConfirmOnlyActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const NICO_SCORE_BONUS_STEP_ID = 'NICO_SCORE_BONUS';
const BOKUIMA_REQUIREMENT_REDUCTION_STEP_ID = 'BOKUIMA_REQUIREMENT_REDUCTION';
const HS_BP5_019_REQUIREMENT_REDUCTION_STEP_ID = 'HS_BP5_019_REQUIREMENT_REDUCTION';
const HS_BP2_022_SCORE_BONUS_STEP_ID = 'HS_BP2_022_SCORE_BONUS';
const BP4_021_SUCCESS_SCORE_MODIFIER_STEP_ID = 'BP4_021_SUCCESS_SCORE_MODIFIER';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface ConditionalLiveModifierStartContext {
  readonly effectText: string;
  readonly actionPayload: Readonly<Record<string, unknown>>;
}

interface ConditionalLiveModifierFinishContext {
  readonly gameState: GameState;
  readonly actionPayload: Readonly<Record<string, unknown>>;
}

interface ConditionalLiveModifierWorkflowConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly getStartContext: (
    game: GameState,
    ability: PendingAbilityState,
    playerId: string
  ) => ConditionalLiveModifierStartContext;
  readonly finish: (
    game: GameState,
    effect: ActiveEffectState,
    playerId: string
  ) => ConditionalLiveModifierFinishContext;
}

const CONDITIONAL_LIVE_MODIFIER_WORKFLOWS: readonly ConditionalLiveModifierWorkflowConfig[] = [
  {
    abilityId: NICO_LIVE_START_SCORE_ABILITY_ID,
    stepId: NICO_SCORE_BONUS_STEP_ID,
    getStartContext: getNicoStartContext,
    finish: finishNicoLiveStartScoreBonus,
  },
  {
    abilityId: BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
    stepId: BOKUIMA_REQUIREMENT_REDUCTION_STEP_ID,
    getStartContext: (game, _ability, playerId) => {
      const successLiveCount = countSuccessfulLiveCards(game, playerId);
      const reduction = successLiveCount * 2;
      return {
        effectText: `${getAbilityEffectText(BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID)}（当前成功LIVE ${successLiveCount}张，减少${reduction}个無Heart）`,
        actionPayload: {
          successLiveCount,
          requirementReduction: reduction,
        },
      };
    },
    finish: finishBokuimaLiveStartRequirementReduction,
  },
  {
    abilityId: HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
    stepId: HS_BP5_019_REQUIREMENT_REDUCTION_STEP_ID,
    getStartContext: (game, ability, playerId) => {
      const otherHasunosoraLiveZoneCount = countOtherLiveZoneCardsMatching(
        game,
        playerId,
        ability.sourceCardId,
        groupAliasIs('蓮ノ空')
      );
      const reduction = otherHasunosoraLiveZoneCount * 2;
      return {
        effectText: `${getAbilityEffectText(HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID)}（当前此卡以外莲之空卡 ${otherHasunosoraLiveZoneCount}张，减少${reduction}个绿Heart）`,
        actionPayload: {
          otherHasunosoraLiveZoneCount,
          requirementReduction: reduction,
        },
      };
    },
    finish: finishHsBp5HanamusubiLiveStartRequirementReduction,
  },
  {
    abilityId: HS_BP2_022_LIVE_START_SCORE_ABILITY_ID,
    stepId: HS_BP2_022_SCORE_BONUS_STEP_ID,
    getStartContext: (game, _ability, playerId) => {
      const ceriseBouquetLiveCount = countCeriseBouquetLiveInWaitingRoom(game, playerId);
      const isConditionMet = ceriseBouquetLiveCount >= 3;
      return {
        effectText: `${getAbilityEffectText(HS_BP2_022_LIVE_START_SCORE_ABILITY_ID)}（当前${ceriseBouquetLiveCount}张，${
          isConditionMet ? '满足条件' : '未满足条件'
        }）`,
        actionPayload: {
          ceriseBouquetLiveCount,
          scoreBonus: isConditionMet ? 1 : 0,
        },
      };
    },
    finish: finishHsBp2AokuharukaLiveStartScoreBonus,
  },
  {
    abilityId: BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
    stepId: BP4_021_SUCCESS_SCORE_MODIFIER_STEP_ID,
    getStartContext: (game, _ability, playerId) => {
      const successLiveScore = sumSuccessfulLiveScore(game, playerId);
      const reducesRequirement = successLiveScoreAtLeast(game, playerId, 6);
      const gainsScore = successLiveScoreAtLeast(game, playerId, 9);
      return {
        effectText: `${getAbilityEffectText(
          BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID
        )}（当前成功LIVE分数合计 ${successLiveScore}，${
          reducesRequirement ? '减少必要無Heart' : '未减少必要Heart'
        }，${gainsScore ? '分数+1' : '未获得分数+1'}）`,
        actionPayload: {
          successLiveScore,
          requirementReduction: reducesRequirement ? 1 : 0,
          scoreBonus: gainsScore ? 1 : 0,
        },
      };
    },
    finish: finishBp4021HeartbeatLiveStartSuccessScoreModifier,
  },
];

export function registerConditionalLiveModifierWorkflowHandlers(): void {
  for (const config of CONDITIONAL_LIVE_MODIFIER_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startConditionalLiveModifierWorkflow(
        game,
        ability,
        config,
        options.orderedResolution === true
      )
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, _input, context) =>
      finishConditionalLiveModifierWorkflow(game, config, context.continuePendingCardEffects)
    );
  }
}

function startConditionalLiveModifierWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  config: ConditionalLiveModifierWorkflowConfig,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const startContext = config.getStartContext(game, ability, player.id);
  return startConfirmOnlyActiveEffect(game, {
    ability,
    playerId: player.id,
    effectText: startContext.effectText,
    stepId: config.stepId,
    stepText: startContext.effectText,
    orderedResolution,
    actionPayload: startContext.actionPayload,
  });
}

function finishConditionalLiveModifierWorkflow(
  game: GameState,
  config: ConditionalLiveModifierWorkflowConfig,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.stepId) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const finishContext = config.finish(game, effect, player.id);
  return continuePendingCardEffects(
    addAction(finishContext.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...finishContext.actionPayload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishNicoLiveStartScoreBonus(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const waitingRoomCardIds = getCardIdsInZone(game, playerId, ZoneType.WAITING_ROOM);
  const museWaitingRoomCount = countCardsMatchingSelector(game, waitingRoomCardIds, groupIs("μ's"));
  const isConditionMet = hasAtLeastCardsMatchingSelector(
    game,
    waitingRoomCardIds,
    groupIs("μ's"),
    25
  );
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  if (isConditionMet) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId,
      countDelta: 1,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
  }

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_SCORE_BONUS',
      effectText: getAbilityEffectText(NICO_LIVE_START_SCORE_ABILITY_ID),
      conditionMet: isConditionMet,
      museWaitingRoomCount,
      scoreBonus: isConditionMet ? 1 : 0,
    },
  };
}

function getNicoStartContext(game: GameState, _ability: PendingAbilityState, playerId: string) {
  const museWaitingRoomCount = countCardsMatchingSelector(
    game,
    getCardIdsInZone(game, playerId, ZoneType.WAITING_ROOM),
    groupIs("μ's")
  );
  return {
    effectText: `${getAbilityEffectText(
      NICO_LIVE_START_SCORE_ABILITY_ID
    )}（当前${museWaitingRoomCount}张）`,
    actionPayload: {},
  };
}

function finishBokuimaLiveStartRequirementReduction(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const successLiveCount = countSuccessfulLiveCards(game, playerId);
  const reduction = successLiveCount * 2;
  const state = replaceSourceRequirementModifier(
    {
      ...game,
      activeEffect: null,
    },
    effect,
    reduction > 0
      ? {
          kind: 'REQUIREMENT',
          liveCardId: effect.sourceCardId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -reduction }],
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_REQUIREMENT_REDUCTION',
      successLiveCount,
      requirementReduction: reduction,
    },
  };
}

function finishHsBp5HanamusubiLiveStartRequirementReduction(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const otherHasunosoraLiveZoneCount = countOtherLiveZoneCardsMatching(
    game,
    playerId,
    effect.sourceCardId,
    groupAliasIs('蓮ノ空')
  );
  const reduction = otherHasunosoraLiveZoneCount * 2;
  const state = replaceSourceRequirementModifier(
    {
      ...game,
      activeEffect: null,
    },
    effect,
    reduction > 0
      ? {
          kind: 'REQUIREMENT',
          liveCardId: effect.sourceCardId,
          modifiers: [{ color: HeartColor.GREEN, countDelta: -reduction }],
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_REQUIREMENT_REDUCTION',
      otherHasunosoraLiveZoneCount,
      requirementReduction: reduction,
    },
  };
}

function finishHsBp2AokuharukaLiveStartScoreBonus(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const ceriseBouquetLiveCount = countCeriseBouquetLiveInWaitingRoom(game, playerId);
  const isConditionMet = ceriseBouquetLiveCount >= 3;
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  if (isConditionMet) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId,
      countDelta: 1,
      liveCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
  }

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_SCORE_BONUS',
      effectText: getAbilityEffectText(HS_BP2_022_LIVE_START_SCORE_ABILITY_ID),
      conditionMet: isConditionMet,
      ceriseBouquetLiveCount,
      scoreBonus: isConditionMet ? 1 : 0,
    },
  };
}

function finishBp4021HeartbeatLiveStartSuccessScoreModifier(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const successLiveScore = sumSuccessfulLiveScore(game, playerId);
  const reducesRequirement = successLiveScoreAtLeast(game, playerId, 6);
  const gainsScore = successLiveScoreAtLeast(game, playerId, 9);
  let state: GameState = {
    ...game,
    activeEffect: null,
  };

  state = replaceSourceRequirementModifier(
    state,
    effect,
    reducesRequirement
      ? {
          kind: 'REQUIREMENT',
          liveCardId: effect.sourceCardId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );

  state = replaceLiveModifier(
    state,
    {
      kind: 'SCORE',
      liveCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    },
    gainsScore
      ? {
          kind: 'SCORE',
          playerId,
          countDelta: 1,
          liveCardId: effect.sourceCardId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_SUCCESS_SCORE_MODIFIERS',
      successLiveScore,
      requirementReduction: reducesRequirement ? 1 : 0,
      scoreBonus: gainsScore ? 1 : 0,
    },
  };
}

function countCeriseBouquetLiveInWaitingRoom(game: GameState, playerId: string): number {
  return countCardsMatchingSelector(
    game,
    getCardIdsInZone(game, playerId, ZoneType.WAITING_ROOM),
    and(typeIs(CardType.LIVE), unitAliasIs('Cerise Bouquet'))
  );
}

function replaceSourceRequirementModifier(
  game: GameState,
  effect: ActiveEffectState,
  replacement: LiveModifierState | null
): GameState {
  return replaceLiveModifier(
    game,
    {
      kind: 'REQUIREMENT',
      liveCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    },
    replacement
  );
}
