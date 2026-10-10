import {
  addAction,
  getCardById,
  getStageMemberObservations,
  type GameState,
  type StageMemberObservation,
} from '../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../shared/utils/card-code.js';

export interface StateTriggerObserverContext {
  readonly stageMembers: readonly StageMemberObservation[];
  readonly eventIds: readonly string[];
}

type StateTriggerObserver = (game: GameState, context: StateTriggerObserverContext) => GameState;
interface ObserverRegistration {
  readonly baseCardCodes: readonly string[];
  readonly observer: StateTriggerObserver;
}
const observers = new Map<string, ObserverRegistration>();
const DISPATCH_SCOPE = 'STATE_TRIGGER_OBSERVERS';

export function registerStateTriggerObserver(
  abilityId: string,
  baseCardCodes: readonly string[],
  observer: StateTriggerObserver
): void {
  observers.set(abilityId, { baseCardCodes, observer });
}

/** Captures state triggers into the live pending pool; never starts another resolver. */
export function enqueueStateTriggeredCardEffects(game: GameState): GameState {
  if (observers.size === 0) return game;
  const lastDispatch = [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'DISPATCH_TRIGGER_EVENT' && action.payload.scope === DISPATCH_SCOPE
    );
  const lastSequence =
    typeof lastDispatch?.payload.eventSequence === 'number'
      ? lastDispatch.payload.eventSequence
      : 0;
  const records = game.eventLog.filter(
    (entry) =>
      entry.sequence > lastSequence &&
      entry.stageMembersAfterEvent !== undefined &&
      [...observers.values()].some((registration) =>
        hasObserverSource(game, entry.stageMembersAfterEvent!, registration)
      )
  );
  let state = game;
  for (const record of records) {
    for (const registration of observers.values()) {
      if (!hasObserverSource(state, record.stageMembersAfterEvent!, registration)) continue;
      state = registration.observer(state, {
        stageMembers: record.stageMembersAfterEvent!,
        eventIds: [record.event.eventId],
      });
    }
  }
  if (records.length > 0) {
    // Mark even snapshots suppressed by an existing pending/active invocation as consumed.
    state = addAction(state, 'DISPATCH_TRIGGER_EVENT', null, {
      scope: DISPATCH_SCOPE,
      eventSequence: records.at(-1)!.sequence,
    });
  }
  // Initial fixtures and rules 9.7.6.1 still need a current-state check after resolution.
  const currentStageMembers = getStageMemberObservations(state);
  for (const registration of observers.values()) {
    if (!hasObserverSource(state, currentStageMembers, registration)) continue;
    state = registration.observer(state, { stageMembers: currentStageMembers, eventIds: [] });
  }
  return state;
}

function hasObserverSource(
  game: GameState,
  stageMembers: readonly StageMemberObservation[],
  registration: ObserverRegistration
): boolean {
  return stageMembers.some((source) => {
    const card = getCardById(game, source.sourceCardId);
    return (
      card !== null &&
      registration.baseCardCodes.some((baseCardCode) =>
        cardCodeMatchesBase(card.data.cardCode, baseCardCode)
      )
    );
  });
}
