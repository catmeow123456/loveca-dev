import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import type { EnergyPlacedByCardEffectEvent } from '../../../../domain/events/game-events.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, TriggerCondition } from '../../../../shared/types/enums.js';
import { SP_BP4_016_AUTO_CARD_EFFECT_PLACE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp4016RenWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP4_016_AUTO_CARD_EFFECT_PLACE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpBp4016RenAuto(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpBp4016RenAuto(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? findMemberSlot(player, ability.sourceCardId) : null;
  const event = getPendingEnergyPlacedEvent(game, ability);
  const placedEnergyCardIds =
    player && event?.targetPlayerId === player.id
      ? event.placedEnergyCardIds.filter((cardId) => player.energyZone.cardIds.includes(cardId))
      : [];
  const purpleHeartCount = sourceSlot === null ? 0 : placedEnergyCardIds.length;
  const conditionMet = player !== null && sourceSlot !== null && purpleHeartCount > 0;

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  let heartBonus: readonly { readonly color: HeartColor; readonly count: number }[] = [];

  if (conditionMet && player) {
    const heartResult = addHeartLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: HeartColor.PURPLE, count: purpleHeartCount }],
    });
    if (heartResult) {
      state = heartResult.gameState;
      heartBonus = heartResult.heartBonus;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: conditionMet
        ? 'CARD_EFFECT_PLACE_ENERGY_GAIN_PURPLE_HEART'
        : 'CONDITION_NOT_MET',
      conditionMet,
      sourceStillOnStage: sourceSlot !== null,
      sourceSlot,
      eventId: event?.eventId ?? null,
      targetPlayerId: event?.targetPlayerId ?? null,
      placedEnergyCardIds,
      placedEnergyCount: placedEnergyCardIds.length,
      purpleHeartCount,
      causedByPlayerId: event?.cause.playerId ?? null,
      causedBySourceCardId: event?.cause.sourceCardId ?? null,
      causedByAbilityId: event?.cause.abilityId ?? null,
      heartBonus,
    }),
    orderedResolution
  );
}

function getPendingEnergyPlacedEvent(
  game: GameState,
  ability: PendingAbilityState
): EnergyPlacedByCardEffectEvent | null {
  const eventIds = new Set(ability.eventIds);
  for (const entry of game.eventLog) {
    const event = entry.event;
    if (
      event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT &&
      eventIds.has(event.eventId)
    ) {
      return event as EnergyPlacedByCardEffectEvent;
    }
  }
  return null;
}
