/**
 * use-card-filters.ts - 卡牌筛选状态与逻辑 Hook
 */

import { useMemo, useState, useCallback } from 'react';
import { useGameStore } from '@/store/gameStore';
import type { AnyCardData } from '@game/domain/entities/card';
import { isMemberCardData, isLiveCardData } from '@game/domain/entities/card';
import { CardType, HeartColor, BladeHeartEffect } from '@game/shared/types/enums';
import {
  RARITY_OPTIONS,
  GROUP_UNIT_MAP,
  COST_MIN, COST_MAX,
  SCORE_MIN, SCORE_MAX,
  PRODUCT_OPTIONS,
} from './filter-constants';

export interface UseCardFiltersReturn {
  searchQuery: string;
  selectedCardType: CardType;
  showAdvancedFilter: boolean;
  selectedRarity: string | null;
  selectedGroup: string | null;
  selectedUnit: string | null;
  selectedProduct: string | null;
  costMin: number;
  costMax: number;
  scoreMin: number;
  scoreMax: number;
  selectedHeartColor: HeartColor | null;
  selectedBladeHeart: string | null;
  hasActiveFilters: boolean;
  sortedCards: AnyCardData[];
  setSearchQuery: (q: string) => void;
  setSelectedCardType: (t: CardType) => void;
  toggleAdvancedFilter: () => void;
  setSelectedRarity: (r: string | null) => void;
  setSelectedGroup: (g: string | null) => void;
  setSelectedUnit: (u: string | null) => void;
  setSelectedProduct: (p: string | null) => void;
  setCostMin: (v: number) => void;
  setCostMax: (v: number) => void;
  setScoreMin: (v: number) => void;
  setScoreMax: (v: number) => void;
  setSelectedHeartColor: (c: HeartColor | null) => void;
  setSelectedBladeHeart: (b: string | null) => void;
  clearFilters: () => void;
}

export function useCardFilters(): UseCardFiltersReturn {
  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCardType, setSelectedCardType] = useState<CardType>(CardType.MEMBER);
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [selectedRarity, setSelectedRarity] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [costMin, setCostMin] = useState(COST_MIN);
  const [costMax, setCostMax] = useState(COST_MAX);
  const [selectedHeartColor, setSelectedHeartColor] = useState<HeartColor | null>(null);
  const [selectedBladeHeart, setSelectedBladeHeart] = useState<string | null>(null);
  const [scoreMin, setScoreMin] = useState(SCORE_MIN);
  const [scoreMax, setScoreMax] = useState(SCORE_MAX);

  const toggleAdvancedFilter = useCallback(() => {
    setShowAdvancedFilter(prev => !prev);
  }, []);

  const getRarityFromCode = useCallback((cardCode: string): string | null => {
    const parts = cardCode.split('-');
    if (parts.length < 2) return null;
    const lastPart = parts[parts.length - 1].replace(/\uff0b/g, '+');
    for (const rarity of RARITY_OPTIONS) {
      if (lastPart === rarity) return rarity;
    }
    return null;
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedRarity(null);
    setSelectedGroup(null);
    setSelectedUnit(null);
    setSelectedProduct(null);
    setCostMin(COST_MIN);
    setCostMax(COST_MAX);
    setSelectedHeartColor(null);
    setSelectedBladeHeart(null);
    setScoreMin(SCORE_MIN);
    setScoreMax(SCORE_MAX);
  }, []);

  const handleSetSelectedGroup = useCallback((g: string | null) => {
    setSelectedGroup(g);
    if (g) {
      const newGroupUnits = GROUP_UNIT_MAP[g] || [];
      setSelectedUnit(prev => (prev && !newGroupUnits.includes(prev)) ? null : prev);
    }
  }, []);

  const hasActiveFilters = selectedCardType !== CardType.ENERGY && (
    selectedRarity !== null ||
    selectedGroup !== null ||
    selectedProduct !== null ||
    (selectedCardType === CardType.MEMBER && selectedUnit !== null) ||
    (selectedCardType === CardType.MEMBER && (costMin !== COST_MIN || costMax !== COST_MAX)) ||
    selectedHeartColor !== null ||
    selectedBladeHeart !== null ||
    (selectedCardType === CardType.LIVE && (scoreMin !== SCORE_MIN || scoreMax !== SCORE_MAX))
  );

  const sortedCards = useMemo(() => {
    const allCards = Array.from(cardDataRegistry.values());
    let filtered = allCards.filter(card => card.cardType === selectedCardType);

    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      filtered = filtered.filter(card =>
        card.name.toLowerCase().includes(lowerQuery) ||
        card.cardCode.toLowerCase().includes(lowerQuery)
      );
    }

    if (selectedCardType !== CardType.ENERGY) {
      if (selectedRarity) {
        filtered = filtered.filter(card => getRarityFromCode(card.cardCode) === selectedRarity);
      }

      if (selectedGroup) {
        // 使用包含匹配，支持联动卡牌（多个作品名用换行分隔）
        filtered = filtered.filter(card => card.groupName?.includes(selectedGroup));
      }

      if (selectedProduct) {
        filtered = filtered.filter(card => card.product === selectedProduct);
      }

      if (selectedCardType === CardType.MEMBER && selectedUnit) {
        filtered = filtered.filter(card => card.unitName === selectedUnit);
      }

      if (selectedCardType === CardType.MEMBER && (costMin !== COST_MIN || costMax !== COST_MAX)) {
        filtered = filtered.filter(card => {
          if (isMemberCardData(card)) {
            return card.cost >= costMin && card.cost <= costMax;
          }
          return true;
        });
      }

      if (selectedHeartColor) {
        filtered = filtered.filter(card => {
          if (isMemberCardData(card)) {
            return card.hearts.some(h => h.color === selectedHeartColor);
          }
          if (isLiveCardData(card)) {
            return card.requirements.colorRequirements.has(selectedHeartColor);
          }
          return false;
        });
      }

      if (selectedBladeHeart) {
        filtered = filtered.filter(card => {
          const bladeHearts = (isMemberCardData(card) || isLiveCardData(card)) ? card.bladeHearts : undefined;
          if (!bladeHearts || bladeHearts.length === 0) return false;
          if (selectedBladeHeart === 'SCORE') {
            return bladeHearts.some(bh => bh.effect === BladeHeartEffect.SCORE);
          }
          if (selectedBladeHeart === 'DRAW') {
            return bladeHearts.some(bh => bh.effect === BladeHeartEffect.DRAW);
          }
          if (selectedBladeHeart.startsWith('HEART:')) {
            const color = selectedBladeHeart.slice(6) as HeartColor;
            return bladeHearts.some(bh => bh.effect === BladeHeartEffect.HEART && bh.heartColor === color);
          }
          return false;
        });
      }

      if (selectedCardType === CardType.LIVE && (scoreMin !== SCORE_MIN || scoreMax !== SCORE_MAX)) {
        filtered = filtered.filter(card => {
          if (isLiveCardData(card)) {
            return card.score >= scoreMin && card.score <= scoreMax;
          }
          return false;
        });
      }
    }

    return [...filtered].sort((a, b) => {
      if (a.cardType !== b.cardType) return a.cardType.localeCompare(b.cardType);
      return a.cardCode.localeCompare(b.cardCode);
    });
  }, [cardDataRegistry, searchQuery, selectedRarity, selectedGroup, selectedUnit, selectedProduct, costMin, costMax, getRarityFromCode, selectedCardType, selectedHeartColor, selectedBladeHeart, scoreMin, scoreMax]);

  return {
    searchQuery, selectedCardType, showAdvancedFilter,
    selectedRarity, selectedGroup, selectedUnit, selectedProduct,
    costMin, costMax, scoreMin, scoreMax,
    selectedHeartColor, selectedBladeHeart,
    hasActiveFilters, sortedCards,
    setSearchQuery, setSelectedCardType, toggleAdvancedFilter,
    setSelectedRarity, setSelectedGroup: handleSetSelectedGroup,
    setSelectedUnit, setSelectedProduct, setCostMin, setCostMax,
    setScoreMin, setScoreMax,
    setSelectedHeartColor, setSelectedBladeHeart,
    clearFilters,
  };
}
