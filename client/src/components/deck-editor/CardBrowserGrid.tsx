/**
 * CardBrowserGrid - 卡牌浏览网格
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '@/store/gameStore';
import { BrowserCardCell } from './BrowserCardCell';
import { getBaseCardCode } from '@/lib/cardUtils';
import type { AnyCardData } from '@game/domain/entities/card';

interface CardBrowserGridProps {
  cards: AnyCardData[];
  baseCodeCountInDeck: Record<string, number>;
  exactCodeCountInDeck: Record<string, number>;
  onAddCard: (card: AnyCardData) => void;
  onRemoveCard: (card: AnyCardData) => void;
  onViewDetail: (card: AnyCardData) => void;
}

const CARD_BATCH_SIZE = 48;

export function CardBrowserGrid({
  cards,
  baseCodeCountInDeck,
  exactCodeCountInDeck,
  onAddCard,
  onRemoveCard,
  onViewDetail,
}: CardBrowserGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const loadMore = useRef<HTMLButtonElement>(null);
  const [batch, setBatch] = useState({ cards, count: CARD_BATCH_SIZE });
  // A new search/type/filter starts at the first batch; deck count changes keep the current batch.
  if (batch.cards !== cards) setBatch({ cards, count: CARD_BATCH_SIZE });
  const visibleCount = batch.cards === cards ? batch.count : CARD_BATCH_SIZE;
  const hasMore = visibleCount < cards.length;
  const showMore = useCallback(() => {
    setBatch((current) =>
      current.cards === cards
        ? { cards, count: Math.min(current.count + CARD_BATCH_SIZE, cards.length) }
        : current
    );
  }, [cards]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [cards]);

  useEffect(() => {
    if (!hasMore || !loadMore.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) showMore();
      },
      { root: scroller.current, rootMargin: '600px 0px' }
    );
    observer.observe(loadMore.current);
    return () => observer.disconnect();
  }, [hasMore, showMore, visibleCount]);

  const { getCardImagePath } = useGameStore(
    useShallow((s) => ({ getCardImagePath: s.getCardImagePath }))
  );

  if (cards.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center py-16">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-surface)_78%,transparent)]">
            <span className="text-2xl text-[var(--text-muted)]">?</span>
          </div>
          <div className="text-sm text-[var(--text-secondary)]">没有找到匹配的卡牌</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">试试其他搜索条件</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scroller}
      className="flex-1 overflow-y-auto p-3 cute-scrollbar sm:p-4"
      aria-label="卡牌库"
    >
      <div className="grid grid-cols-3 gap-2.5 min-[420px]:gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {cards.slice(0, visibleCount).map((card) => (
          <MemoizedCellWrapper
            key={card.cardCode}
            card={card}
            imagePath={getCardImagePath(card.cardCode)}
            baseCount={baseCodeCountInDeck[getBaseCardCode(card.cardCode)] || 0}
            exactCount={exactCodeCountInDeck[card.cardCode] || 0}
            onAddCard={onAddCard}
            onRemoveCard={onRemoveCard}
            onViewDetail={onViewDetail}
          />
        ))}
      </div>
      {hasMore && (
        <button
          ref={loadMore}
          type="button"
          onClick={showMore}
          className="button-secondary mx-auto mt-4 block min-h-11 px-5 py-2 text-sm"
        >
          显示更多卡牌
        </button>
      )}
    </div>
  );
}

interface CellWrapperProps {
  card: AnyCardData;
  imagePath: string;
  baseCount: number;
  exactCount: number;
  onAddCard: (card: AnyCardData) => void;
  onRemoveCard: (card: AnyCardData) => void;
  onViewDetail: (card: AnyCardData) => void;
}

const MemoizedCellWrapper = memo(function CellWrapper({
  card,
  imagePath,
  baseCount,
  exactCount,
  onAddCard,
  onRemoveCard,
  onViewDetail,
}: CellWrapperProps) {
  const handleAdd = useCallback(() => onAddCard(card), [onAddCard, card]);
  const handleRemove = useCallback(() => onRemoveCard(card), [onRemoveCard, card]);
  const handleDetail = useCallback(() => onViewDetail(card), [onViewDetail, card]);

  return (
    <BrowserCardCell
      card={card}
      imagePath={imagePath}
      baseCount={baseCount}
      exactCount={exactCount}
      onAdd={handleAdd}
      onRemove={handleRemove}
      onViewDetail={handleDetail}
    />
  );
});
