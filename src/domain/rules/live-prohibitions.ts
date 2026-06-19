import { updatePlayer, type GameState, type LiveProhibitionState } from '../entities/game.js';
import { addCardToZone } from '../entities/zone.js';

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
  return game.liveProhibitions.some((prohibition) => prohibition.playerId === playerId);
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
