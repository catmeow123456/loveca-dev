import { isMemberCardData } from '../../../../domain/entities/card.js';
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
} from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { normalizeCardName } from '../../../effects/card-selectors.js';
import {
  PL_N_BP1_027_LIVE_START_NIJIGASAKI_STAGE_HEART_COLORS_THIS_LIVE_SCORE_ABILITY_ID,
  PL_N_BP1_029_LIVE_START_LIVE_ZONE_THREE_THIS_LIVE_SCORE_ABILITY_ID,
  PL_N_BP5_027_LIVE_START_SUCCESS_ZONE_TWO_DIFFERENT_NAMES_THIS_LIVE_SCORE_ABILITY_ID,
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

function getMiracleStayTuneContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceInLiveZone: boolean;
  readonly ownSuccessZoneCount: number;
  readonly opponentSuccessZoneCount: number;
  readonly successZoneConditionMet: boolean;
  readonly differentNamedStageMembers: readonly { readonly cardId: string; readonly name: string }[];
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

  const seenNames = new Set<string>();
  const members: { readonly cardId: string; readonly name: string }[] = [];
  for (const cardId of getAllMemberCardIds(player.memberSlots)) {
    const card = getCardById(game, cardId);
    if (!card || !isMemberCardData(card.data)) {
      continue;
    }
    const normalizedName = normalizeCardName(card.data.name);
    if (!normalizedName || seenNames.has(normalizedName)) {
      continue;
    }
    seenNames.add(normalizedName);
    members.push({ cardId, name: card.data.name });
  }
  return members;
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
