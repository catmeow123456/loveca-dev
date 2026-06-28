import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { getRemainingHeartTotalCount } from '../../../effects/remaining-hearts.js';
import { S_BP5_020_LIVE_SUCCESS_LOSE_REMAINING_HEARTS_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { clearRemainingHeartsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { maybeStartManualPendingAbilityConfirmation } from '../../runtime/workflow-helpers.js';

const SCORE_BONUS = 1;
const REQUIRED_REMAINING_HEART_TOTAL = 3;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp5020LandingActionYeahWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_BP5_020_LIVE_SUCCESS_LOSE_REMAINING_HEARTS_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options);
      if (manualConfirmation) {
        return manualConfirmation;
      }
      return resolveSBp5020LandingActionYeahLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function resolveSBp5020LandingActionYeahLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const remainingHeartTotalCount = getRemainingHeartTotalCount(game, player.id);
  const conditionMet = remainingHeartTotalCount >= REQUIRED_REMAINING_HEART_TOTAL;
  const clearResult = conditionMet ? clearRemainingHeartsForPlayer(game, player.id) : null;
  const stateAfterLostHearts = clearResult?.gameState ?? game;
  const stateAfterModifier = conditionMet
    ? addLiveModifier(stateAfterLostHearts, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: SCORE_BONUS,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : stateAfterLostHearts;
  const stateAfterScoreRefresh = conditionMet
    ? refreshPlayerScoreDraft(stateAfterModifier, player.id, SCORE_BONUS)
    : stateAfterModifier;
  const state = {
    ...stateAfterScoreRefresh,
    pendingAbilities: stateAfterScoreRefresh.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LOSE_REMAINING_HEARTS_THIS_LIVE_SCORE',
      conditionMet,
      remainingHeartTotalCount,
      lostHearts: clearResult?.lostHearts ?? [],
      lostTotalCount: clearResult?.lostTotalCount ?? 0,
      scoreBonus: conditionMet ? SCORE_BONUS : 0,
    }),
    orderedResolution
  );
}

function refreshPlayerScoreDraft(
  game: GameState,
  playerId: string,
  scoreBonus: number
): GameState {
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
