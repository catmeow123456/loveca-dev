import { getCardById, type GameState } from '../domain/entities/game.js';
import { TriggerCondition } from '../shared/types/enums.js';
import { isEntranceCard } from '../shared/card-entrance.js';

/** Pause only at an atomic effect boundary; never split a cost or a workflow mutation. */
export function captureCardEntrance(game: GameState): GameState {
  const runtime = game.entranceRuntime;
  if (!runtime || runtime.pending || game.isEnded) return game;
  const entries = game.eventLog.filter((e) => e.sequence > runtime.seenSequence);
  if (!entries.length) return game;
  const cardIds = [
    ...new Set(
      entries.flatMap(({ event }) => {
        if (event.eventType !== TriggerCondition.ON_ENTER_STAGE) return [];
        const card = getCardById(game, event.cardInstanceId);
        const onStage = game.players.some((p) =>
          Object.values(p.memberSlots.slots).includes(event.cardInstanceId)
        );
        return card && onStage && isEntranceCard(card.data.cardCode) ? [event.cardInstanceId] : [];
      })
    ),
  ];
  const generation = runtime.generation + (cardIds.length ? 1 : 0);
  return {
    ...game,
    entranceRuntime: {
      ...runtime,
      generation,
      seenSequence: game.eventSequence,
      pending: cardIds.length
        ? {
            id: `entrance:${game.gameId}:${game.eventSequence}:${game.actionSequence}:${generation}`,
            cardIds,
            waitingPlayerIds: game.players.map((p) => p.id),
            deadlineAt: 0,
          }
        : null,
    },
  };
}
