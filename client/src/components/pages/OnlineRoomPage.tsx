import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  CircleDot,
  Crown,
  DoorOpen,
  Loader2,
  RefreshCw,
  Swords,
  Users,
} from 'lucide-react';
import { DeckSelector, type DeckDisplayItem, PageHeader, ThemeToggle } from '@/components/common';
import { GameBoard } from '@/components/game';
import { PreMatchBriefingModal } from '@/components/game/PreMatchBriefingModal';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import {
  createOnlineRoom,
  fetchOnlineMatchSnapshot,
  fetchOnlineRoom,
  joinOnlineRoom,
  leaveOnlineRoom,
  leaveOnlineRoomOnUnload,
  lockOnlineRoomDeck,
  proposeTurnOrder,
  respondTurnOrder,
} from '@/lib/onlineClient';
import type { OnlineRoomView } from '@game/online';

const ROOM_POLL_INTERVAL_MS = 1200;
const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';

interface OnlineRoomPageProps {
  onBack: () => void;
}

export function OnlineRoomPage({ onBack }: OnlineRoomPageProps) {
  const cloudDecks = useDeckStore((s) => s.cloudDecks);
  const isLoadingCloud = useDeckStore((s) => s.isLoadingCloud);
  const cloudError = useDeckStore((s) => s.cloudError);
  const fetchCloudDecks = useDeckStore((s) => s.fetchCloudDecks);

  const connectRemoteSession = useGameStore((s) => s.connectRemoteSession);
  const disconnectRemoteSession = useGameStore((s) => s.disconnectRemoteSession);
  const syncRemoteState = useGameStore((s) => s.syncRemoteState);
  const remoteSession = useGameStore((s) =>
    s.remoteSession?.source === 'ONLINE' ? s.remoteSession : null
  );
  const matchView = useGameStore((s) => s.getMatchView());

  const validDecks = useMemo(() => cloudDecks.filter((deck) => deck.is_valid), [cloudDecks]);
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
        await syncRemoteState();
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
  }, [connectRemoteSession, disconnectRemoteSession, remoteSession, room?.matchId, syncRemoteState]);

  useEffect(() => {
    return () => {
      disconnectRemoteSession();
    };
  }, [disconnectRemoteSession]);

  useEffect(() => {
    if (!joinedRoomCode) {
      return;
    }

    const handlePageHide = () => {
      leaveOnlineRoomOnUnload(joinedRoomCode);
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [joinedRoomCode]);

  const myMember = room?.members.find((member) => member.userId === room.currentUserId) ?? null;
  const opponentMember =
    room?.members.find((member) => member.userId !== room.currentUserId) ?? null;
  const canLockDeck = Boolean(room && selectedDeck?.cloudDeck && room.status !== 'IN_GAME');
  const bothReady = Boolean(room && room.members.length === 2 && room.members.every((member) => member.ready));
  const isHost = room?.currentUserRole === 'HOST';
  const hasPendingProposal = Boolean(room?.turnOrderProposal && !room?.turnOrderAgreement?.accepted);
  const actionState = getRoomActionState({
    room,
    myMember,
    bothReady,
    isHost: Boolean(isHost),
    hasPendingProposal,
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

  const handleProposeTurnOrder = async (proposal: 'HOST_FIRST' | 'HOST_SECOND') => {
    if (!room) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await proposeTurnOrder(room.roomCode, proposal);
      setRoom(nextRoom);
    } catch (proposalError) {
      setError(proposalError instanceof Error ? proposalError.message : '提交先后手提议失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRespondTurnOrder = async (accepted: boolean) => {
    if (!room) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const nextRoom = await respondTurnOrder(room.roomCode, accepted);
      setRoom(nextRoom);
    } catch (responseError) {
      setError(responseError instanceof Error ? responseError.message : '响应先后手提议失败');
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

  if (room?.status === 'IN_GAME' && remoteSession?.matchId === room.matchId && matchView) {
    return (
      <div className="relative h-screen overflow-hidden">
        <div className="absolute left-4 top-4 z-[120] flex items-center gap-3">
          <button
            type="button"
            onClick={handleLeaveRoom}
            disabled={isSubmitting}
            className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-4 shadow-[var(--shadow-md)] backdrop-blur-xl"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <DoorOpen size={16} />}
            离开房间
          </button>
        </div>
        <GameBoard />
        <PreMatchBriefingModal
          isOpen={!briefingAcknowledged}
          onClose={() => setBriefingAcknowledged(true)}
        />
      </div>
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
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-2">
                <ProgressPill label="进入房间" active={Boolean(room)} done={Boolean(room)} />
                <ProgressPill label="锁定卡组" active={Boolean(room) && !bothReady} done={bothReady} />
                <ProgressPill
                  label="确认先后手"
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
                      {room.turnOrderProposal ? formatProposalLabel(room.turnOrderProposal.proposal) : '未提议'}
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
                  {error}
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

                {room && isHost && bothReady && (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => handleProposeTurnOrder('HOST_FIRST')}
                      disabled={isSubmitting}
                      className={`inline-flex min-h-12 items-center justify-center rounded-2xl border px-4 text-sm font-semibold transition ${
                        room.turnOrderProposal?.proposal === 'HOST_FIRST'
                          ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_48%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] text-[var(--text-primary)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-overlay)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      我先手
                    </button>
                    <button
                      type="button"
                      onClick={() => handleProposeTurnOrder('HOST_SECOND')}
                      disabled={isSubmitting}
                      className={`inline-flex min-h-12 items-center justify-center rounded-2xl border px-4 text-sm font-semibold transition ${
                        room.turnOrderProposal?.proposal === 'HOST_SECOND'
                          ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_48%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] text-[var(--text-primary)]'
                          : 'border-[var(--border-default)] bg-[var(--bg-overlay)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      对手先手
                    </button>
                  </div>
                )}

                {room && !isHost && hasPendingProposal && (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => handleRespondTurnOrder(true)}
                      disabled={isSubmitting}
                      className="button-primary inline-flex min-h-11 items-center justify-center gap-2 px-4"
                    >
                      接受
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRespondTurnOrder(false)}
                      disabled={isSubmitting}
                      className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] px-4"
                    >
                      重选
                    </button>
                  </div>
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

function getRoomStatusLabel(status: OnlineRoomView['status']): string {
  switch (status) {
    case 'PREPARING':
      return '准备中';
    case 'READY':
      return '等待确认';
    case 'IN_GAME':
      return '对局进行中';
    default:
      return status;
  }
}

function formatProposalLabel(proposal: 'HOST_FIRST' | 'HOST_SECOND'): string {
  return proposal === 'HOST_FIRST' ? '房主先手' : '房主后手';
}

function getRoomActionState({
  room,
  myMember,
  bothReady,
  isHost,
  hasPendingProposal,
}: {
  room: OnlineRoomView | null;
  myMember: OnlineRoomView['members'][number] | null;
  bothReady: boolean;
  isHost: boolean;
  hasPendingProposal: boolean;
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

  if (room.turnOrderAgreement && room.turnOrderAgreement.accepted) {
    return { title: '对局即将开始' };
  }

  if (room.turnOrderAgreement && !room.turnOrderAgreement.accepted) {
    return {
      title: isHost ? '重新选择先后手' : '等待房主重新选择',
      detail: isHost ? '上一次提议被拒绝了。' : undefined,
    };
  }

  if (isHost && !room.turnOrderProposal) {
    return { title: '选择谁先手' };
  }

  if (isHost && room.turnOrderProposal) {
    return {
      title: room.turnOrderProposal.proposal === 'HOST_FIRST' ? '已提议你先手' : '已提议对手先手',
      detail: '等待对手确认。',
    };
  }

  if (!isHost && hasPendingProposal) {
    return {
      title:
        room.turnOrderProposal?.proposal === 'HOST_FIRST'
          ? '房主想先手'
          : '房主想后手',
      detail: '接受则立即开局。',
    };
  }

  return { title: '等待房主继续' };
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
