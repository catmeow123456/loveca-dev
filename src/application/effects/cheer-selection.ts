import {
  isLiveCardData,
  isMemberCardData,
  type BladeHeartItem,
  type CardInstance,
} from '../../domain/entities/card.js';
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
import { getCheerCardEffectiveBladeHearts } from '../../domain/rules/live-modifiers.js';
import {
  BladeHeartEffect,
  HeartColor,
  TriggerCondition,
  type CardType,
} from '../../shared/types/enums.js';
import {
  cardBelongsToGroup,
  cardBelongsToUnit,
  getNormalizedCardNameCandidates,
  selectDifferentNamedCards,
} from '../../shared/utils/card-identity.js';

export type CheerCardPredicate = (card: CardInstance) => boolean;
export type CurrentLiveRevealedCheerEventScope = 'ALL' | 'NON_ADDITIONAL' | 'ADDITIONAL_ONLY';
export type RevealedCheerCardDestination =
  'HAND' | 'MAIN_DECK_TOP' | 'MAIN_DECK_BOTTOM' | 'WAITING_ROOM';

export interface CurrentLiveRevealedCheerCardSelectionOptions {
  readonly predicate?: CheerCardPredicate;
  readonly cardTypes?: CardType | readonly CardType[];
  readonly groupAliases?: readonly string[];
  readonly unitAliases?: readonly string[];
  readonly eventScope?: CurrentLiveRevealedCheerEventScope;
  readonly eventIds?: readonly string[];
}

export interface CurrentLiveRevealedCheerCardConditionOptions extends CurrentLiveRevealedCheerCardSelectionOptions {
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

export interface CurrentLiveDifferentNamedStageAndCheerMemberResult {
  readonly candidateCardIds: readonly string[];
  readonly selectedCardIds: readonly string[];
  readonly differentNameCount: number;
  readonly normalizedNames: readonly string[];
}

export interface MoveRevealedCheerCardsResult {
  readonly gameState: GameState;
  readonly movedCardIds: readonly string[];
}

export interface DistinctCheerHeartColorAssignment {
  readonly color: HeartColor;
  readonly cardId: string;
}

export interface DistinctCheerCardsCoverHeartColorsResult {
  readonly matchingCardIds: readonly string[];
  readonly candidateCardIdsByColor: ReadonlyMap<HeartColor, readonly string[]>;
  readonly candidateCountsByColor: ReadonlyMap<HeartColor, number>;
  readonly conditionMet: boolean;
  readonly assignment: readonly DistinctCheerHeartColorAssignment[];
  readonly matchedCardIds: readonly string[];
}

export interface CurrentLiveRevealedCheerCardEffectiveBladeHearts {
  readonly cardId: string;
  readonly card: CardInstance;
  readonly effectiveBladeHearts: readonly BladeHeartItem[];
}

/**
 * Returns the current LIVE's event-inclusive revealed-cheer cards together with their effective
 * Blade Hearts. This is the shared fact layer for consumers that need either a color union or a
 * distinct-card assignment after current LIVE modifiers have been applied.
 */
export function selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts(
  game: GameState,
  playerId: string,
  options: CurrentLiveRevealedCheerCardSelectionOptions = {}
): readonly CurrentLiveRevealedCheerCardEffectiveBladeHearts[] {
  const uniqueCardIds = [
    ...new Set(selectCurrentLiveRevealedCheerCardIds(game, playerId, options)),
  ];

  return uniqueCardIds.flatMap((cardId) => {
    const card = getCardById(game, cardId);
    if (!card || card.ownerId !== playerId) {
      return [];
    }
    return [
      {
        cardId,
        card,
        effectiveBladeHearts: getCheerCardEffectiveBladeHearts(game, playerId, cardId),
      },
    ];
  });
}

/**
 * Collects structured Blade Heart colors from the current LIVE's event-inclusive revealed-cheer
 * facts. Cards moved out of the resolution zone remain facts; DRAW/SCORE Blade Hearts never count.
 */
export function collectCurrentLiveRevealedCheerBladeHeartColors(
  game: GameState,
  playerId: string,
  options: { readonly includedColors?: readonly HeartColor[] } = {}
): ReadonlySet<HeartColor> {
  const includedColors = options.includedColors
    ? new Set<HeartColor>(options.includedColors)
    : null;
  const colors = new Set<HeartColor>();

  for (const {
    card,
    effectiveBladeHearts,
  } of selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts(game, playerId)) {
    if (!isMemberCardData(card.data) && !isLiveCardData(card.data)) {
      continue;
    }
    for (const bladeHeart of effectiveBladeHearts) {
      if (
        bladeHeart.effect === BladeHeartEffect.HEART &&
        bladeHeart.heartColor !== undefined &&
        (includedColors === null || includedColors.has(bladeHeart.heartColor))
      ) {
        colors.add(bladeHeart.heartColor);
      }
    }
  }

  return colors;
}

/**
 * Evaluates event-inclusive current-cheer facts using each card's effective colored judgment
 * Hearts. Ordinary printed member Hearts and non-HEART Blade effects never count.
 */
export function evaluateDistinctCheerCardsCoverHeartColors(
  game: GameState,
  playerId: string,
  options: {
    readonly requiredColors: readonly HeartColor[];
    readonly groupAlias: string;
    readonly cardType: CardType;
  }
): DistinctCheerCardsCoverHeartColorsResult {
  const matchingCards = selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts(
    game,
    playerId,
    {
      cardTypes: options.cardType,
      groupAliases: [options.groupAlias],
    }
  );
  const matchingCardIds = matchingCards.map(({ cardId }) => cardId);
  const candidateCardIdsByColor = new Map<HeartColor, readonly string[]>();

  for (const color of options.requiredColors) {
    candidateCardIdsByColor.set(
      color,
      matchingCards
        .filter(
          ({ card, effectiveBladeHearts }) =>
            isMemberCardData(card.data) &&
            effectiveBladeHearts.some(
              (bladeHeart) =>
                bladeHeart.effect === BladeHeartEffect.HEART && bladeHeart.heartColor === color
            )
        )
        .map(({ cardId }) => cardId)
    );
  }

  const assignment = findDistinctHeartColorAssignment(
    options.requiredColors,
    candidateCardIdsByColor
  );
  return {
    matchingCardIds,
    candidateCardIdsByColor,
    candidateCountsByColor: new Map(
      [...candidateCardIdsByColor].map(([color, cardIds]) => [color, cardIds.length])
    ),
    conditionMet: assignment.length === options.requiredColors.length,
    assignment,
    matchedCardIds: assignment.map((entry) => entry.cardId),
  };
}

function findDistinctHeartColorAssignment(
  requiredColors: readonly HeartColor[],
  candidatesByColor: ReadonlyMap<HeartColor, readonly string[]>
): readonly DistinctCheerHeartColorAssignment[] {
  const usedCardIds = new Set<string>();
  const assignment: DistinctCheerHeartColorAssignment[] = [];

  const search = (colorIndex: number): boolean => {
    if (colorIndex >= requiredColors.length) {
      return true;
    }
    const color = requiredColors[colorIndex];
    if (color === undefined) {
      return true;
    }
    for (const cardId of candidatesByColor.get(color) ?? []) {
      if (usedCardIds.has(cardId)) {
        continue;
      }
      usedCardIds.add(cardId);
      assignment.push({ color, cardId });
      if (search(colorIndex + 1)) {
        return true;
      }
      assignment.pop();
      usedCardIds.delete(cardId);
    }
    return false;
  };

  return search(0) ? assignment : [];
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

/**
 * Counts different member names across the controller's current top-level stage members and the
 * current LIVE's event-inclusive revealed-cheer facts. The union is matched once so a name shown
 * in both places contributes only once; member-below cards are intentionally outside the query.
 */
export function selectCurrentLiveDifferentNamedStageAndCheerMembers(
  game: GameState,
  playerId: string,
  groupAlias: string
): CurrentLiveDifferentNamedStageAndCheerMemberResult {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return {
      candidateCardIds: [],
      selectedCardIds: [],
      differentNameCount: 0,
      normalizedNames: [],
    };
  }

  const stageCardIds = Object.values(player.memberSlots.slots).filter(
    (cardId): cardId is string => typeof cardId === 'string'
  );
  const cheerCardIds = selectCurrentLiveRevealedCheerCardIds(game, playerId, {
    predicate: (card) => isMemberCardData(card.data) && cardBelongsToGroup(card.data, groupAlias),
  });
  const candidateCardIds = [...new Set([...stageCardIds, ...cheerCardIds])].filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === playerId &&
      isMemberCardData(card.data) &&
      cardBelongsToGroup(card.data, groupAlias)
    );
  });
  const selected = selectDifferentNamedCards(
    candidateCardIds,
    (cardId) => getCardById(game, cardId)?.data ?? null,
    {
      groupName: groupAlias,
      minCount: 0,
      getSecondaryKey: (cardId) => cardId,
    }
  );

  return {
    candidateCardIds,
    selectedCardIds: selected.map((match) => match.item),
    differentNameCount: selected.length,
    normalizedNames: selected.map((match) => match.normalizedName),
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
  const movableCardIdSet = new Set(selectRevealedCheerCardIds(game, playerId));
  if (
    uniqueCardIds.length !== cardIds.length ||
    uniqueCardIds.some((cardId) => !movableCardIdSet.has(cardId))
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
