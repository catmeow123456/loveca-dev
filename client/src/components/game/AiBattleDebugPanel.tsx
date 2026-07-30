import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { BrainCircuit, CircleCheck, LoaderCircle, ShieldAlert, X } from 'lucide-react';
import { fetchAiBattleDebugTrace, type AiBattleDebugTraceEntry } from '@/lib/aiBattleClient';
import { SerialPollingScheduler } from '@/lib/asyncRequestControl';

const AI_DEBUG_TRACE_POLL_INTERVAL_MS = 800;
const AI_DEBUG_TRACE_CLIENT_MAX_ENTRIES = 128;

interface AiBattleDebugPanelProps {
  readonly matchId: string;
}

export const AiBattleDebugPanel = memo(function AiBattleDebugPanel({
  matchId,
}: AiBattleDebugPanelProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<readonly AiBattleDebugTraceEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const cursorRef = useRef(0);
  const isOpenRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    cursorRef.current = 0;

    let disposed = false;
    const scheduler = new SerialPollingScheduler({
      intervalMs: AI_DEBUG_TRACE_POLL_INTERVAL_MS,
      poll: async () => {
        try {
          const trace = await fetchAiBattleDebugTrace(matchId, cursorRef.current);
          if (disposed || trace.matchId !== matchId) return;
          setEnabled(trace.enabled);
          if (!trace.enabled) {
            scheduler.dispose();
            return;
          }
          if (trace.entries.length > 0 || trace.truncated) {
            setEntries((current) =>
              mergeTraceEntries(trace.truncated ? [] : current, trace.entries)
            );
            if (!isOpenRef.current) {
              const completedCount = trace.entries.filter(
                (entry) => entry.stage === 'COMPLETED'
              ).length;
              if (completedCount > 0) {
                setUnreadCount((current) => current + completedCount);
              }
            }
          }
          cursorRef.current = trace.currentSeq;
          setSyncError(null);
        } catch (error) {
          if (disposed) return;
          setSyncError(error instanceof Error ? error.message : 'AI 调试轨迹同步失败');
        }
      },
    });
    scheduler.start();
    return () => {
      disposed = true;
      scheduler.dispose();
    };
  }, [matchId]);

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length, isOpen]);

  if (enabled !== true) return null;

  const latestEntry = entries.at(-1) ?? null;
  const isThinking = latestEntry?.stage === 'STARTED';

  const openPanel = () => {
    isOpenRef.current = true;
    setIsOpen(true);
    setUnreadCount(0);
  };
  const closePanel = () => {
    isOpenRef.current = false;
    setIsOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={isOpen ? closePanel : openPanel}
        className="button-ghost relative inline-flex min-h-10 items-center justify-center gap-2 border border-[color:color-mix(in_srgb,var(--semantic-warning)_45%,var(--border-default))] bg-[var(--bg-frosted)] px-3 shadow-[var(--shadow-md)] backdrop-blur-xl sm:min-h-11"
        aria-label="AI 调试轨迹"
        title="AI 调试轨迹（仅开发环境）"
      >
        {isThinking ? (
          <LoaderCircle size={16} className="animate-spin text-[var(--semantic-warning)]" />
        ) : (
          <BrainCircuit size={16} className="text-[var(--semantic-warning)]" />
        )}
        <span className="hidden text-sm font-semibold sm:inline">AI 调试</span>
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-[var(--semantic-warning)] px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-slate-950 shadow">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <>
              <motion.button
                type="button"
                aria-label="关闭 AI 调试轨迹"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.16 }}
                onClick={closePanel}
                className="fixed inset-0 z-[190] bg-black/35 backdrop-blur-[1px]"
              />
              <motion.aside
                role="dialog"
                aria-modal="true"
                aria-label="AI 调试轨迹"
                initial={reduceMotion ? false : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
                transition={{ duration: reduceMotion ? 0.08 : 0.18 }}
                className="fixed bottom-3 right-3 top-3 z-[200] flex w-[min(440px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-warning)_45%,var(--border-default))] bg-[var(--bg-frosted)] shadow-[var(--shadow-xl)] backdrop-blur-xl"
              >
                <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <BrainCircuit size={18} className="text-[var(--semantic-warning)]" />
                      <h2 className="text-sm font-black text-[var(--text-primary)]">AI 调试轨迹</h2>
                      <span className="rounded-full border border-[color:color-mix(in_srgb,var(--semantic-warning)_40%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--semantic-warning)]">
                        DEV ONLY
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                      展示短决策摘要与调用指标，不是模型私有思维链。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closePanel}
                    className="button-icon h-8 w-8 shrink-0"
                    aria-label="关闭 AI 调试轨迹"
                    title="关闭"
                  >
                    <X size={16} />
                  </button>
                </header>

                <div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2">
                  <div className="flex items-start gap-2 rounded-lg border border-dashed border-[color:color-mix(in_srgb,var(--semantic-warning)_42%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-warning)_7%,var(--bg-surface))] px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">
                    <ShieldAlert
                      size={15}
                      className="mt-0.5 shrink-0 text-[var(--semantic-warning)]"
                    />
                    <span>
                      不展示完整 Prompt、供应商原始响应或 API key；轨迹仅保存在当前内存对局。
                    </span>
                  </div>
                </div>

                <div
                  ref={scrollRef}
                  className="cute-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
                >
                  {entries.length === 0 ? (
                    <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-sm text-[var(--text-muted)]">
                      <BrainCircuit size={24} />
                      <span>等待 AI 进入决策窗口</span>
                    </div>
                  ) : (
                    entries.map((entry) => <DebugTraceEntry key={entry.seq} entry={entry} />)
                  )}
                </div>

                {syncError && (
                  <div className="shrink-0 border-t border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--semantic-error)]">
                    {syncError}；将自动重试。
                  </div>
                )}
              </motion.aside>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
});

function DebugTraceEntry({ entry }: { readonly entry: AiBattleDebugTraceEntry }) {
  const started = entry.stage === 'STARTED';
  const statusTone =
    entry.executionStatus === 'ACCEPTED'
      ? 'text-[var(--semantic-success)]'
      : entry.executionStatus
        ? 'text-[var(--semantic-warning)]'
        : 'text-[var(--accent-primary)]';
  return (
    <article className="rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_82%,transparent)] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {started ? (
            <LoaderCircle
              size={15}
              className="shrink-0 animate-spin text-[var(--accent-primary)]"
            />
          ) : (
            <CircleCheck size={15} className={`shrink-0 ${statusTone}`} />
          )}
          <div className="min-w-0">
            <div className="truncate text-xs font-black text-[var(--text-primary)]">
              {formatDecisionKind(entry.decisionKind)}
            </div>
            <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
              #{entry.seq} · revision {entry.authorityRevision} ·{' '}
              {new Date(entry.createdAt).toLocaleTimeString()}
            </div>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-secondary)]">
          {formatSource(entry.source)}
        </span>
      </div>

      <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">{entry.summary}</p>

      {entry.selection && (
        <div className="mt-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1.5 text-xs font-semibold text-[var(--text-primary)]">
          {entry.selection.label}
        </div>
      )}

      {entry.model && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-[var(--text-muted)]">
          <span>模型：{entry.model.modelId}</span>
          <span>尝试：{entry.model.attemptCount}</span>
          <span>延迟：{entry.model.totalLatencyMs}ms</span>
          <span>
            Token：{entry.model.inputTokens}/{entry.model.outputTokens}
          </span>
          <span className="col-span-2">
            估算费用：¥{(entry.model.estimatedCostMicrosCny / 1_000_000).toFixed(6)}
          </span>
        </div>
      )}

      {(entry.reasonCode || entry.executionStatus) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
          {entry.reasonCode && (
            <code className="rounded bg-[var(--bg-overlay)] px-1.5 py-0.5 text-[var(--text-muted)]">
              {entry.reasonCode}
            </code>
          )}
          {entry.executionStatus && (
            <span className={`font-bold ${statusTone}`}>
              {formatExecutionStatus(entry.executionStatus)}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function mergeTraceEntries(
  current: readonly AiBattleDebugTraceEntry[],
  incoming: readonly AiBattleDebugTraceEntry[]
): readonly AiBattleDebugTraceEntry[] {
  const bySeq = new Map(current.map((entry) => [entry.seq, entry]));
  for (const entry of incoming) bySeq.set(entry.seq, entry);
  return [...bySeq.values()]
    .sort((left, right) => left.seq - right.seq)
    .slice(-AI_DEBUG_TRACE_CLIENT_MAX_ENTRIES);
}

function formatDecisionKind(kind: string): string {
  const labels: Readonly<Record<string, string>> = {
    MULLIGAN: '换牌决策',
    MAIN_PHASE: '主要阶段决策',
    LIVE_SET: 'LIVE 设置决策',
    ACTIVE_EFFECT: '效果选择',
    PENDING_ABILITY_ORDER: '能力顺序选择',
    JUDGMENT_CONFIRM: 'LIVE 判定确认',
    SCORE_CONFIRM: '分数确认',
    SUCCESS_LIVE_SELECTION: '成功 LIVE 选择',
  };
  return labels[kind] ?? kind;
}

function formatSource(source: AiBattleDebugTraceEntry['source']): string {
  if (source === 'MODEL') return '模型';
  if (source === 'CONSERVATIVE_FALLBACK') return '保守策略';
  return '规则直处理';
}

function formatExecutionStatus(
  status: NonNullable<AiBattleDebugTraceEntry['executionStatus']>
): string {
  if (status === 'ACCEPTED') return '已执行';
  if (status === 'STALE') return '状态已变化，重新选择';
  return '未通过规则检查';
}
