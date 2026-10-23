import { casualPointSummary } from '@/lib/casualRules';
import type { CasualRuleMode } from '@game/online/casual-table-types';
import { useTextPresentation } from '@/lib/appPresentation';
import { ExcelDeckSelector } from '@/components/excel/ExcelDeckSelector';
import { PresentationImage } from '@/components/excel/PresentationRoot';
import { useMemo } from 'react';
import { Check, Database, History, Layers3, RefreshCw, TriangleAlert } from 'lucide-react';
import type { DeckRecord } from '@/lib/apiClient';
import { useGameStore } from '@/store/gameStore';
import {
  createDeckRecordCardTypeResolver,
  isDeckConfigValidForCurrentCardPool,
  isDeckRecordValidForCurrentCardPool,
} from '@/lib/deckRecordUtils';
import { buildDeckDisplayItems, type DeckDisplayItem, type LocalDeck } from '@/lib/deckDisplay';
import { useDeckPointTableRules, useDeckPointTableDisplayReady } from '@/hooks/useDeckPointTable';

export type { DeckDisplayItem, LocalDeck };

type DeckSelectorDensity = 'comfortable' | 'compact';

interface DeckSelectorProps {
  ruleMode?: CasualRuleMode;
  onSwitchToUnlimited?: () => void;
  cloudDecks?: DeckRecord[];
  localDecks?: LocalDeck[];
  selectedId?: string | null;
  onSelect: (deck: DeckDisplayItem) => void;
  isLoading?: boolean;
  isRefreshing?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  title?: string;
  subtitle?: string;
  emptyText?: string;
  density?: DeckSelectorDensity;
  lastUsedDeckId?: string | null;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}

export function DeckSelector({
  ruleMode = 'NORMAL',
  onSwitchToUnlimited,
  cloudDecks = [],
  localDecks = [],
  selectedId,
  onSelect,
  isLoading = false,
  isRefreshing = false,
  error = null,
  onRefresh,
  title = '选择卡组',
  subtitle = '',
  emptyText = '还没有可用卡组。',
  density = 'comfortable',
  lastUsedDeckId = null,
  emptyActionLabel,
  onEmptyAction,
}: DeckSelectorProps) {
  const textOnly = useTextPresentation();
  const isCompact = density === 'compact';
  const pointTable = useDeckPointTableRules();
  const pointTableDisplayReady = useDeckPointTableDisplayReady();
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const getCardImagePath = useGameStore((state) => state.getCardImagePath);
  const resolveDeckRecordCardType = useMemo(
    () => createDeckRecordCardTypeResolver(cardDataRegistry),
    [cardDataRegistry]
  );
  const displayDecks = useMemo(
    () =>
      buildDeckDisplayItems({
        cloudDecks,
        localDecks,
        resolveDeckRecordCardType,
        pointTable,
        ruleMode,
        validateLocalDeck: (deck) =>
          isDeckConfigValidForCurrentCardPool(deck, cardDataRegistry, pointTable, ruleMode),
      }).map((deck) => ({
        ...deck,
        isValid: deck.cloudDeck
          ? isDeckRecordValidForCurrentCardPool(
              deck.cloudDeck,
              cardDataRegistry,
              pointTable,
              ruleMode
            )
          : deck.isValid,
      })),
    [ruleMode, cardDataRegistry, cloudDecks, localDecks, pointTable, resolveDeckRecordCardType]
  );
  const entertainmentOnly =
    ruleMode === 'NORMAL'
      ? displayDecks.filter(
          (deck) =>
            !deck.isValid &&
            (deck.cloudDeck
              ? isDeckRecordValidForCurrentCardPool(
                  deck.cloudDeck,
                  cardDataRegistry,
                  pointTable,
                  'UNLIMITED'
                )
              : deck.localDeck &&
                isDeckConfigValidForCurrentCardPool(
                  deck.localDeck.config,
                  cardDataRegistry,
                  pointTable,
                  'UNLIMITED'
                ))
        )
      : [];
  const selectableDecks = useMemo(
    () =>
      displayDecks
        .filter((deck) => deck.isValid)
        .sort((first, second) => {
          if (first.id === lastUsedDeckId) return -1;
          if (second.id === lastUsedDeckId) return 1;
          return second.updatedAt.getTime() - first.updatedAt.getTime();
        }),
    [displayDecks, lastUsedDeckId]
  );

  if (textOnly)
    return (
      <ExcelDeckSelector
        decks={displayDecks}
        selectedId={selectedId}
        onSelect={onSelect}
        title={title}
        error={error}
        loading={isLoading || isRefreshing}
        onRefresh={onRefresh}
        emptyText={emptyText}
        emptyActionLabel={emptyActionLabel}
        onEmptyAction={onEmptyAction}
      />
    );

  return (
    <section
      className="surface-panel-frosted flex h-full flex-col overflow-hidden"
      aria-label={title}
    >
      <div
        className={`flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] ${
          isCompact ? 'px-4 py-3' : 'px-5 py-4'
        }`}
      >
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">{subtitle}</p>
          )}
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading || isRefreshing}
            className="button-icon h-9 w-9 shrink-0 disabled:opacity-50"
            aria-label="刷新卡组"
          >
            <RefreshCw size={16} className={isLoading || isRefreshing ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      <div className={`cute-scrollbar flex-1 overflow-y-auto ${isCompact ? 'p-3' : 'p-4'}`}>
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_8%,transparent)] p-3 text-sm text-[var(--semantic-error)]">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isLoading && selectableDecks.length === 0 && (
          <div className="flex items-center justify-center py-12 text-center">
            <RefreshCw
              size={26}
              className="animate-spin text-[var(--accent-primary)]"
              aria-label="正在读取卡组"
            />
          </div>
        )}

        {!isLoading && !error && selectableDecks.length === 0 && (
          <div className="flex items-center justify-center py-12 text-center">
            <div>
              <Database size={32} className="mx-auto mb-3 text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-secondary)]">{emptyText}</p>
              {emptyActionLabel && onEmptyAction && (
                <button
                  type="button"
                  onClick={onEmptyAction}
                  className="button-primary mt-4 min-h-10 px-4 py-2 text-sm font-semibold"
                >
                  {emptyActionLabel}
                </button>
              )}
            </div>
          </div>
        )}

        <div
          className={
            selectableDecks.length === 1
              ? 'mx-auto grid max-w-[280px] grid-cols-1 gap-3'
              : 'grid grid-cols-2 gap-3 sm:grid-cols-3'
          }
        >
          {selectableDecks.map((deck) => {
            const isSelected = selectedId === deck.id;
            const isLastUsed = deck.id === lastUsedDeckId;

            return (
              <button
                key={deck.id}
                type="button"
                onClick={() => onSelect(deck)}
                aria-pressed={isSelected}
                aria-label={`${deck.name}${isLastUsed ? '，上次使用' : ''}`}
                className={`group overflow-hidden rounded-xl border text-left outline-none transition-[border-color,background-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-deep)] ${
                  isSelected
                    ? 'border-[var(--accent-primary)] bg-[color:color-mix(in_srgb,var(--accent-primary)_7%,var(--bg-surface))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_18%,transparent)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:-translate-y-0.5 hover:border-[var(--border-default)] hover:shadow-[var(--shadow-sm)]'
                }`}
              >
                <div
                  className={`relative overflow-hidden bg-[color:color-mix(in_srgb,var(--accent-primary)_8%,var(--bg-overlay))] ${
                    isCompact ? 'aspect-[8/5]' : 'aspect-[7/4]'
                  }`}
                >
                  {deck.previewCardCodes.length > 0 ? (
                    <div
                      className="grid h-full"
                      style={{
                        gridTemplateColumns: `repeat(${deck.previewCardCodes.length}, minmax(0, 1fr))`,
                      }}
                    >
                      {deck.previewCardCodes.map((cardCode) => (
                        <PresentationImage
                          key={cardCode}
                          src={getCardImagePath(cardCode)}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover object-top"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-[var(--text-muted)]">
                      <Layers3 size={28} />
                    </div>
                  )}

                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-black/10" />

                  {isLastUsed && (
                    <span
                      className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm"
                      title="上次使用"
                    >
                      <History size={14} />
                    </span>
                  )}

                  <span
                    className={`absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-sm ${
                      isSelected
                        ? 'border-white/80 bg-[var(--accent-primary)] text-white'
                        : 'border-white/80 bg-white/55 text-transparent'
                    }`}
                    aria-hidden="true"
                  >
                    <Check size={15} strokeWidth={3} />
                  </span>
                </div>

                <div className={`${isCompact ? 'px-3 py-2.5' : 'px-3.5 py-3'}`}>
                  <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {deck.name}
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {pointTableDisplayReady
                      ? casualPointSummary(deck.pointTotal, pointTable.pointLimit, ruleMode)
                      : 'PT 暂无法读取'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        {entertainmentOnly.length > 0 && (
          <section
            className="mt-4 border-t border-[var(--border-subtle)] pt-3"
            aria-label="娱乐模式可用卡组"
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">娱乐模式可用</h3>
            {entertainmentOnly.map((deck) => (
              <p key={deck.id} className="mt-2 text-sm text-[var(--text-secondary)]">
                {deck.name} · {deck.pointTotal} PT，超过标准模式上限 {pointTable.pointLimit} PT
              </p>
            ))}
            {onSwitchToUnlimited && (
              <button type="button" className="button-secondary mt-3" onClick={onSwitchToUnlimited}>
                切换娱乐模式
              </button>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
