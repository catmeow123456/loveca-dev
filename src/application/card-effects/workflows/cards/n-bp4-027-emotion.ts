import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveRequirementModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier, replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { applyHeartRequirementModifiers } from '../../../../domain/rules/live-requirement-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { normalizeCardName } from '../../../effects/card-selectors.js';
import { PL_N_BP4_027_LIVE_START_SUCCESS_EMOTION_SCORE_REQUIREMENT_ABILITY_ID } from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const EMOTION_CARD_NAME = 'EMOTION';
const SCORE_BONUS_PER_SUCCESS = 2;
const RAINBOW_REQUIREMENT_DELTA_PER_SUCCESS = 3;

export function registerNBp4027EmotionWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_N_BP4_027_LIVE_START_SUCCESS_EMOTION_SCORE_REQUIREMENT_ABILITY_ID,
    (game, ability, options, context) =>
      resolveEmotionLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    (game, ability) => {
      const context = getEmotionContext(game, ability);
      return {
        effectText: `${getAbilityEffectText(ability.abilityId)}（当前成功LIVE卡区「EMOTION」${context.successEmotionCount}张，分数+${context.scoreBonus}，必要[無ハート]+${context.requirementIncrease}。）`,
        stepText:
          context.sourceInLiveZone && context.successEmotionCount > 0
            ? `确认后此 LIVE 分数 +${context.scoreBonus}，必要[無ハート] +${context.requirementIncrease}。`
            : '确认后不增加分数或必要Heart，并结算此效果。',
      };
    }
  );
}

function resolveEmotionLiveStart(
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
  const context = getEmotionContext(stateWithoutPending, ability);
  const liveCard = getCardById(stateWithoutPending, ability.sourceCardId);
  const canApply = context.sourceInLiveZone && liveCard !== null && isLiveCardData(liveCard.data);
  const requirementModifiers: readonly LiveRequirementModifierState[] =
    canApply && context.requirementIncrease > 0
      ? [{ color: HeartColor.RAINBOW, countDelta: context.requirementIncrease }]
      : [];
  const adjustedRequirement =
    canApply && isLiveCardData(liveCard!.data)
      ? applyHeartRequirementModifiers(liveCard!.data.requirements, requirementModifiers)
      : null;
  const stateAfterRequirement = replaceLiveModifier(
    stateWithoutPending,
    {
      kind: 'REQUIREMENT',
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    },
    requirementModifiers.length > 0
      ? {
          kind: 'REQUIREMENT',
          liveCardId: ability.sourceCardId,
          modifiers: requirementModifiers,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }
      : null
  );
  const stateAfterScore =
    canApply && context.scoreBonus > 0
      ? refreshPlayerScoreDraft(
          addLiveModifier(stateAfterRequirement, {
            kind: 'SCORE',
            playerId: player.id,
            countDelta: context.scoreBonus,
            liveCardId: ability.sourceCardId,
            sourceCardId: ability.sourceCardId,
            abilityId: ability.abilityId,
          }),
          player.id,
          context.scoreBonus
        )
      : stateAfterRequirement;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: canApply && context.successEmotionCount > 0 ? 'SUCCESS_EMOTION_MODIFIER' : 'NO_MODIFIER',
      sourceInLiveZone: context.sourceInLiveZone,
      successEmotionCount: context.successEmotionCount,
      scoreBonus: canApply ? context.scoreBonus : 0,
      requirementModifiers,
      adjustedTotalRequired: adjustedRequirement?.totalRequired,
      adjustedColorRequirements: adjustedRequirement
        ? Object.fromEntries(adjustedRequirement.colorRequirements)
        : undefined,
    }),
    orderedResolution
  );
}

function getEmotionContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceInLiveZone: boolean;
  readonly successEmotionCount: number;
  readonly scoreBonus: number;
  readonly requirementIncrease: number;
} {
  const player = getPlayerById(game, ability.controllerId);
  const normalizedEmotionName = normalizeCardName(EMOTION_CARD_NAME);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const successEmotionCount =
    player?.successZone.cardIds.filter((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && normalizeCardName(card.data.name) === normalizedEmotionName;
    }).length ?? 0;
  return {
    sourceInLiveZone,
    successEmotionCount,
    scoreBonus: successEmotionCount * SCORE_BONUS_PER_SUCCESS,
    requirementIncrease: successEmotionCount * RAINBOW_REQUIREMENT_DELTA_PER_SUCCESS,
  };
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

function consumePendingAbility(game: GameState, ability: Pick<PendingAbilityState, 'id'>): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
}
