import { addAction, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import {
  collectLiveModifiers,
  getAzaleaGreenHeartTotal,
} from '../../../../domain/rules/live-modifiers.js';
import { OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import { S_PB2_016_ON_ENTER_AZALEA_GREEN_PLACE_ENERGY_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForWaitingEnergyPlacement } from '../../runtime/waiting-energy-placement.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const GREEN_HEART_THRESHOLD = 5;

export function registerSPb2016HanamaruWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForWaitingEnergyPlacement;
}): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY,
    (game, ability, options, context) => {
      const player = getPlayerById(game, ability.controllerId);
      if (!player) return game;
      const greenHeartTotal = getAzaleaGreenHeartTotal(game, player.id, collectLiveModifiers(game));
      const conditionMet = greenHeartTotal >= GREEN_HEART_THRESHOLD;
      const placement = conditionMet
        ? placeEnergyFromDeckToZoneByCardEffect(game, player.id, 1, OrientationState.WAITING, {
            kind: 'CARD_EFFECT',
            playerId: player.id,
            sourceCardId: ability.sourceCardId,
            abilityId: ability.abilityId,
            pendingAbilityId: ability.id,
          })
        : null;
      const state = placement?.gameState ?? game;
      let resolved = addAction(
        {
          ...state,
          pendingAbilities: state.pendingAbilities.filter(
            (candidate) => candidate.id !== ability.id
          ),
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'PLACE_WAITING_ENERGY_FROM_AZALEA_GREEN_HEARTS',
          greenHeartTotal,
          conditionMet,
          placedEnergyCardIds: placement?.placedEnergyCardIds ?? [],
        }
      );
      if (placement?.energyPlacedEvent) {
        resolved = deps.enqueueTriggeredCardEffects(
          resolved,
          [TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT],
          { energyPlacedByCardEffectEvents: [placement.energyPlacedEvent] }
        );
      }
      return context.continuePendingCardEffects(resolved, options.orderedResolution === true);
    },
    (game, ability) => {
      const greenHeartTotal = getAzaleaGreenHeartTotal(
        game,
        ability.controllerId,
        collectLiveModifiers(game)
      );
      const conditionMet = greenHeartTotal >= GREEN_HEART_THRESHOLD;
      const hasEnergy =
        (getPlayerById(game, ability.controllerId)?.energyDeck.cardIds.length ?? 0) > 0;
      const result = conditionMet && hasEnergy ? '放置1张待机能量' : '不放置能量';
      return {
        effectText: `${getAbilityEffectText(ability.abilityId)}（当前自己舞台的『AZALEA』成员共持有${greenHeartTotal}个[緑ハート]，${conditionMet ? '满足条件' : '未满足条件'}，${result}。）`,
      };
    }
  );
}
