import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleDot,
  Copy,
  Crown,
  DoorOpen,
  Eye,
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
import {
  ConfirmDialog,
  DeckSelector,
  type DeckDisplayItem,
  PageHeader,
  ThemeToggle,
} from '@/components/common';
import { BattleViewportShell, GameBoard } from '@/components/game';
import { PreMatchBriefingModal } from '@/components/game/PreMatchBriefingModal';
import { PublicBattleLogButton } from '@/components/game/PublicBattleLog';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { usePublicTableStore } from '@/store/publicTableStore';
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
  updateOnlineRoomSpectatorEntry,
} from '@/lib/onlineClient';
import {
  createDeckRecordCardTypeResolver,
  isDeckRecordValidForCurrentCardPool,
} from '@/lib/deckRecordUtils';
import { buildDeckDisplayItems } from '@/lib/deckDisplay';
import {
  choosePreferredDeck,
  DECK_SELECTION_PREFERENCE_KEYS,
  readLastUsedDeckId,
  writeLastUsedDeckId,
} from '@/lib/deckSelectionPreferences';
import { getOnlineRoomLeaveConfirmCopy } from '@/lib/leaveConfirmCopy';
import { SerialPollingScheduler } from '@/lib/asyncRequestControl';
import { ApiClientError } from '@/lib/apiClient';
import type { OnlineRoomView, OpeningRpsGesture, OpeningTurnOrderChoice, Seat } from '@game/online';

const ROOM_POLL_INTERVAL_MS = 1200;
const MATCH_POLL_INTERVAL_MS = 800;
const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';

type OpeningRpsChoiceView = NonNullable<OnlineRoomView['openingRps']>['choices'][number];
type LobbyPrimaryAction = {
  kind: 'LOCK' | 'REPLACE' | 'START';
  label: string;
  disabled: boolean;
  onClick: () => void;
};
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
  const [hasManualSelectedDeck, setHasManualSelectedDeck] = useState(false);
  const [lastUsedDeckId, setLastUsedDeckId] = useState(() =>
    readLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.onlineRoom)
  );
  const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBootstrappingMatch, setIsBootstrappingMatch] = useState(false);
  const [matchBootstrapError, setMatchBootstrapError] = useState<string | null>(null);
  const [matchBootstrapRetryToken, setMatchBootstrapRetryToken] = useState(0);
  const [briefingAcknowledged, setBriefingAcknowledged] = useState(false);
  const [isUpdatingSpectatorEntry, setIsUpdatingSpectatorEntry] = useState(false);
  const [isRoomPanelOpen, setIsRoomPanelOpen] = useState(false);
  const [roomCodeCopied, setRoomCodeCopied] = useState(false);
  const roomCodeCopyTimerRef = useRef<number | null>(null);
  const resolveDeckRecordCardType = useMemo(
    () => createDeckRecordCardTypeResolver(cardDataRegistry),
    [cardDataRegistry]
  );
  const deckDisplayItems = useMemo(
    () =>
      buildDeckDisplayItems({
        cloudDecks: validDecks,
        resolveDeckRecordCardType,
      }),
    [resolveDeckRecordCardType, validDecks]
  );
  const preferredDeck = useMemo(
    () => choosePreferredDeck(deckDisplayItems, lastUsedDeckId),
    [deckDisplayItems, lastUsedDeckId]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setBriefingAcknowledged(false), 0);
    return () => window.clearTimeout(timer);
  }, [room?.matchId]);

  useEffect(() => {
    fetchCloudDecks();
  }, [fetchCloudDecks]);

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
    if (selectedDeck || hasManualSelectedDeck || !preferredDeck.deck) {
      return;
    }

    const timer = window.setTimeout(() => setSelectedDeck(preferredDeck.deck), 0);
    return () => window.clearTimeout(timer);
  }, [hasManualSelectedDeck, preferredDeck.deck, selectedDeck]);

  useEffect(() => {
    const savedRoomCode = sessionStorage.getItem(ONLINE_ROOM_STORAGE_KEY);
    if (!savedRoomCode) {
      return;
    }

    const timer = window.setTimeout(() => {
      setRoomCodeInput(savedRoomCode);
      setJoinedRoomCode(savedRoomCode);
    }, 0);
    return () => window.clearTimeout(timer);
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
          if (pollError instanceof ApiClientError && pollError.code === 'ONLINE_ROOM_NOT_FOUND') {
            clearOnlineRoomRecovery();
            disconnectRemoteSession();
            setRoom(null);
            setJoinedRoomCode(null);
            setRoomCodeInput('');
          }
          setError(pollError instanceof Error ? pollError.message : '读取房间状态失败');
        }
      }
    };

    const scheduler = new SerialPollingScheduler({
      intervalMs: ROOM_POLL_INTERVAL_MS,
      poll: pollRoom,
    });
    scheduler.start();

    return () => {
      cancelled = true;
      scheduler.dispose();
    };
  }, [disconnectRemoteSession, joinedRoomCode]);

  useEffect(() => {
    if (!room?.matchId) {
      const timer = window.setTimeout(() => setMatchBootstrapError(null), 0);
      if (remoteSession) {
        disconnectRemoteSession();
      }
      return () => window.clearTimeout(timer);
    }

    if (remoteSession?.matchId === room.matchId) {
      return;
    }

    let cancelled = false;
    const bootstrapMatch = async () => {
      setIsBootstrappingMatch(true);
      setMatchBootstrapError(null);
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
          setMatchBootstrapError(
            bootstrapError instanceof Error ? bootstrapError.message : '同步联机对局失败'
          );
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
    matchBootstrapRetryToken,
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
      if (roomCodeCopyTimerRef.current !== null) {
        window.clearTimeout(roomCodeCopyTimerRef.current);
      }
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
    ? (room?.members.find((member) => member.userId === restartRequest.requesterUserId)
        ?.displayName ?? '对手')
    : null;
  const canRequestRestart = Boolean(
    room?.status === 'IN_GAME' && !restartRequest && opponentMember?.presence === 'ACTIVE'
  );
  const spectatorPresence = room?.spectatorPresence ?? { total: 0, viewers: [] };
  const mySpectatorRoomEntry =
    room?.spectatorRoomEntry?.seats.find((seat) => seat.seat === room.currentUserSeat) ?? null;
  const canLockDeck = Boolean(
    room && selectedDeck?.cloudDeck && room.status !== 'OPENING' && room.status !== 'IN_GAME'
  );
  const selectedDeckCanReplaceLockedDeck = Boolean(
    room &&
    myMember?.ready &&
    selectedDeck?.cloudDeck &&
    selectedDeck.cloudDeck.id !== myMember.lockedDeckId
  );
  const bothReady = Boolean(
    room && room.members.length === 2 && room.members.every((member) => member.ready)
  );
  const canClearSavedRoom = Boolean(joinedRoomCode && !room);
  const actionState = selectedDeckCanReplaceLockedDeck
    ? {
        title: `改用「${selectedDeck?.name ?? '所选卡组'}」`,
        detail: `当前已锁定「${myMember?.lockedDeckName ?? '原卡组'}」。`,
      }
    : getRoomActionState({
        room,
        myMember,
        bothReady,
        selectedDeckName: selectedDeck?.name,
      });
  const leaveConfirmCopy = useMemo(
    () => getOnlineRoomLeaveConfirmCopy(room?.status, room?.originKind),
    [room?.originKind, room?.status]
  );

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
    setHasManualSelectedDeck(false);
    setRoomCodeInput('');
    setError(null);
    onBack();
  };

  const handleSelectDeck = (deck: DeckDisplayItem) => {
    setHasManualSelectedDeck(true);
    setSelectedDeck(deck);
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
      writeLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.onlineRoom, selectedDeck.cloudDeck.id);
      setLastUsedDeckId(selectedDeck.cloudDeck.id);
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

  const handleRequestLeaveRoom = () => {
    if (!room && !joinedRoomCode) {
      return;
    }

    setIsLeaveConfirmOpen(true);
  };

  const handleCopyRoomCode = async () => {
    if (!room) {
      return;
    }

    try {
      await navigator.clipboard.writeText(room.roomCode);
      setRoomCodeCopied(true);
      if (roomCodeCopyTimerRef.current !== null) {
        window.clearTimeout(roomCodeCopyTimerRef.current);
      }
      roomCodeCopyTimerRef.current = window.setTimeout(() => {
        setRoomCodeCopied(false);
        roomCodeCopyTimerRef.current = null;
      }, 1800);
    } catch {
      setError('复制房间号失败，请手动复制');
    }
  };

  const handleRetryMatchBootstrap = () => {
    disconnectRemoteSession();
    setMatchBootstrapError(null);
    setMatchBootstrapRetryToken((token) => token + 1);
  };

  const handleLeaveRoom = async () => {
    if (!room && !joinedRoomCode) {
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const leftPublicTableRoom = room?.originKind === 'PUBLIC_TABLE';
      await leaveOnlineRoom(room?.roomCode ?? joinedRoomCode!);
      if (leftPublicTableRoom) {
        try {
          await usePublicTableStore.getState().refresh();
        } catch {
          // The room has already been left; the next public-table visit will refresh again.
        }
      }
      setIsLeaveConfirmOpen(false);
      clearOnlineRoomRecovery();
      disconnectRemoteSession();
      setRoom(null);
      setJoinedRoomCode(null);
      setSelectedDeck(null);
      setHasManualSelectedDeck(false);
      setRoomCodeInput('');
      onBack();
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
      const nextRoom = await acceptOnlineRoomRestart(room.roomCode, room.restartRequest.requestId);
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
      const nextRoom = await rejectOnlineRoomRestart(room.roomCode, room.restartRequest.requestId);
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
      const nextRoom = await cancelOnlineRoomRestart(room.roomCode, room.restartRequest.requestId);
      setRoom(nextRoom);
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : '取消重开失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleSpectatorRoomEntry = async () => {
    if (!room?.matchId || !mySpectatorRoomEntry) {
      return;
    }

    setIsUpdatingSpectatorEntry(true);
    setError(null);
    try {
      const nextRoom = await updateOnlineRoomSpectatorEntry(
        room.roomCode,
        !mySpectatorRoomEntry.enabled
      );
      setRoom(nextRoom);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : '更新房间号观战设置失败');
    } finally {
      setIsUpdatingSpectatorEntry(false);
    }
  };

  const lobbyPrimaryAction: LobbyPrimaryAction | null = room
    ? selectedDeckCanReplaceLockedDeck
      ? {
          kind: 'REPLACE',
          label: `改用「${selectedDeck?.name ?? '所选卡组'}」`,
          disabled: !canLockDeck || isSubmitting,
          onClick: handleLockDeck,
        }
      : !myMember?.ready
        ? {
            kind: 'LOCK',
            label: selectedDeck ? `锁定「${selectedDeck.name}」` : '请先选择卡组',
            disabled: !myMember || !canLockDeck || isSubmitting,
            onClick: handleLockDeck,
          }
        : bothReady && !myMember.startReady
          ? {
              kind: 'START',
              label: '准备开始',
              disabled: isSubmitting,
              onClick: handleReadyStart,
            }
          : null
    : null;

  if (room?.status === 'IN_GAME' && remoteSession?.matchId === room.matchId && matchView) {
    return (
      <BattleViewportShell>
        <div className="absolute left-4 top-4 z-[120] flex max-w-[calc(100vw-2rem)] flex-col items-start gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsRoomPanelOpen((open) => !open)}
              aria-expanded={isRoomPanelOpen}
              className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3.5 shadow-[var(--shadow-md)] backdrop-blur-xl sm:px-4"
              title="打开房间操作"
            >
              <Users size={16} />
              <span className="hidden text-sm font-semibold sm:inline">房间 {room.roomCode}</span>
              <span className="text-sm font-semibold sm:hidden">{room.roomCode}</span>
              <span className="h-4 w-px bg-[var(--border-default)]" />
              <span
                className="inline-flex items-center gap-1.5"
                title="公开观战人数，不包含管理员观战"
              >
                <Eye size={15} />
                <span className="text-sm">{spectatorPresence.total}</span>
              </span>
              <ChevronDown
                size={15}
                className={`transition-transform ${isRoomPanelOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <div className="hidden md:block">
              <PublicBattleLogButton />
            </div>
          </div>
          {isRoomPanelOpen && (
            <RoomActionPanel
              roomCode={room.roomCode}
              presence={spectatorPresence}
              spectatorRoomEntry={mySpectatorRoomEntry}
              isUpdatingSpectatorEntry={isUpdatingSpectatorEntry}
              isSubmitting={isSubmitting}
              canRequestRestart={canRequestRestart}
              restartRequest={restartRequest}
              isRestartRequester={isRestartRequester}
              onToggleSpectatorRoomEntry={handleToggleSpectatorRoomEntry}
              onRequestRestart={handleRequestRestart}
              onCancelRestart={handleCancelRestart}
              onBackHome={onBack}
              onLeaveRoom={handleRequestLeaveRoom}
            />
          )}
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
                      ? '等待对手同意；同意后会回到准备页，可换卡组后重新开局。'
                      : '同意后会封存当前对局，并回到准备页重新锁组或直接准备。'}
                  </div>
                </div>
                <RotateCcw size={18} className="mt-0.5 shrink-0 text-[var(--accent-primary)]" />
              </div>
              {isRestartRequester && (
                <button
                  type="button"
                  onClick={handleCancelRestart}
                  disabled={isSubmitting}
                  className="button-ghost mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 border border-[var(--border-default)] px-3 text-sm"
                >
                  {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
                  取消重开
                </button>
              )}
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
        <ConfirmDialog
          isOpen={isLeaveConfirmOpen}
          title={leaveConfirmCopy.title}
          message={leaveConfirmCopy.message}
          confirmLabel={leaveConfirmCopy.confirmLabel}
          isConfirming={isSubmitting}
          onCancel={() => setIsLeaveConfirmOpen(false)}
          onConfirm={() => {
            void handleLeaveRoom();
          }}
        />
      </BattleViewportShell>
    );
  }

  if (room?.status === 'OPENING') {
    return (
      <>
        <OnlineOpeningStage
          room={room}
          error={error}
          isSubmitting={isSubmitting}
          onSubmitRps={handleSubmitOpeningRps}
          onReplayRps={handleReplayOpeningRps}
          onChooseTurnOrder={handleChooseOpeningTurnOrder}
          onBackHome={onBack}
          onLeaveRoom={handleRequestLeaveRoom}
        />
        <ConfirmDialog
          isOpen={isLeaveConfirmOpen}
          title={leaveConfirmCopy.title}
          message={leaveConfirmCopy.message}
          confirmLabel={leaveConfirmCopy.confirmLabel}
          isConfirming={isSubmitting}
          onCancel={() => setIsLeaveConfirmOpen(false)}
          onConfirm={() => {
            void handleLeaveRoom();
          }}
        />
      </>
    );
  }

  if (room?.status === 'IN_GAME') {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center">
        <div className="surface-panel-frosted mx-4 w-full max-w-md px-6 py-5 text-[var(--text-primary)]">
          <div className="flex items-center gap-3">
            {isBootstrappingMatch ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <RefreshCw size={18} className="text-[var(--semantic-error)]" />
            )}
            <div className="font-semibold">
              {isBootstrappingMatch ? '正在同步联机对局...' : '联机对局同步失败'}
            </div>
          </div>
          {matchBootstrapError && (
            <div className="mt-3 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] px-4 py-3 text-sm text-[var(--semantic-error)]">
              {matchBootstrapError}
            </div>
          )}
          {!isBootstrappingMatch && (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={onBack}
                className="button-ghost inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] px-3"
              >
                <ArrowLeft size={16} />
                返回主页
              </button>
              <button
                type="button"
                onClick={handleRequestLeaveRoom}
                className="button-ghost inline-flex min-h-10 items-center justify-center border border-[var(--border-default)] px-3"
              >
                退出房间
              </button>
              <button
                type="button"
                onClick={handleRetryMatchBootstrap}
                className="button-primary inline-flex min-h-10 items-center justify-center gap-2 px-3"
              >
                <RefreshCw size={16} />
                重新同步
              </button>
            </div>
          )}
        </div>
        <ConfirmDialog
          isOpen={isLeaveConfirmOpen}
          title={leaveConfirmCopy.title}
          message={leaveConfirmCopy.message}
          confirmLabel={leaveConfirmCopy.confirmLabel}
          isConfirming={isSubmitting}
          onCancel={() => setIsLeaveConfirmOpen(false)}
          onConfirm={() => {
            void handleLeaveRoom();
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <PageHeader
        title="正式联机"
        icon={<Swords size={20} />}
        left={
          <button
            onClick={onBack}
            className="button-ghost inline-flex h-10 items-center gap-2 px-3"
          >
            <ArrowLeft size={16} />
            返回
          </button>
        }
        right={<ThemeToggle />}
      />

      <main
        className={`relative z-10 flex flex-1 justify-center px-4 pt-5 sm:px-6 sm:pt-6 ${
          room && lobbyPrimaryAction
            ? 'pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-6'
            : 'pb-6'
        }`}
      >
        <div className={`flex w-full flex-col gap-4 ${room ? 'max-w-6xl' : 'max-w-4xl'}`}>
          {!room &&
            (joinedRoomCode ? (
              <section className="surface-panel-frosted flex items-center gap-3 px-5 py-4">
                {!error && (
                  <Loader2
                    size={18}
                    className="shrink-0 animate-spin text-[var(--accent-primary)]"
                  />
                )}
                <div className="min-w-0">
                  <h2 className="font-bold text-[var(--text-primary)]">
                    {error ? '无法返回房间' : '正在返回房间'}
                  </h2>
                  <p className="mt-0.5 truncate text-sm text-[var(--text-secondary)]">
                    {joinedRoomCode}
                  </p>
                </div>
              </section>
            ) : (
              <section className="surface-panel-frosted p-3 sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">房间号</span>
                    <input
                      value={roomCodeInput}
                      onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
                      placeholder="房间号 · 4-12 位字母或数字"
                      className="h-11 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] px-4 text-base font-semibold tracking-[0.08em] text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)]"
                      maxLength={12}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3 sm:flex">
                    <button
                      type="button"
                      onClick={handleCreateRoom}
                      disabled={isSubmitting}
                      className="button-ghost inline-flex min-h-11 items-center justify-center gap-2 border border-[var(--border-default)] px-5"
                    >
                      <Users size={16} />
                      创建房间
                    </button>
                    <button
                      type="button"
                      onClick={handleJoinRoom}
                      disabled={isSubmitting}
                      className="button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5"
                    >
                      {isSubmitting ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <DoorOpen size={16} />
                      )}
                      加入房间
                    </button>
                  </div>
                </div>
              </section>
            ))}

          {!room && error && (
            <RoomErrorNotice
              message={error}
              canClearSavedRoom={canClearSavedRoom}
              onClearSavedRoom={handleClearSavedRoomAndBack}
              standalone
            />
          )}

          {room ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
              <div
                className={`order-2 overflow-hidden lg:order-1 ${
                  validDecks.length > 6 || isLoadingCloud
                    ? 'h-[54dvh] min-h-[360px] lg:h-[calc(100dvh-10rem)] lg:min-h-[460px]'
                    : ''
                }`}
              >
                <DeckSelector
                  cloudDecks={cloudDecks}
                  selectedId={selectedDeck?.id}
                  onSelect={handleSelectDeck}
                  isLoading={isLoadingCloud}
                  error={cloudError}
                  onRefresh={fetchCloudDecks}
                  title="选择卡组"
                  emptyText="还没有可用卡组。"
                  density="compact"
                  lastUsedDeckId={lastUsedDeckId}
                />
              </div>

              <OnlineRoomLobbyPanel
                room={room}
                myMember={myMember}
                opponentMember={opponentMember}
                selectedDeckName={selectedDeck?.name}
                actionState={actionState}
                primaryAction={lobbyPrimaryAction}
                error={error}
                isSubmitting={isSubmitting}
                roomCodeCopied={roomCodeCopied}
                onCopyRoomCode={handleCopyRoomCode}
                onLeaveRoom={handleRequestLeaveRoom}
              />
            </div>
          ) : (
            <div
              className={`overflow-hidden ${
                validDecks.length > 6 || isLoadingCloud
                  ? 'h-[54dvh] min-h-[360px] lg:h-[calc(100dvh-16rem)] lg:min-h-[460px]'
                  : ''
              }`}
            >
              <DeckSelector
                cloudDecks={cloudDecks}
                selectedId={selectedDeck?.id}
                onSelect={handleSelectDeck}
                isLoading={isLoadingCloud}
                error={cloudError}
                onRefresh={fetchCloudDecks}
                title="选择卡组"
                emptyText="还没有可用卡组。"
                density="compact"
                lastUsedDeckId={lastUsedDeckId}
              />
            </div>
          )}
        </div>
      </main>

      {room && lobbyPrimaryAction && (
        <div className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 rounded-2xl border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] p-3 shadow-[var(--shadow-lg)] backdrop-blur-xl lg:hidden">
          <LobbyPrimaryActionButton
            action={lobbyPrimaryAction}
            isSubmitting={isSubmitting}
            className="w-full"
          />
        </div>
      )}

      <ConfirmDialog
        isOpen={isLeaveConfirmOpen}
        title={leaveConfirmCopy.title}
        message={leaveConfirmCopy.message}
        confirmLabel={leaveConfirmCopy.confirmLabel}
        isConfirming={isSubmitting}
        onCancel={() => setIsLeaveConfirmOpen(false)}
        onConfirm={() => {
          void handleLeaveRoom();
        }}
      />
    </div>
  );
}

function OnlineRoomLobbyPanel({
  room,
  myMember,
  opponentMember,
  selectedDeckName,
  actionState,
  primaryAction,
  error,
  isSubmitting,
  roomCodeCopied,
  onCopyRoomCode,
  onLeaveRoom,
}: {
  room: OnlineRoomView;
  myMember: OnlineRoomView['members'][number] | null;
  opponentMember: OnlineRoomView['members'][number] | null;
  selectedDeckName?: string;
  actionState: { title: string; detail?: string };
  primaryAction: LobbyPrimaryAction | null;
  error: string | null;
  isSubmitting: boolean;
  roomCodeCopied: boolean;
  onCopyRoomCode: () => void;
  onLeaveRoom: () => void;
}) {
  return (
    <aside className="surface-panel-frosted order-1 overflow-hidden lg:order-2">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
        <div className="min-w-0">
          <div className="text-xs text-[var(--text-muted)]">房间</div>
          <h2 className="mt-0.5 truncate text-xl font-black tracking-[0.08em] text-[var(--text-primary)]">
            {room.roomCode}
          </h2>
        </div>
        <button
          type="button"
          onClick={onCopyRoomCode}
          className="button-ghost inline-flex min-h-10 shrink-0 items-center justify-center gap-2 border border-[var(--border-default)] px-3 text-sm"
          aria-label="复制房间号"
        >
          {roomCodeCopied ? <Check size={15} /> : <Copy size={15} />}
          {roomCodeCopied ? '已复制' : '复制'}
        </button>
      </header>

      <div className="p-5">
        {error && <RoomErrorNotice message={error} />}

        <div className={error ? 'mt-4' : ''}>
          <LobbySeatRow
            label="你"
            member={myMember}
            selectedDeckName={selectedDeckName}
            isCurrentUser
          />

          <div className="flex items-center gap-3 py-2.5" aria-hidden="true">
            <div className="h-px flex-1 bg-[var(--border-subtle)]" />
            <span className="text-[10px] font-black tracking-[0.2em] text-[var(--accent-primary)]">
              VS
            </span>
            <div className="h-px flex-1 bg-[var(--border-subtle)]" />
          </div>

          <LobbySeatRow label="对手" member={opponentMember} />
        </div>

        <div className="mt-5 border-l-2 border-[var(--accent-primary)] pl-3" aria-live="polite">
          <div className="text-sm font-bold text-[var(--text-primary)]">{actionState.title}</div>
          {actionState.detail && (
            <div className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
              {actionState.detail}
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-[var(--border-subtle)] px-5 py-4">
        {primaryAction && (
          <LobbyPrimaryActionButton
            action={primaryAction}
            isSubmitting={isSubmitting}
            className="hidden w-full lg:inline-flex"
          />
        )}
        <button
          type="button"
          onClick={onLeaveRoom}
          disabled={isSubmitting}
          className={`button-ghost inline-flex min-h-10 w-full items-center justify-center gap-2 text-sm text-[var(--text-secondary)] ${
            primaryAction ? 'mt-2' : ''
          }`}
        >
          <DoorOpen size={15} />
          退出房间
        </button>
      </footer>
    </aside>
  );
}

function LobbySeatRow({
  label,
  member,
  selectedDeckName,
  isCurrentUser = false,
}: {
  label: string;
  member: OnlineRoomView['members'][number] | null;
  selectedDeckName?: string;
  isCurrentUser?: boolean;
}) {
  const memberName = member?.displayName ?? (isCurrentUser ? '正在同步' : '等待玩家加入');
  const deckName = member?.ready
    ? (member.lockedDeckName ?? '未命名卡组')
    : isCurrentUser
      ? (selectedDeckName ?? '未选择卡组')
      : member
        ? '尚未锁定卡组'
        : '房间空位';
  const status = getLobbyMemberStatus(member);

  return (
    <div className="flex min-h-[72px] items-center gap-3">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-sm font-black ${
          isCurrentUser
            ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_34%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-overlay))] text-[var(--accent-primary)]'
            : 'border-[var(--border-default)] bg-[var(--bg-overlay)] text-[var(--text-secondary)]'
        }`}
      >
        {isCurrentUser ? '我' : '对'}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-xs text-[var(--text-muted)]">{label}</span>
          {member?.role === 'HOST' && (
            <Crown
              size={12}
              className="shrink-0 text-[var(--semantic-warning)]"
              aria-label="房主"
            />
          )}
        </div>
        <div className="mt-0.5 truncate font-bold text-[var(--text-primary)]">{memberName}</div>
        <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{deckName}</div>
      </div>

      <span
        className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${status.className}`}
      >
        {status.label}
      </span>
    </div>
  );
}

function LobbyPrimaryActionButton({
  action,
  isSubmitting,
  className = '',
}: {
  action: LobbyPrimaryAction;
  isSubmitting: boolean;
  className?: string;
}) {
  const icon = isSubmitting ? (
    <Loader2 size={16} className="animate-spin" />
  ) : action.kind === 'START' ? (
    <Swords size={16} />
  ) : action.kind === 'REPLACE' ? (
    <RefreshCw size={16} />
  ) : (
    <Check size={16} />
  );

  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      className={`button-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {icon}
      <span className="truncate">{action.label}</span>
    </button>
  );
}

function RoomErrorNotice({
  message,
  canClearSavedRoom = false,
  onClearSavedRoom,
  standalone = false,
}: {
  message: string;
  canClearSavedRoom?: boolean;
  onClearSavedRoom?: () => void;
  standalone?: boolean;
}) {
  return (
    <div
      className={`border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_10%,transparent)] px-4 py-3 text-sm text-[var(--semantic-error)] ${
        standalone ? 'surface-panel-frosted rounded-2xl' : 'rounded-xl'
      }`}
      role="alert"
    >
      <div>{message}</div>
      {canClearSavedRoom && onClearSavedRoom && (
        <button
          type="button"
          onClick={onClearSavedRoom}
          className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] px-3 py-2 font-semibold transition hover:bg-[color:color-mix(in_srgb,var(--semantic-error)_10%,transparent)]"
        >
          清除保存房间并返回首页
        </button>
      )}
    </div>
  );
}

function getLobbyMemberStatus(member: OnlineRoomView['members'][number] | null): {
  label: string;
  className: string;
} {
  if (!member) {
    return {
      label: '等待中',
      className: 'border-[var(--border-default)] text-[var(--text-muted)]',
    };
  }
  if (member.presence === 'LEFT') {
    return {
      label: '已离开',
      className:
        'border-[color:color-mix(in_srgb,var(--semantic-warning)_34%,transparent)] text-[var(--semantic-warning)]',
    };
  }
  if (member.startReady) {
    return {
      label: '已准备',
      className:
        'border-[color:color-mix(in_srgb,var(--semantic-success)_34%,transparent)] text-[var(--semantic-success)]',
    };
  }
  if (member.ready) {
    return {
      label: '已锁定',
      className:
        'border-[color:color-mix(in_srgb,var(--semantic-success)_34%,transparent)] text-[var(--semantic-success)]',
    };
  }
  return {
    label: '待锁定',
    className: 'border-[var(--border-default)] text-[var(--text-muted)]',
  };
}

function OnlineOpeningStage({
  room,
  error,
  isSubmitting,
  onSubmitRps,
  onReplayRps,
  onChooseTurnOrder,
  onBackHome,
  onLeaveRoom,
}: {
  room: OnlineRoomView;
  error: string | null;
  isSubmitting: boolean;
  onSubmitRps: (gesture: OpeningRpsGesture) => void;
  onReplayRps: () => void;
  onChooseTurnOrder: (choice: OpeningTurnOrderChoice) => void;
  onBackHome: () => void;
  onLeaveRoom: () => void;
}) {
  const opening = room.openingRps;
  const myMember = room.members.find((member) => member.userId === room.currentUserId) ?? null;
  const opponentMember =
    room.members.find((member) => member.userId !== room.currentUserId) ?? null;
  const myChoice = opening?.choices.find((choice) => choice.userId === room.currentUserId) ?? null;
  const opponentChoice =
    opening?.choices.find((choice) => choice.userId !== room.currentUserId) ?? null;
  const winnerName = opening?.winnerUserId
    ? (room.members.find((member) => member.userId === opening.winnerUserId)?.displayName ?? '胜者')
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBackHome}
              className="button-ghost inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 backdrop-blur-xl sm:px-4"
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">返回主页</span>
              <span className="sm:hidden">返回</span>
            </button>
            <button
              type="button"
              onClick={onLeaveRoom}
              disabled={isSubmitting}
              className="button-ghost inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 text-[var(--semantic-error)] backdrop-blur-xl sm:px-4"
            >
              <DoorOpen size={15} />
              {room.originKind === 'PUBLIC_TABLE' ? '放弃配对' : '退出房间'}
            </button>
          </div>
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
                    <CircleDot size={14} className="text-[var(--accent-primary)]" />第{' '}
                    {opening?.round ?? 1} 轮
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
            : (tone?.bar ?? 'bg-[color:color-mix(in_srgb,var(--border-default)_80%,transparent)]')
        }`}
      />
      <div className="min-w-0">
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] sm:text-xs lg:tracking-[0.16em]">
            {title}
          </div>
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
          <div className="truncate text-sm font-black text-[var(--text-primary)] sm:text-base lg:text-lg">
            {label}
          </div>
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
            {isSubmitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RotateCcw size={16} />
            )}
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
          icon={
            isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Swords size={18} />
          }
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
        selected
          ? tone.selected
          : `border-transparent bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] text-[var(--text-secondary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border-default)_56%,transparent)] ${tone.hover}`
      } ${tone.focus} ${
        disabled && !selected
          ? 'cursor-not-allowed opacity-55'
          : disabled
            ? 'cursor-default'
            : 'cursor-pointer'
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
        <div className="text-sm font-black leading-tight text-[var(--text-primary)] sm:text-lg">
          {getRpsLabel(gesture)}
        </div>
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
          border:
            'border-[color:color-mix(in_srgb,var(--accent-primary)_42%,var(--border-default))]',
          focus: 'focus-visible:ring-[var(--accent-primary)]',
          hover:
            'hover:-translate-y-1 hover:border-[color:color-mix(in_srgb,var(--accent-primary)_64%,var(--border-default))] hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_14%,var(--bg-surface))] hover:shadow-[0_16px_36px_color-mix(in_srgb,var(--accent-primary)_18%,transparent)]',
          icon: 'border-[color:color-mix(in_srgb,var(--accent-primary)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_14%,var(--bg-surface))] text-[var(--accent-primary)]',
          line: 'bg-[linear-gradient(180deg,var(--accent-primary),var(--accent-secondary))]',
        }
      : {
          border:
            'border-[color:color-mix(in_srgb,var(--semantic-info)_42%,var(--border-default))]',
          focus: 'focus-visible:ring-[var(--semantic-info)]',
          hover:
            'hover:-translate-y-1 hover:border-[color:color-mix(in_srgb,var(--semantic-info)_64%,var(--border-default))] hover:bg-[color:color-mix(in_srgb,var(--semantic-info)_12%,var(--bg-surface))] hover:shadow-[0_16px_36px_color-mix(in_srgb,var(--semantic-info)_18%,transparent)]',
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
      <div
        className={`absolute inset-y-2 left-0 w-1 rounded-r-full sm:inset-y-3 ${toneClass.line}`}
      />
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        <div>
          <div className="text-sm font-black text-[var(--text-primary)] sm:text-lg">{title}</div>
          {detail && <div className="mt-1 text-sm text-[var(--text-secondary)]">{detail}</div>}
        </div>
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-transform duration-200 group-hover:scale-105 sm:h-11 sm:w-11 sm:rounded-xl ${toneClass.icon}`}
        >
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
        icon: 'bg-[color:color-mix(in_srgb,var(--accent-primary)_13%,var(--bg-surface))] text-[var(--accent-primary)]',
        selected:
          'border-[color:color-mix(in_srgb,var(--accent-primary)_48%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] text-[var(--text-primary)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_18%,transparent),0_14px_30px_color-mix(in_srgb,var(--accent-primary)_14%,transparent)]',
        surface: 'bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))]',
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
        icon: 'bg-[color:color-mix(in_srgb,var(--semantic-info)_13%,var(--bg-surface))] text-[var(--semantic-info)]',
        selected:
          'border-[color:color-mix(in_srgb,var(--semantic-info)_48%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-info)_12%,var(--bg-surface))] text-[var(--text-primary)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--semantic-info)_18%,transparent),0_14px_30px_color-mix(in_srgb,var(--semantic-info)_14%,transparent)]',
        surface: 'bg-[color:color-mix(in_srgb,var(--semantic-info)_12%,var(--bg-surface))]',
        text: 'text-[var(--semantic-info)]',
      };
    case 'PAPER':
      return {
        bar: 'bg-[linear-gradient(90deg,var(--semantic-warning),var(--accent-gold))]',
        border:
          'border-[color:color-mix(in_srgb,var(--semantic-warning)_46%,var(--border-default))]',
        focus: 'focus-visible:ring-[var(--semantic-warning)]',
        glow: 'shadow-[0_10px_24px_color-mix(in_srgb,var(--semantic-warning)_22%,transparent)]',
        hover:
          'hover:-translate-y-0.5 hover:border-[color:color-mix(in_srgb,var(--semantic-warning)_42%,var(--border-default))] hover:bg-[color:color-mix(in_srgb,var(--semantic-warning)_9%,var(--bg-surface))] hover:shadow-[0_12px_28px_color-mix(in_srgb,var(--semantic-warning)_13%,transparent)]',
        icon: 'bg-[color:color-mix(in_srgb,var(--semantic-warning)_14%,var(--bg-surface))] text-[var(--semantic-warning)]',
        selected:
          'border-[color:color-mix(in_srgb,var(--semantic-warning)_50%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-warning)_13%,var(--bg-surface))] text-[var(--text-primary)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--semantic-warning)_18%,transparent),0_14px_30px_color-mix(in_srgb,var(--semantic-warning)_14%,transparent)]',
        surface: 'bg-[color:color-mix(in_srgb,var(--semantic-warning)_12%,var(--bg-surface))]',
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

function RoomActionPanel({
  roomCode,
  presence,
  spectatorRoomEntry,
  isUpdatingSpectatorEntry,
  isSubmitting,
  canRequestRestart,
  restartRequest,
  isRestartRequester,
  onToggleSpectatorRoomEntry,
  onRequestRestart,
  onCancelRestart,
  onBackHome,
  onLeaveRoom,
}: {
  roomCode: string;
  presence: OnlineRoomView['spectatorPresence'];
  spectatorRoomEntry: NonNullable<OnlineRoomView['spectatorRoomEntry']>['seats'][number] | null;
  isUpdatingSpectatorEntry: boolean;
  isSubmitting: boolean;
  canRequestRestart: boolean;
  restartRequest: OnlineRoomView['restartRequest'];
  isRestartRequester: boolean;
  onToggleSpectatorRoomEntry: () => void;
  onRequestRestart: () => void;
  onCancelRestart: () => void;
  onBackHome: () => void;
  onLeaveRoom: () => void;
}) {
  return (
    <div className="w-[min(380px,calc(100vw-2rem))] rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_96%,transparent)] p-3 text-sm text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
        <div>
          <div className="text-[11px] uppercase text-[var(--text-muted)]">正式联机房间</div>
          <div className="mt-1 font-semibold">Room {roomCode}</div>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {spectatorRoomEntry ? (
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  房间号观战
                </div>
                <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {spectatorRoomEntry.enabled
                    ? `观战者可在首页输入房间号 ${roomCode} 进入你的视角。`
                    : '你的视角已从房间号入口关闭。'}
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleSpectatorRoomEntry}
                disabled={isUpdatingSpectatorEntry}
                aria-pressed={spectatorRoomEntry.enabled}
                className={`inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition ${
                  spectatorRoomEntry.enabled
                    ? 'border-[color:color-mix(in_srgb,var(--semantic-success)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_10%,transparent)] text-[var(--semantic-success)]'
                    : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                } ${isUpdatingSpectatorEntry ? 'cursor-wait opacity-70' : ''}`}
              >
                {isUpdatingSpectatorEntry ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Eye size={14} />
                )}
                {spectatorRoomEntry.enabled ? '开启' : '关闭'}
              </button>
            </div>
          </div>
        ) : null}
        {!restartRequest && (
          <button
            type="button"
            onClick={onRequestRestart}
            disabled={!canRequestRestart || isSubmitting}
            className={`button-ghost inline-flex min-h-10 items-center justify-start gap-2 border border-[var(--border-default)] px-3 text-sm ${
              !canRequestRestart || isSubmitting ? 'cursor-not-allowed opacity-60' : ''
            }`}
            title={canRequestRestart ? '请求双方同意后重新开始' : '对手在线时可以请求重开'}
          >
            {isSubmitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <RotateCcw size={16} />
            )}
            请求重开
          </button>
        )}
        {restartRequest && isRestartRequester && (
          <button
            type="button"
            onClick={onCancelRestart}
            disabled={isSubmitting}
            className="button-ghost inline-flex min-h-10 items-center justify-start gap-2 border border-[var(--border-default)] px-3 text-sm"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <X size={16} />}
            取消重开
          </button>
        )}
        <button
          type="button"
          onClick={onBackHome}
          className="button-ghost inline-flex min-h-10 items-center justify-start gap-2 border border-[var(--border-default)] px-3 text-sm"
        >
          <ArrowLeft size={16} />
          返回主页
        </button>
        <button
          type="button"
          onClick={onLeaveRoom}
          disabled={isSubmitting}
          className="button-ghost inline-flex min-h-10 items-center justify-start gap-2 border border-[var(--border-default)] px-3 text-sm text-[var(--semantic-error)]"
        >
          {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <DoorOpen size={16} />}
          退出房间
        </button>
      </div>

      <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
        <SpectatorPresencePanel presence={presence} embedded />
      </div>
    </div>
  );
}

function SpectatorPresencePanel({
  presence,
  embedded = false,
}: {
  presence: OnlineRoomView['spectatorPresence'];
  embedded?: boolean;
}) {
  const containerClassName = embedded
    ? ''
    : 'w-[min(360px,calc(100vw-2rem))] rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] px-3 py-3 text-sm text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl';

  return (
    <div className={containerClassName}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold">公开观战列表</div>
        {!embedded ? (
          <div className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
            {presence.total}
          </div>
        ) : null}
      </div>
      {presence.viewers.length === 0 ? (
        <div className="mt-2 text-xs text-[var(--text-secondary)]">暂无公开观战</div>
      ) : (
        <div className="mt-3 flex max-h-48 flex-col gap-2 overflow-y-auto pr-1">
          {presence.viewers.map((viewer) => (
            <div
              key={viewer.sessionId}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-2"
            >
              <div className="min-w-0 truncate font-medium">{viewer.displayName}</div>
              <div className="shrink-0 text-xs text-[var(--text-secondary)]">
                {viewer.viewerSeat ? getSpectatorViewLabel(viewer.viewerSeat) : '等待下一局'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getSpectatorViewLabel(seat: Seat): string {
  return seat === 'FIRST' ? '先攻视角' : '后攻视角';
}

function getRoomActionState({
  room,
  myMember,
  bothReady,
  selectedDeckName,
}: {
  room: OnlineRoomView | null;
  myMember: OnlineRoomView['members'][number] | null;
  bothReady: boolean;
  selectedDeckName?: string;
}): { title: string; detail?: string } {
  if (!room) {
    return { title: '输入房间号并进入房间' };
  }

  if (!myMember?.ready) {
    return {
      title: selectedDeckName ? `锁定「${selectedDeckName}」` : '选择一副卡组',
      detail: selectedDeckName ? '锁定后仍可在开局前更换。' : undefined,
    };
  }

  if (room.members.length < 2) {
    return { title: '等待另一位玩家加入' };
  }

  if (!bothReady) {
    return { title: '等待对手锁定卡组' };
  }

  if (room.status === 'OPENING') {
    return { title: '正在进行开局猜拳' };
  }

  if (!myMember.startReady) {
    return {
      title: '双方卡组已锁定',
      detail: '确认后进入开局猜拳。',
    };
  }

  if (room.members.some((member) => !member.startReady)) {
    return { title: '等待对手准备' };
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
