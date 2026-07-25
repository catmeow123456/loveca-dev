import type { GameState } from '../../../domain/entities/game.js';
import { findCardZone } from '../../../domain/entities/player.js';
import { isZoneCardPublicFront } from '../../../online/visibility.js';
import { ZoneType } from '../../../shared/types/enums.js';

function isCardPublicFront(game: GameState, cardId: string): boolean {
  const card = game.cardRegistry.get(cardId);
  if (!card) return false;
  if (game.activeEffect?.revealedCardIds?.includes(cardId) === true) return true;

  const owner = game.players.find((player) => player.id === card.ownerId);
  const playerZone = owner ? findCardZone(owner, cardId) : null;
  if (owner && playerZone) {
    return isZoneCardPublicFront({
      zone: playerZone,
      liveFaceState:
        playerZone === ZoneType.LIVE_ZONE ? owner.liveZone.cardStates.get(cardId)?.face : undefined,
    });
  }

  if (game.resolutionZone.cardIds.includes(cardId)) {
    return isZoneCardPublicFront({
      zone: ZoneType.RESOLUTION_ZONE,
      isResolutionCardRevealed: game.resolutionZone.revealedCardIds.includes(cardId),
    });
  }

  if (game.inspectionZone.cardIds.includes(cardId)) {
    return isZoneCardPublicFront({
      zone: ZoneType.INSPECTION_ZONE,
      isInspectionCardRevealed: game.inspectionZone.revealedCardIds.includes(cardId),
    });
  }

  return false;
}

/**
 * Keeps a reconnect-safe presentation snapshot for an active-effect source
 * after that source leaves a public zone. Hidden sources never gain a snapshot.
 */
export function preserveActiveEffectSourceDisplay(before: GameState, after: GameState): GameState {
  const effect = after.activeEffect;
  if (!effect || effect.sourceCardDisplayCode) return after;

  const previousEffect = before.activeEffect;
  if (
    previousEffect?.id === effect.id &&
    previousEffect?.sourceCardId === effect.sourceCardId &&
    previousEffect.sourceCardDisplayCode
  ) {
    return {
      ...after,
      activeEffect: {
        ...effect,
        sourceCardDisplayCode: previousEffect.sourceCardDisplayCode,
      },
    };
  }

  if (
    !isCardPublicFront(before, effect.sourceCardId) &&
    !isCardPublicFront(after, effect.sourceCardId)
  ) {
    return after;
  }

  const sourceCard =
    after.cardRegistry.get(effect.sourceCardId) ?? before.cardRegistry.get(effect.sourceCardId);
  if (!sourceCard) return after;

  return {
    ...after,
    activeEffect: {
      ...effect,
      sourceCardDisplayCode: sourceCard.data.cardCode,
    },
  };
}
