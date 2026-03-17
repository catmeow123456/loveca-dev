/**
 * DeckSectionList - 可折叠的卡组分区列表
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Check, Circle } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '@/store/gameStore';
import { DeckSidebarCardCell } from './DeckSidebarCardCell';
import type { AnyCardData } from '@game/domain/entities/card';
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
    activeBorder: 'border-l-orange-400',
    validBg: 'bg-green-500/20 text-green-300 border-green-400/30',
    invalidBg: 'bg-orange-500/15 text-orange-300 border-orange-400/30',
  },
  rose: {
    activeBorder: 'border-l-rose-400',
    validBg: 'bg-green-500/20 text-green-300 border-green-400/30',
    invalidBg: 'bg-rose-500/15 text-rose-300 border-rose-400/30',
  },
  sky: {
    activeBorder: 'border-l-sky-400',
    validBg: 'bg-green-500/20 text-green-300 border-green-400/30',
    invalidBg: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
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

  return (
    <div className="mb-3">
      {/* 标题栏 */}
      <div
        className={`flex justify-between items-center px-3 py-2 bg-[#3d3020]/40 hover:bg-[#3d3020]/60 rounded-lg cursor-pointer transition-all duration-200 border-l-2 ${styles.activeBorder}`}
        onClick={toggle}
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            size={14}
            className={`text-orange-300/60 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
          />
          <h3 className="font-semibold text-sm text-orange-100">{title}</h3>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
          isValid ? styles.validBg : styles.invalidBg
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
            className="overflow-hidden"
          >
            <div className="grid grid-cols-6 gap-1 mt-2">
              {entries.map((entry) => {
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
              {entries.length === 0 && (
                <div className="col-span-6 text-center py-3 rounded-lg bg-[#2d2820]/30 border border-dashed border-orange-300/15">
                  <div className="text-orange-300/30 text-xs">点击左侧卡牌添加</div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
