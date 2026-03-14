/**
 * CardEditor - 卡组编辑器主组件（编排器）
 * 组合左侧卡牌库、右侧卡组预览、详情抽屉
 */

import { useState } from 'react';
import type { AnyCardData } from '@game/domain/entities/card';
import type { DeckConfig } from '@game/domain/card-data/deck-loader';
import { useCardFilters } from './use-card-filters';
import { useDeckMutations } from './use-deck-mutations';
import { CardTypeTabs } from './CardTypeTabs';
import { SearchBar } from './SearchBar';
import { FilterPanel } from './FilterPanel';
import { CardBrowserGrid } from './CardBrowserGrid';
import { DeckSidebar } from './DeckSidebar';
import { CardDetailDrawer } from './CardDetailDrawer';

interface CardEditorProps {
  deck: DeckConfig;
  onDeckChange: (deck: DeckConfig) => void;
  onValidate?: (deck: DeckConfig) => { valid: boolean; errors: string[] };
}

export function CardEditor({ deck, onDeckChange, onValidate }: CardEditorProps) {
  const filters = useCardFilters();
  const mutations = useDeckMutations(deck, onDeckChange, onValidate);
  const [selectedCard, setSelectedCard] = useState<AnyCardData | null>(null);

  return (
    <div className="flex h-full bg-gradient-to-b from-[#2d2820] to-[#1f1a15] overflow-hidden">
      {/* 左侧：卡牌库 */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* 搜索与筛选区域 */}
        <div className="p-3 pb-2 border-b border-orange-300/10 bg-[#3d3020]/40 space-y-2">
          <CardTypeTabs
            selected={filters.selectedCardType}
            onSelect={filters.setSelectedCardType}
          />
          <SearchBar
            value={filters.searchQuery}
            onChange={filters.setSearchQuery}
            resultCount={filters.sortedCards.length}
          />
          <FilterPanel filters={filters} />
        </div>

        {/* 卡牌网格 */}
        <CardBrowserGrid
          cards={filters.sortedCards}
          baseCodeCountInDeck={mutations.baseCodeCountInDeck}
          exactCodeCountInDeck={mutations.exactCodeCountInDeck}
          onAddCard={mutations.addCard}
          onRemoveCard={mutations.removeCard}
          onViewDetail={setSelectedCard}
        />
      </div>

      {/* 右侧：卡组预览 */}
      <DeckSidebar
        deck={deck}
        validation={mutations.validation}
        onAddCard={mutations.addCard}
        onRemoveCard={mutations.removeCard}
        onViewDetail={setSelectedCard}
      />

      {/* 卡牌详情抽屉 */}
      <CardDetailDrawer
        card={selectedCard}
        onClose={() => setSelectedCard(null)}
      />
    </div>
  );
}
