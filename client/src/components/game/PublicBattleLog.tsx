import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Filter, ScrollText, X } from 'lucide-react';
import { useGameStore } from '@/store/gameStore';
import {
  formatPublicBattleLogEvent,
  isKeyPublicBattleLogEvent,
  type PublicBattleLogFilter,
} from '@/lib/publicBattleLogFormatter';
import { cn } from '@/lib/utils';

interface PublicBattleLogContentProps {
  readonly active?: boolean;
}

export const PublicBattleLogButton = memo(function PublicBattleLogButton() {
  const unreadCount = useGameStore((s) => s.publicBattleLog.unreadCount);
  const isOpen = useGameStore((s) => s.publicBattleLog.isPanelOpen);
  const setOpen = useGameStore((s) => s.setPublicBattleLogPanelOpen);

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
  const isOpen = useGameStore((s) => s.publicBattleLog.isPanelOpen);
  const setOpen = useGameStore((s) => s.setPublicBattleLogPanelOpen);

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
  const setCardDetail = useGameStore((s) => s.setCardDetail);
  const [filter, setFilter] = useState<PublicBattleLogFilter>('KEY');
  const [expandedEventIds, setExpandedEventIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () =>
      events
        .filter((event) => filter === 'ALL' || isKeyPublicBattleLogEvent(event))
        .map((event) =>
          formatPublicBattleLogEvent(event, {
            getCardData,
            getSeatLabel: (seat) => getPlayerIdentityForSeat(seat)?.name ?? seat,
          })
        ),
    [events, filter, getCardData, getPlayerIdentityForSeat]
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
          const visibleCards = expanded ? item.cards : item.cards.slice(0, 3);
          const hiddenCount = item.cards.length - visibleCards.length;

          return (
            <div
              key={item.id}
              className="rounded-md border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_74%,transparent)] p-2"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-normal text-[var(--text-muted)]">
                  #{item.seq}
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
              <div className="text-xs font-semibold leading-snug text-[var(--text-primary)]">
                {item.title}
              </div>
              {item.detail && (
                <div className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                  {item.detail}
                </div>
              )}
              {visibleCards.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {visibleCards.map((card) => (
                    <button
                      key={`${item.id}:${card.publicObjectId}`}
                      type="button"
                      onClick={() =>
                        setCardDetail({
                          kind: 'public-event-card',
                          cardCode: card.cardCode,
                          publicObjectId: card.publicObjectId,
                        })
                      }
                      className="min-h-9 max-w-full rounded border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_48%,transparent)] px-2 py-1 text-left text-[11px] font-semibold leading-tight text-[var(--accent-primary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
                    >
                      <span className="block max-w-[15rem] truncate">{card.label}</span>
                    </button>
                  ))}
                  {hiddenCount > 0 && (
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
                      展开 {hiddenCount} 张
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

export default PublicBattleLogPanel;
