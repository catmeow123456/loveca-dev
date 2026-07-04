import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameAction,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier, replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
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
  HS_SD1_018_LIVE_START_HASUNOSORA_STAGE_DREAM_BELIEVERS_SCORE_ABILITY_ID,
  NICO_LIVE_START_SCORE_ABILITY_ID,
  PL_N_PB1_037_LIVE_START_NIJIGASAKI_ACTIVATED_ENERGY_MEMBER_SCORE_ABILITY_ID,
  S_BP6_010_LIVE_START_RED_REQUIREMENT_GAIN_RED_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

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
const S_BP6_010_RED_REQUIREMENT_GAIN_HEART_STEP_ID = 'S_BP6_010_RED_REQUIREMENT_GAIN_HEART';
const HS_SD1_018_DREAM_BELIEVERS_SCORE_STEP_ID = 'HS_SD1_018_DREAM_BELIEVERS_SCORE';

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
    abilityId: S_BP6_010_LIVE_START_RED_REQUIREMENT_GAIN_RED_HEART_ABILITY_ID,
    stepId: S_BP6_010_RED_REQUIREMENT_GAIN_HEART_STEP_ID,
    getStartContext: (game, _ability, playerId) => {
      const redRequirementTotal = sumOwnLiveZoneRequirement(game, playerId, HeartColor.RED);
      const conditionMet = redRequirementTotal >= 4;
      return {
        effectText: `${getAbilityEffectText(
          S_BP6_010_LIVE_START_RED_REQUIREMENT_GAIN_RED_HEART_ABILITY_ID
        )}（当前[赤ハート]必要数合计 ${redRequirementTotal}，${conditionMet ? '满足条件，[赤ハート]+1' : '未满足条件'}）`,
        actionPayload: {
          redRequirementTotal,
          heartBonus: redRequirementTotal >= 4 ? 1 : 0,
        },
      };
    },
    finish: finishSBp6010LiveStartRedRequirementGainHeart,
  },
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

function finishSBp6010LiveStartRedRequirementGainHeart(
  game: GameState,
  effect: PendingAbilityState,
  playerId: string
): ConditionalLiveModifierFinishContext {
  const redRequirementTotal = sumOwnLiveZoneRequirement(game, playerId, HeartColor.RED);
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  if (redRequirementTotal >= 4) {
    state = addLiveModifier(state, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId,
      hearts: [{ color: HeartColor.RED, count: 1 }],
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
  }

  return {
    gameState: state,
    actionPayload: {
      step: 'APPLY_SOURCE_MEMBER_RED_HEART',
      redRequirementTotal,
      heartBonus: redRequirementTotal >= 4 ? 1 : 0,
    },
  };
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
