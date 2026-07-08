import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, hasBladeHeart, not, typeIs } from '../../../effects/card-selectors.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { SP_PB2_008_LIVE_SUCCESS_CHEER_NO_BLADE_HEART_LIELLA_MEMBER_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2008ShikiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_008_LIVE_SUCCESS_CHEER_NO_BLADE_HEART_LIELLA_MEMBER_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getSpPb2008ShikiConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveSpPb2008ShikiLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function getSpPb2008ShikiConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const qualifyingCheerMemberIds = getOwnCheerNoBladeHeartLiellaMemberIds(
    game,
    ability.controllerId
  );
  const scoreBonus = Math.min(2, Math.floor(qualifyingCheerMemberIds.length / 2));
  return `${getAbilityEffectText(ability.abilityId)}（符合条件的声援成员 ${qualifyingCheerMemberIds.length}张，分数+${scoreBonus}）`;
}

function resolveSpPb2008ShikiLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const qualifyingCheerMemberIds = getOwnCheerNoBladeHeartLiellaMemberIds(game, player.id);
  const scoreBonus = Math.min(2, Math.floor(qualifyingCheerMemberIds.length / 2));
  const stateAfterModifier =
    scoreBonus > 0
      ? addLiveModifier(game, {
          kind: 'SCORE',
          playerId: player.id,
          countDelta: scoreBonus,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        })
      : game;
  const stateAfterScoreRefresh =
    scoreBonus > 0 ? refreshPlayerScoreDraft(stateAfterModifier, player.id, scoreBonus) : stateAfterModifier;
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
      step: 'CHEER_NO_BLADE_HEART_LIELLA_MEMBER_SCORE',
      qualifyingCheerMemberIds,
      qualifyingCheerMemberCount: qualifyingCheerMemberIds.length,
      scoreBonus,
    }),
    orderedResolution
  );
}

function getOwnCheerNoBladeHeartLiellaMemberIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const isNoBladeHeartLiellaMember = and(
    typeIs(CardType.MEMBER),
    groupAliasIs('Liella!'),
    not(hasBladeHeart())
  );

  return selectCurrentLiveRevealedCheerCardIds(game, playerId, {
    cardTypes: CardType.MEMBER,
    groupAliases: ['Liella!'],
    predicate: isNoBladeHeartLiellaMember,
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
