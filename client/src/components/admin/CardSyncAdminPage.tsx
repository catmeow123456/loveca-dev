import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudDownload,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { ActionButton, ConfirmDialog, StatusBadge } from '@/components/common';
import {
  createCardSyncPreview,
  fetchCardSyncRun,
  fetchCardSyncStatus,
  isCardSyncRunActive,
  newCardSyncIdempotencyKey,
  startCardSyncRun,
  type CardSyncCandidate,
  type CardSyncBlockedItem,
  type CardSyncForceImport,
  type CardSyncImageCheckMode,
  type CardSyncPreview,
  type CardSyncRun,
  type CardSyncRunItemStatus,
  type CardSyncRunStatus,
  type CardSyncStatus,
} from '@/lib/cardSyncClient';
import { AdminPageHeader } from './AdminPageHeader';

const RUN_POLL_INTERVAL_MS = 1_500;

interface CardSyncAdminPageProps {
  readonly onBack: () => void;
}

export function CardSyncAdminPage({ onBack }: CardSyncAdminPageProps) {
  const [status, setStatus] = useState<CardSyncStatus | null>(null);
  const [preview, setPreview] = useState<CardSyncPreview | null>(null);
  const [run, setRun] = useState<CardSyncRun | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [previewExpired, setPreviewExpired] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedCardCodes, setSelectedCardCodes] = useState<ReadonlySet<string>>(new Set());
  const [forceItems, setForceItems] = useState<ReadonlyMap<string, CardSyncForceImport>>(new Map());
  const [forceMode, setForceMode] = useState(false);
  const [imageCheck, setImageCheck] = useState<CardSyncImageCheckMode>('LINK');
  const [progress, setProgress] = useState({ checked: 0, total: 0 });
  const previewController = useRef<AbortController | null>(null);
  useEffect(() => () => previewController.current?.abort(), []);
  const applyIdempotencyRef = useRef<{
    readonly previewId: string;
    readonly selectionKey: string;
    readonly key: string;
  } | null>(null);

  const loadStatus = useCallback(async (showLoading: boolean) => {
    if (showLoading) setIsLoadingStatus(true);
    try {
      const nextStatus = await fetchCardSyncStatus();
      setStatus(nextStatus);
      setRun(nextStatus.activeRun ?? nextStatus.latestRun);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取新卡同步状态失败');
    } finally {
      if (showLoading) setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadStatus(true), 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadStatus]);

  useEffect(() => {
    if (!preview) return;
    const remainingMs = Date.parse(preview.expiresAt) - Date.now();
    if (remainingMs <= 0) {
      const timeoutId = window.setTimeout(() => setPreviewExpired(true), 0);
      return () => window.clearTimeout(timeoutId);
    }
    const timeoutId = window.setTimeout(() => setPreviewExpired(true), remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [preview]);

  useEffect(() => {
    if (!run || !isCardSyncRunActive(run.status)) return;

    let disposed = false;
    let timeoutId: number | null = null;
    const poll = async () => {
      try {
        const nextRun = await fetchCardSyncRun(run.id);
        if (disposed) return;
        setRun(nextRun);
        setStatus((current) =>
          current
            ? {
                ...current,
                activeRun: isCardSyncRunActive(nextRun.status) ? nextRun : null,
                latestRun: nextRun,
              }
            : current
        );
        setMessage(null);
      } catch (error) {
        if (!disposed) {
          setMessage(error instanceof Error ? error.message : '刷新新卡同步任务失败');
          timeoutId = window.setTimeout(() => void poll(), RUN_POLL_INTERVAL_MS);
        }
      }
    };
    timeoutId = window.setTimeout(() => void poll(), RUN_POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [run]);

  const activeRun = run && isCardSyncRunActive(run.status) ? run : null;
  const configurationReady = status?.configuration === 'READY';
  const selectedCandidates = useMemo(
    () =>
      preview?.candidates.filter((candidate) => selectedCardCodes.has(candidate.cardCode)) ?? [],
    [preview, selectedCardCodes]
  );
  const selectedWarningCardCount = useMemo(
    () => selectedCandidates.filter((candidate) => candidate.warnings.length > 0).length,
    [selectedCandidates]
  );

  const handleCheck = async () => {
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setIsChecking(true);
    setMessage(null);
    setIsConfirmOpen(false);
    try {
      setProgress({ checked: 0, total: 0 });
      const nextPreview = await createCardSyncPreview(undefined, {
        imageCheck,
        onProgress: (value) => {
          if (!controller.signal.aborted) setProgress(value);
        },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setForceItems(new Map());
      setForceMode(false);
      setPreview(nextPreview);
      setSelectedCardCodes(
        new Set(
          nextPreview.candidates
            .filter((candidate) => candidate.warnings.length === 0)
            .map((candidate) => candidate.cardCode)
        )
      );
      setPreviewExpired(false);
      applyIdempotencyRef.current = null;
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : '检查上游新卡失败');
    } finally {
      if (!controller.signal.aborted) setIsChecking(false);
    }
  };

  const handleStart = async () => {
    if (!preview || selectedCandidates.length + forceItems.size === 0) return;
    if (Date.parse(preview.expiresAt) <= Date.now()) {
      setPreviewExpired(true);
      setIsConfirmOpen(false);
      return;
    }
    setIsStarting(true);
    setMessage(null);
    try {
      const cardCodes = selectedCandidates.map((candidate) => candidate.cardCode);
      const choices = [...forceItems.values()];
      const forceImport = forceMode || choices.length > 0;
      const selectionKey = JSON.stringify({ cardCodes, choices, forceImport });
      const existingKey = applyIdempotencyRef.current;
      const idempotencyKey =
        existingKey?.previewId === preview.id && existingKey.selectionKey === selectionKey
          ? existingKey.key
          : newCardSyncIdempotencyKey();
      applyIdempotencyRef.current = { previewId: preview.id, selectionKey, key: idempotencyKey };
      const nextRun = await startCardSyncRun(preview.id, cardCodes, idempotencyKey, {
        forceImport,
        forceImports: choices,
      });
      setRun(nextRun);
      setStatus((current) =>
        current ? { ...current, activeRun: nextRun, latestRun: nextRun } : current
      );
      setPreview(null);
      setSelectedCardCodes(new Set());
      setForceItems(new Map());
      setIsConfirmOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '创建新卡同步任务失败');
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="app-shell min-h-screen">
      <AdminPageHeader
        title="上游新卡同步"
        category="卡牌与规则"
        onBack={onBack}
        backLabel="返回卡牌数据"
      />

      <main className="product-page-main flex flex-col gap-4">
        <section
          className="product-workbench overflow-hidden"
          aria-labelledby="card-sync-status-title"
        >
          <header className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              <CloudDownload
                size={19}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-[var(--accent-primary)]"
              />
              <div>
                <h2
                  id="card-sync-status-title"
                  className="text-sm font-bold text-[var(--text-primary)]"
                >
                  小能苗新卡导入
                </h2>
                <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-secondary)]">
                  只检查并导入生产卡牌库中尚不存在的卡牌。导入后固定为草稿，不会修改或删除已有卡牌。
                </p>
              </div>
            </div>
            <ActionButton
              variant="secondary"
              size="compact"
              onClick={() => void loadStatus(true)}
              disabled={isLoadingStatus || isChecking || isStarting}
              aria-label="刷新同步状态"
            >
              <RefreshCw
                size={14}
                className={isLoadingStatus ? 'animate-spin' : ''}
                aria-hidden="true"
              />
              刷新状态
            </ActionButton>
          </header>

          <div className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
            <div>
              {isLoadingStatus && !status ? (
                <div
                  role="status"
                  className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"
                >
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  正在读取服务端配置…
                </div>
              ) : status?.configuration === 'READY' ? (
                <div className="flex items-start gap-2">
                  <CheckCircle2
                    size={17}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-[var(--semantic-success)]"
                  />
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      服务端已就绪
                    </div>
                    <p className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]">
                      上游访问信息仅由服务端读取，不会发送到浏览器。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2" role="alert">
                  <ShieldAlert
                    size={17}
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-[var(--semantic-warning)]"
                  />
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      服务端同步配置尚未就绪
                    </div>
                    <p className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]">
                      请由部署管理员在生产服务器完成配置后重试。
                    </p>
                  </div>
                </div>
              )}
            </div>

            <ActionButton
              variant="primary"
              onClick={() => void handleCheck()}
              disabled={!configurationReady || Boolean(activeRun) || isChecking || isStarting}
            >
              {isChecking ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : (
                <CloudDownload size={15} aria-hidden="true" />
              )}
              检查新卡
            </ActionButton>
          </div>
        </section>

        <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--text-secondary)]">
          <label className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <span className="shrink-0">卡图检查</span>
            <select
              aria-label="卡图检查方式"
              className="input-field w-auto px-3 py-2"
              value={imageCheck}
              disabled={isChecking}
              onChange={(event) => setImageCheck(event.target.value as CardSyncImageCheckMode)}
            >
              <option value="NONE">不检查卡图</option>
              <option value="LINK">轻量检查</option>
              <option value="DECODE">完整检查</option>
            </select>
          </label>
          <span>
            {imageCheck === 'NONE'
              ? '只读取卡牌资料，不请求卡图；卡图在实际导入时处理。'
              : imageCheck === 'LINK'
                ? '只检查链接，不下载图片正文；最多同时检查 4 张，重复地址复用结果。'
                : '下载并解码卡图，耗时较长；最多同时检查 4 张，重复地址复用结果。'}
          </span>
          {isChecking && (
            <>
              <span role="status">
                {progress.total
                  ? `卡图检查 ${progress.checked} / ${progress.total}`
                  : '正在读取上游卡牌…'}
              </span>
              <ActionButton
                size="compact"
                variant="secondary"
                onClick={() => {
                  previewController.current?.abort();
                  setIsChecking(false);
                  setMessage('已停止等待，可切换检查方式后重新检查。');
                }}
              >
                停止等待
              </ActionButton>
            </>
          )}
        </div>

        {message ? (
          <div
            role="alert"
            className="rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_8%,var(--bg-surface))] px-4 py-3 text-sm text-[var(--semantic-error)]"
          >
            {message}
          </div>
        ) : null}

        {preview ? (
          <PreviewPanel
            preview={preview}
            expired={previewExpired}
            disabled={Boolean(activeRun) || isStarting || isChecking}
            selectedCardCodes={selectedCardCodes}
            onSelectionChange={setSelectedCardCodes}
            forceItems={forceItems}
            onForceItemsChange={setForceItems}
            forceMode={forceMode}
            onForceModeChange={setForceMode}
            onConfirm={() => setIsConfirmOpen(true)}
            onRefresh={() => void handleCheck()}
          />
        ) : null}

        {run ? <RunPanel run={run} /> : null}
      </main>

      <ConfirmDialog
        isOpen={isConfirmOpen && Boolean(preview)}
        title={forceItems.size || forceMode ? '确认强制导入草稿' : '确认导入上游新卡'}
        message={
          preview
            ? `将同步所选 ${selectedCandidates.length + forceItems.size} 张新卡为草稿。${
                selectedWarningCardCount > 0
                  ? `其中 ${selectedWarningCardCount} 张带有警告，请确认已核对占位或缺失字段。`
                  : ''
              }${forceItems.size || forceMode ? '已启用强制导入：忽略所选卡牌的数据检查错误；无法解析的数值留空，卡图失败仍保存无图草稿。请确认所选编号、名称和类型，导入后可在卡牌编辑页补齐。' : ''}已有卡牌不会被修改，未选择项不会导入。`
            : ''
        }
        confirmLabel={
          preview
            ? `${forceItems.size || forceMode ? '确认强制导入' : '同步所选'} ${selectedCandidates.length + forceItems.size} 张新卡为草稿`
            : '开始同步'
        }
        cancelLabel="继续检查"
        tone={forceItems.size || forceMode ? 'danger' : 'primary'}
        isConfirming={isStarting}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={() => void handleStart()}
      />
    </div>
  );
}

function PreviewPanel({
  preview,
  expired,
  disabled,
  selectedCardCodes,
  onSelectionChange,
  forceItems,
  onForceItemsChange,
  forceMode,
  onForceModeChange,
  onConfirm,
  onRefresh,
}: {
  readonly preview: CardSyncPreview;
  readonly expired: boolean;
  readonly disabled: boolean;
  readonly selectedCardCodes: ReadonlySet<string>;
  readonly onSelectionChange: (cardCodes: ReadonlySet<string>) => void;
  readonly forceItems: ReadonlyMap<string, CardSyncForceImport>;
  readonly onForceItemsChange: (items: ReadonlyMap<string, CardSyncForceImport>) => void;
  readonly forceMode: boolean;
  readonly onForceModeChange: (value: boolean) => void;
  readonly onConfirm: () => void;
  readonly onRefresh: () => void;
}) {
  const [hideImageIssues, setHideImageIssues] = useState(true);
  const hasCandidates = preview.summary.candidateCount + preview.summary.blockedCount > 0;
  const selectedCount = preview.candidates.reduce(
    (sum, candidate) => sum + (selectedCardCodes.has(candidate.cardCode) ? 1 : 0),
    forceItems.size
  );
  const candidateWarnings = useMemo(
    () => preview.candidates.reduce((sum, candidate) => sum + candidate.warnings.length, 0),
    [preview.candidates]
  );
  const updateCandidateSelection = (cardCode: string, selected: boolean) => {
    const next = new Set(selectedCardCodes);
    if (selected) next.add(cardCode);
    else next.delete(cardCode);
    onSelectionChange(next);
  };
  const selectAll = () =>
    onSelectionChange(new Set(preview.candidates.map((candidate) => candidate.cardCode)));
  const clearSelection = () => {
    onSelectionChange(new Set());
    onForceItemsChange(new Map());
  };

  return (
    <section
      className="product-workbench overflow-hidden"
      aria-labelledby="card-sync-preview-title"
    >
      <header className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 id="card-sync-preview-title" className="text-sm font-bold text-[var(--text-primary)]">
            检查结果
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            生成于 <TimeValue value={preview.createdAt} />
            ，有效至 <TimeValue value={preview.expiresAt} />
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasCandidates ? (
            <>
              <ActionButton
                variant="secondary"
                size="compact"
                onClick={selectAll}
                disabled={
                  disabled ||
                  expired ||
                  preview.candidates.every((candidate) => selectedCardCodes.has(candidate.cardCode))
                }
              >
                全选普通候选
              </ActionButton>
              <ActionButton
                variant="secondary"
                size="compact"
                onClick={clearSelection}
                disabled={disabled || expired || selectedCount === 0}
              >
                清空选择
              </ActionButton>
            </>
          ) : null}
          {expired ? (
            <ActionButton
              variant="secondary"
              size="compact"
              onClick={onRefresh}
              disabled={disabled}
            >
              <RefreshCw size={14} aria-hidden="true" />
              重新检查
            </ActionButton>
          ) : null}
          <ActionButton
            variant="primary"
            size="compact"
            onClick={onConfirm}
            disabled={disabled || expired || selectedCount === 0}
          >
            同步所选 {selectedCount} 张新卡为草稿
          </ActionButton>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5 sm:p-5">
        <Metric label="上游卡牌" value={preview.summary.sourceCount} />
        <Metric label="已存在" value={preview.summary.existingCount} />
        <Metric label="可同步" value={preview.summary.candidateCount} tone="success" />
        <Metric label="需确认" value={preview.summary.blockedCount} tone="danger" />
        <Metric label="警告" value={preview.summary.warningCount} tone="warning" />
      </div>

      {hasCandidates ? (
        <div className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs sm:mx-5 sm:mb-5">
          <span className="font-semibold text-[var(--text-primary)]">
            已选择 {selectedCount} / {preview.candidates.length + preview.blocked.length} 张
          </span>
          <span className="text-[var(--text-muted)]">
            {preview.imageCheck === 'NONE'
              ? '本次未检查卡图，默认选择无警告的卡；'
              : '默认选择无警告且卡图检查通过的卡；'}
            错误项核对后可选择强制导入。
          </span>
        </div>
      ) : null}

      <label className="mx-4 mb-4 flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={forceMode}
          disabled={disabled || expired}
          onChange={(event) => onForceModeChange(event.target.checked)}
        />
        强制导入所选卡牌：卡图失败也保存无图草稿
      </label>
      {expired ? (
        <div
          role="alert"
          className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-warning)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-warning)_8%,var(--bg-surface))] px-3 py-3 text-xs leading-5 text-[var(--text-secondary)] sm:mx-5 sm:mb-5"
        >
          <Clock3
            size={15}
            className="mt-0.5 shrink-0 text-[var(--semantic-warning)]"
            aria-hidden="true"
          />
          这份预览已过期，需要重新检查上游和生产卡牌库后才能同步。
        </div>
      ) : null}

      <div className="grid border-t border-[var(--border-subtle)] lg:grid-cols-2 lg:divide-x lg:divide-[var(--border-subtle)]">
        <PreviewList
          title="可同步新卡"
          count={preview.candidates.length}
          emptyMessage="当前没有需要同步的新卡。"
        >
          {preview.candidates.map((candidate) => (
            <CandidateRow
              key={candidate.cardCode}
              candidate={candidate}
              selected={selectedCardCodes.has(candidate.cardCode)}
              disabled={disabled || expired}
              onSelectionChange={updateCandidateSelection}
            />
          ))}
          {candidateWarnings === 0 && preview.candidates.length > 0 ? (
            <p className="px-4 pb-3 text-xs text-[var(--text-muted)] sm:px-5">
              所有候选卡牌均无警告。
            </p>
          ) : null}
        </PreviewList>

        <PreviewList
          title="需确认后导入"
          count={preview.blocked.length}
          emptyMessage="未发现需确认项。"
        >
          <label className="flex items-center gap-2 px-4 py-3 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={hideImageIssues}
              onChange={(event) => setHideImageIssues(event.target.checked)}
            />
            隐藏卡图异常 / 疑似占位项（{preview.blocked.filter((item) => item.imageIssue).length}{' '}
            张；取消隐藏后仍可强制导入）
          </label>
          <div className="max-h-[36rem] overflow-y-auto">
            {preview.blocked
              .filter(
                (item) =>
                  !hideImageIssues || !item.imageIssue || forceItems.has(item.sourceKey ?? '')
              )
              .map((item, index) => (
                <ReviewCardRow
                  key={item.sourceKey ?? index}
                  item={item}
                  disabled={disabled || expired}
                  value={forceItems.get(item.sourceKey ?? '')}
                  onChange={(value) => {
                    const next = new Map(forceItems);
                    if (value) next.set(value.sourceKey, value);
                    else next.delete(item.sourceKey ?? '');
                    onForceItemsChange(next);
                  }}
                />
              ))}
          </div>
        </PreviewList>
      </div>
    </section>
  );
}

function PreviewList({
  title,
  count,
  emptyMessage,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly emptyMessage: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <header className="flex items-center justify-between gap-3 bg-[var(--bg-surface)] px-4 py-3 sm:px-5">
        <h3 className="text-xs font-bold text-[var(--text-primary)]">{title}</h3>
        <span className="text-xs tabular-nums text-[var(--text-muted)]">{count} 项</span>
      </header>
      {count === 0 ? (
        <p className="border-t border-[var(--border-subtle)] px-4 py-5 text-sm text-[var(--text-muted)] sm:px-5">
          {emptyMessage}
        </p>
      ) : (
        <div>{children}</div>
      )}
    </section>
  );
}

function CandidateRow({
  candidate,
  selected,
  disabled,
  onSelectionChange,
}: {
  readonly candidate: CardSyncCandidate;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelectionChange: (cardCode: string, selected: boolean) => void;
}) {
  const stats = [
    candidate.cardType,
    candidate.cost !== null && candidate.cost !== undefined ? `费用 ${candidate.cost}` : null,
    candidate.score !== null && candidate.score !== undefined ? `分数 ${candidate.score}` : null,
  ].filter(Boolean);

  return (
    <article
      className={`border-t border-[var(--border-subtle)] px-4 py-3 first:border-t-0 sm:px-5 ${
        selected ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_5%,transparent)]' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={(event) => onSelectionChange(candidate.cardCode, event.target.checked)}
          aria-label={`选择 ${candidate.cardCode}`}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="break-all text-sm font-semibold text-[var(--text-primary)]">
                {candidate.cardCode}
              </div>
              <div className="mt-0.5 break-words text-xs text-[var(--text-secondary)]">
                {candidate.name}
              </div>
            </div>
            <span className="text-xs text-[var(--text-muted)]">{stats.join(' · ')}</span>
          </div>
          {candidate.warnings.length > 0 ? (
            <ul className="mt-2 space-y-1" aria-label={`${candidate.cardCode} 警告`}>
              {candidate.warnings.map((warning, index) => (
                <li
                  key={`${warning}-${index}`}
                  className="flex items-start gap-1.5 text-xs leading-5 text-[var(--semantic-warning)]"
                >
                  <AlertTriangle size={13} className="mt-1 shrink-0" aria-hidden="true" />
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ReviewCardRow({
  item,
  value,
  disabled,
  onChange,
}: {
  item: CardSyncBlockedItem;
  value?: CardSyncForceImport;
  disabled: boolean;
  onChange: (value?: CardSyncForceImport) => void;
}) {
  const defaults: CardSyncForceImport = {
    sourceKey: item.sourceKey ?? '',
    cardCode: item.suggestedCardCode ?? item.cardCode ?? '',
    name: item.name ?? '未命名卡牌',
    skipImage: item.imageIssue === true,
    cardType: item.cardType === 'LIVE' || item.cardType === 'ENERGY' ? item.cardType : 'MEMBER',
  };
  return (
    <article className="border-t border-[var(--border-subtle)] px-4 py-3">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={!!value}
          disabled={disabled || !item.sourceKey}
          onChange={(event) => onChange(event.target.checked ? defaults : undefined)}
          aria-label={`强制导入 ${item.cardCode ?? item.suggestedCardCode}`}
        />
        <span className="min-w-0 break-words">
          <strong>{item.cardCode ?? '上游未提供编号'}</strong>
          <span className="block">{item.name ?? '上游未提供名称'}</span>
        </span>
      </label>
      <ul className="mt-2 text-xs text-[var(--semantic-error)]">
        {item.reasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
      {value && (
        <div className="mt-3 grid gap-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value.skipImage === true}
              onChange={(event) => onChange({ ...value, skipImage: event.target.checked })}
            />
            跳过卡图，仅导入文字草稿
          </label>
          <label>
            导入编号
            <input
              className="input-field mt-1 w-full px-3 py-2"
              value={value.cardCode}
              onChange={(event) => onChange({ ...value, cardCode: event.target.value })}
              onBlur={() => {
                if (!value.cardCode.trim()) onChange({ ...value, cardCode: defaults.cardCode });
              }}
            />
          </label>
          <label>
            导入名称
            <input
              className="input-field mt-1 w-full px-3 py-2"
              value={value.name}
              onChange={(event) => onChange({ ...value, name: event.target.value })}
              onBlur={() => {
                if (!value.name.trim()) onChange({ ...value, name: defaults.name });
              }}
            />
          </label>
          <label>
            导入类型
            <select
              aria-label="导入类型"
              className="input-field ml-2 px-3 py-2"
              value={value.cardType}
              onChange={(event) =>
                onChange({
                  ...value,
                  cardType: event.target.value as CardSyncForceImport['cardType'],
                })
              }
            >
              <option value="MEMBER">成员</option>
              <option value="LIVE">LIVE</option>
              <option value="ENERGY">能量</option>
            </select>
          </label>
        </div>
      )}
    </article>
  );
}

function RunPanel({ run }: { readonly run: CardSyncRun }) {
  const meta = runStatusMeta(run.status);
  const completed = run.summary.succeededCount + run.summary.failedCount;
  const progressMax = Math.max(1, run.summary.totalCount);

  return (
    <section className="product-workbench overflow-hidden" aria-labelledby="card-sync-run-title">
      <header className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="card-sync-run-title" className="text-sm font-bold text-[var(--text-primary)]">
              同步任务
            </h2>
            <StatusBadge tone={meta.tone} dot>
              {meta.label}
            </StatusBadge>
          </div>
          <p className="mt-1 break-all text-xs text-[var(--text-muted)]">
            任务 {run.id} · 创建于 <TimeValue value={run.createdAt} />
          </p>
        </div>
        {isCardSyncRunActive(run.status) ? (
          <div
            role="status"
            className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"
          >
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            页面会自动刷新，可安全离开后再返回
          </div>
        ) : null}
      </header>

      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="总数" value={run.summary.totalCount} />
          <Metric label="已成功" value={run.summary.succeededCount} tone="success" />
          <Metric label="失败" value={run.summary.failedCount} tone="danger" />
          <Metric label="待处理" value={run.summary.pendingCount} />
        </div>
        <progress
          className="mt-4 h-2 w-full overflow-hidden rounded-full accent-[var(--accent-primary)]"
          aria-label="新卡同步进度"
          value={completed}
          max={progressMax}
        />
        {run.message ? (
          <p
            className={`mt-3 text-xs leading-5 ${
              run.status === 'FAILED' || run.status === 'PARTIAL'
                ? 'text-[var(--semantic-error)]'
                : 'text-[var(--text-secondary)]'
            }`}
          >
            {run.message}
          </p>
        ) : null}
      </div>

      <div className="border-t border-[var(--border-subtle)]">
        <div className="flex items-center justify-between bg-[var(--bg-surface)] px-4 py-3 sm:px-5">
          <h3 className="text-xs font-bold text-[var(--text-primary)]">逐卡结果</h3>
          <span className="text-xs tabular-nums text-[var(--text-muted)]">
            {run.items.length} 张
          </span>
        </div>
        {run.items.length === 0 ? (
          <p className="border-t border-[var(--border-subtle)] px-4 py-5 text-sm text-[var(--text-muted)] sm:px-5">
            任务尚未产生逐卡结果。
          </p>
        ) : (
          <ul aria-label="新卡同步逐卡结果" className="divide-y divide-[var(--border-subtle)]">
            {run.items.map((item) => {
              const itemMeta = runItemStatusMeta(item.status);
              return (
                <li
                  key={item.cardCode}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5"
                >
                  <div className="min-w-0">
                    <div className="break-all text-sm font-semibold text-[var(--text-primary)]">
                      {item.cardCode}
                    </div>
                    <div className="mt-0.5 break-words text-xs text-[var(--text-secondary)]">
                      {item.name}
                    </div>
                    {item.message ? (
                      <div
                        className={`mt-1 text-xs leading-5 ${
                          item.status === 'FAILED'
                            ? 'text-[var(--semantic-error)]'
                            : 'text-[var(--text-muted)]'
                        }`}
                      >
                        {item.message}
                      </div>
                    ) : null}
                  </div>
                  <StatusBadge tone={itemMeta.tone}>{itemMeta.label}</StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const valueClass =
    tone === 'success'
      ? 'text-[var(--semantic-success)]'
      : tone === 'warning'
        ? 'text-[var(--semantic-warning)]'
        : tone === 'danger'
          ? 'text-[var(--semantic-error)]'
          : 'text-[var(--text-primary)]';

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className={`mt-1 text-lg font-bold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function TimeValue({ value }: { readonly value: string }) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return <>{value}</>;
  return (
    <time dateTime={value}>{new Date(timestamp).toLocaleString('zh-CN', { hour12: false })}</time>
  );
}

function runStatusMeta(status: CardSyncRunStatus): {
  readonly label: string;
  readonly tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
} {
  switch (status) {
    case 'QUEUED':
      return { label: '等待执行', tone: 'neutral' };
    case 'RUNNING':
      return { label: '执行中', tone: 'info' };
    case 'SUCCEEDED':
      return { label: '全部成功', tone: 'success' };
    case 'PARTIAL':
      return { label: '部分成功', tone: 'warning' };
    case 'FAILED':
      return { label: '执行失败', tone: 'danger' };
  }
}

function runItemStatusMeta(status: CardSyncRunItemStatus): {
  readonly label: string;
  readonly tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
} {
  switch (status) {
    case 'PENDING':
      return { label: '待处理', tone: 'neutral' };
    case 'RUNNING':
      return { label: '处理中', tone: 'info' };
    case 'SUCCEEDED':
      return { label: '成功', tone: 'success' };
    case 'FAILED':
      return { label: '失败', tone: 'danger' };
    case 'SKIPPED':
      return { label: '已跳过', tone: 'warning' };
  }
}
