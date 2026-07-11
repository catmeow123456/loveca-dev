import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameAction,
  type GameState,
  type LiveModifierState,
  type LiveRequirementModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addLiveModifier,
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
  replaceLiveModifier,
} from '../../../../domain/rules/live-modifiers.js';
import {
  and,
  cardNameContains,
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
  getCardIdsInZoneMatching,
  getMemberEffectiveCost,
  hasAtLeastCardsMatchingSelector,
  successLiveScoreAtLeast,
  sumSuccessfulLiveScore,
} from '../../../effects/conditions.js';
import { getRelayEnteredStageMemberCardIdsThisTurn } from '../../../effects/relay-entered-members.js';
import { selectDifferentNamedCards } from '../../../../shared/utils/card-identity.js';
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
  HS_PB1_026_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_REDUCE_REQUIREMENT_ABILITY_ID,
  HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID,
  NICO_LIVE_START_SCORE_ABILITY_ID,
  PL_BP5_020_LIVE_START_CENTER_MUSE_YELLOW_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
  PL_BP5_022_LIVE_START_SUCCESS_ZONE_SCORE_AND_REQUIREMENT_ABILITY_ID,
  PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
  PL_N_BP4_028_LIVE_START_DIFFERENT_NIJIGASAKI_LIVE_SCORE_ABILITY_ID,
  PL_N_PB1_037_LIVE_START_NIJIGASAKI_ACTIVATED_ENERGY_MEMBER_SCORE_ABILITY_ID,
  PL_PB1_029_LIVE_START_NO_SUCCESS_ONLY_LILYWHITE_SCORE_ABILITY_ID,
  PL_PB1_030_LIVE_START_OPPONENT_WAITING_REDUCE_REQUIREMENT_ABILITY_ID,
  SP_BP4_028_LIVE_START_ACTIVE_ENERGY_SCORE_ABILITY_ID,
  PL_S_BP5_013_LIVE_START_GREEN_REQUIREMENT_GAIN_GREEN_HEART_ABILITY_ID,
  S_BP6_010_LIVE_START_RED_REQUIREMENT_GAIN_RED_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const NICO_SCORE_BONUS_STEP_ID = 'NICO_SCORE_BONUS';
const BOKUIMA_REQUIREMENT_REDUCTION_STEP_ID = 'BOKUIMA_REQUIREMENT_REDUCTION';
const PL_BP5_020_CENTER_MUSE_YELLOW_REQUIREMENT_STEP_ID =
  'PL_BP5_020_CENTER_MUSE_YELLOW_REQUIREMENT';
const PL_BP5_022_SUCCESS_ZONE_SCORE_REQUIREMENT_STEP_ID =
  'PL_BP5_022_SUCCESS_ZONE_SCORE_REQUIREMENT';
const PL_BP5_023_STAGE_NON_PINK_PURPLE_REQUIREMENT_STEP_ID =
  'PL_BP5_023_STAGE_NON_PINK_PURPLE_REQUIREMENT';
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
const S_BP6_010_RED_REQUIREMENT_GAIN_HEART_STEP_ID = 'S_BP6_010_RED_REQUIREMENT_GAIN_HEART';
const PL_S_BP5_013_GREEN_REQUIREMENT_GAIN_HEART_STEP_ID =
  'PL_S_BP5_013_GREEN_REQUIREMENT_GAIN_HEART';
const HS_SD1_018_DREAM_BELIEVERS_SCORE_STEP_ID = 'HS_SD1_018_DREAM_BELIEVERS_SCORE';
const PL_PB1_029_LILYWHITE_SCORE_STEP_ID = 'PL_PB1_029_LILYWHITE_SCORE';
const PL_PB1_030_OPPONENT_WAITING_REQUIREMENT_STEP_ID =
  'PL_PB1_030_OPPONENT_WAITING_REQUIREMENT';
const SP_BP4_028_ACTIVE_ENERGY_SCORE_STEP_ID = 'SP_BP4_028_ACTIVE_ENERGY_SCORE';
const PL_N_BP4_028_DIFFERENT_NIJIGASAKI_LIVE_SCORE_STEP_ID =
  'PL_N_BP4_028_DIFFERENT_NIJIGASAKI_LIVE_SCORE';
const HS_PB1_026_DIFFERENT_HASUNOSORA_MEMBER_REQUIREMENT_STEP_ID =
  'HS_PB1_026_DIFFERENT_HASUNOSORA_MEMBER_REQUIREMENT';

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
    effect: PendingAbilityState,
    playerId: string
  ) => ConditionalLiveModifierFinishContext;
}

interface RelayEnteredHasunosoraRequirementReductionConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly color: HeartColor;
  readonly colorLabel: string;
}

interface LiveRequirementGainHeartConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly color: HeartColor;
  readonly colorLabel: string;
}

const CONDITIONAL_LIVE_MODIFIER_WORKFLOWS: readonly ConditionalLiveModifierWorkflowConfig[] = [
  {
    abilityId: HS_PB1_026_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_REDUCE_REQUIREMENT_ABILITY_ID,
    stepId: HS_PB1_026_DIFFERENT_HASUNOSORA_MEMBER_REQUIREMENT_STEP_ID,
    getStartContext: getHsPb1026DifferentHasunosoraMemberStartContext,
    finish: finishHsPb1026DifferentHasunosoraMemberRequirementReduction,
  },
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
        effectText: `${getAbilityEffectText(BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID)}（当前成功LIVE ${successLiveCount}张，减少${reduction}个[無ハート]）`,
        actionPayload: {
          successLiveCount,
          requirementReduction: reduction,
        },
      };
    },
    finish: finishBokuimaLiveStartRequirementReduction,
  },
  {
    abilityId: PL_BP5_020_LIVE_START_CENTER_MUSE_YELLOW_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
    stepId: PL_BP5_020_CENTER_MUSE_YELLOW_REQUIREMENT_STEP_ID,
    getStartContext: getPlBp5020WonderZoneStartContext,
    finish: finishPlBp5020WonderZoneRequirementReduction,
  },
  {
    abilityId: PL_BP5_022_LIVE_START_SUCCESS_ZONE_SCORE_AND_REQUIREMENT_ABILITY_ID,
    stepId: PL_BP5_022_SUCCESS_ZONE_SCORE_REQUIREMENT_STEP_ID,
    getStartContext: getPlBp5022ASongForYouStartContext,
    finish: finishPlBp5022ASongForYouScoreRequirement,
  },
  {
    abilityId: PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID,
    stepId: PL_BP5_023_STAGE_NON_PINK_PURPLE_REQUIREMENT_STEP_ID,
    getStartContext: getPlBp5023OtohimeStartContext,
    finish: finishPlBp5023OtohimeRequirementReduction,
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
        effectText: `${getAbilityEffectText(HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID)}（当前此卡以外莲之空卡 ${otherHasunosoraLiveZoneCount}张，减少${reduction}个[緑ハート]）`,
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
          isConditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'
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
    colorLabel: '[緑ハート]',
  }),
  createRelayEnteredHasunosoraRequirementReductionWorkflow({
    abilityId: HS_BP2_023_LIVE_START_RELAY_ENTERED_HASUNOSORA_BLUE_REQUIREMENT_ABILITY_ID,
    stepId: HS_BP2_023_RELAY_ENTERED_REQUIREMENT_REDUCTION_STEP_ID,
    color: HeartColor.BLUE,
    colorLabel: '[青ハート]',
  }),
  createRelayEnteredHasunosoraRequirementReductionWorkflow({
    abilityId: HS_BP2_025_LIVE_START_RELAY_ENTERED_HASUNOSORA_PINK_REQUIREMENT_ABILITY_ID,
    stepId: HS_BP2_025_RELAY_ENTERED_REQUIREMENT_REDUCTION_STEP_ID,
    color: HeartColor.PINK,
    colorLabel: '[桃ハート]',
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
          isConditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'
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
        )}（小鈴 ${condition.kosuzuMemberIds.length}名，さやか ${condition.sayakaMemberIds.length}名，${condition.conditionMet ? '满足条件，减少3个[無ハート]' : '未满足条件，不减少必要[無ハート]'}）`,
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
          reducesRequirement ? '减少1个必要[無ハート]' : '未减少必要[無ハート]'
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
  {
    abilityId: SP_BP4_028_LIVE_START_ACTIVE_ENERGY_SCORE_ABILITY_ID,
    stepId: SP_BP4_028_ACTIVE_ENERGY_SCORE_STEP_ID,
    getStartContext: getSpBp4028DaisukiFullPowerStartContext,
    finish: finishSpBp4028DaisukiFullPowerScoreBonus,
  },
  {
    abilityId: PL_N_BP4_028_LIVE_START_DIFFERENT_NIJIGASAKI_LIVE_SCORE_ABILITY_ID,
    stepId: PL_N_BP4_028_DIFFERENT_NIJIGASAKI_LIVE_SCORE_STEP_ID,
    getStartContext: getPlNBp4028StarsWeChaseStartContext,
    finish: finishPlNBp4028StarsWeChaseScoreBonus,
  },
  createLiveRequirementGainHeartWorkflow({
    abilityId: S_BP6_010_LIVE_START_RED_REQUIREMENT_GAIN_RED_HEART_ABILITY_ID,
    stepId: S_BP6_010_RED_REQUIREMENT_GAIN_HEART_STEP_ID,
    color: HeartColor.RED,
    colorLabel: '[赤ハート]',
  }),
  createLiveRequirementGainHeartWorkflow({
    abilityId: PL_S_BP5_013_LIVE_START_GREEN_REQUIREMENT_GAIN_GREEN_HEART_ABILITY_ID,
    stepId: PL_S_BP5_013_GREEN_REQUIREMENT_GAIN_HEART_STEP_ID,
    color: HeartColor.GREEN,
    colorLabel: '[緑ハート]',
  }),
  {
    abilityId: HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID,
    stepId: HS_SD1_018_DREAM_BELIEVERS_SCORE_STEP_ID,
    getStartContext: (game, _ability, playerId) => {
      const condition = getHsSd1018DreamBelieversCondition(game, playerId);
      return {
        effectText: `${getAbilityEffectText(
          HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID
        )}（当前莲之空成员 ${condition.hasunosoraStageMemberCount}名，休息室 Dream Believers LIVE ${condition.dreamBelieversLiveCount}张，${
          condition.conditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'
        }）`,
        actionPayload: {
          hasunosoraStageMemberCount: condition.hasunosoraStageMemberCount,
          dreamBelieversLiveCount: condition.dreamBelieversLiveCount,
          scoreBonus: condition.conditionMet ? 1 : 0,
        },
      };
    },
    finish: finishHsSd1018DreamBelieversScoreBonus,
  },
  {
    abilityId: PL_PB1_029_LIVE_START_NO_SUCCESS_ONLY_LILYWHITE_SCORE_ABILITY_ID,
    stepId: PL_PB1_029_LILYWHITE_SCORE_STEP_ID,
    getStartContext: getPlPb1029LilywhiteScoreStartContext,
    finish: finishPlPb1029LilywhiteScoreBonus,
  },
  {
    abilityId: PL_PB1_030_LIVE_START_OPPONENT_WAITING_REDUCE_REQUIREMENT_ABILITY_ID,
    stepId: PL_PB1_030_OPPONENT_WAITING_REQUIREMENT_STEP_ID,
    getStartContext: getPlPb1030OpponentWaitingRequirementStartContext,
    finish: finishPlPb1030OpponentWaitingRequirementReduction,
  },
];

export function registerConditionalLiveModifierWorkflowHandlers(): void {
  for (const config of CONDITIONAL_LIVE_MODIFIER_WORKFLOWS) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, context) =>
        resolveConditionalLiveModifierWorkflow(
          game,
          ability,
          config,
          options.orderedResolution === true,
          context.continuePendingCardEffects
        ),
      (game, ability) => {
        const player = getPlayerById(game, ability.controllerId);
        if (!player) {
          return {};
        }
        const startContext = config.getStartContext(game, ability, player.id);
        return {
          effectText: startContext.effectText,
          stepText: startContext.effectText,
        };
      }
    );
  }
}

function resolveConditionalLiveModifierWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  config: ConditionalLiveModifierWorkflowConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const finishContext = config.finish(game, ability, player.id);
  const stateWithoutPending: GameState = {
    ...finishContext.gameState,
    pendingAbilities: finishContext.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...finishContext.actionPayload,
    }),
    orderedResolution
  );
}

function finishNicoLiveStartScoreBonus(
  game: GameState,
  effect: PendingAbilityState,
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
  const conditionMet = museWaitingRoomCount >= 25;
  return {
    effectText: `${getAbilityEffectText(
      NICO_LIVE_START_SCORE_ABILITY_ID
    )}（当前 μ's 休息室 ${museWaitingRoomCount}张，${conditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'}）`,
    actionPayload: {},
  };
}

function createLiveRequirementGainHeartWorkflow(
  config: LiveRequirementGainHeartConfig
): ConditionalLiveModifierWorkflowConfig {
  const getContext = (
    game: GameState,
    ability: PendingAbilityState,
    playerId: string
  ): {
    readonly requirementTotal: number;
    readonly sourceInStage: boolean;
    readonly conditionMet: boolean;
  } => {
    const requirementTotal = sumOwnLiveZoneRequirement(game, playerId, config.color);
    const sourceInStage = isSourceMemberInOwnStage(game, playerId, ability.sourceCardId);
    return {
      requirementTotal,
      sourceInStage,
      conditionMet: sourceInStage && requirementTotal >= 4,
    };
  };

  return {
    abilityId: config.abilityId,
    stepId: config.stepId,
    getStartContext: (game, ability, playerId) => {
      const context = getContext(game, ability, playerId);
      return {
        effectText: `${getAbilityEffectText(config.abilityId)}（当前${
          config.colorLabel
        }必要数合计 ${context.requirementTotal}，${
          context.sourceInStage ? '来源在舞台' : '来源不在舞台'
        }，${
          context.conditionMet
            ? `满足条件，实际获得${config.colorLabel}`
            : `未满足条件，实际不获得${config.colorLabel}`
        }）`,
        actionPayload: {
          requirementTotal: context.requirementTotal,
          sourceInStage: context.sourceInStage,
          conditionMet: context.conditionMet,
          heartBonus: context.conditionMet ? 1 : 0,
        },
      };
    },
    finish: (game, effect, playerId) => {
      const context = getContext(game, effect, playerId);
      let state: GameState = {
        ...game,
        activeEffect: null,
      };
      if (context.conditionMet) {
        state = addLiveModifier(state, {
          kind: 'HEART',
          target: 'SOURCE_MEMBER',
          playerId,
          hearts: [{ color: config.color, count: 1 }],
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        });
      }

      return {
        gameState: state,
        actionPayload: {
          step: `APPLY_SOURCE_MEMBER_${config.color}_HEART`,
          requirementTotal: context.requirementTotal,
          sourceInStage: context.sourceInStage,
          conditionMet: context.conditionMet,
          heartBonus: context.conditionMet ? 1 : 0,
        },
      };
    },
  };
}

function isSourceMemberInOwnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  if (!player || !Object.values(player.memberSlots.slots).includes(sourceCardId)) {
    return false;
  }
  const source = getCardById(game, sourceCardId);
  return source !== null && isMemberCardData(source.data);
}

function sumOwnLiveZoneRequirement(game: GameState, playerId: string, color: HeartColor): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }

  return player.liveZone.cardIds.reduce((total, cardId) => {
    const card = getCardById(game, cardId);
    if (!card || !isLiveCardData(card.data)) {
      return total;
    }
    return total + (card.data.requirements.colorRequirements.get(color) ?? 0);
  }, 0);
}

function finishBokuimaLiveStartRequirementReduction(
  game: GameState,
  effect: PendingAbilityState,
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

function getPlBp5020WonderZoneStartContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierStartContext {
  const context = getPlBp5020WonderZoneContext(game, ability, playerId);
  return {
    effectText: `${getAbilityEffectText(
      PL_BP5_020_LIVE_START_CENTER_MUSE_YELLOW_HEART_REDUCE_REQUIREMENT_ABILITY_ID
    )}（中心${
      context.centerMuseMemberCardId ? "为 μ's 成员" : "不是 μ's 成员"
    }，当前[黄ハート] ${context.yellowHeartCount}个，实际减少${context.requirementReduction}个[無ハート]）`,
    actionPayload: {
      sourceInLiveZone: context.sourceInLiveZone,
      centerMuseMemberCardId: context.centerMuseMemberCardId,
      yellowHeartCount: context.yellowHeartCount,
      requirementReduction: context.requirementReduction,
    },
  };
}

function finishPlBp5020WonderZoneRequirementReduction(
  game: GameState,
  effect: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const context = getPlBp5020WonderZoneContext(game, effect, playerId);
  const state = replaceSourceRequirementModifier(
    {
      ...game,
      activeEffect: null,
    },
    effect,
    context.requirementReduction > 0
      ? {
          kind: 'REQUIREMENT',
          liveCardId: effect.sourceCardId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -context.requirementReduction }],
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_CENTER_MUSE_YELLOW_HEART_REQUIREMENT_REDUCTION',
      sourceInLiveZone: context.sourceInLiveZone,
      centerMuseMemberCardId: context.centerMuseMemberCardId,
      yellowHeartCount: context.yellowHeartCount,
      requirementReduction: context.requirementReduction,
    },
  };
}

function getPlBp5022ASongForYouStartContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierStartContext {
  const context = getPlBp5022ASongForYouContext(game, ability, playerId);
  return {
    effectText: `${getAbilityEffectText(
      PL_BP5_022_LIVE_START_SUCCESS_ZONE_SCORE_AND_REQUIREMENT_ABILITY_ID
    )}（成功LIVE ${context.successLiveCount}张，实际分数+${context.scoreBonus}，必要[桃ハート]/[黄ハート]/[紫ハート]/[無ハート]各增加${
      context.requirementIncrease
    }个）`,
    actionPayload: {
      sourceInLiveZone: context.sourceInLiveZone,
      successLiveCount: context.successLiveCount,
      scoreBonus: context.scoreBonus,
      requirementIncrease: context.requirementIncrease,
    },
  };
}

function finishPlBp5022ASongForYouScoreRequirement(
  game: GameState,
  effect: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const context = getPlBp5022ASongForYouContext(game, effect, playerId);
  let state: GameState = {
    ...game,
    activeEffect: null,
  };

  state = replaceSourceRequirementModifier(
    state,
    effect,
    context.requirementIncrease > 0
      ? {
          kind: 'REQUIREMENT',
          liveCardId: effect.sourceCardId,
          modifiers: createPlBp5022RequirementModifiers(context.requirementIncrease),
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
    context.scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId,
          countDelta: context.scoreBonus,
          liveCardId: effect.sourceCardId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );

  if (context.scoreBonus > 0) {
    state = refreshPlayerScoreDraft(state, playerId, context.scoreBonus);
  }

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_SUCCESS_ZONE_SCORE_AND_REQUIREMENT',
      sourceInLiveZone: context.sourceInLiveZone,
      successLiveCount: context.successLiveCount,
      scoreBonus: context.scoreBonus,
      requirementIncrease: context.requirementIncrease,
      requirementModifiers:
        context.requirementIncrease > 0
          ? createPlBp5022RequirementModifiers(context.requirementIncrease)
          : [],
    },
  };
}

function getPlBp5023OtohimeStartContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierStartContext {
  const context = getPlBp5023OtohimeContext(game, ability, playerId);
  return {
    effectText: `${getAbilityEffectText(
      PL_BP5_023_LIVE_START_STAGE_NON_PINK_PURPLE_HEART_REDUCE_REQUIREMENT_ABILITY_ID
    )}（符合条件成员 ${context.qualifiedMemberCardIds.length}名，实际减少${context.requirementReduction}个[無ハート]）`,
    actionPayload: {
      sourceInLiveZone: context.sourceInLiveZone,
      qualifiedMemberCardIds: context.qualifiedMemberCardIds,
      requirementReduction: context.requirementReduction,
    },
  };
}

function finishPlBp5023OtohimeRequirementReduction(
  game: GameState,
  effect: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const context = getPlBp5023OtohimeContext(game, effect, playerId);
  const state = replaceSourceRequirementModifier(
    {
      ...game,
      activeEffect: null,
    },
    effect,
    context.requirementReduction > 0
      ? {
          kind: 'REQUIREMENT',
          liveCardId: effect.sourceCardId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -context.requirementReduction }],
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_STAGE_NON_PINK_PURPLE_HEART_REQUIREMENT_REDUCTION',
      sourceInLiveZone: context.sourceInLiveZone,
      qualifiedMemberCardIds: context.qualifiedMemberCardIds,
      requirementReduction: context.requirementReduction,
    },
  };
}

function finishHsBp5HanamusubiLiveStartRequirementReduction(
  game: GameState,
  effect: PendingAbilityState,
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
  effect: PendingAbilityState,
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
  effect: PendingAbilityState,
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
      effectText: getAbilityEffectText(HS_BP5_020_LIVE_START_HIGH_COST_HASUNOSORA_SCORE_ABILITY_ID),
      conditionMet: isConditionMet,
      highCostHasunosoraMemberCount,
      scoreBonus: isConditionMet ? 1 : 0,
    },
  };
}

function finishHsSd1018DreamBelieversScoreBonus(
  game: GameState,
  effect: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const condition = getHsSd1018DreamBelieversCondition(game, playerId);
  const scoreBonus = condition.conditionMet ? 1 : 0;
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  if (scoreBonus > 0) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId,
      countDelta: scoreBonus,
      liveCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
    state = refreshPlayerScoreDraft(state, playerId, scoreBonus);
  }

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_SCORE_BONUS',
      effectText: getAbilityEffectText(
        HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID
      ),
      conditionMet: condition.conditionMet,
      hasunosoraStageMemberCount: condition.hasunosoraStageMemberCount,
      dreamBelieversLiveCount: condition.dreamBelieversLiveCount,
      dreamBelieversLiveCardIds: condition.dreamBelieversLiveCardIds,
      scoreBonus,
    },
  };
}

function getHsSd1018DreamBelieversCondition(
  game: GameState,
  playerId: string
): {
  readonly hasunosoraStageMemberCount: number;
  readonly dreamBelieversLiveCount: number;
  readonly dreamBelieversLiveCardIds: readonly string[];
  readonly conditionMet: boolean;
} {
  const hasunosoraStageMemberCount = countHasunosoraStageMembers(game, playerId);
  const dreamBelieversLiveCardIds = getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    and(typeIs(CardType.LIVE), cardNameContains('Dream Believers'))
  );
  return {
    hasunosoraStageMemberCount,
    dreamBelieversLiveCount: dreamBelieversLiveCardIds.length,
    dreamBelieversLiveCardIds,
    conditionMet: hasunosoraStageMemberCount >= 3 && dreamBelieversLiveCardIds.length > 0,
  };
}

function getPlPb1029LilywhiteScoreStartContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierStartContext {
  const condition = getPlPb1029LilywhiteScoreCondition(game, ability, playerId);
  return {
    effectText: `${getAbilityEffectText(
      PL_PB1_029_LIVE_START_NO_SUCCESS_ONLY_LILYWHITE_SCORE_ABILITY_ID
    )}（成功LIVE ${condition.successLiveCount}张，舞台成员 ${condition.stageMemberCount}名，其中 lilywhite ${condition.lilywhiteStageMemberCount}名，${
      condition.conditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'
    }）`,
    actionPayload: {
      successLiveCount: condition.successLiveCount,
      stageMemberCount: condition.stageMemberCount,
      lilywhiteStageMemberCount: condition.lilywhiteStageMemberCount,
      scoreBonus: condition.conditionMet ? 1 : 0,
    },
  };
}

function finishPlPb1029LilywhiteScoreBonus(
  game: GameState,
  effect: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const condition = getPlPb1029LilywhiteScoreCondition(game, effect, playerId);
  const scoreBonus = condition.conditionMet ? 1 : 0;
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  if (scoreBonus > 0) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId,
      countDelta: scoreBonus,
      liveCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
    state = refreshPlayerScoreDraft(state, playerId, scoreBonus);
  }

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_LILYWHITE_SCORE_BONUS',
      conditionMet: condition.conditionMet,
      sourceInLiveZone: condition.sourceInLiveZone,
      successLiveCount: condition.successLiveCount,
      stageMemberCount: condition.stageMemberCount,
      lilywhiteStageMemberCount: condition.lilywhiteStageMemberCount,
      scoreBonus,
    },
  };
}

function getPlPb1029LilywhiteScoreCondition(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): {
  readonly sourceInLiveZone: boolean;
  readonly successLiveCount: number;
  readonly stageMemberCount: number;
  readonly lilywhiteStageMemberCount: number;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return {
      sourceInLiveZone: false,
      successLiveCount: 0,
      stageMemberCount: 0,
      lilywhiteStageMemberCount: 0,
      conditionMet: false,
    };
  }
  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const successLiveCount = player.successZone.cardIds.length;
  const stageMemberCount = getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER))
    .length;
  const lilywhiteStageMemberCount = getStageMemberCardIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), unitAliasIs('lilywhite'))
  ).length;
  const onlyLilywhite = stageMemberCount > 0 && stageMemberCount === lilywhiteStageMemberCount;
  return {
    sourceInLiveZone,
    successLiveCount,
    stageMemberCount,
    lilywhiteStageMemberCount,
    conditionMet: sourceInLiveZone && successLiveCount === 0 && onlyLilywhite,
  };
}

function getPlPb1030OpponentWaitingRequirementStartContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierStartContext {
  const condition = getPlPb1030OpponentWaitingRequirementCondition(game, ability, playerId);
  return {
    effectText: `${getAbilityEffectText(
      PL_PB1_030_LIVE_START_OPPONENT_WAITING_REDUCE_REQUIREMENT_ABILITY_ID
    )}（对方待机成员 ${condition.opponentWaitingMemberCount}名，${
      condition.conditionMet ? '满足条件，减少2个[無ハート]' : '未满足条件，不减少必要[無ハート]'
    }）`,
    actionPayload: {
      opponentWaitingMemberCount: condition.opponentWaitingMemberCount,
      requirementReduction: condition.conditionMet ? 2 : 0,
    },
  };
}

function finishPlPb1030OpponentWaitingRequirementReduction(
  game: GameState,
  effect: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const condition = getPlPb1030OpponentWaitingRequirementCondition(game, effect, playerId);
  const reduction = condition.conditionMet ? 2 : 0;
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
      step: 'APPLY_OPPONENT_WAITING_REQUIREMENT_REDUCTION',
      conditionMet: condition.conditionMet,
      sourceInLiveZone: condition.sourceInLiveZone,
      opponentWaitingMemberCount: condition.opponentWaitingMemberCount,
      requirementReduction: reduction,
    },
  };
}

function getPlPb1030OpponentWaitingRequirementCondition(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): {
  readonly sourceInLiveZone: boolean;
  readonly opponentWaitingMemberCount: number;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return { sourceInLiveZone: false, opponentWaitingMemberCount: 0, conditionMet: false };
  }
  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const opponent = getOpponent(game, playerId);
  const opponentWaitingMemberCount = opponent
    ? Object.values(opponent.memberSlots.slots).filter((cardId) => {
        if (cardId === null) {
          return false;
        }
        return opponent.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.WAITING;
      }).length
    : 0;
  return {
    sourceInLiveZone,
    opponentWaitingMemberCount,
    conditionMet: sourceInLiveZone && opponentWaitingMemberCount > 0,
  };
}

function countHasunosoraStageMembers(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }
  return Object.values(player.memberSlots.slots).filter((cardId) => {
    if (cardId === null) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card !== null && isMemberCardData(card.data) && groupAliasIs('蓮ノ空')(card);
  }).length;
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}

function finishPlNPb1037CaraTesoroScoreBonus(
  game: GameState,
  effect: PendingAbilityState,
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
  effect: PendingAbilityState,
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
  effect: PendingAbilityState,
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

function getSpBp4028DaisukiFullPowerStartContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierStartContext {
  const context = getSpBp4028DaisukiFullPowerContext(game, ability, playerId);
  return {
    effectText: `${getAbilityEffectText(
      SP_BP4_028_LIVE_START_ACTIVE_ENERGY_SCORE_ABILITY_ID
    )}（当前活跃能量 ${context.activeEnergyCount}张，${
      context.conditionMet
        ? '满足条件，实际[スコア]+1'
        : '未满足条件，实际不增加[スコア]'
    }）`,
    actionPayload: {
      activeEnergyCount: context.activeEnergyCount,
      sourceInLiveZone: context.sourceInLiveZone,
      scoreBonus: context.conditionMet ? 1 : 0,
    },
  };
}

function finishSpBp4028DaisukiFullPowerScoreBonus(
  game: GameState,
  effect: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const context = getSpBp4028DaisukiFullPowerContext(game, effect, playerId);
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  state = replaceLiveModifier(
    state,
    {
      kind: 'SCORE',
      liveCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    },
    context.conditionMet
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
  if (context.conditionMet) {
    state = refreshPlayerScoreDraft(state, playerId, 1);
  }

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_ACTIVE_ENERGY_SCORE_BONUS',
      activeEnergyCount: context.activeEnergyCount,
      sourceInLiveZone: context.sourceInLiveZone,
      conditionMet: context.conditionMet,
      scoreBonus: context.conditionMet ? 1 : 0,
    },
  };
}

function getSpBp4028DaisukiFullPowerContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): {
  readonly activeEnergyCount: number;
  readonly sourceInLiveZone: boolean;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return { activeEnergyCount: 0, sourceInLiveZone: false, conditionMet: false };
  }
  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const activeEnergyCount = player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
  ).length;
  return {
    activeEnergyCount,
    sourceInLiveZone,
    conditionMet: sourceInLiveZone && activeEnergyCount > 0,
  };
}

function getPlNBp4028StarsWeChaseStartContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierStartContext {
  const context = getPlNBp4028StarsWeChaseContext(game, ability, playerId);
  return {
    effectText: `${getAbilityEffectText(
      PL_N_BP4_028_LIVE_START_DIFFERENT_NIJIGASAKI_LIVE_SCORE_ABILITY_ID
    )}（当前休息室不同名『虹ヶ咲』LIVE ${context.differentNijigasakiLiveNameCount}种，${
      context.scoreBonus > 0
        ? `满足条件，实际[スコア]+${context.scoreBonus}`
        : '未满足条件，实际不增加[スコア]'
    }）`,
    actionPayload: {
      differentNijigasakiLiveNameCount: context.differentNijigasakiLiveNameCount,
      sourceInLiveZone: context.sourceInLiveZone,
      scoreBonus: context.scoreBonus,
    },
  };
}

function finishPlNBp4028StarsWeChaseScoreBonus(
  game: GameState,
  effect: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const context = getPlNBp4028StarsWeChaseContext(game, effect, playerId);
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  state = replaceLiveModifier(
    state,
    {
      kind: 'SCORE',
      liveCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    },
    context.scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId,
          countDelta: context.scoreBonus,
          liveCardId: effect.sourceCardId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );
  if (context.scoreBonus > 0) {
    state = refreshPlayerScoreDraft(state, playerId, context.scoreBonus);
  }

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_DIFFERENT_NIJIGASAKI_LIVE_SCORE_BONUS',
      sourceInLiveZone: context.sourceInLiveZone,
      differentNijigasakiLiveNameCount: context.differentNijigasakiLiveNameCount,
      conditionMet: context.scoreBonus > 0,
      scoreBonus: context.scoreBonus,
    },
  };
}

function getPlNBp4028StarsWeChaseContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): {
  readonly sourceInLiveZone: boolean;
  readonly differentNijigasakiLiveNameCount: number;
  readonly scoreBonus: number;
} {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return { sourceInLiveZone: false, differentNijigasakiLiveNameCount: 0, scoreBonus: 0 };
  }
  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const differentNijigasakiLiveNames = new Set<string>();
  for (const cardId of player.waitingRoom.cardIds) {
    const card = getCardById(game, cardId);
    if (card === null || !isLiveCardData(card.data) || !groupAliasIs('虹ヶ咲')(card)) {
      continue;
    }
    differentNijigasakiLiveNames.add(card.data.name.trim());
  }
  const differentNijigasakiLiveNameCount = differentNijigasakiLiveNames.size;
  const scoreBonus = !sourceInLiveZone
    ? 0
    : differentNijigasakiLiveNameCount >= 6
      ? 2
      : differentNijigasakiLiveNameCount >= 4
        ? 1
        : 0;
  return {
    sourceInLiveZone,
    differentNijigasakiLiveNameCount,
    scoreBonus,
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
          conditionMet ? `满足条件，减少1个${relayConfig.colorLabel}` : `未满足条件，不减少${relayConfig.colorLabel}`
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
  effect: PendingAbilityState,
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

function getRelayEnteredHasunosoraMemberIds(game: GameState, playerId: string): readonly string[] {
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
    (card) =>
      groupAliasIs('蓮ノ空')(card) && getMemberEffectiveCost(game, playerId, card.instanceId) >= 10
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
  return (
    sourceCard !== null && sourceCard.ownerId === playerId && groupAliasIs('虹ヶ咲')(sourceCard)
  );
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
        (previous) =>
          previous.cardId === cardId && previous.orientation === OrientationState.WAITING
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
  const kosuzuMemberIds = getStageMemberCardIdsMatching(
    game,
    playerId,
    cardNameAliasIs('徒町小鈴')
  );
  const sayakaMemberIds = getStageMemberCardIdsMatching(
    game,
    playerId,
    cardNameAliasIs('村野さやか')
  );
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

function getPlBp5020WonderZoneContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): {
  readonly sourceInLiveZone: boolean;
  readonly centerMuseMemberCardId: string | null;
  readonly yellowHeartCount: number;
  readonly requirementReduction: number;
} {
  const player = getPlayerById(game, playerId);
  const sourceInLiveZone = isSourceLiveInOwnLiveZone(game, playerId, ability.sourceCardId);
  const centerCardId = player?.memberSlots.slots[SlotPosition.CENTER] ?? null;
  const centerCard = centerCardId ? getCardById(game, centerCardId) : null;
  const centerMuseMemberCardId =
    centerCard && isMemberCardData(centerCard.data) && groupIs("μ's")(centerCard)
      ? centerCardId
      : null;
  const yellowHeartCount =
    sourceInLiveZone && centerMuseMemberCardId
      ? countEffectiveMemberHearts(game, playerId, centerMuseMemberCardId, HeartColor.YELLOW)
      : 0;
  return {
    sourceInLiveZone,
    centerMuseMemberCardId,
    yellowHeartCount,
    requirementReduction: Math.min(3, Math.floor(yellowHeartCount / 2)),
  };
}

function getPlBp5022ASongForYouContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): {
  readonly sourceInLiveZone: boolean;
  readonly successLiveCount: number;
  readonly scoreBonus: number;
  readonly requirementIncrease: number;
} {
  const player = getPlayerById(game, playerId);
  const sourceInLiveZone = isSourceLiveInOwnLiveZone(game, playerId, ability.sourceCardId);
  const successLiveCount = player?.successZone.cardIds.length ?? 0;
  return {
    sourceInLiveZone,
    successLiveCount,
    scoreBonus: sourceInLiveZone ? successLiveCount * 2 : 0,
    requirementIncrease: sourceInLiveZone ? successLiveCount : 0,
  };
}

function getPlBp5023OtohimeContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): {
  readonly sourceInLiveZone: boolean;
  readonly qualifiedMemberCardIds: readonly string[];
  readonly requirementReduction: number;
} {
  const sourceInLiveZone = isSourceLiveInOwnLiveZone(game, playerId, ability.sourceCardId);
  const qualifiedMemberCardIds = sourceInLiveZone
    ? getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER)).filter((memberCardId) =>
        hasEffectiveHeartOtherThanPinkOrPurple(game, playerId, memberCardId)
      )
    : [];
  return {
    sourceInLiveZone,
    qualifiedMemberCardIds,
    requirementReduction: qualifiedMemberCardIds.length,
  };
}

function getHsPb1026DifferentHasunosoraMemberStartContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierStartContext {
  const context = getHsPb1026DifferentHasunosoraMemberContext(game, ability, playerId);
  return {
    effectText: `${getAbilityEffectText(
      HS_PB1_026_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_REDUCE_REQUIREMENT_ABILITY_ID
    )}（当前不同名『莲之空』成员${context.differentHasunosoraMemberNameCount}名，${
      context.conditionMet
        ? '满足条件，实际减少2个[無ハート]'
        : '未满足条件，实际不减少[無ハート]'
    }）`,
    actionPayload: {
      differentHasunosoraMemberNameCount: context.differentHasunosoraMemberNameCount,
      conditionMet: context.conditionMet,
      requirementReduction: context.requirementReduction,
    },
  };
}

function finishHsPb1026DifferentHasunosoraMemberRequirementReduction(
  game: GameState,
  effect: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const context = getHsPb1026DifferentHasunosoraMemberContext(game, effect, playerId);
  const state = replaceSourceRequirementModifier(
    {
      ...game,
      activeEffect: null,
    },
    effect,
    context.conditionMet
      ? {
          kind: 'REQUIREMENT',
          liveCardId: effect.sourceCardId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        }
      : null
  );
  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_DIFFERENT_HASUNOSORA_MEMBER_REQUIREMENT_REDUCTION',
      differentHasunosoraMemberNameCount: context.differentHasunosoraMemberNameCount,
      conditionMet: context.conditionMet,
      requirementReduction: context.requirementReduction,
    },
  };
}

function getHsPb1026DifferentHasunosoraMemberContext(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): {
  readonly differentHasunosoraMemberNameCount: number;
  readonly conditionMet: boolean;
  readonly requirementReduction: number;
} {
  const sourceInLiveZone = isSourceLiveInOwnLiveZone(game, playerId, ability.sourceCardId);
  const memberCardIds = [
    ...getStageMemberCardIdsMatching(game, playerId, and(typeIs(CardType.MEMBER), groupAliasIs('蓮ノ空'))),
    ...getCardIdsInZone(game, playerId, ZoneType.WAITING_ROOM).filter((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && isMemberCardData(card.data) && groupAliasIs('蓮ノ空')(card);
    }),
  ];
  const differentHasunosoraMemberNameCount = selectDifferentNamedCards(
    memberCardIds,
    (cardId) => getCardById(game, cardId)?.data ?? null,
    {
      groupName: '蓮ノ空',
      minCount: 0,
    }
  ).length;
  const conditionMet = sourceInLiveZone && differentHasunosoraMemberNameCount >= 6;
  return {
    differentHasunosoraMemberNameCount,
    conditionMet,
    requirementReduction: conditionMet ? 2 : 0,
  };
}

function isSourceLiveInOwnLiveZone(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    isLiveCardData(source.data) &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function countEffectiveMemberHearts(
  game: GameState,
  playerId: string,
  memberCardId: string,
  color: HeartColor
): number {
  const liveModifiers = collectLiveModifiers(game);
  return getMemberEffectiveHeartIcons(game, playerId, memberCardId, liveModifiers)
    .filter((heart) => heart.color === color)
    .reduce((total, heart) => total + heart.count, 0);
}

function hasEffectiveHeartOtherThanPinkOrPurple(
  game: GameState,
  playerId: string,
  memberCardId: string
): boolean {
  const liveModifiers = collectLiveModifiers(game);
  return getMemberEffectiveHeartIcons(game, playerId, memberCardId, liveModifiers).some(
    (heart) =>
      heart.count > 0 && heart.color !== HeartColor.PINK && heart.color !== HeartColor.PURPLE
  );
}

function createPlBp5022RequirementModifiers(
  requirementIncrease: number
): readonly LiveRequirementModifierState[] {
  return requirementIncrease > 0
    ? [
        { color: HeartColor.PINK, countDelta: requirementIncrease },
        { color: HeartColor.YELLOW, countDelta: requirementIncrease },
        { color: HeartColor.PURPLE, countDelta: requirementIncrease },
        { color: HeartColor.RAINBOW, countDelta: requirementIncrease },
      ]
    : [];
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
  effect: PendingAbilityState,
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
