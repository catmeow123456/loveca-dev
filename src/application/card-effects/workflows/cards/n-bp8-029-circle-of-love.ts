import {
  addAction,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import {
  getRemainingHeartCount,
  getRemainingHeartTotalCount,
} from '../../../effects/remaining-hearts.js';
import { N_BP8_029_LIVE_SUCCESS_RED_REMAINING_HEART_SCORE_CLEAR_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { clearRemainingHeartsForPlayer } from '../../runtime/actions.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { replaceSourceLiveCardScoreModifierAndRefresh } from '../../runtime/live-card-score.js';
import { isCurrentLiveCardAbilitySource } from '../../runtime/source-live.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

function getContext(game: GameState, ability: PendingAbilityState) {
  const redCount = getRemainingHeartCount(game, ability.controllerId, HeartColor.RED);
  const totalCount = getRemainingHeartTotalCount(game, ability.controllerId);
  const sourceCurrent = isCurrentLiveCardAbilitySource(game, {
    ...ability,
    sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
  });
  return {
    redCount,
    totalCount,
    sourceCurrent,
    scoreBonus: sourceCurrent ? Math.min(3, Math.floor(redCount / 2)) : 0,
  };
}

export function registerNBp8029CircleOfLoveWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY_ID,
    (game, ability, options, runtime) => {
      const evaluation = getContext(game, ability);
      // The two instructions are sequential within one ability; no check timing in between.
      const scored =
        evaluation.scoreBonus > 0
          ? replaceSourceLiveCardScoreModifierAndRefresh(game, ability, evaluation.scoreBonus)
          : game;
      const cleared = clearRemainingHeartsForPlayer(scored, ability.controllerId);
      const state = {
        ...cleared.gameState,
        pendingAbilities: cleared.gameState.pendingAbilities.filter(
          (item) => item.id !== ability.id
        ),
      };
      return runtime.continuePendingCardEffects(
        addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
          pendingAbilityId: ability.id,
          abilityId: ABILITY_ID,
          sourceCardId: ability.sourceCardId,
          step: 'RED_REMAINING_HEART_SCORE_THEN_LOSE_ALL',
          ...evaluation,
          lostHearts: cleared.lostHearts,
          lostTotalCount: cleared.lostTotalCount,
        }),
        options.orderedResolution === true
      );
    },
    (game, ability) => {
      const evaluation = getContext(game, ability);
      return {
        effectText: `${getAbilityEffectText(ABILITY_ID)}（当前剩余红色HEART ${evaluation.redCount}个，实际分数＋${evaluation.scoreBonus}；随后失去全部${evaluation.totalCount}个剩余HEART。）`,
      };
    }
  );
}
