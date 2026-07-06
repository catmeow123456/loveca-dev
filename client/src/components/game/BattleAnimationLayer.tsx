import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { getDeckBackUrl } from '@/lib/imageService';
import {
  collectBattleAnimationAnchors,
  createBattleAnimationEventsFromViewDiff,
  prepareBattleAnimationLayoutForViewDiff,
  type BattleAnimationAnchorMaps,
  type BattleAnimationEvent,
  type BattleAnimationRect,
} from '@/lib/battleAnimationEvents';
import {
  BATTLE_CARD_MOVE_DURATION_MS,
  BATTLE_CARD_MOVE_SETTLE_BUFFER_MS,
  BATTLE_PULSE_DURATION_MS,
  createSequencedBattleAnimationEvents,
  getBattleAnimationEventDurationMs,
  WAITING_ROOM_REVEAL_DURATION_MS,
  WAITING_ROOM_REVEAL_HOLD_DURATION_MS,
  WAITING_ROOM_REVEAL_MOVE_DURATION_MS,
  type ScheduledBattleAnimationEvent,
} from '@/lib/battleAnimationSequencing';
import { useGameStore } from '@/store/gameStore';
import { ZoneType } from '@game/shared/types/enums';
import type { PlayerViewState } from '@game/online';

const MAX_RENDERED_EVENT_IDS = 200;
const RETAINED_RENDERED_EVENT_IDS = 150;

export function BattleAnimationLayer() {
  const reduceMotion = useReducedMotion();
  const { playerViewState, isReadOnly, getCardImagePath } = useGameStore(
    useShallow((s) => ({
      playerViewState: s.playerViewState,
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
  const previousViewRef = useRef<PlayerViewState | null>(null);
  const previousAnchorsRef = useRef<BattleAnimationAnchorMaps | null>(null);
  const renderedEventIdsRef = useRef(new Set<string>());
  const scheduledEventTimeoutsRef = useRef(new Set<number>());
  const activeOcclusionEventIdsRef = useRef(new Set<string>());
  const viewDiffGenerationRef = useRef(0);

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
    const viewDiffGeneration = viewDiffGenerationRef.current + 1;
    viewDiffGenerationRef.current = viewDiffGeneration;
    const previousViewState = previousViewRef.current;
    const previousAnchors = previousAnchorsRef.current;
    if (previousViewState?.match.matchId !== playerViewState?.match.matchId) {
      renderedEventIdsRef.current.clear();
      setEvents([]);
      clearPendingBattleAnimations({
        scheduledEventTimeouts: scheduledEventTimeoutsRef.current,
        activeOcclusionEventIds: activeOcclusionEventIdsRef.current,
        removeBattleAnimationOcclusion,
      });
    }

    if (playerViewState && previousViewState && !isReadOnly) {
      prepareBattleAnimationLayoutForViewDiff({
        previousViewState,
        nextViewState: playerViewState,
      });
    }

    const nextAnchors = collectBattleAnimationAnchors();

    if (playerViewState && previousViewState && previousAnchors && !isReadOnly) {
      const nextEvents = createBattleAnimationEventsFromViewDiff({
        previousViewState,
        nextViewState: playerViewState,
        previousAnchors,
        nextAnchors,
      }).filter((event) => !renderedEventIdsRef.current.has(event.id));

      if (nextEvents.length > 0) {
        for (const event of nextEvents) {
          rememberRenderedEventId(renderedEventIdsRef.current, event.id);
        }
        const scheduledEvents = reduceMotion
          ? nextEvents.map((event) => ({ event, delayMs: 0 }))
          : createSequencedBattleAnimationEvents(nextEvents);
        const moveOcclusions = reduceMotion
          ? []
          : scheduledEvents
              .filter(
                (
                  scheduledEvent
                ): scheduledEvent is {
                  readonly event: Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }>;
                  readonly delayMs: number;
                } => scheduledEvent.event.kind === 'CARD_MOVE'
              )
              .map((scheduledEvent) => ({
                eventId: scheduledEvent.event.id,
                objectId: scheduledEvent.event.render.objectId,
                delayMs: scheduledEvent.delayMs,
                durationMs: getBattleAnimationEventDurationMs(scheduledEvent.event),
              }));
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
    }

    previousViewRef.current = playerViewState;
    previousAnchorsRef.current = nextAnchors;
  }, [
    addBattleAnimationOcclusions,
    isReadOnly,
    playerViewState,
    reduceMotion,
    removeBattleAnimationOcclusion,
  ]);

  const removeEvent = (eventId: string) => {
    activeOcclusionEventIdsRef.current.delete(eventId);
    removeBattleAnimationOcclusion(eventId);
    setEvents((current) => current.filter((event) => event.id !== eventId));
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-[96]">
      <AnimatePresence>
        {events.map((event) => {
          if (event.kind === 'CARD_MOVE') {
            const imagePath =
              (event.render.surface === 'FRONT' ? event.render.imageSrc : undefined) ??
              (event.render.surface === 'FRONT' && event.render.cardCode
                ? getCardImagePath(event.render.cardCode)
                : getDeckBackUrl());
            const imageAlt = event.render.surface === 'FRONT' ? (event.render.name ?? '') : '';
            if (event.presentation === 'WAITING_ROOM_REVEAL') {
              return (
                <WaitingRoomRevealMovingCard
                  key={event.id}
                  event={event}
                  imagePath={imagePath}
                  imageAlt={imageAlt}
                  reduceMotion={reduceMotion}
                  onDone={() => removeEvent(event.id)}
                />
              );
            }
            return (
              <MovingCard
                key={event.id}
                event={event}
                imagePath={imagePath}
                imageAlt={imageAlt}
                reduceMotion={reduceMotion}
                onDone={() => removeEvent(event.id)}
              />
            );
          }

          return (
            <PulseFrame
              key={event.id}
              event={event}
              reduceMotion={reduceMotion}
              onDone={() => removeEvent(event.id)}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
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
    if (event.kind !== 'CARD_MOVE' || !activeOcclusionEventIds.has(event.id)) {
      continue;
    }
    activeOcclusionEventIds.delete(event.id);
    removeBattleAnimationOcclusion(event.id);
  }
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

function WaitingRoomRevealMovingCard({
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
  const revealRect = getWaitingRoomRevealRect({
    fromRect,
    toRect,
    toSeat: event.toSeat,
  });
  const startWidth = clamp(fromRect.width || toRect.width, 12, 140);
  const startHeight = clamp(fromRect.height || toRect.height, 16, 196);
  const endWidth = clamp(toRect.width || fromRect.width, 12, 140);
  const endHeight = clamp(toRect.height || fromRect.height, 16, 196);
  const startLeft = fromCenter.x - startWidth / 2;
  const startTop = fromCenter.y - startHeight / 2;
  const revealLeft = revealRect.left;
  const revealTop = revealRect.top;
  const endLeft = toCenter.x - endWidth / 2;
  const endTop = toCenter.y - endHeight / 2;
  const firstKeyframeTime = WAITING_ROOM_REVEAL_MOVE_DURATION_MS / WAITING_ROOM_REVEAL_DURATION_MS;
  const secondKeyframeTime =
    (WAITING_ROOM_REVEAL_MOVE_DURATION_MS + WAITING_ROOM_REVEAL_HOLD_DURATION_MS) /
    WAITING_ROOM_REVEAL_DURATION_MS;

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
      className="fixed overflow-hidden rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_82%,white)] bg-[var(--bg-overlay)] shadow-[0_16px_36px_rgba(0,0,0,0.42),0_1px_0_rgba(255,255,255,0.08)_inset]"
      style={{
        width: startWidth,
        height: startHeight,
        left: startLeft,
        top: startTop,
        transformOrigin: 'center center',
        willChange: 'transform, width, height, opacity',
      }}
      initial={{ opacity: 0.94, x: 0, y: 0, rotate: getCardMoveRotation(event.fromZoneType) }}
      animate={{
        x: [0, revealLeft - startLeft, revealLeft - startLeft, endLeft - startLeft],
        y: [0, revealTop - startTop, revealTop - startTop, endTop - startTop],
        rotate: [
          getCardMoveRotation(event.fromZoneType),
          0,
          0,
          getCardMoveRotation(event.toZoneType),
        ],
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

function PulseFrame({
  event,
  reduceMotion,
  onDone,
}: {
  readonly event: Exclude<BattleAnimationEvent, { kind: 'CARD_MOVE' }>;
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

function getWaitingRoomRevealRect({
  fromRect,
  toRect,
  toSeat,
}: {
  readonly fromRect: BattleAnimationRect;
  readonly toRect: BattleAnimationRect;
  readonly toSeat?: 'FIRST' | 'SECOND';
}): BattleAnimationRect {
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight;
  const isNarrow = viewportWidth < 640;
  const maxWidth = Math.max(56, Math.min(isNarrow ? 82 : 96, viewportWidth * 0.24));
  let width = clamp(Math.max(fromRect.width, isNarrow ? 70 : 88), 56, maxWidth);
  let height = width * (7 / 5);
  const maxHeight = Math.max(82, viewportHeight * 0.34);
  if (height > maxHeight) {
    height = maxHeight;
    width = height * (5 / 7);
  }

  const toCenter = getRectCenter(toRect);
  const verticalGap = isNarrow ? 10 : 18;
  const revealTop =
    toSeat === 'SECOND'
      ? toRect.top + toRect.height + verticalGap
      : toRect.top - height - verticalGap;
  const revealLeft = toCenter.x - width / 2;

  return {
    left: clamp(revealLeft, 8, Math.max(8, viewportWidth - width - 8)),
    top: clamp(revealTop, 8, Math.max(8, viewportHeight - height - 8)),
    width,
    height,
  };
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
