import { useEffect, useLayoutEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import {
  escapeCssAttributeValue,
  getNextBattleFeedbackExpiryDelay,
  isBattleFeedbackEventExpired,
  type BattleDragActionHint,
  type BattleFeedbackAnchor,
  type BattleFeedbackEvent,
  type BattleFeedbackTone,
} from '@/lib/battleActionFeedback';
import { useGameStore } from '@/store/gameStore';

interface FeedbackPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function getFallbackPosition(): FeedbackPosition {
  if (typeof window === 'undefined') {
    return { left: 0, top: 0, width: 0, height: 0 };
  }

  return {
    left: window.innerWidth / 2,
    top: window.innerHeight * 0.42,
    width: 0,
    height: 0,
  };
}

export function BattleActionFeedbackLayer() {
  const reduceMotion = useReducedMotion();
  const { dragActionHint, feedbackEvents, dismissBattleFeedback } = useGameStore(
    useShallow((s) => ({
      dragActionHint: s.ui.dragActionHint,
      feedbackEvents: s.ui.battleFeedbackEvents,
      dismissBattleFeedback: s.dismissBattleFeedback,
    }))
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const delay = getNextBattleFeedbackExpiryDelay(feedbackEvents, now);
    if (delay === null) {
      return;
    }

    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [feedbackEvents, now]);

  useEffect(() => {
    for (const event of feedbackEvents) {
      if (isBattleFeedbackEventExpired(event, now)) {
        dismissBattleFeedback(event.id);
      }
    }
  }, [dismissBattleFeedback, feedbackEvents, now]);

  const visibleEvents: BattleFeedbackEvent[] = feedbackEvents
    .filter((event) => !isBattleFeedbackEventExpired(event, now))
    .slice(-4);

  return (
    <div className="pointer-events-none fixed inset-0 z-[90]">
      <AnimatePresence>
        {dragActionHint && (
          <AnchoredBadge
            key="drag-action-hint"
            label={dragActionHint.label}
            detail={dragActionHint.detail}
            tone={dragActionHint.tone === 'blocked' ? 'error' : 'intent'}
            anchor={dragActionHint.anchor}
            dragHint={dragActionHint}
            reduceMotion={reduceMotion}
          />
        )}
        {visibleEvents.map((event) => (
          <AnchoredBadge
            key={event.id}
            label={event.label}
            detail={event.detail}
            tone={event.tone}
            anchor={event.anchor}
            reduceMotion={reduceMotion}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function AnchoredBadge({
  label,
  detail,
  tone,
  anchor,
  dragHint,
  reduceMotion,
}: {
  readonly label: string;
  readonly detail?: string;
  readonly tone: BattleFeedbackTone;
  readonly anchor?: BattleFeedbackAnchor;
  readonly dragHint?: BattleDragActionHint;
  readonly reduceMotion: boolean | null;
}) {
  const [position, setPosition] = useState<FeedbackPosition>(() => getFallbackPosition());

  useLayoutEffect(() => {
    const updatePosition = () => {
      setPosition(resolveAnchorPosition(anchor));
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchor]);

  const isError = tone === 'error';
  const isSuccess = tone === 'success';
  const isIntent = tone === 'intent';
  const hasAnchor = Boolean(anchor?.cardId || anchor?.zoneId || anchor?.targetId);
  const hasResolvedAnchor = hasAnchor && (position.width > 0 || position.height > 0);
  const showFrame =
    isError || (isSuccess && hasResolvedAnchor) || (dragHint !== undefined && hasResolvedAnchor);
  const showText = dragHint === undefined;
  const frameWidth = Math.max(position.width, 36);
  const frameHeight = Math.max(position.height, 28);

  return (
    <>
      {showFrame && (
        <motion.div
          className={cn(
            'fixed rounded-lg border',
            isError && 'border-rose-300/90 bg-rose-500/10 shadow-[0_0_18px_rgba(244,63,94,0.42)]',
            isSuccess &&
              'border-emerald-300/80 bg-emerald-500/10 shadow-[0_0_16px_rgba(16,185,129,0.32)]',
            isIntent && 'border-amber-300/80 bg-amber-500/10 shadow-[0_0_14px_rgba(245,158,11,0.32)]'
          )}
          style={{
            left: position.left - frameWidth / 2,
            top: position.top - frameHeight / 2,
            width: frameWidth,
            height: frameHeight,
          }}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
          animate={
            reduceMotion
              ? { opacity: 1 }
              : isError
                ? { opacity: [0.35, 1, 0.8], x: [-3, 3, -2, 0], scale: 1 }
                : { opacity: [0.45, 1, 0.72], scale: [0.98, 1.02, 1] }
          }
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
          transition={{ duration: reduceMotion ? 0.08 : isError ? 0.26 : 0.18 }}
        />
      )}
      {showText && (
        <div
          className="fixed max-w-[min(240px,calc(100vw-2rem))]"
          style={{
            left: position.left,
            top: Math.max(12, position.top - position.height / 2 - 8),
            transform: 'translate(-50%, -100%)',
          }}
        >
          <motion.div
            className={cn(
              'rounded border px-2 py-1 text-left shadow-[var(--shadow-md)] backdrop-blur-xl',
              isError &&
                'border-rose-300/70 bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,rgb(244,63,94)_8%)] text-rose-100',
              isSuccess &&
                'border-emerald-300/70 bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,rgb(16,185,129)_8%)] text-emerald-100',
              isIntent &&
                'border-amber-300/70 bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,rgb(245,158,11)_8%)] text-amber-100',
              tone === 'info' &&
                'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] text-[var(--text-primary)]'
            )}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.98 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -2, scale: 0.98 }}
            transition={{ duration: reduceMotion ? 0.08 : 0.14 }}
          >
            <div className="text-[10px] font-semibold leading-tight">{label}</div>
            {detail && (
              <div className="mt-0.5 line-clamp-2 text-[9px] leading-tight opacity-80">
                {detail}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </>
  );
}

function resolveAnchorPosition(anchor?: BattleFeedbackAnchor): FeedbackPosition {
  const element = findAnchorElement(anchor);
  if (!element) {
    return getFallbackPosition();
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return getFallbackPosition();
  }

  return {
    left: rect.left + rect.width / 2,
    top: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
  };
}

function findAnchorElement(anchor?: BattleFeedbackAnchor): Element | null {
  if (!anchor) {
    return null;
  }

  if (anchor.cardId) {
    const card = queryDataAttribute('data-card-id', anchor.cardId);
    if (card) {
      return card;
    }
  }

  if (anchor.zoneId) {
    const zone = queryDataAttribute('data-zone-id', anchor.zoneId);
    if (zone) {
      return zone;
    }
  }

  if (anchor.targetId) {
    return (
      document.getElementById(anchor.targetId) ??
      queryDataAttribute('data-zone-id', anchor.targetId) ??
      queryDataAttribute('data-card-id', anchor.targetId)
    );
  }

  return null;
}

function queryDataAttribute(attribute: string, value: string): Element | null {
  const escapedValue = escapeCssAttributeValue(value);
  return document.querySelector(`[${attribute}="${escapedValue}"]`);
}
