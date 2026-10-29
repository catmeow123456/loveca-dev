import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Download, FileText, RefreshCw, ShieldAlert } from 'lucide-react';
import { AdminPageHeader } from './AdminPageHeader';
import { ActionButton, SelectMenu, TextInput } from '@/components/common';
import {
  applyReplayRetention,
  exportRankedAnalysis,
  fetchReplayRetentionJob,
  isTerminalReplayRetentionPollError,
  type ReplayRetentionJob,
  previewReplayRetention,
  type ReplayRetentionReport,
} from '@/lib/platformOperationsClient';
import { fetchRankedSeasons, type RankedAdminSeason } from '@/lib/rankedAdminClient';

export function PlatformOperationsPage({ onBack }: { onBack: () => void }) {
  const [preview, setPreview] = useState<ReplayRetentionReport | null>(null);
  const [retentionJob, setRetentionJob] = useState<ReplayRetentionJob | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [seasons, setSeasons] = useState<RankedAdminSeason[]>([]);
  const [seasonsLoading, setSeasonsLoading] = useState(true);
  const [seasonsError, setSeasonsError] = useState<string | null>(null);
  const [working, setWorking] = useState<'preview' | 'purge' | 'export' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const seasonOptions = useMemo(
    () =>
      seasons.map((season) => ({
        value: season.id,
        label: `${season.name} · ${lifecycleLabel(season.lifecycle)}`,
        description: season.seasonKey,
      })),
    [seasons]
  );
  const refresh = useCallback(async () => {
    setWorking('preview');
    try {
      setPreview(await previewReplayRetention());
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取维护数据失败');
    } finally {
      setWorking(null);
    }
  }, []);
  const loadSeasons = useCallback(async () => {
    setSeasonsLoading(true);
    setSeasonsError(null);
    try {
      const result = await fetchRankedSeasons();
      setSeasons(result);
      setSeasonId((current) =>
        result.some((season) => season.id === current) ? current : preferredSeasonId(result)
      );
    } catch (error) {
      setSeasonsError(error instanceof Error ? error.message : '读取排位赛季失败');
    } finally {
      setSeasonsLoading(false);
    }
  }, []);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refresh();
      void loadSeasons();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadSeasons, refresh]);
  useEffect(() => {
    const jobId = retentionJob?.id;
    if (!jobId || retentionJob.status === 'SUCCEEDED' || retentionJob.status === 'FAILED') return;
    let cancelled = false;
    let timeoutId: number | undefined;
    const schedulePoll = (delayMs: number) => {
      if (!cancelled) timeoutId = window.setTimeout(() => void poll(), delayMs);
    };
    const poll = async () => {
      try {
        const next = await fetchReplayRetentionJob(jobId);
        if (cancelled) return;
        setRetentionJob(next);
        if (next.status === 'SUCCEEDED') {
          setWorking('preview');
          try {
            setPreview(await previewReplayRetention());
            setMessage(
              `已清理 ${next.report?.metadataRowsUpdated ?? next.progress.metadataRowsUpdated} 局过期回放；数据库会优先复用空间，物理磁盘不会立即缩小。`
            );
          } catch (error) {
            setMessage(
              `已清理 ${next.report?.metadataRowsUpdated ?? next.progress.metadataRowsUpdated} 局过期回放，但刷新预览失败：${error instanceof Error ? error.message : '未知错误'}`
            );
          } finally {
            setWorking(null);
          }
          return;
        }
        if (next.status === 'FAILED') {
          setMessage(next.error?.message ?? '清理回放数据失败');
          setWorking(null);
          return;
        }
        schedulePoll(1000);
      } catch (error) {
        if (cancelled) return;
        if (isTerminalReplayRetentionPollError(error)) {
          setRetentionJob(null);
          setWorking(null);
          setMessage(
            `${error instanceof Error ? error.message : '读取回放清理进度失败'}。无法继续查询任务状态，请刷新预览后再决定是否重新清理。`
          );
          return;
        }
        setMessage(
          `${error instanceof Error ? error.message : '读取回放清理进度失败'}，将自动重试。`
        );
        schedulePoll(2000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [retentionJob?.id, retentionJob?.status]);
  const purge = async () => {
    setWorking('purge');
    setRetentionJob(null);
    setMessage(null);
    try {
      const job = await applyReplayRetention(confirmation);
      setConfirmation('');
      setRetentionJob(job);
      setMessage('清理任务已启动，正在按批次处理过期对局。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '清理失败');
      setWorking(null);
    }
  };
  const exportAnalysis = async () => {
    if (!seasonId) return;
    setWorking('export');
    try {
      const blob = await exportRankedAnalysis(seasonId);
      const seasonKey = seasons.find((season) => season.id === seasonId)?.seasonKey ?? 'season';
      const stamp = new Date().toISOString().replace(/[-:.]/g, '');
      downloadBlob(`loveca-ranked-analysis-${safeFilenamePart(seasonKey)}-${stamp}.zip`, blob);
      setMessage('赛季原始分析数据包已下载。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成分析数据失败');
    } finally {
      setWorking(null);
    }
  };
  return (
    <div className="app-shell min-h-screen">
      <AdminPageHeader title="数据维护" category="内容与平台" onBack={onBack} />
      <main className="product-page-main flex flex-col gap-4">
        <section className="product-workbench p-4">
          <div className="mb-3 flex items-start gap-3">
            <Database size={18} className="mt-0.5 text-[var(--accent-primary)]" />
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">回放保留清理</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                只处理已封存、早于 {preview?.retentionDays ?? 10} 天且仍含回放数据的对局；当前按每批
                100
                局独立事务处理，保留对局元数据与排位卡组观察。清理会释放可复用数据库空间，不会立即缩小磁盘卷。
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              ['候选对局', preview?.candidateMatchCount],
              ['回放数据行', preview?.replayRows],
              ['排位阻断', preview?.blockedRankedMatchCount],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
              >
                <div className="text-xs text-[var(--text-secondary)]">{label}</div>
                <div className="mt-1 text-lg font-bold text-[var(--text-primary)]">
                  {value ?? '—'}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              variant="secondary"
              size="compact"
              onClick={() => void refresh()}
              disabled={working !== null}
            >
              <RefreshCw size={14} className={working === 'preview' ? 'animate-spin' : ''} />
              刷新预览
            </ActionButton>
          </div>
          {retentionJob ? <ReplayRetentionProgressView job={retentionJob} /> : null}
          <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
            <div className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
              <ShieldAlert size={15} className="mt-0.5 text-[var(--semantic-warning)]" />
              <span>
                确认已完成必要维护准备后，输入“清理10天前回放数据”执行。若存在排位观察缺失，服务器会拒绝操作。
              </span>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <TextInput
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-label="回放清理确认语"
                placeholder="输入确认语"
              />
              <ActionButton
                variant="secondary"
                size="compact"
                className="button-danger"
                onClick={() => void purge()}
                disabled={working !== null || confirmation !== '清理10天前回放数据'}
              >
                清理过期回放
              </ActionButton>
            </div>
          </div>
        </section>
        <section className="product-workbench p-4">
          <div className="mb-3 flex items-start gap-3">
            <FileText size={18} className="mt-0.5 text-[var(--accent-primary)]" />
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">赛季原始分析数据</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                选择一个排位赛季，以只读一致性事务生成匿名化 ZIP。包内是可直接分析的 CSV
                原始表，不预先生成积分波动结论。
              </p>
            </div>
          </div>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <div className="text-xs font-bold text-[var(--text-primary)]">包含</div>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                排位结果、积分事件与逐步前后值、玩家种子与当前投影、长期卡组观察及主卡组卡牌明细。
              </p>
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <div className="text-xs font-bold text-[var(--text-primary)]">明确排除</div>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                checkpoint、完整对局记录、原始对局卡组快照、timeline、游戏事件、聊天与回放。
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <SelectMenu
              label="选择导出赛季"
              value={seasonId}
              options={seasonOptions}
              onChange={setSeasonId}
              loading={seasonsLoading}
              className="w-full sm:flex-1"
              menuMinWidth={320}
            />
            <ActionButton
              variant="primary"
              size="compact"
              onClick={() => void exportAnalysis()}
              disabled={working !== null || seasonsLoading || !seasonId}
            >
              <Download size={14} />
              导出 ZIP
            </ActionButton>
          </div>
          {seasonsError ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--semantic-error)]">
              <span>{seasonsError}</span>
              <ActionButton
                variant="secondary"
                size="compact"
                onClick={() => void loadSeasons()}
                disabled={seasonsLoading || working !== null}
              >
                重新读取赛季
              </ActionButton>
            </div>
          ) : !seasonsLoading && seasons.length === 0 ? (
            <p className="mt-2 text-xs text-[var(--text-muted)]">当前没有可导出的排位赛季。</p>
          ) : null}
        </section>
        {message ? (
          <p
            role="status"
            className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 text-sm text-[var(--text-secondary)]"
          >
            {message}
          </p>
        ) : null}
      </main>
    </div>
  );
}

function ReplayRetentionProgressView({ job }: { job: ReplayRetentionJob }) {
  const total = job.progress.candidateMatchCount;
  const processed = Math.min(
    job.progress.processedMatchCount,
    total || job.progress.processedMatchCount
  );
  const percent =
    total > 0 ? Math.round((processed / total) * 100) : job.status === 'SUCCEEDED' ? 100 : null;
  const phaseLabel =
    job.status === 'QUEUED'
      ? '排队中'
      : job.status === 'RUNNING'
        ? job.progress.phase === 'preparing'
          ? '统计候选数据'
          : '分批清理中'
        : job.status === 'SUCCEEDED'
          ? '已完成'
          : '失败';
  return (
    <div
      className="mt-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
      role="status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-[var(--text-primary)]">
          回放清理进度 · {phaseLabel}
        </span>
        <span className="text-[var(--text-secondary)]">
          {total > 0
            ? `${processed.toLocaleString()} / ${total.toLocaleString()} 局`
            : '正在读取候选对局'}
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]"
        role="progressbar"
        aria-label="回放清理进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div
          className={`h-full rounded-full bg-[var(--accent-primary)] transition-[width] duration-300 ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {job.error ? (
        <p className="mt-2 text-xs text-[var(--semantic-error)]">{job.error.message}</p>
      ) : null}
    </div>
  );
}
function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function safeFilenamePart(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'season'
  );
}

function lifecycleLabel(value: RankedAdminSeason['lifecycle']): string {
  return { DRAFT: '未开始', ACTIVE: '开放中', FINALIZING: '结算中', CLOSED: '已结束' }[value];
}

function preferredSeasonId(seasons: readonly RankedAdminSeason[]): string {
  return (
    seasons.find((season) => season.lifecycle === 'ACTIVE')?.id ??
    seasons.find((season) => season.lifecycle === 'FINALIZING')?.id ??
    seasons.find((season) => season.lifecycle === 'CLOSED')?.id ??
    seasons[0]?.id ??
    ''
  );
}
