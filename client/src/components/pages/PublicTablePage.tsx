import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, DoorOpen, Loader2, Search, Share2, Swords, X } from 'lucide-react';
import {
  ActionButton,
  DeckSelector,
  PageHeader,
  Panel,
  StatusBadge,
  type DeckDisplayItem,
} from '@/components/common';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { usePublicTableStore } from '@/store/publicTableStore';
import { createDeckRecordCardTypeResolver } from '@/lib/deckRecordUtils';
import { buildDeckDisplayItems } from '@/lib/deckDisplay';
import { useDeckPointTableRules } from '@/hooks/useDeckPointTable';
import {
  choosePreferredDeck,
  DECK_SELECTION_PREFERENCE_KEYS,
  readLastUsedDeckId,
  writeLastUsedDeckId,
} from '@/lib/deckSelectionPreferences';

type ShareFeedback = 'idle' | 'done' | 'error';
const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';

export function PublicTablePage({
  userId,
  onBack,
  onEnterRoom,
}: {
  userId: string;
  onBack: () => void;
  onEnterRoom: () => void;
}) {
  const cloudDecks = useDeckStore((state) => state.cloudDecks);
  const isLoadingCloud = useDeckStore((state) => state.isLoadingCloud);
  const cloudError = useDeckStore((state) => state.cloudError);
  const fetchCloudDecks = useDeckStore((state) => state.fetchCloudDecks);
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const pointTable = useDeckPointTableRules();
  const status = usePublicTableStore((state) => state.status);
  const sessionUserId = usePublicTableStore((state) => state.sessionUserId);
  const hydrated = usePublicTableStore((state) => state.hydrated);
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
  const [entryStatusCheck, setEntryStatusCheck] = useState<'checking' | 'ready' | 'failed'>(
    'checking'
  );
  const statusCheckAttemptRef = useRef(0);
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
        pointTable,
      }),
    [cloudDecks, pointTable, resolveDeckRecordCardType]
  );
  const validDeckCount = useMemo(
    () => deckDisplayItems.filter((deck) => deck.isValid).length,
    [deckDisplayItems]
  );
  const preferredDeck = useMemo(
    () => choosePreferredDeck(deckDisplayItems, lastUsedDeckId),
    [deckDisplayItems, lastUsedDeckId]
  );

  const retryStatusCheck = () => {
    const attempt = ++statusCheckAttemptRef.current;
    setEntryStatusCheck('checking');
    void refresh().then(
      () => {
        if (statusCheckAttemptRef.current === attempt) {
          setEntryStatusCheck('ready');
        }
      },
      () => {
        if (statusCheckAttemptRef.current === attempt) {
          setEntryStatusCheck('failed');
        }
      }
    );
  };

  useEffect(() => {
    void fetchCloudDecks();
  }, [fetchCloudDecks]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const attempt = ++statusCheckAttemptRef.current;
      setEntryStatusCheck('checking');
      void refresh().then(
        () => {
          if (statusCheckAttemptRef.current === attempt) {
            setEntryStatusCheck('ready');
          }
        },
        () => {
          if (statusCheckAttemptRef.current === attempt) {
            setEntryStatusCheck('failed');
          }
        }
      );
    }, 0);
    return () => {
      window.clearTimeout(timer);
      statusCheckAttemptRef.current += 1;
    };
  }, [refresh, userId]);

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

  const statusReady = entryStatusCheck === 'ready' && sessionUserId === userId && hydrated;
  const visibleStatus = statusReady ? status : null;
  const active = visibleStatus && visibleStatus.state !== 'IDLE';
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
    if (!visibleStatus?.roomCode) {
      return;
    }
    window.sessionStorage.setItem(ONLINE_ROOM_STORAGE_KEY, visibleStatus.roomCode);
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
        onBack={onBack}
        backLabel="返回大厅"
        right={
          <>
            <ActionButton
              onClick={() => void handleCopyInvitation()}
              variant="icon"
              title="复制求战邀请"
              aria-label="复制求战邀请"
            >
              {shareFeedback === 'done' ? <Check size={16} /> : <Share2 size={16} />}
            </ActionButton>
          </>
        }
      />

      <ShareToast feedback={shareFeedback} />

      <main
        className={`relative z-10 flex flex-1 justify-center px-4 ${
          !statusReady || active
            ? 'items-center py-6'
            : 'pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-5 sm:p-6'
        }`}
      >
        <div className="w-full max-w-4xl">
          {!statusReady ? (
            <Panel as="section" padding="spacious" className="mx-auto max-w-md text-center">
              {entryStatusCheck === 'failed' ? (
                <>
                  <h1 className="text-xl font-semibold text-[var(--text-primary)]">
                    无法确认匹配状态
                  </h1>
                  <p className="mt-2 text-sm text-[var(--text-secondary)]">
                    请重新读取当前状态后再选择卡组。
                  </p>
                  {error && <ActionError message={error} className="mt-3" />}
                  <ActionButton
                    className="mt-5 w-full"
                    disabled={loading}
                    onClick={retryStatusCheck}
                  >
                    重新读取
                  </ActionButton>
                </>
              ) : (
                <>
                  <Loader2
                    size={22}
                    className="mx-auto animate-spin text-[var(--accent-primary)]"
                  />
                  <h1 className="mt-3 text-lg font-semibold text-[var(--text-primary)]">
                    正在确认公共牌桌状态
                  </h1>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    正在检查是否有尚未结束的候场或对局。
                  </p>
                </>
              )}
            </Panel>
          ) : active && visibleStatus ? (
            <Panel as="section" padding="spacious" className="mx-auto max-w-md text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]">
                {visibleStatus.state === 'MATCHED' ? <DoorOpen size={20} /> : <Search size={20} />}
              </div>
              <h1 className="mt-3 text-xl font-semibold text-[var(--text-primary)]">
                {visibleStatus.state === 'WAITING'
                  ? '正在找对手'
                  : visibleStatus.state === 'MATCHED'
                    ? '对局已准备好'
                    : visibleStatus.state === 'CREATING_ROOM'
                      ? '正在进入房间'
                      : '找到对手'}
              </h1>
              <p className="mt-1 truncate text-sm text-[var(--text-muted)]">
                {visibleStatus.state === 'WAITING'
                  ? (visibleStatus.deckName ?? '已选卡组')
                  : visibleStatus.state === 'MATCHED'
                    ? `房间 ${visibleStatus.roomCode}`
                    : visibleStatus.state === 'CREATING_ROOM'
                      ? '正在准备开局'
                      : visibleStatus.confirmed
                        ? '你已确认，等待对方确认'
                        : '请在 60 秒内确认开局'}
              </p>

              {visibleStatus.state === 'WAITING' && (
                <ActionButton
                  variant="secondary"
                  className="mt-5 w-full"
                  disabled={loading}
                  onClick={() => void cancel()}
                >
                  <X size={16} />
                  取消等待
                </ActionButton>
              )}
              {visibleStatus.state === 'PENDING_CONFIRMATION' && (
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <ActionButton
                    variant="secondary"
                    disabled={loading}
                    onClick={() => void cancel()}
                  >
                    取消等待
                  </ActionButton>
                  <ActionButton disabled={loading} onClick={() => void confirm()}>
                    确认开局
                  </ActionButton>
                </div>
              )}
              {visibleStatus.state === 'CONFIRMED' && (
                <ActionButton
                  variant="secondary"
                  className="mt-5 w-full"
                  disabled={loading}
                  onClick={() => void cancel()}
                >
                  取消等待
                </ActionButton>
              )}
              {visibleStatus.state === 'CREATING_ROOM' && (
                <Loader2
                  size={18}
                  className="mx-auto mt-5 animate-spin text-[var(--accent-primary)]"
                />
              )}
              {visibleStatus.state === 'MATCHED' && (
                <ActionButton className="mt-5 w-full" onClick={handleEnterMatchedRoom}>
                  <DoorOpen size={16} />
                  返回房间
                </ActionButton>
              )}
              {error && <ActionError message={error} className="mt-3" />}
            </Panel>
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

              <Panel
                padding="compact"
                className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-20 flex items-center gap-3 shadow-[var(--shadow-lg)] sm:static sm:mt-4 sm:shadow-none"
              >
                <div className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">
                  {selectedDeck?.name ?? '选择一副卡组'}
                </div>
                <ActionButton
                  className="shrink-0 px-6 disabled:opacity-45"
                  disabled={!selectedDeck || loading}
                  onClick={() => void handleJoin()}
                >
                  {loading && <Loader2 size={16} className="animate-spin" />}
                  {loading ? '请稍候' : '找对手'}
                </ActionButton>
              </Panel>
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
    <StatusBadge
      tone={feedback === 'done' ? 'success' : 'danger'}
      className="fixed right-4 top-20 z-[120] bg-[var(--bg-overlay)] px-4 py-2 shadow-[var(--shadow-md)]"
      role="status"
      aria-live="polite"
    >
      {feedback === 'done' ? '邀请已复制' : '无法复制邀请'}
    </StatusBadge>
  );
}

function ActionError({ message, className = '' }: { message: string; className?: string }) {
  return (
    <p
      className={`rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_32%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_9%,transparent)] px-3 py-2 text-sm text-[var(--semantic-error)] ${className}`}
    >
      {message}
    </p>
  );
}
