import type { GameState } from '../../../domain/entities/game.js';
import type { SlotPosition } from '../../../shared/types/enums.js';
import type { CardAbilityDefinition } from '../ability-definition-types.js';
import { CardAbilitySourceZone } from '../ability-definition-types.js';

/**
 * A narrow pre-queue hook for pseudo LIVE_SUCCESS abilities.  Workflows own
 * their card-specific predicate; the runner only asks this registry whether a
 * definition is currently available to be queued.
 */
export interface LiveSuccessAbilityAvailabilityContext {
  readonly game: GameState;
  readonly controllerId: string;
  readonly sourceCardId: string;
  readonly sourceZone: CardAbilitySourceZone;
  readonly sourceSlot?: SlotPosition;
  readonly abilityDefinition: CardAbilityDefinition;
}

export type LiveSuccessAbilityAvailabilityGate = (
  context: LiveSuccessAbilityAvailabilityContext
) => boolean;

const availabilityGates = new Map<string, LiveSuccessAbilityAvailabilityGate>();

export function registerLiveSuccessAbilityAvailabilityGate(
  abilityId: string,
  gate: LiveSuccessAbilityAvailabilityGate
): void {
  availabilityGates.set(abilityId, gate);
}

export function isLiveSuccessAbilityAvailable(
  context: LiveSuccessAbilityAvailabilityContext
): boolean {
  return availabilityGates.get(context.abilityDefinition.abilityId)?.(context) ?? true;
}
