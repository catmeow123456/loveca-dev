import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, HeartColor } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { hasStageMemberMatching } from '../../../effects/conditions.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import {
  getRemainingHeartCount,
  getRemainingHeartTotalCount,
  hasRemainingHeartColor,
  rebalanceRemainingHeartColorForPlayer,
} from '../../../effects/remaining-hearts.js';
import { PL_N_BP3_027_LIVE_SUCCESS_GREEN_SURPLUS_NIJIGASAKI_MEMBER_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp3027LaBellaPatriaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP3_027_LIVE_SUCCESS_GREEN_SURPLUS_NIJIGASAKI_MEMBER_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getNBp3027LaBellaPatriaConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveNBp3027LaBellaPatriaLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function getNBp3027LaBellaPatriaConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const hasNijigasakiStageMember = player
    ? hasStageMemberMatching(game, player.id, groupAliasIs('虹ヶ咲'))
    : false;
  const stateAfterRebalance =
    player && hasNijigasakiStageMember
      ? rebalanceRemainingHeartColorForPlayer(game, player.id, HeartColor.GREEN, 1).gameState
      : game;
  const hasGreenRemainingHeart =
    player !== null &&
    hasRemainingHeartColor(stateAfterRebalance, player.id, HeartColor.GREEN, 1);
  const conditionMet = hasGreenRemainingHeart && hasNijigasakiStageMember;
  return `${getAbilityEffectText(ability.abilityId)}（${hasGreenRemainingHeart ? '有绿色余Heart' : '无绿色余Heart'}，${hasNijigasakiStageMember ? '舞台有虹咲成员' : '舞台无虹咲成员'}，${conditionMet ? '满足条件，放置1张等待能量' : '未满足条件'}）`;
}

function resolveNBp3027LaBellaPatriaLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const hasNijigasakiStageMember = hasStageMemberMatching(game, player.id, groupAliasIs('虹ヶ咲'));
  const rebalanceResult = hasNijigasakiStageMember
    ? rebalanceRemainingHeartColorForPlayer(game, player.id, HeartColor.GREEN, 1)
    : {
        gameState: game,
        rebalancedCount: 0,
        remainingColorCountBefore: getRemainingHeartCount(game, player.id, HeartColor.GREEN),
        remainingColorCountAfter: getRemainingHeartCount(game, player.id, HeartColor.GREEN),
        remainingRainbowCountBefore: getRemainingHeartCount(game, player.id, HeartColor.RAINBOW),
      };
  const stateAfterRebalance = rebalanceResult.gameState;
  const remainingGreenHeartCount = getRemainingHeartCount(
    stateAfterRebalance,
    player.id,
    HeartColor.GREEN
  );
  const remainingHeartTotalCount = getRemainingHeartTotalCount(stateAfterRebalance, player.id);
  const hasGreenRemainingHeart = hasRemainingHeartColor(
    stateAfterRebalance,
    player.id,
    HeartColor.GREEN,
    1
  );
  const conditionMet = hasGreenRemainingHeart && hasNijigasakiStageMember;
  const energyPlacement = conditionMet
    ? placeEnergyFromDeckToZoneByCardEffect(
        stateAfterRebalance,
        player.id,
        1,
        OrientationState.WAITING,
        {
          kind: 'CARD_EFFECT',
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          pendingAbilityId: ability.id,
        }
      )
    : null;
  const stateAfterPlacement = energyPlacement?.gameState ?? stateAfterRebalance;
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
      step: 'PLACE_WAITING_ENERGY_IF_GREEN_SURPLUS_AND_NIJIGASAKI_MEMBER',
      conditionMet,
      remainingGreenHeartCount,
      remainingHeartTotalCount,
      rebalancedRemainingHeartCount: rebalanceResult.rebalancedCount,
      remainingGreenHeartCountBeforeRebalance: rebalanceResult.remainingColorCountBefore,
      remainingRainbowHeartCountBeforeRebalance: rebalanceResult.remainingRainbowCountBefore,
      hasNijigasakiStageMember,
      placedEnergyCardIds: energyPlacement?.placedEnergyCardIds ?? [],
    }),
    orderedResolution
  );
}
