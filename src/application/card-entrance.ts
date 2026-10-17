import { getCardById, type GameState } from '../domain/entities/game.js';
import { OrientationState, TriggerCondition } from '../shared/types/enums.js';
import { N_BP7_011_CONTINUOUS_PLAY_SHUFFLE_WAITING_MEMBERS_COST_MINUS_TWO_ABILITY_ID } from './card-effects/ability-ids.js';
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
  const waitingRoomReturns = cardIds.flatMap((cardId) => {
    const arrival = [...entries]
      .reverse()
      .find(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE && event.cardInstanceId === cardId
      );
    if (!arrival) return [];
    // Both events belong to this still-unseen atomic commit. Only Mia's actual
    // special-play payment can supply this prelude; a normal arrival cannot.
    const payment = [...entries]
      .reverse()
      .find(
        ({ event, sequence }) =>
          sequence < arrival.sequence &&
          event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK &&
          'movedCardIds' in event &&
          event.destination.kind === 'SHUFFLED_BOTTOM' &&
          event.cause.kind === 'CARD_EFFECT' &&
          event.cause.sourceCardId === cardId &&
          event.cause.abilityId ===
            N_BP7_011_CONTINUOUS_PLAY_SHUFFLE_WAITING_MEMBERS_COST_MINUS_TWO_ABILITY_ID
      )?.event;
    if (
      !payment ||
      !('movedCardIds' in payment) ||
      !('playerId' in payment) ||
      payment.playerId !== getCardById(game, cardId)?.ownerId
    )
      return [];
    // The payment event contains secret shuffled order. Strip it before the public snapshot.
    const members = [...payment.movedCardIds].sort().flatMap((id) => {
      const card = getCardById(game, id);
      return card ? [{ cardId: id, cardCode: card.data.cardCode }] : [];
    });
    return members.length ? [{ cardId, playerId: payment.playerId, members }] : [];
  });
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
            ...(waitingRoomReturns.length ? { waitingRoomReturns } : {}),
          }
        : null,
    },
  };
}
