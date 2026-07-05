import { isLiveCardData, type HeartRequirement } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updateLiveResolution,
  type GameState,
  type LiveModifierState,
  type LiveRequirementModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import {
  addLiveModifier,
  getLiveCardRequirementModifiers,
  getMemberEffectiveHeartIcons,
} from '../../../../domain/rules/live-modifiers.js';
import { applyHeartRequirementModifiers } from '../../../../domain/rules/live-requirement-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { N_BP5_028_LIVE_START_RED_HEART_MEMBER_THIS_LIVE_SCORE_REQUIREMENT_ABILITY_ID } from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const SCORE_BONUS = 2;
const TARGET_RED_REQUIREMENT_COUNT = 5;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5028ChaseWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    N_BP5_028_LIVE_START_RED_HEART_MEMBER_THIS_LIVE_SCORE_REQUIREMENT_ABILITY_ID,
    (game, ability, options, context) =>
      resolveChaseLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getChaseLiveStartConfirmationConfig
  );
}

function getChaseLiveStartConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const context = getChaseLiveStartContext(game, ability);
  const previewText = getChaseLiveStartPreviewText(context);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
    stepText: previewText,
  };
}

function resolveChaseLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getChaseLiveStartContext(game, ability);
  let state = removePendingAbility(game, ability.id);
  if (context.conditionMet) {
    state = addScoreModifierAndRefresh(state, {
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      scoreBonus: SCORE_BONUS,
    });
    state = addLiveModifier(state, {
      kind: 'REQUIREMENT',
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      modifiers: context.requirementModifiers,
    });
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: context.conditionMet ? 'RED_HEART_MEMBER_SCORE_AND_REQUIREMENT' : context.noOpStep,
      sourceInLiveZone: context.sourceInLiveZone,
      maxRedHeartCount: context.maxRedHeartCount,
      scoreBonus: context.conditionMet ? SCORE_BONUS : 0,
      requirementModifiers: context.conditionMet ? context.requirementModifiers : [],
    }),
    orderedResolution
  );
}

function getChaseLiveStartContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceInLiveZone: boolean;
  readonly maxRedHeartCount: number;
  readonly conditionMet: boolean;
  readonly requirementModifiers: readonly LiveRequirementModifierState[];
  readonly noOpStep: string;
} {
  const sourceInLiveZone = isSourceLiveCardInOwnLiveZone(game, ability.controllerId, ability.sourceCardId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  const maxRedHeartCount = getOwnStageMaxRedHeartCount(game, ability.controllerId);
  const conditionMet = sourceInLiveZone && maxRedHeartCount >= 4;
  const currentRequirement =
    sourceCard && isLiveCardData(sourceCard.data)
      ? applyHeartRequirementModifiers(
          sourceCard.data.requirements,
          getLiveCardRequirementModifiers(game.liveResolution, ability.sourceCardId)
        )
      : null;
  return {
    sourceInLiveZone,
    maxRedHeartCount,
    conditionMet,
    requirementModifiers:
      conditionMet && currentRequirement
        ? createRequirementModifiersToExactlyFiveRed(currentRequirement)
        : [],
    noOpStep: !sourceInLiveZone ? 'SOURCE_NOT_IN_LIVE_ZONE' : 'NO_MEMBER_WITH_FOUR_RED_HEARTS',
  };
}

function getOwnStageMaxRedHeartCount(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }

  return getAllMemberCardIds(player.memberSlots).reduce((max, memberCardId) => {
    const redCount = getMemberEffectiveHeartIcons(game, player.id, memberCardId)
      .filter((heart) => heart.color === HeartColor.RED)
      .reduce((total, heart) => total + heart.count, 0);
    return Math.max(max, redCount);
  }, 0);
}

function getChaseLiveStartPreviewText(
  context: ReturnType<typeof getChaseLiveStartContext>
): string {
  if (!context.sourceInLiveZone) {
    return '此LIVE已不在LIVE区，不增加分数，也不改变必要Heart。';
  }
  if (!context.conditionMet) {
    return `当前舞台成员最多持有${context.maxRedHeartCount}个[赤ハート]，未达到4个以上。不增加分数，也不改变必要Heart。`;
  }
  return `当前舞台成员最多持有${context.maxRedHeartCount}个[赤ハート]，已达到4个以上。此LIVE分数+${SCORE_BONUS}，必要Heart变为${TARGET_RED_REQUIREMENT_COUNT}个[赤ハート]。`;
}

function createRequirementModifiersToExactlyFiveRed(
  requirement: HeartRequirement
): readonly LiveRequirementModifierState[] {
  const modifiers: LiveRequirementModifierState[] = [];
  for (const [color, count] of requirement.colorRequirements) {
    if (count <= 0) {
      continue;
    }
    if (color === HeartColor.RED) {
      continue;
    }
    modifiers.push({ color, countDelta: -count });
  }

  const currentRed = requirement.colorRequirements.get(HeartColor.RED) ?? 0;
  const redDelta = TARGET_RED_REQUIREMENT_COUNT - currentRed;
  if (redDelta !== 0) {
    modifiers.push({ color: HeartColor.RED, countDelta: redDelta });
  }
  return modifiers;
}

function isSourceLiveCardInOwnLiveZone(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    player?.liveZone.cardIds.includes(sourceCardId) === true &&
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    sourceCard.data.cardType === CardType.LIVE
  );
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
  return updateLiveResolution(addLiveModifier(game, modifier), (liveResolution) => {
    const playerScores = new Map(liveResolution.playerScores);
    playerScores.set(options.playerId, (playerScores.get(options.playerId) ?? 0) + options.scoreBonus);
    return { ...liveResolution, playerScores };
  });
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}
