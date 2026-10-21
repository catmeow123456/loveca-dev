import { isLiveCardData } from '../../../domain/entities/card.js';
import {
  emitGameEvent,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
} from '../../../domain/entities/game.js';
import { addCardToZone, removeCardFromZone } from '../../../domain/entities/zone.js';
import { createEnterHandEvent, type CardEffectCause } from '../../../domain/events/game-events.js';
import { canLiveCardEnterSuccessZone } from '../../../domain/rules/success-live-placement.js';
import { ZoneType } from '../../../shared/types/enums.js';
import { recordSuccessZoneEntry } from './success-zone-entry-triggers.js';

/** 成功区的“卡片”不限 LIVE；只移动当前仍属于自己的指定卡，并记录真实回手事件。 */
export function returnSuccessZoneCardToHandForPlayer(
  game: GameState,
  playerId: string,
  cardId: string
): GameState | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  if (!player || card?.ownerId !== playerId || !player.successZone.cardIds.includes(cardId)) {
    return null;
  }
  const state = updatePlayer(game, playerId, (current) => ({
    ...current,
    successZone: removeCardFromZone(current.successZone, cardId),
    hand: addCardToZone(current.hand, cardId),
  }));
  return emitGameEvent(
    state,
    createEnterHandEvent([cardId], ZoneType.SUCCESS_ZONE, playerId, playerId)
  );
}

/** 不调用替代效果；caller 先完成替代选择，再使用此原子放置并复核实时禁入。 */
export function placeHandLiveCardInSuccessZoneForPlayer(
  game: GameState,
  playerId: string,
  cardId: string,
  cause?: CardEffectCause
): GameState | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  if (
    !player ||
    !card ||
    !isLiveCardData(card.data) ||
    !player.hand.cardIds.includes(cardId) ||
    !canLiveCardEnterSuccessZone(game, playerId, cardId)
  )
    return null;
  const state = updatePlayer(game, playerId, (current) => ({
    ...current,
    hand: removeCardFromZone(current.hand, cardId),
    successZone: addCardToZone(current.successZone, cardId),
  }));
  return recordSuccessZoneEntry(game, state, playerId, cardId, ZoneType.HAND, cause);
}
