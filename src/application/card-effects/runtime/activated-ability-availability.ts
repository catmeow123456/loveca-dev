import { getPlayerById, type GameState } from '../../../domain/entities/game.js';
import type { OrientationState } from '../../../shared/types/enums.js';
import type {
  ActivatedAbilityUiConfig,
  CardAbilityDefinition,
} from '../ability-definition-types.js';

export function isActivatedAbilityDefinitionAvailableForSource(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  definition: CardAbilityDefinition
): boolean {
  const orientation = getPlayerById(game, playerId)?.memberSlots.cardStates.get(
    sourceCardId
  )?.orientation;
  return (
    definition.requiredSourceOrientation === undefined ||
    orientation === definition.requiredSourceOrientation
  );
}

export function isActivatedAbilityUiConfigAvailableForOrientation(
  config: ActivatedAbilityUiConfig,
  orientation: OrientationState | undefined
): boolean {
  return (
    config.requiredSourceOrientation === undefined ||
    orientation === config.requiredSourceOrientation
  );
}

export function isActivatedAbilityUiConfigAvailableForSource(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  config: ActivatedAbilityUiConfig
): boolean {
  return isActivatedAbilityUiConfigAvailableForOrientation(
    config,
    getPlayerById(game, playerId)?.memberSlots.cardStates.get(sourceCardId)?.orientation
  );
}
