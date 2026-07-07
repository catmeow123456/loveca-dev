import { memo, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useGameStore } from '@/store/gameStore';
import {
  hasBattleViewportSignatureChanged,
  readBattleViewportSignature,
  subscribeToBattleViewportChanges,
  type BattleViewportSignature,
} from '@/lib/battleViewport';

const LONG_PRESS_DETAIL_MS = 420;
const LONG_PRESS_MOVE_CANCEL_PX = 10;

interface CardDetailPressTargetProps {
  cardId: string | null | undefined;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  enableHover?: boolean;
  enableLongPress?: boolean;
  title?: string;
}

export const CardDetailPressTarget = memo(function CardDetailPressTarget({
  cardId,
  children,
  className,
  disabled = false,
  enableHover = true,
  enableLongPress = true,
  title,
}: CardDetailPressTargetProps) {
  const setHoveredCard = useGameStore((s) => s.setHoveredCard);
  const shouldUseHoverPreview = useMediaQuery('(min-width: 1024px)');
  const timerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const viewportStartRef = useRef<BattleViewportSignature | null>(null);
  const longPressTriggeredRef = useRef(false);
  const suppressNextClickRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const openDetail = useCallback(() => {
    if (!cardId || disabled) return;
    setHoveredCard(cardId);
  }, [cardId, disabled, setHoveredCard]);

  useEffect(() => clearTimer, [clearTimer]);

  const cancelLongPressForViewportChange = useCallback(() => {
    const startSignature = viewportStartRef.current;
    if (!startSignature) {
      return;
    }

    if (!hasBattleViewportSignatureChanged(startSignature, readBattleViewportSignature())) {
      return;
    }

    clearTimer();
    viewportStartRef.current = null;
    pointerStartRef.current = null;
    suppressNextClickRef.current = true;
  }, [clearTimer]);

  useEffect(() => subscribeToBattleViewportChanges(cancelLongPressForViewportChange), [
    cancelLongPressForViewportChange,
  ]);

  const canOpen = !!cardId && !disabled;
  const canHoverOpen = canOpen && enableHover && shouldUseHoverPreview;

  return (
    <div
      className={cn('min-h-0 min-w-0', className)}
      title={title}
      onMouseEnter={() => {
        if (canHoverOpen) {
          setHoveredCard(cardId);
        }
      }}
      onMouseLeave={() => {
        if (canHoverOpen) {
          setHoveredCard(null);
        }
      }}
      onPointerDown={(event) => {
        if (!canOpen || !enableLongPress || event.pointerType === 'mouse') return;
        clearTimer();
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
        viewportStartRef.current = readBattleViewportSignature();
        longPressTriggeredRef.current = false;
        timerRef.current = window.setTimeout(() => {
          longPressTriggeredRef.current = true;
          suppressNextClickRef.current = true;
          openDetail();
        }, LONG_PRESS_DETAIL_MS);
      }}
      onPointerMove={(event) => {
        cancelLongPressForViewportChange();
        if (!pointerStartRef.current || timerRef.current === null) return;
        const deltaX = event.clientX - pointerStartRef.current.x;
        const deltaY = event.clientY - pointerStartRef.current.y;
        if (Math.hypot(deltaX, deltaY) > LONG_PRESS_MOVE_CANCEL_PX) {
          clearTimer();
        }
      }}
      onPointerUp={(event) => {
        clearTimer();
        pointerStartRef.current = null;
        viewportStartRef.current = null;
        if (longPressTriggeredRef.current) {
          longPressTriggeredRef.current = false;
          suppressNextClickRef.current = true;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerCancel={() => {
        clearTimer();
        pointerStartRef.current = null;
        viewportStartRef.current = null;
        if (longPressTriggeredRef.current) {
          suppressNextClickRef.current = true;
        }
        longPressTriggeredRef.current = false;
      }}
      onContextMenu={(event) => {
        if (!canOpen) return;
        event.preventDefault();
        openDetail();
      }}
      onClickCapture={(event) => {
        if (!suppressNextClickRef.current) return;
        suppressNextClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
});

export default CardDetailPressTarget;
