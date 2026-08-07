import { useEffect, useMemo, useState } from 'react';
import { BookOpen, DoorOpen, Loader2, Medal, Search, ShieldCheck, Swords, X } from 'lucide-react';
import {
  ActionButton,
  DeckSelector,
  PageHeader,
  Panel,
  type DeckDisplayItem,
} from '@/components/common';
import { RankedSeasonNoticeDialog } from '@/components/ranked/RankedSeasonNoticeDialog';
import { buildDeckDisplayItems } from '@/lib/deckDisplay';
import { useDeckPointTableRules } from '@/hooks/useDeckPointTable';
import {
  choosePreferredDeck,
  DECK_SELECTION_PREFERENCE_KEYS,
  readLastUsedDeckId,
  writeLastUsedDeckId,
} from '@/lib/deckSelectionPreferences';
import { createDeckRecordCardTypeResolver } from '@/lib/deckRecordUtils';
import { fetchRankedOverview, fetchRankedSeasons } from '@/lib/rankedClient';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { useRankedStore } from '@/store/rankedStore';
import type { RankedOverviewView, RankedSeasonPublicView } from '@game/online/ranked-types';

const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';

export function RankedPage({
  onBack,
  onEnterRoom,
}: {
  onBack: () => void;
  onEnterRoom: () => void;
}) {
  const pointTable = useDeckPointTableRules();
  const cloudDecks = useDeckStore((state) => state.cloudDecks);
  const isLoadingCloud = useDeckStore((state) => state.isLoadingCloud);
  const cloudError = useDeckStore((state) => state.cloudError);
  const fetchCloudDecks = useDeckStore((state) => state.fetchCloudDecks);
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const overview = useRankedStore((state) => state.overview);
  const loading = useRankedStore((state) => state.loading);
  const error = useRankedStore((state) => state.error);
  const refresh = useRankedStore((state) => state.refresh);
  const join = useRankedStore((state) => state.join);
  const confirm = useRankedStore((state) => state.confirm);
  const cancel = useRankedStore((state) => state.cancel);
  const [selectedDeck, setSelectedDeck] = useState<DeckDisplayItem | null>(null);
  const [hasChosenDeck, setHasChosenDeck] = useState(false);
  const [lastUsedDeckId, setLastUsedDeckId] = useState(() =>
    readLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.ranked)
  );
  const [seasonOptions, setSeasonOptions] = useState<RankedSeasonPublicView[]>([]);
  const [historicalOverview, setHistoricalOverview] = useState<RankedOverviewView | null>(null);
  const [isSeasonNoticeOpen, setIsSeasonNoticeOpen] = useState(false);
  const resolveDeckRecordCardType = useMemo(
    () => createDeckRecordCardTypeResolver(cardDataRegistry),
    [cardDataRegistry]
  );
  const deckDisplayItems = useMemo(
    () => buildDeckDisplayItems({ cloudDecks, resolveDeckRecordCardType, pointTable }),
    [cloudDecks, pointTable, resolveDeckRecordCardType]
  );
  const preferredDeck = useMemo(
    () => choosePreferredDeck(deckDisplayItems, lastUsedDeckId),
    [deckDisplayItems, lastUsedDeckId]
  );
  const status = overview?.queue ?? null;
  const active = status && status.state !== 'IDLE';
  const displayedOverview = historicalOverview ?? overview;

  useEffect(() => {
    void fetchCloudDecks();
    void refresh().catch(() => undefined);
    void fetchRankedSeasons()
      .then(setSeasonOptions)
      .catch(() => undefined);
  }, [fetchCloudDecks, refresh]);

  useEffect(() => {
    if (selectedDeck || hasChosenDeck || !preferredDeck.deck) return;
    const timer = window.setTimeout(() => setSelectedDeck(preferredDeck.deck), 0);
    return () => window.clearTimeout(timer);
  }, [hasChosenDeck, preferredDeck.deck, selectedDeck]);

  useEffect(() => {
    if (!selectedDeck) return;
    const refreshed = deckDisplayItems.find((deck) => deck.id === selectedDeck.id && deck.isValid);
    if (refreshed === selectedDeck) return;
    const timer = window.setTimeout(() => setSelectedDeck(refreshed ?? null), 0);
    return () => window.clearTimeout(timer);
  }, [deckDisplayItems, selectedDeck]);

  const handleJoin = async () => {
    if (!selectedDeck?.cloudDeck) return;
    try {
      await join(selectedDeck.cloudDeck.id);
      writeLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.ranked, selectedDeck.cloudDeck.id);
      setLastUsedDeckId(selectedDeck.cloudDeck.id);
    } catch {
      // Store error is rendered with the primary action.
    }
  };

  const handleEnterRoom = () => {
    if (!status?.roomCode) return;
    window.sessionStorage.setItem(ONLINE_ROOM_STORAGE_KEY, status.roomCode);
    onEnterRoom();
  };

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <PageHeader
        title="赛季排位"
        icon={<Medal size={20} />}
        onBack={onBack}
        backLabel="返回大厅"
      />

      <main className="relative z-10 flex flex-1 justify-center px-4 py-5 sm:px-6">
        <div className="w-full max-w-4xl">
          {active ? (
            <QueueState
              status={status}
              loading={loading}
              error={error}
              onCancel={cancel}
              onConfirm={confirm}
              onEnterRoom={handleEnterRoom}
              onOpenSeasonNotice={() => setIsSeasonNoticeOpen(true)}
            />
          ) : (
            <>
              {seasonOptions.length > 1 ? (
                <select
                  className="input-field mb-3 h-10 max-w-xs text-sm"
                  aria-label="查看赛季"
                  value={displayedOverview?.season?.id ?? ''}
                  onChange={(event) => {
                    const seasonId = event.target.value;
                    if (seasonId === overview?.season?.id) {
                      setHistoricalOverview(null);
                      return;
                    }
                    void fetchRankedOverview(seasonId)
                      .then(setHistoricalOverview)
                      .catch(() => undefined);
                  }}
                >
                  {seasonOptions.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <SeasonSummary
                overview={displayedOverview}
                onOpenSeasonNotice={() => setIsSeasonNoticeOpen(true)}
              />
              {!historicalOverview && overview?.availability.canJoin ? (
                <>
                  <div className="mt-4">
                    <DeckSelector
                      cloudDecks={cloudDecks}
                      selectedId={selectedDeck?.id}
                      onSelect={(deck) => {
                        setHasChosenDeck(true);
                        setSelectedDeck(deck);
                      }}
                      isLoading={isLoadingCloud}
                      error={cloudError}
                      onRefresh={fetchCloudDecks}
                      title="选择卡组"
                      emptyText="还没有可用卡组，请先到卡组管理创建一副。"
                      density="compact"
                      lastUsedDeckId={lastUsedDeckId}
                    />
                  </div>
                  {error ? <ErrorMessage message={error} /> : null}
                  <Panel
                    padding="compact"
                    className="sticky bottom-3 mt-4 flex items-center gap-3 shadow-[var(--shadow-lg)] sm:shadow-none"
                  >
                    <div className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">
                      {selectedDeck?.name ?? '选择一副卡组'}
                    </div>
                    <ActionButton
                      className="shrink-0 px-6 disabled:opacity-45"
                      disabled={!selectedDeck || loading}
                      onClick={() => void handleJoin()}
                    >
                      {loading ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Swords size={16} />
                      )}
                      开始排位
                    </ActionButton>
                  </Panel>
                </>
              ) : null}
              <SeasonLists overview={displayedOverview} />
            </>
          )}
        </div>
      </main>
      <RankedSeasonNoticeDialog
        isOpen={isSeasonNoticeOpen}
        seasonName={displayedOverview?.season?.name}
        leaderboardMatchCount={
          displayedOverview?.player?.placementRequired ??
          displayedOverview?.season?.placementMatchCount
        }
        onClose={() => setIsSeasonNoticeOpen(false)}
      />
    </div>
  );
}

function SeasonSummary({
  overview,
  onOpenSeasonNotice,
}: {
  overview: ReturnType<typeof useRankedStore.getState>['overview'];
  onOpenSeasonNotice: () => void;
}) {
  if (!overview) {
    return <Panel className="text-sm text-[var(--text-muted)]">正在读取赛季…</Panel>;
  }
  const player = overview.player;
  return (
    <Panel as="section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            {overview.season?.name ?? '暂无赛季'}
          </div>
          <div className="mt-1 text-sm text-[var(--text-muted)]">
            {overview.availability.message}
            {overview.availability.currentWindowEndsAt
              ? ` · 开放至 ${formatShortTime(overview.availability.currentWindowEndsAt)}`
              : overview.availability.nextOpensAt
                ? ` · 下次 ${formatShortTime(overview.availability.nextOpensAt)}`
                : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <button
            type="button"
            onClick={onOpenSeasonNotice}
            className="button-ghost inline-flex min-h-9 items-center justify-center gap-2 border border-[var(--border-default)] px-3 text-xs font-semibold"
          >
            <BookOpen size={14} />
            赛季公告
          </button>
          {player ? (
            <div className="text-right">
              <div className="text-xl font-bold text-[var(--text-primary)]">
                {player.rating ?? '—'}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                {player.placement
                  ? `${player.placementCompleted} / ${player.placementRequired} 场 · 满 ${player.placementRequired} 场进入排行榜`
                  : '赛季积分'}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {player ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-[var(--border-subtle)] pt-3 text-sm">
          <div className="flex items-center gap-3 text-[var(--text-secondary)]">
            <span className="text-[var(--text-muted)]">战绩</span>
            <span>{player.completedMatches} 场</span>
            <span>{player.wins} 胜</span>
            <span>{player.losses} 负</span>
          </div>
          {overview.season ? (
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <span>赛季结束</span>
              <time
                dateTime={new Date(overview.season.scheduledEndsAt).toISOString()}
                className="text-[var(--text-secondary)]"
              >
                {formatShortDate(overview.season.scheduledEndsAt)}
              </time>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function SeasonLists({
  overview,
}: {
  overview: ReturnType<typeof useRankedStore.getState>['overview'];
}) {
  if (!overview || (overview.recentMatches.length === 0 && overview.leaderboard.length === 0)) {
    return null;
  }
  const hasBothLists = overview.recentMatches.length > 0 && overview.leaderboard.length > 0;
  return (
    <div className={`mt-4 grid gap-4 ${hasBothLists ? 'md:grid-cols-2' : ''}`}>
      {overview.recentMatches.length > 0 ? (
        <Panel as="section" padding="compact">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">最近对局</h2>
          <div className="mt-2 divide-y divide-[var(--border-subtle)]">
            {overview.recentMatches.slice(0, 5).map((match) => (
              <div key={match.matchId} className="flex items-center justify-between py-2 text-sm">
                <span className="truncate text-[var(--text-secondary)]">
                  {match.opponentDisplayName}
                </span>
                <span
                  className={
                    match.result === 'WIN'
                      ? 'text-[var(--semantic-success)]'
                      : 'text-[var(--text-muted)]'
                  }
                >
                  {match.result === 'WIN' ? '胜' : match.result === 'LOSS' ? '负' : '无效'}
                  {match.ratingDelta !== null
                    ? ` ${match.ratingDelta >= 0 ? '+' : ''}${match.ratingDelta}`
                    : ''}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      {overview.leaderboard.length > 0 ? (
        <Panel as="section" padding="compact">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">排行榜</h2>
          <div className="mt-2 divide-y divide-[var(--border-subtle)]">
            {overview.leaderboard.slice(0, 10).map((entry) => (
              <div key={entry.userId} className="grid grid-cols-[2rem_1fr_auto] gap-2 py-2 text-sm">
                <span className="text-[var(--text-muted)]">{entry.rank}</span>
                <span className="truncate text-[var(--text-secondary)]">{entry.displayName}</span>
                <span className="font-semibold text-[var(--text-primary)]">{entry.rating}</span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function QueueState({
  status,
  loading,
  error,
  onCancel,
  onConfirm,
  onEnterRoom,
  onOpenSeasonNotice,
}: {
  status: NonNullable<ReturnType<typeof useRankedStore.getState>['overview']>['queue'];
  loading: boolean;
  error: string | null;
  onCancel: () => Promise<void>;
  onConfirm: () => Promise<void>;
  onEnterRoom: () => void;
  onOpenSeasonNotice: () => void;
}) {
  const waiting = status.state === 'WAITING';
  const matched = status.state === 'MATCHED';
  return (
    <Panel as="section" padding="spacious" className="mx-auto mt-6 max-w-md text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]">
        {matched ? (
          <DoorOpen size={20} />
        ) : waiting ? (
          <Search size={20} />
        ) : (
          <ShieldCheck size={20} />
        )}
      </div>
      <h1 className="mt-3 text-xl font-semibold text-[var(--text-primary)]">
        {waiting
          ? '正在匹配对手'
          : matched
            ? '排位对局已准备好'
            : status.state === 'CREATING_ROOM'
              ? '正在进入对局'
              : '找到对手'}
      </h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        {waiting
          ? status.deckName
          : status.confirmed
            ? '已确认，等待对方'
            : matched
              ? `房间 ${status.roomCode}`
              : '请确认开局'}
      </p>
      <button
        type="button"
        onClick={onOpenSeasonNotice}
        className="button-ghost mt-4 inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] px-4 text-sm"
      >
        <BookOpen size={15} />
        查看赛季公告
      </button>
      {error ? <ErrorMessage message={error} /> : null}
      {waiting || status.state === 'CONFIRMED' ? (
        <ActionButton
          variant="secondary"
          className="mt-5 w-full"
          disabled={loading}
          onClick={() => void onCancel().catch(() => undefined)}
        >
          <X size={16} />
          取消匹配
        </ActionButton>
      ) : null}
      {status.state === 'PENDING_CONFIRMATION' ? (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <ActionButton variant="secondary" onClick={() => void onCancel()}>
            取消
          </ActionButton>
          <ActionButton onClick={() => void onConfirm()}>确认开局</ActionButton>
        </div>
      ) : null}
      {status.state === 'CREATING_ROOM' ? (
        <Loader2 size={18} className="mx-auto mt-5 animate-spin text-[var(--accent-primary)]" />
      ) : null}
      {matched ? (
        <ActionButton className="mt-5 w-full" onClick={onEnterRoom}>
          返回房间
        </ActionButton>
      ) : null}
    </Panel>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="mt-3 rounded-lg bg-[var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]">
      {message}
    </p>
  );
}

function formatShortTime(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatShortDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}
