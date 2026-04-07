/**
 * DeckSelector - 卡组选择器组件
 * 展示用户的卡组列表，支持选中和预览
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Cloud, Database, Layers3, RefreshCw, Star, TriangleAlert, UserRound, Zap } from 'lucide-react';
import type { DeckRecord } from '@/lib/apiClient';
import type { DeckConfig } from '@game/domain/card-data/deck-loader';
import { calculateDeckStats, formatRelativeTime, getDeckPointTextClass } from './DeckStats';
import { calculateDeckConfigStats, validateDeckConfig, DECK_POINT_LIMIT } from '@game/domain/rules/deck-construction';

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
  pointTotal: number;
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
        isValid: validateDeckConfig({
          player_name: deck.name,
          description: deck.description || '',
          main_deck: {
            members: deck.main_deck
              .filter((entry) => entry.card_type === 'MEMBER')
              .map((entry) => ({ card_code: entry.card_code, count: entry.count })),
            lives: deck.main_deck
              .filter((entry) => entry.card_type === 'LIVE')
              .map((entry) => ({ card_code: entry.card_code, count: entry.count })),
          },
          energy_deck: deck.energy_deck || [],
        }).valid,
        isCloud: true,
        updatedAt: new Date(deck.updated_at),
        memberCount: stats.memberCount,
        liveCount: stats.liveCount,
        energyCount: stats.energyCount,
        pointTotal: stats.pointTotal,
        cloudDeck: deck,
      });
    }
    
    // 本地卡组
    for (const deck of localDecks) {
      const stats = calculateDeckConfigStats(deck.config);
      
      items.push({
        id: deck.id,
        name: deck.name,
        description: deck.description,
        isValid: deck.isValid,
        isCloud: false,
        updatedAt: deck.updatedAt,
        memberCount: stats.memberCount,
        liveCount: stats.liveCount,
        energyCount: stats.energyCount,
        pointTotal: stats.pointTotal,
        localDeck: deck,
      });
    }
    
    // 按更新时间排序
    return items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }, [cloudDecks, localDecks]);

  return (
    <div className="surface-panel-frosted flex h-full flex-col overflow-hidden">
      <div className="border-b border-[var(--border-subtle)] bg-[color:var(--bg-frosted)] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers3 size={20} className="text-[var(--accent-primary)]" />
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {title}
            </h2>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="button-icon h-9 w-9 disabled:opacity-50"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>
        <div className="mt-1 text-xs text-[var(--text-muted)]">
          共 {displayDecks.length} 个卡组
        </div>
      </div>

      <div className="cute-scrollbar flex-1 overflow-y-auto p-4">
        {isLoading && displayDecks.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <RefreshCw size={32} className="mx-auto mb-3 animate-spin text-[var(--accent-primary)]" />
              <div className="text-[var(--text-secondary)]">加载中...</div>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-4">
            <div className="flex items-center gap-2 text-sm text-[var(--semantic-error)]">
              <TriangleAlert size={16} />
              <span>{error}</span>
            </div>
          </div>
        )}

        {!isLoading && displayDecks.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Database size={42} className="mx-auto mb-4 text-[var(--text-muted)]" />
              <div className="text-[var(--text-secondary)]">{emptyText}</div>
            </div>
          </div>
        )}

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
                  className={`w-full rounded-xl border p-4 text-left transition-all duration-300 ${
                    selectedId === deck.id
                      ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] border-[color:color-mix(in_srgb,var(--accent-primary)_45%,transparent)] shadow-[var(--shadow-glow)]'
                      : 'bg-[color:color-mix(in_srgb,var(--bg-surface)_82%,transparent)] border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-overlay)]'
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {selectedId === deck.id && (
                        <Check size={16} className="text-[var(--accent-primary)]" />
                      )}
                      <h3 className={`font-bold ${
                        selectedId === deck.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]'
                      }`}>
                        {deck.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {deck.isCloud ? (
                        <span className="chip-badge px-2 py-0.5 text-xs">
                          <Cloud size={12} />
                          云端
                        </span>
                      ) : (
                        <span className="chip-badge px-2 py-0.5 text-xs">
                          <Database size={12} />
                          本地
                        </span>
                      )}
                      {deck.isValid ? (
                        <span className="chip-badge px-2 py-0.5 text-xs text-[var(--semantic-success)]">
                          <Check size={12} />
                          有效
                        </span>
                      ) : (
                        <span className="chip-badge px-2 py-0.5 text-xs text-[var(--semantic-error)]">
                          <TriangleAlert size={12} />
                          不完整
                        </span>
                      )}
                    </div>
                  </div>

                  {deck.description && (
                    <p className="mb-3 line-clamp-2 text-sm text-[var(--text-secondary)]">
                      {deck.description}
                    </p>
                  )}

                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                      <UserRound size={12} />
                      <span>{deck.memberCount}/48</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                      <Layers3 size={12} />
                      <span>{deck.liveCount}/12</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                      <Zap size={12} />
                      <span>{deck.energyCount}/12</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${getDeckPointTextClass(deck.pointTotal)}`}>
                      <Star size={12} />
                      <span>{deck.pointTotal}/{DECK_POINT_LIMIT}pt</span>
                    </div>
                    <div className="flex-1" />
                    <div className="text-[var(--text-muted)]">
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
