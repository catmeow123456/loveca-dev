import type { GameState } from '../../../domain/entities/game.js';
import { getCardById } from '../../../domain/entities/game.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import { selectRevealedCheerCardIds } from '../../effects/cheer-selection.js';

export interface RevealedCheerLiveSuccessAbilitySource {
  readonly cardId: string;
  readonly sourceZone: CardAbilitySourceZone.REVEALED_CHEER_CARD;
}

/**
 * Finds only currently movable cards from this player's current cheer set.
 * This intentionally does not consult historic CheerEvent card ids: history is
 * valid for conditions, but not for a card that must still be revealed now.
 */
export function collectCurrentRevealedCheerLiveSuccessAbilitySources(
  game: GameState,
  playerId: string
): readonly RevealedCheerLiveSuccessAbilitySource[] {
  return selectRevealedCheerCardIds(game, playerId).flatMap((cardId) => {
    const card = getCardById(game, cardId);
    const hasImplementedQueuedLiveSuccessDefinition = getCardAbilityDefinitionsForCardCode(
      card?.data.cardCode
    ).some(
      (definition) =>
        definition.category === CardAbilityCategory.LIVE_SUCCESS &&
        definition.sourceZone === CardAbilitySourceZone.REVEALED_CHEER_CARD &&
        definition.queued &&
        definition.implemented
    );
    return hasImplementedQueuedLiveSuccessDefinition
      ? [{ cardId, sourceZone: CardAbilitySourceZone.REVEALED_CHEER_CARD }]
      : [];
  });
}
