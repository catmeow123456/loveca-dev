import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { S_PB2_014_ON_ENTER_OTHER_CYARON_BOTH_PLACE_WAITING_ENERGY_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import type { EnqueueTriggeredCardEffectsForWaitingEnergyPlacement } from '../../runtime/waiting-energy-placement.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const isCyaron = unitAliasIs('CYaRon!');

export function registerSPb2014YouWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForWaitingEnergyPlacement;
}): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY,
    (game, ability, options, context) => {
      const player = getPlayerById(game, ability.controllerId);
      const opponent = getOpponent(game, ability.controllerId);
      if (!player || !opponent) return game;

      const eligible = hasOtherCyaronMember(game, ability);
      const cause = {
        kind: 'CARD_EFFECT' as const,
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ABILITY,
        pendingAbilityId: ability.id,
      };
      const ownPlacement = eligible
        ? placeEnergyFromDeckToZoneByCardEffect(game, player.id, 1, OrientationState.WAITING, cause)
        : null;
      const opponentPlacement = eligible
        ? placeEnergyFromDeckToZoneByCardEffect(
            ownPlacement?.gameState ?? game,
            opponent.id,
            1,
            OrientationState.WAITING,
            cause
          )
        : null;
      const state = opponentPlacement?.gameState ?? ownPlacement?.gameState ?? game;
      const events = [ownPlacement?.energyPlacedEvent, opponentPlacement?.energyPlacedEvent].filter(
        (event) => event !== undefined
      );
      const resolved = addAction(
        {
          ...state,
          pendingAbilities: state.pendingAbilities.filter((pending) => pending.id !== ability.id),
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ABILITY,
          sourceCardId: ability.sourceCardId,
          step: 'BOTH_PLACE_WAITING_ENERGY_IF_OTHER_CYARON',
          conditionMet: eligible,
          ownPlacedEnergyCardIds: ownPlacement?.placedEnergyCardIds ?? [],
          opponentPlacedEnergyCardIds: opponentPlacement?.placedEnergyCardIds ?? [],
        }
      );
      const queued =
        events.length > 0
          ? deps.enqueueTriggeredCardEffects(
              resolved,
              [TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT],
              {
                energyPlacedByCardEffectEvents: events,
              }
            )
          : resolved;
      return context.continuePendingCardEffects(queued, options.orderedResolution === true);
    },
    (game, ability) => {
      const eligible = hasOtherCyaronMember(game, ability);
      const player = getPlayerById(game, ability.controllerId);
      const opponent = getOpponent(game, ability.controllerId);
      const ownCount = eligible && (player?.energyDeck.cardIds.length ?? 0) > 0 ? 1 : 0;
      const opponentCount = eligible && (opponent?.energyDeck.cardIds.length ?? 0) > 0 ? 1 : 0;
      return {
        effectText: `${getAbilityEffectText(ABILITY)}（${eligible ? '满足条件' : '未满足条件'}，自己放置${ownCount}张待机能量，对方放置${opponentCount}张待机能量。）`,
      };
    }
  );
}

function hasOtherCyaronMember(game: GameState, ability: PendingAbilityState): boolean {
  const sourceIsCurrent = isCurrentStageMemberAbilitySource(game, {
    ...ability,
    sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
  });
  return (
    getStageMemberCardIdsMatching(
      game,
      ability.controllerId,
      (card) =>
        card.ownerId === ability.controllerId &&
        (!sourceIsCurrent || card.instanceId !== ability.sourceCardId) &&
        isCyaron(card)
    ).length > 0
  );
}
