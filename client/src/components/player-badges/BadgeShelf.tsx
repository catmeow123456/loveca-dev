import type { PlayerBadgeView } from '@game/online/player-badge-types';
import { Award, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { ActionButton, Panel, SectionHeading, StatusBadge } from '@/components/common';

export interface BadgeShelfProps {
  badges: readonly PlayerBadgeView[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function BadgeShelf({ badges, loading, error, onRetry }: BadgeShelfProps) {
  return (
    <Panel as="section" padding="none" aria-labelledby="player-badge-shelf-title">
      <div className="flex items-start gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
        <span className="mt-0.5 shrink-0 text-[var(--accent-gold)]" aria-hidden="true">
          <Award size={18} />
        </span>
        <SectionHeading
          id="player-badge-shelf-title"
          className="min-w-0 flex-1"
          title="我的徽章"
          description="记录你在 Loveca 留下的纪念。"
          action={
            !loading && !error && badges.length > 0 ? (
              <StatusBadge tone="warning">{badges.length} 枚</StatusBadge>
            ) : undefined
          }
        />
      </div>

      <div className="px-4 py-4 sm:px-5" aria-busy={loading}>
        {loading ? <BadgeShelfLoading /> : null}
        {!loading && error ? <BadgeShelfError message={error} onRetry={onRetry} /> : null}
        {!loading && !error && badges.length === 0 ? <BadgeShelfEmpty /> : null}
        {!loading && !error && badges.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {badges.map((badge) => (
              <BadgeCard key={badge.key} badge={badge} />
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function BadgeCard({ badge }: { badge: PlayerBadgeView }) {
  const dateLabel = formatBadgeDate(badge.awardedAt);
  const sourceLabel = `${badge.sourceActivity.name} · ${dateLabel}`;

  return (
    <article className="relative overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent-gold)_36%,var(--border-subtle))] bg-[color:color-mix(in_srgb,var(--accent-gold)_7%,var(--bg-surface))] p-3.5">
      <Sparkles
        size={34}
        className="pointer-events-none absolute -right-1 -top-1 text-[color:color-mix(in_srgb,var(--accent-gold)_24%,transparent)]"
        aria-hidden="true"
      />
      <div className="flex min-w-0 items-center gap-3.5">
        <div className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--accent-gold)_24%,var(--border-subtle))] bg-[var(--brand-card-white)] p-1.5 shadow-[var(--shadow-sm)]">
          <img
            className="h-full w-full object-contain"
            src={badge.imageUrl}
            alt=""
            aria-hidden="true"
            loading="lazy"
          />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-5 text-[var(--text-primary)]">{badge.name}</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{badge.description}</p>
          <p className="mt-2 text-[11px] font-semibold leading-4 text-[var(--text-muted)]">
            {sourceLabel}
          </p>
        </div>
      </div>
    </article>
  );
}

function BadgeShelfLoading() {
  return (
    <div className="flex min-h-[116px] items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
      <Loader2 size={17} className="animate-spin text-[var(--accent-gold)]" aria-hidden="true" />
      <span>正在整理徽章……</span>
    </div>
  );
}

function BadgeShelfError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="flex min-h-[116px] flex-col items-start justify-center gap-3 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_28%,var(--border-subtle))] bg-[color:color-mix(in_srgb,var(--semantic-error)_8%,var(--bg-surface))] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">暂时无法读取徽章</p>
        <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{message}</p>
      </div>
      <ActionButton variant="secondary" size="compact" onClick={onRetry}>
        <RotateCcw size={14} />
        重试
      </ActionButton>
    </div>
  );
}

function BadgeShelfEmpty() {
  return (
    <div className="flex min-h-[116px] items-center gap-3 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-overlay)] px-4 py-3">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[color:color-mix(in_srgb,var(--accent-gold)_14%,transparent)] text-[var(--accent-gold)]">
        <Award size={21} aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">还没有徽章</p>
        <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
          参与指定活动或达成赛季里程碑后，徽章会收藏在这里。
        </p>
      </div>
    </div>
  );
}

function formatBadgeDate(value: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '获得日期未知';
  }
  return `${new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)}获得`;
}
