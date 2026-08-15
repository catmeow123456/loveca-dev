import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CirclePause, Layers3, Loader2, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { AdminPageHeader } from './AdminPageHeader';
import { AdminViewTabs } from './AdminViewTabs';
import { SeasonOpenWindowsFields } from './SeasonOpenWindowsFields';
import { useDeckStore } from '@/store/deckStore';
import {
  addThemeAdminDeck,
  createThemeAdminDraft,
  fetchThemeAdminEvents,
  runThemeAdminLifecycleAction,
  setThemeAdminMatchupEnabled,
  updateThemeAdminDraft,
  type ThemeAdminDraftPayload,
  type ThemeAdminEventView,
} from '@/lib/themeTableAdminClient';
import {
  getRankedOpenWindowsValidationError,
  isCrossMidnightRankedOpenWindow,
  prepareRankedOpenWindowsForApi,
  prepareRankedOpenWindowsForForm,
  type EditableRankedOpenWindow,
} from '@/lib/rankedOpenWindows';
import './theme-table-admin.css';

type Tab = 'overview' | 'seasons';
type EditorMode = 'closed' | 'create' | 'edit';

const TABS = [
  { value: 'overview', label: '概览' },
  { value: 'seasons', label: '主题赛季' },
] as const;

export function ThemeTableAdminPage({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [events, setEvents] = useState<ThemeAdminEventView[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('closed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cloudDecks = useDeckStore((state) => state.cloudDecks);
  const fetchCloudDecks = useDeckStore((state) => state.fetchCloudDecks);

  const selected = useMemo(
    () => events.find((event) => event.id === selectedId) ?? events[0] ?? null,
    [events, selectedId]
  );

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextEvents] = await Promise.all([fetchThemeAdminEvents(), fetchCloudDecks()]);
      setEvents(nextEvents);
      if (nextEvents.length === 0) setTab('seasons');
      setSelectedId((current) =>
        nextEvents.some((event) => event.id === current) ? current : (nextEvents[0]?.id ?? '')
      );
    } catch (loadError) {
      setError(readError(loadError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // Initial load owns the aggregate season and deck request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      await load();
      return true;
    } catch (operationError) {
      setError(readError(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const selectSeason = (id: string) => {
    setSelectedId(id);
    setEditorMode('closed');
  };

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <AdminPageHeader
        title="主题赛季管理"
        category="对局与赛季"
        onBack={onBack}
        actions={
          <button className="button-icon" onClick={() => void load()} aria-label="刷新">
            <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
          </button>
        }
      />

      <main className="product-page-main flex-1">
        <div className="mx-auto w-full max-w-5xl">
          <AdminViewTabs label="主题赛季管理视图" value={tab} tabs={TABS} onChange={setTab} />

          {error ? (
            <p className="mb-4 rounded-xl bg-[var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]">
              {error}
            </p>
          ) : null}

          {tab === 'overview' ? (
            <OverviewPanel events={events} selected={selected} onSelect={selectSeason} />
          ) : (
            <SeasonPanel
              events={events}
              selected={selected}
              cloudDecks={cloudDecks}
              editorMode={editorMode}
              busy={busy}
              onSelect={selectSeason}
              onOpenCreate={() => {
                setSelectedId('');
                setEditorMode('create');
              }}
              onOpenEdit={(event) => {
                setSelectedId(event.id);
                setEditorMode('edit');
              }}
              onCloseEditor={() => setEditorMode('closed')}
              onSubmitDraft={(event, payload) =>
                run(() =>
                  event ? updateThemeAdminDraft(event.id, payload) : createThemeAdminDraft(payload)
                ).then((completed) => {
                  if (completed) setEditorMode('closed');
                })
              }
              onLifecycle={(event, action) =>
                run(() => runThemeAdminLifecycleAction(event.id, action))
              }
              onRun={run}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function OverviewPanel({
  events,
  selected,
  onSelect,
}: {
  events: ThemeAdminEventView[];
  selected: ThemeAdminEventView | null;
  onSelect: (id: string) => void;
}) {
  if (events.length === 0 || !selected) {
    return (
      <div className="product-workbench grid min-h-72 place-items-center p-8 text-center">
        <div>
          <Layers3 className="mx-auto mb-3 text-[var(--text-muted)]" size={28} />
          <p className="text-sm text-[var(--text-muted)]">还没有主题赛季</p>
        </div>
      </div>
    );
  }

  const metrics = selected.metrics;
  const startRate = metrics.assignmentCount
    ? metrics.startedMatchCount / metrics.assignmentCount
    : null;
  return (
    <div className="space-y-4">
      <section className="product-workbench p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Field label="查看主题赛季">
            <select
              className="input-field min-w-64"
              value={selected.id}
              onChange={(event) => onSelect(event.target.value)}
            >
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="text-right text-xs text-[var(--text-muted)]">
            <StatusPill lifecycle={selected.lifecycle} />
            <div className="mt-2">{selected.scheduleLabel}</div>
          </div>
        </div>
      </section>

      <section className="product-workbench p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-[var(--text-primary)]">{selected.name}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
              {selected.summary}
            </p>
          </div>
          <div className="text-right text-xs text-[var(--text-muted)]">
            <div>{formatDate(selected.startsAt)} 开始</div>
            <div className="mt-1">{formatDate(selected.endsAt)} 结束</div>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <OverviewMetric label="加入候场" value={String(metrics.joinedTicketCount)} />
          <OverviewMetric label="已开始对局" value={String(metrics.startedMatchCount)} />
          <OverviewMetric label="已完成对局" value={String(metrics.completedMatchCount)} />
          <OverviewMetric
            label="分配后开局率"
            value={startRate === null ? '—' : formatPercent(startRate)}
          />
        </div>
      </section>

      <section className="product-workbench p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-[var(--text-primary)]">本期卡组池</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              玩家不选卡组，系统从池内组合中为双方分配。
            </p>
          </div>
          <span className="text-sm text-[var(--text-secondary)]">
            {selected.decks.length} 副卡组 · {enabledMatchupCount(selected)} 个可分配组合
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {selected.decks.map((deck) => (
            <span
              key={deck.id}
              className="rounded-lg bg-[var(--bg-overlay)] px-3 py-2 text-sm text-[var(--text-secondary)]"
            >
              {deck.displayName}
            </span>
          ))}
          {selected.decks.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">尚未加入卡组</p>
          ) : null}
        </div>
        {metrics.deckExposure.length > 0 ? (
          <details className="mt-4 border-t border-[var(--border-subtle)] pt-3">
            <summary className="cursor-pointer text-sm font-medium text-[var(--text-secondary)]">
              查看卡组分配情况
            </summary>
            <div className="theme-exposure-list mt-3">
              {metrics.deckExposure.map((item) => (
                <div key={item.deckVersionId}>
                  <span>{item.displayName}</span>
                  <strong>{formatPercent(item.actualShare)}</strong>
                  <small>目标 {formatPercent(item.expectedShare)}</small>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function SeasonPanel({
  events,
  selected,
  cloudDecks,
  editorMode,
  busy,
  onSelect,
  onOpenCreate,
  onOpenEdit,
  onCloseEditor,
  onSubmitDraft,
  onLifecycle,
  onRun,
}: {
  events: ThemeAdminEventView[];
  selected: ThemeAdminEventView | null;
  cloudDecks: ReturnType<typeof useDeckStore.getState>['cloudDecks'];
  editorMode: EditorMode;
  busy: boolean;
  onSelect: (id: string) => void;
  onOpenCreate: () => void;
  onOpenEdit: (event: ThemeAdminEventView) => void;
  onCloseEditor: () => void;
  onSubmitDraft: (
    event: ThemeAdminEventView | null,
    payload: ThemeAdminDraftPayload
  ) => Promise<unknown>;
  onLifecycle: (
    event: ThemeAdminEventView,
    action: 'activate' | 'pause' | 'resume' | 'close'
  ) => Promise<unknown>;
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [managedSeasonId, setManagedSeasonId] = useState<string | null>(null);
  const editingEvent = editorMode === 'edit' ? selected : null;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="button-secondary px-4 py-2 text-sm" onClick={onOpenCreate}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={15} /> 新建主题赛季
          </span>
        </button>
      </div>

      {editorMode !== 'closed' ? (
        <ThemeSeasonForm
          key={`${editorMode}:${editingEvent?.id ?? 'new'}`}
          event={editingEvent}
          busy={busy}
          onCancel={onCloseEditor}
          onSubmit={(payload) => onSubmitDraft(editingEvent, payload)}
        />
      ) : null}

      {events.length > 0 ? (
        <div className="product-workbench">
          {events.map((event) => {
            const expanded = managedSeasonId === event.id && editorMode === 'closed';
            return (
              <section key={event.id} className="product-list-row p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-[var(--text-primary)]">{event.name}</h2>
                      <StatusPill lifecycle={event.lifecycle} />
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      {event.scheduleLabel} · {event.decks.length} 副卡组
                    </p>
                  </div>
                  <SeasonActions
                    event={event}
                    busy={busy}
                    expanded={expanded}
                    onManage={() => {
                      onSelect(event.id);
                      setManagedSeasonId(expanded ? null : event.id);
                    }}
                    onEdit={() => onOpenEdit(event)}
                    onLifecycle={onLifecycle}
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-muted)]">
                  <span>{formatOpenWindows(event.openWindows)}</span>
                  <span>结束：{formatDate(event.endsAt)}</span>
                  <span>{enabledMatchupCount(event)} 个可分配组合</span>
                </div>
                {expanded ? (
                  <DeckPoolPanel event={event} cloudDecks={cloudDecks} busy={busy} onRun={onRun} />
                ) : null}
              </section>
            );
          })}
        </div>
      ) : editorMode === 'closed' ? (
        <div className="product-workbench p-8 text-center text-sm text-[var(--text-muted)]">
          还没有主题赛季
        </div>
      ) : null}
    </div>
  );
}

function SeasonActions({
  event,
  busy,
  expanded,
  onManage,
  onEdit,
  onLifecycle,
}: {
  event: ThemeAdminEventView;
  busy: boolean;
  expanded: boolean;
  onManage: () => void;
  onEdit: () => void;
  onLifecycle: (
    event: ThemeAdminEventView,
    action: 'activate' | 'pause' | 'resume' | 'close'
  ) => Promise<unknown>;
}) {
  const runAction = (action: 'activate' | 'pause' | 'resume' | 'close') => {
    const warning =
      action === 'activate'
        ? '开始后赛季信息和卡组池将冻结，确定开始主题赛季吗？'
        : action === 'close'
          ? '结束后不能恢复，确定结束本期主题赛季吗？'
          : null;
    if (warning && !window.confirm(warning)) return;
    void onLifecycle(event, action);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button className="button-secondary px-3 py-2 text-sm" onClick={onManage}>
        {expanded ? '收起卡组池' : '管理卡组池'}
      </button>
      {event.lifecycle === 'DRAFT' ? (
        <>
          <button className="button-secondary px-3 py-2 text-sm" disabled={busy} onClick={onEdit}>
            编辑赛季
          </button>
          <button
            className="button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
            disabled={busy || event.decks.length < 2 || enabledMatchupCount(event) === 0}
            onClick={() => runAction('activate')}
          >
            <ShieldCheck size={15} /> 开始赛季
          </button>
        </>
      ) : null}
      {event.lifecycle === 'ACTIVE' ? (
        <button
          className="button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
          disabled={busy}
          onClick={() => runAction('pause')}
        >
          <CirclePause size={15} /> 暂停匹配
        </button>
      ) : null}
      {event.lifecycle === 'PAUSED' ? (
        <button
          className="button-primary px-3 py-2 text-sm"
          disabled={busy || enabledMatchupCount(event) === 0}
          onClick={() => runAction('resume')}
        >
          继续匹配
        </button>
      ) : null}
      {event.lifecycle === 'ACTIVE' || event.lifecycle === 'PAUSED' ? (
        <button className="theme-danger-button" disabled={busy} onClick={() => runAction('close')}>
          结束赛季
        </button>
      ) : null}
    </div>
  );
}

function DeckPoolPanel({
  event,
  cloudDecks,
  busy,
  onRun,
}: {
  event: ThemeAdminEventView;
  cloudDecks: ReturnType<typeof useDeckStore.getState>['cloudDecks'];
  busy: boolean;
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  const poolReady = event.decks.length >= 2 && enabledMatchupCount(event) > 0;
  return (
    <div className="mt-4 rounded-xl bg-[var(--bg-overlay)] p-4">
      <div className="theme-season-readiness">
        <div>
          <span>主题赛季</span>
          <strong>信息已保存</strong>
        </div>
        <div data-ready={poolReady}>
          <span>卡组池</span>
          <strong>
            {poolReady ? '可以开始赛季' : `还需加入 ${Math.max(0, 2 - event.decks.length)} 副`}
          </strong>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">平台分配卡组池</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
            加入卡组后，系统自动生成与池内其他卡组的等权组合。
          </p>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{event.decks.length} 副</span>
      </div>

      {event.lifecycle === 'DRAFT' ? (
        <DeckPoolAddForm event={event} cloudDecks={cloudDecks} busy={busy} onRun={onRun} />
      ) : null}

      <div className="theme-deck-pool-grid mt-3">
        {event.decks.map((deck) => (
          <div key={deck.id}>
            <strong>{deck.displayName}</strong>
            <span>
              主卡组 {sumDeck(deck.mainDeck)} · 能量 {sumDeck(deck.energyDeck)}
            </span>
          </div>
        ))}
        {event.decks.length === 0 ? (
          <p className="py-4 text-sm text-[var(--text-muted)]">从一副合法云端卡组开始。</p>
        ) : null}
      </div>

      {event.matchups.length > 0 ? (
        <details className="mt-4 border-t border-[var(--border-subtle)] pt-3">
          <summary className="cursor-pointer text-sm text-[var(--text-secondary)]">
            组合异常处理（{event.matchups.filter((matchup) => !matchup.enabled).length} 个已停用）
          </summary>
          <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
            这里只用于临时停用有问题的卡组组合。正常编排不需要逐组设置权重。
          </p>
          <div className="mt-3 space-y-2">
            {event.matchups.map((matchup) => (
              <div
                key={matchup.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--bg-surface)] px-3 py-2"
              >
                <span className="text-sm text-[var(--text-secondary)]">
                  {matchup.firstDeckName} × {matchup.secondDeckName}
                </span>
                <button
                  className="button-secondary px-3 py-1.5 text-xs"
                  disabled={
                    busy ||
                    (!matchup.enabled && event.lifecycle !== 'DRAFT') ||
                    event.lifecycle === 'CLOSED'
                  }
                  onClick={() =>
                    void onRun(() =>
                      setThemeAdminMatchupEnabled(event.id, matchup.id, !matchup.enabled)
                    )
                  }
                >
                  {matchup.enabled ? '停用' : '重新启用'}
                </button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function DeckPoolAddForm({
  event,
  cloudDecks,
  busy,
  onRun,
}: {
  event: ThemeAdminEventView;
  cloudDecks: ReturnType<typeof useDeckStore.getState>['cloudDecks'];
  busy: boolean;
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  const validDecks = cloudDecks.filter((deck) => deck.is_valid);
  const [sourceDeckId, setSourceDeckId] = useState(validDecks[0]?.id ?? '');
  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const deck = validDecks.find((candidate) => candidate.id === sourceDeckId);
    if (!deck) return;
    void onRun(() =>
      addThemeAdminDeck(event.id, {
        sourceDeckId,
        deckKey: nextDeckKey(event),
        displayName: deck.name,
        playStyleTags: ['平台预组'],
        difficulty: 'INTERMEDIATE',
        sourceLabel: '主题赛季卡组池',
        sourceUrl: null,
        reviewNote: '加入主题赛季卡组池时审核',
      })
    );
  };
  return (
    <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
      <select
        className="input-field min-w-0 flex-1"
        value={sourceDeckId}
        aria-label="选择云端卡组"
        onChange={(event) => setSourceDeckId(event.target.value)}
        required
      >
        <option value="">选择一副合法云端卡组</option>
        {validDecks.map((deck) => (
          <option key={deck.id} value={deck.id}>
            {deck.name}
          </option>
        ))}
      </select>
      <button className="button-primary min-h-11 px-4 text-sm" disabled={busy || !sourceDeckId}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : '加入卡组池'}
      </button>
    </form>
  );
}

function ThemeSeasonForm({
  event,
  busy,
  onCancel,
  onSubmit,
}: {
  event: ThemeAdminEventView | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (payload: ThemeAdminDraftPayload) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(() => seasonDraftFromEvent(event));
  const openWindowsError = getRankedOpenWindowsValidationError(draft.openWindows);
  return (
    <form
      className="product-workbench grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        if (openWindowsError) return;
        const description = draft.description.trim();
        void onSubmit({
          versionKey: draft.versionKey,
          name: draft.name,
          platformTimeZone: event?.platformTimeZone ?? 'Asia/Shanghai',
          startsAt: new Date(draft.startsAt).toISOString(),
          endsAt: new Date(draft.endsAt).toISOString(),
          openWindows: prepareRankedOpenWindowsForApi(draft.openWindows),
          scheduleLabel: formatOpenWindows(draft.openWindows),
          summary: description,
          announcement: `本主题季不计入排位，双方将从本期卡组池获得平台分配的预组。\n\n${description}`,
          evaluationPolicy: event?.evaluationPolicy ?? defaultEvaluationPolicy(),
        });
      }}
    >
      <div className="sm:col-span-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          {event ? '编辑主题赛季' : '新建主题赛季'}
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          与排位赛季使用相同的时间框架；保存后只需加入卡组池。
        </p>
      </div>
      <Field label="赛季名称">
        <input
          className="input-field"
          value={draft.name}
          placeholder="例如：夏日组合主题季"
          onChange={(changeEvent) => setDraft({ ...draft, name: changeEvent.target.value })}
          required
        />
      </Field>
      <div className="hidden sm:block" aria-hidden="true" />
      <Field label="开始">
        <input
          className="input-field"
          type="datetime-local"
          value={draft.startsAt}
          onChange={(changeEvent) => setDraft({ ...draft, startsAt: changeEvent.target.value })}
          required
        />
      </Field>
      <Field label="结束">
        <input
          className="input-field"
          type="datetime-local"
          value={draft.endsAt}
          onChange={(changeEvent) => setDraft({ ...draft, endsAt: changeEvent.target.value })}
          required
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label="玩家说明">
          <textarea
            className="input-field min-h-24 resize-y"
            value={draft.description}
            placeholder="说明本期主题、适合体验的玩法和注意事项"
            onChange={(changeEvent) =>
              setDraft({ ...draft, description: changeEvent.target.value })
            }
            required
          />
        </Field>
      </div>
      <SeasonOpenWindowsFields
        openWindows={draft.openWindows}
        onChange={(openWindows) => setDraft({ ...draft, openWindows })}
      />
      <div className="flex items-end justify-end gap-2 sm:col-span-2">
        <button type="button" className="button-secondary min-h-11 px-4" onClick={onCancel}>
          取消
        </button>
        <button
          className="button-primary min-h-11 px-5"
          disabled={busy || Boolean(openWindowsError)}
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : event ? '保存' : '创建赛季'}
        </button>
      </div>
    </form>
  );
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg-overlay)] p-3">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <strong className="mt-1 block text-xl font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </strong>
    </div>
  );
}

function StatusPill({ lifecycle }: { lifecycle: ThemeAdminEventView['lifecycle'] }) {
  return (
    <span className="status-pill" data-status={lifecycle.toLowerCase()}>
      {lifecycleLabel(lifecycle)}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm text-[var(--text-secondary)]">
      {label}
      {children}
    </label>
  );
}

function seasonDraftFromEvent(event: ThemeAdminEventView | null): {
  versionKey: string;
  name: string;
  startsAt: string;
  endsAt: string;
  description: string;
  openWindows: EditableRankedOpenWindow[];
} {
  const now = new Date();
  const later = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  return {
    versionKey: event?.versionKey ?? createThemeSeasonKey(now),
    name: event?.name ?? '',
    startsAt: toLocalDateTime(event?.startsAt ?? now.getTime()),
    endsAt: toLocalDateTime(event?.endsAt ?? later.getTime()),
    description: event?.summary ?? '',
    openWindows: prepareRankedOpenWindowsForForm(
      event?.openWindows ?? [{ weekdays: [6, 7], startMinute: 1140, endMinute: 1380 }]
    ),
  };
}

function defaultEvaluationPolicy() {
  return {
    minimumCompletedMatchesPerPair: 20,
    minimumCompletionRate: 0.8,
    maximumExceptionRate: 0.05,
    maximumExposureDeviation: 0.1,
    maximumMedianWaitSeconds: 180,
    winRateLowerBound: 0.35,
    winRateUpperBound: 0.65,
    baselineWindowLabel: '前两周同星期相邻时段',
  };
}

function createThemeSeasonKey(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/g, '');
  return `theme-${local}`;
}

function nextDeckKey(event: ThemeAdminEventView) {
  return `deck-${String(event.decks.length + 1).padStart(2, '0')}`;
}

function enabledMatchupCount(event: ThemeAdminEventView) {
  return event.matchups.filter((matchup) => matchup.enabled).length;
}

function lifecycleLabel(value: ThemeAdminEventView['lifecycle']) {
  return { DRAFT: '草稿', ACTIVE: '开放中', PAUSED: '已暂停', CLOSED: '已结束' }[value];
}

function sumDeck(entries: readonly { count: number }[]) {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}

function toLocalDateTime(value: number) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

function formatOpenWindows(
  windows: readonly { weekdays: readonly number[]; startMinute: number; endMinute: number }[]
) {
  const logicalWindows = prepareRankedOpenWindowsForForm(windows);
  const first = logicalWindows[0];
  if (!first) return '未设置开放时段';
  const weekdays =
    first.weekdays.length === 7
      ? '每天'
      : first.weekdays
          .map((weekday) => `周${['一', '二', '三', '四', '五', '六', '日'][weekday - 1]}`)
          .join('、');
  const time = `${minuteToTime(first.startMinute)}–${
    isCrossMidnightRankedOpenWindow(first) ? '次日 ' : ''
  }${minuteToTime(first.endMinute, true)}`;
  return `${weekdays} ${time}${logicalWindows.length > 1 ? ` 等 ${logicalWindows.length} 个时段` : ''}`;
}

function minuteToTime(minute: number, isEnd = false) {
  const normalized = isEnd && minute === 1440 ? 0 : minute;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function formatPercent(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : '主题赛季管理操作失败';
}
