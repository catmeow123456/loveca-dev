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
}

const TABS = [
  { type: CardType.MEMBER, label: '成员卡', Icon: Users, colors: CARD_TYPE_COLORS.MEMBER },
  { type: CardType.LIVE, label: 'Live 卡', Icon: Music, colors: CARD_TYPE_COLORS.LIVE },
  { type: CardType.ENERGY, label: '能量卡', Icon: Zap, colors: CARD_TYPE_COLORS.ENERGY },
] as const;

export function CardTypeTabs({ selected, onSelect }: CardTypeTabsProps) {
  return (
    <div className="flex gap-1 rounded-xl border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] p-1">
      {TABS.map(({ type, label, Icon, colors }) => {
        const isActive = selected === type;
        return (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-all duration-200 ${
              isActive
                ? `${colors.bg} ${colors.border} ${colors.text} shadow-[var(--shadow-sm)]`
                : 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
