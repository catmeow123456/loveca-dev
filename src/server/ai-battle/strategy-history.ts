import type { AiDecisionSelection } from '../../application/ai-decisions/index.js';
import type { Seat } from '../../online/index.js';
import type {
  AiObservedAction,
  AiObservedCandidate,
  AiObservedCard,
  AiObservation,
} from './ai-observation.js';
import type { AuditableAiDecisionResult } from './strategy-decision-audit.js';

export const AI_SELECTED_HISTORY_SCHEMA_VERSION = 'ai-battle.selected-history/v2' as const;
export const AI_SELECTED_HISTORY_DEFAULT_LIMIT = 12;

export type AiSelectedHistoryCategory =
  | 'MULLIGAN'
  | 'MEMBER_PLAY'
  | 'ABILITY'
  | 'LIVE_SET'
  | 'SUCCESS_LIVE'
  | 'RESOURCE_PAYMENT'
  | 'EFFECT_SELECTION'
  | 'FORMATION'
  | 'VISIBLE_STATE_CHANGE';

type AiSelectedDecisionHistoryCategory = Exclude<AiSelectedHistoryCategory, 'VISIBLE_STATE_CHANGE'>;

export interface AiSelectedHistoryCard {
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: string;
  readonly cost?: number;
  readonly score?: number;
}

interface AiSelectedHistoryItemBase {
  readonly schemaVersion: typeof AI_SELECTED_HISTORY_SCHEMA_VERSION;
  readonly historyId: string;
  readonly authorityRevision: number;
  readonly turnCount: number;
  readonly category: AiSelectedHistoryCategory;
  readonly reasonCode: string;
  readonly summary: string;
  readonly cards: readonly AiSelectedHistoryCard[];
}

export interface AiSelectedDecisionHistoryItem extends AiSelectedHistoryItemBase {
  readonly actorSeat: Seat;
  readonly category: AiSelectedDecisionHistoryCategory;
}

export interface AiSelectedVisibleStateHistoryItem extends AiSelectedHistoryItemBase {
  readonly affectedSeat: Seat;
  readonly category: 'VISIBLE_STATE_CHANGE';
}

export type AiSelectedHistoryItem =
  AiSelectedDecisionHistoryItem | AiSelectedVisibleStateHistoryItem;

type AiSelectedHistoryDraft =
  | Omit<AiSelectedDecisionHistoryItem, 'schemaVersion' | 'historyId'>
  | Omit<AiSelectedVisibleStateHistoryItem, 'schemaVersion' | 'historyId'>;

export interface AiSelectedHistoryTracker {
  /**
   * Records visible public-zone deltas and returns the bounded history that may
   * be attached to the next strategy context.
   */
  observe(observation: AiObservation): readonly AiSelectedHistoryItem[];
  /**
   * Records an accepted strategy decision. Call only after the authority
   * command succeeds so rejected or stale plans never enter future context.
   */
  recordAcceptedDecision(observation: AiObservation, result: AuditableAiDecisionResult): void;
  snapshot(): readonly AiSelectedHistoryItem[];
}

interface VisibleSnapshot {
  readonly authorityRevision: number;
  readonly turnCount: number;
  readonly zoneCards: ReadonlyMap<string, ReadonlyMap<string, VisibleCardCount>>;
}

interface VisibleCardCount {
  readonly card: AiSelectedHistoryCard;
  readonly count: number;
}

/**
 * Creates a seat-local selected-history tracker.
 *
 * The tracker accepts only already-redacted observations and accepted
 * structured decisions. It cannot read authority state, event logs, match
 * runtime records, chat, display names, or authority object IDs.
 */
export function createAiSelectedHistoryTracker(
  viewerSeat: Seat,
  limit = AI_SELECTED_HISTORY_DEFAULT_LIMIT
): AiSelectedHistoryTracker {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('AI selected-history limit must be a positive integer');
  }

  const items: AiSelectedHistoryItem[] = [];
  let sequence = 0;
  let previousSnapshot: VisibleSnapshot | null = null;

  const append = (item: AiSelectedHistoryDraft): void => {
    sequence += 1;
    items.push({
      schemaVersion: AI_SELECTED_HISTORY_SCHEMA_VERSION,
      historyId: `history-${String(sequence)}`,
      ...item,
    });
    if (items.length > limit) {
      items.splice(0, items.length - limit);
    }
  };

  return {
    observe(observation) {
      assertViewerSeat(observation, viewerSeat);
      const nextSnapshot = captureVisibleSnapshot(observation);
      if (previousSnapshot) {
        for (const change of selectVisibleStateChanges(
          previousSnapshot,
          nextSnapshot,
          viewerSeat
        )) {
          append(change);
        }
      }
      previousSnapshot = nextSnapshot;
      return cloneHistory(items);
    },
    recordAcceptedDecision(observation, result) {
      assertViewerSeat(observation, viewerSeat);
      const item = selectAcceptedDecisionHistory(observation, result);
      if (item) append(item);
    },
    snapshot() {
      return cloneHistory(items);
    },
  };
}

function selectAcceptedDecisionHistory(
  observation: AiObservation,
  result: AuditableAiDecisionResult
): Omit<AiSelectedDecisionHistoryItem, 'schemaVersion' | 'historyId'> | null {
  const decision = observation.decision;
  const selection = result.selection;
  const selectedCards = cardsForSelection(decision.candidates, decision.actions, selection);
  const base = {
    authorityRevision: observation.authorityRevision,
    turnCount: observation.turn.count,
    actorSeat: observation.viewerSeat,
    reasonCode: result.reasonCode,
    summary: result.summary,
    cards: selectedCards,
  } as const;

  switch (selection.kind) {
    case 'MULLIGAN':
      return { ...base, category: 'MULLIGAN' };
    case 'PAY_COST':
      return { ...base, category: 'RESOURCE_PAYMENT' };
    case 'SELECT_MAIN_PHASE_ACTION': {
      const action = decision.actions.find(
        (candidate) => candidate.actionId === selection.actionId
      );
      if (action?.kind === 'PLAY_MEMBER') return { ...base, category: 'MEMBER_PLAY' };
      if (action?.kind === 'ACTIVATE_ABILITY') return { ...base, category: 'ABILITY' };
      return null;
    }
    case 'SELECT_LIVE_SET_ACTION': {
      const action = decision.actions.find(
        (candidate) => candidate.actionId === selection.actionId
      );
      return action?.kind === 'SET_LIVE' ? { ...base, category: 'LIVE_SET' } : null;
    }
    case 'SELECT_SUCCESS_LIVE':
      return { ...base, category: 'SUCCESS_LIVE' };
    case 'SELECT_EFFECT_CARDS':
    case 'SELECT_EFFECT_OPTIONS':
    case 'SELECT_EFFECT_SLOT':
    case 'SELECT_EFFECT_NUMBER':
      return { ...base, category: 'EFFECT_SELECTION' };
    case 'SET_STAGE_FORMATION':
      return { ...base, category: 'FORMATION' };
    case 'CONFIRM_SPECIAL_MEMBER_PLAY':
      return { ...base, category: 'MEMBER_PLAY' };
    case 'CONFIRM_EFFECT':
    case 'CONFIRM_DEADLINE':
    case 'RESOLVE_ABILITIES_IN_ORDER':
    case 'CONFIRM_JUDGMENT':
    case 'CONFIRM_SCORE':
    case 'CONFIRM_PHASE':
    case 'CANCEL_SPECIAL_MEMBER_PLAY':
      return null;
  }
}

function cardsForSelection(
  candidates: readonly AiObservedCandidate[],
  actions: readonly AiObservedAction[],
  selection: AiDecisionSelection
): readonly AiSelectedHistoryCard[] {
  const candidateIds = selectedCandidateIds(actions, selection);
  return candidateIds.flatMap((candidateId) => {
    const card = candidates.find((candidate) => candidate.candidateId === candidateId)?.card;
    return card ? [toHistoryCard(card)] : [];
  });
}

function selectedCandidateIds(
  actions: readonly AiObservedAction[],
  selection: AiDecisionSelection
): readonly string[] {
  switch (selection.kind) {
    case 'MULLIGAN':
    case 'PAY_COST':
    case 'CONFIRM_SPECIAL_MEMBER_PLAY':
    case 'SELECT_EFFECT_CARDS':
      return selection.candidateIds;
    case 'SELECT_SUCCESS_LIVE':
      return [selection.candidateId];
    case 'SELECT_MAIN_PHASE_ACTION':
    case 'SELECT_LIVE_SET_ACTION': {
      const candidateId = actions.find(
        (action) => action.actionId === selection.actionId
      )?.candidateId;
      return candidateId ? [candidateId] : [];
    }
    case 'SET_STAGE_FORMATION':
      return selection.placements.map((placement) => placement.candidateId);
    case 'SELECT_EFFECT_OPTIONS':
    case 'SELECT_EFFECT_SLOT':
    case 'SELECT_EFFECT_NUMBER':
    case 'CONFIRM_EFFECT':
    case 'CONFIRM_DEADLINE':
    case 'RESOLVE_ABILITIES_IN_ORDER':
    case 'CONFIRM_JUDGMENT':
    case 'CONFIRM_SCORE':
    case 'CONFIRM_PHASE':
    case 'CANCEL_SPECIAL_MEMBER_PLAY':
      return [];
  }
}

function captureVisibleSnapshot(observation: AiObservation): VisibleSnapshot {
  const zoneCards = new Map<string, ReadonlyMap<string, VisibleCardCount>>();
  for (const seat of ['FIRST', 'SECOND'] as const) {
    for (const zone of observation.seats[seat].zones) {
      if (!isSelectedHistoryPublicZone(zone.zoneKey)) continue;
      const counts = new Map<string, VisibleCardCount>();
      for (const card of zone.visibleCards) {
        const key = visibleCardKey(card);
        const previous = counts.get(key);
        counts.set(key, {
          card: toHistoryCard(card),
          count: (previous?.count ?? 0) + 1,
        });
      }
      zoneCards.set(`${seat}:${zone.zoneKey}`, counts);
    }
  }
  return {
    authorityRevision: observation.authorityRevision,
    turnCount: observation.turn.count,
    zoneCards,
  };
}

function selectVisibleStateChanges(
  previous: VisibleSnapshot,
  next: VisibleSnapshot,
  viewerSeat: Seat
): readonly Omit<AiSelectedVisibleStateHistoryItem, 'schemaVersion' | 'historyId'>[] {
  const changes: Omit<AiSelectedVisibleStateHistoryItem, 'schemaVersion' | 'historyId'>[] = [];
  for (const [zoneRef, nextCards] of next.zoneCards) {
    const previousCards = previous.zoneCards.get(zoneRef) ?? new Map<string, VisibleCardCount>();
    const [affectedSeat, zoneKey] = zoneRef.split(':') as [Seat, string];
    const added: AiSelectedHistoryCard[] = [];
    for (const [key, nextCount] of nextCards) {
      const addedCount = nextCount.count - (previousCards.get(key)?.count ?? 0);
      for (let index = 0; index < addedCount; index += 1) added.push(nextCount.card);
    }
    if (added.length === 0) continue;
    const side = affectedSeat === viewerSeat ? 'your' : "the opponent's";
    const label = zoneKey.startsWith('MEMBER_')
      ? `A card is newly visible in ${side} stage area.`
      : zoneKey === 'SUCCESS_ZONE'
        ? `A LIVE card is newly visible in ${side} success zone.`
        : zoneKey === 'WAITING_ROOM'
          ? `A card is newly visible in ${side} waiting room.`
          : `A card is newly visible in ${side} LIVE zone.`;
    changes.push({
      authorityRevision: next.authorityRevision,
      turnCount: next.turnCount,
      affectedSeat,
      category: 'VISIBLE_STATE_CHANGE',
      reasonCode: `VISIBLE_${zoneKey}_ADDITION`,
      summary: label,
      cards: added,
    });
  }
  return changes;
}

function isSelectedHistoryPublicZone(zoneKey: string): boolean {
  return (
    zoneKey.startsWith('MEMBER_') ||
    zoneKey === 'LIVE_ZONE' ||
    zoneKey === 'SUCCESS_ZONE' ||
    zoneKey === 'WAITING_ROOM'
  );
}

function visibleCardKey(card: AiObservedCard): string {
  return [card.cardCode, card.slot ?? '', card.role ?? '', card.faceState ?? ''].join('|');
}

function toHistoryCard(card: AiObservedCard): AiSelectedHistoryCard {
  return {
    cardCode: card.cardCode,
    name: card.name,
    cardType: card.cardType,
    ...(card.cost === undefined ? {} : { cost: card.cost }),
    ...(card.score === undefined ? {} : { score: card.score }),
  };
}

function assertViewerSeat(observation: AiObservation, viewerSeat: Seat): void {
  if (observation.viewerSeat !== viewerSeat) {
    throw new Error(
      `AI selected-history seat mismatch: tracker=${viewerSeat}, observation=${observation.viewerSeat}`
    );
  }
}

function cloneHistory(items: readonly AiSelectedHistoryItem[]): readonly AiSelectedHistoryItem[] {
  return items.map((item) => ({
    ...item,
    cards: item.cards.map((card) => ({ ...card })),
  }));
}
