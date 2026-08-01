import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, Clock3, Loader2, Shuffle, Sparkles, TicketCheck } from 'lucide-react';
import type { ThemePrebuiltDeckView } from '@game/online/theme-table-types';
import { ActionButton, PageHeader, Panel, StatusBadge } from '@/components/common';
import { getCardImageUrl } from '@/lib/imageService';
import { useThemeTableStore } from '@/store/themeTableStore';
import { useGameStore } from '@/store/gameStore';
import './theme-table.css';

const DIFFICULTY_LABEL = {
  BEGINNER: '容易上手',
  INTERMEDIATE: '需要规划',
  ADVANCED: '熟练向',
} as const;

export function ThemeTablePage({ onBack }: { onBack: () => void }) {
  const { overview, loading, error, refresh, join, cancel } = useThemeTableStore();
  const [expandedDeckId, setExpandedDeckId] = useState<string | null>(null);
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);
  if (!overview && loading) {
    return <CenteredState icon={<Loader2 className="animate-spin" />} title="正在读取本期节目单" />;
  }
  if (!overview?.event) {
    return (
      <div className="app-shell min-h-screen">
        <PageHeader title="轮换主题牌桌" onBack={onBack} backLabel="返回大厅" />
        <main className="mx-auto max-w-lg px-4 py-16">
          <Panel padding="spacious" className="text-center">
            <Sparkles className="mx-auto text-[var(--accent-primary)]" />
            <h1 className="mt-3 text-xl font-semibold">下一期主题正在编排</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              当前没有公开活动。你仍可前往公共牌桌使用自己的卡组对战。
            </p>
          </Panel>
        </main>
      </div>
    );
  }
  const { event, availability, queue } = overview;
  const activeQueue = queue.state !== 'IDLE';
  return (
    <div className="app-shell theme-table-page min-h-screen">
      <PageHeader title="轮换主题牌桌" onBack={onBack} backLabel="返回大厅" />
      <main className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-8">
        <section className="theme-table-hero">
          <div className="theme-table-hero__copy">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone={availability.canJoin ? 'success' : 'neutral'}>
                {availability.canJoin ? '正在开放' : availability.message}
              </StatusBadge>
              <span className="text-xs font-semibold text-white/60">非计分活动</span>
            </div>
            <h1>{event.name}</h1>
            <p>{event.summary}</p>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-white/70">
              <span className="inline-flex items-center gap-2">
                <Clock3 size={15} />
                {event.scheduleLabel}
              </span>
              <span className="inline-flex items-center gap-2">
                <Shuffle size={15} />
                确认后随机分配双方位置
              </span>
            </div>
          </div>
          <div className="theme-table-draw" aria-label="从已验证组合中抽取本局双方卡组">
            {event.prebuiltDecks.slice(0, 3).map((deck, index) => (
              <img
                key={deck.id}
                src={getCardImageUrl(deck.mainDeck[0]?.cardCode ?? 'back', 'medium')}
                alt=""
                style={{ '--draw-index': index } as CSSProperties}
              />
            ))}
            <div>
              <TicketCheck size={18} />
              <span>审核组合</span>
            </div>
          </div>
        </section>

        <Panel
          padding="compact"
          className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <div className="font-semibold text-[var(--text-primary)]">
              {activeQueue ? (queue.deckName ?? '卡组尚未揭晓') : availability.message}
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              不使用个人卡组；系统先抽取已测试的对局组合，再以相同概率交换双方卡组。
            </p>
          </div>
          {activeQueue ? (
            <ActionButton
              variant="secondary"
              disabled={loading || queue.state === 'CREATING_ROOM'}
              onClick={() => void cancel()}
            >
              退出候场
            </ActionButton>
          ) : (
            <ActionButton disabled={!availability.canJoin || loading} onClick={() => void join()}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              加入主题牌桌
            </ActionButton>
          )}
        </Panel>
        {error ? <p className="mt-3 text-sm text-[var(--semantic-error)]">{error}</p> : null}

        <section className="mt-8">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold text-[var(--accent-primary)]">本期预组池</p>
              <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
                {event.prebuiltDecks.length} 副公开卡组
              </h2>
            </div>
            <span className="text-xs text-[var(--text-muted)]">完整卡表可展开查看</span>
          </div>
          <div className="theme-deck-grid">
            {event.prebuiltDecks.map((deck) => (
              <ThemeDeckCard
                key={deck.id}
                deck={deck}
                expanded={expandedDeckId === deck.id}
                onToggle={() => setExpandedDeckId(expandedDeckId === deck.id ? null : deck.id)}
              />
            ))}
          </div>
        </section>
        <Panel padding="compact" className="mt-8 text-sm leading-6 text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">本期说明：</strong> {event.announcement}
        </Panel>
      </main>
    </div>
  );
}

function ThemeDeckCard({
  deck,
  expanded,
  onToggle,
}: {
  deck: ThemePrebuiltDeckView;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`theme-deck-card ${expanded ? 'is-expanded' : ''}`}>
      <button
        type="button"
        className="theme-deck-card__summary"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <img src={getCardImageUrl(deck.mainDeck[0]?.cardCode ?? 'back', 'thumb')} alt="" />
        <div className="min-w-0 flex-1">
          <h3>{deck.displayName}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span>{DIFFICULTY_LABEL[deck.difficulty]}</span>
            {deck.playStyleTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          <p className="mt-3">{deck.sourceLabel}</p>
        </div>
        <ChevronDown size={18} className="theme-deck-card__chevron" />
      </button>
      {expanded ? (
        <div className="theme-deck-card__list">
          <DeckEntries title="主卡组" entries={deck.mainDeck} />
          <DeckEntries title="能量" entries={deck.energyDeck} />
          {deck.sourceUrl ? (
            <a
              className="text-sm font-semibold text-[var(--accent-primary)]"
              href={deck.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              查看锁组 / DeckLog 来源
            </a>
          ) : null}
          <p>卡表版本 {deck.contentHash.slice(0, 12)}</p>
        </div>
      ) : null}
    </article>
  );
}

function DeckEntries({
  title,
  entries,
}: {
  title: string;
  entries: readonly { cardCode: string; count: number }[];
}) {
  const getCardData = useGameStore((state) => state.getCardData);
  return (
    <div>
      <h4>{title}</h4>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entries.map((entry) => {
          const card = getCardData(entry.cardCode);
          return (
            <span key={entry.cardCode}>
              {entry.count}× {entry.cardCode}
              {card?.name ? `「${card.name}」` : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function CenteredState({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="app-shell flex min-h-screen items-center justify-center">
      <div className="text-center text-[var(--text-secondary)]">
        {icon}
        <p className="mt-3">{title}</p>
      </div>
    </div>
  );
}
