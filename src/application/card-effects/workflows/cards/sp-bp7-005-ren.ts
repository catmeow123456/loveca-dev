import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { addEnergyActivePhaseSkips } from '../../../../domain/rules/energy-active-skips.js';
import { OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import {
  SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP7_005_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type Continue = (game: GameState, ordered: boolean) => GameState;
type Enqueue = (game: GameState, triggers: readonly TriggerCondition[]) => GameState;

export function registerSpBp7005RenWorkflowHandlers(deps: {
  enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolvePlacement(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    SP_BP7_005_AUTO_OWN_EFFECT_PLACE_ENERGY_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveBlade(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolvePlacement(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  next: Continue,
  enqueue: Enqueue
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? findMemberSlot(player, ability.sourceCardId) : null;
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
  };
  let placedEnergyCardIds: readonly string[] = [];
  if (player && sourceSlot !== null) {
    state = recordAbilityUseForContext(state, player.id, {
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
    });
    const result = placeEnergyFromDeckToZoneByCardEffect(
      state,
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
    );
    if (result?.placedEnergyCardIds.length) {
      placedEnergyCardIds = result.placedEnergyCardIds;
      state = addEnergyActivePhaseSkips(
        result.gameState,
        placedEnergyCardIds.map((energyCardId) => ({
          playerId: player.id,
          energyCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }))
      );
      state = enqueue(state, [TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT]);
    }
  }
  return next(
    addAction(state, 'RESOLVE_ABILITY', player?.id ?? ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      placedEnergyCardIds,
      sourceStillOnStage: sourceSlot !== null,
    }),
    ordered
  );
}

function resolveBlade(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  next: Continue
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const rawEvent = game.eventLog.find((entry) =>
    ability.eventIds.includes(entry.event.eventId)
  )?.event;
  const event = rawEvent && 'placedEnergyCardIds' in rawEvent ? rawEvent : null;
  const valid =
    player &&
    findMemberSlot(player, ability.sourceCardId) !== null &&
    event?.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT &&
    event.targetPlayerId === player.id &&
    event.cause.playerId === player.id;
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
  };
  if (valid) {
    state = recordAbilityUseForContext(state, player.id, {
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
    });
    state =
      addBladeLiveModifierForSourceMember(state, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        amount: 1,
      })?.gameState ?? state;
  }
  return next(
    addAction(state, 'RESOLVE_ABILITY', player?.id ?? ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      conditionMet: Boolean(valid),
      placedEnergyCardIds:
        event?.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
          ? event.placedEnergyCardIds
          : [],
    }),
    ordered
  );
}
