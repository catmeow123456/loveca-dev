import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Images,
  Loader2,
  RefreshCw,
  Shield,
  SmilePlus,
  Sparkles,
} from 'lucide-react';
import { ActionButton, PageHeader } from '@/components/common';
import type { ActivityBadgeAdminView } from '@game/online/activity-badge-types';
import type {
  ActivityCoverAdminView,
  ActivityCoverActivityType,
} from '@game/online/activity-cover-types';
import { fetchActivityBadgeAdmin } from '@/lib/activityBadgeClient';
import { fetchActivityCoverAdmin } from '@/lib/activityCoverClient';
import {
  fetchAdminMatchEmoteCatalog,
  type AdminMatchEmoteCatalog,
} from '@/lib/matchEmoteAdminClient';
import { fetchRankedSeasons, type RankedAdminSeason } from '@/lib/rankedAdminClient';
import { fetchThemeAdminEvents, type ThemeAdminEventView } from '@/lib/themeTableAdminClient';
import { PUBLIC_STATIC_IMAGE_ASSETS } from '@game/shared/public-static-assets';
import { AssetDownloadButton } from './AssetDownloadButton';

interface ImageAssetCatalogPageProps {
  readonly onBack: () => void;
  readonly onOpenCardImages?: () => void;
  readonly onOpenMusicAssets?: () => void;
  readonly onOpenEmoteAdmin?: () => void;
  readonly canViewEmotes?: boolean;
  readonly canViewRanked?: boolean;
  readonly canViewTheme?: boolean;
}

interface ActivityImageRecord {
  readonly activityType: ActivityCoverActivityType;
  readonly activityId: string;
  readonly name: string;
  readonly lifecycle: string;
  readonly cover: ActivityCoverAdminView | null;
  readonly badge: ActivityBadgeAdminView | null;
  readonly coverReadFailed: boolean;
  readonly badgeReadFailed: boolean;
}

export function ImageAssetCatalogPage({
  onBack,
  onOpenCardImages,
  onOpenMusicAssets,
  onOpenEmoteAdmin,
  canViewEmotes = false,
  canViewRanked = false,
  canViewTheme = false,
}: ImageAssetCatalogPageProps) {
  const [emotes, setEmotes] = useState<AdminMatchEmoteCatalog | null>(null);
  const [activities, setActivities] = useState<readonly ActivityImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setReloading(true);
      else setLoading(true);
      setError(null);
      const failures: string[] = [];
      try {
        const emotePromise = canViewEmotes
          ? fetchAdminMatchEmoteCatalog().catch((cause: unknown) => {
              failures.push('快捷表情');
              throw cause;
            })
          : Promise.resolve(null);
        const rankedPromise = canViewRanked
          ? fetchRankedSeasons().catch((cause: unknown) => {
              failures.push('排位活动');
              throw cause;
            })
          : Promise.resolve([] as RankedAdminSeason[]);
        const themePromise = canViewTheme
          ? fetchThemeAdminEvents().catch((cause: unknown) => {
              failures.push('娱乐活动');
              throw cause;
            })
          : Promise.resolve([] as ThemeAdminEventView[]);

        const [nextEmotes, ranked, theme] = await Promise.allSettled([
          emotePromise,
          rankedPromise,
          themePromise,
        ]);
        if (nextEmotes.status === 'fulfilled') setEmotes(nextEmotes.value);
        if (ranked.status === 'rejected') failures.push('排位活动');
        if (theme.status === 'rejected') failures.push('娱乐活动');

        const activityTargets: readonly {
          type: ActivityCoverActivityType;
          id: string;
          name: string;
          lifecycle: string;
        }[] = [
          ...(ranked.status === 'fulfilled'
            ? ranked.value.map((season) => ({
                type: 'RANKED' as const,
                id: season.id,
                name: season.name,
                lifecycle: season.lifecycle,
              }))
            : []),
          ...(theme.status === 'fulfilled'
            ? theme.value.map((event) => ({
                type: 'THEME' as const,
                id: event.id,
                name: event.name,
                lifecycle: event.lifecycle,
              }))
            : []),
        ];

        const nextActivities = await Promise.all(
          activityTargets.map(async (target) => {
            const [cover, badge] = await Promise.allSettled([
              fetchActivityCoverAdmin(target.type, target.id),
              fetchActivityBadgeAdmin(target.type, target.id),
            ]);
            if (cover.status === 'rejected') failures.push(`「${target.name}」封面`);
            if (badge.status === 'rejected') failures.push(`「${target.name}」徽章`);
            return {
              activityType: target.type,
              activityId: target.id,
              name: target.name,
              lifecycle: target.lifecycle,
              cover: cover.status === 'fulfilled' ? cover.value : null,
              badge: badge.status === 'fulfilled' ? badge.value : null,
              coverReadFailed: cover.status === 'rejected',
              badgeReadFailed: badge.status === 'rejected',
            } satisfies ActivityImageRecord;
          })
        );
        setActivities(nextActivities);
        if (failures.length > 0) {
          setError(`部分图片资产读取失败：${[...new Set(failures)].join('、')}`);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '读取图片资产失败');
      } finally {
        setLoading(false);
        setReloading(false);
      }
    },
    [canViewEmotes, canViewRanked, canViewTheme]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const counts = useMemo(
    () => ({
      static: PUBLIC_STATIC_IMAGE_ASSETS.length,
      emotes: emotes?.items.length ?? 0,
      covers: activities.some((item) => item.coverReadFailed)
        ? null
        : activities.filter((item) => item.cover?.wide || item.cover?.compact).length,
      badges: activities.some((item) => item.badgeReadFailed)
        ? null
        : activities.filter((item) => item.badge?.badge).length,
    }),
    [activities, emotes]
  );

  return (
    <div className="app-shell min-h-screen">
      <PageHeader
        title="图片资产目录"
        description="只读盘点 · 公共图片、活动媒体与快捷表情"
        onBack={onBack}
        backLabel="返回管理中心"
        right={
          <div className="flex items-center gap-1.5">
            {onOpenCardImages ? (
              <ActionButton
                variant="ghost"
                size="compact"
                onClick={onOpenCardImages}
                className="gap-1.5"
              >
                <Images size={14} aria-hidden="true" />
                卡图资源
              </ActionButton>
            ) : null}
            {onOpenMusicAssets ? (
              <ActionButton
                variant="ghost"
                size="compact"
                onClick={onOpenMusicAssets}
                className="gap-1.5"
              >
                <Sparkles size={14} aria-hidden="true" />
                音乐资源
              </ActionButton>
            ) : null}
            <ActionButton
              variant="secondary"
              size="compact"
              onClick={() => void load(true)}
              disabled={loading || reloading}
              className="gap-1.5"
            >
              <RefreshCw size={14} className={reloading ? 'animate-spin' : ''} aria-hidden="true" />
              刷新
            </ActionButton>
          </div>
        }
        className="[&_.page-header-inner]:min-h-0 [&_.page-header-inner]:!grid-cols-[auto_minmax(0,1fr)] [&_.page-header-inner]:py-2 [&_.page-header-actions]:!col-[1/-1] [&_.page-header-title]:text-base [&_.page-header-description]:hidden sm:[&_.page-header-title]:text-lg md:[&_.page-header-inner]:!grid-cols-[auto_minmax(0,1fr)_auto] md:[&_.page-header-actions]:!col-[3/4]"
      />

      <main className="product-page-main">
        <div className="mx-auto max-w-[90rem]">
          <section className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Images size={16} className="text-[var(--accent-primary)]" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">公共图片</h2>
              <span className="font-mono text-[9px] uppercase tracking-[.16em] text-[var(--text-muted)]">
                read only
              </span>
            </div>
            <div className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <CatalogMetric label="静态图" value={counts.static} />
              <CatalogMetric label="快捷表情" value={counts.emotes} />
              <CatalogMetric label="活动封面" value={counts.covers} />
              <CatalogMetric label="活动徽章" value={counts.badges} />
            </div>
          </section>

          {error ? (
            <div
              role="alert"
              className="mb-4 border border-[color:color-mix(in_srgb,var(--semantic-error)_40%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-error)_8%,var(--bg-surface))] px-4 py-3 text-sm text-[var(--semantic-error)]"
            >
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
              正在读取图片资产
            </div>
          ) : (
            <div className="space-y-5">
              <StaticImageSection />
              {canViewEmotes ? <EmoteSection catalog={emotes} onManage={onOpenEmoteAdmin} /> : null}
              {canViewRanked || canViewTheme ? (
                <ActivityImageSection activities={activities} />
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function StaticImageSection() {
  return (
    <AssetSection icon={<Images size={16} />} title="随应用发布的图片" eyebrow="STATIC">
      <div className="grid grid-cols-2 gap-px bg-[var(--border-subtle)] sm:grid-cols-3 lg:grid-cols-5">
        {PUBLIC_STATIC_IMAGE_ASSETS.map((asset) => (
          <article key={asset.id} className="bg-[var(--bg-surface)] p-3">
            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-[var(--bg-surface-muted)]">
              <img
                src={asset.publicUrl}
                alt=""
                className="h-full w-full object-contain"
                loading="lazy"
              />
            </div>
            <h3
              className="mt-2 truncate text-xs font-semibold text-[var(--text-primary)]"
              title={asset.title}
            >
              {asset.title}
            </h3>
            <p
              className="mt-1 truncate text-[10px] text-[var(--text-muted)]"
              title={asset.publicUrl}
            >
              {asset.publicUrl}
            </p>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              {asset.delivery === 'OBJECT_STORAGE' ? '公共对象存储' : '前端版本资源'}
            </p>
            <AssetDownloadButton
              url={asset.publicUrl}
              accessibleLabel={`下载图片 ${asset.title}`}
            />
          </article>
        ))}
      </div>
    </AssetSection>
  );
}

function EmoteSection({
  catalog,
  onManage,
}: {
  catalog: AdminMatchEmoteCatalog | null;
  onManage?: () => void;
}) {
  return (
    <AssetSection
      icon={<SmilePlus size={16} />}
      title="快捷表情"
      eyebrow="EMOTE"
      action={
        onManage ? (
          <ActionButton variant="ghost" size="compact" onClick={onManage}>
            管理表情
          </ActionButton>
        ) : null
      }
    >
      {!catalog || catalog.items.length === 0 ? (
        <EmptyState text="暂无已发布快捷表情" />
      ) : (
        <div className="grid grid-cols-2 gap-px bg-[var(--border-subtle)] sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {catalog.items.map((item) => (
            <article key={item.id} className="bg-[var(--bg-surface)] p-3">
              <div className="flex aspect-square items-center justify-center overflow-hidden bg-[var(--bg-surface-muted)]">
                <img
                  src={item.asset.staticImageUrl}
                  alt={item.label}
                  className="h-full w-full object-contain"
                  loading="lazy"
                />
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <h3 className="truncate text-xs font-semibold text-[var(--text-primary)]">
                  {item.label}
                </h3>
                {!item.enabled ? (
                  <span className="text-[10px] text-[var(--text-muted)]">已停用</span>
                ) : null}
              </div>
              <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">{item.id}</p>
              <p className="mt-1 text-[10px] tabular-nums text-[var(--text-muted)]">
                {item.asset.width} × {item.asset.height} ·{' '}
                {item.asset.animatedImageUrl ? '含动图' : '静态'}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-3">
                <AssetDownloadButton
                  url={item.asset.staticImageUrl}
                  filename={`${item.label}-静态.webp`}
                  label="静态图"
                  accessibleLabel={`下载表情 ${item.label} 静态图`}
                />
                {item.asset.animatedImageUrl ? (
                  <AssetDownloadButton
                    url={item.asset.animatedImageUrl}
                    filename={`${item.label}-动图.webp`}
                    label="动图"
                    accessibleLabel={`下载表情 ${item.label} 动图`}
                  />
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </AssetSection>
  );
}

function ActivityImageSection({ activities }: { activities: readonly ActivityImageRecord[] }) {
  return (
    <AssetSection icon={<Shield size={16} />} title="活动媒体" eyebrow="ACTIVITY">
      {activities.length === 0 ? (
        <EmptyState text="暂无可查看的排位或娱乐活动" />
      ) : (
        <div className="divide-y divide-[var(--border-subtle)]">
          {activities.map((activity) => (
            <article
              key={`${activity.activityType}:${activity.activityId}`}
              className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(11rem,.8fr)_minmax(18rem,1.5fr)_minmax(9rem,.5fr)] lg:items-center"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[.14em] text-[var(--accent-primary)]">
                    {activity.activityType}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">{activity.lifecycle}</span>
                </div>
                <h3
                  className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]"
                  title={activity.name}
                >
                  {activity.name}
                </h3>
                <p className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">
                  {activity.activityId}
                </p>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-2">
                <MediaPreview
                  label="宽屏封面"
                  url={activity.cover?.wide?.url ?? null}
                  failed={activity.coverReadFailed}
                  wide
                />
                <MediaPreview
                  label="活动徽章"
                  url={activity.badge?.badge?.imageUrl ?? null}
                  failed={activity.badgeReadFailed}
                />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--text-muted)] lg:justify-end">
                  <StatusLine
                    label="封面"
                    ready={Boolean(activity.cover?.wide || activity.cover?.compact)}
                    failed={activity.coverReadFailed}
                  />
                  <StatusLine
                    label="徽章"
                    ready={Boolean(activity.badge?.badge)}
                    failed={activity.badgeReadFailed}
                  />
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 lg:justify-end">
                  {activity.cover?.wide ? (
                    <AssetDownloadButton
                      url={activity.cover.wide.url}
                      filename={`${activity.name}-宽屏封面.webp`}
                      label="宽屏版"
                      accessibleLabel={`下载活动 ${activity.name} 宽屏封面`}
                    />
                  ) : null}
                  {activity.cover?.compact ? (
                    <AssetDownloadButton
                      url={activity.cover.compact.url}
                      filename={`${activity.name}-紧凑封面.webp`}
                      label="紧凑版"
                      accessibleLabel={`下载活动 ${activity.name} 紧凑封面`}
                    />
                  ) : null}
                  {activity.cover?.source ? (
                    <AssetDownloadButton
                      url={activity.cover.source.url}
                      filename={`${activity.name}-封面母图.webp`}
                      label="母图"
                      accessibleLabel={`下载活动 ${activity.name} 封面母图`}
                      authenticated
                    />
                  ) : null}
                  {activity.badge?.badge ? (
                    <AssetDownloadButton
                      url={activity.badge.badge.imageUrl}
                      filename={`${activity.name}-徽章.webp`}
                      label="徽章"
                      accessibleLabel={`下载活动 ${activity.name} 徽章`}
                    />
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </AssetSection>
  );
}

function AssetSection({
  icon,
  title,
  eyebrow,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  eyebrow: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="overflow-hidden border-y border-[var(--border-default)] bg-[var(--bg-surface)]">
      <header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
        <span className="text-[var(--accent-primary)]">{icon}</span>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        <span className="font-mono text-[9px] uppercase tracking-[.16em] text-[var(--text-muted)]">
          {eyebrow}
        </span>
        {action ? <div className="ml-auto">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

function MediaPreview({
  label,
  url,
  wide = false,
  failed = false,
}: {
  label: string;
  url: string | null;
  wide?: boolean;
  failed?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-[var(--bg-surface-muted)] ${wide ? 'aspect-[2.4/1]' : 'aspect-square'}`}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div
          className={`flex h-full items-center justify-center text-[10px] ${failed ? 'text-[var(--semantic-error)]' : 'text-[var(--text-muted)]'}`}
        >
          {failed ? '读取失败' : '未设置'}
        </div>
      )}
      <span className="absolute bottom-1 left-1 bg-black/55 px-1.5 py-0.5 text-[9px] text-white">
        {label}
      </span>
    </div>
  );
}

function StatusLine({
  label,
  ready,
  failed = false,
}: {
  label: string;
  ready: boolean;
  failed?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {failed ? (
        <CircleAlert size={12} className="text-[var(--semantic-error)]" />
      ) : ready ? (
        <CheckCircle2 size={12} className="text-[var(--semantic-success)]" />
      ) : (
        <CircleAlert size={12} className="text-[var(--text-muted)]" />
      )}
      {label} {failed ? '读取失败' : ready ? '可读' : '未设置'}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">{text}</div>;
}

function CatalogMetric({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 border-l border-[var(--border-default)] pl-3 first:border-l-0 first:pl-0">
      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
      <span
        className="font-mono text-sm font-semibold text-[var(--text-primary)]"
        title={value === null ? '读取不完整，请刷新后重试' : undefined}
      >
        {value === null ? '—' : value.toLocaleString()}
      </span>
    </span>
  );
}

export default ImageAssetCatalogPage;
