import { casualPointSummary } from '@/lib/casualRules';
import type { CasualRuleMode } from '@game/online/casual-table-types';
import { useTextPresentation } from '@/lib/appPresentation';
import { ExcelDeckSelector } from '@/components/excel/ExcelDeckSelector';
import { PresentationImage } from '@/components/excel/PresentationRoot';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Database, History, Layers3, RefreshCw } from 'lucide-react';
import { ActionButton, TextInput } from './VisualPrimitives';
import { EmptyState, ErrorNotice, LoadingState } from './AsyncFeedback';
import type { DeckRecord } from '@/lib/apiClient';
import { useGameStore } from '@/store/gameStore';
import {
  createDeckRecordCardTypeResolver,
  createDeckRecordCardDataTypeResolver,
  normalizeDeckRecordPayload,
  isDeckConfigValidForCurrentCardPool,
  isDeckRecordValidForCurrentCardPool,
} from '@/lib/deckRecordUtils';
import { buildDeckDisplayItems, type DeckDisplayItem, type LocalDeck } from '@/lib/deckDisplay';
import { useDeckPointTableRules, useDeckPointTableDisplayReady } from '@/hooks/useDeckPointTable';
import { validateDeckConfig } from '@game/domain/rules/deck-construction';
import './deck-selector.css';

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
  layout?: 'grid' | 'list';
  autoFocusSelection?: boolean;
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
  layout = 'grid',
  autoFocusSelection = false,
  lastUsedDeckId = null,
  emptyActionLabel,
  onEmptyAction,
}: DeckSelectorProps) {
  const textOnly = useTextPresentation();
  const isCompact = density === 'compact';
  const isList = layout === 'list';
  const [search, setSearch] = useState('');
  const sectionRef = useRef<HTMLElement>(null);
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
      }).map((deck) => {
        const result = deck.cloudDeck
          ? normalizeDeckRecordPayload(
              deck.cloudDeck,
              createDeckRecordCardDataTypeResolver(cardDataRegistry),
              pointTable,
              ruleMode
            )
          : null;
        return {
          ...deck,
          isValid: result
            ? result.sourceErrors.length === 0 && result.validation.valid
            : deck.isValid,
          unavailableReasons: result
            ? [...result.sourceErrors, ...result.validation.errors]
            : deck.localDeck
              ? validateDeckConfig(deck.localDeck.config, pointTable, ruleMode).errors
              : [],
        };
      }),
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
  const query = search.trim().toLocaleLowerCase();
  const matchingDecks = selectableDecks.filter((deck) =>
    deck.name.toLocaleLowerCase().includes(query)
  );
  const unavailableDecks = displayDecks.filter(
    (deck) => !deck.isValid && deck.name.toLocaleLowerCase().includes(query)
  );
  useEffect(() => {
    if (!autoFocusSelection || textOnly) return;
    const section = sectionRef.current;
    const selected = section?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    const fallback = section?.querySelector<HTMLElement>('input, button[data-deck-choice]');
    (selected ?? fallback)?.focus({ preventScroll: true });
  }, [autoFocusSelection, textOnly]);

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
      ref={sectionRef}
      className={
        isList ? 'deck-selector-list' : 'surface-panel-frosted flex h-full flex-col overflow-hidden'
      }
      aria-label={title}
    >
      <div
        className={`flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] ${
          isCompact ? 'px-4 py-3' : 'px-5 py-4'
        }`}
      >
        <div className="min-w-0">
          {isList ? (
            <p className="deck-selector-count">{selectableDecks.length} 副可用卡组</p>
          ) : (
            <h2 className="truncate text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          )}
          {subtitle && (
            <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">{subtitle}</p>
          )}
        </div>
        {onRefresh && (
          <ActionButton
            variant="icon"
            onClick={onRefresh}
            disabled={isLoading || isRefreshing}
            className="shrink-0"
            aria-label="刷新卡组"
          >
            <RefreshCw size={16} className={isLoading || isRefreshing ? 'animate-spin' : ''} />
          </ActionButton>
        )}
      </div>

      {isList && displayDecks.length >= 6 && (
        <label className="deck-selector-search">
          <span>搜索卡组</span>
          <TextInput
            type="search"
            value={search}
            placeholder="输入卡组名称"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault();
            }}
          />
        </label>
      )}
      <div
        className={
          isList
            ? 'deck-selector-list-content'
            : `cute-scrollbar flex-1 overflow-y-auto ${isCompact ? 'p-3' : 'p-4'}`
        }
      >
        {error && (
          <ErrorNotice
            className="mb-3"
            message={error}
            onRetry={onRefresh}
            retryDisabled={isLoading || isRefreshing}
          />
        )}

        {isLoading && selectableDecks.length === 0 && (
          <LoadingState label="正在读取卡组" className="py-12" />
        )}

        {!isLoading && !error && selectableDecks.length === 0 && (
          <EmptyState
            title={emptyText}
            icon={<Database size={32} />}
            className="py-12"
            action={
              emptyActionLabel && onEmptyAction ? (
                <ActionButton onClick={onEmptyAction}>{emptyActionLabel}</ActionButton>
              ) : undefined
            }
          />
        )}

        {isList && query && matchingDecks.length === 0 && unavailableDecks.length === 0 && (
          <p className="deck-selector-no-results" role="status">
            没有找到匹配的卡组，试试其他名称。
          </p>
        )}
        <div
          className={
            isList
              ? 'deck-selector-rows'
              : selectableDecks.length === 1
                ? 'mx-auto grid max-w-[280px] grid-cols-1 gap-3'
                : 'grid grid-cols-2 gap-3 sm:grid-cols-3'
          }
        >
          {(isList ? matchingDecks : selectableDecks).map((deck) => {
            const isSelected = selectedId === deck.id;
            const isLastUsed = deck.id === lastUsedDeckId;

            return (
              <button
                key={deck.id}
                type="button"
                onClick={() => onSelect(deck)}
                aria-pressed={isSelected}
                aria-label={`${deck.name}${isLastUsed ? '，上次使用' : ''}`}
                data-deck-choice
                className={
                  isList
                    ? `deck-selector-row${isSelected ? ' is-selected' : ''}`
                    : `group overflow-hidden rounded-xl border text-left outline-none transition-[border-color,background-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-deep)] ${
                        isSelected
                          ? 'border-[var(--accent-primary)] bg-[color:color-mix(in_srgb,var(--accent-primary)_7%,var(--bg-surface))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_18%,transparent)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:-translate-y-0.5 hover:border-[var(--border-default)] hover:shadow-[var(--shadow-sm)]'
                      }`
                }
              >
                {isList ? (
                  <>
                    {deck.previewCardCodes[0] ? (
                      <PresentationImage
                        src={getCardImagePath(deck.previewCardCodes[0])}
                        alt=""
                        loading="lazy"
                        className="deck-selector-thumbnail"
                      />
                    ) : (
                      <span className="deck-selector-thumbnail deck-selector-placeholder">
                        <Layers3 size={22} />
                      </span>
                    )}
                    <span className="deck-selector-row-copy">
                      <span className="deck-selector-name" title={deck.name}>
                        {deck.name}
                      </span>
                      <span className="deck-selector-meta">
                        {pointTableDisplayReady
                          ? casualPointSummary(deck.pointTotal, pointTable.pointLimit, ruleMode)
                          : 'PT 暂无法读取'}
                        {isLastUsed && <span> · 上次使用</span>}
                      </span>
                    </span>
                    <span className="deck-selector-selection" aria-hidden="true">
                      {isSelected && <Check size={16} />}
                    </span>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </button>
            );
          })}
        </div>
        {isList && unavailableDecks.length > 0 && (
          <details className="deck-selector-unavailable">
            <summary>不可用卡组（{unavailableDecks.length}）</summary>
            <ul>
              {unavailableDecks.map((deck) => (
                <li key={deck.id}>
                  <strong>{deck.name}</strong>
                  <ul>
                    {(deck.unavailableReasons.length
                      ? deck.unavailableReasons
                      : ['包含当前卡池中不可用的卡牌']
                    ).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {onEmptyAction && (
              <button type="button" className="button-secondary" onClick={onEmptyAction}>
                {emptyActionLabel ?? '管理卡组'}
              </button>
            )}
          </details>
        )}
        {!isList && entertainmentOnly.length > 0 && (
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
        {isList && entertainmentOnly.length > 0 && onSwitchToUnlimited && (
          <div className="deck-selector-mode-hint">
            <p>{entertainmentOnly.length} 副卡组超过标准模式 PT 上限，可在娱乐模式使用。</p>
            <button type="button" className="button-secondary" onClick={onSwitchToUnlimited}>
              切换娱乐模式
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
