import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveAs } from 'file-saver';
import { ArrowDownToLine, Copy, X } from 'lucide-react';
import type {
  AiTraceDecisionSummary,
  AiTraceExport,
  AiTraceListing,
  AiTraceMaterial,
} from '@game/online/ai-battle-observation-types';
import {
  fetchAiDecision,
  fetchAiDecisions,
  exportAiBattle,
  exportAiArchive,
} from '@/lib/aiBattleClient';
import { SerialPollingScheduler } from '@/lib/asyncRequestControl';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';
import './ai-battle.css';
import { AiBillingCost } from './AiBillingCost';

const archiveFailures = {
  FILE_LIMIT: '达到单局文件上限',
  QUEUE_LIMIT: '磁盘写入积压',
  WRITE_FAILED: '磁盘写入失败',
  CAPTURE_FAILED: '材料采集失败',
} as const;

const purposes: Readonly<Record<string, string>> = {
  MULLIGAN: '换牌',
  MAIN: '主要阶段',
  LIVE_SET: 'LIVE 设置',
  PUBLIC_DISPLAY: '公开展示',
  PENDING_ORDER: '效果顺序',
  EFFECT: '效果选择',
  EFFECT_CONFIRM: '效果确认',
  RULE_CONFIRM: '规则确认',
  SUCCESS_LIVE: '成功 LIVE',
  WAITING_FOR_PLAYER: '等待真人',
  WAITING_FOR_TIME: '等待展示',
  UNSUPPORTED: '未支持的窗口',
  CAPTURE_BEFORE_SAMPLE: '采样前故障',
  ENDED: '结束',
};
const statuses: Readonly<Record<string, string>> = {
  SAMPLED: '已采样',
  REQUESTING: '请求中',
  WAITING: '等待',
  WAITING_SELECTED: '已选择，等待时点',
  ACCEPTED: '已执行',
  STALE: '过期，未执行',
  STOPPED: '已停止',
  ENDED: '已结束',
};
const isWaitingPurpose = (purpose: string) =>
  purpose === 'WAITING_FOR_PLAYER' || purpose === 'WAITING_FOR_TIME';

function isRecordVisible(
  row: AiTraceDecisionSummary,
  showWaiting: boolean,
  showMechanical: boolean
) {
  return (
    (showWaiting || !isWaitingPurpose(row.purpose)) &&
    (showMechanical || row.submissionSource !== 'MECHANICAL')
  );
}

const stages: Readonly<Record<string, string>> = {
  SAMPLE: '当时局面与完整候选',
  REQUEST: '实际模型请求',
  RESPONSE: '响应状态',
  RESPONSE_BODY: '原始响应',
  LIVE_PROBABILITY_QUERY: 'LIVE 概率条件查询',
  LIVE_PROBABILITY_RESULT: 'LIVE 概率计算结果',
  LIVE_PROBABILITY_REJECTED: 'LIVE 概率查询被拒绝',
  MODEL_OUTCOME: '驱动收到的输出',
  MODEL_VALIDATION: '模型选择校验',
  MODEL_FAILURE: '模型失败',
  PREPARED: '准备的选择',
  SERVICE_RETRY: '服务重试',
  WAIT: '时间与输入等待',
  SUBMIT: '提交的选择与命令',
  AUTHORITY_RESULT: '权威执行结果',
  ACCEPTED: '已接受的选择',
  COMPLETION: '决定处理结果',
  STOP: '停止依据',
  END: '结束记录',
  INVALIDATED: '任务失效',
  EXECUTION_EXCEPTION: '执行或记录异常',
  TRANSPORT_ERROR: '网络错误',
  ASSEMBLY_FAILED: '输入组装失败',
};

export function AiBattleObservationPanel({
  matchId,
  onClose,
}: {
  readonly matchId: string;
  readonly onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogAccessibility({ isOpen: true, dialogRef, initialFocusRef: closeRef, onEscape: onClose });
  const [listing, setListing] = useState<AiTraceListing | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AiTraceExport | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<{ id: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showWaitingRecords, setShowWaitingRecords] = useState(false);
  const [showMechanicalRecords, setShowMechanicalRecords] = useState(false);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const rows = listing?.decisions ?? [];
  const waitingCount = rows.filter((row) => isWaitingPurpose(row.purpose)).length;
  const mechanicalCount = rows.filter((row) => row.submissionSource === 'MECHANICAL').length;
  const displayRows = rows.filter((row) =>
    isRecordVisible(row, showWaitingRecords, showMechanicalRecords)
  );
  const hiddenCount = rows.length - displayRows.length;
  const selectedRow = rows.find((row) => row.id === selectedId);
  // A sampled history row may later receive its SUBMIT source during polling.
  // Evicted history stays selected so its existing unavailable-detail error remains visible.
  const visibleSelectedId =
    selectedRow && !isRecordVisible(selectedRow, showWaitingRecords, showMechanicalRecords)
      ? null
      : selectedId;
  const currentId = visibleSelectedId ?? displayRows.at(-1)?.id ?? null;

  const updateRecordVisibility = (showWaiting: boolean, showMechanical: boolean) => {
    setShowWaitingRecords(showWaiting);
    setShowMechanicalRecords(showMechanical);
    setSelectedId(
      selectedRow && !isRecordVisible(selectedRow, showWaiting, showMechanical)
        ? null
        : visibleSelectedId
    );
  };

  useEffect(() => {
    const controller = new AbortController();
    const scheduler = new SerialPollingScheduler({
      intervalMs: 1200,
      poll: async () => {
        try {
          const next = await fetchAiDecisions(matchId, controller.signal);
          if (!controller.signal.aborted) {
            setListing((old) =>
              old?.revision === next.revision &&
              JSON.stringify(old?.archive) === JSON.stringify(next.archive)
                ? old
                : next
            );
            setListError(null);
          }
        } catch (error) {
          if (!controller.signal.aborted) setListError(message(error));
        }
      },
    });
    scheduler.start();
    return () => {
      controller.abort();
      scheduler.dispose();
    };
  }, [matchId]);

  useEffect(() => {
    if (currentId === null) return;
    const controller = new AbortController();
    void fetchAiDecision(matchId, currentId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setDetail(value);
          setDetailError(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setDetail(null);
          setDetailError({ id: currentId, message: message(error) });
        }
      });
    return () => controller.abort();
  }, [matchId, currentId, listing?.revision]);

  const visibleDetail = detail?.decisions[0]?.id === currentId ? detail : null;
  const visibleError = detailError?.id === currentId ? detailError.message : null;
  const selected = visibleDetail?.decisions[0];
  const visibleRows = displayRows.filter(
    (row) =>
      !filter ||
      `${row.id} ${purposes[row.purpose] ?? row.purpose} ${statuses[row.status] ?? row.status}`.includes(
        filter
      )
  );
  const incomplete =
    listing &&
    listing.evictedDecisions +
      listing.omittedDecisions +
      listing.discardedLateUpdates +
      listing.captureFailures >
      0;
  const exportSession = async (archive = false) => {
    setIsExporting(true);
    setNotice(null);
    try {
      saveAs(
        archive ? await exportAiArchive(matchId) : await exportAiBattle(matchId),
        `loveca-ai-${matchId}.${archive ? 'jsonl' : 'json'}`
      );
    } catch (error) {
      setNotice(message(error));
    } finally {
      setIsExporting(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('已复制保留全文');
    } catch {
      setNotice('无法访问剪贴板，可选择原文复制或导出材料。');
    }
  };

  return createPortal(
    <div className="ai-observation-overlay">
      <div className="ai-observation-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-observation-title"
        tabIndex={-1}
        className="ai-observation-dialog"
      >
        <header className="ai-observation-header">
          <div>
            <div className="ai-heading-line">
              <h2 id="ai-observation-title">AI 决定观察</h2>
              {listing?.matchBilling && (
                <AiBillingCost billing={listing.matchBilling} label="本局" />
              )}
            </div>
            <p>历史 AI 视角 · 只读材料，当前真人牌桌继续运行</p>
          </div>
          <div className="ai-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => void exportSession()}
              disabled={isExporting}
            >
              <ArrowDownToLine size={15} />
              导出当前缓存
            </button>
            {listing?.archive && (
              <button
                type="button"
                className="button-secondary"
                disabled={isExporting}
                onClick={() => void exportSession(true)}
              >
                <ArrowDownToLine size={15} />
                {listing.archive.state === 'FAILED' ? '导出已有归档（不完整）' : '导出完整归档'}
              </button>
            )}
            <button
              ref={closeRef}
              type="button"
              className="button-icon"
              aria-label="关闭决定观察"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>
        {listError && (
          <p className="ai-error" role="alert">
            {listError}
          </p>
        )}
        {notice && (
          <p className="ai-notice" role="status">
            {notice}
          </p>
        )}
        {listing?.archive && (
          <p className="ai-notice" role="status">
            {listing.archive.state === 'FAILED'
              ? `本地归档已停止，记录不完整（${listing.archive.failure ? archiveFailures[listing.archive.failure] : '原因未知'}）；对局继续运行。`
              : listing.archive.state === 'ENDED'
                ? '本地归档已记录对局结束。'
                : '本地完整归档正在记录，内存淘汰不影响已归档内容。'}{' '}
            已写入 {(listing.archive.writtenBytes / 1024 / 1024).toFixed(1)} MiB， 上限{' '}
            {Math.round(listing.archive.maxBytes / 1024 / 1024)} MiB。
            {listing.archive.queuedBytes > 0 && ' 尚有待写入材料，导出时会等待写入。'}
          </p>
        )}
        {incomplete && (
          <p className="ai-notice">
            已淘汰 {listing.evictedDecisions} 项；未保存 {listing.omittedDecisions} 项；丢弃迟到更新{' '}
            {listing.discardedLateUpdates} 次；采集失败 {listing.captureFailures}{' '}
            次。“导出当前缓存”仅包含当前保留材料。
          </p>
        )}
        <div className="ai-observation-columns">
          <nav aria-label="AI 决定列表" className="ai-decision-list">
            <div className="ai-list-tools">
              <label>
                筛选决定
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="时点、状态或编号"
                />
              </label>
              <button
                type="button"
                className="button-ghost"
                onClick={() => {
                  setSelectedId(null);
                  setFilter('');
                }}
              >
                跟随最新
              </button>
            </div>
            <div className="ai-record-filters">
              <label className="ai-record-toggle">
                <input
                  type="checkbox"
                  checked={showWaitingRecords}
                  onChange={(event) =>
                    updateRecordVisibility(event.target.checked, showMechanicalRecords)
                  }
                />
                显示等待记录
                <span aria-hidden="true">（{waitingCount}）</span>
              </label>
              <label className="ai-record-toggle">
                <input
                  type="checkbox"
                  checked={showMechanicalRecords}
                  onChange={(event) =>
                    updateRecordVisibility(showWaitingRecords, event.target.checked)
                  }
                />
                显示机械处理记录
                <span aria-hidden="true">（{mechanicalCount}）</span>
              </label>
            </div>
            {!listing && !listError && <p className="ai-empty">正在读取决定…</p>}
            {listing && listing.decisions.length === 0 && (
              <p className="ai-empty">还没有保留的决定。等待 AI 获得操作时点。</p>
            )}
            {listing && listing.decisions.length > 0 && visibleRows.length === 0 && (
              <p className="ai-empty">
                {displayRows.length === 0
                  ? `已隐藏 ${hiddenCount} 条记录，可勾选上方选项查看。`
                  : '没有匹配的决定。'}
              </p>
            )}
            <ol>
              {visibleRows.map((row) => (
                <li key={row.id} className="ai-decision-with-cost">
                  <button
                    type="button"
                    className="ai-decision-row"
                    aria-current={currentId === row.id ? 'true' : undefined}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <span className="ai-decision-number">{row.id}</span>
                    <span className="ai-decision-label">
                      <strong>{purposes[row.purpose] ?? row.purpose}</strong>
                      <small>
                        {statuses[row.status] ?? row.status} · {formatTime(row.updatedAt)}
                      </small>
                    </span>
                  </button>
                  <AiBillingCost billing={row.decisionBilling} />
                </li>
              ))}
            </ol>
          </nav>
          <section
            className="ai-decision-detail"
            aria-label="所选决定详情"
            aria-busy={Boolean(currentId && !visibleDetail && !visibleError)}
          >
            {currentId === null && hiddenCount > 0 && (
              <p className="ai-empty">当前记录均已隐藏。可显示等待记录或机械处理记录查看详情。</p>
            )}
            {visibleError && (
              <p className="ai-error" role="alert">
                决定 {currentId}：{visibleError}。所选历史保持原位置，可返回最新决定。
              </p>
            )}
            {currentId && !visibleDetail && !visibleError && (
              <p className="ai-empty">正在读取决定 {currentId}…</p>
            )}
            {visibleDetail && selected && (
              <>
                <header className="ai-selected-heading">
                  <div>
                    <p>
                      {visibleSelectedId === null ? '跟随最新' : '已选历史'} · 决定 {selected.id}
                    </p>
                    <div className="ai-heading-line">
                      <h3>{purposes[selected.purpose] ?? selected.purpose}</h3>
                      <AiBillingCost billing={selected.decisionBilling} />
                    </div>
                    <small>
                      当时版本 {selected.revision} · {selected.seat === 'FIRST' ? '先手' : '后手'}{' '}
                      AI · {statuses[selected.status] ?? selected.status}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() =>
                      saveAs(
                        new Blob([JSON.stringify(visibleDetail, null, 2)], {
                          type: 'application/json',
                        }),
                        `loveca-ai-${matchId}-decision-${selected.id}.json`
                      )
                    }
                  >
                    导出本决定
                  </button>
                </header>
                <DecisionOutcome bundle={visibleDetail} />
                <CapturedView bundle={visibleDetail} />
                {(visibleDetail.incompleteMaterialIds.length > 0 || selected.omittedEvents > 0) && (
                  <p className="ai-error">
                    材料不完整：{visibleDetail.incompleteMaterialIds.length} 份缺失或裁剪，
                    {selected.omittedEvents} 个事件未保存。
                  </p>
                )}
                <label className="ai-material-search">
                  查找当前材料
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="在来源、请求和响应中查找"
                  />
                </label>
                <h4 className="ai-section-title">本局固定来源</h4>
                {selected.sourceMaterialIds
                  .map((id) => visibleDetail.materials.find((item) => item.id === id))
                  .filter((item): item is AiTraceMaterial => Boolean(item))
                  .filter((item) => matchesSearch(item, deferredSearch))
                  .map((item) => (
                    <Material key={item.id} item={item} onCopy={copy} />
                  ))}
                <h4 className="ai-section-title">本次采集与执行</h4>
                {selected.events
                  .map((event) => ({
                    event,
                    item: visibleDetail.materials.find((item) => item.id === event.materialId),
                  }))
                  .filter(({ item }) => item && matchesSearch(item, deferredSearch))
                  .map(({ event, item }) => (
                    <Material
                      key={event.materialId}
                      item={item!}
                      title={`${stages[event.stage] ?? event.stage} · ${formatTime(event.timestamp)}`}
                      stage={event.stage}
                      onCopy={copy}
                    />
                  ))}
              </>
            )}
          </section>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Material({
  item,
  title,
  stage,
  onCopy,
}: {
  readonly item: AiTraceMaterial;
  readonly title?: string;
  readonly stage?: string;
  readonly onCopy: (text: string) => Promise<void>;
}) {
  const captured = item.status === 'COMPLETE' ? parseRecord(item.content) : null;
  const body =
    stage === 'REQUEST' && typeof captured?.body === 'string'
      ? captured.body
      : stage === 'RESPONSE_BODY' && typeof captured?.rawBody === 'string'
        ? captured.rawBody
        : item.content;
  const request = stage === 'REQUEST' ? parseRecord(body) : null;
  const messages = Array.isArray(request?.messages) ? request.messages : [];
  return (
    <details className="ai-material">
      <summary>
        <span>{title ?? item.title}</span>
        <small>
          {item.status === 'COMPLETE'
            ? `${item.retainedBytes.toLocaleString()} B`
            : `${item.status === 'MISSING' ? '缺失' : '已裁剪'} · ${item.reason}`}
        </small>
      </summary>
      <div className="ai-material-meta">
        <span>
          {item.source} · 脱敏 {item.redactionCount} 处
        </span>
        {item.content !== null && (
          <button type="button" className="button-ghost" onClick={() => void onCopy(body!)}>
            <Copy size={13} />
            复制{item.status === 'COMPLETE' ? '正文全文' : '保留部分'}
          </button>
        )}
      </div>
      <p className="ai-material-hash">采集记录 SHA-256 {item.sha256}</p>
      {captured && body !== item.content && (
        <details>
          <summary>采集元数据与来源映射</summary>
          <pre tabIndex={0}>
            {JSON.stringify(
              Object.fromEntries(
                Object.entries(captured).filter(([key]) => key !== 'body' && key !== 'rawBody')
              ),
              null,
              2
            )}
          </pre>
        </details>
      )}
      {messages.length > 0 && (
        <ol className="ai-request-messages" aria-label="实际发送的消息，按请求顺序">
          {messages.map((value: unknown, index: number) => {
            const entry = record(value);
            return (
              <li key={index}>
                <h5>
                  {index + 1} · {String(entry?.role ?? '未知角色')}
                </h5>
                <pre tabIndex={0}>
                  {typeof entry?.content === 'string'
                    ? formatContent(entry.content)
                    : JSON.stringify(entry?.content, null, 2)}
                </pre>
              </li>
            );
          })}
        </ol>
      )}
      {item.content !== null ? (
        <>
          {messages.length > 0 && <h5>完整请求正文</h5>}
          <pre tabIndex={0}>{formatContent(body!)}</pre>
        </>
      ) : (
        <p className="ai-empty">此材料未保留正文。</p>
      )}
    </details>
  );
}

function parseRecord(content: string | null): Record<string, unknown> | null {
  if (content === null) return null;
  try {
    return record(JSON.parse(content));
  } catch {
    return null;
  }
}

function eventData(bundle: AiTraceExport, stage: string): Record<string, unknown> | null {
  const event = bundle.decisions[0]?.events.find((event) => event.stage === stage);
  const item = bundle.materials.find((item) => item.id === event?.materialId);
  if (!item || item.status !== 'COMPLETE' || item.content === null) return null;
  try {
    const value: unknown = JSON.parse(item.content);
    return record(value);
  } catch {
    return null;
  }
}
function DecisionOutcome({ bundle }: { readonly bundle: AiTraceExport }) {
  const failure = eventData(bundle, 'MODEL_FAILURE');
  const submitted = eventData(bundle, 'SUBMIT');
  const validation = eventData(bundle, 'MODEL_VALIDATION');
  const result = eventData(bundle, 'AUTHORITY_RESULT');
  const exception = eventData(bundle, 'EXECUTION_EXCEPTION');
  const selection = record(submitted?.selection);
  const command = record(submitted?.command);
  return (
    <div className="ai-outcome">
      <div>
        <span>模型选择</span>
        <strong>{failure ? '失败' : validation ? '校验通过' : '未产生有效选择'}</strong>
        {typeof validation?.tradeoff === 'string' && <p>模型自述：{validation.tradeoff}</p>}
      </div>
      <div>
        <span>提交来源</span>
        <strong>
          {selection?.source === 'FALLBACK'
            ? '规则兜底'
            : selection?.source === 'MECHANICAL'
              ? '机械处理'
              : selection?.source === 'MODEL'
                ? '模型选择'
                : '尚未提交'}
        </strong>
        <p>{typeof command?.type === 'string' ? command.type : '等待或未执行'}</p>
      </div>
      <div>
        <span>实际执行</span>
        <strong>
          {result?.success === true
            ? '执行成功'
            : result?.success === false
              ? '执行被拒绝'
              : exception
                ? '执行或记录异常，结果待核对'
                : submitted
                  ? '已提交，等待执行结果'
                  : '未执行'}
        </strong>
        {typeof result?.error === 'string' && <p>{result.error}</p>}
      </div>
      {failure && (
        <p className="ai-outcome-failure">
          {typeof failure.failure === 'string' ? failure.failure : '本次模型失败'} · 连续失败{' '}
          {String(failure.consecutiveFailures ?? '?')}
        </p>
      )}
    </div>
  );
}
function CapturedView({ bundle }: { readonly bundle: AiTraceExport }) {
  const sample = eventData(bundle, 'SAMPLE');
  const input = record(sample?.input);
  const state = record(input?.state);
  const table = record(state?.table);
  const zones = record(table?.zones);
  const objects = record(state?.objects);
  if (!state || !zones || !objects) return null;
  const seat = state.selfSeat === 'FIRST' ? 'FIRST' : 'SECOND';
  const titles: Readonly<Record<string, string>> = {
    HAND: '当时 AI 手牌',
    MEMBER_LEFT: '左侧成员',
    MEMBER_CENTER: '中央成员',
    MEMBER_RIGHT: '右侧成员',
    LIVE_ZONE: 'LIVE 区',
    ENERGY_ZONE: '能量区',
    SUCCESS_ZONE: '成功 LIVE',
  };
  return (
    <details className="ai-captured-view">
      <summary>当时 AI 局面 · 第 {String(state.turn)} 回合</summary>
      <p>仅展示该次采样可见的内容；当前真人牌桌保持原视角。</p>
      <div className="ai-view-zones">
        {Object.entries(titles).map(([suffix, title]) => {
          const zone = record(zones[`${seat}_${suffix}`]);
          if (!zone) return null;
          const slotMap = record(zone.slotMap);
          const ids = Array.isArray(zone.objectIds)
            ? zone.objectIds
            : slotMap
              ? Object.values(slotMap)
              : [];
          return (
            <section key={suffix}>
              <h5>
                {title} · {String(zone.count ?? 0)}
              </h5>
              <ul>
                {ids
                  .filter((id): id is string => typeof id === 'string')
                  .map((id) => {
                    const card = record(objects[id]);
                    const front = record(card?.frontInfo);
                    return front ? (
                      <li key={id}>
                        <strong>{String(front.nameCn ?? front.nameJp ?? front.cardCode)}</strong>
                        <span>
                          {front.cost !== undefined
                            ? `费用 ${String(front.cost)}`
                            : front.score !== undefined
                              ? `分数 ${String(front.score)}`
                              : ''}
                          {front.blade !== undefined ? ` · BLADE ${String(front.blade)}` : ''}
                          {card?.orientation === 'WAITING' ? ' · 待机' : ''}
                        </span>
                      </li>
                    ) : null;
                  })}
              </ul>
            </section>
          );
        })}
      </div>
    </details>
  );
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function message(error: unknown) {
  return error instanceof Error ? error.message : '读取 AI 调试材料失败';
}
function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}
function matchesSearch(item: AiTraceMaterial, search: string) {
  return !search || `${item.title}\n${item.content ?? ''}`.toLocaleLowerCase().includes(search);
}
function formatContent(content: string) {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}
