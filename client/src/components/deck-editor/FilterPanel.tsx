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
          return <span className="text-orange-300/40 text-xs">该组合暂无小组</span>;
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
      {/* 类别药丸行 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <SlidersHorizontal size={14} className="text-orange-300/50 mr-1" />
        {visibleCategories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => toggleCategory(cat.key)}
            className={`px-2.5 py-1 text-xs rounded-lg border transition-all duration-200 flex items-center gap-1 ${
              expandedCategory === cat.key
                ? 'bg-orange-500/25 border-orange-400/50 text-orange-200'
                : cat.isActive
                  ? 'bg-orange-500/15 border-orange-400/40 text-orange-300'
                  : 'bg-[#3d3020]/40 border-orange-300/15 text-orange-300/50 hover:text-orange-300/80 hover:border-orange-300/30'
            }`}
          >
            {cat.label}
            {cat.isActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
            )}
          </button>
        ))}
        {filters.hasActiveFilters && (
          <button
            onClick={filters.clearFilters}
            className="px-2 py-1 text-xs text-orange-300/50 hover:text-orange-300 transition-colors flex items-center gap-1"
          >
            <X size={12} />
            清除
          </button>
        )}
      </div>

      {/* 展开的筛选内容 */}
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
            <div className="p-3 bg-[#2a2520]/60 rounded-xl border border-orange-300/10">
              {renderCategoryContent(expandedCategory)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
