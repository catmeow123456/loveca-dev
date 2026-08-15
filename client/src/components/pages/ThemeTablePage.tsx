import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BookOpen,
  Clock3,
  ExternalLink,
  Loader2,
  Shuffle,
  Sparkles,
  TicketCheck,
} from 'lucide-react';
import type { ThemeDeckListEntryView, ThemePrebuiltDeckView } from '@game/online/theme-table-types';
import { isLiveCardData, isMemberCardData, type AnyCardData } from '@game/domain/entities/card';
import { ActionButton, PageHeader, Panel, StatusBadge } from '@/components/common';
import { CardDetailDrawer } from '@/components/deck-editor/CardDetailDrawer';
import { getCardImageUrl, resolveCardImagePath } from '@/lib/imageService';
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
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<AnyCardData | null>(null);
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
  const { event, availability, player, queue } = overview;
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
              <span className="text-xs font-semibold text-white/60">记录胜负 · 不计分</span>
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

        <Panel padding="compact" className="theme-table-entry-panel mt-4">
          <div className="theme-table-entry-panel__main">
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
          </div>
          <div
            className="theme-table-season-record"
            aria-label={`本期战绩 ${player?.wins ?? 0} 胜 ${player?.losses ?? 0} 负`}
          >
            <span className="theme-table-season-record__label">本期战绩</span>
            <strong>
              {player?.wins ?? 0} 胜 <i aria-hidden="true">·</i> {player?.losses ?? 0} 负
            </strong>
            <span>
              {player && player.completedMatches > 0
                ? `共 ${player.completedMatches} 局${player.draws > 0 ? ` · ${player.draws} 平` : ''} · 胜率 ${Math.round((player.winRate ?? 0) * 100)}%`
                : '完成首局后更新'}
            </span>
          </div>
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
            <span className="text-xs text-[var(--text-muted)]">选择卡组，点击卡图查看详情</span>
          </div>
          <ThemeDeckBrowser
            decks={event.prebuiltDecks}
            selectedDeckId={selectedDeckId}
            onSelectDeck={setSelectedDeckId}
            onViewCard={setSelectedCard}
          />
        </section>
        <Panel padding="compact" className="mt-8 text-sm leading-6 text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">本期说明：</strong> {event.announcement}
        </Panel>
      </main>
      <CardDetailDrawer card={selectedCard} onClose={() => setSelectedCard(null)} />
    </div>
  );
}

function ThemeDeckBrowser({
  decks,
  selectedDeckId,
  onSelectDeck,
  onViewCard,
}: {
  decks: readonly ThemePrebuiltDeckView[];
  selectedDeckId: string | null;
  onSelectDeck: (deckId: string) => void;
  onViewCard: (card: AnyCardData) => void;
}) {
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const selectedDeck = decks.find((deck) => deck.id === selectedDeckId) ?? decks[0];

  if (!selectedDeck) {
    return (
      <div className="theme-deck-browser theme-deck-browser--empty">本期尚未公开预组卡表。</div>
    );
  }

  return (
    <div className="theme-deck-browser">
      <nav className="theme-deck-browser__selector" aria-label="本期预组卡组">
        {decks.map((deck) => {
          const selected = deck.id === selectedDeck.id;
          const previewEntries = [...deck.mainDeck, ...deck.energyDeck].slice(0, 3);
          return (
            <button
              key={deck.id}
              type="button"
              className={`theme-deck-option ${selected ? 'is-selected' : ''}`}
              aria-pressed={selected}
              aria-controls="theme-deck-sheet"
              onClick={() => onSelectDeck(deck.id)}
            >
              <span className="theme-deck-option__preview" aria-hidden="true">
                {previewEntries.map((entry, index) => (
                  <img
                    key={`${entry.cardCode}-${index}`}
                    src={resolveCardImagePath(cardDataRegistry.get(entry.cardCode), 'thumb')}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={
                      {
                        '--preview-offset': `${index * 8}px`,
                        '--preview-rotation': `${(index - 1) * 5}deg`,
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
              <span className="theme-deck-option__copy">
                <strong>{deck.displayName}</strong>
                <span>
                  {[DIFFICULTY_LABEL[deck.difficulty], ...deck.playStyleTags].join(' · ')}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <article
        id="theme-deck-sheet"
        className="theme-deck-sheet"
        aria-label={`${selectedDeck.displayName}完整卡表`}
      >
        <header className="theme-deck-sheet__header">
          <div>
            <div className="theme-deck-sheet__eyebrow">
              <BookOpen size={14} aria-hidden="true" /> 当前卡组卡册
            </div>
            <h3>{selectedDeck.displayName}</h3>
            <p>{selectedDeck.sourceLabel}</p>
          </div>
          <div className="theme-deck-sheet__tags" aria-label="卡组标签">
            <span>{DIFFICULTY_LABEL[selectedDeck.difficulty]}</span>
            {selectedDeck.playStyleTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </header>

        <ThemeDeckGallery deck={selectedDeck} onViewCard={onViewCard} />

        <footer className="theme-deck-sheet__footer">
          {selectedDeck.sourceUrl ? (
            <a href={selectedDeck.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={13} aria-hidden="true" />
              查看锁组 / DeckLog 来源
            </a>
          ) : null}
          <span>卡表版本 {selectedDeck.contentHash.slice(0, 12)}</span>
        </footer>
      </article>
    </div>
  );
}

function ThemeDeckGallery({
  deck,
  onViewCard,
}: {
  deck: ThemePrebuiltDeckView;
  onViewCard: (card: AnyCardData) => void;
}) {
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const sections = useMemo(() => {
    const members: ThemeDeckListEntryView[] = [];
    const lives: ThemeDeckListEntryView[] = [];
    const otherMain: ThemeDeckListEntryView[] = [];

    deck.mainDeck.forEach((entry) => {
      const card = cardDataRegistry.get(entry.cardCode);
      if (card && isMemberCardData(card)) members.push(entry);
      else if (card && isLiveCardData(card)) lives.push(entry);
      else otherMain.push(entry);
    });

    return [
      {
        key: 'members',
        title: '成员',
        entries: sortDeckEntries(members, (cardCode) => cardDataRegistry.get(cardCode)),
      },
      {
        key: 'lives',
        title: 'LIVE',
        entries: sortDeckEntries(lives, (cardCode) => cardDataRegistry.get(cardCode)),
      },
      ...(otherMain.length > 0
        ? [{ key: 'other', title: '其他主卡组卡牌', entries: otherMain }]
        : []),
      { key: 'energy', title: '能量', entries: deck.energyDeck },
    ].filter((section) => section.entries.length > 0);
  }, [cardDataRegistry, deck]);

  return (
    <div className="theme-deck-gallery">
      {sections.map((section) => (
        <ThemeDeckGallerySection
          key={section.key}
          title={section.title}
          entries={section.entries}
          onViewCard={onViewCard}
        />
      ))}
    </div>
  );
}

function ThemeDeckGallerySection({
  title,
  entries,
  onViewCard,
}: {
  title: string;
  entries: readonly ThemeDeckListEntryView[];
  onViewCard: (card: AnyCardData) => void;
}) {
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const totalCards = entries.reduce((total, entry) => total + entry.count, 0);

  return (
    <section className="theme-deck-gallery__section">
      <div className="theme-deck-gallery__heading">
        <h4>{title}</h4>
        <span>
          {totalCards} 张 · {entries.length} 种
        </span>
      </div>
      <div className="theme-deck-gallery__grid">
        {entries.map((entry) => {
          const card = cardDataRegistry.get(entry.cardCode);
          const displayName = card?.nameCn?.trim() || card?.name?.trim() || entry.cardCode;
          const image = (
            <span className="theme-deck-gallery-card__image">
              <img
                src={
                  card
                    ? resolveCardImagePath(card, 'thumb')
                    : getCardImageUrl(entry.cardCode, 'thumb')
                }
                alt=""
                loading="lazy"
                decoding="async"
              />
              <strong aria-label={`${entry.count} 张`}>×{entry.count}</strong>
            </span>
          );

          if (!card) {
            return (
              <div key={entry.cardCode} className="theme-deck-gallery-card is-unavailable">
                {image}
                <span title={entry.cardCode}>{entry.cardCode}</span>
              </div>
            );
          }

          return (
            <button
              key={entry.cardCode}
              type="button"
              className="theme-deck-gallery-card"
              aria-label={`查看${displayName}，${entry.count} 张`}
              title={`${displayName} · ${entry.cardCode}`}
              onClick={() => onViewCard(card)}
            >
              {image}
              <span>{displayName}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function sortDeckEntries(
  entries: readonly ThemeDeckListEntryView[],
  getCardData: (cardCode: string) => AnyCardData | undefined
): ThemeDeckListEntryView[] {
  return [...entries].sort((left, right) => {
    const leftCard = getCardData(left.cardCode);
    const rightCard = getCardData(right.cardCode);
    const leftValue =
      leftCard && isMemberCardData(leftCard)
        ? leftCard.cost
        : leftCard && isLiveCardData(leftCard)
          ? leftCard.score
          : Number.MAX_SAFE_INTEGER;
    const rightValue =
      rightCard && isMemberCardData(rightCard)
        ? rightCard.cost
        : rightCard && isLiveCardData(rightCard)
          ? rightCard.score
          : Number.MAX_SAFE_INTEGER;
    return leftValue - rightValue || left.cardCode.localeCompare(right.cardCode);
  });
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
