/**
 * CardBrowserGrid - 卡牌浏览网格
 */

import { useCallback } from 'react';
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

export function CardBrowserGrid({ cards, baseCodeCountInDeck, exactCodeCountInDeck, onAddCard, onRemoveCard, onViewDetail }: CardBrowserGridProps) {
  const { getCardImagePath } = useGameStore(
    useShallow((s) => ({ getCardImagePath: s.getCardImagePath }))
  );

  if (cards.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center py-16">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl border-2 border-dashed border-orange-300/20 flex items-center justify-center">
            <span className="text-orange-300/30 text-2xl">?</span>
          </div>
          <div className="text-orange-300/50 text-sm">没有找到匹配的卡牌</div>
          <div className="text-orange-300/30 text-xs mt-1">试试其他搜索条件</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 cute-scrollbar">
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
        {cards.map((card) => (
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

function MemoizedCellWrapper({ card, imagePath, baseCount, exactCount, onAddCard, onRemoveCard, onViewDetail }: CellWrapperProps) {
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
}
