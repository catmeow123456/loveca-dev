import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
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

function getFixedViewportOffset(): Pick<FeedbackPosition, 'left' | 'top'> {
  if (typeof document === 'undefined') {
    return { left: 0, top: 0 };
  }

  const rect = document.documentElement.getBoundingClientRect();
  return { left: rect.left, top: rect.top };
}

export function BattleActionFeedbackLayer() {
  const reduceMotion = useReducedMotion();
  const {
    dragActionHint,
    feedbackEvents,
    isDragging,
    dismissBattleFeedback,
    setBattleDragActionHint,
  } = useGameStore(
    useShallow((s) => ({
      dragActionHint: s.ui.dragActionHint,
      feedbackEvents: s.ui.battleFeedbackEvents,
      isDragging: s.ui.isDragging,
      dismissBattleFeedback: s.dismissBattleFeedback,
      setBattleDragActionHint: s.setBattleDragActionHint,
    }))
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isDragging && dragActionHint) {
      setBattleDragActionHint(null);
    }
  }, [dragActionHint, isDragging, setBattleDragActionHint]);

  useEffect(() => {
    const delay = getNextBattleFeedbackExpiryDelay(feedbackEvents, Date.now());
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
  const visibleDragActionHint = isDragging ? dragActionHint : null;

  const layer = (
    <div className="pointer-events-none fixed inset-0 z-[90]">
      <AnimatePresence>
        {visibleDragActionHint && (
          <AnchoredBadge
            key="drag-action-hint"
            label={visibleDragActionHint.label}
            detail={visibleDragActionHint.detail}
            tone={visibleDragActionHint.tone === 'blocked' ? 'error' : 'intent'}
            anchor={visibleDragActionHint.anchor}
            dragHint={visibleDragActionHint}
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

  return typeof document === 'undefined' ? layer : createPortal(layer, document.body);
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
  const fixedViewportOffset = getFixedViewportOffset();
  const frameClassName = cn(
    'fixed rounded-md border',
    isError &&
      'border-[color:color-mix(in_srgb,var(--semantic-error)_62%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_14%,transparent)] shadow-[0_0_14px_color-mix(in_srgb,var(--semantic-error)_32%,transparent)]',
    isSuccess &&
      'border-[color:color-mix(in_srgb,var(--semantic-success)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_12%,transparent)] shadow-[0_0_13px_color-mix(in_srgb,var(--semantic-success)_28%,transparent)]',
    isIntent &&
      'border-[color:color-mix(in_srgb,var(--semantic-info)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-info)_12%,transparent)] shadow-[0_0_13px_color-mix(in_srgb,var(--semantic-info)_26%,transparent)]'
  );
  const frameStyle = {
    left: position.left - frameWidth / 2 - fixedViewportOffset.left,
    top: position.top - frameHeight / 2 - fixedViewportOffset.top,
    width: frameWidth,
    height: frameHeight,
  };

  return (
    <>
      {showFrame && dragHint !== undefined ? (
        <div
          data-battle-feedback-frame="drag"
          className={frameClassName}
          style={frameStyle}
        />
      ) : showFrame ? (
        <motion.div
          data-battle-feedback-frame={tone}
          className={frameClassName}
          style={frameStyle}
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
      ) : null}
      {showText && (
        <div
          className="fixed max-w-[min(260px,calc(100vw-2rem))]"
          style={{
            left: position.left - fixedViewportOffset.left,
            top: Math.max(12, position.top - position.height / 2 - 8) - fixedViewportOffset.top,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <motion.div
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-left shadow-[0_8px_20px_rgba(0,0,0,0.22)] backdrop-blur-md',
              isError &&
                'border-[color:color-mix(in_srgb,var(--semantic-error)_52%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,var(--bg-surface))] text-[var(--semantic-error)]',
              isSuccess &&
                'border-[color:color-mix(in_srgb,var(--semantic-success)_48%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_12%,var(--bg-surface))] text-[var(--semantic-success)]',
              isIntent &&
                'border-[color:color-mix(in_srgb,var(--semantic-info)_48%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-info)_12%,var(--bg-surface))] text-[var(--semantic-info)]',
              tone === 'info' &&
                'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] text-[var(--text-primary)]'
            )}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.98 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -2, scale: 0.98 }}
            transition={{ duration: reduceMotion ? 0.08 : 0.14 }}
          >
            <div className="text-[11px] font-semibold leading-tight">{label}</div>
            {detail && (
              <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug opacity-90">
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
