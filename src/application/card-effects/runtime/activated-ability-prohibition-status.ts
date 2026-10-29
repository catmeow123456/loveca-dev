import { getCardById, type GameState } from '../../../domain/entities/game.js';
import { getStageMemberActivatedAbilityProhibition } from '../../../domain/rules/member-activated-ability-prohibitions.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import { getGrantedActivatedAbilityDefinitions } from './granted-member-below-abilities.js';

/** Presentation only: a prohibition needs a possessed stage ability to warrant a seal.
 * Do not use availability here: prohibition, orientation and spent uses hide usable buttons.
 */
export function getStageMemberActivatedAbilityProhibitionForView(
  game: GameState,
  playerId: string,
  sourceCardId: string
): ReturnType<typeof getStageMemberActivatedAbilityProhibition> {
  const prohibition = getStageMemberActivatedAbilityProhibition(game, playerId, sourceCardId);
  if (!prohibition) return undefined;
  const source = getCardById(game, sourceCardId);
  const hasNativeAbility = getCardAbilityDefinitionsForCardCode(source?.data.cardCode).some(
    (definition) =>
      definition.category === CardAbilityCategory.ACTIVATED &&
      definition.sourceZone === CardAbilitySourceZone.STAGE_MEMBER
  );
  return hasNativeAbility ||
    getGrantedActivatedAbilityDefinitions(game, playerId, sourceCardId).length > 0
    ? prohibition
    : undefined;
}
