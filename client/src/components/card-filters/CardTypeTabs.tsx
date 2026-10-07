/**
 * 卡牌列表通用类型切换 Tab。
 *
 * 构筑页面选择单一卡牌类型；管理页面可以通过 includeAll 增加“全部”入口。
 */

import { Layers3, Music, Users, Zap } from 'lucide-react';
import { CardType } from '@game/shared/types/enums';
import { CARD_TYPE_OPTIONS } from '@/components/deck-editor/filter-constants';

type CardTypeSelection = CardType | 'ALL';

interface CardTypeTabsBaseProps {
  compact?: boolean;
  variant?: 'panel' | 'flat';
}

interface SingleCardTypeTabsProps extends CardTypeTabsBaseProps {
  includeAll?: false;
  selected: CardType;
  onSelect: (type: CardType) => void;
}

interface AllCardTypeTabsProps extends CardTypeTabsBaseProps {
  includeAll: true;
  selected: CardTypeSelection;
  onSelect: (type: CardTypeSelection) => void;
}

type CardTypeTabsProps = SingleCardTypeTabsProps | AllCardTypeTabsProps;

const CARD_TYPE_COLORS = {
  ALL: {
    bg: 'bg-[color:color-mix(in_srgb,var(--accent-primary)_14%,transparent)]',
    border: 'border-[color:color-mix(in_srgb,var(--accent-primary)_34%,transparent)]',
    text: 'text-[var(--accent-primary)]',
  },
  MEMBER: {
    bg: 'bg-[color:color-mix(in_srgb,var(--accent-secondary)_14%,transparent)]',
    border: 'border-[color:color-mix(in_srgb,var(--accent-secondary)_34%,transparent)]',
    text: 'text-[var(--accent-secondary)]',
  },
  LIVE: {
    bg: 'bg-[color:color-mix(in_srgb,var(--accent-primary)_14%,transparent)]',
    border: 'border-[color:color-mix(in_srgb,var(--accent-primary)_34%,transparent)]',
    text: 'text-[var(--accent-primary)]',
  },
  ENERGY: {
    bg: 'bg-[color:color-mix(in_srgb,var(--semantic-info)_14%,transparent)]',
    border: 'border-[color:color-mix(in_srgb,var(--semantic-info)_34%,transparent)]',
    text: 'text-[var(--semantic-info)]',
  },
} as const;

const ALL_TAB = {
  type: 'ALL' as const,
  label: '全部',
  Icon: Layers3,
  colors: CARD_TYPE_COLORS.ALL,
};

const CARD_TYPE_TABS = [
  {
    ...CARD_TYPE_OPTIONS[0],
    type: CARD_TYPE_OPTIONS[0].value,
    Icon: Users,
    colors: CARD_TYPE_COLORS.MEMBER,
  },
  {
    ...CARD_TYPE_OPTIONS[1],
    type: CARD_TYPE_OPTIONS[1].value,
    Icon: Music,
    colors: CARD_TYPE_COLORS.LIVE,
  },
  {
    ...CARD_TYPE_OPTIONS[2],
    type: CARD_TYPE_OPTIONS[2].value,
    Icon: Zap,
    colors: CARD_TYPE_COLORS.ENERGY,
  },
] as const;

export function CardTypeTabs(props: CardTypeTabsProps) {
  const { selected, compact = false, variant = 'panel' } = props;
  const flat = variant === 'flat';
  const tabs = props.includeAll ? [ALL_TAB, ...CARD_TYPE_TABS] : CARD_TYPE_TABS;

  const handleSelect = (type: CardTypeSelection) => {
    if (type === 'ALL') {
      if (props.includeAll) props.onSelect(type);
      return;
    }
    props.onSelect(type);
  };

  return (
    <div
      className={
        flat
          ? `flex gap-1 border-b border-[var(--border-subtle)] ${compact ? 'overflow-x-auto no-scrollbar' : ''}`
          : `rounded-xl border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] ${compact ? 'overflow-x-auto p-1 no-scrollbar' : 'p-1'}`
      }
    >
      <div className={`flex gap-1 ${compact ? 'min-w-max' : ''}`}>
        {tabs.map(({ type, label, Icon, colors }) => {
          const isActive = selected === type;
          return (
            <button
              type="button"
              key={type}
              onClick={() => handleSelect(type)}
              aria-pressed={isActive}
              className={`flex items-center justify-center font-medium transition-colors duration-150 ${
                compact
                  ? 'min-h-9 shrink-0 gap-1.5 px-3 py-1.5 text-xs'
                  : 'min-h-11 flex-1 gap-1 px-1 py-2 text-xs sm:gap-1.5 sm:px-2 sm:text-sm'
              } ${
                isActive
                  ? `${colors.bg} ${flat ? colors.text : colors.border} ${colors.text}`
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
