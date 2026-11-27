import type { ActiveEffectState, GameState } from '../../../domain/entities/game.js';
import { moveWaitingRoomCardsToDeckBottomForPlayer } from './actions.js';
import type { PublicCardSelectionConfirmationConfig } from './public-card-selection-confirmation.js';
import { enqueueWaitingRoomCardsMovedToMainDeckCardEffects } from './waiting-room-main-deck-triggers.js';
import { recordPayCostAction } from './workflow-helpers.js';

export const PRIVATE_ORDERED_WAITING_ROOM_BOTTOM_CONFIRMATION = {
  source: 'WAITING_ROOM',
  destination: 'MAIN_DECK_BOTTOM',
  ordered: true,
  privateOrder: true,
} as const satisfies PublicCardSelectionConfirmationConfig;

export function payPrivateOrderedWaitingRoomBottomCost(
  game: GameState,
  effect: ActiveEffectState,
  selectedCardIds: readonly string[],
  options: {
    readonly candidateCardIds: readonly string[];
    readonly minCount: number;
    readonly maxCount: number;
  }
) {
  const result = moveWaitingRoomCardsToDeckBottomForPlayer(
    game,
    effect.controllerId,
    selectedCardIds,
    {
      ...options,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!result) return null;
  const event = result.waitingRoomCardsMovedToMainDeckEvent;
  const paid = recordPayCostAction(result.gameState, effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceLifecycleId: effect.sourceLifecycleId,
    pendingAbilityId: effect.id,
    costType: 'MOVE_WAITING_ROOM_CARDS_TO_DECK_BOTTOM',
    movedCardIds: result.movedCardIds,
    ...(result.movedCardIds.length > 1 ? { privateMainDeckOrderCardIds: result.movedCardIds } : {}),
    waitingRoomCardsMovedToMainDeckEventId: event?.eventId,
  });
  return {
    gameState: event ? enqueueWaitingRoomCardsMovedToMainDeckCardEffects(paid, [event]) : paid,
    movedCardIds: result.movedCardIds,
  };
}
