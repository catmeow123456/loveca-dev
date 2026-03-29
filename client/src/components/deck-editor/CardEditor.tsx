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
    <div className="flex h-full flex-col overflow-hidden">
      <div className="relative flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0">
          <div className="workspace-toolbar p-3">
            <div className="grid gap-2 xl:grid-cols-[340px_minmax(0,1fr)]">
              <CardTypeTabs
                selected={filters.selectedCardType}
                onSelect={filters.setSelectedCardType}
              />
              <SearchBar
                value={filters.searchQuery}
                onChange={filters.setSearchQuery}
                resultCount={filters.sortedCards.length}
              />
            </div>
            <div className="mt-2">
              <FilterPanel filters={filters} />
            </div>
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

        {isWide && (
          <DeckSidebar {...sidebarProps} />
        )}

        {!isWide && (
          <motion.div
            className="absolute right-0 top-0 bottom-0 z-20 w-[480px]"
            animate={{ x: sidebarOpen ? 0 : '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="absolute left-0 top-1/2 flex -translate-x-full -translate-y-1/2 flex-col items-center gap-1 rounded-l-lg border border-r-0 border-[var(--border-default)] bg-[var(--bg-frosted)] px-1 py-3 text-[var(--text-secondary)] shadow-[var(--shadow-md)] backdrop-blur-xl transition-colors duration-150 hover:text-[var(--text-primary)]"
            >
              {sidebarOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              <span className="text-[10px] font-medium [writing-mode:vertical-lr]">卡组</span>
            </button>
            <DeckSidebar {...sidebarProps} />
          </motion.div>
        )}
      </div>

      <CardDetailDrawer
        card={selectedCard}
        onClose={() => setSelectedCard(null)}
      />
    </div>
  );
}
