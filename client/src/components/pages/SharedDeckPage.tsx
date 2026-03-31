import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, Loader2, LogIn, Save, Share2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { apiClient, isApiConfigured, type DeckRecord, type SharedDeckRecord } from '@/lib/apiClient';
import { PageHeader, ThemeToggle } from '@/components/common';
import { calculateDeckStats, DeckStatsRow } from '@/components/common/DeckStats';
import { Card } from '@/components/card/Card';
import { CardDetailDrawer } from '@/components/deck-editor/CardDetailDrawer';
import { DeckAnalysisPanel } from '@/components/deck-editor/DeckAnalysisPanel';
import { useAuthStore } from '@/store/authStore';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { isLiveCardData, isMemberCardData, type AnyCardData } from '@game/domain/entities/card';
import type { CardEntry, DeckConfig } from '@game/domain/card-data/deck-loader';

interface SharedDeckPageProps {
  shareId: string;
  onBackHome: () => void;
  onRequestLogin: () => void;
}

function toDeckConfig(deck: SharedDeckRecord): DeckConfig {
  const members: CardEntry[] = [];
  const lives: CardEntry[] = [];

  for (const entry of deck.main_deck || []) {
    if (entry.card_type === 'LIVE') {
      lives.push({ card_code: entry.card_code, count: entry.count });
    } else {
      members.push({ card_code: entry.card_code, count: entry.count });
    }
  }

  return {
    player_name: deck.name,
    description: deck.description || '',
    main_deck: { members, lives },
    energy_deck: deck.energy_deck || [],
  };
}

function sortEntries(entries: CardEntry[], getCardData: (cardCode: string) => AnyCardData | undefined): CardEntry[] {
  const getSortValue = (entry: CardEntry) => {
    const cardData = getCardData(entry.card_code);
    if (!cardData) return Number.POSITIVE_INFINITY;
    if (isMemberCardData(cardData)) return cardData.cost;
    if (isLiveCardData(cardData)) return cardData.score;
    return Number.POSITIVE_INFINITY;
  };

  return [...entries].sort((a, b) => {
    const valueDiff = getSortValue(a) - getSortValue(b);
    if (valueDiff !== 0) return valueDiff;
    return a.card_code.localeCompare(b.card_code);
  });
}

interface SharedDeckSectionProps {
  title: string;
  entries: CardEntry[];
  sort: boolean;
  onViewDetail: (card: AnyCardData) => void;
}

function SharedDeckSection({ title, entries, sort, onViewDetail }: SharedDeckSectionProps) {
  const { getCardImagePath, getCardData } = useGameStore(
    useShallow((s) => ({
      getCardImagePath: s.getCardImagePath,
      getCardData: s.getCardData,
    }))
  );

  const displayEntries = useMemo(
    () => (sort ? sortEntries(entries, getCardData) : entries),
    [entries, getCardData, sort]
  );

  return (
    <section className="surface-panel rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        <span className="text-xs text-[var(--text-muted)]">
          {entries.reduce((sum, entry) => sum + entry.count, 0)} 张
        </span>
      </div>

      {displayEntries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-default)] py-4 text-center text-xs text-[var(--text-muted)]">
          无卡牌
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-6">
          {displayEntries.map((entry) => {
            const cardData = getCardData(entry.card_code);
            if (!cardData) {
              return (
                <div
                  key={entry.card_code}
                  className="flex aspect-[63/88] flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] p-2 text-center"
                >
                  <div className="text-[10px] text-[var(--text-muted)]">{entry.card_code}</div>
                  <div className="mt-1 text-xs font-semibold text-[var(--text-secondary)]">x{entry.count}</div>
                </div>
              );
            }

            return (
              <div
                key={entry.card_code}
                className="relative cursor-pointer"
                style={{ aspectRatio: '63/88' }}
                onClick={() => onViewDetail(cardData)}
                onContextMenu={(e) => { e.preventDefault(); onViewDetail(cardData); }}
              >
                <Card
                  cardData={cardData}
                  imagePath={getCardImagePath(entry.card_code)}
                  size="responsive"
                  interactive={false}
                  showHover={false}
                  className="rounded"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-center rounded-b bg-gradient-to-t from-black/75 via-black/35 to-transparent px-1 py-1.5">
                  <span className="min-w-[24px] text-center text-xs font-bold text-white">
                    {entry.count}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function SharedDeckPage({ shareId, onBackHome, onRequestLogin }: SharedDeckPageProps) {
  const [deck, setDeck] = useState<SharedDeckRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<AnyCardData | null>(null);
  const [forkError, setForkError] = useState<string | null>(null);
  const [forkSuccess, setForkSuccess] = useState<string | null>(null);
  const [isForking, setIsForking] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');
  const { user, profile, offlineMode, offlineUser } = useAuthStore(
    useShallow((s) => ({
      user: s.user,
      profile: s.profile,
      offlineMode: s.offlineMode,
      offlineUser: s.offlineUser,
    }))
  );
  const validateDeck = useDeckStore((s) => s.validateDeck);

  useEffect(() => {
    let cancelled = false;

    const fetchSharedDeck = async () => {
      if (!isApiConfigured) {
        setError('服务器未配置，无法访问分享卡组');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      const result = await apiClient.get<SharedDeckRecord>(`/api/decks/share/${shareId}`);

      if (cancelled) return;

      if (result.error || !result.data) {
        setError(result.error?.message || '加载分享卡组失败');
        setDeck(null);
        setIsLoading(false);
        return;
      }

      setDeck(result.data);
      setIsLoading(false);
    };

    fetchSharedDeck();

    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const isAuthenticated = !!(user && profile) || (offlineMode && !!offlineUser);
  const isOwner = !!deck && !!profile && deck.user_id === profile.id;
  const localDeck = useMemo(() => (deck ? toDeckConfig(deck) : null), [deck]);
  const validation = useMemo(
    () => (localDeck ? validateDeck(localDeck) : { valid: false, errors: [] }),
    [localDeck, validateDeck]
  );

  const handleCopyLink = async () => {
    const shareUrl = `${window.location.origin}/decks/share/${shareId}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState('done');
      window.setTimeout(() => setCopyState('idle'), 2000);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  const handleFork = async () => {
    if (!isAuthenticated) {
      onRequestLogin();
      return;
    }

    setIsForking(true);
    setForkError(null);
    setForkSuccess(null);

    const result = await apiClient.post<DeckRecord>(`/api/decks/share/${shareId}/fork`);

    setIsForking(false);

    if (result.error || !result.data) {
      setForkError(result.error?.message || '保存到我的卡组失败');
      return;
    }

    setForkSuccess('已保存到你的卡组，正在进入卡组管理');
    window.location.href = `/?page=deck-manager&openDeckId=${encodeURIComponent(result.data.id)}`;
  };

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <PageHeader
        title="卡组分享"
        left={(
          <button
            onClick={onBackHome}
            className="button-ghost inline-flex h-10 items-center justify-center gap-1.5 px-2.5 py-2 text-sm sm:px-3"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">返回</span>
          </button>
        )}
        right={(
          <>
            <ThemeToggle />
            <button
              onClick={handleCopyLink}
              className="button-secondary inline-flex h-10 items-center justify-center gap-1.5 px-2.5 py-2 text-sm sm:px-3"
            >
              <Copy size={14} />
              <span className="hidden sm:inline">{copyState === 'done' ? '已复制' : copyState === 'error' ? '复制失败' : '复制链接'}</span>
            </button>
          </>
        )}
      />

      <main className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="workspace-shell mx-auto max-w-6xl p-4 sm:p-6">
          {isLoading && (
            <div className="flex items-center justify-center py-24">
              <div className="text-center">
                <Loader2 size={32} className="mx-auto mb-3 animate-spin text-[var(--accent-primary)]" />
                <div className="text-sm text-[var(--text-secondary)]">加载分享卡组中...</div>
              </div>
            </div>
          )}

          {!isLoading && error && (
            <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-5">
              <div className="text-sm font-medium text-[var(--semantic-error)]">{error}</div>
            </div>
          )}

          {!isLoading && !error && deck && localDeck && (
            <div className="space-y-4">
              <section className="surface-panel rounded-2xl p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-bold text-[var(--text-primary)]">{deck.name}</h2>
                      <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                        {deck.author_display_name || deck.author_username}
                      </span>
                      {validation.valid && (
                        <span className="rounded-full border border-[color:color-mix(in_srgb,var(--semantic-success)_35%,transparent)] px-2 py-0.5 text-xs text-[var(--semantic-success)]">
                          构筑完整
                        </span>
                      )}
                    </div>
                    {deck.description && (
                      <p className="max-w-3xl text-sm text-[var(--text-secondary)]">{deck.description}</p>
                    )}
                    <div className="mt-3">
                      <DeckStatsRow stats={calculateDeckStats(deck)} updatedAt={deck.shared_at || deck.updated_at} size="md" />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!isAuthenticated && (
                      <button
                        onClick={onRequestLogin}
                        className="button-secondary inline-flex min-h-10 items-center gap-1.5 px-4 py-2 text-sm"
                      >
                        <LogIn size={14} />
                        登录
                      </button>
                    )}
                    {!isOwner && (
                      <button
                        onClick={handleFork}
                        disabled={isForking}
                        className={`button-primary inline-flex min-h-10 items-center gap-1.5 px-4 py-2 text-sm ${
                          isForking ? 'cursor-wait opacity-60' : ''
                        }`}
                      >
                        {isForking ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        {isAuthenticated ? '保存到我的卡组' : '登录后保存到我的卡组'}
                      </button>
                    )}
                    {isOwner && (
                      <button
                        onClick={onBackHome}
                        className="button-secondary inline-flex min-h-10 items-center gap-1.5 px-4 py-2 text-sm"
                      >
                        <Share2 size={14} />
                        返回首页
                      </button>
                    )}
                  </div>
                </div>

                {forkError && (
                  <div className="mt-4 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-3 text-sm text-[var(--semantic-error)]">
                    {forkError}
                  </div>
                )}

                {forkSuccess && (
                  <div className="mt-4 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_12%,transparent)] p-3 text-sm text-[var(--semantic-success)]">
                    {forkSuccess}
                  </div>
                )}
              </section>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-4">
                  <SharedDeckSection
                    title="成员卡"
                    entries={localDeck.main_deck.members}
                    sort
                    onViewDetail={setSelectedCard}
                  />
                  <SharedDeckSection
                    title="Live 卡"
                    entries={localDeck.main_deck.lives}
                    sort
                    onViewDetail={setSelectedCard}
                  />
                  <SharedDeckSection
                    title="能量卡"
                    entries={localDeck.energy_deck}
                    sort={false}
                    onViewDetail={setSelectedCard}
                  />
                </div>

                <aside className="surface-panel h-fit rounded-2xl p-4">
                  <div className="mb-3 text-sm font-semibold text-[var(--text-primary)]">构筑状态</div>
                  {validation.valid ? (
                    <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_12%,transparent)] p-3 text-sm text-[var(--semantic-success)]">
                      该卡组满足当前构筑要求。
                    </div>
                  ) : (
                    <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-3">
                      <div className="mb-2 text-sm font-medium text-[var(--semantic-error)]">该卡组当前不完整</div>
                      <ul className="space-y-1 text-xs text-[var(--semantic-error)]/80">
                        {validation.errors.map((err) => (
                          <li key={err}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
                    <div className="mb-2 text-sm font-semibold text-[var(--text-primary)]">卡组统计</div>
                    <div className="mb-4">
                      <DeckStatsRow
                        stats={calculateDeckStats(deck)}
                        size="md"
                        className="justify-between"
                      />
                    </div>
                    <div className="-mx-1">
                      <DeckAnalysisPanel deck={localDeck} />
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          )}
        </div>
      </main>

      <CardDetailDrawer card={selectedCard} onClose={() => setSelectedCard(null)} />
    </div>
  );
}
