/**
 * CardEditor - 卡组编辑器主组件（编排器）
 * 布局层次：
 *   行1（DeckManager）: 卡组名称 | 卡组描述 | 操作按钮
 *   行2：成员卡 / Live卡 / 能量卡 类型筛选（全宽，侧边栏不覆盖）
 *   行3起：
 *     >= 960px：卡牌库 + 侧边栏左右并排（侧边栏常驻，不可折叠）
 *     < 960px ：侧边栏悬浮覆盖于卡牌库之上，可折叠
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ListFilter, PanelRightOpen, X } from 'lucide-react';
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
import { useMediaQuery } from '@/hooks/useMediaQuery';

interface CardEditorProps {
  deck: DeckConfig;
  onDeckChange: (deck: DeckConfig) => void;
  onValidate?: (deck: DeckConfig) => { valid: boolean; errors: string[] };
}

export function CardEditor({ deck, onDeckChange, onValidate }: CardEditorProps) {
  const filters = useCardFilters();
  const mutations = useDeckMutations(deck, onDeckChange, onValidate);
  const [selectedCard, setSelectedCard] = useState<AnyCardData | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 960px)');
  const isMobile = useMediaQuery('(max-width: 767px)');

  useEffect(() => {
    setSidebarOpen(isDesktop);
  }, [isDesktop]);

  const sidebarProps = {
    deck,
    validation: mutations.validation,
    onAddCard: mutations.addCard,
    onRemoveCard: mutations.removeCard,
    onViewDetail: setSelectedCard,
  };
  const mobileDeckCount =
    deck.main_deck.members.reduce((sum, e) => sum + e.count, 0) +
    deck.main_deck.lives.reduce((sum, e) => sum + e.count, 0) +
    deck.energy_deck.reduce((sum, e) => sum + e.count, 0);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="relative flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0">
          <div className={`workspace-toolbar ${isMobile ? 'p-1.5' : 'p-3'}`}>
            <div className={`grid gap-2 ${isMobile ? '' : 'xl:grid-cols-[340px_minmax(0,1fr)]'}`}>
              {!isMobile && (
                <CardTypeTabs
                  selected={filters.selectedCardType}
                  onSelect={filters.setSelectedCardType}
                />
              )}
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <SearchBar
                    value={filters.searchQuery}
                    onChange={filters.setSearchQuery}
                    resultCount={filters.sortedCards.length}
                  />
                </div>
                {isMobile && (
                  <button
                    type="button"
                    onClick={() => setMobileFiltersOpen(true)}
                    className="button-secondary inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full p-0"
                    title="筛选条件"
                  >
                    <ListFilter size={16} />
                  </button>
                )}
              </div>
            </div>

            {isMobile ? (
              <div className="mt-1 flex items-center justify-between gap-2 px-0.5">
                <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                  <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[var(--text-secondary)]">
                    {filters.selectedCardType === 'MEMBER' ? '成员卡' : filters.selectedCardType === 'LIVE' ? 'Live 卡' : '能量卡'}
                  </span>
                  <span>{filters.sortedCards.length} 张卡</span>
                  {filters.hasActiveFilters && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[color:color-mix(in_srgb,var(--accent-primary)_28%,transparent)] px-1.5 py-0.5 text-[var(--accent-primary)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" />
                      已筛选
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-2">
                <FilterPanel filters={filters} />
              </div>
            )}
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

        {isDesktop && (
          <DeckSidebar {...sidebarProps} />
        )}

        {!isDesktop && !isMobile && (
          <motion.div
            className="absolute bottom-0 right-0 top-0 z-30 flex min-h-0 w-[min(82vw,420px)] flex-col"
            initial={false}
            animate={{ x: sidebarOpen ? 0 : '100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
          >
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="absolute left-0 top-1/2 z-10 flex -translate-x-full -translate-y-1/2 flex-col items-center gap-1 rounded-l-lg border border-r-0 border-[var(--border-default)] bg-[var(--bg-frosted)] px-1 py-3 text-[var(--text-secondary)] shadow-[var(--shadow-md)] backdrop-blur-xl transition-colors duration-150 hover:text-[var(--text-primary)]"
            >
              <ChevronLeft size={14} />
              <span className="text-[10px] font-medium [writing-mode:vertical-lr]">卡组</span>
            </button>
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <DeckSidebar {...sidebarProps} />
            </div>
          </motion.div>
        )}
      </div>

      {isMobile && !sidebarOpen && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-3 pb-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="pointer-events-auto inline-flex min-h-10 items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 py-2 text-xs font-medium text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl"
            >
              <PanelRightOpen size={14} />
              <span>查看卡组</span>
              <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)] px-2 py-0.5 text-[var(--accent-primary)]">
                {mobileDeckCount}
              </span>
            </button>
          </div>
        </div>
      )}

      {isMobile && sidebarOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-backdrop fixed inset-0 z-40"
            onClick={() => setSidebarOpen(false)}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="safe-bottom fixed inset-x-0 bottom-0 z-50 h-[84dvh] rounded-t-[24px] border border-b-0 border-[var(--border-default)] bg-[var(--bg-frosted)] shadow-[var(--shadow-lg)] backdrop-blur-xl"
          >
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <div className="workspace-toolbar shrink-0 px-4 py-3">
                <div className="mb-2 flex justify-center">
                  <div className="h-1.5 w-12 rounded-full bg-[var(--border-default)]" />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">当前卡组</div>
                    <div className="text-xs text-[var(--text-muted)]">向下滑动查看完整构筑</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(false)}
                    className="button-icon h-8 w-8"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <DeckSidebar {...sidebarProps} compactHeader />
              </div>
            </div>
          </motion.div>
        </>
      )}

      {isMobile && mobileFiltersOpen && (
        <>
          <div className="modal-backdrop z-20" onClick={() => setMobileFiltersOpen(false)} />
          <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 max-h-[78dvh] rounded-t-[24px] border border-b-0 border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)]">
            <div className="workspace-toolbar flex items-center justify-between px-4 py-3">
              <div className="text-sm font-semibold text-[var(--text-primary)]">筛选条件</div>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="button-icon h-8 w-8"
              >
                <ChevronRight size={16} className="rotate-90" />
              </button>
            </div>
            <div className="touch-scroll max-h-[calc(78dvh-64px)] overflow-y-auto p-4">
              <div className="mb-3">
                <CardTypeTabs
                  selected={filters.selectedCardType}
                  onSelect={filters.setSelectedCardType}
                  compact
                />
              </div>
              <FilterPanel filters={filters} compact />
            </div>
          </div>
        </>
      )}

      <CardDetailDrawer
        card={selectedCard}
        onClose={() => setSelectedCard(null)}
      />
    </div>
  );
}
