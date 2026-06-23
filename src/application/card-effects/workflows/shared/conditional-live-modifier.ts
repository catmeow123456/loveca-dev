import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  ZoneType,
} from '../../../../shared/types/enums.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameAction,
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
  cardNameAliasIs,
  groupAliasIs,
  groupIs,
  typeIs,
  type CardSelector,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import {
  countCardsMatchingSelector,
  countOtherLiveZoneCardsMatching,
  countSuccessfulLiveCards,
  getCardIdsInZone,
  getMemberEffectiveCost,
  hasAtLeastCardsMatchingSelector,
  successLiveScoreAtLeast,
  sumSuccessfulLiveScore,
} from '../../../effects/conditions.js';
import { getRelayEnteredStageMemberCardIdsThisTurn } from '../../../effects/relay-entered-members.js';
import {
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
  BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
  HS_BP2_021_LIVE_START_RELAY_ENTERED_HASUNOSORA_GREEN_REQUIREMENT_ABILITY_ID,
  HS_BP2_023_LIVE_START_RELAY_ENTERED_HASUNOSORA_BLUE_REQUIREMENT_ABILITY_ID,
  HS_BP2_025_LIVE_START_RELAY_ENTERED_HASUNOSORA_PINK_REQUIREMENT_ABILITY_ID,
  HS_BP2_024_LIVE_START_KOSUZU_SAYAKA_REQUIREMENT_ABILITY_ID,
  HS_BP2_022_LIVE_START_SCORE_ABILITY_ID,
  HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
  HS_BP5_020_LIVE_START_HIGH_COST_HASUNOSORA_SCORE_ABILITY_ID,
  NICO_LIVE_START_SCORE_ABILITY_ID,
  PL_N_PB1_037_LIVE_START_NIJIGASAKI_ACTIVATED_ENERGY_MEMBER_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { startConfirmOnlyActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const NICO_SCORE_BONUS_STEP_ID = 'NICO_SCORE_BONUS';
const BOKUIMA_REQUIREMENT_REDUCTION_STEP_ID = 'BOKUIMA_REQUIREMENT_REDUCTION';
const HS_BP5_019_REQUIREMENT_REDUCTION_STEP_ID = 'HS_BP5_019_REQUIREMENT_REDUCTION';
const HS_BP2_021_RELAY_ENTERED_REQUIREMENT_REDUCTION_STEP_ID =
  'HS_BP2_021_RELAY_ENTERED_REQUIREMENT_REDUCTION';
const HS_BP2_022_SCORE_BONUS_STEP_ID = 'HS_BP2_022_SCORE_BONUS';
const HS_BP2_023_RELAY_ENTERED_REQUIREMENT_REDUCTION_STEP_ID =
  'HS_BP2_023_RELAY_ENTERED_REQUIREMENT_REDUCTION';
const HS_BP5_020_SCORE_BONUS_STEP_ID = 'HS_BP5_020_SCORE_BONUS';
const PL_N_PB1_037_SCORE_BONUS_STEP_ID = 'PL_N_PB1_037_SCORE_BONUS';
const HS_BP2_024_REQUIREMENT_REDUCTION_STEP_ID = 'HS_BP2_024_REQUIREMENT_REDUCTION';
const HS_BP2_025_RELAY_ENTERED_REQUIREMENT_REDUCTION_STEP_ID =
  'HS_BP2_025_RELAY_ENTERED_REQUIREMENT_REDUCTION';
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

interface RelayEnteredHasunosoraRequirementReductionConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly color: HeartColor;
  readonly colorLabel: string;
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
  createRelayEnteredHasunosoraRequirementReductionWorkflow({
    abilityId: HS_BP2_021_LIVE_START_RELAY_ENTERED_HASUNOSORA_GREEN_REQUIREMENT_ABILITY_ID,
    stepId: HS_BP2_021_RELAY_ENTERED_REQUIREMENT_REDUCTION_STEP_ID,
    color: HeartColor.GREEN,
    colorLabel: '绿Heart',
  }),
  createRelayEnteredHasunosoraRequirementReductionWorkflow({
    abilityId: HS_BP2_023_LIVE_START_RELAY_ENTERED_HASUNOSORA_BLUE_REQUIREMENT_ABILITY_ID,
    stepId: HS_BP2_023_RELAY_ENTERED_REQUIREMENT_REDUCTION_STEP_ID,
    color: HeartColor.BLUE,
    colorLabel: '蓝Heart',
  }),
  createRelayEnteredHasunosoraRequirementReductionWorkflow({
    abilityId: HS_BP2_025_LIVE_START_RELAY_ENTERED_HASUNOSORA_PINK_REQUIREMENT_ABILITY_ID,
    stepId: HS_BP2_025_RELAY_ENTERED_REQUIREMENT_REDUCTION_STEP_ID,
    color: HeartColor.PINK,
    colorLabel: '桃Heart',
  }),
  {
    abilityId: HS_BP5_020_LIVE_START_HIGH_COST_HASUNOSORA_SCORE_ABILITY_ID,
    stepId: HS_BP5_020_SCORE_BONUS_STEP_ID,
    getStartContext: (game, _ability, playerId) => {
      const highCostHasunosoraMemberCount = countHighCostHasunosoraStageMembers(game, playerId);
      const isConditionMet = highCostHasunosoraMemberCount >= 2;
      return {
        effectText: `${getAbilityEffectText(
          HS_BP5_020_LIVE_START_HIGH_COST_HASUNOSORA_SCORE_ABILITY_ID
        )}（当前${highCostHasunosoraMemberCount}名，${
          isConditionMet ? '满足条件' : '未满足条件'
        }）`,
        actionPayload: {
          highCostHasunosoraMemberCount,
          scoreBonus: isConditionMet ? 1 : 0,
        },
      };
    },
    finish: finishHsBp5BardCageLiveStartScoreBonus,
  },
  {
    abilityId: PL_N_PB1_037_LIVE_START_NIJIGASAKI_ACTIVATED_ENERGY_MEMBER_SCORE_ABILITY_ID,
    stepId: PL_N_PB1_037_SCORE_BONUS_STEP_ID,
    getStartContext: (game, _ability, playerId) => {
      const history = getNijigasakiActivationHistoryThisTurn(game, playerId);
      return {
        effectText: `${getAbilityEffectText(
          PL_N_PB1_037_LIVE_START_NIJIGASAKI_ACTIVATED_ENERGY_MEMBER_SCORE_ABILITY_ID
        )}（能量${history.activatedEnergy ? '已满足' : '未满足'}，成员${
          history.activatedMember ? '已满足' : '未满足'
        }，分数+${history.scoreBonus}）`,
        actionPayload: {
          activatedEnergyByNijigasakiEffect: history.activatedEnergy,
          activatedMemberByNijigasakiEffect: history.activatedMember,
          scoreBonus: history.scoreBonus,
        },
      };
    },
    finish: finishPlNPb1037CaraTesoroScoreBonus,
  },
  {
    abilityId: HS_BP2_024_LIVE_START_KOSUZU_SAYAKA_REQUIREMENT_ABILITY_ID,
    stepId: HS_BP2_024_REQUIREMENT_REDUCTION_STEP_ID,
    getStartContext: (game, _ability, playerId) => {
      const condition = getKosuzuSayakaHigherCostCondition(game, playerId);
      return {
        effectText: `${getAbilityEffectText(
          HS_BP2_024_LIVE_START_KOSUZU_SAYAKA_REQUIREMENT_ABILITY_ID
        )}（${condition.conditionMet ? '满足条件' : '未满足条件'}）`,
        actionPayload: {
          kosuzuMemberIds: condition.kosuzuMemberIds,
          sayakaMemberIds: condition.sayakaMemberIds,
          requirementReduction: condition.conditionMet ? 3 : 0,
        },
      };
    },
    finish: finishHsBp2LadybugLiveStartRequirementReduction,
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

function finishHsBp5BardCageLiveStartScoreBonus(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const highCostHasunosoraMemberCount = countHighCostHasunosoraStageMembers(game, playerId);
  const isConditionMet = highCostHasunosoraMemberCount >= 2;
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
      effectText: getAbilityEffectText(
        HS_BP5_020_LIVE_START_HIGH_COST_HASUNOSORA_SCORE_ABILITY_ID
      ),
      conditionMet: isConditionMet,
      highCostHasunosoraMemberCount,
      scoreBonus: isConditionMet ? 1 : 0,
    },
  };
}

function finishPlNPb1037CaraTesoroScoreBonus(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const history = getNijigasakiActivationHistoryThisTurn(game, playerId);
  const state = replaceLiveModifier(
    {
      ...game,
      activeEffect: null,
    },
    {
      kind: 'SCORE',
      liveCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    },
    history.scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId,
          countDelta: history.scoreBonus,
          liveCardId: effect.sourceCardId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_NIJIGASAKI_ACTIVATED_ENERGY_MEMBER_SCORE_BONUS',
      activatedEnergyByNijigasakiEffect: history.activatedEnergy,
      activatedMemberByNijigasakiEffect: history.activatedMember,
      scoreBonus: history.scoreBonus,
    },
  };
}

function finishHsBp2LadybugLiveStartRequirementReduction(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const condition = getKosuzuSayakaHigherCostCondition(game, playerId);
  const reduction = condition.conditionMet ? 3 : 0;
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
      conditionMet: condition.conditionMet,
      kosuzuMemberIds: condition.kosuzuMemberIds,
      sayakaMemberIds: condition.sayakaMemberIds,
      requirementReduction: reduction,
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

function createRelayEnteredHasunosoraRequirementReductionWorkflow(
  relayConfig: RelayEnteredHasunosoraRequirementReductionConfig
): ConditionalLiveModifierWorkflowConfig {
  return {
    abilityId: relayConfig.abilityId,
    stepId: relayConfig.stepId,
    getStartContext: (game, _ability, playerId) => {
      const relayEnteredHasunosoraMemberIds = getRelayEnteredHasunosoraMemberIds(game, playerId);
      const conditionMet = relayEnteredHasunosoraMemberIds.length >= 2;
      return {
        effectText: `${getAbilityEffectText(relayConfig.abilityId)}（当前${relayEnteredHasunosoraMemberIds.length}名，${
          conditionMet ? '满足条件' : '未满足条件'
        }）`,
        actionPayload: {
          relayEnteredHasunosoraMemberIds,
          requirementReduction: conditionMet ? 1 : 0,
        },
      };
    },
    finish: (game, effect, playerId) =>
      finishRelayEnteredHasunosoraRequirementReduction(game, effect, playerId, relayConfig),
  };
}

function finishRelayEnteredHasunosoraRequirementReduction(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  config: RelayEnteredHasunosoraRequirementReductionConfig
): ConditionalLiveModifierFinishContext {
  const relayEnteredHasunosoraMemberIds = getRelayEnteredHasunosoraMemberIds(game, playerId);
  const conditionMet = relayEnteredHasunosoraMemberIds.length >= 2;
  const state = replaceSourceRequirementModifier(
    {
      ...game,
      activeEffect: null,
    },
    effect,
    conditionMet
      ? {
          kind: 'REQUIREMENT',
          liveCardId: effect.sourceCardId,
          modifiers: [{ color: config.color, countDelta: -1 }],
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_RELAY_ENTERED_REQUIREMENT_REDUCTION',
      conditionMet,
      relayEnteredHasunosoraMemberIds,
      requirementReductionColor: config.color,
      requirementReduction: conditionMet ? 1 : 0,
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

function getRelayEnteredHasunosoraMemberIds(
  game: GameState,
  playerId: string
): readonly string[] {
  return getRelayEnteredStageMemberCardIdsThisTurn(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), groupAliasIs('蓮ノ空'))
  );
}

function countHighCostHasunosoraStageMembers(game: GameState, playerId: string): number {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    (card) => groupAliasIs('蓮ノ空')(card) && getMemberEffectiveCost(game, playerId, card.instanceId) >= 10
  ).length;
}

function getNijigasakiActivationHistoryThisTurn(
  game: GameState,
  playerId: string
): {
  readonly activatedEnergy: boolean;
  readonly activatedMember: boolean;
  readonly scoreBonus: number;
} {
  const ownNijigasakiEffectActions = getActionsSinceLatestOverallTurnStart(game).filter((action) =>
    isOwnNijigasakiResolveAbilityAction(game, action, playerId)
  );
  const activatedEnergy = ownNijigasakiEffectActions.some(hasActivatedWaitingEnergyPayload);
  const activatedMember = ownNijigasakiEffectActions.some((action) =>
    hasActivatedWaitingStageMemberPayload(game, action, playerId)
  );

  return {
    activatedEnergy,
    activatedMember,
    scoreBonus: activatedEnergy ? (activatedMember ? 2 : 1) : 0,
  };
}

function getActionsSinceLatestOverallTurnStart(game: GameState): readonly GameAction[] {
  for (let index = game.actionHistory.length - 1; index >= 0; index -= 1) {
    const action = game.actionHistory[index];
    if (
      action?.type === 'PHASE_CHANGE' &&
      action.payload.from === GamePhase.LIVE_RESULT_PHASE &&
      action.payload.to === GamePhase.ACTIVE_PHASE
    ) {
      return game.actionHistory.slice(index + 1);
    }
  }
  return game.actionHistory;
}

function isOwnNijigasakiResolveAbilityAction(
  game: GameState,
  action: GameAction,
  playerId: string
): boolean {
  if (action.type !== 'RESOLVE_ABILITY' || action.playerId !== playerId) {
    return false;
  }
  const sourceCardId = getPayloadString(action.payload.sourceCardId);
  if (!sourceCardId) {
    return false;
  }
  const sourceCard = getCardById(game, sourceCardId);
  return sourceCard !== null && sourceCard.ownerId === playerId && groupAliasIs('虹ヶ咲')(sourceCard);
}

function hasActivatedWaitingEnergyPayload(action: GameAction): boolean {
  const activatedEnergyCardIds = getPayloadStringArray(action.payload.activatedEnergyCardIds);
  if (activatedEnergyCardIds.length === 0) {
    return false;
  }
  return (
    action.payload.nextOrientation === undefined ||
    action.payload.nextOrientation === OrientationState.ACTIVE
  );
}

function hasActivatedWaitingStageMemberPayload(
  game: GameState,
  action: GameAction,
  playerId: string
): boolean {
  const targetMemberCardId = getPayloadString(action.payload.targetMemberCardId);
  if (
    targetMemberCardId &&
    action.payload.previousOrientation === OrientationState.WAITING &&
    action.payload.nextOrientation === OrientationState.ACTIVE &&
    isOwnedMemberCard(game, targetMemberCardId, playerId)
  ) {
    return true;
  }

  const activatedMemberCardIds = getPayloadStringArray(action.payload.activatedMemberCardIds);
  if (
    activatedMemberCardIds.length === 0 ||
    !(
      action.payload.nextOrientation === undefined ||
      action.payload.nextOrientation === OrientationState.ACTIVE
    )
  ) {
    return false;
  }

  const previousOrientations = [
    ...getPayloadOrientationChanges(action.payload.previousOrientations),
    ...getPayloadOrientationChanges(action.payload.previousMemberOrientations),
  ];
  return activatedMemberCardIds.some(
    (cardId) =>
      isOwnedMemberCard(game, cardId, playerId) &&
      previousOrientations.some(
        (previous) => previous.cardId === cardId && previous.orientation === OrientationState.WAITING
      )
  );
}

function isOwnedMemberCard(game: GameState, cardId: string, playerId: string): boolean {
  const card = getCardById(game, cardId);
  return card !== null && card.ownerId === playerId && card.data.cardType === CardType.MEMBER;
}

function getPayloadString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getPayloadStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : [];
}

function getPayloadOrientationChanges(
  value: unknown
): readonly { readonly cardId: string; readonly orientation: OrientationState }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is { readonly cardId: string; readonly orientation: OrientationState } =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { readonly cardId?: unknown }).cardId === 'string' &&
      Object.values(OrientationState).includes(
        (entry as { readonly orientation?: OrientationState }).orientation as OrientationState
      )
  );
}

function getKosuzuSayakaHigherCostCondition(
  game: GameState,
  playerId: string
): {
  readonly conditionMet: boolean;
  readonly kosuzuMemberIds: readonly string[];
  readonly sayakaMemberIds: readonly string[];
} {
  const kosuzuMemberIds = getStageMemberCardIdsMatching(game, playerId, cardNameAliasIs('徒町小鈴'));
  const sayakaMemberIds = getStageMemberCardIdsMatching(game, playerId, cardNameAliasIs('村野さやか'));
  const conditionMet = kosuzuMemberIds.some((kosuzuMemberId) => {
    const kosuzuCost = getMemberEffectiveCost(game, playerId, kosuzuMemberId);
    return sayakaMemberIds.some(
      (sayakaMemberId) => getMemberEffectiveCost(game, playerId, sayakaMemberId) > kosuzuCost
    );
  });

  return {
    conditionMet,
    kosuzuMemberIds,
    sayakaMemberIds,
  };
}

function getStageMemberCardIdsMatching(
  game: GameState,
  playerId: string,
  selector: CardSelector
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return Object.values(player.memberSlots.slots).filter((cardId): cardId is string => {
    if (cardId === null) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
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
