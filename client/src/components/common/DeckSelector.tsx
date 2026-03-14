/**
 * DeckSelector - 卡组选择器组件
 * 展示用户的卡组列表，支持选中和预览
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DeckRecord } from '@/lib/apiClient';
import type { DeckConfig } from '@game/domain/card-data/deck-loader';
import { calculateDeckStats, formatRelativeTime } from './DeckStats';

// 本地卡组类型（用于离线模式或临时卡组）
export interface LocalDeck {
  id: string;
  name: string;
  description?: string;
  config: DeckConfig;
  isValid: boolean;
  updatedAt: Date;
}

// 统一的卡组显示项
export interface DeckDisplayItem {
  id: string;
  name: string;
  description?: string;
  isValid: boolean;
  isCloud: boolean;
  updatedAt: Date;
  memberCount: number;
  liveCount: number;
  energyCount: number;
  // 原始数据引用
  cloudDeck?: DeckRecord;
  localDeck?: LocalDeck;
}

interface DeckSelectorProps {
  /** 云端卡组列表 */
  cloudDecks?: DeckRecord[];
  /** 本地卡组列表 */
  localDecks?: LocalDeck[];
  /** 当前选中的卡组ID */
  selectedId?: string | null;
  /** 选择卡组回调 */
  onSelect: (deck: DeckDisplayItem) => void;
  /** 是否正在加载 */
  isLoading?: boolean;
  /** 加载错误信息 */
  error?: string | null;
  /** 刷新按钮回调 */
  onRefresh?: () => void;
  /** 标题 */
  title?: string;
  /** 空状态提示 */
  emptyText?: string;
}

export function DeckSelector({
  cloudDecks = [],
  localDecks = [],
  selectedId,
  onSelect,
  isLoading = false,
  error = null,
  onRefresh,
  title = '选择卡组',
  emptyText = '还没有卡组，去创建一个吧！',
}: DeckSelectorProps) {
  
  // 合并并转换为统一显示格式
  const displayDecks = useMemo<DeckDisplayItem[]>(() => {
    const items: DeckDisplayItem[] = [];
    
    // 云端卡组 - 使用 calculateDeckStats 计算统计
    for (const deck of cloudDecks) {
      const stats = calculateDeckStats(deck);
      
      items.push({
        id: deck.id,
        name: deck.name,
        description: deck.description || undefined,
        isValid: deck.is_valid,
        isCloud: true,
        updatedAt: new Date(deck.updated_at),
        memberCount: stats.memberCount,
        liveCount: stats.liveCount,
        energyCount: stats.energyCount,
        cloudDeck: deck,
      });
    }
    
    // 本地卡组
    for (const deck of localDecks) {
      const memberCount = deck.config.main_deck.members.reduce((sum, e) => sum + e.count, 0);
      const liveCount = deck.config.main_deck.lives.reduce((sum, e) => sum + e.count, 0);
      const energyCount = deck.config.energy_deck.reduce((sum, e) => sum + e.count, 0);
      
      items.push({
        id: deck.id,
        name: deck.name,
        description: deck.description,
        isValid: deck.isValid,
        isCloud: false,
        updatedAt: deck.updatedAt,
        memberCount,
        liveCount,
        energyCount,
        localDeck: deck,
      });
    }
    
    // 按更新时间排序
    return items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }, [cloudDecks, localDecks]);

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-[#2d2820] to-[#1f1a15]">
      {/* Header */}
      <div className="p-4 border-b border-orange-300/15 bg-[#3d3020]/50 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🎴</span>
            <h2 className="text-lg font-bold bg-gradient-to-r from-orange-300 to-amber-300 bg-clip-text text-transparent">
              {title}
            </h2>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="px-3 py-1.5 text-orange-300/70 hover:text-orange-300 hover:bg-orange-500/10 rounded-lg transition-all duration-300 disabled:opacity-50"
            >
              {isLoading ? '⏳' : '🔄'}
            </button>
          )}
        </div>
        <div className="mt-1 text-xs text-orange-300/50">
          共 {displayDecks.length} 个卡组
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 cute-scrollbar">
        {/* Loading State */}
        {isLoading && displayDecks.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="animate-spin text-4xl mb-3">🌟</div>
              <div className="text-orange-300/60">加载中...</div>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-400/30 rounded-xl">
            <div className="flex items-center gap-2 text-red-300 text-sm">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && displayDecks.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="text-5xl mb-4">📭</div>
              <div className="text-orange-300/60">{emptyText}</div>
            </div>
          </div>
        )}

        {/* Deck List */}
        <AnimatePresence>
          <div className="grid gap-3">
            {displayDecks.map((deck, index) => (
              <motion.div
                key={deck.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2, delay: index * 0.05 }}
              >
                <button
                  onClick={() => onSelect(deck)}
                  className={`w-full text-left p-4 rounded-xl transition-all duration-300 border ${
                    selectedId === deck.id
                      ? 'bg-gradient-to-r from-orange-500/20 to-amber-500/20 border-orange-400/50 shadow-lg shadow-orange-500/10'
                      : 'bg-[#3d3020]/60 border-transparent hover:bg-orange-500/10 hover:border-orange-300/30'
                  }`}
                >
                  {/* Top Row */}
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {selectedId === deck.id && (
                        <span className="text-orange-400">✓</span>
                      )}
                      <h3 className={`font-bold ${
                        selectedId === deck.id ? 'text-orange-200' : 'text-orange-100'
                      }`}>
                        {deck.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {deck.isCloud ? (
                        <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded-full border border-blue-400/30">
                          ☁️ 云端
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 bg-gray-500/20 text-gray-300 rounded-full border border-gray-400/30">
                          💾 本地
                        </span>
                      )}
                      {deck.isValid ? (
                        <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-300 rounded-full border border-green-400/30">
                          ✓ 有效
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-300 rounded-full border border-red-400/30">
                          ○ 不完整
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  {deck.description && (
                    <p className="text-sm text-orange-300/60 mb-3 line-clamp-2">
                      {deck.description}
                    </p>
                  )}

                  {/* Stats Row */}
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5 text-orange-300/60">
                      <span>👤</span>
                      <span>{deck.memberCount}/48</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-orange-300/60">
                      <span>🎵</span>
                      <span>{deck.liveCount}/12</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-orange-300/60">
                      <span>⚡</span>
                      <span>{deck.energyCount}/12</span>
                    </div>
                    <div className="flex-1" />
                    <div className="text-orange-300/40">
                      {formatRelativeTime(deck.updatedAt)}
                    </div>
                  </div>
                </button>
              </motion.div>
            ))}
          </div>
        </AnimatePresence>
      </div>
    </div>
  );
}
