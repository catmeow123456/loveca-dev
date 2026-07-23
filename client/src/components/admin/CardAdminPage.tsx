/**
 * CardAdminPage - 卡牌数据管理页面
 * 仅管理员可访问，提供卡牌数据的 CRUD 操作
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowLeft,
  Plus,
  Download,
  Search,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Lock,
  Pencil,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ListFilter,
  X,
} from 'lucide-react';
import { PageHeader, ThemeToggle } from '@/components/common';
import { useAuthStore } from '@/store/authStore';
import { cardService, type CardUpdateInput, type CardCreateInput } from '@/lib/cardService';
import { cleanLocalizedText, getCardLocalizedInfo } from '@/lib/cardLocalization';
import {
  resolveCardImagePath,
  preloadCardImages,
  getRecommendedImageSize,
} from '@/lib/imageService';
import { Card } from '@/components/card/Card';
import type { AnyCardData } from '@game/domain/entities/card';
import { CardType } from '@game/shared/types/enums';
import { CardEditModal } from './CardEditModal';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useKeyedState } from '@/hooks/useKeyedState';

interface CardAdminPageProps {
  onBack: () => void;
}

export function CardAdminPage({ onBack }: CardAdminPageProps) {
  const { offlineMode } = useAuthStore(useShallow((s) => ({ offlineMode: s.offlineMode })));

  const [cards, setCards] = useState<AnyCardData[]>([]);
  const [cardStatusMap, setCardStatusMap] = useState<Map<string, 'DRAFT' | 'PUBLISHED'>>(new Map());
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<CardType | 'ALL'>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | 'DRAFT' | 'PUBLISHED'>('ALL');
  const [selectedCard, setSelectedCard] = useState<AnyCardData | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(28);
  const [batchWorking, setBatchWorking] = useState(false);
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useKeyedState(
    isMobile ? 'mobile' : 'non-mobile',
    false
  );
  const isLoading = initialLoading || refreshing;

  const cardTypeOptions = [
    { value: 'ALL' as const, label: '全部' },
    { value: CardType.MEMBER, label: '成员卡' },
    { value: CardType.LIVE, label: 'Live 卡' },
    { value: CardType.ENERGY, label: '能量卡' },
  ];
  const statusOptions = [
    {
      value: 'ALL' as const,
      label: '全部状态',
      active:
        'border-[color:color-mix(in_srgb,var(--accent-primary)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)] text-[var(--text-primary)]',
    },
    {
      value: 'DRAFT' as const,
      label: '草稿',
      active: 'border-yellow-400/50 bg-yellow-500/25 text-yellow-200',
    },
    {
      value: 'PUBLISHED' as const,
      label: '已上线',
      active: 'border-green-400/50 bg-green-500/25 text-green-200',
    },
  ];
  const activeFilterCount = (selectedType !== 'ALL' ? 1 : 0) + (selectedStatus !== 'ALL' ? 1 : 0);

  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileFiltersOpen]);

  const loadCards = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') {
      setInitialLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    try {
      const data = await cardService.getAllCards(true, 'all');
      const statusMap = await cardService.getCardStatusMap();
      setCards(data);
      setCardStatusMap(statusMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (mode === 'initial') {
        setInitialLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  }, []);

  const refreshCards = useCallback(() => {
    void loadCards(cards.length > 0 ? 'refresh' : 'initial');
  }, [cards.length, loadCards]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCards('initial'), 0);
    return () => window.clearTimeout(timer);
  }, [loadCards]);

  const filteredCards = useMemo(() => {
    let result = cards;
    if (selectedType !== 'ALL') result = result.filter((c) => c.cardType === selectedType);
    if (selectedStatus !== 'ALL')
      result = result.filter((c) => cardStatusMap.get(c.cardCode) === selectedStatus);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.cardCode.toLowerCase().includes(q) ||
          cleanLocalizedText(c.nameCn)?.toLowerCase().includes(q) ||
          cleanLocalizedText(c.nameJp)?.toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => a.cardCode.localeCompare(b.cardCode));
  }, [cards, selectedType, selectedStatus, searchQuery, cardStatusMap]);

  const totalPages = Math.ceil(filteredCards.length / pageSize);
  const paginatedCards = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredCards.slice(start, start + pageSize);
  }, [filteredCards, currentPage, pageSize]);

  useEffect(() => {
    if (paginatedCards.length > 0 && !initialLoading) {
      const imageBaseNames = paginatedCards.map((card) =>
        card.imageFilename
          ? card.imageFilename.replace(/^.*\//, '').replace(/\.(jpg|jpeg|png|webp)$/i, '')
          : card.cardCode
      );
      preloadCardImages(imageBaseNames, getRecommendedImageSize('sm'));
    }
  }, [paginatedCards, initialLoading]);

  const goToPage = (page: number) => setCurrentPage(Math.max(1, Math.min(page, totalPages)));

  const handleSave = async (cardCode: string, updates: CardUpdateInput) => {
    await cardService.updateCard(cardCode, updates);
    await loadCards('refresh');
  };

  const handleCreate = async (input: CardCreateInput) => {
    await cardService.createCard(input);
    await loadCards(cards.length > 0 ? 'refresh' : 'initial');
  };

  const handleDelete = async (cardCode: string) => {
    await cardService.deleteCard(cardCode);
    await loadCards(cards.length > 1 ? 'refresh' : 'initial');
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await cardService.exportCards();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cards_export_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setExporting(false);
    }
  };

  const handleBatchStatus = async (targetStatus: 'PUBLISHED' | 'DRAFT') => {
    const targets = filteredCards.filter((c) => cardStatusMap.get(c.cardCode) !== targetStatus);
    if (targets.length === 0) return;
    const action = targetStatus === 'PUBLISHED' ? '上线' : '转为草稿';
    if (!confirm(`确定要将筛选结果中的 ${targets.length} 张卡牌全部${action}吗？`)) return;

    setBatchWorking(true);
    setError(null);
    try {
      const fn =
        targetStatus === 'PUBLISHED'
          ? (code: string) => cardService.publishCard(code)
          : (code: string) => cardService.unpublishCard(code);
      await Promise.all(targets.map((c) => fn(c.cardCode)));
      await loadCards('refresh');
    } catch (err) {
      setError(err instanceof Error ? err.message : `批量${action}失败`);
    } finally {
      setBatchWorking(false);
    }
  };

  const handleCardStatusChange = async (cardCode: string, targetStatus: 'PUBLISHED' | 'DRAFT') => {
    try {
      if (targetStatus === 'PUBLISHED') {
        await cardService.publishCard(cardCode);
      } else {
        await cardService.unpublishCard(cardCode);
      }
      await loadCards('refresh');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : targetStatus === 'PUBLISHED' ? '上线失败' : '下线失败'
      );
    }
  };

  if (offlineMode) {
    return (
      <div className="app-shell flex h-screen items-center justify-center">
        <div className="surface-panel p-8 text-center">
          <Lock size={40} className="mx-auto mb-4 text-[var(--text-muted)]" />
          <h2 className="mb-2 text-xl text-[var(--text-primary)]">离线模式</h2>
          <p className="mb-4 text-[var(--text-secondary)]">卡牌管理需要登录后使用</p>
          <button onClick={onBack} className="button-primary px-4 py-2">
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex h-screen flex-col">
      <PageHeader
        title="卡牌数据管理"
        left={
          <button
            onClick={onBack}
            className="button-ghost inline-flex h-10 items-center justify-center gap-2 px-2.5 py-2 sm:min-h-11 sm:px-3"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">返回</span>
          </button>
        }
        right={<ThemeToggle />}
      />

      <div className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto mb-4 flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-[var(--text-secondary)]">
            卡牌检索、状态维护与发布操作集中在这里处理。
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="button-secondary inline-flex min-h-10 items-center gap-1.5 px-3 py-2 text-sm disabled:opacity-50"
            >
              <Download size={14} />
              {exporting ? '导出中...' : '导出 JSON'}
            </button>
            <button
              onClick={() => {
                setIsCreating(true);
                setSelectedCard(null);
              }}
              className="button-primary inline-flex min-h-10 items-center gap-1.5 px-3 py-2 text-sm font-medium"
            >
              <Plus size={14} /> 新建卡牌
            </button>
          </div>
        </div>

        <div className="workspace-shell mx-auto max-w-7xl p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="relative w-full lg:max-w-md lg:flex-1">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                  placeholder="搜索卡牌名称或编号..."
                  className="input-field w-full py-2 pl-9 pr-4 text-sm"
                />
              </div>
              <div className="flex items-center gap-2 md:hidden">
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen(true)}
                  className="button-secondary inline-flex min-h-10 items-center justify-center gap-1.5 px-3 py-2 text-sm"
                >
                  <ListFilter size={14} />
                  筛选
                  {activeFilterCount > 0 && (
                    <span className="rounded-full bg-[color:color-mix(in_srgb,var(--accent-primary)_18%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--accent-primary)]">
                      {activeFilterCount}
                    </span>
                  )}
                </button>
                <button
                  onClick={refreshCards}
                  disabled={isLoading}
                  className="button-icon h-10 w-10"
                  aria-label="刷新卡牌列表"
                >
                  <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="hidden flex-wrap items-center gap-2 md:flex">
                {cardTypeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setSelectedType(opt.value as CardType | 'ALL');
                      setCurrentPage(1);
                    }}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
                      selectedType === opt.value
                        ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)] text-[var(--text-primary)]'
                        : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="hidden flex-wrap items-center gap-2 md:flex">
                {statusOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setSelectedStatus(opt.value);
                      setCurrentPage(1);
                    }}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition-all ${
                      selectedStatus === opt.value
                        ? opt.active
                        : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                <button
                  onClick={refreshCards}
                  disabled={isLoading}
                  className="button-icon h-9 w-9"
                  aria-label="刷新卡牌列表"
                >
                  <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
                <span>共 {cards.length} 张</span>
                <span>筛选: {filteredCards.length} 张</span>
                {refreshing && (
                  <span className="inline-flex items-center gap-1 text-[var(--accent-primary)]">
                    <Loader2 size={12} className="animate-spin" />
                    刷新中
                  </span>
                )}
                {filteredCards.length > 0 && (
                  <div className="hidden items-center gap-3 md:flex">
                    <button
                      onClick={() => handleBatchStatus('PUBLISHED')}
                      disabled={batchWorking}
                      className="flex items-center gap-0.5 text-green-300/70 hover:text-green-300 disabled:opacity-40"
                    >
                      <ArrowUp size={10} /> 全部上线
                    </button>
                    <button
                      onClick={() => handleBatchStatus('DRAFT')}
                      disabled={batchWorking}
                      className="flex items-center gap-0.5 text-yellow-300/70 hover:text-yellow-300 disabled:opacity-40"
                    >
                      <ArrowDown size={10} /> 全部转草稿
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <AnimatePresence>
            {mobileFiltersOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="modal-backdrop fixed inset-0 z-40 md:hidden"
                  onClick={() => setMobileFiltersOpen(false)}
                />
                <motion.div
                  initial={{ y: '100%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '100%' }}
                  transition={{ type: 'tween', duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                  className="safe-bottom fixed inset-x-0 bottom-0 z-50 flex max-h-[82dvh] flex-col rounded-t-[24px] border border-b-0 border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] md:hidden"
                >
                  <div className="workspace-toolbar shrink-0 px-4 py-3">
                    <div className="mb-2 flex justify-center">
                      <div className="h-1.5 w-12 rounded-full bg-[var(--border-default)]" />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[var(--text-primary)]">
                          筛选与批量操作
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                          当前筛选 {filteredCards.length} / {cards.length} 张
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMobileFiltersOpen(false)}
                        className="button-icon h-8 w-8"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="touch-scroll flex-1 space-y-5 overflow-y-auto p-4">
                    <section>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        卡牌类型
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {cardTypeOptions.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setSelectedType(opt.value as CardType | 'ALL');
                              setCurrentPage(1);
                            }}
                            className={`min-h-11 rounded-xl border px-3 py-2 text-sm transition-all ${
                              selectedType === opt.value
                                ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)] text-[var(--text-primary)]'
                                : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] text-[var(--text-secondary)]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </section>

                    <section>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        发布状态
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {statusOptions.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setSelectedStatus(opt.value);
                              setCurrentPage(1);
                            }}
                            className={`min-h-11 rounded-xl border px-2 py-2 text-sm transition-all ${
                              selectedStatus === opt.value
                                ? opt.active
                                : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] text-[var(--text-secondary)]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </section>

                    {filteredCards.length > 0 && (
                      <section>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          批量状态
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => handleBatchStatus('PUBLISHED')}
                            disabled={batchWorking}
                            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-green-400/25 bg-green-500/10 px-3 py-2 text-sm text-green-200 disabled:opacity-40"
                          >
                            <ArrowUp size={14} />
                            全部上线
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBatchStatus('DRAFT')}
                            disabled={batchWorking}
                            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-yellow-400/25 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200 disabled:opacity-40"
                          >
                            <ArrowDown size={14} />
                            全部转草稿
                          </button>
                        </div>
                      </section>
                    )}
                  </div>

                  <div className="modal-footer safe-bottom grid grid-cols-2 gap-2 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedType('ALL');
                        setSelectedStatus('ALL');
                        setCurrentPage(1);
                      }}
                      className="button-ghost inline-flex min-h-11 items-center justify-center px-4 py-2 text-sm"
                    >
                      重置
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileFiltersOpen(false)}
                      className="button-primary inline-flex min-h-11 items-center justify-center px-4 py-2 text-sm font-semibold"
                    >
                      完成
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-3 text-sm text-[var(--semantic-error)]">
              <AlertTriangle size={14} />
              {error}
              <button onClick={refreshCards} className="ml-2 underline">
                重试
              </button>
            </div>
          )}

          {initialLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={28} className="animate-spin text-[var(--accent-primary)]" />
            </div>
          ) : (
            <div aria-busy={refreshing}>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                {paginatedCards.map((card) => {
                  const localizedName = getCardLocalizedInfo(card);

                  return (
                    <div
                      key={card.cardCode}
                      className="group cursor-pointer"
                      onClick={() => {
                        setSelectedCard(card);
                        setIsCreating(false);
                      }}
                    >
                      <div className="w-full relative" style={{ aspectRatio: '63/88' }}>
                        <Card
                          cardData={card}
                          imagePath={resolveCardImagePath(card)}
                          size="responsive"
                          interactive={false}
                          showHover={false}
                          className="rounded-lg transition-[filter] duration-200 group-hover:brightness-110"
                        />
                        {cardStatusMap.get(card.cardCode) === 'DRAFT' && (
                          <div className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] font-bold bg-yellow-500/80 text-yellow-950 rounded">
                            草稿
                          </div>
                        )}
                      </div>
                      <div className="mt-1.5 text-center">
                        <div className="truncate text-xs text-[var(--text-secondary)]">
                          {card.cardCode}
                        </div>
                        <div
                          className="truncate text-xs text-[var(--text-muted)]"
                          title={localizedName.title}
                        >
                          {localizedName.displayNameCn}
                        </div>
                        <div className="truncate text-[11px] text-[var(--text-muted)]">
                          {localizedName.nameJp ?? '未收录日文名'}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap justify-center gap-1">
                        <span className="flex min-h-8 items-center gap-1 rounded-lg bg-[color:color-mix(in_srgb,var(--accent-primary)_14%,transparent)] px-2 py-1 text-xs text-[var(--accent-primary)] opacity-100 transition-opacity md:min-h-0 md:py-0.5 md:opacity-0 md:group-hover:opacity-100">
                          <Pencil size={10} /> 编辑
                        </span>
                        {cardStatusMap.get(card.cardCode) === 'DRAFT' ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCardStatusChange(card.cardCode, 'PUBLISHED');
                            }}
                            className="flex min-h-8 items-center gap-0.5 rounded-lg bg-green-500/15 px-2 py-1 text-xs text-green-300/90 opacity-100 transition-opacity hover:bg-green-500/30 md:min-h-0 md:py-0.5 md:opacity-0 md:group-hover:opacity-100"
                          >
                            <ArrowUp size={10} /> 上线
                          </button>
                        ) : (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCardStatusChange(card.cardCode, 'DRAFT');
                            }}
                            className="flex min-h-8 items-center gap-0.5 rounded-lg bg-yellow-500/15 px-2 py-1 text-xs text-yellow-300/90 opacity-100 transition-opacity hover:bg-yellow-500/30 md:min-h-0 md:py-0.5 md:opacity-0 md:group-hover:opacity-100"
                          >
                            <ArrowDown size={10} /> 下线
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 分页 */}
              {totalPages > 1 && (
                <div className="mt-6">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:hidden">
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="button-ghost inline-flex min-h-11 items-center justify-center gap-1 px-3 py-2 text-sm disabled:opacity-30"
                    >
                      <ChevronLeft size={16} />
                      上一页
                    </button>
                    <span className="rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                      {currentPage}/{totalPages}
                    </span>
                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="button-ghost inline-flex min-h-11 items-center justify-center gap-1 px-3 py-2 text-sm disabled:opacity-30"
                    >
                      下一页
                      <ChevronRight size={16} />
                    </button>
                  </div>

                  <div className="hidden items-center justify-center gap-1.5 sm:flex">
                    <button
                      onClick={() => goToPage(1)}
                      disabled={currentPage === 1}
                      className="button-ghost p-2 disabled:opacity-30"
                    >
                      <ChevronsLeft size={16} />
                    </button>
                    <button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="button-ghost p-2 disabled:opacity-30"
                    >
                      <ChevronLeft size={16} />
                    </button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum: number;
                        if (totalPages <= 5) pageNum = i + 1;
                        else if (currentPage <= 3) pageNum = i + 1;
                        else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                        else pageNum = currentPage - 2 + i;
                        return (
                          <button
                            key={pageNum}
                            onClick={() => goToPage(pageNum)}
                            className={`w-8 h-8 rounded-lg text-xs font-medium transition-all ${
                              currentPage === pageNum
                                ? 'border border-[color:color-mix(in_srgb,var(--accent-primary)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)] text-[var(--text-primary)]'
                                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-overlay)]'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>

                    <span className="px-2 text-xs text-[var(--text-muted)]">
                      {currentPage}/{totalPages}
                    </span>

                    <button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="button-ghost p-2 disabled:opacity-30"
                    >
                      <ChevronRight size={16} />
                    </button>
                    <button
                      onClick={() => goToPage(totalPages)}
                      disabled={currentPage === totalPages}
                      className="button-ghost p-2 disabled:opacity-30"
                    >
                      <ChevronsRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {filteredCards.length === 0 && !initialLoading && (
            <div className="text-center py-20">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-surface)_78%,transparent)]">
                <Search size={24} className="text-[var(--text-muted)]" />
              </div>
              <div className="text-sm text-[var(--text-secondary)]">没有找到匹配的卡牌</div>
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      <AnimatePresence>
        {(selectedCard || isCreating) && (
          <CardEditModal
            key={isCreating ? 'create-card' : selectedCard?.cardCode}
            card={selectedCard}
            isOpen={true}
            onClose={() => {
              setSelectedCard(null);
              setIsCreating(false);
            }}
            onSave={handleSave}
            onCreate={handleCreate}
            onDelete={handleDelete}
            isCreating={isCreating}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default CardAdminPage;
