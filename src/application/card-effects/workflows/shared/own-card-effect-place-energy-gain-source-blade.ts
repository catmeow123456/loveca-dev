import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { TriggerCondition } from '../../../../shared/types/enums.js';
import {
  SP_BP7_005_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_BLADE_ABILITY_ID,
  SP_BP7_016_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface OwnCardEffectPlaceEnergyGainSourceBladeConfig {
  readonly abilityId: string;
  readonly bladeBonus: number;
  readonly actionStep: string;
}

const CONFIGS: readonly OwnCardEffectPlaceEnergyGainSourceBladeConfig[] = [
  {
    abilityId: SP_BP7_005_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_BLADE_ABILITY_ID,
    bladeBonus: 1,
    actionStep: 'OWN_CARD_EFFECT_PLACE_ENERGY_GAIN_BLADE',
  },
  {
    abilityId: SP_BP7_016_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_ONE_BLADE_ABILITY_ID,
    bladeBonus: 1,
    actionStep: 'OWN_CARD_EFFECT_PLACE_ENERGY_GAIN_BLADE',
  },
];

export function registerOwnCardEffectPlaceEnergyGainSourceBladeWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      resolveOwnCardEffectPlaceEnergyGainSourceBlade(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
  }
}

function resolveOwnCardEffectPlaceEnergyGainSourceBlade(
  game: GameState,
  ability: PendingAbilityState,
  config: OwnCardEffectPlaceEnergyGainSourceBladeConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const rawEvent = game.eventLog.find((entry) =>
    ability.eventIds.includes(entry.event.eventId)
  )?.event;
  const event = rawEvent && 'placedEnergyCardIds' in rawEvent ? rawEvent : null;
  const conditionMet =
    player !== null &&
    player !== undefined &&
    findMemberSlot(player, ability.sourceCardId) !== null &&
    event?.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT &&
    event.targetPlayerId === player.id &&
    event.cause.kind === 'CARD_EFFECT' &&
    event.cause.playerId === player.id;

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  let bladeBonus = 0;
  if (conditionMet && player) {
    state = recordAbilityUseForContext(state, player.id, {
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: ability.sourceLifecycleId,
      pendingAbilityId: ability.id,
    });
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      amount: config.bladeBonus,
    });
    if (bladeResult) {
      state = bladeResult.gameState;
      bladeBonus = bladeResult.bladeBonus;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player?.id ?? ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.actionStep,
      conditionMet,
      bladeBonus,
      placedEnergyCardIds:
        event?.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
          ? event.placedEnergyCardIds
          : [],
    }),
    orderedResolution
  );
}
