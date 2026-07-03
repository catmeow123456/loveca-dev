/**
 * DeckSelector - 卡组选择器组件
 * 展示用户的卡组列表，支持选中和预览
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  Cloud,
  Database,
  Layers3,
  RefreshCw,
  Star,
  TriangleAlert,
  UserRound,
  Zap,
} from 'lucide-react';
import type { DeckRecord } from '@/lib/apiClient';
import { formatRelativeTime, getDeckPointTextClass } from './DeckStats';
import { DECK_POINT_LIMIT } from '@game/domain/rules/deck-construction';
import { useGameStore } from '@/store/gameStore';
import { createDeckRecordCardTypeResolver } from '@/lib/deckRecordUtils';
import { buildDeckDisplayItems, type DeckDisplayItem, type LocalDeck } from '@/lib/deckDisplay';

export type { DeckDisplayItem, LocalDeck };

type DeckSelectorDensity = 'comfortable' | 'compact';

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
  /** 标题下方说明 */
  subtitle?: string;
  /** 选中摘要标签 */
  selectionLabel?: string;
  /** 空状态提示 */
  emptyText?: string;
  /** 条目密度 */
  density?: DeckSelectorDensity;
  /** 上次使用的卡组 ID */
  lastUsedDeckId?: string | null;
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
  subtitle = '选择一副可用于本局的完整卡组。',
  selectionLabel = '当前选择',
  emptyText = '还没有卡组，去创建一个吧！',
  density = 'comfortable',
  lastUsedDeckId = null,
}: DeckSelectorProps) {
  const isCompact = density === 'compact';
  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);
  const resolveDeckRecordCardType = useMemo(
    () => createDeckRecordCardTypeResolver(cardDataRegistry),
    [cardDataRegistry]
  );

  // 合并并转换为统一显示格式
  const displayDecks = useMemo<DeckDisplayItem[]>(() => {
    return buildDeckDisplayItems({
      cloudDecks,
      localDecks,
      resolveDeckRecordCardType,
    });
  }, [cloudDecks, localDecks, resolveDeckRecordCardType]);
  const selectedDeck = useMemo(
    () => displayDecks.find((deck) => deck.id === selectedId) ?? null,
    [displayDecks, selectedId]
  );
  const validDeckCount = useMemo(
    () => displayDecks.filter((deck) => deck.isValid).length,
    [displayDecks]
  );

  return (
    <div className="surface-panel-frosted flex h-full flex-col overflow-hidden">
      <div
        className={`border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_92%,transparent)] ${
          isCompact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div
                className={`flex shrink-0 items-center justify-center rounded-lg border border-[color:color-mix(in_srgb,var(--accent-primary)_28%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-overlay))] text-[var(--accent-primary)] ${
                  isCompact ? 'h-8 w-8' : 'h-9 w-9'
                }`}
              >
                <Layers3 size={isCompact ? 16 : 18} />
              </div>
              <h2
                className={`min-w-0 truncate font-bold text-[var(--text-primary)] ${
                  isCompact ? 'text-base' : 'text-lg'
                }`}
              >
                {title}
              </h2>
            </div>
            {subtitle && (
              <p
                className={`mt-2 text-sm text-[var(--text-secondary)] ${
                  isCompact ? 'line-clamp-1 leading-5' : 'leading-relaxed'
                }`}
              >
                {subtitle}
              </p>
            )}
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="button-icon h-9 w-9 shrink-0 disabled:opacity-50"
              aria-label="刷新卡组列表"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)] ${
            isCompact ? 'mt-2' : 'mt-3'
          }`}
        >
          <span>
            {validDeckCount}/{displayDecks.length} 可用
          </span>
          <span className="hidden text-[var(--border-default)] sm:inline">|</span>
          <span className="min-w-0 truncate">
            {selectionLabel}：{' '}
            <span className="font-semibold text-[var(--text-primary)]">
              {selectedDeck?.name ?? '未选择'}
            </span>
          </span>
        </div>
      </div>

      <div className={`cute-scrollbar flex-1 overflow-y-auto ${isCompact ? 'p-3' : 'p-4'}`}>
        {isLoading && displayDecks.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <RefreshCw
                size={32}
                className="mx-auto mb-3 animate-spin text-[var(--accent-primary)]"
              />
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
          <div className={isCompact ? 'grid gap-2' : 'grid gap-3'}>
            {displayDecks.map((deck, index) => {
              const isSelected = selectedId === deck.id;
              const isLastUsed = deck.id === lastUsedDeckId;
              return (
                <motion.div
                  key={deck.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{
                    duration: 0.2,
                    delay: Math.min(index, 8) * (isCompact ? 0.025 : 0.04),
                  }}
                >
                  <button
                    type="button"
                    onClick={() => deck.isValid && onSelect(deck)}
                    disabled={!deck.isValid}
                    aria-pressed={isSelected}
                    className={`relative w-full overflow-hidden rounded-lg border text-left outline-none transition-all duration-300 focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-deep)] ${
                      isCompact ? 'min-h-[72px] px-3 py-2.5' : 'p-4'
                    } ${
                      isSelected
                        ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_55%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] shadow-[var(--shadow-glow)]'
                        : deck.isValid
                          ? 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_84%,transparent)] hover:-translate-y-0.5 hover:border-[var(--border-default)] hover:bg-[var(--bg-overlay)] hover:shadow-[var(--shadow-sm)]'
                          : 'cursor-not-allowed border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_58%,transparent)] opacity-65'
                    }`}
                    >
                      <span
                        className={`absolute inset-x-0 top-0 ${isCompact ? 'h-0.5' : 'h-1'} ${
                          isSelected
                            ? 'bg-[var(--accent-primary)]'
                            : deck.isValid
                            ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_24%,transparent)]'
                            : 'bg-[color:color-mix(in_srgb,var(--semantic-error)_30%,transparent)]'
                        }`}
                      />

                    <div
                      className={`flex items-start justify-between gap-3 ${
                        isCompact ? 'mb-2' : 'mb-3'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`flex shrink-0 items-center justify-center rounded-lg border ${
                              isCompact ? 'h-5 w-5' : 'h-6 w-6'
                            } ${
                              isSelected
                                ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white'
                                : 'border-[var(--border-default)] bg-[var(--bg-overlay)] text-[var(--text-muted)]'
                            }`}
                          >
                            {isSelected ? (
                              <Check size={isCompact ? 12 : 14} />
                            ) : (
                              <Layers3 size={isCompact ? 11 : 13} />
                            )}
                          </span>
                          <h3
                            className={`min-w-0 truncate font-bold text-[var(--text-primary)] ${
                              isCompact ? 'text-sm' : 'text-base'
                            }`}
                          >
                            {deck.name}
                          </h3>
                        </div>
                        <div
                          className={`flex flex-wrap items-center gap-2 ${
                            isCompact ? 'mt-1.5' : 'mt-2'
                          }`}
                        >
                          {!isCompact && (
                            <span
                              className="chip-badge px-2 py-0.5 text-xs"
                              title={deck.isCloud ? '云端卡组' : '本地卡组'}
                              aria-label={deck.isCloud ? '云端卡组' : '本地卡组'}
                            >
                              {deck.isCloud ? <Cloud size={12} /> : <Database size={12} />}
                            </span>
                          )}
                          {!isCompact && deck.isValid ? (
                            <span className="chip-badge px-2 py-0.5 text-xs text-[var(--semantic-success)]">
                              <Check size={12} />
                              可用
                            </span>
                          ) : !deck.isValid ? (
                            <span className="chip-badge px-2 py-0.5 text-xs text-[var(--semantic-error)]">
                              <TriangleAlert size={12} />
                              不完整
                            </span>
                          ) : null}
                          {isLastUsed && (
                            <span className="rounded-md border border-[color:color-mix(in_srgb,var(--semantic-success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_12%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--semantic-success)]">
                              上次使用
                            </span>
                          )}
                        </div>
                      </div>
                      <div
                        className={`shrink-0 text-right text-[11px] text-[var(--text-muted)] ${
                          isCompact ? 'hidden sm:block' : ''
                        }`}
                      >
                        {formatRelativeTime(deck.updatedAt)}
                      </div>
                    </div>

                    {deck.description && (!isCompact || isSelected) && (
                      <p className="mb-3 line-clamp-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                        {deck.description}
                      </p>
                    )}

                    <div
                      className={`flex flex-wrap items-center gap-y-1 text-xs ${
                        isCompact ? 'gap-x-3' : 'gap-x-4'
                      }`}
                    >
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
                      <div
                        className={`flex items-center gap-1.5 ${getDeckPointTextClass(deck.pointTotal)}`}
                      >
                        <Star size={12} />
                        <span>
                          {deck.pointTotal}/{DECK_POINT_LIMIT}pt
                        </span>
                      </div>
                    </div>
                  </button>
                </motion.div>
              );
            })}
          </div>
        </AnimatePresence>
      </div>
    </div>
  );
}
