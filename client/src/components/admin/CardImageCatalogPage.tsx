import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CircleAlert,
  FileSearch,
  Images,
  Loader2,
  Music2,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  ActionButton,
  PageHeader,
  SelectMenu,
  TextInput,
  type SelectMenuOption,
} from '@/components/common';
import { cardImageCatalogClient } from '@/lib/cardImageCatalogClient';
import { pushAdminHistory } from '@/lib/adminNavigationHistory';
import type {
  CardImageCatalogDetail,
  CardImageCatalogItem,
  CardImageObjectCheck,
} from '@game/shared/game-assets';
import { CARD_TYPE_OPTIONS as CARD_TYPE_FILTER_OPTIONS } from '@/components/deck-editor/filter-constants';
import { AssetDownloadButton } from './AssetDownloadButton';

interface CardImageCatalogPageProps {
  readonly onBack: () => void;
  readonly initialCardCode?: string | null;
  readonly onOpenMusicAssets?: () => void;
  readonly onOpenImageAssets?: () => void;
}

const PAGE_SIZE = 36;

const CARD_TYPE_OPTIONS: readonly SelectMenuOption<CardImageCatalogItem['cardType'] | ''>[] = [
  { value: '', label: '全部类型' },
  ...CARD_TYPE_FILTER_OPTIONS,
];

const CARD_STATUS_OPTIONS: readonly SelectMenuOption<CardImageCatalogItem['cardStatus'] | ''>[] = [
  { value: '', label: '全部状态' },
  { value: 'PUBLISHED', label: '已发布' },
  { value: 'DRAFT', label: '草稿' },
];

const IMAGE_STATUS_OPTIONS: readonly SelectMenuOption<'SET' | 'UNSET' | ''>[] = [
  { value: '', label: '全部图片' },
  { value: 'SET', label: '已登记文件名' },
  { value: 'UNSET', label: '未登记文件名' },
];

const VERSION_LABELS = {
  VERSIONED: '已版本化',
  UNVERSIONED: '未版本化',
  INVALID: '标记异常',
} as const;

const OBJECT_SIZE_LABELS = {
  thumb: '缩略图',
  medium: '中图',
  large: '大图',
} as const;

function readCardImageDetailCode(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/card-images\/([^/]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function CardImageCatalogPage({
  onBack,
  initialCardCode = null,
  onOpenMusicAssets,
  onOpenImageAssets,
}: CardImageCatalogPageProps) {
  const [query, setQuery] = useState('');
  const [cardType, setCardType] = useState<CardImageCatalogItem['cardType'] | ''>('');
  const [cardStatus, setCardStatus] = useState<CardImageCatalogItem['cardStatus'] | ''>('');
  const [filename, setFilename] = useState<'SET' | 'UNSET' | ''>('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{
    items: readonly CardImageCatalogItem[];
    total: number;
    page: number;
    totalPages: number;
  } | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(initialCardCode);
  const [detail, setDetail] = useState<CardImageCatalogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(Boolean(initialCardCode));
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [routeChanging, setRouteChanging] = useState(false);
  const selectedCodeRef = useRef<string | null>(null);
  const routeTransitionTimerRef = useRef<number | null>(null);

  const beginRouteTransition = useCallback(() => {
    setRouteChanging(true);
    if (routeTransitionTimerRef.current !== null) {
      window.clearTimeout(routeTransitionTimerRef.current);
    }
    routeTransitionTimerRef.current = window.setTimeout(() => {
      routeTransitionTimerRef.current = null;
      setRouteChanging(false);
    }, 180);
  }, []);

  useEffect(
    () => () => {
      if (routeTransitionTimerRef.current !== null) {
        window.clearTimeout(routeTransitionTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedCode) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await cardImageCatalogClient.list({
          page,
          pageSize: PAGE_SIZE,
          query: query.trim() || undefined,
          cardType: cardType || undefined,
          cardStatus: cardStatus || undefined,
          filename: filename || undefined,
        });
        if (active) setResult(next);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : '读取卡图目录失败');
      } finally {
        if (active) setLoading(false);
      }
    };
    const timer = window.setTimeout(() => void load(), 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cardStatus, cardType, filename, page, query, selectedCode]);

  const loadDetail = useCallback(async (cardCode: string) => {
    selectedCodeRef.current = cardCode;
    setDetailLoading(true);
    setDetail(null);
    try {
      const next = await cardImageCatalogClient.detail(cardCode);
      if (selectedCodeRef.current === cardCode) setDetail(next);
    } catch (cause) {
      if (selectedCodeRef.current === cardCode) {
        setError(cause instanceof Error ? cause.message : '读取卡图详情失败');
      }
    } finally {
      if (selectedCodeRef.current === cardCode) setDetailLoading(false);
    }
  }, []);

  const openDetail = useCallback(
    (cardCode: string) => {
      beginRouteTransition();
      selectedCodeRef.current = cardCode;
      pushAdminHistory(`/admin/card-images/${encodeURIComponent(cardCode)}`);
      setDetailLoading(true);
      setDetail(null);
      setSelectedCode(cardCode);
    },
    [beginRouteTransition]
  );

  useEffect(() => {
    if (!selectedCode) return;
    const timer = window.setTimeout(() => void loadDetail(selectedCode), 0);
    return () => window.clearTimeout(timer);
  }, [loadDetail, selectedCode]);

  useEffect(() => {
    const handleRouteChange = () => {
      const nextCode = readCardImageDetailCode(window.location.pathname);
      beginRouteTransition();
      selectedCodeRef.current = nextCode;
      setSelectedCode(nextCode);
      setDetail(null);
      setDetailLoading(Boolean(nextCode));
      setVerifying(false);
    };
    window.addEventListener('popstate', handleRouteChange);
    return () => window.removeEventListener('popstate', handleRouteChange);
  }, [beginRouteTransition]);

  const verifyDetail = async () => {
    if (!selectedCode) return;
    const cardCode = selectedCode;
    setVerifying(true);
    try {
      const next = await cardImageCatalogClient.detail(cardCode, true);
      if (selectedCodeRef.current === cardCode) setDetail(next);
    } catch (cause) {
      if (selectedCodeRef.current === cardCode) {
        setError(cause instanceof Error ? cause.message : '检查卡图失败');
      }
    } finally {
      if (selectedCodeRef.current === cardCode) setVerifying(false);
    }
  };

  const counts = useMemo(() => {
    const items = result?.items ?? [];
    return {
      withImage: items.filter((item) => item.imageFilename).length,
      warnings: items.filter((item) => item.warning).length,
    };
  }, [result]);

  const hasFilters = Boolean(query || cardType || cardStatus || filename);
  const filterCount = [query, cardType, cardStatus, filename].filter(Boolean).length;
  const clearFilters = () => {
    setPage(1);
    setQuery('');
    setCardType('');
    setCardStatus('');
    setFilename('');
  };

  const closeDetail = useCallback(() => {
    beginRouteTransition();
    window.history.replaceState(window.history.state, '', '/?page=card-images-admin');
    selectedCodeRef.current = null;
    setSelectedCode(null);
    setDetail(null);
    setDetailLoading(false);
    setVerifying(false);
  }, [beginRouteTransition]);

  useEffect(() => {
    if (!selectedCode) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeDetail, selectedCode]);

  return (
    <div className="app-shell min-h-screen">
      <PageHeader
        title={selectedCode ? '卡图详情' : '卡图目录'}
        description="只读盘点 · 现有卡牌记录与对象存储"
        onBack={selectedCode ? closeDetail : onBack}
        backLabel={selectedCode ? '返回卡图目录' : '返回管理中心'}
        right={
          !selectedCode ? (
            <div className="flex items-center gap-1.5">
              {onOpenImageAssets ? (
                <ActionButton variant="ghost" size="compact" onClick={onOpenImageAssets}>
                  其他图片
                </ActionButton>
              ) : null}
              {onOpenMusicAssets ? (
                <ActionButton
                  variant="ghost"
                  size="compact"
                  onClick={onOpenMusicAssets}
                  className="gap-1.5"
                >
                  <Music2 size={14} aria-hidden="true" />
                  音乐资源
                </ActionButton>
              ) : null}
            </div>
          ) : undefined
        }
        className="[&_.page-header-inner]:min-h-0 [&_.page-header-inner]:!grid-cols-[auto_minmax(0,1fr)] [&_.page-header-inner]:py-2 [&_.page-header-actions]:!col-[1/-1] [&_.page-header-title]:text-base [&_.page-header-description]:hidden sm:[&_.page-header-title]:text-lg md:[&_.page-header-inner]:!grid-cols-[auto_minmax(0,1fr)_auto] md:[&_.page-header-actions]:!col-[3/4]"
      />
      <main className="product-page-main relative !z-[200]">
        <div className="mx-auto max-w-[90rem]">
          {!selectedCode ? (
            <section className="mb-4 overflow-visible border-y border-[var(--border-default)] bg-[var(--bg-surface)]">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="flex min-w-0 items-baseline gap-2">
                  <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    卡图资产
                  </h2>
                  <span className="font-mono text-[9px] uppercase tracking-[.16em] text-[var(--text-muted)]">
                    read only
                  </span>
                </div>
                <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
                  <CatalogMetric label="总卡牌" value={result?.total ?? 0} />
                  <CatalogMetric label="已登记" value={counts.withImage} accent="success" />
                  <CatalogMetric label="需关注" value={counts.warnings} accent="warning" />
                </div>
                <div className="flex min-w-[16rem] flex-1 basis-full items-center gap-2 md:basis-auto">
                  <label className="relative min-w-0 flex-1">
                    <span className="sr-only">搜索</span>
                    <Search
                      size={16}
                      aria-hidden="true"
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                    />
                    <TextInput
                      value={query}
                      onChange={(event) => {
                        setPage(1);
                        setQuery(event.target.value);
                      }}
                      placeholder="卡号、卡名或文件名"
                      aria-label="搜索卡图"
                      className="h-9 rounded-none !pl-10 !pr-10 text-sm shadow-none"
                    />
                    {query ? (
                      <button
                        type="button"
                        aria-label="清除搜索"
                        onClick={() => {
                          setPage(1);
                          setQuery('');
                        }}
                        className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                  </label>
                  <ActionButton
                    variant={filtersOpen ? 'secondary' : 'ghost'}
                    size="compact"
                    aria-expanded={filtersOpen}
                    aria-controls="card-catalog-secondary-filters"
                    onClick={() => setFiltersOpen((value) => !value)}
                    className="shrink-0 gap-1.5"
                  >
                    <SlidersHorizontal size={14} aria-hidden="true" />
                    {filtersOpen ? '收起' : '筛选'}
                    {filterCount ? (
                      <span className="font-mono text-[10px] text-[var(--accent-primary)]">
                        {filterCount}
                      </span>
                    ) : null}
                  </ActionButton>
                </div>
              </div>

              <div
                id="card-catalog-secondary-filters"
                className={`${filtersOpen ? 'grid' : 'hidden'} gap-2 border-t border-[var(--border-subtle)] px-3 py-2 md:grid-cols-3`}
              >
                <CatalogField label="类型">
                  <CatalogSelect
                    aria-label="卡牌类型"
                    value={cardType}
                    options={CARD_TYPE_OPTIONS}
                    onChange={(value) => {
                      setPage(1);
                      setCardType(value as typeof cardType);
                    }}
                  />
                </CatalogField>
                <CatalogField label="卡牌状态">
                  <CatalogSelect
                    aria-label="卡牌状态"
                    value={cardStatus}
                    options={CARD_STATUS_OPTIONS}
                    onChange={(value) => {
                      setPage(1);
                      setCardStatus(value as typeof cardStatus);
                    }}
                  />
                </CatalogField>
                <CatalogField label="图片状态">
                  <CatalogSelect
                    aria-label="图片状态"
                    value={filename}
                    options={IMAGE_STATUS_OPTIONS}
                    onChange={(value) => {
                      setPage(1);
                      setFilename(value as typeof filename);
                    }}
                  />
                </CatalogField>
              </div>

              {hasFilters ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] px-3 py-2">
                  <span className="mr-1 text-[11px] text-[var(--text-muted)]">已筛选</span>
                  {query ? (
                    <CatalogFilterChip
                      label={`搜索：${query}`}
                      onRemove={() => {
                        setPage(1);
                        setQuery('');
                      }}
                    />
                  ) : null}
                  {cardType ? (
                    <CatalogFilterChip
                      label={`类型：${getOptionLabel(CARD_TYPE_OPTIONS, cardType)}`}
                      onRemove={() => {
                        setPage(1);
                        setCardType('');
                      }}
                    />
                  ) : null}
                  {cardStatus ? (
                    <CatalogFilterChip
                      label={`状态：${getOptionLabel(CARD_STATUS_OPTIONS, cardStatus)}`}
                      onRemove={() => {
                        setPage(1);
                        setCardStatus('');
                      }}
                    />
                  ) : null}
                  {filename ? (
                    <CatalogFilterChip
                      label={`图片：${getOptionLabel(IMAGE_STATUS_OPTIONS, filename)}`}
                      onRemove={() => {
                        setPage(1);
                        setFilename('');
                      }}
                    />
                  ) : null}
                  <ActionButton
                    variant="ghost"
                    size="compact"
                    onClick={clearFilters}
                    className="ml-auto text-[var(--accent-primary)]"
                  >
                    清除全部
                  </ActionButton>
                </div>
              ) : null}
            </section>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--semantic-error)]/40 bg-[var(--semantic-error)]/10 px-4 py-3 text-sm text-[var(--semantic-error)]"
            >
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="关闭错误">
                <X size={16} />
              </button>
            </div>
          ) : null}

          <div
            className={`transition-opacity duration-150 ease-out ${routeChanging ? 'opacity-70' : 'opacity-100'}`}
          >
            {selectedCode ? (
              <section className="product-workbench !rounded-none min-h-[30rem] overflow-hidden">
                {detailLoading ? (
                  <CardDetailLoading />
                ) : detail ? (
                  <CardDetail
                    detail={detail}
                    verifying={verifying}
                    onVerify={() => void verifyDetail()}
                    onClose={closeDetail}
                  />
                ) : null}
              </section>
            ) : null}

            {!selectedCode ? (
              <section className="product-workbench !rounded-none min-h-[30rem] overflow-hidden">
                <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent-primary)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-primary)_12%,transparent)]"
                      aria-hidden="true"
                    />
                    <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      卡牌画廊
                    </h2>
                  </div>
                  <span className="font-mono text-[10px] text-[var(--text-muted)]">
                    {result?.items.length ?? 0} 张 / {result?.total ?? 0} 张
                  </span>
                </div>
                {result ? (
                  <div className="relative">
                    {result.items.length ? (
                      <div className="grid grid-cols-2 gap-2 bg-[var(--bg-deep)] p-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                        {result.items.map((item) => (
                          <CardTile
                            key={item.cardCode}
                            item={item}
                            selected={item.cardCode === selectedCode}
                            onClick={() => openDetail(item.cardCode)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex min-h-[30rem] items-center justify-center px-6 text-center text-sm text-[var(--text-muted)]">
                        没有符合条件的卡图记录
                      </div>
                    )}
                    {loading ? (
                      <div className="absolute inset-0 flex items-start justify-center bg-[color:color-mix(in_srgb,var(--bg-surface)_68%,transparent)] pt-8 backdrop-blur-[1px]">
                        <span className="inline-flex items-center gap-2 border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-sm">
                          <Loader2
                            className="animate-spin text-[var(--accent-primary)]"
                            size={14}
                          />
                          更新列表
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex min-h-[30rem] items-center justify-center text-[var(--text-muted)]">
                    <Loader2 className="animate-spin" size={22} />
                  </div>
                )}
                <footer className="flex items-center justify-between border-t border-[var(--border-subtle)] px-4 py-3">
                  <span className="font-mono text-[10px] uppercase tracking-[.12em] text-[var(--text-muted)]">
                    Page {String(result?.page ?? page).padStart(2, '0')} /{' '}
                    {String(result?.totalPages ?? 0).padStart(2, '0')}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      aria-label="上一页"
                      disabled={page <= 1 || loading}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                      className="rounded-md border border-transparent p-2 text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label="下一页"
                      disabled={loading || page >= (result?.totalPages ?? 0)}
                      onClick={() => setPage((value) => value + 1)}
                      className="rounded-md border border-transparent p-2 text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:bg-[var(--bg-elevated)] disabled:opacity-40"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </footer>
              </section>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

function CardTile({
  item,
  selected,
  onClick,
}: {
  item: CardImageCatalogItem;
  selected: boolean;
  onClick: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group flex min-w-0 flex-col overflow-hidden rounded-none border border-[var(--border-subtle)] bg-[var(--bg-deep)] text-left transition-colors hover:border-[var(--accent-primary)]/60 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ${selected ? 'border-[var(--accent-primary)] bg-[color:color-mix(in_srgb,var(--accent-primary)_6%,var(--bg-deep))] ring-1 ring-inset ring-[var(--accent-primary)]' : ''}`}
    >
      <div className="relative aspect-[.72] overflow-hidden bg-[var(--bg-surface)] p-2.5">
        {(item.urls.medium ?? item.urls.thumb) && !imageFailed ? (
          <img
            src={item.urls.medium ?? item.urls.thumb ?? undefined}
            alt=""
            loading="lazy"
            decoding="async"
            sizes="(min-width: 1536px) 14vw, (min-width: 1280px) 18vw, (min-width: 1024px) 24vw, (min-width: 640px) 32vw, 50vw"
            className="h-full w-full object-contain transition-transform duration-200 motion-reduce:transition-none group-hover:scale-[1.015]"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
            <Images size={22} className="text-[var(--accent-primary)]/70" aria-hidden="true" />
            <span className="text-[10px] text-[var(--text-muted)]">暂无缩略图</span>
          </div>
        )}
        {item.warning ? (
          <span
            className="absolute right-1.5 top-1.5 rounded-none bg-[var(--semantic-warning)] p-1 text-[var(--brand-stage-ink)]"
            title={item.warning}
          >
            <CircleAlert size={12} />
          </span>
        ) : null}
      </div>
      <div className="min-w-0 border-t border-[var(--border-subtle)] px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-mono text-[11px] font-medium text-[var(--text-primary)]">
            {item.cardCode}
          </p>
          <span
            className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-medium ${selected ? 'text-[var(--accent-primary)]' : item.imageFilename ? 'text-[var(--semantic-success)]' : 'text-[var(--text-muted)]'}`}
          >
            {selected ? <Check size={11} aria-hidden="true" /> : null}
            {selected ? '已选' : item.imageFilename ? '已登记' : '待补图'}
          </span>
        </div>
        <p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">{item.name}</p>
      </div>
    </button>
  );
}

function CatalogMetric({
  label,
  value,
  accent = 'default',
}: {
  label: string;
  value: number;
  accent?: 'default' | 'success' | 'warning';
}) {
  const valueClass =
    accent === 'success'
      ? 'text-[var(--semantic-success)]'
      : accent === 'warning'
        ? 'text-[var(--semantic-warning)]'
        : 'text-[var(--text-primary)]';
  return (
    <span className="inline-flex items-baseline gap-1.5 border-l border-[var(--border-default)] pl-3 first:border-l-0 first:pl-0">
      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
      <span className={`font-mono text-sm font-semibold ${valueClass}`}>
        {value.toLocaleString()}
      </span>
    </span>
  );
}

function CatalogSelect({
  options,
  onChange,
  value,
  'aria-label': ariaLabel,
}: {
  options: readonly SelectMenuOption<string>[];
  onChange: (value: string) => void;
  'aria-label': string;
  value: string;
}) {
  return (
    <SelectMenu
      label={ariaLabel}
      value={value}
      options={options}
      onChange={onChange}
      className="w-full !rounded-none !shadow-none"
    />
  );
}

function CatalogField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      {children}
    </label>
  );
}

function CatalogFilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="group inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-none border border-[color:color-mix(in_srgb,var(--accent-primary)_28%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_8%,var(--bg-surface))] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-primary)]/60 hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
      aria-label={`移除筛选：${label}`}
    >
      <span className="truncate">{label}</span>
      <X
        size={12}
        aria-hidden="true"
        className="shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent-primary)]"
      />
    </button>
  );
}

function getOptionLabel<Value extends string>(
  options: readonly SelectMenuOption<Value>[],
  value: Value
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function CardDetailLoading() {
  return (
    <div className="min-h-[30rem] p-4" aria-label="正在加载卡图详情">
      <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] pb-4">
        <div className="aspect-[.72] w-[5.25rem] animate-pulse bg-[var(--bg-elevated)]" />
        <div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
          <div className="h-3 w-32 animate-pulse bg-[var(--bg-elevated)]" />
          <div className="h-6 w-48 animate-pulse bg-[var(--bg-elevated)]" />
          <div className="h-3 w-40 animate-pulse bg-[var(--bg-elevated)]" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <Loader2 className="animate-spin text-[var(--accent-primary)]" size={14} />
        正在读取对象状态
      </div>
    </div>
  );
}

function CardDetail({
  detail,
  verifying,
  onVerify,
  onClose,
}: {
  detail: CardImageCatalogDetail;
  verifying: boolean;
  onVerify: () => void;
  onClose: () => void;
}) {
  const { card } = detail;
  const [previewFailed, setPreviewFailed] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const availableObjects = detail.objects.filter((object) => object.status === 'AVAILABLE').length;
  const allObjectsAvailable =
    detail.objects.length > 0 && availableObjects === detail.objects.length;
  return (
    <div>
      <div className="border-b border-[var(--border-subtle)] p-4">
        <div className="grid grid-cols-[5.25rem_minmax(0,1fr)] gap-3">
          <div className="aspect-[.72] overflow-hidden border border-[var(--border-default)] bg-[var(--bg-deep)]">
            {card.urls.medium && !previewFailed ? (
              <img
                src={card.urls.medium}
                alt={`${card.name} 卡图预览`}
                className="h-full w-full object-contain"
                onError={() => setPreviewFailed(true)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1.5 bg-[var(--bg-elevated)] p-2 text-center">
                <Images size={18} className="text-[var(--accent-primary)]/70" aria-hidden="true" />
                <span className="text-[9px] text-[var(--text-muted)]">暂无预览</span>
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-[10px] text-[var(--accent-primary)]">
                  {card.cardCode}
                </p>
                <h2 className="mt-1 truncate text-lg font-semibold text-[var(--text-primary)]">
                  {card.name}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="border-l border-[var(--border-default)] pl-2 text-[10px] text-[var(--text-muted)]">
                  {VERSION_LABELS[card.version]}
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭卡牌详情"
                  className="p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
              <span>{getOptionLabel(CARD_TYPE_OPTIONS, card.cardType)}</span>
              <span aria-hidden="true" className="text-[var(--border-default)]">
                /
              </span>
              <span>{getOptionLabel(CARD_STATUS_OPTIONS, card.cardStatus)}</span>
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">
              更新于 {new Date(card.updatedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--border-subtle)] pt-3">
          <div>
            <span className="mr-2 text-[11px] text-[var(--text-muted)]">对象状态</span>
            <span
              className={`text-xs font-semibold ${allObjectsAvailable ? 'text-[var(--semantic-success)]' : 'text-[var(--semantic-warning)]'}`}
            >
              {availableObjects}/{detail.objects.length}
            </span>
          </div>
          <div>
            <span className="mr-2 text-[11px] text-[var(--text-muted)]">文件引用</span>
            <span className="text-xs font-semibold text-[var(--text-primary)]">
              {detail.references.length}
            </span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4">
          {detail.objects
            .filter((object) => object.status === 'AVAILABLE' && object.url)
            .map((object) => (
              <AssetDownloadButton
                key={object.size}
                url={object.url!}
                filename={`${card.cardCode}-${object.size}.webp`}
                label={`下载${OBJECT_SIZE_LABELS[object.size]}`}
                accessibleLabel={`下载${OBJECT_SIZE_LABELS[object.size]} ${card.cardCode}`}
              />
            ))}
        </div>
      </div>
      <div className="border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            aria-expanded={diagnosticsOpen}
            onClick={() => setDiagnosticsOpen((open) => !open)}
            className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--text-primary)]">
                存储诊断
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">
                对象路径、校验状态与文件引用
              </span>
            </span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={`shrink-0 text-[var(--text-muted)] transition-transform ${diagnosticsOpen ? 'rotate-180' : ''}`}
            />
          </button>
          <button
            type="button"
            onClick={onVerify}
            disabled={verifying}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-[var(--border-default)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent-primary)]/60 hover:bg-[var(--bg-elevated)] disabled:opacity-50"
          >
            {verifying ? <Loader2 size={13} className="animate-spin" /> : <FileSearch size={13} />}
            重新检查
          </button>
        </div>
        {diagnosticsOpen ? (
          <div className="px-4 pb-4">
            <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
              {detail.objects.map((object) => (
                <ObjectRow key={object.size} object={object} />
              ))}
            </div>
            <div className="mt-4">
              <p className="text-xs font-semibold text-[var(--text-primary)]">文件引用</p>
              {detail.references.length ? (
                <div className="mt-2 divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
                  {detail.references.map((reference) => (
                    <span
                      key={reference.cardCode}
                      className="flex items-center justify-between gap-3 py-2 text-xs"
                    >
                      <span className="font-mono text-[var(--text-secondary)]">
                        {reference.cardCode}
                      </span>
                      <span className="truncate text-[var(--text-muted)]">{reference.name}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">暂无其他卡牌引用</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ObjectRow({ object }: { object: CardImageObjectCheck }) {
  const good = object.status === 'AVAILABLE';
  return (
    <div className="grid min-w-0 grid-cols-[4.25rem_minmax(0,1fr)] gap-3 py-3 transition-colors hover:bg-[var(--bg-elevated)]/45">
      <div>
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          {OBJECT_SIZE_LABELS[object.size]}
        </span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[10px] text-[var(--text-muted)]">
            {object.objectKey ?? object.message ?? '未生成对象路径'}
          </span>
          <span
            className={`inline-flex shrink-0 items-center gap-1 text-[10px] ${good ? 'text-[var(--semantic-success)]' : object.status === 'MISSING' ? 'text-[var(--semantic-warning)]' : 'text-[var(--semantic-error)]'}`}
          >
            {good ? <Check size={12} /> : <CircleAlert size={12} />}
            {good
              ? object.contentVerified
                ? '已校验'
                : '可读取'
              : object.status === 'MISSING'
                ? '缺失'
                : '失败'}
          </span>
        </div>
        {object.bytes !== null ? (
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            {object.bytes.toLocaleString()} 字节
            {object.width && object.height ? ` · ${object.width}×${object.height}` : ''}
          </p>
        ) : null}
        {object.message ? (
          <p className="mt-1 text-[10px] leading-4 text-[var(--semantic-error)]">
            {object.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default CardImageCatalogPage;
