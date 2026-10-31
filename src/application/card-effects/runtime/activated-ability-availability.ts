import { getPlayerById, type GameState } from '../../../domain/entities/game.js';
import { isStageMemberActivatedAbilityProhibited } from '../../../domain/rules/member-activated-ability-prohibitions.js';
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
    !isStageMemberActivatedAbilityProhibited(game, playerId, sourceCardId) &&
    (definition.requiredSourceOrientation === undefined ||
      orientation === definition.requiredSourceOrientation)
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
  return (
    !isStageMemberActivatedAbilityProhibited(game, playerId, sourceCardId) &&
    isActivatedAbilityUiConfigAvailableForOrientation(
      config,
      getPlayerById(game, playerId)?.memberSlots.cardStates.get(sourceCardId)?.orientation
    )
  );
}
