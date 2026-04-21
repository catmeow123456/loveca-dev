import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Link2, Loader2, RefreshCw, Swords, Users } from 'lucide-react';
import { PageHeader, DeckSelector, type DeckDisplayItem } from '@/components/common';
import { ThemeToggle } from '@/components/common';
import { GameBoard } from '@/components/game';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { useAuthStore } from '@/store/authStore';
import {
  fetchOnlineDebugStatus,
  resetOnlineDebugMatch,
  selectOnlineDebugDeck,
} from '@/lib/onlineDebugClient';
import { DeckLoader } from '@game/domain/card-data/deck-loader';
import { CardDataRegistry } from '@game/domain/card-data/loader';
import type { DeckConfig } from '@game/application/game-service';
import type { DebugMatchStatus, Seat } from '@game/online';
import type { AnyCardData } from '@game/domain/entities/card';

const DEBUG_MATCH_ID = (import.meta.env.VITE_DEBUG_MATCH_ID as string | undefined) ?? 'loveca-online-debug';
const DEBUG_SERVICE_NAME =
  (import.meta.env.VITE_DEBUG_SERVICE_NAME as string | undefined) ?? '联机调试';
const DEBUG_SEAT = import.meta.env.VITE_DEBUG_SEAT as Seat | undefined;
const STATUS_POLL_INTERVAL_MS = 1200;

function isUnauthorizedErrorMessage(message: string): boolean {
  return message.includes('未登录') || message.includes('登录已过期');
}

interface OnlineDebugPageProps {
  onBack: () => void;
}

export function OnlineDebugPage({ onBack }: OnlineDebugPageProps) {
  const cloudDecks = useDeckStore((s) => s.cloudDecks);
  const isLoadingCloud = useDeckStore((s) => s.isLoadingCloud);
  const cloudError = useDeckStore((s) => s.cloudError);
  const fetchCloudDecks = useDeckStore((s) => s.fetchCloudDecks);

  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);
  const connectRemoteDebugSession = useGameStore((s) => s.connectRemoteDebugSession);
  const disconnectRemoteDebugSession = useGameStore((s) => s.disconnectRemoteDebugSession);
  const syncRemoteDebugState = useGameStore((s) => s.syncRemoteDebugState);
  const remoteDebugSession = useGameStore((s) =>
    s.remoteSession?.source === 'DEBUG' ? s.remoteSession : null
  );
  const matchView = useGameStore((s) => s.getMatchView());

  const profile = useAuthStore((s) => s.profile);
  const offlineMode = useAuthStore((s) => s.offlineMode);
  const offlineUser = useAuthStore((s) => s.offlineUser);

  const [selectedDeck, setSelectedDeck] = useState<DeckDisplayItem | null>(null);
  const [status, setStatus] = useState<DebugMatchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pollingPaused, setPollingPaused] = useState(false);

  const mySeat = DEBUG_SEAT ?? null;
  const opponentSeat: Seat | null =
    mySeat === 'FIRST' ? 'SECOND' : mySeat === 'SECOND' ? 'FIRST' : null;
  const validDecks = useMemo(() => cloudDecks.filter((deck) => deck.is_valid), [cloudDecks]);
  const myStatus = mySeat && status ? status.seats[mySeat] : null;
  const opponentStatus = opponentSeat && status ? status.seats[opponentSeat] : null;
  const isMatchStarted = status?.started ?? false;
  const displayName = offlineMode
    ? offlineUser?.displayName || DEBUG_SERVICE_NAME
    : profile?.display_name || profile?.username || DEBUG_SERVICE_NAME;

  useEffect(() => {
    fetchCloudDecks();
  }, [fetchCloudDecks]);

  useEffect(() => {
    if (!mySeat || pollingPaused) {
      return;
    }

    let cancelled = false;

    const pollStatus = async () => {
      try {
        const nextStatus = await fetchOnlineDebugStatus(DEBUG_MATCH_ID);
        if (!cancelled) {
          setStatus(nextStatus);
          setError(null);
        }
      } catch (pollError) {
        if (!cancelled) {
          const message = pollError instanceof Error ? pollError.message : '读取调试状态失败';
          setError(message);
          if (isUnauthorizedErrorMessage(message)) {
            setPollingPaused(true);
            setStatus(null);
            disconnectRemoteDebugSession();
          }
        }
      }
    };

    void pollStatus();
    const timer = window.setInterval(() => {
      void pollStatus();
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [disconnectRemoteDebugSession, mySeat, pollingPaused]);

  useEffect(() => {
    if (!mySeat || !status) {
      return;
    }

    if (!status.started) {
      if (remoteDebugSession) {
        disconnectRemoteDebugSession();
      }
      return;
    }

    const seatStatus = status.seats[mySeat];
    if (
      !remoteDebugSession ||
      remoteDebugSession.matchId !== status.matchId ||
      remoteDebugSession.playerId !== seatStatus.playerId
    ) {
      connectRemoteDebugSession({
        matchId: status.matchId,
        seat: mySeat,
        playerId: seatStatus.playerId,
      });
    }

    void syncRemoteDebugState().catch((syncError) => {
      setError(syncError instanceof Error ? syncError.message : '同步调试对局失败');
    });
  }, [
    connectRemoteDebugSession,
    disconnectRemoteDebugSession,
    mySeat,
    remoteDebugSession,
    status,
    syncRemoteDebugState,
  ]);

  useEffect(() => {
    return () => {
      disconnectRemoteDebugSession();
    };
  }, [disconnectRemoteDebugSession]);

  const handleLockDeck = async () => {
    if (!mySeat || !selectedDeck?.cloudDeck) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setPollingPaused(false);

    try {
      const deck = buildApplicationDeckConfig(selectedDeck, cardDataRegistry);
      const nextStatus = await selectOnlineDebugDeck(DEBUG_MATCH_ID, {
        seat: mySeat,
        playerName: displayName,
        deckName: selectedDeck.name,
        deck,
      });
      setStatus(nextStatus);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '锁定调试卡组失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = async () => {
    setIsSubmitting(true);
    setError(null);
    setPollingPaused(false);

    try {
      const nextStatus = await resetOnlineDebugMatch(DEBUG_MATCH_ID);
      disconnectRemoteDebugSession();
      setStatus(nextStatus);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : '重置调试对局失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!mySeat) {
    return (
      <div className="app-shell flex min-h-screen flex-col">
        <PageHeader
          title="联机调试"
          icon={<Swords size={20} />}
          left={(
            <button onClick={onBack} className="button-ghost inline-flex h-10 items-center gap-2 px-3">
              <ArrowLeft size={16} />
              返回
            </button>
          )}
          right={<ThemeToggle />}
        />
        <main className="flex flex-1 items-center justify-center p-6">
          <div className="surface-panel-frosted max-w-xl p-6 text-center">
            <h2 className="mb-3 text-xl font-bold text-[var(--text-primary)]">当前构建未配置联机调试 seat</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              请使用 `debug-service1` 或 `debug-service2` 启动脚本进入调试入口。
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (isMatchStarted && matchView) {
    return (
      <div className="h-screen overflow-hidden">
        <GameBoard />
      </div>
    );
  }

  if (isMatchStarted) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center">
        <div className="surface-panel-frosted flex items-center gap-3 px-6 py-4 text-[var(--text-primary)]">
          <Loader2 size={18} className="animate-spin" />
          正在同步调试对局...
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <PageHeader
        title={DEBUG_SERVICE_NAME}
        icon={<Swords size={20} />}
        left={(
          <button onClick={onBack} className="button-ghost inline-flex h-10 items-center gap-2 px-3">
            <ArrowLeft size={16} />
            返回
          </button>
        )}
        right={<ThemeToggle />}
      />

      <main className="relative z-10 flex flex-1 justify-center px-4 pb-6 pt-5 sm:p-6">
        <div className="flex w-full max-w-5xl flex-col gap-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <DeckSelector
              cloudDecks={validDecks}
              selectedId={selectedDeck?.id}
              onSelect={setSelectedDeck}
              isLoading={isLoadingCloud}
              error={cloudError}
              onRefresh={fetchCloudDecks}
              title={`${DEBUG_SERVICE_NAME} 选择自己的卡组`}
              emptyText="没有可用卡组，请先创建一副合法卡组"
            />

            <div className="surface-panel-frosted flex flex-col gap-4 p-5">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] px-3 py-1 text-xs uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                  <Link2 size={12} />
                  Match {DEBUG_MATCH_ID}
                </div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">{DEBUG_SERVICE_NAME}</h2>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  当前固定座位：{mySeat === 'FIRST' ? '先攻 / 调试服务1' : '后攻 / 调试服务2'}
                </p>
              </div>

              <StatusCard
                title="你"
                label={myStatus?.playerName || displayName}
                ready={myStatus?.ready ?? false}
                deckName={myStatus?.deckName}
              />
              <StatusCard
                title="对手"
                label={opponentStatus?.playerName || (opponentSeat === 'FIRST' ? '调试服务1' : '调试服务2')}
                ready={opponentStatus?.ready ?? false}
                deckName={opponentStatus?.deckName}
              />

              {error && (
                <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] px-4 py-3 text-sm text-[var(--semantic-error)]">
                  {error}
                </div>
              )}

              <div className="mt-auto flex flex-col gap-3">
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={handleLockDeck}
                  disabled={!selectedDeck || isSubmitting}
                  className={`button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 ${!selectedDeck || isSubmitting ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
                  锁定我的卡组
                </motion.button>

                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isSubmitting}
                  className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] px-5"
                >
                  <RefreshCw size={16} />
                  重置调试房间
                </button>
              </div>
            </div>
          </div>

          <div className="surface-panel-frosted p-5 text-sm text-[var(--text-secondary)]">
            <p>使用方式：</p>
            <p>1. 在 `debug-service1` 和 `debug-service2` 两个端口分别打开此页面。</p>
            <p>2. 双方各自锁定一副卡组；两边都就绪后，会自动进入同一个调试对局。</p>
            <p>3. 对局过程中页面会持续轮询同步，不需要手动刷新。</p>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatusCard({
  title,
  label,
  ready,
  deckName,
}: {
  title: string;
  label: string;
  ready: boolean;
  deckName?: string | null;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-4">
      <div className="mb-1 text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">{title}</div>
      <div className="text-base font-semibold text-[var(--text-primary)]">{label}</div>
      <div className={`mt-2 text-sm ${ready ? 'text-[var(--semantic-success)]' : 'text-[var(--text-muted)]'}`}>
        {ready ? `已锁定：${deckName ?? '未命名卡组'}` : '等待锁定卡组'}
      </div>
    </div>
  );
}

function buildApplicationDeckConfig(
  selectedDeck: DeckDisplayItem,
  cardDataRegistry: Map<string, AnyCardData>
): DeckConfig {
  if (!selectedDeck.cloudDeck) {
    throw new Error('当前调试入口仅支持云端卡组');
  }

  const registry = new CardDataRegistry();
  registry.load(Array.from(cardDataRegistry.values()));
  const loader = new DeckLoader(registry);

  const members: { card_code: string; count: number }[] = [];
  const lives: { card_code: string; count: number }[] = [];
  for (const entry of selectedDeck.cloudDeck.main_deck || []) {
    if (entry.card_type === 'LIVE') {
      lives.push({ card_code: entry.card_code, count: entry.count });
    } else {
      members.push({ card_code: entry.card_code, count: entry.count });
    }
  }

  const config = {
    player_name: selectedDeck.cloudDeck.name,
    description: selectedDeck.cloudDeck.description || '',
    main_deck: { members, lives },
    energy_deck: selectedDeck.cloudDeck.energy_deck || [],
  };

  const loaded = loader.loadFromConfig(config);
  if (!loaded.success || !loaded.deck) {
    throw new Error(loaded.errors?.join(', ') || '卡组加载失败');
  }

  return {
    mainDeck: [...loaded.deck.mainDeck],
    energyDeck: [...loaded.deck.energyDeck],
  };
}
