import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, Eye, Loader2, Play, RefreshCw, Square } from 'lucide-react';
import type { AiBattlePresetChoice, AiBattleSessionView } from '@game/online/ai-battle-types';
import type { OnlineMatchSnapshot, Seat } from '@game/online';
import { PageHeader, ConfirmDialog } from '@/components/common';
import { BattleViewportShell, GameBoard } from '@/components/game';
import { useGameStore } from '@/store/gameStore';
import {
  createAiBattle,
  endAiBattle,
  fetchAiBattlePresets,
  fetchAiBattleModels,
  fetchAiLocalOptions,
  fetchAiBattleSession,
  fetchAiBattleSessions,
  fetchAiBattleSnapshot,
} from '@/lib/aiBattleClient';
import { SerialPollingScheduler } from '@/lib/asyncRequestControl';
import { AiBattleObservationPanel } from './AiBattleObservationPanel';
import {
  API_AI_BATTLE_MODELS,
  API_MODEL_METADATA,
  DEFAULT_CODEX_AI_BATTLE_MODEL,
  isCodexAiBattleModel,
  type AiBattleModel,
  type CodexAiReasoningEffort,
} from '@game/online/ai-battle-model-registry';
import { AiBillingCost } from './AiBillingCost';
import './ai-battle.css';

const activityLabels = {
  THINKING: 'AI 请求中',
  WAITING: '等待操作时点',
  STOPPED: 'AI 已停止',
  ENDED: '对局已结束',
} as const;

export function AiBattleAdminPage({
  onBack,
  onImmersiveModeChange,
}: {
  readonly onBack: () => void;
  readonly onImmersiveModeChange?: (immersive: boolean) => void;
}) {
  const [presets, setPresets] = useState<readonly AiBattlePresetChoice[]>([]);
  const [sessions, setSessions] = useState<readonly AiBattleSessionView[]>([]);
  const [humanPresetId, setHumanPresetId] = useState('');
  const [aiPresetId, setAiPresetId] = useState('');
  const [handbookId, setHandbookId] = useState('');
  const [humanSeat, setHumanSeat] = useState<Seat>('FIRST');
  const [models, setModels] = useState<readonly AiBattleModel[]>(API_AI_BATTLE_MODELS);
  const [model, setModel] = useState<AiBattleModel>('qwen3.8-flash');
  const [reasoningEffort, setReasoningEffort] = useState<CodexAiReasoningEffort>('low');
  const [fastMode, setFastMode] = useState(false);
  const [archiveAvailable, setArchiveAvailable] = useState(false);
  const [archiveEnabled, setArchiveEnabled] = useState(false);
  const [enableThinking, setEnableThinking] = useState(false);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [observationId, setObservationId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = sessions.find((session) => session.endedAt === null);
  const selectedSession = sessions.find((session) => session.matchId === boardId);
  const humanPresets = presets.filter((preset) => preset.humanSelectable);
  const selectedHuman =
    humanPresets.find((preset) => preset.id === humanPresetId) ?? humanPresets[0];
  const selectedAi = presets.find((preset) => preset.id === aiPresetId) ?? presets[0];
  const selectedHandbook =
    selectedAi?.handbooks.find((book) => book.id === handbookId) ??
    selectedAi?.handbooks.find((book) => book.id === selectedAi.defaultHandbookId);
  const liveMatchId = useGameStore((state) => state.playerViewState?.match.matchId ?? null);
  const mounted = useRef(true);
  const requestGeneration = useRef(0);
  // Marks that the visible error came from board polling, so a later
  // successful poll can clear it without touching errors from user actions.
  const pollErrorActive = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (useGameStore.getState().remoteSession?.source === 'AI_DEBUG')
        useGameStore.getState().disconnectRemoteSession();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchAiBattlePresets(),
      fetchAiBattleSessions(),
      fetchAiBattleModels(),
      fetchAiLocalOptions(),
    ])
      .then(([catalog, list, availableModels, localOptions]) => {
        if (!cancelled) {
          setPresets(catalog);
          setArchiveAvailable(localOptions.archiveAvailable);
          setModels(availableModels);
          if (availableModels.includes(DEFAULT_CODEX_AI_BATTLE_MODEL))
            setModel(DEFAULT_CODEX_AI_BATTLE_MODEL);
          setSessions(list);
          setIsLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(message(cause));
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!boardId) return;
    let cancelled = false;
    const scheduler = new SerialPollingScheduler({
      intervalMs: 700,
      poll: async () => {
        try {
          const session = await fetchAiBattleSession(boardId);
          if (cancelled) return;
          if (pollErrorActive.current) {
            pollErrorActive.current = false;
            setError(null);
          }
          setSessions((current) =>
            current.map((entry) => (entry.matchId === boardId ? session : entry))
          );
          // Normal snapshot sync is independent of the observation dialog and its selected history.
          if (useGameStore.getState().remoteSession?.matchId === boardId)
            await useGameStore.getState().syncRemoteState();
        } catch (cause) {
          if (!cancelled) {
            pollErrorActive.current = true;
            setError(message(cause));
          }
        }
      },
    });
    scheduler.start();
    return () => {
      cancelled = true;
      scheduler.dispose();
    };
  }, [boardId]);

  useLayoutEffect(() => {
    onImmersiveModeChange?.(boardId !== null);
    return () => onImmersiveModeChange?.(false);
  }, [boardId, onImmersiveModeChange]);

  const attach = async (
    session: AiBattleSessionView,
    snapshot: OnlineMatchSnapshot,
    generation: number
  ) => {
    if (!mounted.current || requestGeneration.current !== generation) return;
    useGameStore.getState().connectRemoteSession({
      source: 'AI_DEBUG',
      matchId: snapshot.matchId,
      seat: snapshot.seat,
      playerId: snapshot.playerId,
    });
    await useGameStore.getState().applyRemoteSnapshot(snapshot);
    if (!mounted.current || requestGeneration.current !== generation) return;
    setSessions((current) => [
      session,
      ...current.filter((entry) => entry.matchId !== session.matchId),
    ]);
    setBoardId(session.matchId);
  };
  const create = async () => {
    if (!selectedHuman || !selectedAi || !selectedHandbook) return;
    const generation = ++requestGeneration.current;
    setIsBusy(true);
    setError(null);
    try {
      const result = await createAiBattle({
        humanPresetId: selectedHuman.id,
        aiPresetId: selectedAi.id,
        handbookId: selectedHandbook.id,
        humanSeat,
        model,
        ...(archiveAvailable ? { archiveEnabled } : {}),
        ...(isCodexAiBattleModel(model) ? { reasoningEffort, fastMode } : {}),
        enableThinking: isCodexAiBattleModel(model) ? false : enableThinking,
      });
      await attach(result.session, result.snapshot, generation);
    } catch (cause) {
      if (mounted.current) {
        pollErrorActive.current = false;
        setError(message(cause));
      }
    } finally {
      if (mounted.current) setIsBusy(false);
    }
  };
  const resume = async (session: AiBattleSessionView) => {
    const generation = ++requestGeneration.current;
    setIsBusy(true);
    setError(null);
    try {
      const snapshot = await fetchAiBattleSnapshot(session.matchId);
      if ('modified' in snapshot) throw new Error('未取得完整桌面快照，请重试');
      await attach(session, snapshot, generation);
    } catch (cause) {
      if (mounted.current) {
        pollErrorActive.current = false;
        setError(message(cause));
      }
    } finally {
      if (mounted.current) setIsBusy(false);
    }
  };
  const refresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [catalog, list] = await Promise.all([
        fetchAiBattlePresets(),
        fetchAiBattleSessions(),
        fetchAiBattleModels(),
      ]);
      if (mounted.current) {
        setPresets(catalog);
        setSessions(list);
      }
    } catch (cause) {
      if (mounted.current) {
        pollErrorActive.current = false;
        setError(message(cause));
      }
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  };
  const returnToSessions = () => {
    requestGeneration.current++;
    if (useGameStore.getState().remoteSession?.source === 'AI_DEBUG')
      useGameStore.getState().disconnectRemoteSession();
    setBoardId(null);
    setError(null);
    void refresh();
  };
  const finish = async () => {
    if (!endingId) return;
    setIsEnding(true);
    setError(null);
    try {
      const ended = await endAiBattle(endingId);
      if (!mounted.current) return;
      setSessions((current) =>
        current.map((entry) => (entry.matchId === ended.matchId ? ended : entry))
      );
      if (boardId === ended.matchId) {
        useGameStore.getState().disconnectRemoteSession();
        setBoardId(null);
      }
      setEndingId(null);
    } catch (cause) {
      if (mounted.current) {
        pollErrorActive.current = false;
        setError(message(cause));
        setEndingId(null);
      }
    } finally {
      if (mounted.current) setIsEnding(false);
    }
  };

  const dialogs = (
    <>
      {observationId && (
        <AiBattleObservationPanel
          key={observationId}
          matchId={observationId}
          onClose={() => setObservationId(null)}
        />
      )}
      <ConfirmDialog
        isOpen={endingId !== null}
        title="结束调试对局"
        message="结束当前对局并停止 AI。已保留的决定材料仍可在一小时内查看和导出。"
        confirmLabel="结束调试对局"
        isConfirming={isEnding}
        onCancel={() => setEndingId(null)}
        onConfirm={() => void finish()}
      />
    </>
  );
  if (boardId)
    return (
      <BattleViewportShell className="flex flex-col">
        <header className="ai-battle-toolbar">
          <button
            type="button"
            className="button-ghost"
            aria-label="返回 AI 会话列表，保留对局"
            onClick={returnToSessions}
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">会话</span>
          </button>
          <div className="ai-battle-identity">
            <Bot size={17} />
            <div>
              <strong>AI 调试 · 真人视角</strong>
              <div className="ai-heading-line">
                <small role="status">
                  {selectedSession ? activityLabels[selectedSession.activity] : '同步中'}
                </small>
                {selectedSession && (
                  <AiBillingCost
                    billing={selectedSession.matchBilling}
                    codexBudget={selectedSession.codexBudget}
                    label="本局"
                  />
                )}
              </div>
            </div>
          </div>
          <div className="ai-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={() => setObservationId(boardId)}
            >
              <Eye size={15} />
              观察
            </button>
            <button type="button" className="button-secondary" onClick={() => setEndingId(boardId)}>
              <Square size={13} />
              结束
            </button>
          </div>
        </header>
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
        {selectedSession?.stoppedReason && (
          <p className="ai-error" role="status">
            自动推进已停止：{selectedSession.stoppedReason} · 连续失败{' '}
            {selectedSession.consecutiveFailures} 次。可查看决定材料并结束本局。
          </p>
        )}
        <div className="min-h-0 flex-1 relative">
          {liveMatchId === boardId ? <GameBoard /> : <p className="ai-empty">正在连接真人牌桌…</p>}
        </div>
        {dialogs}
      </BattleViewportShell>
    );

  return (
    <div className="app-shell min-h-screen">
      <PageHeader
        title="AI 对战调试"
        description="选择构筑、模型与先后手，与 AI 开始对战"
        onBack={onBack}
        backLabel="返回运营管理中心"
      />
      <main className="product-page-main ai-battle-page">
        {error && (
          <p className="ai-error" role="alert">
            {error}
          </p>
        )}
        <div className="ai-setup-layout">
          <form
            className="product-workbench ai-create-form"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <header>
              <p className="ai-eyebrow">RULES · 管理员调试</p>
              <h2>建立一场对局</h2>
              <p>真人与 AI 各控制一席。先完成规则操作，再对照决定材料复盘。</p>
            </header>
            <fieldset disabled={isBusy || isLoading || Boolean(active)}>
              <legend className="sr-only">模型、构筑与先后手</legend>
              <label>
                AI 模型
                <select
                  value={model}
                  onChange={(event) => setModel(event.target.value as AiBattleModel)}
                >
                  {models.map((id) => (
                    <option key={id} value={id}>
                      {isCodexAiBattleModel(id) ? `${id.slice(6)} · ChatGPT 订阅（本地）` : id}
                    </option>
                  ))}
                </select>
              </label>
              {isCodexAiBattleModel(model) && (
                <label>
                  思考强度
                  <select
                    value={reasoningEffort}
                    onChange={(event) =>
                      setReasoningEffort(event.target.value as CodexAiReasoningEffort)
                    }
                  >
                    <option value="low">轻度（low）</option>
                    <option value="medium">中等（medium）</option>
                  </select>
                  <small>仅用于新建的本地 Codex 对局；轻度不减少发送的上下文。</small>
                </label>
              )}
              {isCodexAiBattleModel(model) && (
                <div>
                  <label className="ai-thinking-choice">
                    <input
                      type="checkbox"
                      checked={fastMode}
                      onChange={(event) => setFastMode(event.target.checked)}
                      aria-describedby="ai-fast-help"
                    />
                    快速模式（本地 GPT）
                  </label>
                  <small id="ai-fast-help">
                    仅本局生效，默认关闭；开启后按标准模式 2.5 倍 credits
                    消耗，实际加速取决于服务可用性，不改变思考强度。
                  </small>
                </div>
              )}
              {!isCodexAiBattleModel(model) && (
                <>
                  {API_MODEL_METADATA[model].peakPriceOnly && (
                    <small>费用按北京忙时价预估，闲时实际费用可能更低。</small>
                  )}
                  <div>
                    <label className="ai-thinking-choice">
                      <input
                        type="checkbox"
                        checked={enableThinking}
                        onChange={(event) => setEnableThinking(event.target.checked)}
                        aria-describedby="ai-thinking-help"
                      />
                      开启思考
                    </label>
                    <small id="ai-thinking-help">
                      让模型先思考再作出选择，可能增加等待时间和费用。本局创建后固定。
                    </small>
                  </div>
                </>
              )}
              {archiveAvailable && (
                <div>
                  <label className="ai-thinking-choice">
                    <input
                      type="checkbox"
                      checked={archiveEnabled}
                      onChange={(event) => setArchiveEnabled(event.target.checked)}
                      aria-describedby="ai-archive-help"
                    />
                    完整归档到本机
                  </label>
                  <small id="ai-archive-help">
                    保存本局 AI 视角、模型请求与执行记录，方便完整复盘；不额外调用模型。
                    仅对新局生效，文件保留在本机，需自行清理。
                  </small>
                </div>
              )}
              <div className="ai-deck-pair">
                <label>
                  真人构筑
                  <select
                    value={selectedHuman?.id ?? ''}
                    onChange={(event) => setHumanPresetId(event.target.value)}
                  >
                    {humanPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  AI 构筑
                  <select
                    value={selectedAi?.id ?? ''}
                    onChange={(event) => {
                      setAiPresetId(event.target.value);
                      setHandbookId('');
                    }}
                  >
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                AI 对局手册
                <select
                  value={selectedHandbook?.id ?? ''}
                  onChange={(event) => setHandbookId(event.target.value)}
                >
                  {selectedAi?.handbooks.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="ai-seat-choice">
                <legend>真人先后手</legend>
                {(['FIRST', 'SECOND'] as const).map((seat) => (
                  <label key={seat}>
                    <input
                      type="radio"
                      name="human-seat"
                      value={seat}
                      checked={humanSeat === seat}
                      onChange={() => setHumanSeat(seat)}
                    />
                    {seat === 'FIRST' ? '真人先手' : '真人后手'}
                  </label>
                ))}
              </fieldset>
            </fieldset>
            <footer>
              <button
                type="submit"
                className="button-primary"
                disabled={isBusy || isLoading || Boolean(active) || !selectedHandbook}
              >
                {isBusy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                创建调试对局
              </button>
              <p>
                {active
                  ? '已有进行中的对局。请继续或结束该局。'
                  : '构筑与手册在创建时固定；观察材料仅用于调试复盘。'}
              </p>
            </footer>
          </form>
          <aside className="ai-setup-note">
            <Bot size={28} />
            <h2>看见一次决定的来由</h2>
            <p>
              在共享牌桌完成换牌、登场、效果和 LIVE。观察面板将当时的 AI
              局面、候选、真实请求、响应与执行结果放在同一条记录里。
            </p>
            <p>查看历史不会操作牌桌。比较公平对战时，等对局结束后再打开观察材料。</p>
          </aside>
        </div>
        <section className="product-workbench ai-session-section">
          <header>
            <div>
              <h2>我的调试会话</h2>
              <p>结束后保留一小时；服务器重启后观测材料失效。</p>
            </div>
            <button
              type="button"
              className="button-ghost"
              disabled={isLoading || isBusy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} />
              刷新
            </button>
          </header>
          {isLoading && <p className="ai-empty">正在读取会话…</p>}
          {!isLoading && sessions.length === 0 && (
            <p className="ai-empty">还没有调试会话。从上方选择构筑开始。</p>
          )}
          <ul>
            {sessions.map((session) => (
              <li key={session.matchId}>
                <div>
                  <div className="ai-heading-line">
                    <strong>
                      {new Date(session.startedAt).toLocaleString('zh-CN', { hour12: false })}
                    </strong>
                    <AiBillingCost
                      billing={session.matchBilling}
                      codexBudget={session.codexBudget}
                      label="本局"
                    />
                  </div>
                  <p>
                    {session.humanSeat === 'FIRST' ? '真人先手' : '真人后手'} ·{' '}
                    {activityLabels[session.activity]} · 连续失败 {session.consecutiveFailures}
                  </p>
                  <small>
                    {session.handbookId} · {session.model} ·{' '}
                    {isCodexAiBattleModel(session.model)
                      ? session.reasoningEffort === 'medium'
                        ? '中等'
                        : '轻度'
                      : session.enableThinking
                        ? '思考开启'
                        : '思考关闭'}
                    {isCodexAiBattleModel(session.model) &&
                      (session.fastMode ? ' · 快速模式' : ' · 标准速度')}
                  </small>
                </div>
                <div className="ai-actions">
                  {session.endedAt === null && (
                    <button
                      type="button"
                      className="button-primary"
                      disabled={isBusy}
                      onClick={() => void resume(session)}
                    >
                      继续对局
                    </button>
                  )}
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => setObservationId(session.matchId)}
                  >
                    观察材料
                  </button>
                  {session.endedAt === null && (
                    <button
                      type="button"
                      className="button-ghost"
                      disabled={isBusy}
                      onClick={() => setEndingId(session.matchId)}
                    >
                      结束
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
      {dialogs}
    </div>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'AI 对战请求失败，请重试';
}
