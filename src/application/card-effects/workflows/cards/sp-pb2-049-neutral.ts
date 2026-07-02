import {
  addAction,
  getCardById,
  getFirstPlayer,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import {
  SP_PB2_049_LIVE_SUCCESS_CHEER_KALEIDOSCORE_FIVE_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_PB2_049_LIVE_SUCCESS_ENERGY_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../ability-ids.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2049NeutralWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_049_LIVE_SUCCESS_CHEER_KALEIDOSCORE_FIVE_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getCheerKaleidoscoreConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveCheerKaleidoscorePlaceWaitingEnergy(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
  registerPendingAbilityStarterHandler(
    SP_PB2_049_LIVE_SUCCESS_ENERGY_ELEVEN_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getEnergyElevenConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveEnergyElevenThisLiveScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function getCheerKaleidoscoreConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const kaleidoscoreCheerCount = player
    ? getOwnCheerRevealedKaleidoscoreCardIds(game, player.id).length
    : 0;
  const conditionMet = kaleidoscoreCheerCount >= 5;
  return `${getAbilityEffectText(ability.abilityId)}（当前KALEIDOSCORE声援 ${kaleidoscoreCheerCount}张，${
    conditionMet ? '满足条件' : '未满足条件'
  }）`;
}

function getEnergyElevenConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const energyCount = player?.energyZone.cardIds.length ?? 0;
  const conditionMet = energyCount >= 11;
  return `${getAbilityEffectText(ability.abilityId)}（当前能量 ${energyCount}张，${
    conditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'
  }）`;
}

function resolveCheerKaleidoscorePlaceWaitingEnergy(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const kaleidoscoreCheerCardIds = getOwnCheerRevealedKaleidoscoreCardIds(game, player.id);
  const conditionMet = kaleidoscoreCheerCardIds.length >= 5;
  const energyResult = conditionMet
    ? placeEnergyFromDeckToZone(game, player.id, 1, OrientationState.WAITING)
    : null;
  const stateAfterEffect = energyResult?.gameState ?? game;
  const stateWithoutPending: GameState = {
    ...stateAfterEffect,
    pendingAbilities: stateAfterEffect.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'CHEER_KALEIDOSCORE_FIVE_PLACE_WAITING_ENERGY',
      kaleidoscoreCheerCardIds,
      kaleidoscoreCheerCardCount: kaleidoscoreCheerCardIds.length,
      conditionMet,
      placedEnergyCardIds: energyResult?.placedEnergyCardIds ?? [],
    }),
    orderedResolution
  );
}

function resolveEnergyElevenThisLiveScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const energyCount = player.energyZone.cardIds.length;
  const conditionMet = energyCount >= 11;
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
  const stateWithoutPending: GameState = {
    ...stateAfterScoreRefresh,
    pendingAbilities: stateAfterScoreRefresh.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ENERGY_ELEVEN_THIS_LIVE_SCORE',
      energyCount,
      conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function getOwnCheerRevealedKaleidoscoreCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const firstPlayer = getFirstPlayer(game);
  const cheerCardIds =
    player.id === firstPlayer.id
      ? game.liveResolution.firstPlayerCheerCardIds
      : game.liveResolution.secondPlayerCheerCardIds;
  const isKaleidoscore = unitAliasIs('KALEIDOSCORE');

  return cheerCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && isKaleidoscore(card);
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
