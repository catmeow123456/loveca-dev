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
import { useGameStore } from '@/store/gameStore';
import type { PlayerViewState } from '@game/online';
import { ZoneType } from '@game/shared/types/enums';

const MOVE_DURATION_MS = 520;
const PULSE_DURATION_MS = 360;
const FOLLOW_UP_MOVE_DELAY_MS = MOVE_DURATION_MS + 80;

interface ScheduledBattleAnimationEvent {
  readonly event: BattleAnimationEvent;
  readonly delayMs: number;
}

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

  useEffect(() => {
    const scheduledEventTimeouts = scheduledEventTimeoutsRef.current;
    const activeOcclusionEventIds = activeOcclusionEventIdsRef.current;

    return () => {
      for (const timeout of scheduledEventTimeouts) {
        window.clearTimeout(timeout);
      }
      scheduledEventTimeouts.clear();
      for (const eventId of activeOcclusionEventIds) {
        removeBattleAnimationOcclusion(eventId);
      }
      activeOcclusionEventIds.clear();
    };
  }, [removeBattleAnimationOcclusion]);

  useLayoutEffect(() => {
    const previousViewState = previousViewRef.current;
    const previousAnchors = previousAnchorsRef.current;
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
          renderedEventIdsRef.current.add(event.id);
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
          const timeout = window.setTimeout(() => {
            scheduledEventTimeoutsRef.current.delete(timeout);
            activeOcclusionEventIdsRef.current.delete(occlusion.eventId);
            removeBattleAnimationOcclusion(occlusion.eventId);
          }, occlusion.delayMs + MOVE_DURATION_MS + 180);
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
    <div className="pointer-events-none fixed inset-0 z-[85]">
      <AnimatePresence>
        {events.map((event) => {
          if (event.kind === 'CARD_MOVE') {
            const imagePath =
              event.render.imageSrc ??
              (event.render.surface === 'FRONT' && event.render.cardCode
                ? getCardImagePath(event.render.cardCode)
                : getDeckBackUrl());
            return (
              <MovingCard
                key={event.id}
                event={event}
                imagePath={imagePath}
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

function createSequencedBattleAnimationEvents(
  events: readonly BattleAnimationEvent[]
): ScheduledBattleAnimationEvent[] {
  const hasStageEntryMove = events.some(
    (event) =>
      event.kind === 'CARD_MOVE' &&
      event.toZoneType === ZoneType.MEMBER_SLOT &&
      event.fromZoneType !== ZoneType.MEMBER_SLOT
  );

  if (!hasStageEntryMove) {
    return events.map((event) => ({ event, delayMs: 0 }));
  }

  return events.map((event) => ({
    event,
    delayMs:
      event.kind === 'CARD_MOVE' && !isStageTransitionMove(event)
        ? FOLLOW_UP_MOVE_DELAY_MS
        : 0,
  }));
}

function isStageTransitionMove(
  event: Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }>
): boolean {
  return event.fromZoneType === ZoneType.MEMBER_SLOT || event.toZoneType === ZoneType.MEMBER_SLOT;
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

function MovingCard({
  event,
  imagePath,
  reduceMotion,
  onDone,
}: {
  readonly event: Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }>;
  readonly imagePath: string;
  readonly reduceMotion: boolean | null;
  readonly onDone: () => void;
}) {
  const fromCenter = getRectCenter(event.fromRect);
  const toCenter = getRectCenter(event.toRect);
  const startWidth = clamp(event.fromRect.width || event.toRect.width, 12, 140);
  const startHeight = clamp(event.fromRect.height || event.toRect.height, 16, 196);
  const endWidth = clamp(event.toRect.width || event.fromRect.width, 12, 140);
  const endHeight = clamp(event.toRect.height || event.fromRect.height, 16, 196);
  const startLeft = fromCenter.x - startWidth / 2;
  const startTop = fromCenter.y - startHeight / 2;
  const endLeft = toCenter.x - endWidth / 2;
  const endTop = toCenter.y - endHeight / 2;

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
      className="fixed overflow-hidden rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_70%,white)] bg-[var(--bg-overlay)] shadow-[0_14px_38px_rgba(0,0,0,0.42)]"
      style={{
        width: startWidth,
        height: startHeight,
        left: startLeft,
        top: startTop,
        willChange: 'left, top, width, height, opacity',
      }}
      initial={{ opacity: 0.98 }}
      animate={{
        left: endLeft,
        top: endTop,
        width: endWidth,
        height: endHeight,
        opacity: 0.98,
      }}
      exit={{ opacity: 0, transition: { duration: 0.04 } }}
      transition={{
        duration: MOVE_DURATION_MS / 1000,
        ease: [0.2, 0.68, 0.18, 1],
      }}
      onAnimationComplete={onDone}
    >
      <img
        src={imagePath}
        alt={event.render.name ?? ''}
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
      animate={reduceMotion ? { opacity: 0.8 } : { opacity: [0.15, 0.9, 0], scale: [0.96, 1.06, 1] }}
      exit={{ opacity: 0 }}
      transition={{ duration: (reduceMotion ? 120 : PULSE_DURATION_MS) / 1000 }}
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
