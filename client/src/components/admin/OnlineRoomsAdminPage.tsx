import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Activity,
  Clock3,
  Database,
  Download,
  Eye,
  ExternalLink,
  FileText,
  ListTree,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react';
import { PageHeader, ThemeToggle } from '@/components/common';
import {
  createOnlineAdminPlayerSpectatorLink,
  exportDebugReplayBundle,
  fetchDebugReplayCheckpoint,
  fetchDebugReplayTimeline,
  fetchOnlineAdminRooms,
  importDebugReplayBundle,
} from '@/lib/onlineClient';
import type {
  DebugReplayCheckpointView,
  DebugReplayImportSummary,
  DebugReplayTimelineView,
  OnlineAdminRoomMemberSummary,
  OnlineAdminRoomSummary,
  OnlineRoomStatus,
  ReplayRecordFrame,
  Seat,
} from '@game/online';

const ADMIN_ROOM_POLL_INTERVAL_MS = 2000;

interface OnlineRoomsAdminPageProps {
  onBack: () => void;
}

export function OnlineRoomsAdminPage({ onBack }: OnlineRoomsAdminPageProps) {
  const [rooms, setRooms] = useState<readonly OnlineAdminRoomSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [replayImportText, setReplayImportText] = useState('');
  const [replayError, setReplayError] = useState<string | null>(null);
  const [exportingMatchId, setExportingMatchId] = useState<string | null>(null);
  const [isImportingReplay, setIsImportingReplay] = useState(false);
  const [importedReplay, setImportedReplay] = useState<DebugReplayImportSummary | null>(null);
  const [replayTimeline, setReplayTimeline] = useState<DebugReplayTimelineView | null>(null);
  const [checkpointView, setCheckpointView] = useState<DebugReplayCheckpointView | null>(null);
  const [openingSpectatorKey, setOpeningSpectatorKey] = useState<string | null>(null);
  const [spectatorError, setSpectatorError] = useState<string | null>(null);
  const [viewerSeat, setViewerSeat] = useState<Seat>('FIRST');
  const [selectedCheckpointSeq, setSelectedCheckpointSeq] = useState<number | null>(null);

  // 始终持有最新的 viewerSeat，供异步回放加载读取，避免回调闭包捕获过时座位值。
  const viewerSeatRef = useRef<Seat>(viewerSeat);
  useEffect(() => {
    viewerSeatRef.current = viewerSeat;
  }, [viewerSeat]);

  const loadRooms = useCallback(async (showLoading: boolean) => {
    if (showLoading) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    try {
      const nextRooms = await fetchOnlineAdminRooms();
      setRooms(nextRooms);
      setError(null);
      setLastLoadedAt(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取联机房间监控数据失败');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const loadReplayBundle = useCallback(async (bundle: unknown) => {
    setIsImportingReplay(true);
    setReplayError(null);
    try {
      const imported = await importDebugReplayBundle(bundle);
      const timeline = await fetchDebugReplayTimeline(imported.bundleId);
      const checkpointSeq = findFirstCheckpointSeq(timeline.recordFrames);
      const nextCheckpointView =
        checkpointSeq !== null
          ? await fetchDebugReplayCheckpoint(
              imported.bundleId,
              checkpointSeq,
              viewerSeatRef.current
            )
          : null;

      setImportedReplay(imported);
      setReplayTimeline(timeline);
      setSelectedCheckpointSeq(checkpointSeq);
      setCheckpointView(nextCheckpointView);
    } catch (loadError) {
      setReplayError(loadError instanceof Error ? loadError.message : '导入调试回放包失败');
    } finally {
      setIsImportingReplay(false);
    }
  }, []);

  const handleExportReplay = useCallback(
    async (matchId: string, mode: 'DOWNLOAD' | 'LOAD') => {
      setExportingMatchId(matchId);
      setReplayError(null);
      try {
        const bundle = await exportDebugReplayBundle(matchId);
        if (mode === 'DOWNLOAD') {
          downloadJson(`debug-replay-${matchId}.json`, bundle);
        } else {
          await loadReplayBundle(bundle);
        }
      } catch (exportError) {
        setReplayError(exportError instanceof Error ? exportError.message : '导出调试回放包失败');
      } finally {
        setExportingMatchId(null);
      }
    },
    [loadReplayBundle]
  );

  const handleOpenSpectatorView = useCallback(async (matchId: string, seat: Seat) => {
    const key = `${matchId}:${seat}`;
    const targetWindow = window.open('about:blank', '_blank');
    if (targetWindow) {
      targetWindow.opener = null;
    }

    setOpeningSpectatorKey(key);
    setSpectatorError(null);
    try {
      const link = await createOnlineAdminPlayerSpectatorLink(matchId, seat);
      const url = new URL(link.path, window.location.origin).toString();
      if (targetWindow) {
        targetWindow.location.href = url;
      } else {
        const opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) {
          setSpectatorError('浏览器阻止了观战页弹窗，请允许弹窗后重试');
        }
      }
    } catch (openError) {
      targetWindow?.close();
      setSpectatorError(openError instanceof Error ? openError.message : '打开玩家视角观战失败');
    } finally {
      setOpeningSpectatorKey(null);
    }
  }, []);

  const handleImportReplayText = useCallback(async () => {
    if (!replayImportText.trim()) {
      setReplayError('请先填入调试回放包 JSON');
      return;
    }

    try {
      await loadReplayBundle(JSON.parse(replayImportText));
    } catch (parseError) {
      setReplayError(parseError instanceof Error ? parseError.message : '调试回放包 JSON 格式异常');
    }
  }, [loadReplayBundle, replayImportText]);

  const handleImportReplayFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }

      try {
        const text = await file.text();
        setReplayImportText(text);
        await loadReplayBundle(JSON.parse(text));
      } catch (fileError) {
        setReplayError(fileError instanceof Error ? fileError.message : '调试回放包文件读取失败');
      }
    },
    [loadReplayBundle]
  );

  const handleLoadCheckpoint = useCallback(
    async (checkpointSeq: number, seat: Seat = viewerSeatRef.current) => {
      if (!importedReplay) {
        return;
      }

      setReplayError(null);
      try {
        const nextCheckpointView = await fetchDebugReplayCheckpoint(
          importedReplay.bundleId,
          checkpointSeq,
          seat
        );
        setSelectedCheckpointSeq(checkpointSeq);
        setViewerSeat(seat);
        setCheckpointView(nextCheckpointView);
      } catch (checkpointError) {
        setReplayError(
          checkpointError instanceof Error ? checkpointError.message : '读取调试回放检查点失败'
        );
      }
    },
    [importedReplay]
  );

  useEffect(() => {
    void loadRooms(true);
  }, [loadRooms]);

  useEffect(() => {
    if (!autoRefresh) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadRooms(false);
    }, ADMIN_ROOM_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [autoRefresh, loadRooms]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    const inGameRooms = rooms.filter((room) => room.status === 'IN_GAME').length;
    const activeMembers = rooms.reduce(
      (total, room) => total + room.members.filter((member) => member.presence === 'ACTIVE').length,
      0
    );
    const leftMembers = rooms.reduce(
      (total, room) => total + room.members.filter((member) => member.presence === 'LEFT').length,
      0
    );

    return {
      totalRooms: rooms.length,
      inGameRooms,
      activeMembers,
      leftMembers,
    };
  }, [rooms]);

  return (
    <div className="app-shell min-h-screen">
      <PageHeader
        title="联机房间监控"
        icon={<ShieldCheck size={20} />}
        left={
          <button
            type="button"
            onClick={onBack}
            className="button-ghost inline-flex h-10 items-center justify-center gap-2 px-3"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">返回</span>
          </button>
        }
        right={
          <>
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setAutoRefresh((value) => !value)}
              className="button-ghost inline-flex h-10 items-center justify-center gap-2 px-3"
              title={autoRefresh ? '暂停自动刷新' : '恢复自动刷新'}
            >
              {autoRefresh ? <Pause size={16} /> : <Play size={16} />}
              <span className="hidden sm:inline">{autoRefresh ? '暂停' : '恢复'}</span>
            </button>
            <button
              type="button"
              onClick={() => void loadRooms(false)}
              disabled={isRefreshing}
              className="button-primary inline-flex h-10 items-center justify-center gap-2 px-3"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">刷新</span>
            </button>
          </>
        }
      />

      <main className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile icon={<Activity size={18} />} label="活跃房间" value={stats.totalRooms} />
          <StatTile icon={<Clock3 size={18} />} label="进行中对局" value={stats.inGameRooms} />
          <StatTile icon={<Users size={18} />} label="在线玩家" value={stats.activeMembers} />
          <StatTile icon={<Users size={18} />} label="失联玩家" value={stats.leftMembers} />
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
          <span>自动刷新：{autoRefresh ? '开启' : '暂停'}</span>
          <span>最近更新：{lastLoadedAt ? formatDateTime(lastLoadedAt) : '-'}</span>
        </div>

        {error ? (
          <div className="rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:var(--semantic-error)]/10 px-4 py-3 text-sm text-[var(--semantic-error)]">
            {error}
          </div>
        ) : null}
        {spectatorError ? (
          <div className="rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:var(--semantic-error)]/10 px-4 py-3 text-sm text-[var(--semantic-error)]">
            {spectatorError}
          </div>
        ) : null}

        <section className="surface-panel overflow-hidden">
          {isLoading ? (
            <div className="flex min-h-72 items-center justify-center text-sm text-[var(--text-secondary)]">
              <RefreshCw size={18} className="mr-2 animate-spin text-[var(--accent-primary)]" />
              正在读取房间状态
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center gap-2 px-4 text-center">
              <Activity size={28} className="text-[var(--text-muted)]" />
              <div className="text-base font-semibold text-[var(--text-primary)]">暂无活跃房间</div>
              <div className="text-sm text-[var(--text-secondary)]">
                当前后端进程没有可观测的联机房间。
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1180px] w-full border-collapse text-left text-sm">
                <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-xs uppercase text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">房间</th>
                    <th className="px-4 py-3 font-semibold">玩家</th>
                    <th className="px-4 py-3 font-semibold">对局</th>
                    <th className="px-4 py-3 font-semibold">阶段</th>
                    <th className="px-4 py-3 font-semibold">最近活动</th>
                    <th className="px-4 py-3 font-semibold">观战 / 回放</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room, index) => (
                    <motion.tr
                      key={room.roomCode}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, delay: index * 0.02 }}
                      className="border-b border-[var(--border-subtle)] align-top last:border-0 hover:bg-[var(--bg-overlay)]/70"
                    >
                      <td className="px-4 py-4">
                        <div className="flex flex-col gap-2">
                          <div className="font-mono text-lg font-bold text-[var(--text-primary)]">
                            {room.roomCode}
                          </div>
                          <StatusBadge status={room.status} />
                          <div className="text-xs text-[var(--text-muted)]">
                            owner {shortId(room.ownerUserId)}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="grid gap-2">
                          {room.members.map((member) => (
                            <MemberRow key={member.userId} member={member} />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        {room.match ? (
                          <div className="grid gap-1.5">
                            <div className="font-mono text-xs text-[var(--text-secondary)]">
                              {shortId(room.match.matchId)}
                            </div>
                            <div className="text-xs text-[var(--text-muted)]">
                              开始 {formatDateTime(room.match.startedAt)}
                            </div>
                            <div className="text-sm font-semibold text-[var(--accent-primary)]">
                              已持续 {formatDuration(now - room.match.startedAt)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-[var(--text-muted)]">尚未开始</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {room.match ? (
                          <div className="grid gap-1.5 text-sm">
                            <div className="font-semibold text-[var(--text-primary)]">
                              {room.match.phase}
                            </div>
                            <div className="text-xs text-[var(--text-secondary)]">
                              {room.match.subPhase}
                            </div>
                            <div className="text-xs text-[var(--text-muted)]">
                              T{room.match.turnCount} · seq {room.match.seq} · active{' '}
                              {room.match.activeSeat ?? '-'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-[var(--text-muted)]">等待准备</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <div className="grid gap-1.5 text-xs text-[var(--text-muted)]">
                          <span>房间 {formatRelativeMs(now - room.updatedAt)}</span>
                          {room.match ? (
                            <span>对局 {formatRelativeMs(now - room.match.lastActivityAt)}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <RoomMatchOperations
                          room={room}
                          exportingMatchId={exportingMatchId}
                          openingSpectatorKey={openingSpectatorKey}
                          onOpenSpectatorView={(matchId, seat) =>
                            void handleOpenSpectatorView(matchId, seat)
                          }
                          onExportReplay={(matchId, mode) => void handleExportReplay(matchId, mode)}
                        />
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="surface-panel overflow-hidden">
          <div className="border-b border-[var(--border-subtle)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Database size={18} className="text-[var(--accent-primary)]" />
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--text-primary)]">Debug Replay E0</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {importedReplay
                      ? `${shortId(importedReplay.bundleId)} · ${importedReplay.checkpointCount} checkpoint`
                      : '未载入'}
                  </div>
                </div>
              </div>
              <label className="button-ghost inline-flex h-10 cursor-pointer items-center justify-center gap-2 border border-[var(--border-default)] px-3 text-sm">
                <Upload size={15} />
                文件
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImportReplayFile}
                />
              </label>
            </div>
          </div>

          <div className="grid gap-0 lg:grid-cols-[minmax(280px,420px)_1fr]">
            <div className="border-b border-[var(--border-subtle)] p-4 lg:border-b-0 lg:border-r">
              <textarea
                value={replayImportText}
                onChange={(event) => setReplayImportText(event.target.value)}
                className="min-h-40 w-full resize-y rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] outline-none transition focus:border-[var(--border-active)]"
                placeholder="DebugReplayBundle JSON"
                spellCheck={false}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleImportReplayText()}
                  disabled={isImportingReplay}
                  className="button-primary inline-flex min-h-10 items-center justify-center gap-2 px-4 text-sm disabled:opacity-50"
                >
                  <Upload size={15} />
                  导入
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReplayImportText('');
                    setImportedReplay(null);
                    setReplayTimeline(null);
                    setCheckpointView(null);
                    setSelectedCheckpointSeq(null);
                    setReplayError(null);
                  }}
                  className="button-ghost inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] px-4 text-sm"
                >
                  <FileText size={15} />
                  清空
                </button>
              </div>

              {replayError ? (
                <div className="mt-3 rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]">
                  {replayError}
                </div>
              ) : null}
            </div>

            <div className="grid min-h-[360px] gap-0 xl:grid-cols-[minmax(280px,360px)_1fr]">
              <div className="border-b border-[var(--border-subtle)] p-4 xl:border-b-0 xl:border-r">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <ListTree size={16} className="text-[var(--accent-primary)]" />
                  Timeline
                </div>
                {replayTimeline ? (
                  <div className="max-h-[520px] overflow-y-auto pr-1">
                    <div className="grid gap-2">
                      {replayTimeline.recordFrames.map((frame) => (
                        <TimelineButton
                          key={frame.timelineSeq}
                          frame={frame}
                          selectedCheckpointSeq={selectedCheckpointSeq}
                          onSelectCheckpoint={(checkpointSeq) =>
                            void handleLoadCheckpoint(checkpointSeq)
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyReplayPanel label="暂无 timeline" />
                )}
              </div>

              <div className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                    <Eye size={16} className="text-[var(--accent-primary)]" />
                    Checkpoint
                  </div>
                  <div className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-1">
                    {(['FIRST', 'SECOND'] as const).map((seat) => (
                      <button
                        key={seat}
                        type="button"
                        onClick={() =>
                          selectedCheckpointSeq !== null
                            ? void handleLoadCheckpoint(selectedCheckpointSeq, seat)
                            : setViewerSeat(seat)
                        }
                        className={`h-8 rounded-md px-3 text-xs font-semibold transition ${
                          viewerSeat === seat
                            ? 'bg-[var(--accent-primary)] text-white'
                            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]'
                        }`}
                      >
                        {seat}
                      </button>
                    ))}
                  </div>
                </div>

                {checkpointView ? (
                  <CheckpointSummary checkpointView={checkpointView} now={now} />
                ) : (
                  <EmptyReplayPanel label="暂无 checkpoint" />
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="surface-panel-frosted flex items-center gap-3 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--accent-primary)]">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-[var(--text-muted)]">{label}</div>
        <div className="text-2xl font-bold leading-tight text-[var(--text-primary)]">{value}</div>
      </div>
    </div>
  );
}

function RoomMatchOperations({
  room,
  exportingMatchId,
  openingSpectatorKey,
  onOpenSpectatorView,
  onExportReplay,
}: {
  room: OnlineAdminRoomSummary;
  exportingMatchId: string | null;
  openingSpectatorKey: string | null;
  onOpenSpectatorView: (matchId: string, seat: Seat) => void;
  onExportReplay: (matchId: string, mode: 'DOWNLOAD' | 'LOAD') => void;
}) {
  if (!room.match) {
    return <span className="text-sm text-[var(--text-muted)]">-</span>;
  }

  const matchId = room.match.matchId;

  return (
    <div className="grid min-w-48 gap-2">
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
          <Eye size={13} />
          玩家视角
        </div>
        <div className="grid gap-1.5">
          {(['FIRST', 'SECOND'] as const).map((seat) => {
            const member = room.members.find((candidate) => candidate.seat === seat);
            const spectatorKey = `${matchId}:${seat}`;
            const loading = openingSpectatorKey === spectatorKey;
            return (
              <button
                key={seat}
                type="button"
                onClick={() => onOpenSpectatorView(matchId, seat)}
                disabled={!member || openingSpectatorKey !== null}
                title={
                  member
                    ? `以${formatSeatLabel(seat)} ${member.displayName} 视角观战，管理员不计入公开观战人数`
                    : `未找到${formatSeatLabel(seat)}玩家`
                }
                className="button-ghost inline-flex min-h-9 min-w-0 items-center justify-center gap-1.5 border border-[var(--border-default)] px-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <ExternalLink size={14} />
                )}
                <span className="min-w-0 truncate">
                  {formatSeatLabel(seat)}
                  {member ? ` · ${member.displayName}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onExportReplay(matchId, 'LOAD')}
          disabled={exportingMatchId === matchId}
          className="button-primary inline-flex min-h-9 items-center justify-center gap-1.5 px-3 text-xs font-semibold disabled:opacity-50"
        >
          <Eye size={14} />
          载入
        </button>
        <button
          type="button"
          onClick={() => onExportReplay(matchId, 'DOWNLOAD')}
          disabled={exportingMatchId === matchId}
          className="button-ghost inline-flex min-h-9 items-center justify-center gap-1.5 border border-[var(--border-default)] px-3 text-xs disabled:opacity-50"
        >
          <Download size={14} />
          导出
        </button>
      </div>
    </div>
  );
}

function TimelineButton({
  frame,
  selectedCheckpointSeq,
  onSelectCheckpoint,
}: {
  frame: ReplayRecordFrame;
  selectedCheckpointSeq: number | null;
  onSelectCheckpoint: (checkpointSeq: number) => void;
}) {
  const checkpointSeq = frame.relatedCheckpointSeq;
  const isSelected = checkpointSeq !== null && checkpointSeq === selectedCheckpointSeq;

  return (
    <button
      type="button"
      onClick={() => checkpointSeq !== null && onSelectCheckpoint(checkpointSeq)}
      disabled={checkpointSeq === null}
      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
        isSelected
          ? 'border-[var(--border-active)] bg-[var(--accent-primary)]/10'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)] hover:bg-[var(--bg-overlay)]'
      } disabled:cursor-default disabled:opacity-70`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs font-semibold text-[var(--accent-primary)]">
          #{frame.timelineSeq}
        </span>
        <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
          {frame.frameType}
        </span>
      </div>
      <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">{frame.summary}</div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">
        {formatDateTime(frame.createdAt)}
        {checkpointSeq !== null ? ` · checkpoint ${checkpointSeq}` : ''}
      </div>
    </button>
  );
}

function CheckpointSummary({
  checkpointView,
  now,
}: {
  checkpointView: DebugReplayCheckpointView;
  now: number;
}) {
  const visibleObjectCount = Object.keys(checkpointView.playerViewState.objects).length;
  const frontObjectCount = Object.values(checkpointView.playerViewState.objects).filter(
    (object) => object.surface === 'FRONT'
  ).length;
  const zoneEntries = Object.entries(checkpointView.playerViewState.table.zones).slice(0, 10);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <MiniMetric label="视角" value={checkpointView.viewerSeat} />
        <MiniMetric label="可见对象" value={visibleObjectCount} />
        <MiniMetric label="正面对象" value={frontObjectCount} />
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-[var(--text-primary)]">
              {checkpointView.checkpointInfo.phase}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              {checkpointView.checkpointInfo.subPhase}
            </div>
          </div>
          <div className="text-right text-xs text-[var(--text-muted)]">
            <div>T{checkpointView.checkpointInfo.turnCount}</div>
            <div>{formatRelativeMs(now - checkpointView.checkpointInfo.createdAt)}</div>
          </div>
        </div>
        <div className="mt-3 grid gap-1.5 text-xs text-[var(--text-muted)]">
          <span>match {shortId(checkpointView.checkpointInfo.matchId)}</span>
          <span>timeline #{checkpointView.checkpointInfo.timelineSeq}</span>
          <span>public seq {checkpointView.checkpointInfo.relatedPublicSeq ?? '-'}</span>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-xs font-semibold uppercase text-[var(--text-muted)]">
          Zones
        </div>
        <div className="grid divide-y divide-[var(--border-subtle)]">
          {zoneEntries.map(([zoneKey, zone]) => (
            <div key={zoneKey} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-sm">
              <span className="truncate font-mono text-xs text-[var(--text-secondary)]">
                {zoneKey}
              </span>
              <span className="text-xs font-semibold text-[var(--text-primary)]">{zone.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 truncate font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function EmptyReplayPanel({ label }: { label: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-sm text-[var(--text-muted)]">
      {label}
    </div>
  );
}

function StatusBadge({ status }: { status: OnlineRoomStatus }) {
  const tone =
    status === 'IN_GAME'
      ? 'border-[color:var(--semantic-success)]/40 bg-[color:var(--semantic-success)]/10 text-[var(--semantic-success)]'
      : status === 'OPENING'
        ? 'border-[color:var(--accent-primary)]/40 bg-[color:var(--accent-primary)]/10 text-[var(--accent-primary)]'
        : status === 'READY'
          ? 'border-[color:var(--semantic-warning)]/40 bg-[color:var(--semantic-warning)]/10 text-[var(--semantic-warning)]'
          : 'border-[color:var(--semantic-info)]/40 bg-[color:var(--semantic-info)]/10 text-[var(--semantic-info)]';
  const label =
    status === 'IN_GAME'
      ? '对局中'
      : status === 'OPENING'
        ? '开局中'
        : status === 'READY'
          ? '已就绪'
          : '准备中';

  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

function MemberRow({ member }: { member: OnlineAdminRoomMemberSummary }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold text-[var(--text-primary)]">
            {member.displayName}
          </div>
          <div className="font-mono text-xs text-[var(--text-muted)]">{shortId(member.userId)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
            {member.seat ?? member.role}
          </span>
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              member.presence === 'ACTIVE'
                ? 'bg-[var(--semantic-success)]'
                : 'bg-[var(--text-muted)]'
            }`}
            title={member.presence === 'ACTIVE' ? '在线' : '失联'}
          />
        </div>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5 text-xs">
        <span className="chip-badge max-w-full truncate px-2 py-1">
          {member.lockedDeckName ?? '未锁定卡组'}
        </span>
        <span className="chip-badge px-2 py-1">{member.ready ? 'ready' : 'pending'}</span>
      </div>
    </div>
  );
}

function formatSeatLabel(seat: Seat): string {
  return seat === 'FIRST' ? '先攻' : '后攻';
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatRelativeMs(ms: number): string {
  return `${formatDuration(ms)}前`;
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function findFirstCheckpointSeq(frames: readonly ReplayRecordFrame[]): number | null {
  return frames.find((frame) => frame.relatedCheckpointSeq !== null)?.relatedCheckpointSeq ?? null;
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
