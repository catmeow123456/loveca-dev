/**
 * FilterPanel - 高级筛选面板
 * 使用类别药丸模式：点击某类别仅展开该类别的选项
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SlidersHorizontal, X } from 'lucide-react';
import { CardType, HeartColor } from '@game/shared/types/enums';
import { FilterChipGroup } from './FilterChipGroup';
import { RangeSelector } from './RangeSelector';
import {
  RARITY_OPTIONS,
  GROUP_OPTIONS,
  GROUP_UNIT_MAP,
  ALL_UNIT_OPTIONS,
  COST_MIN, COST_MAX,
  SCORE_MIN, SCORE_MAX,
  HEART_COLOR_OPTIONS,
  BLADE_HEART_OPTIONS,
  PRODUCT_OPTIONS,
  getGroupDisplayName,
  getProductDisplayName,
} from './filter-constants';
import type { UseCardFiltersReturn } from './use-card-filters';

type FilterCategory = 'rarity' | 'group' | 'unit' | 'cost' | 'heart' | 'blade' | 'score' | 'product';

interface FilterPanelProps {
  filters: UseCardFiltersReturn;
}

interface CategoryPill {
  key: FilterCategory;
  label: string;
  isActive: boolean;
  /** 仅在特定卡牌类型下显示 */
  showFor?: CardType[];
}

export function FilterPanel({ filters }: FilterPanelProps) {
  const [expandedCategory, setExpandedCategory] = useState<FilterCategory | null>(null);

  const categories: CategoryPill[] = [
    { key: 'rarity', label: '稀有度', isActive: filters.selectedRarity !== null },
    { key: 'group', label: '作品名', isActive: filters.selectedGroup !== null },
    { key: 'product', label: '收录商品', isActive: filters.selectedProduct !== null },
    { key: 'unit', label: '小组', isActive: filters.selectedUnit !== null, showFor: [CardType.MEMBER] },
    { key: 'cost', label: '费用', isActive: filters.costMin !== COST_MIN || filters.costMax !== COST_MAX, showFor: [CardType.MEMBER] },
    { key: 'heart', label: filters.selectedCardType === CardType.LIVE ? '需求心' : '持有心', isActive: filters.selectedHeartColor !== null, showFor: [CardType.MEMBER, CardType.LIVE] },
    { key: 'blade', label: '判心', isActive: filters.selectedBladeHeart !== null, showFor: [CardType.MEMBER, CardType.LIVE] },
    { key: 'score', label: '分数', isActive: filters.scoreMin !== SCORE_MIN || filters.scoreMax !== SCORE_MAX, showFor: [CardType.LIVE] },
  ];

  const visibleCategories = categories.filter(
    c => !c.showFor || c.showFor.includes(filters.selectedCardType)
  );

  const toggleCategory = (key: FilterCategory) => {
    setExpandedCategory(prev => prev === key ? null : key);
  };

  const renderCategoryContent = (key: FilterCategory) => {
    switch (key) {
      case 'rarity':
        return (
          <FilterChipGroup
            options={RARITY_OPTIONS.map(r => ({ value: r, label: r }))}
            selected={filters.selectedRarity}
            onSelect={filters.setSelectedRarity}
          />
        );

      case 'group':
        return (
          <FilterChipGroup
            options={GROUP_OPTIONS.map(g => ({ value: g, label: getGroupDisplayName(g) }))}
            selected={filters.selectedGroup}
            onSelect={filters.setSelectedGroup}
          />
        );

      case 'unit': {
        const unitOptions = filters.selectedGroup
          ? GROUP_UNIT_MAP[filters.selectedGroup] || []
          : ALL_UNIT_OPTIONS;
        if (unitOptions.length === 0) {
          return <span className="text-xs text-[var(--text-muted)]">该作品暂无小组</span>;
        }
        return (
          <FilterChipGroup
            options={unitOptions.map(u => ({ value: u, label: u }))}
            selected={filters.selectedUnit}
            onSelect={filters.setSelectedUnit}
          />
        );
      }

      case 'cost':
        return (
          <RangeSelector
            min={filters.costMin}
            max={filters.costMax}
            rangeMin={COST_MIN}
            rangeMax={COST_MAX}
            onMinChange={filters.setCostMin}
            onMaxChange={filters.setCostMax}
          />
        );

      case 'heart':
        return (
          <FilterChipGroup
            options={HEART_COLOR_OPTIONS.map(opt => ({
              value: opt.value,
              label: opt.label,
              colorClass: opt.colorClass,
            }))}
            selected={filters.selectedHeartColor}
            onSelect={(v) => filters.setSelectedHeartColor(v as HeartColor | null)}
          />
        );

      case 'blade':
        return (
          <FilterChipGroup
            options={BLADE_HEART_OPTIONS.map(opt => ({
              value: opt.value,
              label: opt.label,
              colorClass: opt.colorClass,
              icon: opt.icon,
            }))}
            selected={filters.selectedBladeHeart}
            onSelect={filters.setSelectedBladeHeart}
          />
        );

      case 'score':
        return (
          <RangeSelector
            min={filters.scoreMin}
            max={filters.scoreMax}
            rangeMin={SCORE_MIN}
            rangeMax={SCORE_MAX}
            onMinChange={filters.setScoreMin}
            onMaxChange={filters.setScoreMax}
          />
        );

      case 'product':
        return (
          <FilterChipGroup
            options={PRODUCT_OPTIONS.map(p => ({ value: p, label: getProductDisplayName(p) }))}
            selected={filters.selectedProduct}
            onSelect={filters.setSelectedProduct}
          />
        );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <SlidersHorizontal size={13} className="mr-0.5 text-[var(--text-muted)]" />
        {visibleCategories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => toggleCategory(cat.key)}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-all duration-200 ${
              expandedCategory === cat.key
                ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)] text-[var(--text-primary)]'
                : cat.isActive
                  ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]'
                  : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_74%,transparent)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]'
            }`}
          >
            {cat.label}
            {cat.isActive && (
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" />
            )}
          </button>
        ))}
        {filters.hasActiveFilters && (
          <button
            onClick={filters.clearFilters}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <X size={12} />
            清除
          </button>
        )}
      </div>

      <AnimatePresence>
        {expandedCategory && (
          <motion.div
            key={expandedCategory}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_82%,transparent)] p-2.5">
              {renderCategoryContent(expandedCategory)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
