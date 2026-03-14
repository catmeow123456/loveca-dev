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
    <div className="flex gap-1">
      {TABS.map(({ type, label, Icon, colors }) => {
        const isActive = selected === type;
        return (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-b-2 transition-all duration-200 text-sm font-medium ${
              isActive
                ? `${colors.bg} ${colors.border} ${colors.text}`
                : 'bg-transparent border-transparent text-orange-300/50 hover:text-orange-300/80 hover:bg-[#3d3020]/30'
            }`}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
