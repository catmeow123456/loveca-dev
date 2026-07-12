import type { GameState } from '../../../domain/entities/game.js';
import type {
  CardEffectCause,
  EnergyMovedToDeckEvent,
} from '../../../domain/events/game-events.js';
import { TriggerCondition } from '../../../shared/types/enums.js';
import { moveEnergyZoneCardsToEnergyDeckByCardEffect } from '../../effects/energy.js';

export type EnqueueTriggeredCardEffectsForEnergyReturn = (
  game: GameState,
  triggers: readonly TriggerCondition[],
  options?: {
    readonly energyMovedToDeckEvents?: readonly EnergyMovedToDeckEvent[];
  }
) => GameState;

export interface ResolveEnergyReturnByCardEffectConfig {
  readonly playerId: string;
  readonly selectedEnergyCardIds: readonly string[];
  readonly cause: CardEffectCause;
  readonly exactCount?: number;
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnergyReturn;
}

export interface ResolveEnergyReturnByCardEffectResult {
  readonly gameState: GameState;
  readonly movedEnergyCardIds: readonly string[];
  readonly energyMovedEvent: EnergyMovedToDeckEvent;
}

export function resolveEnergyReturnByCardEffect(
  game: GameState,
  config: ResolveEnergyReturnByCardEffectConfig
): ResolveEnergyReturnByCardEffectResult | null {
  const movement = moveEnergyZoneCardsToEnergyDeckByCardEffect(
    game,
    config.playerId,
    config.selectedEnergyCardIds,
    config.cause,
    { exactCount: config.exactCount }
  );
  if (!movement?.energyMovedEvent) return null;

  return {
    gameState: config.enqueueTriggeredCardEffects(
      movement.gameState,
      [TriggerCondition.ON_ENERGY_MOVED_TO_DECK],
      { energyMovedToDeckEvents: [movement.energyMovedEvent] }
    ),
    movedEnergyCardIds: movement.movedEnergyCardIds,
    energyMovedEvent: movement.energyMovedEvent,
  };
}
