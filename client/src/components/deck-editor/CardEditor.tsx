/**
 * CardEditor - 卡组编辑器主组件（编排器）
 * 布局层次：
 *   行1（DeckManager）: 卡组名称 | 卡组描述 | 操作按钮
 *   行2：成员卡 / Live卡 / 能量卡 类型筛选（全宽，侧边栏不覆盖）
 *   行3起：
 *     >= 960px：卡牌库 + 侧边栏左右并排（侧边栏常驻，不可折叠）
 *     < 960px ：侧边栏悬浮覆盖于卡牌库之上，可折叠
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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

function useIsWide(breakpoint = 960) {
  const [isWide, setIsWide] = useState(() => window.innerWidth >= breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent) => setIsWide(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isWide;
}

export function CardEditor({ deck, onDeckChange, onValidate }: CardEditorProps) {
  const filters = useCardFilters();
  const mutations = useDeckMutations(deck, onDeckChange, onValidate);
  const [selectedCard, setSelectedCard] = useState<AnyCardData | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const isWide = useIsWide();

  const sidebarProps = {
    deck,
    validation: mutations.validation,
    onAddCard: mutations.addCard,
    onRemoveCard: mutations.removeCard,
    onViewDetail: setSelectedCard,
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#2d2820] to-[#1f1a15] overflow-hidden">
      {/* 行2：卡牌类型筛选（全宽，位于侧边栏之上） */}
      <div className="px-3 pt-2.5 pb-2 border-b border-orange-300/10 bg-[#3d3020]/40 flex-shrink-0">
        <CardTypeTabs
          selected={filters.selectedCardType}
          onSelect={filters.setSelectedCardType}
        />
      </div>

      {/* 主区域 */}
      <div className="relative flex-1 flex overflow-hidden">
        {/* 卡牌库 */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-3 pb-2 border-b border-orange-300/10 bg-[#3d3020]/40 space-y-2">
            <SearchBar
              value={filters.searchQuery}
              onChange={filters.setSearchQuery}
              resultCount={filters.sortedCards.length}
            />
            <FilterPanel filters={filters} />
          </div>
          <CardBrowserGrid
            cards={filters.sortedCards}
            baseCodeCountInDeck={mutations.baseCodeCountInDeck}
            exactCodeCountInDeck={mutations.exactCodeCountInDeck}
            onAddCard={mutations.addCard}
            onRemoveCard={mutations.removeCard}
            onViewDetail={setSelectedCard}
          />
        </div>

        {/* >= 960px：侧边栏常驻，普通流布局 */}
        {isWide && (
          <DeckSidebar {...sidebarProps} />
        )}

        {/* < 960px：侧边栏悬浮覆盖，可折叠 */}
        {!isWide && (
          <motion.div
            className="absolute right-0 top-0 bottom-0 z-20 w-[480px]"
            animate={{ x: sidebarOpen ? 0 : '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="absolute left-0 -translate-x-full top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 px-1 py-3 rounded-l-lg bg-[#3d3020]/80 hover:bg-[#4d3a20]/90 border border-r-0 border-orange-300/20 text-orange-300/70 hover:text-orange-200 transition-colors duration-150 shadow-lg"
            >
              {sidebarOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              <span className="text-[10px] font-medium [writing-mode:vertical-lr]">卡组</span>
            </button>
            <DeckSidebar {...sidebarProps} />
          </motion.div>
        )}
      </div>

      {/* 卡牌详情抽屉 */}
      <CardDetailDrawer
        card={selectedCard}
        onClose={() => setSelectedCard(null)}
      />
    </div>
  );
}
