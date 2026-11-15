import type { BaseCardData, BladeHeartItem } from '../entities/card.js';
import { isLiveCardData, isMemberCardData } from '../entities/card.js';
import { getCardById, type GameState, type LiveModifierState } from '../entities/game.js';
import { getCheerCardEffectiveBladeHearts } from '../rules/live-modifiers.js';
import { BladeHeartEffect, HeartColor, TriggerCondition } from '../../shared/types/enums.js';
import { getHextechDefinition } from './catalog.js';
import { HEXTECH_SELECTION_TURNS } from './state.js';

/** The three acquisition rounds begin on turns 1, 3 and 5. Local grants use the same bands. */
export function getHextechAcquisitionStage(turn: number): number {
  return HEXTECH_SELECTION_TURNS.filter((start) => turn >= start).length;
}

export function getHextechDrawPhaseBonus(game: GameState, playerId: string): number {
  return (game.hextech?.owned ?? []).filter(
    (owned) =>
      owned.playerId === playerId &&
      owned.acquiredTurn < game.turnCount &&
      getHextechDefinition(owned.definitionId)?.effect.kind === 'ACQUIRE_AND_TURN_DRAW'
  ).length;
}

/** Base BLADE HEART replacement; ordinary color replacement applies afterwards. */
export function getHextechBladeHearts(
  game: GameState,
  playerId: string,
  card: BaseCardData
): readonly BladeHeartItem[] {
  if (!isMemberCardData(card) && !isLiveCardData(card)) return [];
  const effects = (game.hextech?.owned ?? [])
    .filter((owned) => owned.playerId === playerId)
    .map((owned) => getHextechDefinition(owned.definitionId)?.effect.kind);
  if (
    isMemberCardData(card) &&
    [5, 7, 9].includes(card.cost) &&
    effects.includes('COST_579_GRAY_BLADE_HEART')
  ) {
    return [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY }];
  }
  const printed = card.bladeHearts ?? [];
  if (isLiveCardData(card) && printed.length > 0 && effects.includes('LIVE_CRITICAL_BLADE_HEART')) {
    return [{ effect: BladeHeartEffect.SCORE }, { effect: BladeHeartEffect.SCORE }];
  }
  return printed;
}

export function getHextechPerfectCheerScore(
  game: GameState,
  playerId: string,
  ordinaryModifiers: readonly LiveModifierState[]
): number {
  const ids =
    game.players[game.firstPlayerIndex].id === playerId
      ? game.liveResolution.firstPlayerCheerCardIds
      : game.liveResolution.secondPlayerCheerCardIds;
  const revealed = new Set(
    game.resolutionZone.revealedCardIds.filter((id) => game.resolutionZone.cardIds.includes(id))
  );
  // Recovered cheer cards remain revealed facts; unrelated resolution cards are not cheer.
  for (const { event } of game.eventLog) {
    if (
      event.eventType === TriggerCondition.ON_CHEER &&
      'playerId' in event &&
      'revealedCardIds' in event &&
      event.playerId === playerId
    ) {
      for (const id of event.revealedCardIds) revealed.add(id);
    }
  }
  const cards = ids.filter((id) => revealed.has(id)).map((id) => getCardById(game, id));
  // Include ordinary empty-marker grants, using the caller's complete modifier
  // set so collecting the conditional score cannot recursively collect itself.
  return cards.every(
    (card) =>
      card?.ownerId === playerId &&
      getCheerCardEffectiveBladeHearts(game, playerId, card.instanceId, ordinaryModifiers).length >
        0
  )
    ? Math.floor(cards.length / 5)
    : 0;
}
