import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import {
  addLiveModifier,
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
  replaceLiveModifier,
} from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, SlotPosition } from '../../../../shared/types/enums.js';
import {
  cardBelongsToGroup,
  selectDifferentNamedCards,
} from '../../../../shared/utils/card-identity.js';
import { cardNameAliasIs } from '../../../effects/card-selectors.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import {
  HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID,
  HS_BP2_026_LIVE_START_MIRACRA_FORMATION_THIS_LIVE_SCORE_ABILITY_ID,
  HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
  PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
  PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID,
  PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
  PL_N_BP1_029_LIVE_START_LIVE_ZONE_THREE_THIS_LIVE_SCORE_ABILITY_ID,
  PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID,
  PL_N_BP5_027_LIVE_START_SUCCESS_ZONE_TWO_DIFFERENT_NAMES_THIS_LIVE_SCORE_ABILITY_ID,
  SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID,
  SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const NORMAL_HEART_COLORS: readonly HeartColor[] = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
];

const EUTOPIA_SCORE_BONUS = 2;

export function registerNLiveStartScoreBonusesWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_N_BP3_026_LIVE_START_SUCCESS_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolvePsychoHeartLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getPsychoHeartConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_BP3_019_LIVE_START_TWO_MUSE_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveBokuraNoLiveKimiToNoLifeLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getBokuraNoLiveKimiToNoLifeConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveNatsuiroEgaoLiveStartScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getNatsuiroEgaoScoreConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    HS_BP2_020_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLinkToTheFutureLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getLinkToTheFutureConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    HS_BP2_026_LIVE_START_MIRACRA_FORMATION_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveMiraCreationLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getMiraCreationConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSolitudeRainLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getSolitudeRainConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_N_BP1_029_LIVE_START_LIVE_ZONE_THREE_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveEutopiaLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getEutopiaConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_N_BP5_027_LIVE_START_SUCCESS_ZONE_TWO_DIFFERENT_NAMES_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveMiracleStayTuneLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getMiracleStayTuneConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    HS_BP5_018_LIVE_START_DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveAuroraFlowerLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getAuroraFlowerConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_PB1_024_LIVE_START_KALEIDOSCORE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveNeutralLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getNeutralConfirmationConfig
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_BP2_023_LIVE_START_FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveGoRestartLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getGoRestartConfirmationConfig
  );
}

function getPsychoHeartConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getPsychoHeartContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前自己的成功LIVE卡区${
      context.hasPrintedScoreOne ? '存在' : '不存在'
    }分数1的LIVE，${context.hasPrintedScoreFive ? '存在' : '不存在'}分数5的LIVE，实际[スコア]+${
      context.scoreBonus
    }。）`,
  };
}

function getBokuraNoLiveKimiToNoLifeConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getBokuraNoLiveKimiToNoLifeContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前自己LIVE中的『μ's』卡片${context.museLiveCardCount}张，${
      context.conditionMet ? '满足条件，实际[スコア]+1。' : '未满足条件，实际不增加分数。'
    }）`,
  };
}

function getNatsuiroEgaoScoreConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getNatsuiroEgaoScoreContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前自己成功LIVE卡区${context.successLiveCount}张，${
      context.conditionMet ? '满足条件，实际[スコア]+1。' : '未满足条件，实际不增加分数。'
    }）`,
  };
}

function getLinkToTheFutureConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getLinkToTheFutureContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前自己舞台不同名『莲之空』成员${context.differentNamedHasunosoraStageMembers.length}名，实际[スコア]+${context.scoreBonus}。）`,
  };
}

function getMiraCreationConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getMiraCreationContext(game, ability);
  const formationText = `右侧大泽瑠璃乃：${context.rightRurino ? '符合' : '不符合'}，左侧安养寺姬芽：${context.leftHime ? '符合' : '不符合'}，中央藤岛 慈：${context.centerMegu ? '符合' : '不符合'}`;
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（${formationText}。${context.conditionMet ? '满足条件，实际[スコア]+2。' : '未满足条件，不增加分数。'}）`,
  };
}

function getSolitudeRainConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getSolitudeRainContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前虹咲成员Heart颜色 ${context.effectiveHeartColors.length}种，分数+${context.scoreBonus}）`,
  };
}

function getEutopiaConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getEutopiaContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前LIVE区 ${context.liveZoneCardCount}张，${context.conditionMet ? `满足条件，分数+${EUTOPIA_SCORE_BONUS}` : '未满足条件，不增加分数'}）`,
  };
}

function getMiracleStayTuneConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getMiracleStayTuneContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（自己成功LIVE ${context.ownSuccessZoneCount}张，对方成功LIVE ${context.opponentSuccessZoneCount}张，不同名成员 ${context.differentNamedStageMembers.length}名，${context.conditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'}）`,
  };
}

function getAuroraFlowerConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getAuroraFlowerContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（不同名且不同有效费用成员 ${context.matchingStageMembers.length}名，${context.conditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'}）`,
  };
}

function getNeutralConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getNeutralContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前不同名『KALEIDOSCORE』成员${context.differentNamedKaleidoscoreStageMembers.length}名，${
      context.conditionMet ? '满足条件，实际[スコア]+1。' : '未满足条件，实际不增加分数。'
    }）`,
  };
}

function getGoRestartConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getGoRestartContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前自己成功LIVE ${context.ownSuccessZoneCount}张，对方成功LIVE ${context.opponentSuccessZoneCount}张，${
      context.conditionMet
        ? '满足条件，实际[スコア]+1。'
        : '未满足条件，实际不增加[スコア]。'
    }）`,
  };
}

function resolveSolitudeRainLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = consumePendingAbility(game, ability);
  const { sourceInLiveZone, nijigasakiStageMemberIds, effectiveHeartColors, scoreBonus } =
    getSolitudeRainContext(stateWithoutPending, ability);
  const stateAfterScore =
    scoreBonus > 0
      ? addScoreModifierAndRefresh(stateWithoutPending, {
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          scoreBonus,
        })
      : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE',
      sourceInLiveZone,
      nijigasakiStageMemberIds,
      effectiveHeartColors,
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolveBokuraNoLiveKimiToNoLifeLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = consumePendingAbility(game, ability);
  const { sourceInLiveZone, museLiveCardIds, museLiveCardCount, conditionMet } =
    getBokuraNoLiveKimiToNoLifeContext(stateWithoutPending, ability);
  const scoreBonus = conditionMet ? 1 : 0;
  const stateAfterScore = conditionMet
    ? addScoreModifierAndRefresh(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        scoreBonus,
      })
    : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'TWO_MUSE_LIVE_THIS_LIVE_SCORE' : 'NO_TWO_MUSE_LIVE',
      sourceInLiveZone,
      museLiveCardIds,
      museLiveCardCount,
      conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolveNatsuiroEgaoLiveStartScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = consumePendingAbility(game, ability);
  const { sourceInLiveZone, successLiveCount, conditionMet } = getNatsuiroEgaoScoreContext(
    stateWithoutPending,
    ability
  );
  const scoreBonus = conditionMet ? 1 : 0;
  const stateAfterScore = conditionMet
    ? addScoreModifierAndRefresh(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        scoreBonus,
      })
    : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'SUCCESS_LIVE_TWO_THIS_LIVE_SCORE' : 'NO_SUCCESS_LIVE_TWO',
      sourceInLiveZone,
      successLiveCount,
      conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolvePsychoHeartLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const stateWithoutPending = consumePendingAbility(game, ability);
  const context = getPsychoHeartContext(stateWithoutPending, ability);
  const scoreUpdate = replaceScoreModifierAndRefresh(stateWithoutPending, {
    playerId: player.id,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    scoreBonus: context.scoreBonus,
  });
  return continuePendingCardEffects(
    addAction(scoreUpdate, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'SUCCESS_PRINTED_SCORE_ONE_OR_FIVE_THIS_LIVE_SCORE',
      sourceInLiveZone: context.sourceInLiveZone,
      hasPrintedScoreOne: context.hasPrintedScoreOne,
      hasPrintedScoreFive: context.hasPrintedScoreFive,
      scoreBonus: context.scoreBonus,
    }),
    orderedResolution
  );
}

function resolveLinkToTheFutureLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = consumePendingAbility(game, ability);
  const { sourceInLiveZone, differentNamedHasunosoraStageMembers, scoreBonus } =
    getLinkToTheFutureContext(stateWithoutPending, ability);
  const stateAfterScore =
    scoreBonus > 0
      ? addScoreModifierAndRefresh(stateWithoutPending, {
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          scoreBonus,
        })
      : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step:
        scoreBonus > 0
          ? 'DIFFERENT_HASUNOSORA_MEMBER_NAMES_THIS_LIVE_SCORE'
          : 'NO_DIFFERENT_HASUNOSORA_MEMBER_NAMES',
      sourceInLiveZone,
      differentNamedHasunosoraStageMemberCardIds: differentNamedHasunosoraStageMembers.map(
        (member) => member.cardId
      ),
      differentNamedHasunosoraStageMemberNames: differentNamedHasunosoraStageMembers.map(
        (member) => member.name
      ),
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolveMiraCreationLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = consumePendingAbility(game, ability);
  const { sourceInLiveZone, rightRurino, leftHime, centerMegu, conditionMet } =
    getMiraCreationContext(stateWithoutPending, ability);
  const scoreBonus = conditionMet ? 2 : 0;
  const stateAfterScore = conditionMet
    ? addScoreModifierAndRefresh(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        scoreBonus,
      })
    : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'MIRACRA_FORMATION_THIS_LIVE_SCORE' : 'NO_MIRACRA_FORMATION',
      sourceInLiveZone,
      rightRurino,
      leftHime,
      centerMegu,
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolveEutopiaLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = consumePendingAbility(game, ability);
  const { sourceInLiveZone, liveZoneCardCount, conditionMet } = getEutopiaContext(
    stateWithoutPending,
    ability
  );
  const stateAfterScore = conditionMet
    ? addScoreModifierAndRefresh(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        scoreBonus: EUTOPIA_SCORE_BONUS,
      })
    : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'LIVE_ZONE_THREE_THIS_LIVE_SCORE' : 'NO_LIVE_ZONE_THREE',
      sourceInLiveZone,
      liveZoneCardCount,
      conditionMet,
      scoreBonus: conditionMet ? EUTOPIA_SCORE_BONUS : 0,
    }),
    orderedResolution
  );
}

function resolveMiracleStayTuneLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = consumePendingAbility(game, ability);
  const {
    sourceInLiveZone,
    ownSuccessZoneCount,
    opponentSuccessZoneCount,
    successZoneConditionMet,
    differentNamedStageMembers,
    differentNameConditionMet,
    conditionMet,
  } = getMiracleStayTuneContext(stateWithoutPending, ability);
  const scoreBonus = conditionMet ? 1 : 0;
  const stateAfterScore = conditionMet
    ? addScoreModifierAndRefresh(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        scoreBonus,
      })
    : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet
        ? 'SUCCESS_ZONE_TWO_DIFFERENT_NAMES_THIS_LIVE_SCORE'
        : 'NO_SUCCESS_ZONE_TWO_DIFFERENT_NAMES',
      sourceInLiveZone,
      ownSuccessZoneCount,
      opponentSuccessZoneCount,
      successZoneConditionMet,
      differentNamedStageMemberCardIds: differentNamedStageMembers.map((member) => member.cardId),
      differentNamedStageMemberNames: differentNamedStageMembers.map((member) => member.name),
      differentNameConditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolveAuroraFlowerLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending = consumePendingAbility(game, ability);
  const { sourceInLiveZone, matchingStageMembers, conditionMet } = getAuroraFlowerContext(
    stateWithoutPending,
    ability
  );
  const scoreBonus = conditionMet ? 1 : 0;
  const stateAfterScore = conditionMet
    ? addScoreModifierAndRefresh(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        scoreBonus,
      })
    : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet
        ? 'DIFFERENT_NAMES_AND_COSTS_THIS_LIVE_SCORE'
        : 'NO_DIFFERENT_NAMES_AND_COSTS',
      sourceInLiveZone,
      matchingStageMemberCardIds: matchingStageMembers.map((member) => member.cardId),
      matchingStageMemberNames: matchingStageMembers.map((member) => member.name),
      matchingStageMemberCosts: matchingStageMembers.map((member) => member.effectiveCost),
      conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolveNeutralLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const stateWithoutPending = consumePendingAbility(game, ability);
  const context = getNeutralContext(stateWithoutPending, ability);
  const scoreBonus = context.conditionMet ? 1 : 0;
  const stateAfterScore =
    scoreBonus > 0
      ? addScoreModifierAndRefresh(stateWithoutPending, {
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          scoreBonus,
        })
      : stateWithoutPending;
  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: context.conditionMet ? 'DIFFERENT_KALEIDOSCORE_NAMES_SCORE' : 'NO_DIFFERENT_KALEIDOSCORE_NAMES',
      sourceInLiveZone: context.sourceInLiveZone,
      differentNamedKaleidoscoreMemberCardIds:
        context.differentNamedKaleidoscoreStageMembers.map((member) => member.cardId),
      differentNamedKaleidoscoreMemberNames:
        context.differentNamedKaleidoscoreStageMembers.map((member) => member.name),
      conditionMet: context.conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function resolveGoRestartLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const stateWithoutPending = consumePendingAbility(game, ability);
  const context = getGoRestartContext(stateWithoutPending, ability);
  const stateAfterScore = context.conditionMet
    ? addScoreModifierAndRefresh(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        scoreBonus: context.scoreBonus,
      })
    : stateWithoutPending;
  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: context.conditionMet
        ? 'FEWER_SUCCESS_LIVE_THIS_LIVE_SCORE'
        : 'NO_FEWER_SUCCESS_LIVE',
      sourceInLiveZone: context.sourceInLiveZone,
      ownSuccessZoneCount: context.ownSuccessZoneCount,
      opponentSuccessZoneCount: context.opponentSuccessZoneCount,
      conditionMet: context.conditionMet,
      scoreBonus: context.scoreBonus,
    }),
    orderedResolution
  );
}

function getSolitudeRainContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly nijigasakiStageMemberIds: readonly string[];
  readonly effectiveHeartColors: readonly HeartColor[];
  readonly scoreBonus: number;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      sourceInLiveZone: false,
      nijigasakiStageMemberIds: [],
      effectiveHeartColors: [],
      scoreBonus: 0,
    };
  }

  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const nijigasakiStageMemberIds = sourceInLiveZone
    ? getAllMemberCardIds(player.memberSlots).filter((cardId) => isNijigasakiMember(game, cardId))
    : [];
  const effectiveHeartColors = getUniqueNormalEffectiveHeartColors(
    game,
    player.id,
    nijigasakiStageMemberIds
  );
  return {
    sourceInLiveZone,
    nijigasakiStageMemberIds,
    effectiveHeartColors,
    scoreBonus: sourceInLiveZone ? effectiveHeartColors.length : 0,
  };
}

function getLinkToTheFutureContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly differentNamedHasunosoraStageMembers: readonly {
    readonly cardId: string;
    readonly name: string;
  }[];
  readonly scoreBonus: number;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      sourceInLiveZone: false,
      differentNamedHasunosoraStageMembers: [],
      scoreBonus: 0,
    };
  }

  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const differentNamedHasunosoraStageMembers = sourceInLiveZone
    ? selectDifferentNamedCards(
        getAllMemberCardIds(player.memberSlots),
        (cardId) => {
          const card = getCardById(game, cardId);
          return card && isMemberCardData(card.data) && cardBelongsToGroup(card.data, '蓮ノ空')
            ? card.data
            : null;
        },
        { minCount: 1 }
      ).map((match) => ({ cardId: match.item, name: match.name }))
    : [];
  return {
    sourceInLiveZone,
    differentNamedHasunosoraStageMembers,
    scoreBonus: differentNamedHasunosoraStageMembers.length * 2,
  };
}

function getMiraCreationContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly rightRurino: boolean;
  readonly leftHime: boolean;
  readonly centerMegu: boolean;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      sourceInLiveZone: false,
      rightRurino: false,
      leftHime: false,
      centerMegu: false,
      conditionMet: false,
    };
  }

  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const rightRurino = stageSlotHasMemberName(game, player.id, SlotPosition.RIGHT, '大沢瑠璃乃');
  const leftHime = stageSlotHasMemberName(game, player.id, SlotPosition.LEFT, '安養寺姫芽');
  const centerMegu = stageSlotHasMemberName(game, player.id, SlotPosition.CENTER, '藤島慈');
  return {
    sourceInLiveZone,
    rightRurino,
    leftHime,
    centerMegu,
    conditionMet: sourceInLiveZone && rightRurino && leftHime && centerMegu,
  };
}

function getEutopiaContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly liveZoneCardCount: number;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return { sourceInLiveZone: false, liveZoneCardCount: 0, conditionMet: false };
  }

  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const liveZoneCardCount = player.liveZone.cardIds.length;
  return {
    sourceInLiveZone,
    liveZoneCardCount,
    conditionMet: sourceInLiveZone && liveZoneCardCount >= 3,
  };
}

function getBokuraNoLiveKimiToNoLifeContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly museLiveCardIds: readonly string[];
  readonly museLiveCardCount: number;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      sourceInLiveZone: false,
      museLiveCardIds: [],
      museLiveCardCount: 0,
      conditionMet: false,
    };
  }

  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const museLiveCardIds = player.liveZone.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && cardBelongsToGroup(card.data, "μ's");
  });
  return {
    sourceInLiveZone,
    museLiveCardIds,
    museLiveCardCount: museLiveCardIds.length,
    conditionMet: sourceInLiveZone && museLiveCardIds.length >= 2,
  };
}

function getNatsuiroEgaoScoreContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly successLiveCount: number;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const successLiveCount = player?.successZone.cardIds.length ?? 0;
  return {
    sourceInLiveZone,
    successLiveCount,
    conditionMet: sourceInLiveZone && successLiveCount >= 2,
  };
}

function getPsychoHeartContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly hasPrintedScoreOne: boolean;
  readonly hasPrintedScoreFive: boolean;
  readonly scoreBonus: number;
} {
  const player = getPlayerById(game, ability.controllerId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const printedScores = sourceInLiveZone
    ? (player?.successZone.cardIds ?? []).flatMap((cardId) => {
        const card = getCardById(game, cardId);
        return card && isLiveCardData(card.data) ? [card.data.score] : [];
      })
    : [];
  const hasPrintedScoreOne = printedScores.includes(1);
  const hasPrintedScoreFive = printedScores.includes(5);
  return {
    sourceInLiveZone,
    hasPrintedScoreOne,
    hasPrintedScoreFive,
    scoreBonus: hasPrintedScoreOne && hasPrintedScoreFive ? 2 : hasPrintedScoreOne || hasPrintedScoreFive ? 1 : 0,
  };
}

function getMiracleStayTuneContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly ownSuccessZoneCount: number;
  readonly opponentSuccessZoneCount: number;
  readonly successZoneConditionMet: boolean;
  readonly differentNamedStageMembers: readonly {
    readonly cardId: string;
    readonly name: string;
  }[];
  readonly differentNameConditionMet: boolean;
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      sourceInLiveZone: false,
      ownSuccessZoneCount: 0,
      opponentSuccessZoneCount: 0,
      successZoneConditionMet: false,
      differentNamedStageMembers: [],
      differentNameConditionMet: false,
      conditionMet: false,
    };
  }

  const opponent = game.players.find((candidate) => candidate.id !== player.id) ?? null;
  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const ownSuccessZoneCount = player.successZone.cardIds.length;
  const opponentSuccessZoneCount = opponent?.successZone.cardIds.length ?? 0;
  const successZoneConditionMet = ownSuccessZoneCount >= 2 || opponentSuccessZoneCount >= 2;
  const differentNamedStageMembers = sourceInLiveZone
    ? getDifferentNamedStageMembers(game, player.id)
    : [];
  const differentNameConditionMet = differentNamedStageMembers.length >= 3;
  return {
    sourceInLiveZone,
    ownSuccessZoneCount,
    opponentSuccessZoneCount,
    successZoneConditionMet,
    differentNamedStageMembers,
    differentNameConditionMet,
    conditionMet: sourceInLiveZone && successZoneConditionMet && differentNameConditionMet,
  };
}

function getAuroraFlowerContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly matchingStageMembers: readonly {
    readonly cardId: string;
    readonly name: string;
    readonly effectiveCost: number;
  }[];
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      sourceInLiveZone: false,
      matchingStageMembers: [],
      conditionMet: false,
    };
  }

  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const matchingStageMembers = sourceInLiveZone
    ? getDifferentNamedAndEffectiveCostStageMembers(game, player.id)
    : [];
  return {
    sourceInLiveZone,
    matchingStageMembers,
    conditionMet: sourceInLiveZone && matchingStageMembers.length >= 3,
  };
}

function getNeutralContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly differentNamedKaleidoscoreStageMembers: readonly {
    readonly cardId: string;
    readonly name: string;
  }[];
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return {
      sourceInLiveZone: false,
      differentNamedKaleidoscoreStageMembers: [],
      conditionMet: false,
    };
  }
  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const isKaleidoscore = unitAliasIs('KALEIDOSCORE');
  const differentNamedKaleidoscoreStageMembers = selectDifferentNamedCards(
    getAllMemberCardIds(player.memberSlots),
    (cardId) => {
      const card = getCardById(game, cardId);
      return card &&
        card.ownerId === player.id &&
        isMemberCardData(card.data) &&
        isKaleidoscore(card)
        ? card.data
        : null;
    },
    { minCount: 1 }
  ).map((match) => ({ cardId: match.item, name: match.name }));
  return {
    sourceInLiveZone,
    differentNamedKaleidoscoreStageMembers,
    conditionMet: sourceInLiveZone && differentNamedKaleidoscoreStageMembers.length >= 2,
  };
}

function getGoRestartContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly ownSuccessZoneCount: number;
  readonly opponentSuccessZoneCount: number;
  readonly conditionMet: boolean;
  readonly scoreBonus: number;
} {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = game.players.find((candidate) => candidate.id !== ability.controllerId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const ownSuccessZoneCount = player?.successZone.cardIds.length ?? 0;
  const opponentSuccessZoneCount = opponent?.successZone.cardIds.length ?? 0;
  const conditionMet = sourceInLiveZone && ownSuccessZoneCount < opponentSuccessZoneCount;
  return {
    sourceInLiveZone,
    ownSuccessZoneCount,
    opponentSuccessZoneCount,
    conditionMet,
    scoreBonus: conditionMet ? 1 : 0,
  };
}

function consumePendingAbility(game: GameState, ability: PendingAbilityState): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
}

function isNijigasakiMember(game: GameState, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return card !== null && isMemberCardData(card.data) && cardBelongsToGroup(card.data, '虹ヶ咲');
}

function getDifferentNamedStageMembers(
  game: GameState,
  playerId: string
): readonly { readonly cardId: string; readonly name: string }[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return selectDifferentNamedCards(
    getAllMemberCardIds(player.memberSlots),
    (cardId) => {
      const card = getCardById(game, cardId);
      return card && isMemberCardData(card.data) ? card.data : null;
    },
    { minCount: 1 }
  ).map((match) => ({ cardId: match.item, name: match.name }));
}

function stageSlotHasMemberName(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  name: string
): boolean {
  const player = getPlayerById(game, playerId);
  const cardId = player?.memberSlots.slots[slot] ?? null;
  const card = cardId ? getCardById(game, cardId) : null;
  return card !== null && isMemberCardData(card.data) && cardNameAliasIs(name)(card);
}

function getDifferentNamedAndEffectiveCostStageMembers(
  game: GameState,
  playerId: string
): readonly { readonly cardId: string; readonly name: string; readonly effectiveCost: number }[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return selectDifferentNamedCards(
    getAllMemberCardIds(player.memberSlots),
    (cardId) => {
      const card = getCardById(game, cardId);
      return card && isMemberCardData(card.data) ? card.data : null;
    },
    {
      minCount: 1,
      getSecondaryKey: (cardId) => getMemberEffectiveCost(game, playerId, cardId),
    }
  ).map((match) => ({
    cardId: match.item,
    name: match.name,
    effectiveCost: getMemberEffectiveCost(game, playerId, match.item),
  }));
}

function getUniqueNormalEffectiveHeartColors(
  game: GameState,
  playerId: string,
  memberCardIds: readonly string[]
): readonly HeartColor[] {
  const modifiers = collectLiveModifiers(game);
  const colors = new Set<HeartColor>();
  for (const memberCardId of memberCardIds) {
    for (const heart of getMemberEffectiveHeartIcons(game, playerId, memberCardId, modifiers)) {
      if (NORMAL_HEART_COLORS.includes(heart.color)) {
        colors.add(heart.color);
      }
    }
  }
  return NORMAL_HEART_COLORS.filter((color) => colors.has(color));
}

function addScoreModifierAndRefresh(
  game: GameState,
  options: {
    readonly playerId: string;
    readonly sourceCardId: string;
    readonly abilityId: string;
    readonly scoreBonus: number;
  }
): GameState {
  const modifier: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = {
    kind: 'SCORE',
    playerId: options.playerId,
    countDelta: options.scoreBonus,
    liveCardId: options.sourceCardId,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
  };
  return refreshPlayerScoreDraft(
    addLiveModifier(game, modifier),
    options.playerId,
    options.scoreBonus
  );
}

function replaceScoreModifierAndRefresh(
  game: GameState,
  options: { readonly playerId: string; readonly sourceCardId: string; readonly abilityId: string; readonly scoreBonus: number }
): GameState {
  const previous = game.liveResolution.liveModifiers
    .filter((modifier) => modifier.kind === 'SCORE' && modifier.playerId === options.playerId && modifier.liveCardId === options.sourceCardId && modifier.sourceCardId === options.sourceCardId && modifier.abilityId === options.abilityId)
    .reduce((sum, modifier) => sum + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
  const replacement: Extract<LiveModifierState, { readonly kind: 'SCORE' }> | null = options.scoreBonus > 0 ? {
    kind: 'SCORE', playerId: options.playerId, countDelta: options.scoreBonus,
    liveCardId: options.sourceCardId, sourceCardId: options.sourceCardId, abilityId: options.abilityId,
  } : null;
  const state = replaceLiveModifier(game, { kind: 'SCORE', playerId: options.playerId, liveCardId: options.sourceCardId, sourceCardId: options.sourceCardId, abilityId: options.abilityId }, replacement);
  return refreshPlayerScoreDraft(state, options.playerId, options.scoreBonus - previous);
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
