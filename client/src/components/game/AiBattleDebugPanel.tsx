import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BrainCircuit,
  Braces,
  Check,
  ChevronRight,
  CircleCheck,
  Clipboard,
  Copy,
  Database,
  Download,
  History,
  LoaderCircle,
  ScrollText,
  ShieldAlert,
  Sparkles,
  TerminalSquare,
  X,
} from 'lucide-react';
import {
  fetchAiBattleDebugTrace,
  fetchAiBattleHistoryDocument,
  type AiBattleDebugTraceEntry,
} from '@/lib/aiBattleClient';
import { SerialPollingScheduler } from '@/lib/asyncRequestControl';
import { useAuthStore } from '@/store/authStore';

const AI_DEBUG_TRACE_POLL_INTERVAL_MS = 800;
const AI_DEBUG_TRACE_CLIENT_MAX_ENTRIES = 128;

type DebugAttempt = NonNullable<AiBattleDebugTraceEntry['modelContext']>['attempts'][number];
type InspectorTab = 'CONTEXT' | 'OUTPUT' | 'RAW';

interface SemanticChoice {
  readonly choiceKind: string;
  readonly choiceId: string;
  readonly description: string;
  readonly details: readonly string[];
}

interface SemanticContext {
  readonly schemaVersion: string;
  readonly language: string;
  readonly currentState: {
    readonly summary: string;
    readonly facts: readonly string[];
  };
  readonly currentDecision: {
    readonly kind: string;
    readonly instruction: string;
    readonly facts: readonly string[];
    readonly choices: readonly SemanticChoice[];
  };
  readonly battleHistory: readonly {
    readonly turnCount: number;
    readonly subject: string;
    readonly facts: readonly string[];
  }[];
}

interface ParsedUserMessage {
  readonly attempt: {
    readonly kind: string;
    readonly attemptNumber: number;
    readonly failureCode?: string;
  };
  readonly strategyContext: {
    readonly schemaVersion: string;
    readonly semanticContext: SemanticContext;
  };
}

interface ParsedSystemMessage {
  readonly schemaVersion: string;
  readonly promptVersion: string;
  readonly systemInstruction: {
    readonly role: string;
    readonly task: string;
    readonly constraints: readonly string[];
    readonly untrustedDataPolicy: Readonly<Record<string, boolean>>;
  };
  readonly trustedKnowledge: unknown;
  readonly responseContract: unknown;
}

interface AiBattleDebugPanelProps {
  readonly matchId: string;
}

export const AiBattleDebugPanel = memo(function AiBattleDebugPanel({
  matchId,
}: AiBattleDebugPanelProps) {
  const isAdmin = useAuthStore((state) => state.profile?.role === 'admin');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<readonly AiBattleDebugTraceEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [selectedAttemptNumber, setSelectedAttemptNumber] = useState<number | null>(null);
  const [tab, setTab] = useState<InspectorTab>('CONTEXT');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const cursorRef = useRef(0);
  const isOpenRef = useRef(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    cursorRef.current = 0;
    if (!isAdmin) return;

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
              if (completedCount > 0) setUnreadCount((current) => current + completedCount);
            }
          }
          cursorRef.current = trace.currentSeq;
          setSyncError(null);
        } catch (error) {
          if (disposed) return;
          setSyncError(error instanceof Error ? error.message : 'AI 上下文同步失败');
        }
      },
    });
    scheduler.start();
    return () => {
      disposed = true;
      scheduler.dispose();
    };
  }, [isAdmin, matchId]);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        isOpenRef.current = false;
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const completedEntries = useMemo(
    () => entries.filter((entry) => entry.stage === 'COMPLETED'),
    [entries]
  );
  const selectedEntry =
    completedEntries.find((entry) => entry.seq === selectedSeq) ?? completedEntries.at(-1) ?? null;
  const attempts = selectedEntry?.modelContext?.attempts ?? [];
  const selectedAttempt =
    attempts.find((attempt) => attempt.attemptNumber === selectedAttemptNumber) ??
    attempts.at(-1) ??
    null;

  if (!isAdmin) return null;

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
  const downloadHistory = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const document = await fetchAiBattleHistoryDocument(matchId);
      const blob = new Blob([document.content], { type: document.mediaType });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = document.filename;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : '导出 AI 对战历史失败');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="relative flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void downloadHistory()}
        disabled={isDownloading}
        className="button-ghost inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 shadow-[var(--shadow-md)] backdrop-blur-xl disabled:cursor-wait disabled:opacity-70 sm:min-h-11"
        aria-label="下载 AI 对战反思历史"
        title="下载截至当前时刻的 AI 对战反思历史（Markdown）"
      >
        {isDownloading ? (
          <LoaderCircle size={16} className="animate-spin text-[var(--accent-primary)]" />
        ) : (
          <Download size={16} className="text-[var(--accent-primary)]" />
        )}
        <span className="hidden text-sm font-semibold sm:inline">历史</span>
      </button>

      {enabled === true && (
        <button
          type="button"
          onClick={isOpen ? closePanel : openPanel}
          className="button-ghost relative inline-flex min-h-10 items-center justify-center gap-2 border border-[color:color-mix(in_srgb,var(--semantic-warning)_48%,var(--border-default))] bg-[var(--bg-frosted)] px-3 shadow-[var(--shadow-md)] backdrop-blur-xl sm:min-h-11"
          aria-label="打开管理员 AI 上下文检查器"
          title="管理员 AI 上下文检查器（仅开发环境）"
        >
          {isThinking ? (
            <LoaderCircle size={16} className="animate-spin text-[var(--semantic-warning)]" />
          ) : (
            <Braces size={16} className="text-[var(--semantic-warning)]" />
          )}
          <span className="hidden text-sm font-semibold sm:inline">上下文</span>
          {unreadCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-[var(--semantic-warning)] px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-slate-950 shadow">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {downloadError && (
        <span
          role="alert"
          className="absolute left-0 top-[calc(100%+0.35rem)] z-[130] w-60 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_44%,var(--border-default))] bg-[var(--bg-frosted)] px-2.5 py-2 text-xs leading-5 text-[var(--semantic-error)] shadow-[var(--shadow-md)] backdrop-blur-xl"
        >
          {downloadError}
        </span>
      )}

      {enabled === true &&
        createPortal(
          <AnimatePresence>
            {isOpen && (
              <>
                <motion.button
                  type="button"
                  aria-label="关闭管理员 AI 上下文检查器"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.16 }}
                  onClick={closePanel}
                  className="fixed inset-0 z-[190] bg-black/45 backdrop-blur-[2px]"
                />
                <motion.aside
                  role="dialog"
                  aria-modal="true"
                  aria-label="管理员 AI 上下文检查器"
                  initial={reduceMotion ? false : { opacity: 0, x: 28 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 28 }}
                  transition={{ duration: reduceMotion ? 0.08 : 0.2 }}
                  className="fixed inset-3 z-[200] flex flex-col overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-warning)_50%,var(--border-default))] bg-[var(--bg-frosted)] shadow-[var(--shadow-xl)] backdrop-blur-xl sm:left-auto sm:w-[min(920px,calc(100vw-1.5rem))]"
                >
                  <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <BrainCircuit size={19} className="text-[var(--semantic-warning)]" />
                        <h2 className="text-sm font-black tracking-tight text-[var(--text-primary)] sm:text-base">
                          AI 上下文检查器
                        </h2>
                        <span className="rounded-full border border-[color:color-mix(in_srgb,var(--semantic-warning)_46%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-warning)_8%,transparent)] px-2 py-0.5 text-[10px] font-black tracking-wider text-[var(--semantic-warning)]">
                          ADMIN · DEV
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                        逐次核对实际送模上下文、合法选项与严格解析结果。
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void downloadHistory()}
                        disabled={isDownloading}
                        className="button-ghost inline-flex h-8 items-center justify-center gap-1.5 px-2.5 text-xs disabled:cursor-wait disabled:opacity-70"
                        aria-label="下载 AI 对战反思历史"
                      >
                        {isDownloading ? (
                          <LoaderCircle size={14} className="animate-spin" />
                        ) : (
                          <Download size={14} />
                        )}
                        导出历史
                      </button>
                      <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={closePanel}
                        className="button-icon h-8 w-8"
                        aria-label="关闭管理员 AI 上下文检查器"
                        title="关闭（Esc）"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </header>

                  <div className="shrink-0 border-b border-[var(--border-subtle)] px-3 py-2 sm:px-4">
                    <div className="flex items-start gap-2 rounded-lg border border-dashed border-[color:color-mix(in_srgb,var(--semantic-warning)_42%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-warning)_7%,var(--bg-surface))] px-3 py-2 text-[11px] leading-5 text-[var(--text-secondary)] sm:text-xs">
                      <ShieldAlert
                        size={15}
                        className="mt-0.5 shrink-0 text-[var(--semantic-warning)]"
                      />
                      <span>
                        显示 AI 席位的私密送模内容，仅限管理员进入的当前测试对局；不含 API
                        key、供应商路由、原始无效响应或私有思维链，且不会写入录像和数据库。
                      </span>
                    </div>
                  </div>

                  <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:grid-cols-[246px_minmax(0,1fr)] sm:grid-rows-1">
                    <DecisionRail
                      entries={completedEntries}
                      selectedSeq={selectedEntry?.seq ?? null}
                      isThinking={isThinking}
                      onSelect={(seq) => {
                        setSelectedSeq(seq);
                        setSelectedAttemptNumber(null);
                        setTab('CONTEXT');
                      }}
                    />
                    <main className="cute-scrollbar min-h-0 min-w-0 overflow-y-auto bg-[color:color-mix(in_srgb,var(--bg-surface)_58%,transparent)]">
                      {selectedEntry ? (
                        <DecisionInspector
                          entry={selectedEntry}
                          attempts={attempts}
                          selectedAttempt={selectedAttempt}
                          tab={tab}
                          onAttemptSelect={setSelectedAttemptNumber}
                          onTabSelect={setTab}
                        />
                      ) : (
                        <EmptyInspector />
                      )}
                    </main>
                  </div>

                  {syncError && (
                    <div className="shrink-0 border-t border-[var(--border-subtle)] px-4 py-2 text-xs text-[var(--semantic-error)]">
                      {syncError}；将自动重试。
                    </div>
                  )}
                </motion.aside>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
});

function DecisionRail({
  entries,
  selectedSeq,
  isThinking,
  onSelect,
}: {
  readonly entries: readonly AiBattleDebugTraceEntry[];
  readonly selectedSeq: number | null;
  readonly isThinking: boolean;
  readonly onSelect: (seq: number) => void;
}) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_72%,transparent)] sm:border-b-0 sm:border-r">
      <div className="flex shrink-0 items-center justify-between px-3 py-2.5 sm:px-4 sm:py-3">
        <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--text-muted)]">
          Authority timeline
        </span>
        {isThinking && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--accent-primary)]">
            <LoaderCircle size={11} className="animate-spin" /> 生成中
          </span>
        )}
      </div>
      <div className="cute-scrollbar flex w-full max-w-full gap-2 overflow-x-auto px-3 pb-3 sm:min-h-0 sm:flex-1 sm:flex-col sm:overflow-x-hidden sm:overflow-y-auto sm:overscroll-contain sm:px-3 [scrollbar-gutter:stable]">
        {entries.length === 0 ? (
          <div className="flex min-h-20 min-w-full items-center justify-center text-center text-xs text-[var(--text-muted)] sm:min-h-40">
            等待 AI 进入决策窗口
          </div>
        ) : (
          entries.map((entry) => {
            const selected = entry.seq === selectedSeq;
            return (
              <button
                key={entry.seq}
                type="button"
                onClick={() => onSelect(entry.seq)}
                aria-pressed={selected}
                className={`group relative min-w-[190px] rounded-lg border px-3 py-2 text-left transition-colors sm:min-w-0 ${
                  selected
                    ? 'border-[color:color-mix(in_srgb,var(--semantic-warning)_58%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-warning)_9%,var(--bg-surface))]'
                    : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_78%,transparent)] hover:border-[var(--border-default)]'
                }`}
              >
                <span
                  className={`absolute bottom-2 left-0 top-2 w-0.5 rounded-full ${
                    entry.source === 'MODEL'
                      ? 'bg-[var(--semantic-warning)]'
                      : 'bg-[var(--accent-primary)]'
                  }`}
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-black text-[var(--text-primary)]">
                    {formatDecisionKind(entry.decisionKind)}
                  </span>
                  <ChevronRight
                    size={13}
                    className={`shrink-0 ${selected ? 'text-[var(--semantic-warning)]' : 'text-[var(--text-muted)]'}`}
                  />
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                  <span>r{entry.authorityRevision}</span>
                  <span>·</span>
                  <span>{formatSource(entry.source)}</span>
                  {entry.modelContext && (
                    <span className="rounded bg-[var(--bg-overlay)] px-1 font-mono">
                      {entry.modelContext.attempts.length} req
                    </span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

function DecisionInspector({
  entry,
  attempts,
  selectedAttempt,
  tab,
  onAttemptSelect,
  onTabSelect,
}: {
  readonly entry: AiBattleDebugTraceEntry;
  readonly attempts: readonly DebugAttempt[];
  readonly selectedAttempt: DebugAttempt | null;
  readonly tab: InspectorTab;
  readonly onAttemptSelect: (attempt: number) => void;
  readonly onTabSelect: (tab: InspectorTab) => void;
}) {
  return (
    <div className="min-w-0 p-3 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-black text-[var(--text-primary)]">
              {formatDecisionKind(entry.decisionKind)}
            </h3>
            <StatusBadge status={entry.executionStatus} />
            <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] font-bold text-[var(--text-secondary)]">
              {formatSource(entry.source)}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
            trace #{entry.seq} · revision {entry.authorityRevision} ·{' '}
            {new Date(entry.createdAt).toLocaleTimeString()}
          </p>
        </div>
        {entry.model && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-2 text-[10px] text-[var(--text-muted)]">
            <span>{entry.model.modelId}</span>
            <span>{entry.model.totalLatencyMs}ms</span>
            <span>
              in {entry.model.inputTokens} / out {entry.model.outputTokens}
            </span>
            <span>¥{(entry.model.estimatedCostMicrosCny / 1_000_000).toFixed(6)}</span>
          </div>
        )}
      </div>

      <p className="mt-3 break-words rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]">
        {entry.summary}
      </p>

      {attempts.length === 0 || !selectedAttempt ? (
        <div className="mt-5 flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-overlay)] px-6 text-center">
          <CircleCheck size={24} className="text-[var(--semantic-success)]" />
          <p className="mt-3 text-sm font-bold text-[var(--text-primary)]">本次没有调用模型</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--text-muted)]">
            当前窗口由确定性规则或保守策略直接处理，因此不存在送模上下文。
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap gap-2" aria-label="模型尝试">
            {attempts.map((attempt) => (
              <button
                key={`${attempt.attemptNumber}:${attempt.requestSha256}`}
                type="button"
                onClick={() => onAttemptSelect(attempt.attemptNumber)}
                aria-pressed={attempt.requestSha256 === selectedAttempt.requestSha256}
                className={`rounded-lg border px-3 py-2 text-left ${
                  attempt.requestSha256 === selectedAttempt.requestSha256
                    ? 'border-[color:color-mix(in_srgb,var(--semantic-warning)_60%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-warning)_9%,var(--bg-overlay))]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-overlay)]'
                }`}
              >
                <span className="block text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">
                  Attempt {attempt.attemptNumber} · {formatAttemptKind(attempt.attemptKind)}
                </span>
                <span className={`mt-0.5 block text-xs font-bold ${outcomeTone(attempt.outcome)}`}>
                  {attempt.outcome}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-1">
            <InspectorTabButton
              active={tab === 'CONTEXT'}
              icon={<Database size={14} />}
              label="上下文结构"
              onClick={() => onTabSelect('CONTEXT')}
            />
            <InspectorTabButton
              active={tab === 'OUTPUT'}
              icon={<Sparkles size={14} />}
              label="解析结果"
              onClick={() => onTabSelect('OUTPUT')}
            />
            <InspectorTabButton
              active={tab === 'RAW'}
              icon={<TerminalSquare size={14} />}
              label="原始消息"
              onClick={() => onTabSelect('RAW')}
            />
          </div>

          <AttemptIdentity attempt={selectedAttempt} />
          {tab === 'CONTEXT' && <ContextStructure attempt={selectedAttempt} />}
          {tab === 'OUTPUT' && <ParsedOutput attempt={selectedAttempt} />}
          {tab === 'RAW' && <RawMessages attempt={selectedAttempt} />}
        </>
      )}
    </div>
  );
}

function AttemptIdentity({ attempt }: { readonly attempt: DebugAttempt }) {
  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-2 text-[10px] text-[var(--text-muted)] sm:grid-cols-2">
      <span>
        request{' '}
        <code className="break-all font-mono text-[var(--text-secondary)]">
          {attempt.requestSha256}
        </code>
      </span>
      <span>
        envelope <code className="font-mono">{attempt.requestEnvelopeVersion}</code>
      </span>
      <span>
        prompt <code className="font-mono">{attempt.promptVersion}</code>
      </span>
      <span>
        output <code className="font-mono">{attempt.outputSchemaVersion}</code>
      </span>
      {attempt.failureCode && (
        <span className="sm:col-span-2">
          上次失败码{' '}
          <code className="font-mono text-[var(--semantic-warning)]">{attempt.failureCode}</code>
        </span>
      )}
    </div>
  );
}

function ContextStructure({ attempt }: { readonly attempt: DebugAttempt }) {
  const system = parseJson<ParsedSystemMessage>(attempt.systemMessage);
  const user = parseJson<ParsedUserMessage>(attempt.userMessage);
  const semantic = user?.strategyContext.semanticContext;
  if (!system || !semantic) {
    return (
      <SectionCard title="上下文解析失败" icon={<ShieldAlert size={15} />}>
        <p className="text-xs text-[var(--semantic-error)]">
          检查器无法结构化当前消息，请到“原始消息”页核对实际请求。
        </p>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-3 pt-3">
      <SectionCard title="系统任务与防注入边界" icon={<ScrollText size={15} />}>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <ProtocolPill label={system.systemInstruction.role} />
          <ProtocolPill label={system.systemInstruction.task} />
          <ProtocolPill label={system.promptVersion} />
        </div>
        <ol className="mt-3 space-y-1.5 pl-4 text-xs leading-5 text-[var(--text-secondary)]">
          {system.systemInstruction.constraints.map((constraint) => (
            <li key={constraint} className="list-decimal pl-1">
              {constraint}
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(system.systemInstruction.untrustedDataPolicy).map(([key, value]) => (
            <span
              key={key}
              className="rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-1.5 py-1 font-mono text-[9px] text-[var(--text-muted)]"
            >
              {key}={String(value)}
            </span>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="规则与卡组知识" icon={<Database size={15} />}>
        <PrettyJson value={system.trustedKnowledge} maxHeightClass="max-h-64" />
      </SectionCard>

      <SectionCard
        title="当前可见状态"
        eyebrow={semantic.currentState.summary}
        icon={<Clipboard size={15} />}
      >
        <TextFactList facts={semantic.currentState.facts} />
      </SectionCard>

      <SectionCard
        title={`当前决定 · ${semantic.currentDecision.kind}`}
        eyebrow={semantic.currentDecision.instruction}
        icon={<Braces size={15} />}
      >
        <TextFactList facts={semantic.currentDecision.facts} />
        <div className="mt-3 space-y-2">
          {semantic.currentDecision.choices.map((choice) => (
            <div
              key={`${choice.choiceKind}:${choice.choiceId}`}
              className="rounded-lg border border-[color:color-mix(in_srgb,var(--accent-primary)_22%,var(--border-subtle))] bg-[color:color-mix(in_srgb,var(--accent-primary)_4%,var(--bg-overlay))] p-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[var(--text-primary)]">
                  {choice.description}
                </span>
                <code className="rounded bg-[var(--bg-overlay)] px-1.5 py-0.5 text-[9px] text-[var(--accent-primary)]">
                  {choice.choiceKind}:{choice.choiceId}
                </code>
              </div>
              <TextFactList facts={choice.details} compact />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title={`权威已选历史 · ${semantic.battleHistory.length}`}
        icon={<History size={15} />}
      >
        {semantic.battleHistory.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">本次请求没有选入历史条目。</p>
        ) : (
          <div className="space-y-2">
            {semantic.battleHistory.map((item, index) => (
              <div
                key={`${String(item.turnCount)}:${item.subject}:${String(index)}`}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-2.5"
              >
                <div className="mb-1 text-[10px] font-black text-[var(--text-muted)]">
                  TURN {item.turnCount} · {item.subject === 'SELF' ? '我方' : '对方'}
                </div>
                <TextFactList facts={item.facts} compact />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="严格输出契约" icon={<Braces size={15} />}>
        <PrettyJson value={system.responseContract} maxHeightClass="max-h-72" />
      </SectionCard>
    </div>
  );
}

function ParsedOutput({ attempt }: { readonly attempt: DebugAttempt }) {
  if (!attempt.parsedOutput) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--bg-overlay)] p-6 text-center">
        <ShieldAlert size={22} className="mx-auto text-[var(--semantic-warning)]" />
        <p className="mt-2 text-sm font-bold text-[var(--text-primary)]">没有可展示的结构化结果</p>
        <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
          本次调用可能在传输阶段失败，或返回内容未通过 JSON / schema
          解析。原始无效响应不会被调试轨迹保留。
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3 pt-3">
      <SectionCard title="模型交付摘要" icon={<Sparkles size={15} />}>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">
              Tradeoff
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--text-primary)]">
              {attempt.parsedOutput.tradeoff ?? '模型未提供；此项为可选说明。'}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)]">
              Next plan
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--text-primary)]">
              {attempt.parsedOutput.nextPlan ?? '模型未提供；此项为可选说明。'}
            </p>
          </div>
        </div>
      </SectionCard>
      <SectionCard title="严格解析后的 JSON" icon={<Braces size={15} />}>
        <PrettyJson value={attempt.parsedOutput} maxHeightClass="max-h-[28rem]" />
      </SectionCard>
    </div>
  );
}

function RawMessages({ attempt }: { readonly attempt: DebugAttempt }) {
  return (
    <div className="space-y-3 pt-3">
      <SectionCard title="System message · 实际发送" icon={<TerminalSquare size={15} />}>
        <CopyableCode value={prettyJsonString(attempt.systemMessage)} label="复制 system message" />
      </SectionCard>
      <SectionCard title="User message · 实际发送" icon={<TerminalSquare size={15} />}>
        <CopyableCode value={prettyJsonString(attempt.userMessage)} label="复制 user message" />
      </SectionCard>
    </div>
  );
}

function SectionCard({
  title,
  eyebrow,
  icon,
  children,
}: {
  readonly title: string;
  readonly eyebrow?: string;
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_84%,transparent)] p-3 sm:p-4">
      <div className="flex items-center gap-2 text-[var(--text-primary)]">
        <span className="text-[var(--semantic-warning)]">{icon}</span>
        <h4 className="text-xs font-black">{title}</h4>
      </div>
      {eyebrow && <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">{eyebrow}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function TextFactList({
  facts,
  compact = false,
}: {
  readonly facts: readonly string[];
  readonly compact?: boolean;
}) {
  return (
    <div className={compact ? 'mt-2 space-y-1.5' : 'space-y-2'}>
      {facts.map((fact, index) => (
        <p
          key={`${String(index)}:${fact}`}
          className="text-[11px] leading-5 text-[var(--text-secondary)]"
        >
          {fact}
        </p>
      ))}
    </div>
  );
}

function PrettyJson({
  value,
  maxHeightClass,
}: {
  readonly value: unknown;
  readonly maxHeightClass: string;
}) {
  return (
    <pre
      className={`cute-scrollbar overflow-auto rounded-lg border border-[var(--border-subtle)] bg-slate-950/90 p-3 font-mono text-[10px] leading-5 text-slate-200 ${maxHeightClass}`}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function CopyableCode({ value, label }: { readonly value: string; readonly label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void copy()}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded border border-white/15 bg-slate-900/90 px-2 py-1 text-[9px] font-bold text-slate-200 hover:bg-slate-800"
        aria-label={label}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? '已复制' : '复制'}
      </button>
      <pre className="cute-scrollbar max-h-[32rem] overflow-auto rounded-lg border border-[var(--border-subtle)] bg-slate-950/95 p-3 pr-16 font-mono text-[10px] leading-5 text-slate-200">
        {value}
      </pre>
    </div>
  );
}

function InspectorTabButton({
  active,
  icon,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[10px] font-black sm:text-xs ${
        active
          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ProtocolPill({ label }: { readonly label: string }) {
  return (
    <code className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1 font-mono text-[9px] text-[var(--text-secondary)]">
      {label}
    </code>
  );
}

function StatusBadge({ status }: { readonly status: AiBattleDebugTraceEntry['executionStatus'] }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-black ${statusTone(status)}`}>
      {status === 'ACCEPTED' && <CircleCheck size={12} />}
      {formatExecutionStatus(status)}
    </span>
  );
}

function EmptyInspector() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-16 text-center">
      <BrainCircuit size={30} className="text-[var(--text-muted)]" />
      <p className="mt-3 text-sm font-bold text-[var(--text-primary)]">等待第一条决策记录</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">AI 开始行动后，上下文会在这里出现。</p>
    </div>
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

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function prettyJsonString(value: string): string {
  const parsed = parseJson<unknown>(value);
  return parsed === null ? value : JSON.stringify(parsed, null, 2);
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

function formatAttemptKind(kind: DebugAttempt['attemptKind']): string {
  if (kind === 'REPAIR') return '格式修复';
  if (kind === 'RETRY') return '传输重试';
  return '初次请求';
}

function formatExecutionStatus(status: AiBattleDebugTraceEntry['executionStatus']): string {
  if (status === 'ACCEPTED') return '已执行';
  if (status === 'STALE') return '状态已变化';
  if (status === 'REJECTED') return '规则拒绝';
  return '未提交';
}

function statusTone(status: AiBattleDebugTraceEntry['executionStatus']): string {
  if (status === 'ACCEPTED') return 'text-[var(--semantic-success)]';
  if (status === 'REJECTED') return 'text-[var(--semantic-error)]';
  return 'text-[var(--semantic-warning)]';
}

function outcomeTone(outcome: string): string {
  return outcome === 'SUCCESS'
    ? 'text-[var(--semantic-success)]'
    : 'text-[var(--semantic-warning)]';
}
