import type { CardInstance } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import {
  getCardById,
  getFirstPlayer,
  getPlayerById,
  updatePlayer,
  updateResolutionZone,
} from '../../domain/entities/game.js';
import type { CheerEvent } from '../../domain/events/game-events.js';
import { addCardToZone } from '../../domain/entities/zone.js';
import { TriggerCondition, type CardType } from '../../shared/types/enums.js';
import {
  cardBelongsToGroup,
  cardBelongsToUnit,
  getNormalizedCardNameCandidates,
} from '../../shared/utils/card-identity.js';

export type CheerCardPredicate = (card: CardInstance) => boolean;
export type CurrentLiveRevealedCheerEventScope = 'ALL' | 'NON_ADDITIONAL' | 'ADDITIONAL_ONLY';
export type RevealedCheerCardDestination =
  | 'HAND'
  | 'MAIN_DECK_TOP'
  | 'MAIN_DECK_BOTTOM'
  | 'WAITING_ROOM';

export interface CurrentLiveRevealedCheerCardSelectionOptions {
  readonly predicate?: CheerCardPredicate;
  readonly cardTypes?: CardType | readonly CardType[];
  readonly groupAliases?: readonly string[];
  readonly unitAliases?: readonly string[];
  readonly eventScope?: CurrentLiveRevealedCheerEventScope;
  readonly eventIds?: readonly string[];
}

export interface CurrentLiveRevealedCheerCardConditionOptions
  extends CurrentLiveRevealedCheerCardSelectionOptions {
  readonly minCount: number;
}

export interface CurrentLiveRevealedCheerCardConditionResult {
  readonly matchingCardIds: readonly string[];
  readonly matchingCount: number;
  readonly conditionMet: boolean;
}

export interface CurrentLiveRevealedDifferentNameCheerCardResult {
  readonly matchingCardIds: readonly string[];
  readonly differentNameCount: number;
  readonly normalizedNames: readonly string[];
}

export interface MoveRevealedCheerCardsResult {
  readonly gameState: GameState;
  readonly movedCardIds: readonly string[];
}

export function selectRevealedCheerCardIds(
  game: GameState,
  playerId: string,
  predicate: CheerCardPredicate = () => true
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const firstPlayer = getFirstPlayer(game);
  const cheerCardIds =
    player.id === firstPlayer.id
      ? game.liveResolution.firstPlayerCheerCardIds
      : game.liveResolution.secondPlayerCheerCardIds;

  return cheerCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === player.id &&
      game.resolutionZone.cardIds.includes(cardId) &&
      game.resolutionZone.revealedCardIds.includes(cardId) &&
      predicate(card)
    );
  });
}

export function selectCurrentLiveRevealedCheerCardIds(
  game: GameState,
  playerId: string,
  options: CurrentLiveRevealedCheerCardSelectionOptions = {}
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const currentCheerCardIds = getCurrentLiveCheerCardIds(game, player.id);
  if (currentCheerCardIds.length === 0) {
    return [];
  }

  const currentCheerCardIdSet = new Set(currentCheerCardIds);
  const revealedCardIdSet = getCurrentLiveRevealedCheerCardIdSet(
    game,
    player.id,
    currentCheerCardIdSet,
    options
  );

  return currentCheerCardIds.filter((cardId) => {
    if (!revealedCardIdSet.has(cardId)) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && matchesCheerCardSelection(card, options);
  });
}

export function evaluateCurrentLiveRevealedCheerCardCondition(
  game: GameState,
  playerId: string,
  options: CurrentLiveRevealedCheerCardConditionOptions
): CurrentLiveRevealedCheerCardConditionResult {
  const matchingCardIds = selectCurrentLiveRevealedCheerCardIds(game, playerId, options);
  return {
    matchingCardIds,
    matchingCount: matchingCardIds.length,
    conditionMet: matchingCardIds.length >= options.minCount,
  };
}

export function countCurrentLiveRevealedDifferentNamedCheerCards(
  game: GameState,
  playerId: string,
  options: CurrentLiveRevealedCheerCardSelectionOptions = {}
): CurrentLiveRevealedDifferentNameCheerCardResult {
  const matchingCardIds = selectCurrentLiveRevealedCheerCardIds(game, playerId, options);
  const normalizedNameSet = new Set<string>();

  for (const cardId of matchingCardIds) {
    const card = getCardById(game, cardId);
    if (!card) {
      continue;
    }
    const normalizedName = getNormalizedCardNameCandidates(card.data, {
      groupName: options.groupAliases?.[0],
    })[0];
    if (normalizedName) {
      normalizedNameSet.add(normalizedName);
    }
  }

  return {
    matchingCardIds,
    differentNameCount: normalizedNameSet.size,
    normalizedNames: [...normalizedNameSet],
  };
}

export function moveRevealedCheerCards(
  game: GameState,
  playerId: string,
  cardIds: readonly string[],
  destination: RevealedCheerCardDestination
): MoveRevealedCheerCardsResult | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }

  const uniqueCardIds = [...new Set(cardIds)];
  if (
    uniqueCardIds.length !== cardIds.length ||
    uniqueCardIds.some(
      (cardId) =>
        !game.resolutionZone.cardIds.includes(cardId) ||
        !game.resolutionZone.revealedCardIds.includes(cardId) ||
        getCardById(game, cardId)?.ownerId !== player.id
    )
  ) {
    return null;
  }

  let state = updateResolutionZone(game, (zone) => ({
    ...zone,
    cardIds: zone.cardIds.filter((cardId) => !uniqueCardIds.includes(cardId)),
    revealedCardIds: zone.revealedCardIds.filter((cardId) => !uniqueCardIds.includes(cardId)),
  }));

  state = updatePlayer(state, player.id, (currentPlayer) => {
    if (destination === 'HAND') {
      return {
        ...currentPlayer,
        hand: uniqueCardIds.reduce(
          (hand, cardId) => addCardToZone(hand, cardId),
          currentPlayer.hand
        ),
      };
    }

    if (destination === 'WAITING_ROOM') {
      return {
        ...currentPlayer,
        waitingRoom: uniqueCardIds.reduce(
          (waitingRoom, cardId) => addCardToZone(waitingRoom, cardId),
          currentPlayer.waitingRoom
        ),
      };
    }

    if (destination === 'MAIN_DECK_BOTTOM') {
      return {
        ...currentPlayer,
        mainDeck: {
          ...currentPlayer.mainDeck,
          cardIds: [...currentPlayer.mainDeck.cardIds, ...uniqueCardIds],
        },
      };
    }

    return {
      ...currentPlayer,
      mainDeck: {
        ...currentPlayer.mainDeck,
        cardIds: [...uniqueCardIds, ...currentPlayer.mainDeck.cardIds],
      },
    };
  });

  return {
    gameState: state,
    movedCardIds: uniqueCardIds,
  };
}

function getCurrentLiveCheerCardIds(game: GameState, playerId: string): readonly string[] {
  const firstPlayer = getFirstPlayer(game);
  return playerId === firstPlayer.id
    ? game.liveResolution.firstPlayerCheerCardIds
    : game.liveResolution.secondPlayerCheerCardIds;
}

function getCurrentLiveRevealedCheerCardIdSet(
  game: GameState,
  playerId: string,
  currentCheerCardIdSet: ReadonlySet<string>,
  options: CurrentLiveRevealedCheerCardSelectionOptions
): ReadonlySet<string> {
  const revealedCardIds = new Set<string>();
  const eventScope = options.eventScope ?? 'ALL';
  const eventIdSet = options.eventIds ? new Set(options.eventIds) : null;

  if (eventScope === 'ALL' && eventIdSet === null) {
    const resolutionCardIdSet = new Set(game.resolutionZone.cardIds);
    for (const cardId of game.resolutionZone.revealedCardIds) {
      if (currentCheerCardIdSet.has(cardId) && resolutionCardIdSet.has(cardId)) {
        revealedCardIds.add(cardId);
      }
    }
  }

  for (const entry of game.eventLog) {
    const event = entry.event;
    if (!isMatchingCheerEvent(event, playerId, eventScope, eventIdSet)) {
      continue;
    }
    for (const cardId of event.revealedCardIds) {
      if (currentCheerCardIdSet.has(cardId)) {
        revealedCardIds.add(cardId);
      }
    }
  }

  return revealedCardIds;
}

function isMatchingCheerEvent(
  event: GameState['eventLog'][number]['event'],
  playerId: string,
  eventScope: CurrentLiveRevealedCheerEventScope,
  eventIdSet: ReadonlySet<string> | null
): event is CheerEvent {
  if (
    event.eventType !== TriggerCondition.ON_CHEER ||
    !('playerId' in event) ||
    !('revealedCardIds' in event) ||
    event.playerId !== playerId
  ) {
    return false;
  }
  if (eventIdSet !== null && !eventIdSet.has(event.eventId)) {
    return false;
  }
  if (eventScope === 'NON_ADDITIONAL') {
    return event.additional !== true;
  }
  if (eventScope === 'ADDITIONAL_ONLY') {
    return event.additional === true;
  }
  return true;
}

function matchesCheerCardSelection(
  card: CardInstance,
  options: CurrentLiveRevealedCheerCardSelectionOptions
): boolean {
  const cardTypes = normalizeCardTypes(options.cardTypes);
  if (cardTypes.length > 0 && !cardTypes.includes(card.data.cardType)) {
    return false;
  }
  if (
    options.groupAliases &&
    options.groupAliases.length > 0 &&
    !options.groupAliases.some((groupAlias) => cardBelongsToGroup(card.data, groupAlias))
  ) {
    return false;
  }
  if (
    options.unitAliases &&
    options.unitAliases.length > 0 &&
    !options.unitAliases.some((unitAlias) => cardBelongsToUnit(card.data, unitAlias))
  ) {
    return false;
  }
  return options.predicate ? options.predicate(card) : true;
}

function normalizeCardTypes(cardTypes?: CardType | readonly CardType[]): readonly CardType[] {
  if (!cardTypes) {
    return [];
  }
  return typeof cardTypes === 'string' ? [cardTypes] : [...cardTypes];
}
