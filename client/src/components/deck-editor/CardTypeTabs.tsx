/**
 * CardTypeTabs - 卡牌类型切换 Tab
 * 全宽等分，使用色条区分类型
 */

import { Users, Music, Zap } from 'lucide-react';
import { CardType } from '@game/shared/types/enums';
import { CARD_TYPE_COLORS } from './filter-constants';

interface CardTypeTabsProps {
  selected: CardType;
  onSelect: (type: CardType) => void;
  compact?: boolean;
}

const TABS = [
  { type: CardType.MEMBER, label: '成员卡', Icon: Users, colors: CARD_TYPE_COLORS.MEMBER },
  { type: CardType.LIVE, label: 'Live 卡', Icon: Music, colors: CARD_TYPE_COLORS.LIVE },
  { type: CardType.ENERGY, label: '能量卡', Icon: Zap, colors: CARD_TYPE_COLORS.ENERGY },
] as const;

export function CardTypeTabs({ selected, onSelect, compact = false }: CardTypeTabsProps) {
  return (
    <div
      className={`rounded-xl border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] ${
        compact ? 'overflow-x-auto p-1 no-scrollbar' : 'p-1'
      }`}
    >
      <div className={`flex gap-1 ${compact ? 'min-w-max' : ''}`}>
      {TABS.map(({ type, label, Icon, colors }) => {
        const isActive = selected === type;
        return (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className={`flex items-center justify-center rounded-lg font-medium transition-all duration-200 ${
              compact
                ? `min-h-9 shrink-0 gap-1.5 px-3 py-1.5 text-xs`
                : 'min-h-11 flex-1 gap-1 px-1 py-2 text-xs sm:gap-1.5 sm:px-2 sm:text-sm'
            } ${
              isActive
                ? `${colors.bg} ${colors.border} ${colors.text} shadow-[var(--shadow-sm)]`
                : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon size={15} />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
      </div>
    </div>
  );
}
