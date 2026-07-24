import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, DoorOpen, Loader2, Search, Share2, Swords, X } from 'lucide-react';
import { DeckSelector, PageHeader, ThemeToggle, type DeckDisplayItem } from '@/components/common';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { usePublicTableStore } from '@/store/publicTableStore';
import { createDeckRecordCardTypeResolver } from '@/lib/deckRecordUtils';
import { buildDeckDisplayItems } from '@/lib/deckDisplay';
import {
  choosePreferredDeck,
  DECK_SELECTION_PREFERENCE_KEYS,
  readLastUsedDeckId,
  writeLastUsedDeckId,
} from '@/lib/deckSelectionPreferences';

type ShareFeedback = 'idle' | 'done' | 'error';
const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';

export function PublicTablePage({
  onBack,
  onEnterRoom,
}: {
  onBack: () => void;
  onEnterRoom: () => void;
}) {
  const cloudDecks = useDeckStore((state) => state.cloudDecks);
  const isLoadingCloud = useDeckStore((state) => state.isLoadingCloud);
  const cloudError = useDeckStore((state) => state.cloudError);
  const fetchCloudDecks = useDeckStore((state) => state.fetchCloudDecks);
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const status = usePublicTableStore((state) => state.status);
  const loading = usePublicTableStore((state) => state.loading);
  const error = usePublicTableStore((state) => state.error);
  const refresh = usePublicTableStore((state) => state.refresh);
  const join = usePublicTableStore((state) => state.join);
  const confirm = usePublicTableStore((state) => state.confirm);
  const cancel = usePublicTableStore((state) => state.cancel);
  const [selectedDeck, setSelectedDeck] = useState<DeckDisplayItem | null>(null);
  const [hasChosenDeck, setHasChosenDeck] = useState(false);
  const [lastUsedDeckId, setLastUsedDeckId] = useState(() =>
    readLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.publicTable)
  );
  const [shareFeedback, setShareFeedback] = useState<ShareFeedback>('idle');
  const shareFeedbackTimerRef = useRef<number | null>(null);
  const resolveDeckRecordCardType = useMemo(
    () => createDeckRecordCardTypeResolver(cardDataRegistry),
    [cardDataRegistry]
  );
  const deckDisplayItems = useMemo(
    () =>
      buildDeckDisplayItems({
        cloudDecks,
        resolveDeckRecordCardType,
      }),
    [cloudDecks, resolveDeckRecordCardType]
  );
  const validDeckCount = useMemo(
    () => deckDisplayItems.filter((deck) => deck.isValid).length,
    [deckDisplayItems]
  );
  const preferredDeck = useMemo(
    () => choosePreferredDeck(deckDisplayItems, lastUsedDeckId),
    [deckDisplayItems, lastUsedDeckId]
  );

  useEffect(() => {
    void fetchCloudDecks();
    void refresh();
  }, [fetchCloudDecks, refresh]);

  useEffect(
    () => () => {
      if (shareFeedbackTimerRef.current !== null) {
        window.clearTimeout(shareFeedbackTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedDeck) {
      return;
    }

    const refreshedDeck = deckDisplayItems.find(
      (deck) => deck.id === selectedDeck.id && deck.isValid
    );
    if (!refreshedDeck) {
      const timer = window.setTimeout(() => setSelectedDeck(null), 0);
      return () => window.clearTimeout(timer);
    }
    if (refreshedDeck !== selectedDeck) {
      const timer = window.setTimeout(() => setSelectedDeck(refreshedDeck), 0);
      return () => window.clearTimeout(timer);
    }
  }, [deckDisplayItems, selectedDeck]);

  useEffect(() => {
    if (selectedDeck || hasChosenDeck || !preferredDeck.deck) {
      return;
    }
    const timer = window.setTimeout(() => setSelectedDeck(preferredDeck.deck), 0);
    return () => window.clearTimeout(timer);
  }, [hasChosenDeck, preferredDeck.deck, selectedDeck]);

  const active = status && status.state !== 'IDLE';
  const entrySource =
    new URLSearchParams(window.location.search).get('from') === 'share' ? 'SHARED_LINK' : 'DIRECT';

  const handleSelectDeck = (deck: DeckDisplayItem) => {
    setHasChosenDeck(true);
    setSelectedDeck(deck);
  };

  const handleJoin = async () => {
    if (!selectedDeck?.cloudDeck) {
      return;
    }
    try {
      await join(selectedDeck.cloudDeck.id, entrySource);
      writeLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.publicTable, selectedDeck.cloudDeck.id);
      setLastUsedDeckId(selectedDeck.cloudDeck.id);
    } catch {
      // Store error is shown beside the action.
    }
  };

  const handleEnterMatchedRoom = () => {
    if (!status?.roomCode) {
      return;
    }
    window.sessionStorage.setItem(ONLINE_ROOM_STORAGE_KEY, status.roomCode);
    onEnterRoom();
  };

  const showShareFeedback = (nextFeedback: Exclude<ShareFeedback, 'idle'>) => {
    if (shareFeedbackTimerRef.current !== null) {
      window.clearTimeout(shareFeedbackTimerRef.current);
    }
    setShareFeedback(nextFeedback);
    shareFeedbackTimerRef.current = window.setTimeout(() => {
      setShareFeedback('idle');
      shareFeedbackTimerRef.current = null;
    }, 2200);
  };

  const handleCopyInvitation = async () => {
    const invitation = `我在 Loveca 公共牌桌找一局真人对战，来看看吧：${window.location.origin}/?page=public-table&from=share`;
    try {
      await navigator.clipboard.writeText(invitation);
      showShareFeedback('done');
    } catch {
      showShareFeedback('error');
    }
  };

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <PageHeader
        title="公共牌桌"
        icon={<Swords size={20} />}
        left={
          <button
            type="button"
            onClick={onBack}
            className="button-icon"
            title="返回首页"
            aria-label="返回首页"
          >
            <ArrowLeft size={16} />
          </button>
        }
        right={
          <>
            <button
              type="button"
              onClick={() => void handleCopyInvitation()}
              className="button-icon"
              title="复制求战邀请"
              aria-label="复制求战邀请"
            >
              {shareFeedback === 'done' ? <Check size={16} /> : <Share2 size={16} />}
            </button>
            <ThemeToggle />
          </>
        }
      />

      <ShareToast feedback={shareFeedback} />

      <main
        className={`relative z-10 flex flex-1 justify-center px-4 ${
          active ? 'items-center py-6' : 'pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-5 sm:p-6'
        }`}
      >
        <div className="w-full max-w-4xl">
          {active ? (
            <section className="surface-panel-frosted mx-auto max-w-md p-5 text-center sm:p-6">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]">
                {status.state === 'MATCHED' ? <DoorOpen size={20} /> : <Search size={20} />}
              </div>
              <h1 className="mt-3 text-xl font-bold text-[var(--text-primary)]">
                {status.state === 'WAITING'
                  ? '正在找对手'
                  : status.state === 'MATCHED'
                    ? '对局已准备好'
                    : status.state === 'CREATING_ROOM'
                      ? '正在进入房间'
                      : '找到对手'}
              </h1>
              <p className="mt-1 truncate text-sm text-[var(--text-muted)]">
                {status.state === 'WAITING'
                  ? (status.deckName ?? '已选卡组')
                  : status.state === 'MATCHED'
                    ? `房间 ${status.roomCode}`
                    : status.state === 'CREATING_ROOM'
                      ? '正在准备开局'
                      : status.confirmed
                        ? '已确认，等待对方'
                        : '请确认是否开始'}
              </p>

              {status.state === 'WAITING' && (
                <button
                  type="button"
                  className="button-secondary mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4"
                  disabled={loading}
                  onClick={() => void cancel()}
                >
                  <X size={16} />
                  结束等待
                </button>
              )}
              {status.state === 'PENDING_CONFIRMATION' && (
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    className="button-secondary inline-flex min-h-11 items-center justify-center px-4"
                    disabled={loading}
                    onClick={() => void cancel()}
                  >
                    放弃
                  </button>
                  <button
                    type="button"
                    className="button-primary inline-flex min-h-11 items-center justify-center px-4"
                    disabled={loading}
                    onClick={() => void confirm()}
                  >
                    确认开始
                  </button>
                </div>
              )}
              {status.state === 'CONFIRMED' && (
                <button
                  type="button"
                  className="button-secondary mt-5 inline-flex min-h-11 w-full items-center justify-center px-4"
                  disabled={loading}
                  onClick={() => void cancel()}
                >
                  放弃
                </button>
              )}
              {status.state === 'CREATING_ROOM' && (
                <Loader2
                  size={18}
                  className="mx-auto mt-5 animate-spin text-[var(--accent-primary)]"
                />
              )}
              {status.state === 'MATCHED' && (
                <button
                  type="button"
                  className="button-primary mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4"
                  onClick={handleEnterMatchedRoom}
                >
                  <DoorOpen size={16} />
                  返回房间
                </button>
              )}
              {error && <ActionError message={error} className="mt-3" />}
            </section>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <span className="text-sm font-medium text-[var(--text-secondary)]">
                  休闲对局 · 不计积分
                </span>
              </div>

              <div
                className={
                  validDeckCount > 6 || isLoadingCloud
                    ? 'h-[58dvh] min-h-[420px] max-h-[640px] overflow-hidden'
                    : ''
                }
              >
                <DeckSelector
                  cloudDecks={cloudDecks}
                  selectedId={selectedDeck?.id}
                  onSelect={handleSelectDeck}
                  isLoading={isLoadingCloud}
                  error={cloudError}
                  onRefresh={fetchCloudDecks}
                  title="选择卡组"
                  emptyText="还没有可用卡组，请先到卡组管理创建一副。"
                  density="compact"
                  lastUsedDeckId={lastUsedDeckId}
                />
              </div>

              {error && <ActionError message={error} className="mt-3" />}

              <div className="surface-panel-frosted fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-20 flex items-center gap-3 p-3 shadow-[var(--shadow-md)] sm:static sm:mt-4 sm:p-4">
                <div className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">
                  {selectedDeck?.name ?? '选择一副卡组'}
                </div>
                <button
                  type="button"
                  className="button-primary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 px-6 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!selectedDeck || loading}
                  onClick={() => void handleJoin()}
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {loading ? '请稍候' : '找对手'}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function ShareToast({ feedback }: { feedback: ShareFeedback }) {
  if (feedback === 'idle') {
    return null;
  }

  return (
    <div
      className={`fixed right-4 top-20 z-[120] rounded-full border px-4 py-2 text-sm font-medium shadow-[var(--shadow-md)] ${
        feedback === 'done'
          ? 'border-[color:color-mix(in_srgb,var(--semantic-success)_35%,var(--border-default))] bg-[var(--bg-overlay)] text-[var(--semantic-success)]'
          : 'border-[color:color-mix(in_srgb,var(--semantic-error)_35%,var(--border-default))] bg-[var(--bg-overlay)] text-[var(--semantic-error)]'
      }`}
      role="status"
      aria-live="polite"
    >
      {feedback === 'done' ? '邀请已复制' : '无法复制邀请'}
    </div>
  );
}

function ActionError({ message, className = '' }: { message: string; className?: string }) {
  return (
    <p
      className={`rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_32%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_9%,transparent)] px-3 py-2 text-sm text-[var(--semantic-error)] ${className}`}
    >
      {message}
    </p>
  );
}
