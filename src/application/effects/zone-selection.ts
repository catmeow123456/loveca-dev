import type { CardInstance } from '../../domain/entities/card.js';
import type { ActiveEffectState, GameState } from '../../domain/entities/game.js';
import { getCardById, getPlayerById, updatePlayer } from '../../domain/entities/game.js';

export type ZoneCardSelectionSource = 'WAITING_ROOM';
export type ZoneCardSelectionDestination = 'HAND';

export interface ZoneCardSelectionConfig {
  readonly source: ZoneCardSelectionSource;
  readonly destination: ZoneCardSelectionDestination;
  readonly minCount: number;
  readonly maxCount: number;
  readonly optional: boolean;
}

export type ZoneCardPredicate = (card: CardInstance) => boolean;

export interface WaitingRoomToHandEffectStateConfig {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly effectText: string;
  readonly stepId: string;
  readonly awaitingPlayerId: string;
  readonly selectableCardIds: readonly string[];
  readonly stepText?: string;
  readonly canSkipSelection?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly zoneSelection?: ZoneCardSelectionConfig;
}

export function createWaitingRoomToHandSelectionConfig(
  overrides: Partial<ZoneCardSelectionConfig> = {}
): ZoneCardSelectionConfig {
  return {
    source: 'WAITING_ROOM',
    destination: 'HAND',
    minCount: 0,
    maxCount: 1,
    optional: true,
    ...overrides,
  };
}

export function selectWaitingRoomCardIds(
  game: GameState,
  playerId: string,
  predicate: ZoneCardPredicate
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && predicate(card);
  });
}

export function createWaitingRoomToHandEffectState(
  config: WaitingRoomToHandEffectStateConfig
): ActiveEffectState {
  const zoneSelection = config.zoneSelection ?? createWaitingRoomToHandSelectionConfig();
  return {
    id: config.id,
    abilityId: config.abilityId,
    sourceCardId: config.sourceCardId,
    controllerId: config.controllerId,
    effectText: config.effectText,
    stepId: config.stepId,
    stepText: config.stepText ?? config.effectText,
    awaitingPlayerId: config.awaitingPlayerId,
    selectableCardIds: config.selectableCardIds,
    canSkipSelection: config.canSkipSelection ?? zoneSelection.optional,
    metadata: {
      ...config.metadata,
      zoneSelection,
    },
  };
}

export function getZoneSelectionConfig(effect: ActiveEffectState): ZoneCardSelectionConfig {
  const zoneSelection = effect.metadata?.zoneSelection;
  if (
    zoneSelection &&
    typeof zoneSelection === 'object' &&
    'source' in zoneSelection &&
    'destination' in zoneSelection
  ) {
    const candidate = zoneSelection as Record<string, unknown>;
    const source = candidate.source;
    const destination = candidate.destination;
    if (source === 'WAITING_ROOM' && destination === 'HAND') {
      return {
        source,
        destination,
        minCount: typeof candidate.minCount === 'number' ? candidate.minCount : 0,
        maxCount: typeof candidate.maxCount === 'number' ? candidate.maxCount : 1,
        optional: candidate.optional === true,
      };
    }
  }

  return createWaitingRoomToHandSelectionConfig();
}

export function moveSelectedCardsFromZone(
  game: GameState,
  playerId: string,
  selectedCardIds: readonly string[],
  config: ZoneCardSelectionConfig
): GameState | null {
  if (config.source !== 'WAITING_ROOM' || config.destination !== 'HAND') {
    return null;
  }

  const player = getPlayerById(game, playerId);
  if (
    !player ||
    selectedCardIds.length < config.minCount ||
    selectedCardIds.length > config.maxCount ||
    new Set(selectedCardIds).size !== selectedCardIds.length ||
    !selectedCardIds.every((cardId) => player.waitingRoom.cardIds.includes(cardId))
  ) {
    return null;
  }

  return updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    waitingRoom: {
      ...currentPlayer.waitingRoom,
      cardIds: currentPlayer.waitingRoom.cardIds.filter(
        (cardId) => !selectedCardIds.includes(cardId)
      ),
    },
    hand: {
      ...currentPlayer.hand,
      cardIds: [...currentPlayer.hand.cardIds, ...selectedCardIds],
    },
  }));
}
