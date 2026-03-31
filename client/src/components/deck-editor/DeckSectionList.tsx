/**
 * DeckSectionList - 可折叠的卡组分区列表
 */

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Check, Circle } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '@/store/gameStore';
import { DeckSidebarCardCell } from './DeckSidebarCardCell';
import type { AnyCardData } from '@game/domain/entities/card';
import { isLiveCardData, isMemberCardData } from '@game/domain/entities/card';
import type { CardEntry } from '@game/domain/card-data/deck-loader';

interface DeckSectionListProps {
  entries: CardEntry[];
  title: string;
  expectedCount: number;
  accentColor: 'orange' | 'rose' | 'sky';
  onAddCard: (card: AnyCardData) => void;
  onRemoveCard: (card: AnyCardData) => void;
  onViewDetail: (card: AnyCardData) => void;
  defaultCollapsed?: boolean;
}

const ACCENT_STYLES = {
  orange: {
    accentLine: 'from-[var(--accent-secondary)]/90 to-[var(--accent-gold)]/70',
    validTone: 'border-[var(--semantic-success)]/25 bg-[var(--semantic-success)]/12 text-[var(--semantic-success)]',
    invalidTone: 'border-[var(--accent-secondary)]/25 bg-[var(--accent-secondary)]/12 text-[var(--accent-secondary)]',
  },
  rose: {
    accentLine: 'from-[var(--accent-primary)]/90 to-pink-400/70',
    validTone: 'border-[var(--semantic-success)]/25 bg-[var(--semantic-success)]/12 text-[var(--semantic-success)]',
    invalidTone: 'border-[var(--accent-primary)]/25 bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]',
  },
  sky: {
    accentLine: 'from-[var(--semantic-info)]/90 to-sky-300/70',
    validTone: 'border-[var(--semantic-success)]/25 bg-[var(--semantic-success)]/12 text-[var(--semantic-success)]',
    invalidTone: 'border-[var(--semantic-info)]/25 bg-[var(--semantic-info)]/12 text-[var(--semantic-info)]',
  },
};

export function DeckSectionList({
  entries, title, expectedCount, accentColor,
  onAddCard, onRemoveCard, onViewDetail,
  defaultCollapsed = false,
}: DeckSectionListProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const { getCardImagePath, getCardData } = useGameStore(
    useShallow((s) => ({
      getCardImagePath: s.getCardImagePath,
      getCardData: s.getCardData,
    }))
  );

  const count = entries.reduce((sum, e) => sum + e.count, 0);
  const isValid = count === expectedCount;
  const styles = ACCENT_STYLES[accentColor];

  const toggle = useCallback(() => setCollapsed(prev => !prev), []);
  const sortedEntries = useMemo(() => {
    const getSortValue = (entry: CardEntry): number => {
      const cardData = getCardData(entry.card_code);
      if (!cardData) return Number.POSITIVE_INFINITY;
      if (isMemberCardData(cardData)) return cardData.cost;
      if (isLiveCardData(cardData)) return cardData.score;
      return Number.POSITIVE_INFINITY;
    };

    return [...entries].sort((a, b) => {
      const valueDiff = getSortValue(a) - getSortValue(b);
      if (valueDiff !== 0) return valueDiff;
      return a.card_code.localeCompare(b.card_code);
    });
  }, [entries, getCardData]);

  return (
    <div className="mb-3">
      {/* 标题栏 */}
      <div
        className="surface-panel flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[var(--shadow-sm)]"
        onClick={toggle}
      >
        <div className="flex items-center gap-2">
          <div className={`h-8 w-1 rounded-full bg-gradient-to-b ${styles.accentLine}`} />
          <ChevronRight
            size={14}
            className={`text-[var(--text-muted)] transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
          />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        </div>
        <div className={`status-pill border px-2.5 py-0.5 text-xs font-medium ${
          isValid ? styles.validTone : styles.invalidTone
        }`}>
          {isValid ? <Check size={10} /> : <Circle size={8} />}
          <span>{count} / {expectedCount}</span>
        </div>
      </div>

      {/* 可折叠内容 */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ type: 'tween', duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden touch-pan-y"
          >
            <div className="mt-2 grid grid-cols-6 gap-1 touch-pan-y">
              {sortedEntries.map((entry) => {
                const cardData = getCardData(entry.card_code);
                if (!cardData) return null;
                return (
                  <DeckSidebarCardCell
                    key={entry.card_code}
                    cardData={cardData}
                    imagePath={getCardImagePath(entry.card_code)}
                    count={entry.count}
                    onAdd={() => onAddCard(cardData)}
                    onRemove={() => onRemoveCard(cardData)}
                    onViewDetail={() => onViewDetail(cardData)}
                  />
                );
              })}
              {sortedEntries.length === 0 && (
                <div className="col-span-6 rounded-xl border border-dashed border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_46%,transparent)] py-3 text-center">
                  <div className="text-xs text-[var(--text-muted)]">点击左侧卡牌添加</div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
