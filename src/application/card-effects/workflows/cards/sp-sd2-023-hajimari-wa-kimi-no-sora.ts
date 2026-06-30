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
import { SP_SD2_023_LIVE_START_SUCCESS_ZONE_TWO_SCORE_AND_SET_REQUIREMENT_ABILITY_ID } from '../../ability-ids.js';
import { registerManualConfirmablePendingAbilityStarterHandler } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const SCORE_BONUS = 5;
const REQUIREMENT_MODIFIERS: readonly LiveRequirementModifierState[] = [
  { color: HeartColor.RED, countDelta: 3 },
  { color: HeartColor.YELLOW, countDelta: 2 },
  { color: HeartColor.PURPLE, countDelta: 3 },
  { color: HeartColor.RAINBOW, countDelta: 1 },
];

export function registerSpSd2023HajimariWaKimiNoSoraWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_SD2_023_LIVE_START_SUCCESS_ZONE_TWO_SCORE_AND_SET_REQUIREMENT_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpSd2023HajimariWaKimiNoSoraLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    (game, ability) => {
      const player = getPlayerById(game, ability.controllerId);
      const ownSuccessLiveCount = player?.successZone.cardIds.length ?? 0;
      const conditionMet = ownSuccessLiveCount >= 2;
      return {
        stepText: conditionMet
          ? `自己的成功LIVE区有 ${ownSuccessLiveCount} 张卡，条件满足。确认后此 LIVE 分数 +5，并变更必要 Heart。`
          : `自己的成功LIVE区有 ${ownSuccessLiveCount} 张卡，条件不满足。确认后不变更分数或必要 Heart。`,
      };
    }
  );
}

function resolveSpSd2023HajimariWaKimiNoSoraLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const liveCard = getCardById(game, ability.sourceCardId);
  if (!player || !liveCard || !isLiveCardData(liveCard.data)) {
    return game;
  }

  const ownSuccessLiveCount = player.successZone.cardIds.length;
  const conditionMet = ownSuccessLiveCount >= 2;
  const adjustedRequirement = conditionMet
    ? applyHeartRequirementModifiers(liveCard.data.requirements, REQUIREMENT_MODIFIERS)
    : liveCard.data.requirements;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterRequirement = replaceLiveModifier(
    stateWithoutPending,
    {
      kind: 'REQUIREMENT',
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    },
    conditionMet
      ? {
          kind: 'REQUIREMENT',
          liveCardId: ability.sourceCardId,
          modifiers: REQUIREMENT_MODIFIERS,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }
      : null
  );
  const stateAfterScore = conditionMet
    ? addLiveModifier(stateAfterRequirement, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: SCORE_BONUS,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : stateAfterRequirement;
  const stateAfterScoreRefresh = conditionMet
    ? refreshPlayerScoreDraft(stateAfterScore, player.id, SCORE_BONUS)
    : stateAfterScore;

  return continuePendingCardEffects(
    addAction(stateAfterScoreRefresh, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'SUCCESS_ZONE_TWO_SCORE_AND_SET_REQUIREMENT' : 'CONDITION_NOT_MET',
      ownSuccessLiveCount,
      conditionMet,
      scoreBonus: conditionMet ? SCORE_BONUS : 0,
      requirementModifiers: conditionMet ? REQUIREMENT_MODIFIERS : [],
      adjustedTotalRequired: adjustedRequirement.totalRequired,
      adjustedColorRequirements: Object.fromEntries(adjustedRequirement.colorRequirements),
    }),
    orderedResolution
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
