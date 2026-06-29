import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getFirstPlayer,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, hasScoreBladeHeart, typeIs } from '../../../effects/card-selectors.js';
import { selectRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { SP_BP5_023_LIVE_SUCCESS_SUCCESS_ZONE_TWO_SCORE_CHEER_THIS_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { maybeStartManualPendingAbilityConfirmation } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5023ShootingVoiceWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP5_023_LIVE_SUCCESS_SUCCESS_ZONE_TWO_SCORE_CHEER_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options);
      if (manualConfirmation) {
        return manualConfirmation;
      }
      return resolveSpBp5023ShootingVoiceLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function resolveSpBp5023ShootingVoiceLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const ownSuccessLiveCount = player.successZone.cardIds.length;
  const opponent = game.players.find((candidate) => candidate.id !== player.id) ?? null;
  const opponentSuccessLiveCount = opponent?.successZone.cardIds.length ?? 0;
  const successZoneConditionMet = ownSuccessLiveCount >= 2 || opponentSuccessLiveCount >= 2;
  const scoreCheerLiveCardIds = selectScoreLiveRevealedCheerCardIds(game, player.id);
  const sourceIsCurrentLive = player.liveZone.cardIds.includes(ability.sourceCardId);
  const conditionMet =
    sourceIsCurrentLive && successZoneConditionMet && scoreCheerLiveCardIds.length > 0;
  const scoreBonus = conditionMet ? 2 : 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterModifier = conditionMet
    ? addLiveModifier(stateWithoutPending, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: scoreBonus,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : stateWithoutPending;
  const stateAfterScoreRefresh = conditionMet
    ? refreshPlayerScoreDraft(stateAfterModifier, player.id, scoreBonus)
    : stateAfterModifier;

  return continuePendingCardEffects(
    addAction(stateAfterScoreRefresh, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'SUCCESS_ZONE_TWO_SCORE_CHEER_THIS_LIVE_SCORE' : 'CONDITION_NOT_MET',
      sourceIsCurrentLive,
      ownSuccessLiveCount,
      opponentSuccessLiveCount,
      successZoneConditionMet,
      scoreCheerLiveCardIds,
      conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function selectScoreLiveRevealedCheerCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const firstPlayer = getFirstPlayer(game);
  const ownCheerCardIds =
    player.id === firstPlayer.id
      ? game.liveResolution.firstPlayerCheerCardIds
      : game.liveResolution.secondPlayerCheerCardIds;
  const isScoreLive = and(typeIs(CardType.LIVE), hasScoreBladeHeart());
  return selectRevealedCheerCardIds(game, player.id, (card) => {
    if (!ownCheerCardIds.includes(card.instanceId) || !isLiveCardData(card.data)) {
      return false;
    }
    return isScoreLive(card);
  });
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
