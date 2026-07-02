import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  CircleDot,
  Crown,
  DoorOpen,
  Hand,
  HandFist,
  Loader2,
  RefreshCw,
  RotateCcw,
  Scissors,
  Shield,
  Swords,
  Users,
  X,
} from 'lucide-react';
import { DeckSelector, type DeckDisplayItem, PageHeader, ThemeToggle } from '@/components/common';
import { GameBoard } from '@/components/game';
import { PreMatchBriefingModal } from '@/components/game/PreMatchBriefingModal';
import { PublicBattleLogButton } from '@/components/game/PublicBattleLog';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import {
  acceptOnlineRoomRestart,
  cancelOnlineRoomRestart,
  createOnlineRoom,
  fetchOnlineMatchSnapshot,
  fetchOnlineRoom,
  joinOnlineRoom,
  leaveOnlineRoom,
  lockOnlineRoomDeck,
  chooseOnlineOpeningTurnOrder,
  readyOnlineRoomStart,
  replayOnlineOpeningRps,
  rejectOnlineRoomRestart,
  requestOnlineRoomRestart,
  submitOnlineOpeningRps,
} from '@/lib/onlineClient';
import { isDeckRecordValidForCurrentCardPool } from '@/lib/deckRecordUtils';
import type { OnlineRoomView, OpeningRpsGesture, OpeningTurnOrderChoice } from '@game/online';

const ROOM_POLL_INTERVAL_MS = 1200;
const MATCH_POLL_INTERVAL_MS = 800;
const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';

type OpeningRpsChoiceView = NonNullable<OnlineRoomView['openingRps']>['choices'][number];
type RpsToneClasses = {
  readonly bar: string;
  readonly border: string;
  readonly focus: string;
  readonly glow: string;
  readonly hover: string;
  readonly icon: string;
  readonly selected: string;
  readonly surface: string;
  readonly text: string;
};

interface OnlineRoomPageProps {
  onBack: () => void;
}

export function OnlineRoomPage({ onBack }: OnlineRoomPageProps) {
  const cloudDecks = useDeckStore((s) => s.cloudDecks);
  const isLoadingCloud = useDeckStore((s) => s.isLoadingCloud);
  const cloudError = useDeckStore((s) => s.cloudError);
  const fetchCloudDecks = useDeckStore((s) => s.fetchCloudDecks);

  const connectRemoteSession = useGameStore((s) => s.connectRemoteSession);
  const applyRemoteSnapshot = useGameStore((s) => s.applyRemoteSnapshot);
  const disconnectRemoteSession = useGameStore((s) => s.disconnectRemoteSession);
  const syncRemoteState = useGameStore((s) => s.syncRemoteState);
  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);
  const remoteSession = useGameStore((s) =>
    s.remoteSession?.source === 'ONLINE' ? s.remoteSession : null
  );
  const matchView = useGameStore((s) => s.getMatchView());

  const validDecks = useMemo(
    () => cloudDecks.filter((deck) => isDeckRecordValidForCurrentCardPool(deck, cardDataRegistry)),
    [cardDataRegistry, cloudDecks]
  );
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [joinedRoomCode, setJoinedRoomCode] = useState<string | null>(null);
  const [room, setRoom] = useState<OnlineRoomView | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<DeckDisplayItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBootstrappingMatch, setIsBootstrappingMatch] = useState(false);
  const [briefingAcknowledged, setBriefingAcknowledged] = useState(false);

  useEffect(() => {
    setBriefingAcknowledged(false);
  }, [room?.matchId]);

  useEffect(() => {
    fetchCloudDecks();
  }, [fetchCloudDecks]);

  useEffect(() => {
    const savedRoomCode = sessionStorage.getItem(ONLINE_ROOM_STORAGE_KEY);
    if (!savedRoomCode) {
      return;
    }

    setRoomCodeInput(savedRoomCode);
    setJoinedRoomCode(savedRoomCode);
  }, []);

  useEffect(() => {
    if (!joinedRoomCode) {
      return;
    }

    let cancelled = false;

    const pollRoom = async () => {
      try {
        const nextRoom = await fetchOnlineRoom(joinedRoomCode);
        if (!cancelled) {
          setRoom(nextRoom);
          setError(null);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : '读取房间状态失败');
        }
      }
    };

    void pollRoom();
    const timer = window.setInterval(() => {
      void pollRoom();
    }, ROOM_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [disconnectRemoteSession, joinedRoomCode]);

  useEffect(() => {
    if (!room?.matchId) {
      if (remoteSession) {
        disconnectRemoteSession();
      }
      return;
    }

    if (remoteSession?.matchId === room.matchId) {
      return;
    }

    let cancelled = false;
    setIsBootstrappingMatch(true);

    const bootstrapMatch = async () => {
      try {
        const snapshot = await fetchOnlineMatchSnapshot(room.matchId!);
        if (cancelled) {
          return;
        }

        connectRemoteSession({
          source: 'ONLINE',
          matchId: room.matchId!,
          seat: snapshot.seat,
          playerId: snapshot.playerId,
        });
        await applyRemoteSnapshot(snapshot);
        if (!cancelled) {
          setError(null);
        }
      } catch (bootstrapError) {
        if (!cancelled) {
          setError(bootstrapError instanceof Error ? bootstrapError.message : '同步联机对局失败');
        }
      } finally {
        if (!cancelled) {
          setIsBootstrappingMatch(false);
        }
      }
    };

    void bootstrapMatch();

    return () => {
      cancelled = true;
    };
  }, [
    applyRemoteSnapshot,
    connectRemoteSession,
    disconnectRemoteSession,
    remoteSession,
    room?.matchId,
  ]);

  useEffect(() => {
    if (room?.status !== 'IN_GAME' || !room.matchId || remoteSession?.matchId !== room.matchId) {
      return;
    }

    let cancelled = false;
    let polling = false;

    const pollMatch = async () => {
      if (polling) {
        return;
      }

      polling = true;
      try {
        await syncRemoteState();
        if (!cancelled) {
          setError(null);
        }
      } catch (pollError) {
        if (!cancelled) {
          setError(pollError instanceof Error ? pollError.message : '同步联机对局失败');
        }
      } finally {
        polling = false;
      }
    };

    void pollMatch();
    const timer = window.setInterval(() => {
      void pollMatch();
    }, MATCH_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [remoteSession?.matchId, room?.matchId, room?.status, syncRemoteState]);

  useEffect(() => {
    return () => {
      disconnectRemoteSession();
    };
  }, [disconnectRemoteSession]);

  const myMember = room?.members.find((member) => member.userId === room.currentUserId) ?? null;
  const opponentMember =
    room?.members.find((member) => member.userId !== room.currentUserId) ?? null;
  const restartRequest = room?.restartRequest ?? null;
  const isRestartRequester = Boolean(
    restartRequest && restartRequest.requesterUserId === room?.currentUserId
  );
  const isRestartResponder = Boolean(
    restartRequest && restartRequest.responderUserId === room?.currentUserId
  );
  const restartRequesterName = restartRequest
    ? room?.members.find((member) => member.userId === restartRequest.requesterUserId)
        ?.displayName ?? '对手'
    : null;
  const canRequestRestart = Boolean(
    room?.status === 'IN_GAME' && !restartRequest && opponentMember?.presence === 'ACTIVE'
  );
  const canLockDeck = Boolean(
    room && selectedDeck?.cloudDeck && room.status !== 'OPENING' && room.status !== 'IN_GAME'
  );
  const bothReady = Boolean(room && room.members.length === 2 && room.members.every((member) => member.ready));
  const canClearSavedRoom = Boolean(joinedRoomCode && !room);
  const actionState = getRoomActionState({
    room,
    myMember,
    bothReady,
  });

  const handleCreateRoom = async () => {
    const nextRoomCode = normalizeRoomCode(roomCodeInput);
    if (!nextRoomCode) {
      setError('请输入 4 到 12 位的大写字母或数字房间号');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await createOnlineRoom(nextRoomCode);
      persistOnlineRoomRecovery(nextRoom.roomCode);
      setJoinedRoomCode(nextRoom.roomCode);
      setRoom(nextRoom);
      setRoomCodeInput(nextRoom.roomCode);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建房间失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClearSavedRoomAndBack = () => {
    clearOnlineRoomRecovery();
    disconnectRemoteSession();
    setRoom(null);
    setJoinedRoomCode(null);
    setSelectedDeck(null);
    setRoomCodeInput('');
    setError(null);
    onBack();
  };

  const handleJoinRoom = async () => {
    const nextRoomCode = normalizeRoomCode(roomCodeInput);
    if (!nextRoomCode) {
      setError('请输入 4 到 12 位的大写字母或数字房间号');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await joinOnlineRoom(nextRoomCode);
      persistOnlineRoomRecovery(nextRoom.roomCode);
      setJoinedRoomCode(nextRoom.roomCode);
      setRoom(nextRoom);
      setRoomCodeInput(nextRoom.roomCode);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : '加入房间失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLockDeck = async () => {
    if (!room || !selectedDeck?.cloudDeck) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await lockOnlineRoomDeck(room.roomCode, selectedDeck.cloudDeck.id);
      setRoom(nextRoom);
    } catch (lockError) {
      setError(lockError instanceof Error ? lockError.message : '锁定卡组失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReadyStart = async () => {
    if (!room) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await readyOnlineRoomStart(room.roomCode);
      setRoom(nextRoom);
    } catch (readyError) {
      setError(readyError instanceof Error ? readyError.message : '准备开始失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitOpeningRps = async (gesture: OpeningRpsGesture) => {
    if (!room) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await submitOnlineOpeningRps(room.roomCode, gesture);
      setRoom(nextRoom);
    } catch (rpsError) {
      setError(rpsError instanceof Error ? rpsError.message : '提交猜拳失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReplayOpeningRps = async () => {
    if (!room) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await replayOnlineOpeningRps(room.roomCode);
      setRoom(nextRoom);
    } catch (rpsError) {
      setError(rpsError instanceof Error ? rpsError.message : '重新猜拳失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChooseOpeningTurnOrder = async (choice: OpeningTurnOrderChoice) => {
    if (!room) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await chooseOnlineOpeningTurnOrder(room.roomCode, choice);
      setRoom(nextRoom);
    } catch (choiceError) {
      setError(choiceError instanceof Error ? choiceError.message : '选择先后手失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLeaveRoom = async () => {
    if (!room && !joinedRoomCode) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await leaveOnlineRoom(room?.roomCode ?? joinedRoomCode!);
      clearOnlineRoomRecovery();
      disconnectRemoteSession();
      setRoom(null);
      setJoinedRoomCode(null);
      setSelectedDeck(null);
    } catch (leaveError) {
      setError(leaveError instanceof Error ? leaveError.message : '离开房间失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestRestart = async () => {
    if (!room) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await requestOnlineRoomRestart(room.roomCode);
      setRoom(nextRoom);
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : '请求重开失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAcceptRestart = async () => {
    if (!room?.restartRequest) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await acceptOnlineRoomRestart(
        room.roomCode,
        room.restartRequest.requestId
      );
      setRoom(nextRoom);
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : '同意重开失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectRestart = async () => {
    if (!room?.restartRequest) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await rejectOnlineRoomRestart(
        room.roomCode,
        room.restartRequest.requestId
      );
      setRoom(nextRoom);
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : '拒绝重开失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelRestart = async () => {
    if (!room?.restartRequest) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await cancelOnlineRoomRestart(
        room.roomCode,
        room.restartRequest.requestId
      );
      setRoom(nextRoom);
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : '取消重开失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (room?.status === 'IN_GAME' && remoteSession?.matchId === room.matchId && matchView) {
    return (
      <div className="relative h-screen overflow-hidden">
        <div className="absolute left-4 top-4 z-[120] flex max-w-[calc(100vw-2rem)] flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {!restartRequest && (
              <button
                type="button"
                onClick={handleRequestRestart}
                disabled={!canRequestRestart || isSubmitting}
                className={`button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-4 shadow-[var(--shadow-md)] backdrop-blur-xl ${
                  !canRequestRestart || isSubmitting ? 'cursor-not-allowed opacity-60' : ''
                }`}
                title={canRequestRestart ? '请求双方同意后重新开始' : '对手在线时可以请求重开'}
              >
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
                请求重开
              </button>
            )}
            {restartRequest && isRestartRequester && (
              <button
                type="button"
                onClick={handleCancelRestart}
                disabled={isSubmitting}
                className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-4 shadow-[var(--shadow-md)] backdrop-blur-xl"
              >
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                取消重开
              </button>
            )}
            <button
              type="button"
              onClick={handleLeaveRoom}
              disabled={isSubmitting}
              className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-4 shadow-[var(--shadow-md)] backdrop-blur-xl"
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <DoorOpen size={16} />}
              离开房间
            </button>
            <div className="hidden md:block">
              <PublicBattleLogButton />
            </div>
          </div>
          {restartRequest && (
            <div className="w-[min(420px,calc(100vw-2rem))] rounded-lg border border-[color:color-mix(in_srgb,var(--accent-primary)_38%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] px-3 py-3 text-sm text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-primary)]">
                    重开请求
                  </div>
                  <div className="mt-1 font-semibold">
                    {isRestartRequester ? '已发送重开请求' : `${restartRequesterName} 请求重开`}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                    {isRestartRequester
                      ? '等待对手同意；同意后会创建一局新对局。'
                      : '同意后会封存当前对局，并在同一房间创建新对局。'}
                  </div>
                </div>
                <RotateCcw size={18} className="mt-0.5 shrink-0 text-[var(--accent-primary)]" />
              </div>
              {isRestartResponder && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleRejectRestart}
                    disabled={isSubmitting}
                    className="button-ghost inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] px-3 text-sm"
                  >
                    拒绝
                  </button>
                  <button
                    type="button"
                    onClick={handleAcceptRestart}
                    disabled={isSubmitting}
                    className="button-primary inline-flex min-h-10 items-center justify-center gap-2 px-3 text-sm"
                  >
                    同意重开
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <GameBoard showDesktopPublicBattleLogButton={false} />
        <PreMatchBriefingModal
          isOpen={!briefingAcknowledged}
          mode="online"
          onClose={() => setBriefingAcknowledged(true)}
        />
      </div>
    );
  }

  if (room?.status === 'OPENING') {
    return (
      <OnlineOpeningStage
        room={room}
        error={error}
        isSubmitting={isSubmitting}
        onSubmitRps={handleSubmitOpeningRps}
        onReplayRps={handleReplayOpeningRps}
        onChooseTurnOrder={handleChooseOpeningTurnOrder}
        onLeaveRoom={handleLeaveRoom}
      />
    );
  }

  if (room?.status === 'IN_GAME' && isBootstrappingMatch) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center">
        <div className="surface-panel-frosted flex items-center gap-3 px-6 py-4 text-[var(--text-primary)]">
          <Loader2 size={18} className="animate-spin" />
          正在同步联机对局...
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <PageHeader
        title="正式联机"
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
        <div className="flex w-full max-w-6xl flex-col gap-6">
          <div className="surface-panel-frosted flex flex-col gap-4 p-5 lg:flex-row lg:items-end">
            <div className="flex-1">
              <div className="mb-2 text-xs uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                Room Code
              </div>
              <input
                value={roomCodeInput}
                onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
                placeholder="输入 4-12 位房间号"
                className="w-full rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] px-4 py-3 text-lg font-semibold tracking-[0.12em] text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)]"
                maxLength={12}
              />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleCreateRoom}
                disabled={isSubmitting}
                className="button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5"
              >
                {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Users size={16} />}
                创建房间
              </button>
              <button
                type="button"
                onClick={handleJoinRoom}
                disabled={isSubmitting}
                className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] px-5"
              >
                <DoorOpen size={16} />
                加入房间
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <DeckSelector
              cloudDecks={validDecks}
              selectedId={selectedDeck?.id}
              onSelect={setSelectedDeck}
              isLoading={isLoadingCloud}
              error={cloudError}
              onRefresh={fetchCloudDecks}
              title="选择并锁定自己的云端卡组"
              emptyText="没有可用的合法卡组，请先创建一副合法卡组"
            />

            <div className="surface-panel-frosted flex flex-col gap-4 p-5">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] px-3 py-1 text-xs uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                  <Users size={12} />
                  {room ? `Room ${room.roomCode}` : '等待加入房间'}
                </div>
                <h2 className="text-xl font-bold text-[var(--text-primary)]">
                  {room ? getRoomStatusLabel(room.status) : '正式联机房间'}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                  双方锁组并准备后进入开局猜拳。
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-2">
                <ProgressPill label="进入房间" active={Boolean(room)} done={Boolean(room)} />
                <ProgressPill label="锁定卡组" active={Boolean(room) && !bothReady} done={bothReady} />
                <ProgressPill
                  label="正式开局"
                  active={Boolean(room) && bothReady}
                  done={room?.status === 'IN_GAME'}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <RoomMemberCard
                  title="你"
                  member={myMember}
                  isCurrentUser
                  selectedDeckName={selectedDeck?.name}
                />
                <RoomMemberCard
                  title="对手"
                  member={opponentMember}
                />
              </div>

              {room && (
                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        当前动作
                      </div>
                      <div className="mt-1 text-base font-semibold text-[var(--text-primary)]">
                        {actionState.title}
                      </div>
                    </div>
                    <div className="rounded-full border border-[var(--border-default)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                      {getRoomStatusLabel(room.status)}
                    </div>
                  </div>
                  {actionState.detail && (
                    <div className="mt-2 text-sm text-[var(--text-secondary)]">
                      {actionState.detail}
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] px-4 py-3 text-sm text-[var(--semantic-error)]">
                  <div>{error}</div>
                  {canClearSavedRoom && (
                    <button
                      type="button"
                      onClick={handleClearSavedRoomAndBack}
                      className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] px-3 py-2 text-sm font-semibold text-[var(--semantic-error)] transition hover:bg-[color:color-mix(in_srgb,var(--semantic-error)_10%,transparent)]"
                    >
                      清除保存房间并返回首页
                    </button>
                  )}
                </div>
              )}

              <div className="mt-auto flex flex-col gap-3">
                {room && !myMember?.ready && (
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={handleLockDeck}
                    disabled={!canLockDeck || isSubmitting}
                    className={`button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 ${!canLockDeck || isSubmitting ? 'cursor-not-allowed opacity-50' : ''}`}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    锁定这副卡组
                  </motion.button>
                )}

                {room && myMember?.ready && bothReady && (
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    type="button"
                    onClick={handleReadyStart}
                    disabled={isSubmitting || myMember.startReady}
                    className={`button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 ${
                      isSubmitting || myMember.startReady ? 'cursor-not-allowed opacity-60' : ''
                    }`}
                  >
                    {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Swords size={16} />}
                    {myMember.startReady ? '已准备开始' : '准备开始'}
                  </motion.button>
                )}

                {joinedRoomCode && (
                  <button
                    type="button"
                    onClick={handleLeaveRoom}
                    disabled={isSubmitting}
                    className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] px-5"
                  >
                    <RefreshCw size={16} />
                    离开房间
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function RoomMemberCard({
  title,
  member,
  isCurrentUser = false,
  selectedDeckName,
}: {
  title: string;
  member: OnlineRoomView['members'][number] | null;
  isCurrentUser?: boolean;
  selectedDeckName?: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{title}</div>
          <div className="text-base font-semibold text-[var(--text-primary)]">
            {member?.displayName ?? '等待加入'}
          </div>
        </div>
        {member?.role === 'HOST' && (
          <div className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
            <Crown size={12} />
            房主
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <StatusChip
          tone={member?.presence === 'LEFT' ? 'warning' : member ? 'success' : 'muted'}
          label={member ? (member.presence === 'LEFT' ? '已离开' : isCurrentUser ? '已加入' : '在线') : '空位'}
        />
        <StatusChip
          tone={member?.ready ? 'success' : 'muted'}
          label={member?.ready ? '已锁组' : '未锁组'}
        />
        {member?.ready && (
          <StatusChip
            tone={member.startReady ? 'success' : 'muted'}
            label={member.startReady ? '已准备' : '未准备'}
          />
        )}
        {member?.seat && <StatusChip tone="muted" label={member.seat === 'FIRST' ? '先手位' : '后手位'} />}
      </div>

      {isCurrentUser && !member?.ready && selectedDeckName && (
        <div className="mt-3 rounded-xl border border-dashed border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-secondary)]">
          当前选择：<span className="font-medium text-[var(--text-primary)]">{selectedDeckName}</span>
        </div>
      )}

      {member?.ready && (
        <div className="mt-3 text-sm text-[var(--text-secondary)]">
          {member.lockedDeckName ?? '未命名卡组'}
        </div>
      )}
    </div>
  );
}

function OnlineOpeningStage({
  room,
  error,
  isSubmitting,
  onSubmitRps,
  onReplayRps,
  onChooseTurnOrder,
  onLeaveRoom,
}: {
  room: OnlineRoomView;
  error: string | null;
  isSubmitting: boolean;
  onSubmitRps: (gesture: OpeningRpsGesture) => void;
  onReplayRps: () => void;
  onChooseTurnOrder: (choice: OpeningTurnOrderChoice) => void;
  onLeaveRoom: () => void;
}) {
  const opening = room.openingRps;
  const myMember = room.members.find((member) => member.userId === room.currentUserId) ?? null;
  const opponentMember = room.members.find((member) => member.userId !== room.currentUserId) ?? null;
  const myChoice = opening?.choices.find((choice) => choice.userId === room.currentUserId) ?? null;
  const opponentChoice =
    opening?.choices.find((choice) => choice.userId !== room.currentUserId) ?? null;
  const winnerName = opening?.winnerUserId
    ? room.members.find((member) => member.userId === opening.winnerUserId)?.displayName ?? '胜者'
    : null;
  const chooserIsMe = opening?.chooserUserId === room.currentUserId;
  const isDraw = Boolean(opening?.revealed && !opening.winnerUserId);
  const reduceMotion = useReducedMotion();
  const statusText = getOpeningStatusText({
    opening,
    myChoice,
    opponentChoice,
    winnerName,
    chooserIsMe,
  });

  return (
    <div className="app-shell min-h-screen overflow-hidden">
      <div className="relative z-10 flex min-h-screen flex-col px-3 py-3 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)] backdrop-blur-xl">
            <Swords size={14} />
            Room {room.roomCode}
          </div>
          <button
            type="button"
            onClick={onLeaveRoom}
            disabled={isSubmitting}
            className="button-ghost inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-4 backdrop-blur-xl"
          >
            <DoorOpen size={15} />
            离开房间
          </button>
        </div>

        <main className="flex flex-1 items-start justify-center py-3 lg:items-center lg:py-5">
          <section className="relative w-full max-w-6xl overflow-hidden rounded-2xl border border-[color:color-mix(in_srgb,var(--accent-primary)_28%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--bg-surface)_90%,transparent)] shadow-[var(--shadow-lg)]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,color-mix(in_srgb,var(--accent-primary)_14%,transparent),transparent_28%),radial-gradient(circle_at_82%_14%,color-mix(in_srgb,var(--semantic-info)_12%,transparent),transparent_30%),linear-gradient(180deg,color-mix(in_srgb,var(--accent-primary)_5%,transparent),transparent_42%)]" />
            <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--accent-primary),var(--semantic-info),var(--accent-secondary),var(--semantic-success))]" />
            <div className="relative grid gap-3 p-3 sm:gap-5 sm:p-6 lg:min-h-[560px] lg:grid-rows-[auto_1fr_auto]">
              <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
                <div>
                  <h1 className="text-xl font-black text-[var(--text-primary)] sm:text-3xl lg:text-4xl">
                    开局猜拳
                  </h1>
                  <p className="mt-1 max-w-2xl text-xs font-semibold text-[var(--text-secondary)] sm:mt-2 sm:text-sm sm:leading-relaxed">
                    {statusText}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_84%,transparent)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] sm:gap-2 sm:px-3 sm:py-2 sm:text-sm">
                    <CircleDot size={14} className="text-[var(--accent-primary)]" />
                    第 {opening?.round ?? 1} 轮
                  </div>
                  {opening?.revealed && winnerName && (
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-[color:color-mix(in_srgb,var(--semantic-success)_38%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_12%,transparent)] px-2.5 py-1.5 text-xs font-semibold text-[var(--semantic-success)] sm:gap-2 sm:px-3 sm:py-2 sm:text-sm">
                      <Crown size={14} />
                      {winnerName}
                    </div>
                  )}
                </div>
              </div>

              <div className="order-3 grid grid-cols-[minmax(0,1fr)_42px_minmax(0,1fr)] items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_52px_minmax(0,1fr)] lg:order-2 lg:grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)] lg:gap-4">
                <OpeningPlayerPanel
                  title="你"
                  member={myMember}
                  choice={myChoice}
                  revealed={Boolean(opening?.revealed)}
                  winnerUserId={opening?.winnerUserId ?? null}
                  reduceMotion={reduceMotion}
                />
                <div className="flex min-h-0 flex-row items-center justify-center gap-1 lg:min-h-[260px] lg:flex-col lg:gap-3">
                  <div className="hidden h-px flex-1 bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--accent-primary)_32%,transparent),transparent)] lg:block lg:h-full lg:w-px lg:flex-none lg:bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--accent-primary)_32%,transparent),transparent)]" />
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--accent-primary)_46%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-surface)_86%,transparent)] text-[var(--accent-primary)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent-primary)_6%,transparent),0_0_18px_color-mix(in_srgb,var(--accent-primary)_14%,transparent)] sm:h-12 sm:w-12 lg:h-16 lg:w-16 lg:shadow-[0_0_0_6px_color-mix(in_srgb,var(--accent-primary)_7%,transparent),0_0_28px_color-mix(in_srgb,var(--accent-primary)_18%,transparent)]">
                    <div className="absolute inset-1 rounded-full border border-[color:color-mix(in_srgb,var(--accent-secondary)_24%,transparent)]" />
                    <Swords size={18} className="lg:hidden" />
                    <Swords size={23} className="hidden lg:block" />
                  </div>
                  <div className="hidden h-px flex-1 bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--semantic-info)_32%,transparent),transparent)] lg:block lg:h-full lg:w-px lg:flex-none lg:bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--semantic-info)_32%,transparent),transparent)]" />
                </div>
                <OpeningPlayerPanel
                  title="对手"
                  member={opponentMember}
                  choice={opponentChoice}
                  revealed={Boolean(opening?.revealed)}
                  winnerUserId={opening?.winnerUserId ?? null}
                  reduceMotion={reduceMotion}
                />
              </div>

              <div className="order-2 grid gap-3 lg:order-3">
                <OpeningRpsControls
                  opening={opening}
                  myChoice={myChoice}
                  isSubmitting={isSubmitting}
                  chooserIsMe={chooserIsMe}
                  winnerName={winnerName}
                  isDraw={isDraw}
                  reduceMotion={reduceMotion}
                  onSubmitRps={onSubmitRps}
                  onReplayRps={onReplayRps}
                  onChooseTurnOrder={onChooseTurnOrder}
                />
                {error && (
                  <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] px-4 py-3 text-sm text-[var(--semantic-error)]">
                    {error}
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function OpeningPlayerPanel({
  title,
  member,
  choice,
  revealed,
  winnerUserId,
  reduceMotion,
}: {
  title: string;
  member: OnlineRoomView['members'][number] | null;
  choice: OpeningRpsChoiceView | null;
  revealed: boolean;
  winnerUserId: string | null;
  reduceMotion: boolean | null;
}) {
  const isWinner = Boolean(member && winnerUserId === member.userId);
  const hasWinner = Boolean(winnerUserId);
  const tone = choice?.gesture ? getRpsToneClasses(choice.gesture) : null;
  const label = choice?.gesture ? getRpsLabel(choice.gesture) : choice?.selected ? '锁定' : '未选';
  const status = revealed
    ? isWinner
      ? '胜者'
      : hasWinner
        ? '待开局'
        : '平局'
    : choice?.selected
      ? '等待'
      : '未选';
  const panelClass = isWinner
    ? 'border-[color:color-mix(in_srgb,var(--semantic-success)_58%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-success)_8%,var(--bg-overlay))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--semantic-success)_28%,transparent),0_18px_44px_color-mix(in_srgb,var(--semantic-success)_12%,transparent)]'
    : choice?.selected
      ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_34%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_5%,var(--bg-overlay))]'
      : 'border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_88%,transparent)]';
  const iconClass = tone
    ? `border-transparent ${tone.surface} ${tone.text} shadow-[0_16px_34px_color-mix(in_srgb,var(--accent-primary)_10%,transparent)]`
    : choice?.selected
      ? 'border-transparent bg-[color:color-mix(in_srgb,var(--semantic-warning)_12%,var(--bg-surface))] text-[var(--semantic-warning)]'
      : 'border-transparent bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] text-[var(--text-muted)]';

  return (
    <motion.div
      layout
      className={`relative flex min-h-[86px] items-center justify-between gap-2 overflow-hidden rounded-xl border p-2 transition-all duration-300 sm:min-h-[96px] sm:p-3 lg:min-h-[260px] lg:flex-col lg:items-stretch lg:justify-between lg:rounded-2xl lg:p-4 ${panelClass}`}
    >
      <div
        className={`absolute inset-x-0 top-0 h-1 ${
          isWinner
            ? 'bg-[linear-gradient(90deg,var(--semantic-success),var(--heart-green))]'
            : tone?.bar ?? 'bg-[color:color-mix(in_srgb,var(--border-default)_80%,transparent)]'
          }`}
      />
      <div className="min-w-0">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] sm:text-xs lg:tracking-[0.16em]">{title}</div>
          <div className="mt-0.5 truncate text-sm font-bold text-[var(--text-primary)] sm:text-base lg:mt-1 lg:text-lg">
            {member?.displayName ?? '等待玩家'}
          </div>
        </div>
        {isWinner && (
          <div className="mt-1 hidden w-fit rounded-full border border-[color:color-mix(in_srgb,var(--semantic-success)_40%,transparent)] px-2 py-1 text-xs font-semibold text-[var(--semantic-success)] lg:block">
            胜者
          </div>
        )}
      </div>

      <motion.div
        key={`${choice?.gesture ?? 'hidden'}:${revealed ? 'shown' : 'locked'}:${choice?.selected ? 'ready' : 'wait'}`}
        initial={reduceMotion ? false : { opacity: 0.72, y: 10, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: isWinner && !reduceMotion ? 1.04 : 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.22 }}
        className="flex shrink-0 items-center justify-end gap-2 py-0 lg:flex-col lg:justify-center lg:gap-3 lg:py-6"
      >
        <div
          className={`relative flex h-10 w-10 items-center justify-center rounded-xl border transition-all duration-300 sm:h-12 sm:w-12 lg:h-32 lg:w-32 lg:rounded-2xl ${iconClass}`}
        >
          {isWinner && (
            <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--semantic-success)] text-white shadow-[0_8px_20px_color-mix(in_srgb,var(--semantic-success)_28%,transparent)] lg:-right-2 lg:-top-2 lg:h-8 lg:w-8">
              <Crown size={11} className="lg:hidden" />
              <Crown size={16} className="hidden lg:block" />
            </div>
          )}
          <span className="lg:hidden">
            {choice?.gesture ? getRpsIcon(choice.gesture, 26) : <Shield size={22} />}
          </span>
          <span className="hidden lg:block">
            {choice?.gesture ? getRpsIcon(choice.gesture, 60) : <Shield size={44} />}
          </span>
        </div>
        <div className="min-w-0 text-right lg:text-center">
          <div className="truncate text-sm font-black text-[var(--text-primary)] sm:text-base lg:text-lg">{label}</div>
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] lg:mt-1 lg:text-xs lg:tracking-[0.14em]">
            {status}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function OpeningRpsControls({
  opening,
  myChoice,
  isSubmitting,
  chooserIsMe,
  winnerName,
  isDraw,
  reduceMotion,
  onSubmitRps,
  onReplayRps,
  onChooseTurnOrder,
}: {
  opening: OnlineRoomView['openingRps'];
  myChoice: OpeningRpsChoiceView | null;
  isSubmitting: boolean;
  chooserIsMe: boolean;
  winnerName: string | null;
  isDraw: boolean;
  reduceMotion: boolean | null;
  onSubmitRps: (gesture: OpeningRpsGesture) => void;
  onReplayRps: () => void;
  onChooseTurnOrder: (choice: OpeningTurnOrderChoice) => void;
}) {
  if (!opening) {
    return (
      <div className="flex min-h-24 items-center justify-center gap-3 rounded-2xl border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_88%,transparent)] text-sm text-[var(--text-secondary)]">
        <Loader2 size={16} className="animate-spin" />
        正在建立开局流程...
      </div>
    );
  }

  if (!opening.revealed) {
    const locked = Boolean(myChoice?.selected);

    return (
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_70%,transparent)] p-2.5 sm:p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 sm:mb-3">
          <div>
            <div className="text-sm font-bold text-[var(--text-primary)]">
              {locked ? '已锁定' : '选择手势'}
            </div>
          </div>
          {isSubmitting && (
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--accent-primary)_32%,transparent)] px-3 py-1 text-xs font-semibold text-[var(--accent-primary)]">
              <Loader2 size={13} className="animate-spin" />
              提交中
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {(['ROCK', 'SCISSORS', 'PAPER'] as const).map((gesture) => (
            <OpeningGestureButton
              key={gesture}
              gesture={gesture}
              selected={myChoice?.gesture === gesture}
              disabled={isSubmitting || locked}
              reduceMotion={reduceMotion}
              onClick={() => onSubmitRps(gesture)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (isDraw) {
    return (
      <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-warning)_34%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-warning)_8%,var(--bg-overlay))] p-3 sm:rounded-2xl sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-base font-bold text-[var(--text-primary)]">平局</div>
          </div>
          <motion.button
            whileHover={!isSubmitting && !reduceMotion ? { y: -2, scale: 1.01 } : undefined}
            whileTap={!isSubmitting && !reduceMotion ? { y: 1, scale: 0.985 } : undefined}
            type="button"
            onClick={onReplayRps}
            disabled={isSubmitting}
            className={`button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 ${
              isSubmitting ? 'cursor-not-allowed opacity-60' : ''
            }`}
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
            再来
          </motion.button>
        </div>
      </div>
    );
  }

  if (!chooserIsMe) {
    return (
      <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-success)_32%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-success)_7%,var(--bg-overlay))] p-3 sm:rounded-2xl sm:p-4">
        <div className="flex min-h-14 items-center justify-between gap-4 sm:min-h-20">
          <div>
            <div className="text-base font-bold text-[var(--text-primary)]">胜者：{winnerName}</div>
            <div className="mt-1 text-sm text-[var(--text-secondary)]">等待选择</div>
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--accent-primary)_34%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)]">
            <Loader2 size={18} className="animate-spin text-[var(--accent-primary)]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-success)_36%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-success)_7%,var(--bg-overlay))] p-2.5 sm:rounded-2xl sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 sm:mb-3">
        <div>
          <div className="text-base font-bold text-[var(--text-primary)]">选择先后手</div>
        </div>
        {isSubmitting && (
          <div className="inline-flex items-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--semantic-success)_36%,transparent)] px-3 py-1 text-xs font-semibold text-[var(--semantic-success)]">
            <Loader2 size={13} className="animate-spin" />
            开局中
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <OpeningTurnOrderButton
          title="我先手"
          icon={isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Swords size={18} />}
          disabled={isSubmitting}
          reduceMotion={reduceMotion}
          tone="primary"
          onClick={() => onChooseTurnOrder('SELF_FIRST')}
        />
        <OpeningTurnOrderButton
          title="我后手"
          icon={<Shield size={18} />}
          disabled={isSubmitting}
          reduceMotion={reduceMotion}
          tone="info"
          onClick={() => onChooseTurnOrder('SELF_SECOND')}
        />
      </div>
    </div>
  );
}

function OpeningGestureButton({
  gesture,
  selected,
  disabled,
  reduceMotion,
  onClick,
}: {
  gesture: OpeningRpsGesture;
  selected: boolean;
  disabled: boolean;
  reduceMotion: boolean | null;
  onClick: () => void;
}) {
  const tone = getRpsToneClasses(gesture);

  return (
    <motion.button
      whileHover={!disabled && !reduceMotion ? { y: -4, scale: 1.015 } : undefined}
      whileTap={!disabled && !reduceMotion ? { y: 1, scale: 0.985 } : undefined}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={getRpsLabel(gesture)}
      className={`group relative flex min-h-[72px] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border px-2 py-2 text-center outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-deep)] sm:min-h-[104px] sm:flex-row sm:gap-4 sm:px-5 sm:py-4 sm:text-left ${
        selected ? tone.selected : `border-transparent bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] text-[var(--text-secondary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border-default)_56%,transparent)] ${tone.hover}`
      } ${tone.focus} ${
        disabled && !selected ? 'cursor-not-allowed opacity-55' : disabled ? 'cursor-default' : 'cursor-pointer'
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200 sm:h-16 sm:w-16 sm:rounded-2xl ${
          selected ? `${tone.icon} ${tone.glow}` : `${tone.icon} group-hover:scale-105`
        }`}
      >
        <span className="sm:hidden">{getRpsIcon(gesture, 26)}</span>
        <span className="hidden sm:block">{getRpsIcon(gesture, 46)}</span>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-black leading-tight text-[var(--text-primary)] sm:text-lg">{getRpsLabel(gesture)}</div>
      </div>
      {selected && (
        <div className="absolute right-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] px-1 text-[10px] font-black text-white shadow-[var(--shadow-md)] sm:right-2 sm:top-2 sm:h-6 sm:min-w-6">
          <Check size={11} className="sm:hidden" />
          <Check size={13} className="hidden sm:block" />
        </div>
      )}
    </motion.button>
  );
}

function OpeningTurnOrderButton({
  title,
  detail,
  icon,
  disabled,
  reduceMotion,
  tone,
  onClick,
}: {
  title: string;
  detail?: string;
  icon: ReactNode;
  disabled: boolean;
  reduceMotion: boolean | null;
  tone: 'primary' | 'info';
  onClick: () => void;
}) {
  const toneClass =
    tone === 'primary'
      ? {
          border: 'border-[color:color-mix(in_srgb,var(--accent-primary)_42%,var(--border-default))]',
          focus: 'focus-visible:ring-[var(--accent-primary)]',
          hover: 'hover:-translate-y-1 hover:border-[color:color-mix(in_srgb,var(--accent-primary)_64%,var(--border-default))] hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_14%,var(--bg-surface))] hover:shadow-[0_16px_36px_color-mix(in_srgb,var(--accent-primary)_18%,transparent)]',
          icon: 'border-[color:color-mix(in_srgb,var(--accent-primary)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_14%,var(--bg-surface))] text-[var(--accent-primary)]',
          line: 'bg-[linear-gradient(180deg,var(--accent-primary),var(--accent-secondary))]',
        }
      : {
          border: 'border-[color:color-mix(in_srgb,var(--semantic-info)_42%,var(--border-default))]',
          focus: 'focus-visible:ring-[var(--semantic-info)]',
          hover: 'hover:-translate-y-1 hover:border-[color:color-mix(in_srgb,var(--semantic-info)_64%,var(--border-default))] hover:bg-[color:color-mix(in_srgb,var(--semantic-info)_12%,var(--bg-surface))] hover:shadow-[0_16px_36px_color-mix(in_srgb,var(--semantic-info)_18%,transparent)]',
          icon: 'border-[color:color-mix(in_srgb,var(--semantic-info)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-info)_13%,var(--bg-surface))] text-[var(--semantic-info)]',
          line: 'bg-[linear-gradient(180deg,var(--semantic-info),var(--heart-blue))]',
        };
  const buttonClass = `group relative min-h-14 overflow-hidden rounded-xl border bg-[color:color-mix(in_srgb,var(--bg-surface)_78%,transparent)] p-3 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-deep)] sm:min-h-16 sm:rounded-2xl sm:p-4 ${toneClass.border} ${toneClass.focus} ${
    disabled ? 'cursor-not-allowed opacity-65' : toneClass.hover
  }`;

  return (
    <motion.button
      whileHover={!disabled && !reduceMotion ? { y: -4, scale: 1.012 } : undefined}
      whileTap={!disabled && !reduceMotion ? { y: 1, scale: 0.985 } : undefined}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={buttonClass}
    >
      <div className={`absolute inset-y-2 left-0 w-1 rounded-r-full sm:inset-y-3 ${toneClass.line}`} />
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        <div>
          <div className="text-sm font-black text-[var(--text-primary)] sm:text-lg">{title}</div>
          {detail && <div className="mt-1 text-sm text-[var(--text-secondary)]">{detail}</div>}
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-transform duration-200 group-hover:scale-105 sm:h-11 sm:w-11 sm:rounded-xl ${toneClass.icon}`}>
          {icon}
        </div>
      </div>
    </motion.button>
  );
}

function getOpeningStatusText({
  opening,
  myChoice,
  opponentChoice,
  winnerName,
  chooserIsMe,
}: {
  opening: OnlineRoomView['openingRps'];
  myChoice: OpeningRpsChoiceView | null;
  opponentChoice: OpeningRpsChoiceView | null;
  winnerName: string | null;
  chooserIsMe: boolean;
}): string {
  if (!opening) {
    return '同步中';
  }
  if (!opening.revealed) {
    if (myChoice?.selected && opponentChoice?.selected) {
      return '公开中';
    }
    if (myChoice?.selected) {
      return '等待对手';
    }
    if (opponentChoice?.selected) {
      return '轮到你';
    }
    return '选择手势';
  }
  if (!opening.winnerUserId) {
    return '平局';
  }
  if (chooserIsMe) {
    return '选择先后手';
  }
  return `${winnerName ?? '胜者'}选择中`;
}

function ProgressPill({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <div
      className={`rounded-xl px-3 py-2 text-center text-xs font-medium transition ${
        done
          ? 'bg-[color:color-mix(in_srgb,var(--semantic-success)_16%,var(--bg-surface))] text-[var(--semantic-success)]'
          : active
            ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] text-[var(--text-primary)]'
            : 'bg-transparent text-[var(--text-muted)]'
      }`}
    >
      {label}
    </div>
  );
}

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: 'success' | 'warning' | 'muted';
}) {
  const className =
    tone === 'success'
      ? 'border-[color:color-mix(in_srgb,var(--semantic-success)_32%,transparent)] text-[var(--semantic-success)]'
      : tone === 'warning'
        ? 'border-[color:color-mix(in_srgb,var(--semantic-warning)_32%,transparent)] text-[var(--semantic-warning)]'
        : 'border-[var(--border-default)] text-[var(--text-muted)]';

  return (
    <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${className}`}>
      <CircleDot size={10} />
      {label}
    </div>
  );
}

function getRpsLabel(gesture: OpeningRpsGesture): string {
  switch (gesture) {
    case 'ROCK':
      return '石头';
    case 'PAPER':
      return '布';
    case 'SCISSORS':
      return '剪刀';
    default:
      return gesture;
  }
}

function getRpsToneClasses(gesture: OpeningRpsGesture): RpsToneClasses {
  switch (gesture) {
    case 'ROCK':
      return {
        bar: 'bg-[linear-gradient(90deg,var(--accent-primary),var(--accent-secondary))]',
        border: 'border-[color:color-mix(in_srgb,var(--accent-primary)_46%,var(--border-default))]',
        focus: 'focus-visible:ring-[var(--accent-primary)]',
        glow: 'shadow-[0_10px_24px_color-mix(in_srgb,var(--accent-primary)_22%,transparent)]',
        hover:
          'hover:-translate-y-0.5 hover:border-[color:color-mix(in_srgb,var(--accent-primary)_40%,var(--border-default))] hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_8%,var(--bg-surface))] hover:shadow-[0_12px_28px_color-mix(in_srgb,var(--accent-primary)_13%,transparent)]',
        icon:
          'bg-[color:color-mix(in_srgb,var(--accent-primary)_13%,var(--bg-surface))] text-[var(--accent-primary)]',
        selected:
          'border-[color:color-mix(in_srgb,var(--accent-primary)_48%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] text-[var(--text-primary)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_18%,transparent),0_14px_30px_color-mix(in_srgb,var(--accent-primary)_14%,transparent)]',
        surface:
          'bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))]',
        text: 'text-[var(--accent-primary)]',
      };
    case 'SCISSORS':
      return {
        bar: 'bg-[linear-gradient(90deg,var(--semantic-info),var(--heart-blue))]',
        border: 'border-[color:color-mix(in_srgb,var(--semantic-info)_46%,var(--border-default))]',
        focus: 'focus-visible:ring-[var(--semantic-info)]',
        glow: 'shadow-[0_10px_24px_color-mix(in_srgb,var(--semantic-info)_22%,transparent)]',
        hover:
          'hover:-translate-y-0.5 hover:border-[color:color-mix(in_srgb,var(--semantic-info)_40%,var(--border-default))] hover:bg-[color:color-mix(in_srgb,var(--semantic-info)_8%,var(--bg-surface))] hover:shadow-[0_12px_28px_color-mix(in_srgb,var(--semantic-info)_13%,transparent)]',
        icon:
          'bg-[color:color-mix(in_srgb,var(--semantic-info)_13%,var(--bg-surface))] text-[var(--semantic-info)]',
        selected:
          'border-[color:color-mix(in_srgb,var(--semantic-info)_48%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-info)_12%,var(--bg-surface))] text-[var(--text-primary)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--semantic-info)_18%,transparent),0_14px_30px_color-mix(in_srgb,var(--semantic-info)_14%,transparent)]',
        surface:
          'bg-[color:color-mix(in_srgb,var(--semantic-info)_12%,var(--bg-surface))]',
        text: 'text-[var(--semantic-info)]',
      };
    case 'PAPER':
      return {
        bar: 'bg-[linear-gradient(90deg,var(--semantic-warning),var(--accent-gold))]',
        border: 'border-[color:color-mix(in_srgb,var(--semantic-warning)_46%,var(--border-default))]',
        focus: 'focus-visible:ring-[var(--semantic-warning)]',
        glow: 'shadow-[0_10px_24px_color-mix(in_srgb,var(--semantic-warning)_22%,transparent)]',
        hover:
          'hover:-translate-y-0.5 hover:border-[color:color-mix(in_srgb,var(--semantic-warning)_42%,var(--border-default))] hover:bg-[color:color-mix(in_srgb,var(--semantic-warning)_9%,var(--bg-surface))] hover:shadow-[0_12px_28px_color-mix(in_srgb,var(--semantic-warning)_13%,transparent)]',
        icon:
          'bg-[color:color-mix(in_srgb,var(--semantic-warning)_14%,var(--bg-surface))] text-[var(--semantic-warning)]',
        selected:
          'border-[color:color-mix(in_srgb,var(--semantic-warning)_50%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-warning)_13%,var(--bg-surface))] text-[var(--text-primary)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--semantic-warning)_18%,transparent),0_14px_30px_color-mix(in_srgb,var(--semantic-warning)_14%,transparent)]',
        surface:
          'bg-[color:color-mix(in_srgb,var(--semantic-warning)_12%,var(--bg-surface))]',
        text: 'text-[var(--semantic-warning)]',
      };
    default:
      return {
        bar: 'bg-[var(--border-default)]',
        border: 'border-[var(--border-default)]',
        focus: 'focus-visible:ring-[var(--border-active)]',
        glow: 'shadow-[var(--shadow-sm)]',
        hover: 'hover:border-[var(--border-active)]',
        icon: 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
        selected: 'border-[var(--border-active)] bg-[var(--bg-surface)] text-[var(--text-primary)]',
        surface: 'bg-[var(--bg-surface)]',
        text: 'text-[var(--text-secondary)]',
      };
  }
}

function getRpsIcon(gesture: OpeningRpsGesture, size: number) {
  switch (gesture) {
    case 'ROCK':
      return <HandFist size={size} />;
    case 'PAPER':
      return <Hand size={size} />;
    case 'SCISSORS':
      return <Scissors size={size} />;
    default:
      return <CircleDot size={size} />;
  }
}

function getRoomStatusLabel(status: OnlineRoomView['status']): string {
  switch (status) {
    case 'PREPARING':
      return '准备中';
    case 'READY':
      return '等待开局';
    case 'OPENING':
      return '开局中';
    case 'IN_GAME':
      return '对局进行中';
    default:
      return status;
  }
}

function getRoomActionState({
  room,
  myMember,
  bothReady,
}: {
  room: OnlineRoomView | null;
  myMember: OnlineRoomView['members'][number] | null;
  bothReady: boolean;
}): { title: string; detail?: string } {
  if (!room) {
    return { title: '输入房间号并进入房间' };
  }

  if (room.members.length < 2) {
    return { title: '等待另一位玩家加入' };
  }

  if (!myMember?.ready) {
    return { title: '锁定你的卡组' };
  }

  if (!bothReady) {
    return { title: '等待对手锁定卡组' };
  }

  if (room.status === 'OPENING') {
    return { title: '正在进行开局猜拳' };
  }

  if (!myMember.startReady) {
    return {
      title: '准备开始',
      detail: '等待双方准备。',
    };
  }

  if (room.members.some((member) => !member.startReady)) {
    return {
      title: '等待对手准备开始',
      detail: '等待对手。',
    };
  }

  return { title: '即将进入开局猜拳' };
}

function normalizeRoomCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(normalized) ? normalized : null;
}

function persistOnlineRoomRecovery(roomCode: string): void {
  sessionStorage.setItem(ONLINE_ROOM_STORAGE_KEY, roomCode);
}

function clearOnlineRoomRecovery(): void {
  sessionStorage.removeItem(ONLINE_ROOM_STORAGE_KEY);
}
