import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Filter, ScrollText, X } from 'lucide-react';
import { useGameStore } from '@/store/gameStore';
import {
  formatPublicBattleLogEvents,
  type PublicBattleLogCardGroupView,
  type PublicBattleLogCardView,
  type PublicBattleLogFilter,
} from '@/lib/publicBattleLogFormatter';
import { cn } from '@/lib/utils';

interface PublicBattleLogContentProps {
  readonly active?: boolean;
}

export const PublicBattleLogButton = memo(function PublicBattleLogButton() {
  const canShowPublicBattleLog = useGameStore(
    (s) => s.getBattleSurfaceCapabilities().authority === 'REMOTE'
  );
  const unreadCount = useGameStore((s) => s.publicBattleLog.unreadCount);
  const isOpen = useGameStore((s) => s.publicBattleLog.isPanelOpen);
  const setOpen = useGameStore((s) => s.setPublicBattleLogPanelOpen);

  if (!canShowPublicBattleLog) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(!isOpen)}
      className="button-ghost relative inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 shadow-[var(--shadow-md)] backdrop-blur-xl"
      aria-label="对局日志"
      title="对局日志"
    >
      <ScrollText size={16} />
      <span className="hidden text-sm font-semibold sm:inline">对局日志</span>
      {unreadCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-[var(--semantic-error)] px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-white shadow">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
});

export const PublicBattleLogPanel = memo(function PublicBattleLogPanel() {
  const canShowPublicBattleLog = useGameStore(
    (s) => s.getBattleSurfaceCapabilities().authority === 'REMOTE'
  );
  const isOpen = useGameStore((s) => s.publicBattleLog.isPanelOpen);
  const setOpen = useGameStore((s) => s.setPublicBattleLogPanelOpen);

  if (!canShowPublicBattleLog) {
    return null;
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.18 }}
          className="fixed bottom-4 left-4 top-20 z-[115] hidden w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-frosted)] shadow-[var(--shadow-lg)] backdrop-blur-xl md:flex"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <ScrollText size={16} className="text-[var(--accent-primary)]" />
              <span className="truncate text-sm font-bold text-[var(--text-primary)]">
                对局日志
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="button-icon h-8 w-8 shrink-0"
              aria-label="关闭对局日志"
              title="关闭"
            >
              <X size={15} />
            </button>
          </div>
          <PublicBattleLogContent active={isOpen} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
});

export const PublicBattleLogContent = memo(function PublicBattleLogContent({
  active = true,
}: PublicBattleLogContentProps) {
  const events = useGameStore((s) => s.publicBattleLog.events);
  const loadState = useGameStore((s) => s.publicBattleLog.loadState);
  const error = useGameStore((s) => s.publicBattleLog.error);
  const getCardData = useGameStore((s) => s.getCardData);
  const getPlayerIdentityForSeat = useGameStore((s) => s.getPlayerIdentityForSeat);
  const viewerSeat = useGameStore((s) => s.playerViewState?.match.viewerSeat ?? null);
  const setCardDetail = useGameStore((s) => s.setCardDetail);
  const [filter, setFilter] = useState<PublicBattleLogFilter>('KEY');
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () =>
      formatPublicBattleLogEvents(events, {
        filter,
        getCardData,
        getSeatLabel: (seat) => getPlayerIdentityForSeat(seat)?.name ?? seat,
        viewerSeat,
      }),
    [events, filter, getCardData, getPlayerIdentityForSeat, viewerSeat]
  );

  useEffect(() => {
    if (scrollRef.current && active) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items.length, active]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="inline-flex rounded border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_70%,transparent)] p-0.5">
          {(['KEY', 'ALL'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                'min-h-8 rounded px-2.5 text-xs font-semibold transition-colors',
                filter === value
                  ? 'bg-[var(--accent-primary)] text-[var(--bg-base)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              {value === 'KEY' ? '关键' : '全部'}
            </button>
          ))}
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <Filter size={13} />
          {items.length}/{events.length}
        </span>
      </div>

      <div ref={scrollRef} className="cute-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {items.map((item) => {
          const expanded = expandedEventIds.has(item.id);
          const visibleCardGroups = item.cardGroups.slice(0, 3);
          const visibleGroupedCardCount = visibleCardGroups.reduce(
            (total, group) => total + group.count,
            0
          );
          const hiddenPublicCardCount = expanded ? 0 : item.cards.length - visibleGroupedCardCount;
          const showCardArea = item.cards.length > 0 || item.hiddenCardCount > 0;

          return (
            <div
              key={item.id}
              className="rounded-md border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_74%,transparent)] p-2"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-muted)]">
                  #{item.seqLabel}
                </span>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {new Date(item.timestamp).toLocaleTimeString('zh-CN', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              </div>
              <div className="line-clamp-2 text-xs font-semibold leading-snug text-[var(--text-primary)]">
                {item.title}
              </div>
              {item.detail && (
                <div className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                  {item.detail}
                </div>
              )}
              {showCardArea && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {expanded
                    ? item.cards.map((card) => (
                        <PublicBattleLogCardChip
                          key={`${item.id}:${card.publicObjectId}`}
                          card={card}
                          onOpen={() =>
                            setCardDetail({
                              kind: 'public-event-card',
                              cardCode: card.cardCode,
                              publicObjectId: card.publicObjectId,
                            })
                          }
                        />
                      ))
                    : visibleCardGroups.map((group) => (
                        <PublicBattleLogCardGroupChip
                          key={`${item.id}:group:${group.id}`}
                          group={group}
                          onOpen={() => {
                            if (group.count > 1 || item.cardGroups.length > 3) {
                              setExpandedEventIds((previous) => {
                                const next = new Set(previous);
                                next.add(item.id);
                                return next;
                              });
                              return;
                            }
                            const card = group.cards[0];
                            if (!card) {
                              return;
                            }
                            setCardDetail({
                              kind: 'public-event-card',
                              cardCode: card.cardCode,
                              publicObjectId: card.publicObjectId,
                            });
                          }}
                        />
                      ))}
                  {item.hiddenCardCount > 0 && (
                    <span className="inline-flex min-h-8 items-center rounded border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_34%,transparent)] px-2 py-1 text-[11px] font-semibold text-[var(--text-muted)]">
                      身份未公开{item.hiddenCardCount > 1 ? ` ×${item.hiddenCardCount}` : ''}
                    </span>
                  )}
                  {hiddenPublicCardCount > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedEventIds((previous) => {
                          const next = new Set(previous);
                          next.add(item.id);
                          return next;
                        })
                      }
                      className="min-h-9 rounded border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                      另有 {hiddenPublicCardCount} 张
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="py-8 text-center text-sm text-[var(--text-muted)]">
            {loadState === 'loading'
              ? '正在读取公开日志'
              : filter === 'KEY'
                ? '暂无关键公开事件'
                : '暂无公开日志'}
          </div>
        )}
        {loadState === 'error' && error && (
          <div className="rounded border border-[color:color-mix(in_srgb,var(--semantic-error)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-2 text-xs text-[var(--semantic-error)]">
            {error}
          </div>
        )}
      </div>
    </div>
  );
});

function PublicBattleLogCardGroupChip({
  group,
  onOpen,
}: {
  readonly group: PublicBattleLogCardGroupView;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="min-h-9 max-w-full rounded border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_48%,transparent)] px-2 py-1 text-left text-[11px] leading-tight transition hover:border-[var(--accent-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
    >
      <span className="flex max-w-[15rem] items-baseline gap-1.5 overflow-hidden">
        <span className="shrink-0 font-semibold text-[var(--text-muted)]">{group.cardCode}</span>
        <span className="min-w-0 truncate font-bold text-[var(--text-primary)]">
          「{group.name}」
        </span>
        {group.count > 1 && (
          <span className="shrink-0 font-bold text-[var(--accent-primary)]">×{group.count}</span>
        )}
      </span>
    </button>
  );
}

function PublicBattleLogCardChip({
  card,
  onOpen,
}: {
  readonly card: PublicBattleLogCardView;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="min-h-9 max-w-full rounded border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_48%,transparent)] px-2 py-1 text-left text-[11px] leading-tight transition hover:border-[var(--accent-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
    >
      <span className="flex max-w-[15rem] items-baseline gap-1.5 overflow-hidden">
        <span className="shrink-0 font-semibold text-[var(--text-muted)]">{card.cardCode}</span>
        <span className="min-w-0 truncate font-bold text-[var(--text-primary)]">
          「{card.name}」
        </span>
      </span>
    </button>
  );
}

export default PublicBattleLogPanel;
