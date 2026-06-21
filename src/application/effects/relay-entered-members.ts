import type { EnterStageEvent } from '../../domain/events/game-events.js';
import { getCardById, getPlayerById, type GameState } from '../../domain/entities/game.js';
import { TriggerCondition } from '../../shared/types/enums.js';
import type { CardSelector } from './card-selectors.js';

export function getRelayEnteredStageMemberCardIdsThisTurn(
  game: GameState,
  playerId: string,
  selector: CardSelector
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const relayEnteredCardIds = new Set(
    game.eventLog
      .map((entry) => entry.event)
      .filter(
        (event): event is EnterStageEvent =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          event.controllerId === playerId &&
          'relayReplacements' in event &&
          (event.relayReplacements?.length ?? 0) > 0
      )
      .map((event) => event.cardInstanceId)
  );

  return Object.values(player.memberSlots.slots).filter((cardId): cardId is string => {
    if (
      cardId === null ||
      !player.movedToStageThisTurn.includes(cardId) ||
      !relayEnteredCardIds.has(cardId)
    ) {
      return false;
    }

    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
}
