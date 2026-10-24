import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';

/** One overlapping row at every count; excess cards extend horizontally. */
export function HandLayout({
  cardIds,
  selectedCardId,
  suspended,
  renderCard,
}: {
  readonly cardIds: readonly string[];
  readonly selectedCardId: string | null;
  readonly suspended: boolean;
  readonly renderCard: (cardId: string, index: number) => ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const cardSizeRef = useRef<HTMLSpanElement>(null);
  const previousIds = useRef(cardIds);
  const followingEnd = useRef(true);
  const previousSelection = useRef({ cardId: selectedCardId, width: 0, cardWidth: 0 });
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
      setSize({ width: viewport.clientWidth, cardWidth });
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
  const padding = 16;
  const edgeFade = 12;
  const step = Math.max(
    Math.max(30, size.cardWidth * 0.55),
    Math.min(
      size.cardWidth * 0.72,
      (size.width - padding * 2 - size.cardWidth) / Math.max(1, count - 1)
    )
  );
  const spread = Math.max(0, count - 1) * step;
  const contentWidth = Math.max(size.width, spread + size.cardWidth + padding * 2);
  const origin = (contentWidth - spread - size.cardWidth) / 2;
  const maxScroll = Math.max(0, contentWidth - size.width);
  const hasBefore = scrollLeft > 1;
  const hasAfter = scrollLeft < maxScroll - 1;

  // Follow incoming cards only if the player was already at the end. Browsing old
  // cards must survive draws, selections, and unrelated authoritative updates.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const gainedCards = cardIds.filter((id) => !previousIds.current.includes(id));
    if (gainedCards.length && followingEnd.current) viewport.scrollLeft = maxScroll;
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
    const left = origin + index * step - padding;
    const right = left + size.cardWidth + padding * 2;
    const revealSelection = () => {
      if (left < viewport.scrollLeft) viewport.scrollLeft = left;
      else if (right > viewport.scrollLeft + size.width) viewport.scrollLeft = right - size.width;
    };
    revealSelection();
    // A resize measured by our first observer can commit before the browser has
    // updated the canvas's scroll range. Recheck when that layout actually lands.
    const observer = new ResizeObserver(revealSelection);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [selectedCardId, suspended, size.width, size.cardWidth, cardIds, origin, step]);

  const browse = (direction: number) => {
    viewportRef.current?.scrollBy({
      left: Math.max(step, size.width * 0.7) * direction,
      behavior: reduceMotion ? 'instant' : 'smooth',
    });
  };

  return (
    <div className="battle-hand-layout relative h-full min-w-0">
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
          setScrollLeft(viewport.scrollLeft);
          followingEnd.current =
            viewport.scrollLeft >= viewport.scrollWidth - viewport.clientWidth - 2;
          if (followingEnd.current) setUnseenCards((current) => (current.length ? [] : current));
        }}
      >
        <span
          ref={cardSizeRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute h-0 w-[var(--battle-hand-card-width,56px)]"
        />
        <div ref={canvasRef} className="relative h-full" style={{ width: contentWidth }}>
          {cardIds.map((cardId, index) => {
            const selected = selectedCardId === cardId;
            return (
              <div
                key={cardId}
                data-hand-card-slot
                data-hand-card-rotation={0}
                data-recovery-hand-card={`obj_${cardId}`}
                className="absolute bottom-1 transition-[left,transform] duration-200 ease-out motion-reduce:transition-none"
                style={{
                  left: origin + index * step,
                  transform: selected ? 'translateY(-5px)' : undefined,
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
