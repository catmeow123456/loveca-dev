import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { getDeckBackUrl } from '@/lib/imageService';
import {
  collectBattleAnimationAnchors,
  collectBattleObjectLocations,
  createBattleAnimationEventsFromViewDiff,
  createDiscardPresentationBatchEvent,
  getDiscardPresentationBatchLayout,
  prepareBattleAnimationLayoutForViewDiff,
  type BattleAnimationAnchorMaps,
  type BattleAnimationCardRender,
  type BattleAnimationEvent,
  type BattleAnimationRect,
  type DiscardPresentationBatchEvent,
} from '@/lib/battleAnimationEvents';
import {
  BATTLE_CARD_MOVE_DURATION_MS,
  BATTLE_CARD_MOVE_SETTLE_BUFFER_MS,
  BATTLE_PULSE_DURATION_MS,
  createSequencedBattleAnimationEvents,
  DISCARD_PRESENTATION_REDUCED_MOTION_DURATION_MS,
  DISCARD_PRESENTATION_REDUCED_MOTION_FADE_MS,
  getBattleAnimationEventDurationMs,
  WAITING_ROOM_REVEAL_DURATION_MS,
  WAITING_ROOM_REVEAL_HOLD_DURATION_MS,
  WAITING_ROOM_REVEAL_MOVE_DURATION_MS,
  type ScheduledBattleAnimationEvent,
} from '@/lib/battleAnimationSequencing';
import {
  createPublicDiscardRevealQueueState,
  dequeuePublicDiscardRevealBatch,
  pruneExpiredPublicDiscardRevealBatches,
  PUBLIC_DISCARD_REVEAL_MAX_AGE_MS,
  updatePublicDiscardRevealQueue,
  type PublicDiscardRevealBatch,
  type PublicDiscardRevealQueueState,
} from '@/lib/publicDiscardRevealQueue';
import { useGameStore } from '@/store/gameStore';
import { ZoneType } from '@game/shared/types/enums';
import type { PlayerViewState } from '@game/online';

const MAX_RENDERED_EVENT_IDS = 200;
const RETAINED_RENDERED_EVENT_IDS = 150;
const MAX_DISCARD_SOURCE_ANCHORS = 32;

export interface RecentDiscardSourceAnchor {
  readonly matchId: string;
  readonly rect: BattleAnimationRect;
  readonly capturedAt: number;
}

export function BattleAnimationLayer() {
  const reduceMotion = useReducedMotion();
  const { playerViewState, publicBattleLog, remoteSessionSource, isReadOnly, getCardImagePath } =
    useGameStore(
      useShallow((s) => ({
        playerViewState: s.playerViewState,
        publicBattleLog: s.publicBattleLog,
        remoteSessionSource: s.remoteSession?.source ?? null,
        isReadOnly: s.getBattleSurfaceCapabilities().isReadOnly,
        getCardImagePath: s.getCardImagePath,
      }))
    );
  const { addBattleAnimationOcclusions, removeBattleAnimationOcclusion } = useGameStore(
    useShallow((s) => ({
      addBattleAnimationOcclusions: s.addBattleAnimationOcclusions,
      removeBattleAnimationOcclusion: s.removeBattleAnimationOcclusion,
    }))
  );
  const [events, setEvents] = useState<BattleAnimationEvent[]>([]);
  const [discardPumpGeneration, setDiscardPumpGeneration] = useState(0);
  const previousViewRef = useRef<PlayerViewState | null>(null);
  const previousAnchorsRef = useRef<BattleAnimationAnchorMaps | null>(null);
  const renderedEventIdsRef = useRef(new Set<string>());
  const scheduledEventTimeoutsRef = useRef(new Set<number>());
  const activeOcclusionEventIdsRef = useRef(new Set<string>());
  const viewDiffGenerationRef = useRef(0);
  const discardQueueRef = useRef<PublicDiscardRevealQueueState>(
    createPublicDiscardRevealQueueState()
  );
  const activeDiscardEventIdRef = useRef<string | null>(null);
  const recentDiscardSourceAnchorsRef = useRef(new Map<string, RecentDiscardSourceAnchor>());

  useEffect(() => {
    const scheduledEventTimeouts = scheduledEventTimeoutsRef.current;
    const activeOcclusionEventIds = activeOcclusionEventIdsRef.current;

    return () => {
      clearPendingBattleAnimations({
        scheduledEventTimeouts,
        activeOcclusionEventIds,
        removeBattleAnimationOcclusion,
      });
    };
  }, [removeBattleAnimationOcclusion]);

  useLayoutEffect(() => {
    const previousViewState = previousViewRef.current;
    const playerViewChanged = previousViewState !== playerViewState;
    const viewDiffGeneration = getNextViewDiffGeneration(
      viewDiffGenerationRef.current,
      playerViewChanged
    );
    viewDiffGenerationRef.current = viewDiffGeneration;
    const previousAnchors = previousAnchorsRef.current;
    if (previousViewState?.match.matchId !== playerViewState?.match.matchId) {
      renderedEventIdsRef.current.clear();
      recentDiscardSourceAnchorsRef.current.clear();
      activeDiscardEventIdRef.current = null;
      discardQueueRef.current = createPublicDiscardRevealQueueState();
      setEvents([]);
      clearPendingBattleAnimations({
        scheduledEventTimeouts: scheduledEventTimeoutsRef.current,
        activeOcclusionEventIds: activeOcclusionEventIdsRef.current,
        removeBattleAnimationOcclusion,
      });
    }

    if (playerViewChanged && playerViewState && previousViewState && !isReadOnly) {
      prepareBattleAnimationLayoutForViewDiff({
        previousViewState,
        nextViewState: playerViewState,
      });
    }

    const nextAnchors = collectBattleAnimationAnchors();
    const nextEvents: BattleAnimationEvent[] = [];
    const discardClockNow = getDiscardPresentationMonotonicNow();

    if (
      playerViewChanged &&
      playerViewState &&
      previousViewState &&
      previousAnchors &&
      !isReadOnly
    ) {
      rememberVisibleDiscardSourceAnchors({
        previousViewState,
        nextViewState: playerViewState,
        previousAnchors,
        anchors: recentDiscardSourceAnchorsRef.current,
        now: discardClockNow,
      });
      nextEvents.push(
        ...createBattleAnimationEventsFromViewDiff({
          previousViewState,
          nextViewState: playerViewState,
          previousAnchors,
          nextAnchors,
          enableWaitingRoomRevealFallback: remoteSessionSource === 'TUTORIAL',
        }).filter((event) => !renderedEventIdsRef.current.has(event.id))
      );
    }

    if (
      playerViewState &&
      publicBattleLog.matchId === playerViewState.match.matchId &&
      remoteSessionSource !== 'TUTORIAL'
    ) {
      const previousQueue = discardQueueRef.current;
      const shouldResetActivePresentation =
        (isReadOnly && activeDiscardEventIdRef.current !== null) ||
        (previousQueue.matchId !== null &&
          (previousQueue.matchId !== publicBattleLog.matchId ||
            previousQueue.presentationEpoch !== publicBattleLog.presentationEpoch ||
            publicBattleLog.currentPublicSeq < previousQueue.latestPublicSeq));
      const queueInput = {
        matchId: publicBattleLog.matchId,
        presentationEpoch: publicBattleLog.presentationEpoch,
        currentPublicSeq: publicBattleLog.currentPublicSeq,
        publicEvents: publicBattleLog.events,
        now: discardClockNow,
      };
      discardQueueRef.current = updatePublicDiscardRevealQueue(
        isReadOnly ? createPublicDiscardRevealQueueState() : previousQueue,
        queueInput
      );

      if (shouldResetActivePresentation) {
        activeDiscardEventIdRef.current = null;
        setEvents((current) =>
          current.filter((event) => event.kind !== 'DISCARD_PRESENTATION_BATCH')
        );
        clearPendingBattleAnimations({
          scheduledEventTimeouts: scheduledEventTimeoutsRef.current,
          activeOcclusionEventIds: activeOcclusionEventIdsRef.current,
          removeBattleAnimationOcclusion,
        });
      }

      const prunedQueue = pruneExpiredPublicDiscardRevealBatches(
        discardQueueRef.current,
        queueInput.now
      );
      discardQueueRef.current = prunedQueue.state;
      removeDiscardPresentationBatchOcclusions({
        batches: prunedQueue.expiredBatches,
        activeOcclusionEventIds: activeOcclusionEventIdsRef.current,
        removeBattleAnimationOcclusion,
      });

      if (!isReadOnly) {
        addDiscardPresentationBatchOcclusions({
          batches: discardQueueRef.current.queue,
          activeOcclusionEventIds: activeOcclusionEventIdsRef.current,
          addBattleAnimationOcclusions,
        });
      }

      if (
        !isReadOnly &&
        !activeDiscardEventIdRef.current &&
        publicBattleLog.cursorSeq >= publicBattleLog.currentPublicSeq
      ) {
        let pendingBatch = discardQueueRef.current.queue[0];
        let discardEvent: DiscardPresentationBatchEvent | null = null;
        while (pendingBatch && !discardEvent) {
          discardEvent = createPublicDiscardPresentationEvent({
            batch: pendingBatch,
            matchId: playerViewState.match.matchId,
            viewerSeat: playerViewState.match.viewerSeat,
            nextAnchors,
            previousAnchors,
            recentSourceAnchors: recentDiscardSourceAnchorsRef.current,
          });
          if (!discardEvent) {
            const skipped = dequeuePublicDiscardRevealBatch(discardQueueRef.current);
            discardQueueRef.current = skipped.state;
            removeDiscardPresentationBatchOcclusions({
              batches: skipped.batch ? [skipped.batch] : [],
              activeOcclusionEventIds: activeOcclusionEventIdsRef.current,
              removeBattleAnimationOcclusion,
            });
            pendingBatch = discardQueueRef.current.queue[0];
          }
        }
        if (discardEvent) {
          discardQueueRef.current = dequeuePublicDiscardRevealBatch(discardQueueRef.current).state;
          activeDiscardEventIdRef.current = discardEvent.id;
          nextEvents.push(discardEvent);
        }
      }
    }

    if (nextEvents.length > 0) {
      for (const event of nextEvents) {
        rememberRenderedEventId(renderedEventIdsRef.current, event.id);
      }
      const scheduledEvents = reduceMotion
        ? nextEvents.map((event) => ({ event, delayMs: 0 }))
        : createSequencedBattleAnimationEvents(nextEvents);
      const moveOcclusions = scheduledEvents.flatMap((scheduledEvent) => {
        if (scheduledEvent.event.kind === 'CARD_MOVE') {
          if (reduceMotion) {
            return [];
          }
          return [
            {
              eventId: scheduledEvent.event.id,
              objectId: scheduledEvent.event.render.objectId,
              delayMs: scheduledEvent.delayMs,
              durationMs: getBattleAnimationEventDurationMs(scheduledEvent.event),
            },
          ];
        }
        if (scheduledEvent.event.kind === 'DISCARD_PRESENTATION_BATCH') {
          return scheduledEvent.event.cards.map((card) => ({
            eventId: `${scheduledEvent.event.id}:${card.render.objectId}`,
            objectId: card.render.objectId,
            delayMs: scheduledEvent.delayMs,
            durationMs: getBattleAnimationEventDurationMs(
              scheduledEvent.event,
              Boolean(reduceMotion)
            ),
          }));
        }
        return [];
      });
      addBattleAnimationOcclusions(
        moveOcclusions.map((occlusion) => ({
          eventId: occlusion.eventId,
          objectId: occlusion.objectId,
        }))
      );
      for (const occlusion of moveOcclusions) {
        activeOcclusionEventIdsRef.current.add(occlusion.eventId);
      }
      for (const occlusion of moveOcclusions) {
        const timeout = window.setTimeout(
          () => {
            scheduledEventTimeoutsRef.current.delete(timeout);
            activeOcclusionEventIdsRef.current.delete(occlusion.eventId);
            removeBattleAnimationOcclusion(occlusion.eventId);
          },
          occlusion.delayMs + occlusion.durationMs + BATTLE_CARD_MOVE_SETTLE_BUFFER_MS
        );
        scheduledEventTimeoutsRef.current.add(timeout);
      }

      const immediateEvents = scheduledEvents
        .filter((scheduledEvent) => scheduledEvent.delayMs === 0)
        .map((scheduledEvent) => scheduledEvent.event);
      if (immediateEvents.length > 0) {
        setEvents((current) => [...current.slice(-12), ...immediateEvents]);
      }

      const delayedEventGroups = groupDelayedEventsByDelay(scheduledEvents);
      for (const [delayMs, delayedEvents] of delayedEventGroups) {
        const timeout = window.setTimeout(() => {
          scheduledEventTimeoutsRef.current.delete(timeout);
          if (viewDiffGenerationRef.current !== viewDiffGeneration) {
            removeOcclusionsForAnimationEvents({
              events: delayedEvents,
              activeOcclusionEventIds: activeOcclusionEventIdsRef.current,
              removeBattleAnimationOcclusion,
            });
            return;
          }
          setEvents((current) => [...current.slice(-12), ...delayedEvents]);
        }, delayMs);
        scheduledEventTimeoutsRef.current.add(timeout);
      }
    }

    previousViewRef.current = playerViewState;
    previousAnchorsRef.current = nextAnchors;
  }, [
    addBattleAnimationOcclusions,
    discardPumpGeneration,
    isReadOnly,
    playerViewState,
    publicBattleLog,
    reduceMotion,
    remoteSessionSource,
    removeBattleAnimationOcclusion,
  ]);

  const removeEvent = (event: BattleAnimationEvent) => {
    removeOcclusionsForAnimationEvents({
      events: [event],
      activeOcclusionEventIds: activeOcclusionEventIdsRef.current,
      removeBattleAnimationOcclusion,
    });
    setEvents((current) => current.filter((candidate) => candidate.id !== event.id));
    if (
      event.kind === 'DISCARD_PRESENTATION_BATCH' &&
      activeDiscardEventIdRef.current === event.id
    ) {
      activeDiscardEventIdRef.current = null;
      setDiscardPumpGeneration((current) => current + 1);
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[96]">
      <AnimatePresence>
        {events.map((event) => {
          if (event.kind === 'DISCARD_PRESENTATION_BATCH') {
            return (
              <DiscardPresentationBatch
                key={event.id}
                event={event}
                getCardImagePath={getCardImagePath}
                reduceMotion={reduceMotion}
                onDone={() => removeEvent(event)}
              />
            );
          }
          if (event.kind === 'CARD_MOVE') {
            const imagePath =
              (event.render.surface === 'FRONT' ? event.render.imageSrc : undefined) ??
              (event.render.surface === 'FRONT' && event.render.cardCode
                ? getCardImagePath(event.render.cardCode)
                : getDeckBackUrl());
            const imageAlt = event.render.surface === 'FRONT' ? (event.render.name ?? '') : '';
            return (
              <MovingCard
                key={event.id}
                event={event}
                imagePath={imagePath}
                imageAlt={imageAlt}
                reduceMotion={reduceMotion}
                onDone={() => removeEvent(event)}
              />
            );
          }

          return (
            <PulseFrame
              key={event.id}
              event={event}
              reduceMotion={reduceMotion}
              onDone={() => removeEvent(event)}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/** Public-log and discard-pump rerenders must not invalidate delayed view-diff animations. */
export function getNextViewDiffGeneration(
  currentGeneration: number,
  playerViewChanged: boolean
): number {
  return playerViewChanged ? currentGeneration + 1 : currentGeneration;
}

/** TTLs use one client monotonic clock and never compare browser time with server timestamps. */
export function getDiscardPresentationMonotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function rememberRenderedEventId(renderedEventIds: Set<string>, eventId: string): void {
  renderedEventIds.add(eventId);
  if (renderedEventIds.size <= MAX_RENDERED_EVENT_IDS) {
    return;
  }

  const retainedEventIds = Array.from(renderedEventIds).slice(-RETAINED_RENDERED_EVENT_IDS);
  renderedEventIds.clear();
  for (const retainedEventId of retainedEventIds) {
    renderedEventIds.add(retainedEventId);
  }
}

function rememberVisibleDiscardSourceAnchors({
  previousViewState,
  nextViewState,
  previousAnchors,
  anchors,
  now,
}: {
  readonly previousViewState: PlayerViewState;
  readonly nextViewState: PlayerViewState;
  readonly previousAnchors: BattleAnimationAnchorMaps;
  readonly anchors: Map<string, RecentDiscardSourceAnchor>;
  readonly now: number;
}): void {
  const previousLocations = collectBattleObjectLocations(previousViewState);
  const nextLocations = collectBattleObjectLocations(nextViewState);
  const viewerSeat = previousViewState.match.viewerSeat;

  for (const [objectId, previousLocation] of previousLocations) {
    const nextLocation = nextLocations.get(objectId);
    const previousObject = previousViewState.objects[objectId];
    if (
      previousLocation.zoneType !== ZoneType.HAND ||
      nextLocation?.zoneType !== ZoneType.WAITING_ROOM ||
      previousObject?.ownerSeat !== viewerSeat
    ) {
      continue;
    }

    const rect =
      previousAnchors.cards.get(objectId) ??
      previousAnchors.zones.get(`seat-${previousObject.ownerSeat}::hand`);
    if (!rect) {
      continue;
    }
    anchors.set(objectId, {
      matchId: previousViewState.match.matchId,
      rect,
      capturedAt: now,
    });
  }

  for (const [objectId, anchor] of anchors) {
    if (
      anchor.matchId !== nextViewState.match.matchId ||
      now - anchor.capturedAt > PUBLIC_DISCARD_REVEAL_MAX_AGE_MS
    ) {
      anchors.delete(objectId);
    }
  }
  while (anchors.size > MAX_DISCARD_SOURCE_ANCHORS) {
    const oldestObjectId = anchors.keys().next().value as string | undefined;
    if (!oldestObjectId) {
      break;
    }
    anchors.delete(oldestObjectId);
  }
}

export function createPublicDiscardPresentationEvent({
  batch,
  matchId,
  viewerSeat,
  nextAnchors,
  previousAnchors,
  recentSourceAnchors,
}: {
  readonly batch: PublicDiscardRevealBatch;
  readonly matchId: string;
  readonly viewerSeat: PlayerViewState['match']['viewerSeat'];
  readonly nextAnchors: BattleAnimationAnchorMaps;
  readonly previousAnchors: BattleAnimationAnchorMaps | null;
  readonly recentSourceAnchors: ReadonlyMap<string, RecentDiscardSourceAnchor>;
}): DiscardPresentationBatchEvent | null {
  const handAnchorKey = `seat-${batch.ownerSeat}::hand`;
  const waitingRoomAnchorKey = `seat-${batch.ownerSeat}::waiting-room`;
  const anonymousHandRect =
    nextAnchors.zones.get(handAnchorKey) ?? previousAnchors?.zones.get(handAnchorKey);
  const waitingRoomRect =
    nextAnchors.zones.get(waitingRoomAnchorKey) ?? previousAnchors?.zones.get(waitingRoomAnchorKey);
  if (!anonymousHandRect || !waitingRoomRect) {
    return null;
  }

  return createDiscardPresentationBatchEvent({
    id: getPublicDiscardPresentationEventId(batch),
    toSeat: batch.ownerSeat,
    toZoneKey: `${batch.ownerSeat}_WAITING_ROOM`,
    toRect: waitingRoomRect,
    cards: batch.cards.map((card) => {
      const recentSourceAnchor = recentSourceAnchors.get(card.publicObjectId);
      const canUseIndividualSource =
        batch.ownerSeat === viewerSeat && recentSourceAnchor?.matchId === matchId;
      return {
        render: {
          objectId: card.publicObjectId,
          cardId: card.publicObjectId.startsWith('obj_')
            ? card.publicObjectId.slice(4)
            : card.publicObjectId,
          fromSurface: batch.ownerSeat === viewerSeat ? 'FRONT' : 'BACK',
          toSurface: 'FRONT',
          surface: 'FRONT',
          cardCode: card.cardCode,
        },
        fromRect:
          canUseIndividualSource && recentSourceAnchor
            ? recentSourceAnchor.rect
            : anonymousHandRect,
      };
    }),
  });
}

export function getPublicDiscardPresentationEventId(batch: PublicDiscardRevealBatch): string {
  return `public-discard:${batch.movementBatchId}`;
}

export function getPublicDiscardPresentationOcclusions(
  batch: PublicDiscardRevealBatch
): readonly { readonly eventId: string; readonly objectId: string }[] {
  const eventId = getPublicDiscardPresentationEventId(batch);
  return batch.cards.map((card) => ({
    eventId: `${eventId}:${card.publicObjectId}`,
    objectId: card.publicObjectId,
  }));
}

function addDiscardPresentationBatchOcclusions({
  batches,
  activeOcclusionEventIds,
  addBattleAnimationOcclusions,
}: {
  readonly batches: readonly PublicDiscardRevealBatch[];
  readonly activeOcclusionEventIds: Set<string>;
  readonly addBattleAnimationOcclusions: (
    occlusions: readonly { readonly eventId: string; readonly objectId: string }[]
  ) => void;
}): void {
  const newOcclusions = batches
    .flatMap(getPublicDiscardPresentationOcclusions)
    .filter((occlusion) => !activeOcclusionEventIds.has(occlusion.eventId));
  if (newOcclusions.length === 0) {
    return;
  }
  addBattleAnimationOcclusions(newOcclusions);
  for (const occlusion of newOcclusions) {
    activeOcclusionEventIds.add(occlusion.eventId);
  }
}

function removeDiscardPresentationBatchOcclusions({
  batches,
  activeOcclusionEventIds,
  removeBattleAnimationOcclusion,
}: {
  readonly batches: readonly PublicDiscardRevealBatch[];
  readonly activeOcclusionEventIds: Set<string>;
  readonly removeBattleAnimationOcclusion: (eventId: string) => void;
}): void {
  for (const occlusion of batches.flatMap(getPublicDiscardPresentationOcclusions)) {
    if (!activeOcclusionEventIds.delete(occlusion.eventId)) {
      continue;
    }
    removeBattleAnimationOcclusion(occlusion.eventId);
  }
}

function clearPendingBattleAnimations({
  scheduledEventTimeouts,
  activeOcclusionEventIds,
  removeBattleAnimationOcclusion,
}: {
  readonly scheduledEventTimeouts: Set<number>;
  readonly activeOcclusionEventIds: Set<string>;
  readonly removeBattleAnimationOcclusion: (eventId: string) => void;
}): void {
  for (const timeout of scheduledEventTimeouts) {
    window.clearTimeout(timeout);
  }
  scheduledEventTimeouts.clear();
  for (const eventId of activeOcclusionEventIds) {
    removeBattleAnimationOcclusion(eventId);
  }
  activeOcclusionEventIds.clear();
}

function groupDelayedEventsByDelay(
  scheduledEvents: readonly ScheduledBattleAnimationEvent[]
): Map<number, BattleAnimationEvent[]> {
  const groups = new Map<number, BattleAnimationEvent[]>();
  for (const scheduledEvent of scheduledEvents) {
    if (scheduledEvent.delayMs <= 0) {
      continue;
    }
    const group = groups.get(scheduledEvent.delayMs);
    if (group) {
      group.push(scheduledEvent.event);
    } else {
      groups.set(scheduledEvent.delayMs, [scheduledEvent.event]);
    }
  }
  return groups;
}

function removeOcclusionsForAnimationEvents({
  events,
  activeOcclusionEventIds,
  removeBattleAnimationOcclusion,
}: {
  readonly events: readonly BattleAnimationEvent[];
  readonly activeOcclusionEventIds: Set<string>;
  readonly removeBattleAnimationOcclusion: (eventId: string) => void;
}): void {
  for (const event of events) {
    for (const eventId of getAnimationOcclusionEventIds(event)) {
      if (!activeOcclusionEventIds.has(eventId)) {
        continue;
      }
      activeOcclusionEventIds.delete(eventId);
      removeBattleAnimationOcclusion(eventId);
    }
  }
}

function getAnimationOcclusionEventIds(event: BattleAnimationEvent): readonly string[] {
  if (event.kind === 'CARD_MOVE') {
    return [event.id];
  }
  if (event.kind === 'DISCARD_PRESENTATION_BATCH') {
    return event.cards.map((card) => `${event.id}:${card.render.objectId}`);
  }
  return [];
}

function MovingCard({
  event,
  imagePath,
  imageAlt,
  reduceMotion,
  onDone,
}: {
  readonly event: Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }>;
  readonly imagePath: string;
  readonly imageAlt: string;
  readonly reduceMotion: boolean | null;
  readonly onDone: () => void;
}) {
  const fromCenter = getRectCenter(event.fromRect);
  const toCenter = getRectCenter(event.toRect);
  const fromRect = normalizeCardMoveRect(event, event.fromRect, 'from');
  const toRect = normalizeCardMoveRect(event, event.toRect, 'to');
  const startRotate = getCardMoveRotation(event.fromZoneType);
  const endRotate = getCardMoveRotation(event.toZoneType);
  const startWidth = clamp(fromRect.width || toRect.width, 12, 140);
  const startHeight = clamp(fromRect.height || toRect.height, 16, 196);
  const endWidth = clamp(toRect.width || fromRect.width, 12, 140);
  const endHeight = clamp(toRect.height || fromRect.height, 16, 196);
  const startLeft = fromCenter.x - startWidth / 2;
  const startTop = fromCenter.y - startHeight / 2;
  const endLeft = toCenter.x - endWidth / 2;
  const endTop = toCenter.y - endHeight / 2;
  const deltaX = endLeft - startLeft;
  const deltaY = endTop - startTop;

  if (reduceMotion) {
    return (
      <PulseFrame
        event={{ id: event.id, kind: 'ZONE_PULSE', rect: event.toRect }}
        reduceMotion={reduceMotion}
        onDone={onDone}
      />
    );
  }

  return (
    <motion.div
      className="fixed overflow-hidden rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_82%,white)] bg-[var(--bg-overlay)] shadow-[0_10px_28px_rgba(0,0,0,0.34),0_1px_0_rgba(255,255,255,0.08)_inset]"
      style={{
        width: startWidth,
        height: startHeight,
        left: startLeft,
        top: startTop,
        transformOrigin: 'center center',
        willChange: 'transform, opacity',
      }}
      initial={{ opacity: 0.92, x: 0, y: 0, rotate: startRotate, scale: 0.985 }}
      animate={{
        x: deltaX,
        y: deltaY,
        rotate: endRotate,
        width: endWidth,
        height: endHeight,
        opacity: 1,
        scale: 1,
      }}
      exit={{ opacity: 0, scale: 0.995, transition: { duration: 0.05 } }}
      transition={{
        duration: BATTLE_CARD_MOVE_DURATION_MS / 1000,
        ease: [0.22, 1, 0.36, 1],
      }}
      onAnimationComplete={onDone}
    >
      <img
        src={imagePath}
        alt={imageAlt}
        className="h-full w-full object-cover"
        draggable={false}
      />
    </motion.div>
  );
}

export function DiscardPresentationBatch({
  event,
  getCardImagePath,
  reduceMotion,
  onDone,
}: {
  readonly event: DiscardPresentationBatchEvent;
  readonly getCardImagePath: (cardCode: string) => string;
  readonly reduceMotion: boolean | null;
  readonly onDone: () => void;
}) {
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight;
  const layout = getDiscardPresentationBatchLayout({
    count: event.cards.length,
    toRect: event.toRect,
    toSeat: event.toSeat,
    viewportWidth,
    viewportHeight,
  });
  const toRect = normalizePortraitCardRect(event.toRect);
  const firstKeyframeTime = WAITING_ROOM_REVEAL_MOVE_DURATION_MS / WAITING_ROOM_REVEAL_DURATION_MS;
  const secondKeyframeTime =
    (WAITING_ROOM_REVEAL_MOVE_DURATION_MS + WAITING_ROOM_REVEAL_HOLD_DURATION_MS) /
    WAITING_ROOM_REVEAL_DURATION_MS;
  const labelTop = clamp(
    layout.bounds.top >= 34 ? layout.bounds.top - 26 : layout.bounds.top + 4,
    8,
    Math.max(8, viewportHeight - 28)
  );

  if (reduceMotion) {
    const fadeTime =
      DISCARD_PRESENTATION_REDUCED_MOTION_FADE_MS / DISCARD_PRESENTATION_REDUCED_MOTION_DURATION_MS;
    return (
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{
          duration: DISCARD_PRESENTATION_REDUCED_MOTION_DURATION_MS / 1000,
          times: [0, fadeTime, 1 - fadeTime, 1],
          ease: 'linear',
        }}
        onAnimationComplete={onDone}
      >
        <DiscardPresentationLabel
          count={event.cards.length}
          left={layout.bounds.left + layout.bounds.width / 2}
          top={labelTop}
        />
        {event.cards.map((card, index) => {
          const cardLayout = layout.cards[index];
          if (!cardLayout) return null;
          return (
            <DiscardPresentationCardFace
              key={card.render.objectId}
              render={card.render}
              imagePath={resolveDiscardPresentationImagePath(card.render, getCardImagePath)}
              rect={cardLayout}
              rotation={cardLayout.rotation}
            />
          );
        })}
      </motion.div>
    );
  }

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0">
      <motion.div
        className="fixed"
        style={{ left: layout.bounds.left + layout.bounds.width / 2, top: labelTop }}
        initial={{ opacity: 0, y: 2 }}
        animate={{ opacity: [0, 1, 1, 0], y: [2, 0, 0, -1] }}
        transition={{
          duration: WAITING_ROOM_REVEAL_DURATION_MS / 1000,
          times: [0, firstKeyframeTime, secondKeyframeTime, 1],
          ease: 'linear',
        }}
      >
        <DiscardPresentationLabel count={event.cards.length} />
      </motion.div>
      {event.cards.map((card, index) => {
        const revealRect = layout.cards[index];
        if (!revealRect) return null;
        const fromRect = normalizePortraitCardRect(card.fromRect);
        const fromCenter = getRectCenter(fromRect);
        const toCenter = getRectCenter(toRect);
        const startWidth = clamp(fromRect.width || revealRect.width, 12, 140);
        const startHeight = clamp(fromRect.height || revealRect.height, 16, 196);
        const endWidth = clamp(toRect.width || revealRect.width, 12, 140);
        const endHeight = clamp(toRect.height || revealRect.height, 16, 196);
        const startLeft = fromCenter.x - startWidth / 2;
        const startTop = fromCenter.y - startHeight / 2;
        const endLeft = toCenter.x - endWidth / 2;
        const endTop = toCenter.y - endHeight / 2;

        return (
          <motion.div
            key={card.render.objectId}
            className="fixed overflow-hidden rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_82%,white)] bg-[var(--bg-overlay)] shadow-[0_16px_36px_rgba(0,0,0,0.42),0_1px_0_rgba(255,255,255,0.08)_inset]"
            style={{
              width: startWidth,
              height: startHeight,
              left: startLeft,
              top: startTop,
              transformOrigin: 'center center',
              willChange: 'transform, width, height, opacity',
            }}
            initial={{ opacity: 0.94, x: 0, y: 0, rotate: 0 }}
            animate={{
              x: [0, revealRect.left - startLeft, revealRect.left - startLeft, endLeft - startLeft],
              y: [0, revealRect.top - startTop, revealRect.top - startTop, endTop - startTop],
              rotate: [0, revealRect.rotation, revealRect.rotation, 0],
              width: [startWidth, revealRect.width, revealRect.width, endWidth],
              height: [startHeight, revealRect.height, revealRect.height, endHeight],
              opacity: [0.94, 1, 1, 1],
              scale: [0.985, 1, 1, 1],
            }}
            exit={{ opacity: 0, scale: 0.995, transition: { duration: 0.05 } }}
            transition={{
              duration: WAITING_ROOM_REVEAL_DURATION_MS / 1000,
              times: [0, firstKeyframeTime, secondKeyframeTime, 1],
              ease: ['easeOut', 'linear', 'easeInOut'],
            }}
            onAnimationComplete={index === 0 ? onDone : undefined}
          >
            <img
              src={resolveDiscardPresentationImagePath(card.render, getCardImagePath)}
              alt=""
              className="h-full w-full object-cover"
              draggable={false}
            />
          </motion.div>
        );
      })}
    </div>
  );
}

function DiscardPresentationLabel({
  count,
  left,
  top,
}: {
  readonly count: number;
  readonly left?: number;
  readonly top?: number;
}) {
  return (
    <div
      className={cn(
        '-translate-x-1/2 whitespace-nowrap rounded-full border border-[color:color-mix(in_srgb,var(--border-default)_82%,white)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_90%,transparent)] px-2 py-1 text-[10px] font-semibold leading-none text-[var(--text-primary)] shadow-[0_6px_18px_rgba(0,0,0,0.3)] backdrop-blur-md',
        left !== undefined && top !== undefined && 'fixed'
      )}
      style={{ left, top }}
    >
      放置入休息室 ×{count}
    </div>
  );
}

function DiscardPresentationCardFace({
  render,
  imagePath,
  rect,
  rotation,
}: {
  readonly render: BattleAnimationCardRender;
  readonly imagePath: string;
  readonly rect: BattleAnimationRect;
  readonly rotation: number;
}) {
  return (
    <div
      data-discard-presentation-object-id={render.objectId}
      className="fixed overflow-hidden rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_82%,white)] bg-[var(--bg-overlay)] shadow-[0_16px_36px_rgba(0,0,0,0.42),0_1px_0_rgba(255,255,255,0.08)_inset]"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        transform: `rotate(${rotation}deg)`,
      }}
    >
      <img src={imagePath} alt="" className="h-full w-full object-cover" draggable={false} />
    </div>
  );
}

function resolveDiscardPresentationImagePath(
  render: BattleAnimationCardRender,
  getCardImagePath: (cardCode: string) => string
): string {
  return (
    render.imageSrc ?? (render.cardCode ? getCardImagePath(render.cardCode) : getDeckBackUrl())
  );
}

function PulseFrame({
  event,
  reduceMotion,
  onDone,
}: {
  readonly event: Exclude<
    BattleAnimationEvent,
    { kind: 'CARD_MOVE' } | { kind: 'DISCARD_PRESENTATION_BATCH' }
  >;
  readonly reduceMotion: boolean | null;
  readonly onDone: () => void;
}) {
  const rect = event.rect;
  const isOrientation = event.kind === 'ORIENTATION_CHANGE';
  const isFlip = event.kind === 'CARD_FLIP';

  return (
    <motion.div
      className={cn(
        'fixed rounded-lg border',
        isOrientation &&
          'border-indigo-200/80 bg-indigo-400/10 shadow-[0_0_18px_rgba(129,140,248,0.4)]',
        isFlip && 'border-amber-200/80 bg-amber-400/10 shadow-[0_0_18px_rgba(251,191,36,0.42)]',
        event.kind === 'ZONE_PULSE' &&
          'border-emerald-200/70 bg-emerald-400/10 shadow-[0_0_18px_rgba(52,211,153,0.32)]'
      )}
      style={{
        left: rect.left,
        top: rect.top,
        width: Math.max(rect.width, 32),
        height: Math.max(rect.height, 24),
        willChange: 'transform, opacity',
      }}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={
        reduceMotion ? { opacity: 0.8 } : { opacity: [0.15, 0.9, 0], scale: [0.96, 1.06, 1] }
      }
      exit={{ opacity: 0 }}
      transition={{ duration: (reduceMotion ? 120 : BATTLE_PULSE_DURATION_MS) / 1000 }}
      onAnimationComplete={onDone}
    />
  );
}

function getRectCenter(rect: BattleAnimationRect): { readonly x: number; readonly y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeCardMoveRect(
  event: Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }>,
  rect: BattleAnimationRect,
  side: 'from' | 'to'
): BattleAnimationRect {
  if (rect.width <= 0 || rect.height <= 0) {
    return rect;
  }

  const zoneType = side === 'from' ? event.fromZoneType : event.toZoneType;
  if (isHorizontalCardZone(zoneType)) {
    return normalizeHorizontalCardRect(rect);
  }

  const isDeckHandMove =
    (event.fromZoneType === ZoneType.MAIN_DECK && event.toZoneType === ZoneType.HAND) ||
    (event.fromZoneType === ZoneType.ENERGY_DECK && event.toZoneType === ZoneType.HAND) ||
    (event.fromZoneType === ZoneType.HAND && event.toZoneType === ZoneType.MAIN_DECK) ||
    (event.fromZoneType === ZoneType.HAND && event.toZoneType === ZoneType.ENERGY_DECK);
  if (!isDeckHandMove) {
    return rect;
  }

  return normalizePortraitCardRect(rect);
}

function normalizePortraitCardRect(rect: BattleAnimationRect): BattleAnimationRect {
  const center = getRectCenter(rect);
  const cardAspect = 5 / 7;
  let width = rect.width;
  let height = width / cardAspect;
  if (height > rect.height) {
    height = rect.height;
    width = height * cardAspect;
  }

  return {
    left: center.x - width / 2,
    top: center.y - height / 2,
    width,
    height,
  };
}

function normalizeHorizontalCardRect(rect: BattleAnimationRect): BattleAnimationRect {
  const center = getRectCenter(rect);
  const portraitRect = normalizePortraitCardRect({
    left: center.x - rect.height / 2,
    top: center.y - rect.width / 2,
    width: rect.height,
    height: rect.width,
  });

  return {
    left: center.x - portraitRect.width / 2,
    top: center.y - portraitRect.height / 2,
    width: portraitRect.width,
    height: portraitRect.height,
  };
}

function getCardMoveRotation(zoneType: string): number {
  return isHorizontalCardZone(zoneType) ? -90 : 0;
}

function isHorizontalCardZone(zoneType: string): boolean {
  return zoneType === ZoneType.LIVE_ZONE || zoneType === ZoneType.SUCCESS_ZONE;
}
