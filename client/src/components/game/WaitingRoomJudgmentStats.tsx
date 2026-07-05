import { cn } from '@/lib/utils';
import { HEART_ICON_SOURCE_BY_COLOR } from '@/lib/modifierIconAssets';
import {
  hasWaitingRoomJudgmentStats,
  type WaitingRoomJudgmentStats,
} from '@/lib/waitingRoomJudgmentStats';
import { HeartColor } from '@game/shared/types/enums';

const WAITING_ROOM_HEART_ORDER = [
  HeartColor.RAINBOW,
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
] as const;

const WAITING_ROOM_HEART_LABELS: Record<HeartColor, string> = {
  [HeartColor.RAINBOW]: 'All',
  [HeartColor.PINK]: '桃',
  [HeartColor.RED]: '红',
  [HeartColor.YELLOW]: '黄',
  [HeartColor.GREEN]: '绿',
  [HeartColor.BLUE]: '蓝',
  [HeartColor.PURPLE]: '紫',
};

function WaitingRoomHeartStatChip({
  color,
  count,
  showZero = false,
}: {
  color: HeartColor;
  count: number;
  showZero?: boolean;
}) {
  if (count <= 0 && !showZero) return null;

  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium',
        count > 0
          ? 'border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-surface)_82%,transparent)] text-[var(--text-primary)]'
          : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_45%,transparent)] text-[var(--text-muted)]'
      )}
    >
      <img
        src={HEART_ICON_SOURCE_BY_COLOR[color]}
        alt=""
        className="h-4 w-4 object-contain"
        draggable={false}
      />
      <span>{WAITING_ROOM_HEART_LABELS[color]}</span>
      <span className="font-bold tabular-nums">{count}</span>
    </span>
  );
}

function WaitingRoomSpecialStatChip({
  label,
  count,
  accent,
  showZero = false,
}: {
  label: string;
  count: number;
  accent: 'score' | 'draw';
  showZero?: boolean;
}) {
  if (count <= 0 && !showZero) return null;

  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium',
        count > 0
          ? accent === 'score'
            ? 'border-amber-300/50 bg-amber-400/10 text-amber-200'
            : 'border-cyan-300/50 bg-cyan-400/10 text-cyan-200'
          : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_45%,transparent)] text-[var(--text-muted)]'
      )}
    >
      <span
        className={cn(
          'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-black leading-none',
          count > 0
            ? accent === 'score'
              ? 'bg-amber-300/20 text-amber-100'
              : 'bg-cyan-300/20 text-cyan-100'
            : 'bg-[var(--bg-overlay)] text-[var(--text-muted)]'
        )}
      >
        {accent === 'score' ? '+' : '抽'}
      </span>
      <span>{label}</span>
      <span className="font-bold tabular-nums">{count}</span>
    </span>
  );
}

export function WaitingRoomJudgmentStatsDetail({
  stats,
  className,
}: {
  stats: WaitingRoomJudgmentStats;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_96%,transparent)] p-2.5 shadow-[var(--shadow-lg)] backdrop-blur-md',
        className
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-[var(--text-primary)]">判心统计</span>
        <span className="text-[var(--text-muted)]">合计 {stats.totalHearts} 心</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {WAITING_ROOM_HEART_ORDER.map((color) => (
          <WaitingRoomHeartStatChip
            key={color}
            color={color}
            count={stats.hearts[color] ?? 0}
            showZero
          />
        ))}
        <WaitingRoomSpecialStatChip
          label="加分判"
          count={stats.scoreBonus}
          accent="score"
          showZero
        />
        <WaitingRoomSpecialStatChip label="抽卡标" count={stats.drawBonus} accent="draw" showZero />
      </div>
    </div>
  );
}

export function WaitingRoomJudgmentSummaryChips({ stats }: { stats: WaitingRoomJudgmentStats }) {
  const heartEntries = WAITING_ROOM_HEART_ORDER.filter((color) => (stats.hearts[color] ?? 0) > 0);
  const hasStats = hasWaitingRoomJudgmentStats(stats);
  const visibleHeartEntries = heartEntries.slice(0, 4);
  const hiddenCount =
    Math.max(0, heartEntries.length - visibleHeartEntries.length) +
    (stats.scoreBonus > 0 && visibleHeartEntries.length >= 4 ? 1 : 0) +
    (stats.drawBonus > 0 && visibleHeartEntries.length >= 4 ? 1 : 0);

  if (!hasStats) {
    return <span className="hidden text-xs text-[var(--text-muted)] md:inline-flex">无判定标</span>;
  }

  return (
    <div className="hidden min-w-0 items-center justify-end gap-1 overflow-hidden md:flex">
      {visibleHeartEntries.map((color) => (
        <WaitingRoomHeartStatChip key={color} color={color} count={stats.hearts[color] ?? 0} />
      ))}
      {visibleHeartEntries.length < 4 && (
        <WaitingRoomSpecialStatChip label="加分" count={stats.scoreBonus} accent="score" />
      )}
      {visibleHeartEntries.length < 4 && (
        <WaitingRoomSpecialStatChip label="抽卡" count={stats.drawBonus} accent="draw" />
      )}
      {hiddenCount > 0 && (
        <span className="inline-flex h-7 shrink-0 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 text-[11px] font-bold text-[var(--text-muted)]">
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}
