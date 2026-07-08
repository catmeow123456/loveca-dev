import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { hasStageMemberMatching } from '../../../effects/conditions.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import { HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp1023DododoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getHsBp1023DododoConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveHsBp1023DododoLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function getHsBp1023DododoConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = game.players.find((candidate) => candidate.id !== ability.controllerId);
  const ownScore = player ? (game.liveResolution.playerScores.get(player.id) ?? 0) : 0;
  const opponentScore = opponent ? (game.liveResolution.playerScores.get(opponent.id) ?? 0) : 0;
  const hasHasunosoraStageMember = player
    ? hasStageMemberMatching(game, player.id, groupAliasIs('蓮ノ空'))
    : false;
  const conditionMet = ownScore > opponentScore && hasHasunosoraStageMember;
  return `${getAbilityEffectText(ability.abilityId)}（自己分数 ${ownScore}，对方分数 ${opponentScore}，${hasHasunosoraStageMember ? '舞台有莲之空成员' : '舞台无莲之空成员'}，${conditionMet ? '满足条件，放置1张等待能量' : '未满足条件'}）`;
}

function resolveHsBp1023DododoLiveSuccess(
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

  const ownScore = game.liveResolution.playerScores.get(player.id) ?? 0;
  const opponentScore = opponent ? (game.liveResolution.playerScores.get(opponent.id) ?? 0) : 0;
  const hasHasunosoraStageMember = hasStageMemberMatching(game, player.id, groupAliasIs('蓮ノ空'));
  const conditionMet = ownScore > opponentScore && hasHasunosoraStageMember;
  const energyPlacement = conditionMet
    ? placeEnergyFromDeckToZoneByCardEffect(game, player.id, 1, OrientationState.WAITING, {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      })
    : null;
  const stateAfterPlacement = energyPlacement?.gameState ?? game;
  const state = {
    ...stateAfterPlacement,
    pendingAbilities: stateAfterPlacement.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'PLACE_WAITING_ENERGY_IF_HIGHER_SCORE_HASUNOSORA_MEMBER',
      ownScore,
      opponentScore,
      hasHasunosoraStageMember,
      conditionMet,
      placedEnergyCardIds: energyPlacement?.placedEnergyCardIds ?? [],
    }),
    orderedResolution
  );
}
