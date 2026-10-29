import { isMemberCardData } from '../entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../entities/game.js';
import { OrientationState } from '../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';
import { cardNameAliasMatches } from '../../shared/utils/card-identity.js';
import { getMemberEffectiveCost } from './member-effective-cost.js';

/** Applies to the actual stage source, including a host exercising a granted ability. */
export function getStageMemberActivatedAbilityProhibition(
  game: GameState,
  playerId: string,
  sourceCardId: string
): 'SERAS_LOW_COST' | undefined {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  if (
    !player ||
    !source ||
    source.ownerId !== playerId ||
    !isMemberCardData(source.data) ||
    !Object.values(player.memberSlots.slots).includes(sourceCardId) ||
    getMemberEffectiveCost(game, playerId, sourceCardId) > 4
  )
    return undefined;

  const prohibited = game.players.some((controller) => {
    const stage = Object.values(controller.memberSlots.slots).flatMap((id) => {
      const card = id ? getCardById(game, id) : null;
      return card && card.ownerId === controller.id && isMemberCardData(card.data) ? [card] : [];
    });
    return (
      stage.some((card) => cardCodeMatchesBase(card.data.cardCode, 'PL!HS-bp8-007')) &&
      stage.some(
        (card) =>
          cardNameAliasMatches(card.data, '桂城泉') &&
          controller.memberSlots.cardStates.get(card.instanceId)?.orientation ===
            OrientationState.ACTIVE
      )
    );
  });
  return prohibited ? 'SERAS_LOW_COST' : undefined;
}

export function isStageMemberActivatedAbilityProhibited(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  return getStageMemberActivatedAbilityProhibition(game, playerId, sourceCardId) !== undefined;
}
