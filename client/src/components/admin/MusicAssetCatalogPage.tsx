import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, Images, Loader2, Music2, RefreshCw } from 'lucide-react';
import { ActionButton, PageHeader } from '@/components/common';
import { fetchMatchmakingBgmLibrary, type MatchmakingBgmTrack } from '@/lib/matchmakingBgmClient';
import { AssetDownloadButton } from './AssetDownloadButton';

interface MusicAssetCatalogPageProps {
  readonly onBack: () => void;
  readonly onOpenCardImages?: () => void;
  readonly onOpenImageAssets?: () => void;
  readonly onOpenBgmAdmin?: () => void;
}

export function MusicAssetCatalogPage({
  onBack,
  onOpenCardImages,
  onOpenImageAssets,
  onOpenBgmAdmin,
}: MusicAssetCatalogPageProps) {
  const [tracks, setTracks] = useState<readonly MatchmakingBgmTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTracks = useCallback(async (refresh = false) => {
    if (refresh) setReloading(true);
    else setLoading(true);
    setError(null);
    try {
      setTracks(await fetchMatchmakingBgmLibrary());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取音乐资产失败');
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchMatchmakingBgmLibrary()
      .then((nextTracks) => {
        if (active) setTracks(nextTracks);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : '读取音乐资产失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(
    () => ({
      total: tracks.length,
      defaults: tracks.filter((track) => track.defaultSelected).length,
      bundled: tracks.filter((track) => track.source === 'BUNDLED').length,
      uploaded: tracks.filter((track) => track.source === 'UPLOADED').length,
    }),
    [tracks]
  );

  return (
    <div className="app-shell min-h-screen">
      <PageHeader
        title="音乐资产目录"
        description="只读盘点 · 候场音乐与公共对象存储"
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
            {onOpenImageAssets ? (
              <ActionButton
                variant="ghost"
                size="compact"
                onClick={onOpenImageAssets}
                className="gap-1.5"
              >
                <Images size={14} aria-hidden="true" />
                其他图片
              </ActionButton>
            ) : null}
            {onOpenBgmAdmin ? (
              <ActionButton
                variant="secondary"
                size="compact"
                onClick={onOpenBgmAdmin}
                className="gap-1.5"
              >
                管理曲库
              </ActionButton>
            ) : null}
          </div>
        }
        className="[&_.page-header-inner]:min-h-0 [&_.page-header-inner]:!grid-cols-[auto_minmax(0,1fr)] [&_.page-header-inner]:py-2 [&_.page-header-actions]:!col-[1/-1] [&_.page-header-title]:text-base [&_.page-header-description]:hidden sm:[&_.page-header-title]:text-lg md:[&_.page-header-inner]:!grid-cols-[auto_minmax(0,1fr)_auto] md:[&_.page-header-actions]:!col-[3/4]"
      />

      <main className="product-page-main">
        <div className="mx-auto max-w-[90rem]">
          <section className="mb-4 overflow-hidden border-y border-[var(--border-default)] bg-[var(--bg-surface)]">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Music2 size={16} className="text-[var(--accent-primary)]" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">候场音乐</h2>
                <span className="font-mono text-[9px] uppercase tracking-[.16em] text-[var(--text-muted)]">
                  read only
                </span>
              </div>
              <div className="ml-auto flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <CatalogMetric label="总曲目" value={counts.total} />
                <CatalogMetric label="默认播放" value={counts.defaults} accent="success" />
                <CatalogMetric label="内置" value={counts.bundled} />
                <CatalogMetric label="上传" value={counts.uploaded} />
              </div>
              <ActionButton
                variant="ghost"
                size="compact"
                onClick={() => void loadTracks(true)}
                disabled={loading || reloading}
                className="gap-1.5"
              >
                <RefreshCw size={14} className={reloading ? 'animate-spin' : undefined} />
                重新载入
              </ActionButton>
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

          <section className="product-workbench !rounded-none overflow-hidden">
            {loading ? (
              <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                正在读取音乐资产
              </div>
            ) : tracks.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center px-5 py-10 text-center">
                <Music2 size={28} className="text-[var(--text-muted)]" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">
                  暂无音乐资产
                </h3>
                <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--text-muted)]">
                  当前候场曲库为空，可从曲库管理页上传 MP3。
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {tracks.map((track, index) => (
                  <MusicAssetRow key={track.id} track={track} index={index} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function MusicAssetRow({ track, index }: { track: MatchmakingBgmTrack; index: number }) {
  const [readError, setReadError] = useState(false);
  const status = readError ? '读取失败' : '公共 URL';
  return (
    <article className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(13rem,1fr)_minmax(18rem,1.15fr)_minmax(14rem,1fr)] lg:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-[color:color-mix(in_srgb,var(--accent-primary)_24%,var(--border-subtle))] bg-[color:color-mix(in_srgb,var(--accent-primary)_8%,var(--bg-surface))] text-[var(--accent-primary)]">
          <Music2 size={17} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {track.title}
          </h3>
          <p className="mt-1 text-xs tabular-nums text-[var(--text-muted)]">
            {String(index + 1).padStart(2, '0')} · {formatBytes(track.byteSize)} ·{' '}
            {track.source === 'BUNDLED' ? '内置曲目' : '管理员上传'}
          </p>
        </div>
      </div>

      <audio
        controls
        preload="none"
        src={track.audioUrl}
        aria-label={`试听 ${track.title}`}
        onError={() => setReadError(true)}
        className="h-10 w-full min-w-0"
      />

      <div className="min-w-0 text-xs">
        <div className="flex items-center gap-1.5">
          {readError ? (
            <CircleAlert size={14} className="text-[var(--semantic-error)]" aria-hidden="true" />
          ) : (
            <CheckCircle2 size={14} className="text-[var(--semantic-success)]" aria-hidden="true" />
          )}
          <span
            className={
              readError ? 'text-[var(--semantic-error)]' : 'text-[var(--semantic-success)]'
            }
          >
            {status}
          </span>
          {track.defaultSelected ? (
            <span className="ml-1 border border-[color:color-mix(in_srgb,var(--accent-primary)_28%,var(--border-subtle))] px-1.5 py-0.5 text-[10px] text-[var(--accent-primary)]">
              默认播放
            </span>
          ) : null}
        </div>
        <code
          className="mt-1 block truncate text-[10px] text-[var(--text-muted)]"
          title={track.audioUrl}
        >
          {track.audioUrl}
        </code>
        <AssetDownloadButton
          url={track.audioUrl}
          filename={`${track.title}.mp3`}
          accessibleLabel={`下载音乐 ${track.title}`}
        />
      </div>
    </article>
  );
}

function CatalogMetric({
  label,
  value,
  accent = 'default',
}: {
  label: string;
  value: number;
  accent?: 'default' | 'success';
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 border-l border-[var(--border-default)] pl-3 first:border-l-0 first:pl-0">
      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
      <span
        className={`font-mono text-sm font-semibold ${accent === 'success' ? 'text-[var(--semantic-success)]' : 'text-[var(--text-primary)]'}`}
      >
        {value.toLocaleString()}
      </span>
    </span>
  );
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default MusicAssetCatalogPage;
