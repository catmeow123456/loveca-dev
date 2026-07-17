import { isMemberCardData, type CardInstance } from '../entities/card.js';
import type { GameState } from '../entities/game.js';
import { getCardById, getPlayerById } from '../entities/game.js';
import { TriggerCondition, ZoneType } from '../../shared/types/enums.js';

type CardInstanceSelector = (card: CardInstance) => boolean;

function getCurrentTurnEventEntries(game: GameState) {
  for (let index = game.eventLog.length - 1; index >= 0; index -= 1) {
    if (game.eventLog[index]?.event.eventType === TriggerCondition.ON_TURN_START) {
      return game.eventLog.slice(index + 1);
    }
  }
  for (let index = game.eventLog.length - 1; index >= 0; index -= 1) {
    if (game.eventLog[index]?.event.eventType === TriggerCondition.ON_TURN_END) {
      return game.eventLog.slice(index + 1);
    }
  }
  return game.eventLog;
}

export function countMemberEntriesThisTurn(game: GameState, playerId: string): number {
  return getCurrentTurnEventEntries(game).filter(
    ({ event }) =>
      event.eventType === TriggerCondition.ON_ENTER_STAGE && event.controllerId === playerId
  ).length;
}

export function hasMemberEnteredStageThisTurnMatching(
  game: GameState,
  playerId: string,
  selector: CardInstanceSelector
): boolean {
  return getCurrentTurnEventEntries(game).some(({ event }) => {
    if (
      event.eventType !== TriggerCondition.ON_ENTER_STAGE ||
      event.controllerId !== playerId
    ) {
      return false;
    }
    const card = getCardById(game, event.cardInstanceId);
    return card !== null && isMemberCardData(card.data) && selector(card);
  });
}

export function getMemberEntryOrdinalForEvent(
  game: GameState,
  playerId: string,
  enterStageEventId: string
): number | null {
  let ordinal = 0;
  for (const { event } of getCurrentTurnEventEntries(game)) {
    if (event.eventType !== TriggerCondition.ON_ENTER_STAGE || event.controllerId !== playerId)
      continue;
    ordinal += 1;
    if (event.eventId === enterStageEventId) return ordinal;
  }
  return null;
}

export function hasMemberPositionMovedThisTurn(
  game: GameState,
  playerId: string,
  memberCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  return player?.positionMovedThisTurn.includes(memberCardId) === true;
}

export function hasMemberMovedToStageThisTurn(
  game: GameState,
  playerId: string,
  memberCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  return player?.movedToStageThisTurn.includes(memberCardId) === true;
}

export function getPositionMovedStageMemberIdsMatching(
  game: GameState,
  playerId: string,
  selector: CardInstanceSelector
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return Object.values(player.memberSlots.slots).filter((cardId): cardId is string => {
    if (cardId === null || !player.positionMovedThisTurn.includes(cardId)) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
}

export function getMovedToStageThisTurnStageMemberIdsMatching(
  game: GameState,
  playerId: string,
  selector: CardInstanceSelector
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return Object.values(player.memberSlots.slots).filter((cardId): cardId is string => {
    if (cardId === null || !player.movedToStageThisTurn.includes(cardId)) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
}

export function getMovedToStageOrPositionMovedStageMemberIdsMatching(
  game: GameState,
  playerId: string,
  selector: CardInstanceSelector
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return Object.values(player.memberSlots.slots).filter((cardId): cardId is string => {
    if (
      cardId === null ||
      (!player.movedToStageThisTurn.includes(cardId) &&
        !player.positionMovedThisTurn.includes(cardId))
    ) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
}

export function selectNoBladeHeartMemberCardIdsMovedFromLiveZoneToWaitingThisTurn(
  game: GameState,
  playerId: string
): readonly string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const { event } of getCurrentTurnEventEntries(game)) {
    if (
      event.eventType !== TriggerCondition.ON_ENTER_WAITING_ROOM ||
      event.fromZone !== ZoneType.LIVE_ZONE ||
      event.toZone !== ZoneType.WAITING_ROOM ||
      event.controllerId !== playerId
    ) {
      continue;
    }

    const movedCardIds =
      'cardInstanceIds' in event && event.cardInstanceIds
        ? event.cardInstanceIds
        : [event.cardInstanceId];
    for (const cardId of movedCardIds) {
      if (seen.has(cardId)) {
        continue;
      }
      const card = getCardById(game, cardId);
      if (!card || !isMemberCardData(card.data) || (card.data.bladeHearts?.length ?? 0) > 0) {
        continue;
      }
      seen.add(cardId);
      result.push(cardId);
    }
  }

  return result;
}
