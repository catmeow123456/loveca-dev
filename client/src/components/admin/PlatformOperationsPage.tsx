import { useCallback, useEffect, useState } from 'react';
import { Database, Download, FileText, RefreshCw, ShieldAlert } from 'lucide-react';
import { AdminPageHeader } from './AdminPageHeader';
import { ActionButton, TextInput } from '@/components/common';
import {
  applyReplayRetention,
  generateRankedVolatilityReport,
  previewReplayRetention,
  type ReplayRetentionReport,
} from '@/lib/platformOperationsClient';

export function PlatformOperationsPage({ onBack }: { onBack: () => void }) {
  const [preview, setPreview] = useState<ReplayRetentionReport | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [working, setWorking] = useState<'preview' | 'purge' | 'report' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const purge = async () => {
    setWorking('purge');
    try {
      const result = await applyReplayRetention(confirmation);
      setConfirmation('');
      try {
        setPreview(await previewReplayRetention());
        setMessage(
          `已清理 ${result.metadataRowsUpdated} 局过期回放；数据库会优先复用空间，物理磁盘不会立即缩小。`
        );
      } catch (error) {
        setPreview(result);
        setMessage(
          `已清理 ${result.metadataRowsUpdated} 局过期回放，但刷新预览失败：${error instanceof Error ? error.message : '未知错误'}`
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '清理失败');
    } finally {
      setWorking(null);
    }
  };
  const report = async () => {
    setWorking('report');
    try {
      const result = await generateRankedVolatilityReport(seasonId.trim() || undefined);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      download(
        `loveca-ranked-volatility-${stamp}.json`,
        JSON.stringify(result.report, null, 2),
        'application/json'
      );
      download(`loveca-ranked-volatility-${stamp}.md`, result.markdown, 'text/markdown');
      setMessage('赛季积分波动报告已下载。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成报告失败');
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
                只处理已封存、早于 {preview?.retentionDays ?? 10}{' '}
                天且仍含回放数据的对局；保留对局元数据与排位卡组观察。清理会释放可复用数据库空间，不会立即缩小磁盘卷。
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
          <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
            <div className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
              <ShieldAlert size={15} className="mt-0.5 text-[var(--status-warning)]" />
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
              <h3 className="text-sm font-bold text-[var(--text-primary)]">赛季积分波动报告</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                以只读一致性事务生成 JSON 与 Markdown，下载到当前浏览器；留空时使用唯一的 ACTIVE 或
                FINALIZING 赛季。
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <TextInput
              value={seasonId}
              onChange={(event) => setSeasonId(event.target.value)}
              aria-label="赛季 UUID"
              placeholder="可选：赛季 UUID"
            />
            <ActionButton
              variant="primary"
              size="compact"
              onClick={() => void report()}
              disabled={working !== null}
            >
              <Download size={14} />
              导出报告
            </ActionButton>
          </div>
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
function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
