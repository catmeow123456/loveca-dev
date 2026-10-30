import {
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../domain/entities/game.js';
import { FaceState, OrientationState, TriggerCondition } from '../shared/types/enums.js';
import { N_BP7_011_CONTINUOUS_PLAY_SHUFFLE_WAITING_MEMBERS_COST_MINUS_TWO_ABILITY_ID } from './card-effects/ability-ids.js';
import { entranceCards, isEntranceCard, IZUMI_REPLAY_CARD_BASE } from '../shared/card-entrance.js';
import { cardCodeMatchesBase } from '../shared/utils/card-code.js';
import { isCurrentStageMemberAbilitySource } from './card-effects/runtime/source-member.js';
import { cardNameAliasIs } from './effects/card-selectors.js';
import type { SlotPosition } from '../shared/types/enums.js';

/** Called by Izumi only after the same member successfully returns to its original slot. */
export function captureIzumiReplay(
  before: GameState,
  after: GameState,
  effect: ActiveEffectState,
  targetCardId: string,
  slot: SlotPosition
): GameState {
  const runtime = after.entranceRuntime;
  const source = getCardById(after, effect.sourceCardId);
  const previous = getPlayerById(before, effect.controllerId);
  const current = getPlayerById(after, effect.controllerId);
  if (
    !runtime ||
    runtime.pending ||
    after.isEnded ||
    !source ||
    !cardCodeMatchesBase(source.data.cardCode, IZUMI_REPLAY_CARD_BASE) ||
    previous?.memberSlots.slots[slot] !== targetCardId ||
    current?.memberSlots.slots[slot] !== targetCardId
  )
    return after;
  const generation = runtime.generation + 1;
  return {
    ...after,
    entranceRuntime: {
      ...runtime,
      generation,
      seenSequence: after.eventSequence,
      pending: {
        id: `izumi-replay:${after.gameId}:${after.eventSequence}:${generation}`,
        cardIds: [targetCardId],
        waitingPlayerIds: after.players.map((p) => p.id),
        deadlineAt: 0,
        izumiReplay: {
          sourceCardId: effect.sourceCardId,
          targetCardId,
          playerId: effect.controllerId,
          slot,
          previousOrientation:
            previous.memberSlots.cardStates.get(targetCardId)?.orientation ??
            OrientationState.ACTIVE,
        },
      },
    },
  };
}

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
  const kahoRelays = cardIds.flatMap((cardId) => {
    const card = getCardById(game, cardId);
    if (!card || !cardCodeMatchesBase(card.data.cardCode, entranceCards.ginko)) return [];
    const event = [...entries]
      .reverse()
      .find(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE && event.cardInstanceId === cardId
      )?.event;
    if (event?.eventType !== TriggerCondition.ON_ENTER_STAGE || !('relayReplacements' in event))
      return [];
    const source = event.relayReplacements?.find((replacement) => {
      const replaced = getCardById(game, replacement.cardId);
      return replaced && cardNameAliasIs('日野下花帆')(replaced);
    });
    return source
      ? [
          {
            cardId,
            source: {
              cardId: source.cardId,
              slot: source.slot,
              orientation: source.orientation ?? OrientationState.ACTIVE,
            },
          },
        ]
      : [];
  });
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
            ...(kahoRelays.length ? { kahoRelays } : {}),
            ...(waitingRoomReturns.length ? { waitingRoomReturns } : {}),
          }
        : null,
    },
  };
}

/** Called only after a successful atomic movement, never from inferred client zone differences. */
export function captureRinaLiveSwap(
  before: GameState,
  after: GameState,
  effect: ActiveEffectState,
  liveCardId: string,
  phase: 'RETURN' | 'PLACE'
): GameState {
  const runtime = after.entranceRuntime;
  const host = getCardById(after, effect.sourceCardId);
  const live = getCardById(after, liveCardId);
  const previousPlayer = getPlayerById(before, effect.controllerId);
  const player = getPlayerById(after, effect.controllerId);
  if (
    !runtime ||
    runtime.pending ||
    after.isEnded ||
    !host ||
    !live ||
    !player ||
    !previousPlayer ||
    !cardCodeMatchesBase(host.data.cardCode, entranceCards.rina) ||
    !isCurrentStageMemberAbilitySource(after, effect) ||
    (phase === 'RETURN'
      ? previousPlayer.liveZone.cardStates.get(liveCardId)?.face !== FaceState.FACE_UP ||
        player.mainDeck.cardIds[0] !== liveCardId
      : !previousPlayer.waitingRoom.cardIds.includes(liveCardId) ||
        player.liveZone.cardStates.get(liveCardId)?.face !== FaceState.FACE_UP)
  )
    return after;
  const liveIndex = (phase === 'RETURN' ? previousPlayer : player).liveZone.cardIds.indexOf(
    liveCardId
  );
  if (liveIndex < 0) return after;
  const generation = runtime.generation + 1;
  return {
    ...after,
    entranceRuntime: {
      ...runtime,
      generation,
      seenSequence: after.eventSequence,
      pending: {
        id: `rina-live:${after.gameId}:${after.actionSequence}:${generation}`,
        cardIds: [effect.sourceCardId],
        waitingPlayerIds: after.players.map((p) => p.id),
        deadlineAt: 0,
        rinaLiveSwap: {
          hostCardId: effect.sourceCardId,
          liveCardId,
          liveCardCode: live.data.cardCode,
          playerId: effect.controllerId,
          phase,
          liveIndex,
        },
      },
    },
  };
}
