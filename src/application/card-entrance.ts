import { getCardById, type GameState } from '../domain/entities/game.js';
import { OrientationState, TriggerCondition } from '../shared/types/enums.js';
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
  const doubleRelays = cardIds.flatMap((cardId) => {
    const entry = [...entries]
      .reverse()
      .find(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE && event.cardInstanceId === cardId
      )?.event;
    if (
      entry?.eventType !== TriggerCondition.ON_ENTER_STAGE ||
      !('relayReplacements' in entry) ||
      entry.relayReplacements?.length !== 2
    )
      return [];
    return [
      {
        cardId,
        sources: entry.relayReplacements.map(({ cardId, slot, orientation }) => ({
          cardId,
          slot,
          orientation: orientation ?? OrientationState.ACTIVE,
        })),
      },
    ];
  });
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
            ...(doubleRelays.length ? { doubleRelays } : {}),
          }
        : null,
    },
  };
}
