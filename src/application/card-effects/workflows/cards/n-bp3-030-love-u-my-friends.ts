import {
  addAction,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { hasAllBladeHeart } from '../../../effects/card-selectors.js';
import { selectRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { PL_N_BP3_030_LIVE_SUCCESS_CHEER_ALL_BLADE_THIS_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { maybeStartConfirmablePendingAbilityConfirmation } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const SCORE_BONUS = 1;

export function registerNLiveSuccessCheerAllBladeScoreWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP3_030_LIVE_SUCCESS_CHEER_ALL_BLADE_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options);
      if (confirmation) {
        return confirmation;
      }
      return resolveNLiveSuccessCheerAllBladeScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function resolveNLiveSuccessCheerAllBladeScore(
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
  const sourceInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const allBladeCheerCardIds = sourceInLiveZone
    ? selectRevealedCheerCardIds(stateWithoutPending, player.id, hasAllBladeHeart())
    : [];
  const conditionMet = allBladeCheerCardIds.length > 0;
  const stateAfterScore = conditionMet
    ? addScoreModifierAndRefresh(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        scoreBonus: SCORE_BONUS,
      })
    : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet ? 'CHEER_ALL_BLADE_THIS_LIVE_SCORE' : 'NO_CHEER_ALL_BLADE',
      sourceInLiveZone,
      allBladeCheerCardIds,
      conditionMet,
      scoreBonus: conditionMet ? SCORE_BONUS : 0,
    }),
    orderedResolution
  );
}

function consumePendingAbility(game: GameState, ability: PendingAbilityState): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
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
