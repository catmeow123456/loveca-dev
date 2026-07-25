import type { GameState } from '../../../domain/entities/game.js';
import type {
  CardEffectCause,
  EnergyPlacedByCardEffectEvent,
} from '../../../domain/events/game-events.js';
import { addEnergyActivePhaseSkips } from '../../../domain/rules/energy-active-skips.js';
import { OrientationState, TriggerCondition } from '../../../shared/types/enums.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../effects/energy.js';

export type EnqueueTriggeredCardEffectsForWaitingEnergyPlacement = (
  game: GameState,
  triggers: readonly TriggerCondition[],
  options?: {
    readonly energyPlacedByCardEffectEvents?: readonly EnergyPlacedByCardEffectEvent[];
  }
) => GameState;

export interface PlaceWaitingEnergyWithActivePhaseSkipConfig {
  readonly count: number;
  readonly cause: Extract<CardEffectCause, { readonly kind: 'CARD_EFFECT' }> & {
    readonly sourceCardId: string;
    readonly abilityId: string;
  };
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForWaitingEnergyPlacement;
}

export interface PlaceWaitingEnergyWithActivePhaseSkipResult {
  readonly gameState: GameState;
  readonly placedEnergyCardIds: readonly string[];
  readonly energyPlacedEvent?: EnergyPlacedByCardEffectEvent;
}

/**
 * Places the available energy cards as one card-effect placement, then binds only the
 * cards actually placed to the controller's next Active Phase skip.
 *
 * The placement event is forwarded as the exact event produced by this atomic action;
 * callers keep ownership of source validation, rewards, pending removal, and continuation.
 */
export function placeWaitingEnergyWithActivePhaseSkip(
  game: GameState,
  config: PlaceWaitingEnergyWithActivePhaseSkipConfig
): PlaceWaitingEnergyWithActivePhaseSkipResult | null {
  if (!Number.isInteger(config.count) || config.count <= 0) {
    return null;
  }
  const placement = placeEnergyFromDeckToZoneByCardEffect(
    game,
    config.cause.playerId,
    config.count,
    OrientationState.WAITING,
    config.cause
  );
  if (!placement) {
    return null;
  }
  if (placement.placedEnergyCardIds.length === 0 || !placement.energyPlacedEvent) {
    return {
      gameState: placement.gameState,
      placedEnergyCardIds: [],
    };
  }

  const stateWithSkips = addEnergyActivePhaseSkips(
    placement.gameState,
    placement.placedEnergyCardIds.map((energyCardId) => ({
      playerId: config.cause.playerId,
      energyCardId,
      sourceCardId: config.cause.sourceCardId,
      abilityId: config.cause.abilityId,
    }))
  );
  return {
    gameState: config.enqueueTriggeredCardEffects(
      stateWithSkips,
      [TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT],
      { energyPlacedByCardEffectEvents: [placement.energyPlacedEvent] }
    ),
    placedEnergyCardIds: placement.placedEnergyCardIds,
    energyPlacedEvent: placement.energyPlacedEvent,
  };
}
