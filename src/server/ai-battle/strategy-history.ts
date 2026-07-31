import type { AiDecisionSelection } from '../../application/ai-decisions/index.js';
import type { Seat } from '../../online/index.js';
import type {
  AiObservedAction,
  AiObservedCandidate,
  AiObservedCard,
  AiObservation,
} from './ai-observation.js';

export const AI_SELECTED_HISTORY_SCHEMA_VERSION = 'ai-battle.selected-history/v3' as const;
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
  readonly source: 'AUTHORITY_ACCEPTED_SELECTION' | 'VISIBLE_PROJECTION_DELTA';
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
  recordAcceptedDecision(
    observation: AiObservation,
    result: { readonly selection: AiDecisionSelection }
  ): void;
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
  result: { readonly selection: AiDecisionSelection }
): Omit<AiSelectedDecisionHistoryItem, 'schemaVersion' | 'historyId'> | null {
  const decision = observation.decision;
  const selection = result.selection;
  const selectedCards = cardsForSelection(decision.candidates, decision.actions, selection);
  const base = {
    authorityRevision: observation.authorityRevision,
    turnCount: observation.turn.count,
    actorSeat: observation.viewerSeat,
    source: 'AUTHORITY_ACCEPTED_SELECTION' as const,
    cards: selectedCards,
  } as const;

  switch (selection.kind) {
    case 'MULLIGAN':
      return {
        ...base,
        category: 'MULLIGAN',
        reasonCode: 'ACCEPTED_MULLIGAN_SELECTION',
        summary: `权威已接受换牌选择：换回 ${String(selection.candidateIds.length)} 张手牌。`,
      };
    case 'PAY_COST':
      return {
        ...base,
        category: 'RESOURCE_PAYMENT',
        reasonCode: 'ACCEPTED_COST_PAYMENT',
        summary: `权威已接受费用支付：选择 ${String(selection.candidateIds.length)} 张能量。`,
      };
    case 'SELECT_MAIN_PHASE_ACTION': {
      const action = decision.actions.find(
        (candidate) => candidate.actionId === selection.actionId
      );
      if (action?.kind === 'PLAY_MEMBER') {
        const source = selectedCards[0];
        const relayCount = action.paymentPreview?.replacementCount ?? 0;
        return {
          ...base,
          category: 'MEMBER_PLAY',
          reasonCode: 'ACCEPTED_MEMBER_PLAY',
          summary: `权威已接受成员登场：${source ? formatHistoryCard(source) : '当前可见来源卡'}登场到${slotLabel(action.targetSlot)}；支付 ${String(action.paymentPreview?.energyCost ?? 0)} 张能量${relayCount > 0 ? `，换手替换 ${String(relayCount)} 名成员` : '，不进行换手替换'}。`,
        };
      }
      if (action?.kind === 'ACTIVATE_ABILITY') {
        return {
          ...base,
          category: 'ABILITY',
          reasonCode: 'ACCEPTED_ACTIVATED_ABILITY',
          summary: `权威已接受起动能力：${selectedCards[0] ? formatHistoryCard(selectedCards[0]) : '当前可见来源卡'}。`,
        };
      }
      return null;
    }
    case 'SELECT_LIVE_SET_ACTION': {
      const action = decision.actions.find(
        (candidate) => candidate.actionId === selection.actionId
      );
      return action?.kind === 'SET_LIVE'
        ? {
            ...base,
            category: 'LIVE_SET',
            reasonCode: 'ACCEPTED_LIVE_SET',
            summary: `权威已接受 LIVE 盖放：${selectedCards[0] ? formatHistoryCard(selectedCards[0]) : '当前可见来源卡'}。`,
          }
        : null;
    }
    case 'SELECT_SUCCESS_LIVE':
      return {
        ...base,
        category: 'SUCCESS_LIVE',
        reasonCode: 'ACCEPTED_SUCCESS_LIVE',
        summary: `权威已接受成功 LIVE 选择：${selectedCards[0] ? formatHistoryCard(selectedCards[0]) : '当前可见候选'}。`,
      };
    case 'SELECT_EFFECT_CARDS':
      return {
        ...base,
        category: 'EFFECT_SELECTION',
        reasonCode: 'ACCEPTED_EFFECT_CARD_SELECTION',
        summary: `权威已接受效果选卡：选择 ${String(selection.candidateIds.length)} 张。`,
      };
    case 'SELECT_EFFECT_OPTIONS':
      return {
        ...base,
        category: 'EFFECT_SELECTION',
        reasonCode: 'ACCEPTED_EFFECT_OPTION_SELECTION',
        summary: `权威已接受效果选项：选择 ${String(selection.optionIds.length)} 项。`,
      };
    case 'SELECT_EFFECT_SLOT':
      return {
        ...base,
        category: 'EFFECT_SELECTION',
        reasonCode: 'ACCEPTED_EFFECT_SLOT_SELECTION',
        summary: `权威已接受效果区域选择：${slotLabel(selection.slot)}成员区。`,
      };
    case 'SELECT_EFFECT_NUMBER':
      return {
        ...base,
        category: 'EFFECT_SELECTION',
        reasonCode: 'ACCEPTED_EFFECT_NUMBER_SELECTION',
        summary: `权威已接受效果数值：${String(selection.value)}。`,
      };
    case 'SET_STAGE_FORMATION':
      return {
        ...base,
        category: 'FORMATION',
        reasonCode: 'ACCEPTED_STAGE_FORMATION',
        summary: `权威已接受站位变换：安排 ${String(selection.placements.length)} 名成员。`,
      };
    case 'CONFIRM_SPECIAL_MEMBER_PLAY':
      return {
        ...base,
        category: 'MEMBER_PLAY',
        reasonCode: 'ACCEPTED_SPECIAL_MEMBER_PLAY',
        summary: `权威已接受特殊登场选择：选择 ${String(selection.candidateIds.length)} 张成员。`,
      };
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
      source: 'VISIBLE_PROJECTION_DELTA',
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

function formatHistoryCard(card: AiSelectedHistoryCard): string {
  const stat =
    card.cardType === 'LIVE'
      ? card.score === undefined
        ? ''
        : ` 分数 ${String(card.score)}`
      : card.cost === undefined
        ? ''
        : ` 费用 ${String(card.cost)}`;
  return `${card.cardCode}${stat}「${card.name}」`;
}

function slotLabel(slot: string | undefined): string {
  return slot === 'LEFT' ? '左侧' : slot === 'RIGHT' ? '右侧' : '中央';
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
