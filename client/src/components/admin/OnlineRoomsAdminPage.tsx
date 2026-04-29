import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Activity,
  Clock3,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { PageHeader, ThemeToggle } from '@/components/common';
import { fetchOnlineAdminRooms } from '@/lib/onlineClient';
import type {
  OnlineAdminRoomMemberSummary,
  OnlineAdminRoomSummary,
  OnlineRoomStatus,
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
              <table className="min-w-[1040px] w-full border-collapse text-left text-sm">
                <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-xs uppercase text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">房间</th>
                    <th className="px-4 py-3 font-semibold">玩家</th>
                    <th className="px-4 py-3 font-semibold">对局</th>
                    <th className="px-4 py-3 font-semibold">阶段</th>
                    <th className="px-4 py-3 font-semibold">最近活动</th>
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
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

function StatusBadge({ status }: { status: OnlineRoomStatus }) {
  const tone =
    status === 'IN_GAME'
      ? 'border-[color:var(--semantic-success)]/40 bg-[color:var(--semantic-success)]/10 text-[var(--semantic-success)]'
      : status === 'READY'
        ? 'border-[color:var(--semantic-warning)]/40 bg-[color:var(--semantic-warning)]/10 text-[var(--semantic-warning)]'
        : 'border-[color:var(--semantic-info)]/40 bg-[color:var(--semantic-info)]/10 text-[var(--semantic-info)]';
  const label = status === 'IN_GAME' ? '对局中' : status === 'READY' ? '已就绪' : '准备中';

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
