import type { AnyCardData } from '@game/domain/entities/card';
import { ZoneType } from '@game/shared/types/enums';
import type { PublicCardInfo, PublicEvent, PublicZoneRef, Seat } from '@game/online';
import { getCardLocalizedInfo } from './cardLocalization';

export type PublicBattleLogFilter = 'KEY' | 'ALL';

export interface PublicBattleLogCardView {
  readonly publicObjectId: string;
  readonly cardCode: string;
  readonly name: string;
  readonly label: string;
}

export interface PublicBattleLogCardGroupView {
  readonly id: string;
  readonly cardCode: string;
  readonly name: string;
  readonly label: string;
  readonly count: number;
  readonly cards: readonly PublicBattleLogCardView[];
}

export interface PublicBattleLogEffectSummaryView {
  readonly kind:
    | 'SELF_SACRIFICE_RECOVER_FROM_WAITING_ROOM'
    | 'DISCARD_LOOK_TOP_SELECT_TO_HAND'
    | 'ARRANGE_INSPECTED_DECK_TOP';
  readonly summaryStatus: 'STARTED' | 'COMPLETED';
  readonly sourceCard: PublicBattleLogCardView | null;
  readonly sourceActionLabel: '登场' | '离场' | '起动' | 'LIVE成功';
  readonly sourceOrientationCost: 'WAITING' | null;
  readonly recoveredCards: readonly PublicBattleLogCardView[];
  readonly hiddenRecoveredCardCount: number;
  readonly noRecoveredCards: boolean;
  readonly discardedCostCards: readonly PublicBattleLogCardView[];
  readonly hiddenDiscardedCostCardCount: number;
  readonly inspectSourceZone: string | null;
  readonly requestedInspectCount: number | null;
  readonly actualInspectedCount: number | null;
  readonly selectedCards: readonly PublicBattleLogCardView[];
  readonly hiddenSelectedCardCount: number;
  readonly noSelectedCards: boolean;
  readonly waitingRoomCardCount: number | null;
}

export interface PublicBattleLogEventView {
  readonly id: string;
  readonly eventIds: readonly string[];
  readonly seq: number;
  readonly endSeq: number;
  readonly seqLabel: string;
  readonly timestamp: number;
  readonly type: PublicEvent['type'] | 'PublicBattleLogGroup';
  readonly keyEvent: boolean;
  readonly title: string;
  readonly detail: string | null;
  readonly actorLabel: string;
  readonly cards: readonly PublicBattleLogCardView[];
  readonly cardGroups: readonly PublicBattleLogCardGroupView[];
  readonly hiddenCardCount: number;
  readonly effectSummary?: PublicBattleLogEffectSummaryView;
}

interface PublicBattleLogFormatterOptions {
  readonly getCardData: (cardCode: string) => AnyCardData | undefined;
  readonly getSeatLabel: (seat: Seat) => string;
  readonly viewerSeat?: Seat | null;
}

export function isKeyPublicBattleLogEvent(event: PublicEvent): boolean {
  if (event.type === 'CardEffectSummary') {
    return true;
  }

  if (event.type === 'CardMovedPublic') {
    return !isHiddenDeckToInspectionMove(event);
  }

  return (
    event.type === 'CardRevealed' ||
    event.type === 'CardRevealedAndMoved' ||
    event.type === 'CardsInspectedSummary' ||
    event.type === 'DeckRefreshed'
  );
}

export function formatPublicBattleLogEvent(
  event: PublicEvent,
  options: PublicBattleLogFormatterOptions
): PublicBattleLogEventView {
  return formatPublicBattleLogEvents([event], { ...options, filter: 'ALL' })[0]!;
}

export function formatPublicBattleLogEvents(
  events: readonly PublicEvent[],
  options: PublicBattleLogFormatterOptions & { readonly filter?: PublicBattleLogFilter }
): readonly PublicBattleLogEventView[] {
  const filter = options.filter ?? 'ALL';
  const sortedEvents = [...events].sort((left, right) => left.seq - right.seq);
  const skippedIndexes = new Set<number>([
    ...findDuplicateRevealMoveIndexes(sortedEvents),
    ...(filter === 'KEY' ? findSupersededStartedSummaryIndexes(sortedEvents) : []),
    ...(filter === 'KEY' ? findCardEffectSummaryMoveIndexes(sortedEvents) : []),
  ]);
  const items: PublicBattleLogEventView[] = [];

  for (let index = 0; index < sortedEvents.length; index += 1) {
    if (skippedIndexes.has(index)) {
      continue;
    }

    const event = sortedEvents[index]!;
    let view: PublicBattleLogEventView;

    if (event.type === 'CardsInspectedSummary') {
      const group = buildCardsInspectedGroup(sortedEvents, index, skippedIndexes, options);
      view = group.view;
      for (const consumedIndex of group.consumedIndexes) {
        skippedIndexes.add(consumedIndex);
      }
    } else if (isHiddenDeckToInspectionMove(event)) {
      const group = buildHiddenInspectionMoveGroup(sortedEvents, index, skippedIndexes, options);
      view = group.view;
      for (const consumedIndex of group.consumedIndexes) {
        skippedIndexes.add(consumedIndex);
      }
    } else if (isInspectionResultMove(event)) {
      const group = buildInspectionResultGroup(sortedEvents, index, skippedIndexes, options);
      view = group.view;
      for (const consumedIndex of group.consumedIndexes) {
        skippedIndexes.add(consumedIndex);
      }
    } else if (isCardMoveLikeEvent(event)) {
      const group = buildAdjacentMoveGroup(sortedEvents, index, skippedIndexes, options);
      view = group.view;
      for (const consumedIndex of group.consumedIndexes) {
        skippedIndexes.add(consumedIndex);
      }
    } else {
      view = buildSingleEventView(event, options);
    }

    if (filter === 'ALL' || view.keyEvent) {
      items.push(view);
    }
  }

  return items;
}

function getEventCards(event: PublicEvent): readonly PublicCardInfo[] {
  if (event.type === 'CardMovedPublic') {
    return event.card ? [event.card] : [];
  }
  if (event.type === 'CardRevealed' || event.type === 'CardRevealedAndMoved') {
    return [event.card];
  }
  if (event.type === 'CardEffectSummary') {
    return [
      event.sourceCard,
      ...event.recoveredCards,
      ...(event.discardedCostCards ?? []),
      ...(event.selectedCards ?? []),
    ].filter((card): card is PublicCardInfo => Boolean(card));
  }
  return [];
}

function formatPublicCard(
  card: PublicCardInfo,
  getCardData: (cardCode: string) => AnyCardData | undefined
): PublicBattleLogCardView {
  const data = getCardData(card.cardCode);
  const name = data ? getCardLocalizedInfo(data).displayNameCn : '未收录卡牌';
  return {
    publicObjectId: card.publicObjectId,
    cardCode: card.cardCode,
    name,
    label: `${card.cardCode}「${name}」`,
  };
}

function buildCardsInspectedGroup(
  events: readonly PublicEvent[],
  index: number,
  skippedIndexes: ReadonlySet<number>,
  options: PublicBattleLogFormatterOptions
): { readonly view: PublicBattleLogEventView; readonly consumedIndexes: readonly number[] } {
  const event = events[index]!;
  if (event.type !== 'CardsInspectedSummary') {
    throw new Error('Expected CardsInspectedSummary event');
  }

  const consumedIndexes = [index];
  let hiddenMoveCount = 0;

  for (
    let cursor = index + 1;
    cursor < events.length && hiddenMoveCount < event.count;
    cursor += 1
  ) {
    const candidate = events[cursor]!;
    if (isHardGroupingBoundary(candidate)) {
      break;
    }
    if (skippedIndexes.has(cursor)) {
      continue;
    }
    if (!isHiddenDeckToInspectionMove(candidate)) {
      continue;
    }
    if (
      candidate.actorSeat !== event.actorSeat ||
      candidate.from?.zone !== event.sourceZone ||
      candidate.from?.ownerSeat !== event.ownerSeat ||
      candidate.to?.ownerSeat !== event.ownerSeat
    ) {
      continue;
    }
    consumedIndexes.push(cursor);
    hiddenMoveCount += getPublicEventCardCount(candidate);
  }

  const actorSeat = event.ownerSeat ?? event.actorSeat;
  const title = formatActionTitle(event, formatInspectionAction(event.sourceZone, event.count), {
    subjectSeat: actorSeat,
    options,
  });
  const sourceLabel = event.ownerSeat
    ? formatZoneRef({ zone: event.sourceZone, ownerSeat: event.ownerSeat }, options)
    : formatZoneName(event.sourceZone);

  return {
    consumedIndexes,
    view: buildView({
      events: consumedIndexes.map((consumedIndex) => events[consumedIndex]!),
      options,
      type: 'CardsInspectedSummary',
      keyEvent: true,
      title,
      detail: `来源：${sourceLabel}`,
      cards: [],
      hiddenCardCount: event.count,
      actorSeat,
    }),
  };
}

function buildHiddenInspectionMoveGroup(
  events: readonly PublicEvent[],
  index: number,
  skippedIndexes: ReadonlySet<number>,
  options: PublicBattleLogFormatterOptions
): { readonly view: PublicBattleLogEventView; readonly consumedIndexes: readonly number[] } {
  const first = events[index]!;
  const consumedIndexes = [index];
  let count = getPublicEventCardCount(first);

  for (let cursor = index + 1; cursor < events.length; cursor += 1) {
    const candidate = events[cursor]!;
    if (skippedIndexes.has(cursor) || isHardGroupingBoundary(candidate)) {
      break;
    }
    if (!isSameHiddenInspectionMove(first, candidate)) {
      break;
    }
    consumedIndexes.push(cursor);
    count += getPublicEventCardCount(candidate);
  }

  const sourceZone = first.type === 'CardMovedPublic' ? first.from?.zone : ZoneType.MAIN_DECK;
  const title = formatActionTitle(first, formatInspectionAction(sourceZone, count), {
    subjectSeat: first.actorSeat ?? getMoveOwnerSeat(first),
    options,
  });
  const detail =
    first.type === 'CardMovedPublic' && first.from
      ? `来源：${formatZoneRef(first.from, options)}`
      : null;

  return {
    consumedIndexes,
    view: buildView({
      events: consumedIndexes.map((consumedIndex) => events[consumedIndex]!),
      options,
      type: 'PublicBattleLogGroup',
      keyEvent: true,
      title,
      detail,
      cards: [],
      hiddenCardCount: count,
      actorSeat: first.actorSeat ?? getMoveOwnerSeat(first),
    }),
  };
}

function buildInspectionResultGroup(
  events: readonly PublicEvent[],
  index: number,
  skippedIndexes: ReadonlySet<number>,
  options: PublicBattleLogFormatterOptions
): { readonly view: PublicBattleLogEventView; readonly consumedIndexes: readonly number[] } {
  const first = events[index]!;
  const consumedIndexes = [index];

  for (let cursor = index + 1; cursor < events.length; cursor += 1) {
    const candidate = events[cursor]!;
    if (skippedIndexes.has(cursor) || isHardGroupingBoundary(candidate)) {
      break;
    }
    if (!isSameInspectionResultContext(first, candidate)) {
      break;
    }
    consumedIndexes.push(cursor);
  }

  const groupedEvents = consumedIndexes.map((consumedIndex) => events[consumedIndex]!);
  const cards = formatEventCards(groupedEvents, options);
  const hiddenCardCount = groupedEvents.reduce((total, event) => {
    return total + (getEventCards(event).length > 0 ? 0 : getPublicEventCardCount(event));
  }, 0);
  const destinationSummaries = summarizeInspectionDestinations(groupedEvents);
  const totalCount = groupedEvents.reduce(
    (total, event) => total + getPublicEventCardCount(event),
    0
  );
  const title =
    destinationSummaries.length > 1
      ? formatActionTitle(first, '处理检视结果', {
          subjectSeat: first.actorSeat ?? getMoveOwnerSeat(first),
          options,
        })
      : formatActionTitle(
          first,
          formatSingleInspectionResultAction(groupedEvents[0]!, totalCount),
          {
            subjectSeat: first.actorSeat ?? getMoveOwnerSeat(first),
            options,
          }
        );

  return {
    consumedIndexes,
    view: buildView({
      events: groupedEvents,
      options,
      type: 'PublicBattleLogGroup',
      keyEvent: true,
      title,
      detail: destinationSummaries.join('，') || null,
      cards,
      hiddenCardCount,
      actorSeat: first.actorSeat ?? getMoveOwnerSeat(first),
    }),
  };
}

function buildAdjacentMoveGroup(
  events: readonly PublicEvent[],
  index: number,
  skippedIndexes: ReadonlySet<number>,
  options: PublicBattleLogFormatterOptions
): { readonly view: PublicBattleLogEventView; readonly consumedIndexes: readonly number[] } {
  const first = events[index]!;
  const consumedIndexes = [index];

  for (let cursor = index + 1; cursor < events.length; cursor += 1) {
    const candidate = events[cursor]!;
    if (skippedIndexes.has(cursor) || isHardGroupingBoundary(candidate)) {
      break;
    }
    if (!canMergeMoveEvents(first, candidate)) {
      break;
    }
    consumedIndexes.push(cursor);
  }

  const groupedEvents = consumedIndexes.map((consumedIndex) => events[consumedIndex]!);
  const cards = formatEventCards(groupedEvents, options);
  const hiddenCardCount = groupedEvents.reduce((total, event) => {
    return total + (getEventCards(event).length > 0 ? 0 : getPublicEventCardCount(event));
  }, 0);
  const count = groupedEvents.reduce((total, event) => total + getPublicEventCardCount(event), 0);
  const title = formatActionTitle(first, formatMoveAction(groupedEvents, count, options), {
    subjectSeat: first.actorSeat ?? getMoveOwnerSeat(first),
    options,
  });
  const detail = formatMovePathDetail(first, options);

  return {
    consumedIndexes,
    view: buildView({
      events: groupedEvents,
      options,
      type: first.type,
      keyEvent: true,
      title,
      detail,
      cards,
      hiddenCardCount,
      actorSeat: first.actorSeat ?? getMoveOwnerSeat(first),
    }),
  };
}

function buildSingleEventView(
  event: PublicEvent,
  options: PublicBattleLogFormatterOptions
): PublicBattleLogEventView {
  const cards = formatEventCards([event], options);
  const actorSeat = getEventSubjectSeat(event);

  switch (event.type) {
    case 'CardRevealed':
      return buildView({
        events: [event],
        options,
        type: event.type,
        keyEvent: true,
        title: formatActionTitle(event, '公开 1 张卡', { subjectSeat: actorSeat, options }),
        detail: event.from ? `来源：${formatZoneRef(event.from, options)}` : null,
        cards,
        hiddenCardCount: 0,
        actorSeat,
      });
    case 'CardsInspectedSummary':
    case 'CardMovedPublic':
    case 'CardRevealedAndMoved':
      return buildAdjacentMoveGroup([event], 0, new Set(), options).view;
    case 'DeckRefreshed':
      return buildView({
        events: [event],
        options,
        type: event.type,
        keyEvent: true,
        title: `${formatSeatName(event.ownerSeat, options)} 牌库刷新`,
        detail: `休息室 ${event.movedCount} 张洗入主卡组，刷新后主卡组 ${event.mainDeckCountAfter} 张`,
        cards,
        hiddenCardCount: 0,
        actorSeat: event.ownerSeat,
      });
    case 'CardEffectSummary': {
      const sourceCard = event.sourceCard
        ? formatPublicCard(event.sourceCard, options.getCardData)
        : null;
      const recoveredCards = event.recoveredCards.map((card) =>
        formatPublicCard(card, options.getCardData)
      );
      const discardedCostCards = (event.discardedCostCards ?? []).map((card) =>
        formatPublicCard(card, options.getCardData)
      );
      const selectedCards = (event.selectedCards ?? []).map((card) =>
        formatPublicCard(card, options.getCardData)
      );
      const hiddenDiscardedCostCardCount = event.hiddenDiscardedCostCardCount ?? 0;
      const hiddenSelectedCardCount = event.hiddenSelectedCardCount ?? 0;
      const recoveredCount = recoveredCards.length + event.hiddenRecoveredCardCount;
      const selectedCount = selectedCards.length + hiddenSelectedCardCount;
      const detail =
        event.effectKind === 'DISCARD_LOOK_TOP_SELECT_TO_HAND'
          ? formatDiscardLookTopSelectSummaryDetail({
              summaryStatus: event.summaryStatus,
              actualInspectedCount: event.actualInspectedCount ?? null,
              requestedInspectCount: event.requestedInspectCount ?? null,
              selectedCount,
              noSelectedCards: event.noSelectedCards === true,
              waitingRoomCardCount: event.waitingRoomCardCount ?? null,
            })
          : event.effectKind === 'ARRANGE_INSPECTED_DECK_TOP'
            ? formatArrangeInspectedDeckTopSummaryDetail({
                summaryStatus: event.summaryStatus,
                actualInspectedCount: event.actualInspectedCount ?? null,
                requestedInspectCount: event.requestedInspectCount ?? null,
                topDeckCount: selectedCount,
                noTopDeckCards: event.noSelectedCards === true,
                waitingRoomCardCount: event.waitingRoomCardCount ?? null,
              })
            : event.noRecoveredCards
              ? '未回收卡牌'
              : recoveredCount > 0
                ? `回收 ${recoveredCount} 张卡`
                : null;

      return buildView({
        events: [event],
        options,
        type: event.type,
        keyEvent: true,
        title: formatActionTitle(event, getCardEffectSummarySourceActionLabel(event), {
          subjectSeat: actorSeat,
          options,
        }),
        detail,
        cards,
        hiddenCardCount:
          event.hiddenRecoveredCardCount +
          hiddenDiscardedCostCardCount +
          (event.effectKind === 'DISCARD_LOOK_TOP_SELECT_TO_HAND' ||
          event.effectKind === 'ARRANGE_INSPECTED_DECK_TOP'
            ? 0
            : hiddenSelectedCardCount),
        actorSeat,
        effectSummary: {
          kind: event.effectKind,
          summaryStatus: event.summaryStatus,
          sourceCard,
          sourceActionLabel: getCardEffectSummarySourceActionLabel(event),
          sourceOrientationCost: event.sourceOrientationCost ?? null,
          recoveredCards,
          hiddenRecoveredCardCount: event.hiddenRecoveredCardCount,
          noRecoveredCards: event.noRecoveredCards,
          discardedCostCards,
          hiddenDiscardedCostCardCount,
          inspectSourceZone: event.inspectSourceZone ?? null,
          requestedInspectCount: event.requestedInspectCount ?? null,
          actualInspectedCount: event.actualInspectedCount ?? null,
          selectedCards,
          hiddenSelectedCardCount,
          noSelectedCards: event.noSelectedCards === true,
          waitingRoomCardCount: event.waitingRoomCardCount ?? null,
        },
      });
    }
    case 'PhaseStarted':
      return buildView({
        events: [event],
        options,
        type: event.type,
        keyEvent: false,
        title: `进入${event.phase}阶段`,
        detail: event.activeSeat ? `行动玩家：${formatSeatName(event.activeSeat, options)}` : null,
        cards,
        hiddenCardCount: 0,
        actorSeat,
      });
    case 'SubPhaseStarted':
      return buildView({
        events: [event],
        options,
        type: event.type,
        keyEvent: false,
        title: `进入${event.subPhase}`,
        detail: event.activeSeat ? `行动玩家：${formatSeatName(event.activeSeat, options)}` : null,
        cards,
        hiddenCardCount: 0,
        actorSeat,
      });
    case 'WindowStatusChanged':
      return buildView({
        events: [event],
        options,
        type: event.type,
        keyEvent: false,
        title: `窗口${event.status}`,
        detail: event.windowType ?? '无窗口',
        cards,
        hiddenCardCount: 0,
        actorSeat: event.actingSeat ?? actorSeat,
      });
    case 'PlayerDeclared':
      return buildView({
        events: [event],
        options,
        type: event.type,
        keyEvent: false,
        title: formatActionTitle(event, `宣言 ${event.declarationType}`, {
          subjectSeat: actorSeat,
          options,
        }),
        detail:
          event.publicValue === undefined || event.publicValue === null
            ? null
            : String(event.publicValue),
        cards,
        hiddenCardCount: 0,
        actorSeat,
      });
  }
}

function getCardEffectSummarySourceActionLabel(
  event: Extract<PublicEvent, { type: 'CardEffectSummary' }>
): '登场' | '离场' | '起动' | 'LIVE成功' {
  if (event.sourceActionLabel) {
    return event.sourceActionLabel;
  }
  return event.effectKind === 'DISCARD_LOOK_TOP_SELECT_TO_HAND' ? '登场' : '起动';
}

function buildView(input: {
  readonly events: readonly PublicEvent[];
  readonly options: PublicBattleLogFormatterOptions;
  readonly type: PublicBattleLogEventView['type'];
  readonly keyEvent: boolean;
  readonly title: string;
  readonly detail: string | null;
  readonly cards: readonly PublicBattleLogCardView[];
  readonly hiddenCardCount: number;
  readonly actorSeat?: Seat;
  readonly effectSummary?: PublicBattleLogEffectSummaryView;
}): PublicBattleLogEventView {
  const eventIds = input.events.map((event) => event.eventId);
  const seqs = input.events.map((event) => event.seq);
  const firstEvent = input.events[0]!;
  const minSeq = Math.min(...seqs);
  const maxSeq = Math.max(...seqs);

  return {
    id: eventIds.join('|'),
    eventIds,
    seq: minSeq,
    endSeq: maxSeq,
    seqLabel: formatSeqLabel(seqs),
    timestamp: firstEvent.timestamp,
    type: input.type,
    keyEvent: input.keyEvent,
    title: input.title,
    detail: input.detail,
    actorLabel: input.actorSeat ? formatSeatName(input.actorSeat, input.options) : '规则处理',
    cards: input.cards,
    cardGroups: groupCardsByCode(input.cards),
    hiddenCardCount: input.hiddenCardCount,
    ...(input.effectSummary ? { effectSummary: input.effectSummary } : {}),
  };
}

function findDuplicateRevealMoveIndexes(events: readonly PublicEvent[]): Set<number> {
  const skippedIndexes = new Set<number>();

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.type !== 'CardMovedPublic' || !event.card) {
      continue;
    }

    const previous = events[index - 1];
    if (
      previous?.type === 'CardRevealedAndMoved' &&
      previous.card.publicObjectId === event.card.publicObjectId &&
      sameZoneRef(previous.from, event.from) &&
      sameZoneRef(previous.to, event.to)
    ) {
      skippedIndexes.add(index);
    }
  }

  return skippedIndexes;
}

function findSupersededStartedSummaryIndexes(events: readonly PublicEvent[]): Set<number> {
  const skippedIndexes = new Set<number>();
  const completedSummaries = events.filter(
    (event): event is Extract<PublicEvent, { type: 'CardEffectSummary' }> =>
      event.type === 'CardEffectSummary' &&
      isInspectionEffectSummary(event) &&
      event.summaryStatus === 'COMPLETED'
  );

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (
      event.type !== 'CardEffectSummary' ||
      !isInspectionEffectSummary(event) ||
      event.summaryStatus !== 'STARTED'
    ) {
      continue;
    }
    if (
      completedSummaries.some(
        (summary) =>
          summary.seq > event.seq &&
          summary.seq - event.seq <= 96 &&
          isSameInspectionSummaryThread(event, summary)
      )
    ) {
      skippedIndexes.add(index);
    }
  }

  return skippedIndexes;
}

function findCardEffectSummaryMoveIndexes(events: readonly PublicEvent[]): Set<number> {
  const skippedIndexes = new Set<number>();
  const summaries = events.filter(
    (event): event is Extract<PublicEvent, { type: 'CardEffectSummary' }> =>
      event.type === 'CardEffectSummary'
  );

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (summaries.some((summary) => shouldHideEventForCardEffectSummary(event, summary, events))) {
      skippedIndexes.add(index);
    }
  }

  return skippedIndexes;
}

function shouldHideEventForCardEffectSummary(
  event: PublicEvent,
  summary: Extract<PublicEvent, { type: 'CardEffectSummary' }>,
  events: readonly PublicEvent[]
): boolean {
  if (event.actorSeat !== summary.actorSeat) {
    return false;
  }

  if (summary.effectKind === 'DISCARD_LOOK_TOP_SELECT_TO_HAND') {
    return shouldHideEventForDiscardLookTopSelectSummary(event, summary, events);
  }

  if (summary.effectKind === 'ARRANGE_INSPECTED_DECK_TOP') {
    return shouldHideEventForArrangeInspectedDeckTopSummary(event, summary, events);
  }

  if (event.type !== 'CardMovedPublic' || !event.card) {
    return false;
  }

  if (
    summary.sourceCard?.publicObjectId === event.card.publicObjectId &&
    isSelfSacrificeSummarySourceMove(event)
  ) {
    return event.seq < summary.seq && summary.seq - event.seq <= 8;
  }

  if (
    summary.recoveredCards.some((card) => card.publicObjectId === event.card?.publicObjectId) &&
    isSelfSacrificeSummaryRecoveryMove(event)
  ) {
    return event.seq > summary.seq && event.seq - summary.seq <= 8;
  }

  return false;
}

function shouldHideEventForDiscardLookTopSelectSummary(
  event: PublicEvent,
  summary: Extract<PublicEvent, { type: 'CardEffectSummary' }>,
  events: readonly PublicEvent[]
): boolean {
  if (event.seq === summary.seq) {
    return false;
  }

  const isStarted = summary.summaryStatus === 'STARTED';
  const isCompleted = summary.summaryStatus === 'COMPLETED';
  const isNearbyBeforeSummary = event.seq < summary.seq && summary.seq - event.seq <= 32;
  const isNearbyAfterSummary = event.seq > summary.seq && event.seq - summary.seq <= 32;

  if (event.type === 'CardsInspectedSummary') {
    return isStarted
      ? isNearbyAfterSummary && isWithinInspectionSummaryBudget(event, summary, events, 'AFTER')
      : isCompleted &&
          isNearbyBeforeSummary &&
          isWithinInspectionSummaryBudget(event, summary, events, 'BEFORE');
  }

  if (event.type !== 'CardMovedPublic') {
    return false;
  }

  if (isDiscardLookTopCostMove(event, summary)) {
    return isStarted ? isNearbyAfterSummary : isCompleted && isNearbyBeforeSummary;
  }

  if (
    !event.card &&
    (event.from?.zone === ZoneType.MAIN_DECK || event.from?.zone === ZoneType.ENERGY_DECK) &&
    event.to?.zone === ZoneType.INSPECTION_ZONE
  ) {
    return isStarted
      ? isNearbyAfterSummary && isWithinHiddenInspectionMoveBudget(event, summary, events, 'AFTER')
      : isCompleted &&
          isNearbyBeforeSummary &&
          isWithinHiddenInspectionMoveBudget(event, summary, events, 'BEFORE');
  }

  if (isInspectionResultMove(event)) {
    return (
      isCompleted &&
      isNearbyAfterSummary &&
      isDiscardLookTopInspectionResultMove(event, summary, events)
    );
  }

  return false;
}

function shouldHideEventForArrangeInspectedDeckTopSummary(
  event: PublicEvent,
  summary: Extract<PublicEvent, { type: 'CardEffectSummary' }>,
  events: readonly PublicEvent[]
): boolean {
  if (event.seq === summary.seq) {
    return false;
  }

  const isStarted = summary.summaryStatus === 'STARTED';
  const isCompleted = summary.summaryStatus === 'COMPLETED';
  const isNearbyBeforeSummary = event.seq < summary.seq && summary.seq - event.seq <= 32;
  const isNearbyAfterSummary = event.seq > summary.seq && event.seq - summary.seq <= 32;

  if (event.type === 'CardsInspectedSummary') {
    return isStarted
      ? isNearbyAfterSummary && isWithinInspectionSummaryBudget(event, summary, events, 'AFTER')
      : isCompleted &&
          isNearbyBeforeSummary &&
          isWithinInspectionSummaryBudget(event, summary, events, 'BEFORE');
  }

  if (event.type !== 'CardMovedPublic') {
    return false;
  }

  if (
    !event.card &&
    (event.from?.zone === ZoneType.MAIN_DECK || event.from?.zone === ZoneType.ENERGY_DECK) &&
    event.to?.zone === ZoneType.INSPECTION_ZONE
  ) {
    return isStarted
      ? isNearbyAfterSummary && isWithinHiddenInspectionMoveBudget(event, summary, events, 'AFTER')
      : isCompleted &&
          isNearbyBeforeSummary &&
          isWithinHiddenInspectionMoveBudget(event, summary, events, 'BEFORE');
  }

  if (
    event.from?.zone !== ZoneType.INSPECTION_ZONE ||
    !isCompleted ||
    !isNearbyAfterSummary
  ) {
    return false;
  }

  if (
    event.to?.zone === ZoneType.MAIN_DECK &&
    isWithinInspectionResultMainDeckBudget(event, summary, events)
  ) {
    return true;
  }

  return (
    event.to?.zone === ZoneType.WAITING_ROOM &&
    isWithinInspectionResultWaitingRoomBudget(event, summary, events)
  );
}

function isInspectionEffectSummary(
  event: Extract<PublicEvent, { type: 'CardEffectSummary' }>
): boolean {
  return (
    event.effectKind === 'DISCARD_LOOK_TOP_SELECT_TO_HAND' ||
    event.effectKind === 'ARRANGE_INSPECTED_DECK_TOP'
  );
}

function isSameInspectionSummaryThread(
  left: Extract<PublicEvent, { type: 'CardEffectSummary' }>,
  right: Extract<PublicEvent, { type: 'CardEffectSummary' }>
): boolean {
  return (
    left.actorSeat === right.actorSeat &&
    left.abilityId === right.abilityId &&
    left.sourceCard?.publicObjectId === right.sourceCard?.publicObjectId &&
    left.discardedCostCards?.map((card) => card.publicObjectId).join(',') ===
      right.discardedCostCards?.map((card) => card.publicObjectId).join(',') &&
    (left.hiddenDiscardedCostCardCount ?? 0) === (right.hiddenDiscardedCostCardCount ?? 0)
  );
}

function isWithinInspectionSummaryBudget(
  event: Extract<PublicEvent, { type: 'CardsInspectedSummary' }>,
  summary: Extract<PublicEvent, { type: 'CardEffectSummary' }>,
  events: readonly PublicEvent[],
  direction: 'BEFORE' | 'AFTER'
): boolean {
  const actualInspectedCount = summary.actualInspectedCount;
  if (actualInspectedCount === undefined) {
    return true;
  }
  let inspectedCount = 0;
  for (const candidate of getInspectionCandidatesInSummaryDirection(events, summary, direction)) {
    if (candidate.type !== 'CardsInspectedSummary') {
      continue;
    }
    if (
      candidate.actorSeat !== summary.actorSeat ||
      candidate.sourceZone !== (summary.inspectSourceZone ?? ZoneType.MAIN_DECK)
    ) {
      continue;
    }
    inspectedCount += candidate.count;
    if (candidate.eventId === event.eventId) {
      return inspectedCount <= actualInspectedCount;
    }
    if (inspectedCount >= actualInspectedCount) {
      return false;
    }
  }
  return false;
}

function isWithinHiddenInspectionMoveBudget(
  event: Extract<PublicEvent, { type: 'CardMovedPublic' }>,
  summary: Extract<PublicEvent, { type: 'CardEffectSummary' }>,
  events: readonly PublicEvent[],
  direction: 'BEFORE' | 'AFTER'
): boolean {
  const actualInspectedCount = summary.actualInspectedCount;
  if (actualInspectedCount === undefined) {
    return event.from?.zone === (summary.inspectSourceZone ?? ZoneType.MAIN_DECK);
  }
  let inspectedCount = 0;
  for (const candidate of getInspectionCandidatesInSummaryDirection(events, summary, direction)) {
    if (!isHiddenDeckToInspectionMove(candidate)) {
      continue;
    }
    if (
      candidate.actorSeat !== summary.actorSeat ||
      candidate.from?.zone !== (summary.inspectSourceZone ?? ZoneType.MAIN_DECK)
    ) {
      continue;
    }
    inspectedCount += getPublicEventCardCount(candidate);
    if (candidate.eventId === event.eventId) {
      return inspectedCount <= actualInspectedCount;
    }
    if (inspectedCount >= actualInspectedCount) {
      return false;
    }
  }
  return false;
}

function getInspectionCandidatesInSummaryDirection(
  events: readonly PublicEvent[],
  summary: Extract<PublicEvent, { type: 'CardEffectSummary' }>,
  direction: 'BEFORE' | 'AFTER'
): readonly PublicEvent[] {
  const candidates = events.filter((event) =>
    direction === 'BEFORE'
      ? event.seq < summary.seq && summary.seq - event.seq <= 32
      : event.seq > summary.seq && event.seq - summary.seq <= 32
  );
  return direction === 'BEFORE'
    ? [...candidates].sort((left, right) => right.seq - left.seq)
    : [...candidates].sort((left, right) => left.seq - right.seq);
}

function isDiscardLookTopInspectionResultMove(
  event: Extract<PublicEvent, { type: 'CardMovedPublic' }>,
  summary: Extract<PublicEvent, { type: 'CardEffectSummary' }>,
  events: readonly PublicEvent[]
): boolean {
  const toZone = event.to?.zone;
  if (
    toZone === ZoneType.HAND &&
    event.card &&
    summary.selectedCards?.some((card) => card.publicObjectId === event.card?.publicObjectId)
  ) {
    return true;
  }
  if (
    toZone === ZoneType.HAND &&
    event.from?.zone === ZoneType.INSPECTION_ZONE &&
    !event.card &&
    isWithinInspectionResultHandBudget(event, summary, events)
  ) {
    return true;
  }
  return (
    toZone === ZoneType.WAITING_ROOM &&
    event.from?.zone === ZoneType.INSPECTION_ZONE &&
    isWithinInspectionResultWaitingRoomBudget(event, summary, events)
  );
}

function isWithinInspectionResultHandBudget(
  event: Extract<PublicEvent, { type: 'CardMovedPublic' }>,
  summary: Extract<PublicEvent, { type: 'CardEffectSummary' }>,
  events: readonly PublicEvent[]
): boolean {
  const selectedCount =
    (summary.selectedCards?.length ?? 0) + (summary.hiddenSelectedCardCount ?? 0);
  if (selectedCount <= 0) {
    return false;
  }
  let movedCount = 0;
  for (const candidate of events
    .filter(
      (candidate) =>
        candidate.seq > summary.seq &&
        candidate.seq - summary.seq <= 32 &&
        candidate.type === 'CardMovedPublic' &&
        candidate.actorSeat === summary.actorSeat &&
        candidate.from?.zone === ZoneType.INSPECTION_ZONE &&
        candidate.to?.zone === ZoneType.HAND
    )
    .sort((left, right) => left.seq - right.seq)) {
    movedCount += getPublicEventCardCount(candidate);
    if (candidate.eventId === event.eventId) {
      return movedCount <= selectedCount;
    }
    if (movedCount >= selectedCount) {
      return false;
    }
  }
  return false;
}

function isWithinInspectionResultMainDeckBudget(
  event: Extract<PublicEvent, { type: 'CardMovedPublic' }>,
  summary: Extract<PublicEvent, { type: 'CardEffectSummary' }>,
  events: readonly PublicEvent[]
): boolean {
  const topDeckCount =
    (summary.selectedCards?.length ?? 0) + (summary.hiddenSelectedCardCount ?? 0);
  if (topDeckCount <= 0) {
    return false;
  }
  let movedCount = 0;
  for (const candidate of events
    .filter(
      (candidate) =>
        candidate.seq > summary.seq &&
        candidate.seq - summary.seq <= 32 &&
        candidate.type === 'CardMovedPublic' &&
        candidate.actorSeat === summary.actorSeat &&
        candidate.from?.zone === ZoneType.INSPECTION_ZONE &&
        candidate.to?.zone === ZoneType.MAIN_DECK
    )
    .sort((left, right) => left.seq - right.seq)) {
    movedCount += getPublicEventCardCount(candidate);
    if (candidate.eventId === event.eventId) {
      return movedCount <= topDeckCount;
    }
    if (movedCount >= topDeckCount) {
      return false;
    }
  }
  return false;
}

function isWithinInspectionResultWaitingRoomBudget(
  event: Extract<PublicEvent, { type: 'CardMovedPublic' }>,
  summary: Extract<PublicEvent, { type: 'CardEffectSummary' }>,
  events: readonly PublicEvent[]
): boolean {
  const waitingRoomCardCount = summary.waitingRoomCardCount;
  if (waitingRoomCardCount === undefined) {
    return true;
  }
  let movedCount = 0;
  for (const candidate of events
    .filter(
      (candidate) =>
        candidate.seq > summary.seq &&
        candidate.seq - summary.seq <= 32 &&
        candidate.type === 'CardMovedPublic' &&
        candidate.actorSeat === summary.actorSeat &&
        candidate.from?.zone === ZoneType.INSPECTION_ZONE &&
        candidate.to?.zone === ZoneType.WAITING_ROOM
    )
    .sort((left, right) => left.seq - right.seq)) {
    movedCount += getPublicEventCardCount(candidate);
    if (candidate.eventId === event.eventId) {
      return movedCount <= waitingRoomCardCount;
    }
    if (movedCount >= waitingRoomCardCount) {
      return false;
    }
  }
  return false;
}

function isDiscardLookTopCostMove(
  event: Extract<PublicEvent, { type: 'CardMovedPublic' }>,
  summary: Extract<PublicEvent, { type: 'CardEffectSummary' }>
): boolean {
  return (
    event.from?.zone === ZoneType.HAND &&
    event.to?.zone === ZoneType.WAITING_ROOM &&
    Boolean(
      event.card &&
        summary.discardedCostCards?.some(
          (card) => card.publicObjectId === event.card?.publicObjectId
        )
    )
  );
}

function isSelfSacrificeSummarySourceMove(event: PublicEvent): boolean {
  return (
    event.type === 'CardMovedPublic' &&
    event.from?.zone === ZoneType.MEMBER_SLOT &&
    event.to?.zone === ZoneType.WAITING_ROOM
  );
}

function isSelfSacrificeSummaryRecoveryMove(event: PublicEvent): boolean {
  return (
    event.type === 'CardMovedPublic' &&
    event.from?.zone === ZoneType.WAITING_ROOM &&
    event.to?.zone === ZoneType.HAND
  );
}

function formatEventCards(
  events: readonly PublicEvent[],
  options: PublicBattleLogFormatterOptions
): readonly PublicBattleLogCardView[] {
  return events.flatMap((event) =>
    getEventCards(event).map((card) => formatPublicCard(card, options.getCardData))
  );
}

function groupCardsByCode(
  cards: readonly PublicBattleLogCardView[]
): readonly PublicBattleLogCardGroupView[] {
  const groups: PublicBattleLogCardGroupView[] = [];
  const groupIndexByCode = new Map<string, number>();

  for (const card of cards) {
    const existingIndex = groupIndexByCode.get(card.cardCode);
    if (existingIndex !== undefined) {
      const existing = groups[existingIndex]!;
      groups[existingIndex] = {
        ...existing,
        count: existing.count + 1,
        cards: [...existing.cards, card],
      };
      continue;
    }

    groupIndexByCode.set(card.cardCode, groups.length);
    groups.push({
      id: card.cardCode,
      cardCode: card.cardCode,
      name: card.name,
      label: card.label,
      count: 1,
      cards: [card],
    });
  }

  return groups;
}

function getPublicEventCardCount(event: PublicEvent): number {
  if (event.type === 'CardsInspectedSummary') {
    return event.count;
  }
  if (event.type === 'CardMovedPublic') {
    return event.card ? 1 : (event.count ?? 1);
  }
  if (event.type === 'CardRevealed' || event.type === 'CardRevealedAndMoved') {
    return 1;
  }
  if (event.type === 'DeckRefreshed') {
    return event.movedCount;
  }
  if (event.type === 'CardEffectSummary') {
    return (
      event.recoveredCards.length +
      event.hiddenRecoveredCardCount +
      (event.discardedCostCards?.length ?? 0) +
      (event.hiddenDiscardedCostCardCount ?? 0) +
      (event.selectedCards?.length ?? 0) +
      (event.hiddenSelectedCardCount ?? 0)
    );
  }
  return 0;
}

function formatMoveAction(
  events: readonly PublicEvent[],
  count: number,
  options: PublicBattleLogFormatterOptions
): string {
  const first = events[0]!;
  const firstCard = getEventCards(first)[0];
  const firstCardName = firstCard ? formatPublicCard(firstCard, options.getCardData).name : null;
  const fromZone = getMoveFrom(first)?.zone;
  const toZone = getMoveTo(first)?.zone;
  const hasPublicCards = events.some((event) => getEventCards(event).length > 0);

  if (fromZone === ZoneType.HAND && toZone === ZoneType.MEMBER_SLOT) {
    return count === 1 && firstCardName ? `登场「${firstCardName}」` : `登场 ${count} 张成员`;
  }
  if (fromZone === ZoneType.WAITING_ROOM && toZone === ZoneType.MEMBER_SLOT) {
    return `从休息室登场 ${count} 张成员`;
  }
  if (fromZone === ZoneType.ENERGY_DECK && toZone === ZoneType.ENERGY_ZONE) {
    return `放置 ${count} 张能量`;
  }
  if (fromZone === ZoneType.HAND && toZone === ZoneType.LIVE_ZONE) {
    return hasPublicCards ? `明置 ${count} 张 LIVE` : `盖放 ${count} 张 LIVE`;
  }
  if (fromZone === ZoneType.LIVE_ZONE && toZone === ZoneType.HAND && !hasPublicCards) {
    return `收回 ${count} 张盖放 LIVE`;
  }
  if (toZone === ZoneType.HAND) {
    if (fromZone === ZoneType.WAITING_ROOM) {
      return `从休息室加入 ${count} 张手牌`;
    }
    if (fromZone === ZoneType.LIVE_ZONE) {
      return `从 LIVE 区加入 ${count} 张手牌`;
    }
    if (fromZone === ZoneType.SUCCESS_ZONE) {
      return `从成功 LIVE 区加入 ${count} 张手牌`;
    }
    if (fromZone === ZoneType.RESOLUTION_ZONE) {
      return `从解决区加入 ${count} 张手牌`;
    }
    if (fromZone === ZoneType.MAIN_DECK) {
      return `抽 ${count} 张卡`;
    }
    return `加入 ${count} 张手牌`;
  }
  if (toZone === ZoneType.WAITING_ROOM) {
    if (fromZone === ZoneType.HAND) {
      return `将 ${count} 张手牌放置入休息室`;
    }
    if (fromZone === ZoneType.LIVE_ZONE) {
      return `将 LIVE 区 ${count} 张卡放置入休息室`;
    }
    if (fromZone === ZoneType.MEMBER_SLOT) {
      return count === 1 && firstCardName
        ? `将「${firstCardName}」放置入休息室`
        : `将成员区 ${count} 张卡放置入休息室`;
    }
    if (fromZone === ZoneType.RESOLUTION_ZONE) {
      return `将解决区 ${count} 张卡放置入休息室`;
    }
    if (fromZone === ZoneType.MAIN_DECK) {
      return `将卡组顶 ${count} 张卡放置入休息室`;
    }
    return `将 ${count} 张卡放置入休息室`;
  }
  if (toZone === ZoneType.RESOLUTION_ZONE && hasPublicCards) {
    return `公开 ${count} 张卡`;
  }
  if (first.type === 'CardRevealedAndMoved') {
    return `公开并移动 ${count} 张卡`;
  }
  return `移动 ${count} 张卡`;
}

function formatInspectionAction(sourceZone: string | undefined, count: number): string {
  if (sourceZone === ZoneType.ENERGY_DECK) {
    return `检视能量卡组顶 ${count} 张`;
  }
  if (sourceZone === ZoneType.MAIN_DECK || !sourceZone) {
    return `检视卡组顶 ${count} 张`;
  }
  return `检视${formatZoneName(sourceZone)} ${count} 张`;
}

function formatDiscardLookTopSelectSummaryDetail(input: {
  readonly summaryStatus: 'STARTED' | 'COMPLETED';
  readonly requestedInspectCount: number | null;
  readonly actualInspectedCount: number | null;
  readonly selectedCount: number;
  readonly noSelectedCards: boolean;
  readonly waitingRoomCardCount: number | null;
}): string {
  const inspectCount = input.requestedInspectCount ?? input.actualInspectedCount;
  const parts: string[] = [];
  if (inspectCount !== null) {
    parts.push(`检视卡组顶 ${inspectCount} 张`);
  }
  if (input.summaryStatus === 'STARTED') {
    parts.push('处理中');
  } else if (input.noSelectedCards || input.selectedCount === 0) {
    parts.push('未加入');
  } else {
    parts.push(`加入 ${input.selectedCount} 张卡`);
  }
  if (
    input.summaryStatus === 'COMPLETED' &&
    input.waitingRoomCardCount !== null &&
    input.waitingRoomCardCount > 0
  ) {
    parts.push(`余下 ${input.waitingRoomCardCount} 张放置入休息室`);
  }
  return parts.join('，');
}

function formatArrangeInspectedDeckTopSummaryDetail(input: {
  readonly summaryStatus: 'STARTED' | 'COMPLETED';
  readonly requestedInspectCount: number | null;
  readonly actualInspectedCount: number | null;
  readonly topDeckCount: number;
  readonly noTopDeckCards: boolean;
  readonly waitingRoomCardCount: number | null;
}): string {
  const inspectCount = input.actualInspectedCount ?? input.requestedInspectCount;
  const parts: string[] = [];
  if (inspectCount !== null) {
    parts.push(`检视卡组顶 ${inspectCount} 张`);
  }
  if (input.summaryStatus === 'STARTED') {
    parts.push('排序中');
  } else if (input.topDeckCount > 0) {
    parts.push(`按顺序放回卡组顶 ${input.topDeckCount} 张`);
  } else if (input.noTopDeckCards) {
    parts.push('未放回卡组顶');
  }
  if (
    input.summaryStatus === 'COMPLETED' &&
    input.waitingRoomCardCount !== null &&
    input.waitingRoomCardCount > 0
  ) {
    parts.push(`余下 ${input.waitingRoomCardCount} 张放置入休息室`);
  }
  return parts.join('，');
}

function formatSingleInspectionResultAction(event: PublicEvent, count: number): string {
  const toZone = getMoveTo(event)?.zone;
  if (toZone === ZoneType.HAND) {
    return `从检视结果加入 ${count} 张手牌`;
  }
  if (toZone === ZoneType.WAITING_ROOM) {
    return `将检视结果 ${count} 张放置入休息室`;
  }
  if (toZone === ZoneType.MAIN_DECK || toZone === ZoneType.ENERGY_DECK) {
    return `将 ${count} 张检视牌放回卡组`;
  }
  return `处理 ${count} 张检视牌`;
}

function summarizeInspectionDestinations(events: readonly PublicEvent[]): readonly string[] {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();

  for (const event of events) {
    const toZone = getMoveTo(event)?.zone ?? 'UNKNOWN';
    counts.set(toZone, (counts.get(toZone) ?? 0) + getPublicEventCardCount(event));
    labels.set(toZone, formatInspectionDestinationLabel(toZone));
  }

  return [...counts.entries()].map(([zone, count]) => `${count} 张${labels.get(zone) ?? '移动'}`);
}

function formatInspectionDestinationLabel(zone: string): string {
  switch (zone) {
    case ZoneType.HAND:
      return '加入手牌';
    case ZoneType.WAITING_ROOM:
      return '放置入休息室';
    case ZoneType.MAIN_DECK:
    case ZoneType.ENERGY_DECK:
      return '放回卡组';
    case ZoneType.RESOLUTION_ZONE:
      return '移至解决区';
    default:
      return `移动到${formatZoneName(zone)}`;
  }
}

function formatActionTitle(
  event: PublicEvent,
  action: string,
  input: {
    readonly subjectSeat?: Seat;
    readonly options: PublicBattleLogFormatterOptions;
  }
): string {
  if (event.source === 'SYSTEM') {
    const subject = input.subjectSeat ? formatSeatName(input.subjectSeat, input.options) : null;
    return subject ? `规则处理：${subject}${action}` : `规则处理：${action}`;
  }
  const subject = input.subjectSeat ? formatSeatName(input.subjectSeat, input.options) : '未知玩家';
  return `${subject} ${action}`;
}

function formatMovePathDetail(
  event: PublicEvent,
  options: PublicBattleLogFormatterOptions
): string | null {
  const from = getMoveFrom(event);
  const to = getMoveTo(event);
  if (!from && !to) {
    return null;
  }
  return `来源：${formatZoneRef(from, options)} -> ${formatZoneRef(to, options)}`;
}

function getMoveFrom(event: PublicEvent): PublicZoneRef | undefined {
  if (event.type === 'CardMovedPublic' || event.type === 'CardRevealedAndMoved') {
    return event.from;
  }
  if (event.type === 'CardRevealed') {
    return event.from;
  }
  return undefined;
}

function getMoveTo(event: PublicEvent): PublicZoneRef | undefined {
  if (event.type === 'CardMovedPublic' || event.type === 'CardRevealedAndMoved') {
    return event.to;
  }
  return undefined;
}

function getMoveOwnerSeat(event: PublicEvent): Seat | undefined {
  return getMoveTo(event)?.ownerSeat ?? getMoveFrom(event)?.ownerSeat;
}

function getEventSubjectSeat(event: PublicEvent): Seat | undefined {
  if (event.actorSeat) {
    return event.actorSeat;
  }
  if (event.type === 'DeckRefreshed') {
    return event.ownerSeat;
  }
  if (event.type === 'CardsInspectedSummary') {
    return event.ownerSeat;
  }
  if (event.type === 'WindowStatusChanged') {
    return event.actingSeat ?? event.waitingSeats[0];
  }
  return getMoveOwnerSeat(event);
}

function isCardMoveLikeEvent(event: PublicEvent): boolean {
  return event.type === 'CardMovedPublic' || event.type === 'CardRevealedAndMoved';
}

function isHiddenDeckToInspectionMove(
  event: PublicEvent
): event is Extract<PublicEvent, { type: 'CardMovedPublic' }> {
  return (
    event.type === 'CardMovedPublic' &&
    !event.card &&
    (event.from?.zone === ZoneType.MAIN_DECK || event.from?.zone === ZoneType.ENERGY_DECK) &&
    event.to?.zone === ZoneType.INSPECTION_ZONE
  );
}

function isInspectionResultMove(event: PublicEvent): boolean {
  return isCardMoveLikeEvent(event) && getMoveFrom(event)?.zone === ZoneType.INSPECTION_ZONE;
}

function isSameHiddenInspectionMove(left: PublicEvent, right: PublicEvent): boolean {
  return (
    isHiddenDeckToInspectionMove(left) &&
    isHiddenDeckToInspectionMove(right) &&
    left.source === right.source &&
    left.actorSeat === right.actorSeat &&
    sameZoneRef(left.from, right.from) &&
    sameZoneRef(left.to, right.to)
  );
}

function isSameInspectionResultContext(left: PublicEvent, right: PublicEvent): boolean {
  return (
    isInspectionResultMove(left) &&
    isInspectionResultMove(right) &&
    left.source === right.source &&
    left.actorSeat === right.actorSeat &&
    getMoveFrom(left)?.ownerSeat === getMoveFrom(right)?.ownerSeat
  );
}

function canMergeMoveEvents(left: PublicEvent, right: PublicEvent): boolean {
  return (
    isCardMoveLikeEvent(left) &&
    isCardMoveLikeEvent(right) &&
    !isInspectionResultMove(left) &&
    !isInspectionResultMove(right) &&
    !isHiddenDeckToInspectionMove(left) &&
    !isHiddenDeckToInspectionMove(right) &&
    left.source === right.source &&
    left.actorSeat === right.actorSeat &&
    sameZoneRef(getMoveFrom(left), getMoveFrom(right)) &&
    sameZoneRef(getMoveTo(left), getMoveTo(right))
  );
}

function isHardGroupingBoundary(event: PublicEvent): boolean {
  return (
    event.type === 'PhaseStarted' ||
    event.type === 'SubPhaseStarted' ||
    event.type === 'WindowStatusChanged' ||
    event.type === 'PlayerDeclared' ||
    event.type === 'DeckRefreshed' ||
    event.type === 'CardEffectSummary'
  );
}

function sameZoneRef(left?: PublicZoneRef, right?: PublicZoneRef): boolean {
  return (
    left?.zone === right?.zone && left?.ownerSeat === right?.ownerSeat && left?.slot === right?.slot
  );
}

function formatSeqLabel(seqs: readonly number[]): string {
  const sortedSeqs = [...new Set(seqs)].sort((left, right) => left - right);
  const ranges: string[] = [];
  let rangeStart = sortedSeqs[0]!;
  let previous = sortedSeqs[0]!;

  for (const seq of sortedSeqs.slice(1)) {
    if (seq === previous + 1) {
      previous = seq;
      continue;
    }
    ranges.push(rangeStart === previous ? String(rangeStart) : `${rangeStart}-${previous}`);
    rangeStart = seq;
    previous = seq;
  }

  ranges.push(rangeStart === previous ? String(rangeStart) : `${rangeStart}-${previous}`);
  return ranges.join('/');
}

function formatZoneRef(
  ref: PublicZoneRef | undefined,
  options: PublicBattleLogFormatterOptions
): string {
  if (!ref) {
    return '未知区域';
  }
  const owner = ref.ownerSeat ? formatZoneOwnerLabel(ref.ownerSeat, options) : '';
  return `${owner}${formatZoneName(ref.zone)}`;
}

function formatZoneName(zone: string): string {
  switch (zone) {
    case ZoneType.HAND:
      return '手牌';
    case ZoneType.MAIN_DECK:
      return '主卡组';
    case ZoneType.ENERGY_DECK:
      return '能量卡组';
    case ZoneType.MEMBER_SLOT:
      return '成员区';
    case ZoneType.ENERGY_ZONE:
      return '能量区';
    case ZoneType.LIVE_ZONE:
      return 'LIVE 区';
    case ZoneType.SUCCESS_ZONE:
      return '成功 LIVE 区';
    case ZoneType.WAITING_ROOM:
      return '休息室';
    case ZoneType.EXILE_ZONE:
      return '移除区';
    case ZoneType.RESOLUTION_ZONE:
      return '解决区';
    case ZoneType.INSPECTION_ZONE:
      return '检视区';
    default:
      return zone;
  }
}

function formatZoneOwnerLabel(seat: Seat, options: PublicBattleLogFormatterOptions): string {
  if (options.viewerSeat) {
    return seat === options.viewerSeat ? '你的' : '对手的';
  }
  return seat === 'FIRST' ? '先攻' : '后攻';
}

function formatSeatName(seat: Seat, options: PublicBattleLogFormatterOptions): string {
  const label = options.getSeatLabel(seat).trim();
  if (label && label !== seat) {
    return label;
  }
  return seat === 'FIRST' ? '先攻' : '后攻';
}
