import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp2024VitaminSummerWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpBp2024VitaminSummerLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpBp2024VitaminSummerLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = game.players.find((candidate) => candidate.id !== ability.controllerId);
  if (!player) {
    return game;
  }

  const ownHandCount = player.hand.cardIds.length;
  const opponentHandCount = opponent?.hand.cardIds.length ?? 0;
  const conditionMet = ownHandCount > opponentHandCount;
  const scoreBonus = conditionMet ? 1 : 0;
  const stateAfterModifier = conditionMet
    ? addLiveModifier(game, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: scoreBonus,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : game;
  const stateAfterScoreRefresh = conditionMet
    ? refreshPlayerScoreDraft(stateAfterModifier, player.id, scoreBonus)
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
      step: 'LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE',
      ownHandCount,
      opponentHandCount,
      conditionMet,
      scoreBonus,
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
