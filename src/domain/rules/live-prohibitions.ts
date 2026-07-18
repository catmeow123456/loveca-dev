import {
  getCardById,
  updatePlayer,
  type GameState,
  type LiveProhibitionState,
} from '../entities/game.js';
import { addCardToZone } from '../entities/zone.js';
import { CardType, SlotPosition } from '../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';

interface ContinuousLiveProhibitionDefinition {
  readonly baseCardCode: string;
  readonly condition: 'NO_OTHER_OWN_TOP_LEVEL_STAGE_MEMBER';
}

export interface ContinuousLiveProhibitionSource {
  readonly playerId: string;
  readonly sourceCardId: string;
  readonly baseCardCode: string;
}

const MAIN_STAGE_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

const CONTINUOUS_LIVE_PROHIBITION_DEFINITIONS: readonly ContinuousLiveProhibitionDefinition[] = [
  {
    baseCardCode: 'PL!SP-bp1-001',
    condition: 'NO_OTHER_OWN_TOP_LEVEL_STAGE_MEMBER',
  },
];

export interface AddLiveProhibitionOptions {
  readonly playerId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
}

export function addLiveProhibitionUntilLiveEnd(
  game: GameState,
  options: AddLiveProhibitionOptions
): GameState {
  const prohibition: LiveProhibitionState = {
    playerId: options.playerId,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
    expiresAt: 'LIVE_END',
  };

  return {
    ...game,
    liveProhibitions: [
      ...game.liveProhibitions.filter(
        (candidate) =>
          !(
            candidate.playerId === prohibition.playerId &&
            candidate.sourceCardId === prohibition.sourceCardId &&
            candidate.abilityId === prohibition.abilityId
          )
      ),
      prohibition,
    ],
  };
}

export function isPlayerLiveProhibited(game: GameState, playerId: string): boolean {
  return (
    game.liveProhibitions.some((prohibition) => prohibition.playerId === playerId) ||
    isPlayerContinuouslyLiveProhibited(game, playerId)
  );
}

export function collectContinuousLiveProhibitionSources(
  game: GameState,
  playerId: string
): readonly ContinuousLiveProhibitionSource[] {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return [];
  }

  const ownTopLevelMemberIds = MAIN_STAGE_SLOTS.map(
    (slot) => player.memberSlots.slots[slot]
  ).filter((cardId): cardId is string => {
    if (!cardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card?.ownerId === playerId && card.data.cardType === CardType.MEMBER;
  });

  const sources: ContinuousLiveProhibitionSource[] = [];
  for (const sourceCardId of ownTopLevelMemberIds) {
    const sourceCard = getCardById(game, sourceCardId);
    if (!sourceCard) {
      continue;
    }

    for (const definition of CONTINUOUS_LIVE_PROHIBITION_DEFINITIONS) {
      if (!cardCodeMatchesBase(sourceCard.data.cardCode, definition.baseCardCode)) {
        continue;
      }
      if (
        definition.condition === 'NO_OTHER_OWN_TOP_LEVEL_STAGE_MEMBER' &&
        ownTopLevelMemberIds.some((cardId) => cardId !== sourceCardId)
      ) {
        continue;
      }

      sources.push({
        playerId,
        sourceCardId,
        baseCardCode: definition.baseCardCode,
      });
    }
  }
  return sources;
}

export function isPlayerContinuouslyLiveProhibited(game: GameState, playerId: string): boolean {
  return collectContinuousLiveProhibitionSources(game, playerId).length > 0;
}

export function clearLiveProhibitionsUntilLiveEnd(game: GameState): GameState {
  if (game.liveProhibitions.length === 0) {
    return game;
  }
  return {
    ...game,
    liveProhibitions: game.liveProhibitions.filter(
      (prohibition) => prohibition.expiresAt !== 'LIVE_END'
    ),
  };
}

export function liveProhibitedPlayerLiveZoneToWaitingRoom(
  game: GameState,
  playerId: string
): GameState {
  if (!isPlayerLiveProhibited(game, playerId)) {
    return game;
  }

  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player || player.liveZone.cardIds.length === 0) {
    return game;
  }

  return updatePlayer(game, playerId, (currentPlayer) => {
    let waitingRoom = currentPlayer.waitingRoom;
    for (const cardId of currentPlayer.liveZone.cardIds) {
      waitingRoom = addCardToZone(waitingRoom, cardId);
    }

    return {
      ...currentPlayer,
      liveZone: {
        ...currentPlayer.liveZone,
        cardIds: [],
        cardStates: new Map(),
      },
      waitingRoom,
    };
  });
}
