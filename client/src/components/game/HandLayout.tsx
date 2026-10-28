import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';

type HandPose = { x: number; y: number; rotation: number };
const handTransform = ({ x, y, rotation }: HandPose) =>
  `translate(${x}px, ${y}px) rotate(${rotation}deg)`;
const desktopMinimumStep = (cardWidth: number) => cardWidth * 0.55;
const fanEdgePadding = (cardWidth: number, angle: number) =>
  16 + (cardWidth * 1.4 * Math.sin((angle * Math.PI) / 180)) / 2;

export function minimumDesktopHandViewportWidth(cardWidth: number): number {
  return cardWidth + 11 * desktopMinimumStep(cardWidth) + 2 * fanEdgePadding(cardWidth, 10);
}

/** A shallow fan through twelve cards; larger hands retain a browsable overlapping row. */
export function HandLayout({
  cardIds,
  selectedCardId,
  suspended,
  desktop,
  renderCard,
}: {
  readonly cardIds: readonly string[];
  readonly selectedCardId: string | null;
  readonly suspended: boolean;
  readonly desktop: boolean;
  readonly renderCard: (cardId: string, index: number) => ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const cardSizeRef = useRef<HTMLSpanElement>(null);
  const previousIds = useRef(cardIds);
  const followingEnd = useRef(true);
  const previousSelection = useRef({ cardId: selectedCardId, width: 0, cardWidth: 0 });
  const previousLayout = useRef<{
    ids: readonly string[];
    selected: string | null;
    poses: Map<string, HandPose>;
    width: number;
    cardWidth: number;
  } | null>(null);
  const slotAnimations = useRef(new Map<HTMLElement, { animation: Animation; end: number }>());
  const scrollAdjustment = useRef(0);
  const lastScrollLeft = useRef(0);
  const [size, setSize] = useState({ width: 0, cardWidth: 56 });
  const [scrollLeft, setScrollLeft] = useState(0);
  const [unseenCards, setUnseenCards] = useState<readonly string[]>([]);
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const cardSize = cardSizeRef.current;
    if (!viewport || !cardSize) return;
    const measure = () => {
      // Resolve responsive clamp()/calc() values even while the hand is empty.
      const cardWidth = parseFloat(getComputedStyle(cardSize).width);
      setSize((current) =>
        current.width === viewport.clientWidth && current.cardWidth === cardWidth
          ? current
          : { width: viewport.clientWidth, cardWidth }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(cardSize);
    const wheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.deltaX ||
        !event.deltaY ||
        viewport.scrollWidth <= viewport.clientWidth
      )
        return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
      viewport.scrollLeft += event.deltaY * unit;
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      viewport.removeEventListener('wheel', wheel);
    };
  }, []);

  const count = cardIds.length;
  const fan = count <= 12;
  const padding = 16;
  const edgeFade = 12;
  const maxAngle = Math.min(10, Math.max(0, count - 1) * 2);
  // Leave room for the rotated corners, including the selection ring.
  const fanPadding = fanEdgePadding(size.cardWidth, maxAngle);
  const step = fan
    ? Math.max(
        desktop && count > 1 ? desktopMinimumStep(size.cardWidth) : 0,
        Math.min(
          size.cardWidth * 0.72,
          (size.width - fanPadding * 2 - size.cardWidth) / Math.max(1, count - 1)
        )
      )
    : Math.max(
        Math.max(30, size.cardWidth * 0.55),
        Math.min(
          size.cardWidth * 0.72,
          (size.width - padding * 2 - size.cardWidth) / Math.max(1, count - 1)
        )
      );
  const spread = Math.max(0, count - 1) * step;
  const contentWidth = fan
    ? desktop
      ? Math.max(size.width, spread + size.cardWidth + fanPadding * 2)
      : size.width
    : Math.max(size.width, spread + size.cardWidth + padding * 2);
  const origin = (contentWidth - spread - size.cardWidth) / 2;
  const maxScroll = Math.max(0, contentWidth - size.width);
  const hasBefore = scrollLeft > 1;
  const hasAfter = scrollLeft < maxScroll - 1;
  const poses = new Map(
    cardIds.map((id, index) => {
      const position = count <= 1 ? 0 : (index * 2) / (count - 1) - 1;
      return [
        id,
        {
          x: origin + index * step,
          // Every card rotates about a center on the same horizontal line.
          // The shared clearance keeps the outer corners inside the viewport.
          y: -4 - (id === selectedCardId ? 5 : 0),
          rotation: fan ? position * maxAngle : 0,
        },
      ];
    })
  );

  // Follow incoming cards only if the player was already at the end. Browsing old
  // cards must survive draws, selections, and unrelated authoritative updates.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Shrinking the canvas can clamp scrollLeft before layout effects run.
    const before = lastScrollLeft.current;
    const gainedCards = cardIds.filter((id) => !previousIds.current.includes(id));
    if (maxScroll <= 1) viewport.scrollLeft = 0;
    else if (gainedCards.length && followingEnd.current) viewport.scrollLeft = maxScroll;
    scrollAdjustment.current = viewport.scrollLeft - before;
    lastScrollLeft.current = viewport.scrollLeft;
    const atEnd = viewport.scrollLeft >= maxScroll - 2;
    setUnseenCards((current) => {
      if (atEnd) return current.length ? [] : current;
      if (gainedCards.length)
        return [...current.filter((id) => cardIds.includes(id)), ...gainedCards];
      return current.some((id) => !cardIds.includes(id))
        ? current.filter((id) => cardIds.includes(id))
        : current;
    });
    previousIds.current = cardIds;
    setScrollLeft(viewport.scrollLeft);
    followingEnd.current = atEnd;
  }, [cardIds, maxScroll]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    const previous = previousSelection.current;
    if (
      suspended ||
      (previous.cardId === selectedCardId &&
        previous.width === size.width &&
        previous.cardWidth === size.cardWidth)
    )
      return;
    previousSelection.current = {
      cardId: selectedCardId,
      width: size.width,
      cardWidth: size.cardWidth,
    };
    if (!viewport || !canvas || !selectedCardId) return;
    const index = cardIds.indexOf(selectedCardId);
    if (index < 0) return;
    const before = viewport.scrollLeft;
    const left = origin + index * step - padding;
    const right = left + size.cardWidth + padding * 2;
    const revealSelection = () => {
      if (maxScroll <= 1) return;
      if (left < viewport.scrollLeft) viewport.scrollLeft = left;
      else if (right > viewport.scrollLeft + size.width) viewport.scrollLeft = right - size.width;
    };
    revealSelection();
    scrollAdjustment.current += viewport.scrollLeft - before;
    lastScrollLeft.current = viewport.scrollLeft;
    // A resize measured by our first observer can commit before the browser has
    // updated the canvas's scroll range. Recheck when that layout actually lands.
    const observer = new ResizeObserver(revealSelection);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [selectedCardId, suspended, size.width, size.cardWidth, cardIds, origin, step, maxScroll]);

  useLayoutEffect(() => {
    const previous = previousLayout.current;
    const canvas = canvasRef.current;
    const scrollDelta = scrollAdjustment.current;
    scrollAdjustment.current = 0;
    if (!canvas) return;
    const contentChanged =
      previous &&
      (previous.selected !== selectedCardId ||
        previous.ids.length !== cardIds.length ||
        previous.ids.some((id, index) => id !== cardIds[index]));
    const resized = previous?.width !== size.width || previous?.cardWidth !== size.cardWidth;
    const now = performance.now();
    const animations = slotAnimations.current;
    for (const [slot, running] of animations) {
      if (!slot.isConnected || reduceMotion) {
        running.animation.cancel();
        animations.delete(slot);
      }
    }
    canvas.querySelectorAll<HTMLElement>('[data-hand-card-slot]').forEach((slot, index) => {
      const id = cardIds[index];
      const pose = poses.get(id)!;
      const oldPose = previous?.poses.get(id);
      const running = animations.get(slot);
      // A resize follows the container directly. An in-flight reflow may retarget,
      // but keeps its original deadline instead of restarting a 200ms chase per frame.
      const duration = contentChanged ? 200 : resized && running ? running.end - now : 0;
      if (!contentChanged && !resized) return;
      let from = oldPose ? handTransform({ ...oldPose, x: oldPose.x + scrollDelta }) : null;
      if (running) {
        const current = new DOMMatrix(getComputedStyle(slot).transform);
        current.e += scrollDelta;
        from = current.toString();
        running.animation.cancel();
        animations.delete(slot);
      }
      if (!from || !previous?.width || reduceMotion || duration <= 0) return;
      const animation = slot.animate([{ transform: from }, { transform: handTransform(pose) }], {
        duration,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      });
      animations.set(slot, { animation, end: now + duration });
      animation.onfinish = () => animations.delete(slot);
    });
    previousLayout.current = {
      ids: cardIds,
      selected: selectedCardId,
      poses,
      width: size.width,
      cardWidth: size.cardWidth,
    };
  });

  useLayoutEffect(() => {
    const animations = slotAnimations.current;
    return () => {
      for (const { animation } of animations.values()) animation.cancel();
      animations.clear();
    };
  }, []);

  const browse = (direction: number) => {
    viewportRef.current?.scrollBy({
      left: Math.max(step, size.width * 0.7) * direction,
      behavior: reduceMotion ? 'instant' : 'smooth',
    });
  };

  return (
    <div
      className="battle-hand-layout relative h-full min-w-0"
      data-hand-layout={fan ? 'fan' : 'row'}
    >
      <div
        ref={viewportRef}
        data-hand-viewport
        data-hand-fade-start={hasBefore ? edgeFade : 0}
        data-hand-fade-end={hasAfter ? edgeFade : 0}
        className="battle-hand-viewport absolute inset-x-[24px] inset-y-0 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none]"
        style={{
          maskImage: `linear-gradient(to right, ${hasBefore ? `transparent 0, #000 ${edgeFade}px` : '#000 0'}, ${hasAfter ? `#000 calc(100% - ${edgeFade}px), transparent 100%` : '#000 100%'})`,
        }}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          lastScrollLeft.current = viewport.scrollLeft;
          setScrollLeft(viewport.scrollLeft);
          followingEnd.current =
            viewport.scrollLeft >= viewport.scrollWidth - viewport.clientWidth - 2;
          if (followingEnd.current) setUnseenCards((current) => (current.length ? [] : current));
        }}
      >
        <span
          ref={cardSizeRef}
          data-hand-card-size
          aria-hidden="true"
          className="pointer-events-none invisible absolute h-0 w-[var(--battle-hand-card-width,56px)]"
        />
        <div ref={canvasRef} className="relative h-full" style={{ width: contentWidth }}>
          {cardIds.map((cardId, index) => {
            const selected = selectedCardId === cardId;
            const pose = poses.get(cardId)!;
            return (
              <div
                key={cardId}
                data-hand-card-slot
                data-hand-card-rotation={pose.rotation}
                data-recovery-hand-card={`obj_${cardId}`}
                className="absolute bottom-1 left-0 origin-center"
                style={{
                  transform: handTransform(pose),
                  zIndex: selected ? count + 1 : index,
                }}
              >
                {renderCard(cardId, index)}
              </div>
            );
          })}
        </div>
      </div>
      {maxScroll > 1 && (
        <>
          <button
            type="button"
            className="battle-hand-browse left-0"
            aria-label="向前浏览手牌"
            disabled={suspended || !hasBefore}
            onClick={() => browse(-1)}
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="battle-hand-browse right-0"
            aria-label={unseenCards.length ? `查看 ${unseenCards.length} 张新手牌` : '向后浏览手牌'}
            disabled={suspended || !hasAfter}
            onClick={() => {
              if (unseenCards.length)
                viewportRef.current?.scrollTo({
                  left: maxScroll,
                  behavior: reduceMotion ? 'instant' : 'smooth',
                });
              else browse(1);
            }}
          >
            <ChevronRight size={14} aria-hidden="true" />
            {unseenCards.length > 0 && (
              <span
                data-hand-new-cards
                role="status"
                aria-label={`${unseenCards.length} 张新手牌`}
                className="pointer-events-none absolute bottom-full right-0 text-[9px] font-semibold leading-3 text-[var(--accent-primary)]"
              >
                +{unseenCards.length}
              </span>
            )}
          </button>
        </>
      )}
    </div>
  );
}
