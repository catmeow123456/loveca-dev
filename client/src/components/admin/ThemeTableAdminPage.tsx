import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  CalendarClock,
  Check,
  CirclePause,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { PageHeader } from '@/components/common';
import { useDeckStore } from '@/store/deckStore';
import {
  addThemeAdminDeck,
  addThemeAdminMatchup,
  createThemeAdminDraft,
  fetchThemeAdminEnvironment,
  fetchThemeAdminEvents,
  runThemeAdminLifecycleAction,
  setThemeAdminMatchupEnabled,
  updateThemeAdminDraft,
  type ThemeAdminDraftPayload,
  type ThemeAdminEnvironmentPreview,
  type ThemeAdminEventView,
} from '@/lib/themeTableAdminClient';
import './theme-table-admin.css';

type EditorMode = 'closed' | 'create' | 'edit';

export function ThemeTableAdminPage({ onBack }: { onBack: () => void }) {
  const [events, setEvents] = useState<ThemeAdminEventView[]>([]);
  const [environment, setEnvironment] = useState<ThemeAdminEnvironmentPreview | null>(null);
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
      const [nextEnvironment, nextEvents] = await Promise.all([
        fetchThemeAdminEnvironment(),
        fetchThemeAdminEvents(),
        fetchCloudDecks(),
      ]);
      setEnvironment(nextEnvironment);
      setEvents(nextEvents);
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
    // The workbench owns its initial aggregate request.
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

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <PageHeader
        title="轮换主题牌桌管理"
        icon={<Sparkles size={20} />}
        onBack={onBack}
        backLabel="返回大厅"
        right={
          <button className="button-icon" onClick={() => void load()} aria-label="刷新">
            <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
          </button>
        }
      />

      <main className="product-page-main flex-1">
        <div className="mx-auto w-full max-w-7xl space-y-4">
          <ProgramRail event={selected} />

          {error ? (
            <p className="rounded-lg bg-[var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]">
              {error}
            </p>
          ) : null}

          {editorMode !== 'closed' ? (
            <DraftForm
              key={`${editorMode}:${editorMode === 'edit' ? (selected?.id ?? '') : 'new'}`}
              event={editorMode === 'edit' ? selected : null}
              busy={busy}
              onCancel={() => setEditorMode('closed')}
              onSubmit={(payload) =>
                run(() =>
                  editorMode === 'edit' && selected
                    ? updateThemeAdminDraft(selected.id, payload)
                    : createThemeAdminDraft(payload)
                ).then((completed) => {
                  if (completed) setEditorMode('closed');
                })
              }
            />
          ) : null}

          <div className="theme-admin-layout">
            <EventIndex
              events={events}
              selectedId={selected?.id ?? ''}
              environment={environment}
              busy={busy}
              onSelect={setSelectedId}
              onCreate={() => setEditorMode('create')}
            />

            {selected ? (
              <EventWorkspace
                event={selected}
                cloudDecks={cloudDecks}
                busy={busy}
                onEdit={() => setEditorMode('edit')}
                onRun={run}
              />
            ) : (
              <section className="product-workbench grid min-h-80 place-items-center p-8 text-center">
                <div>
                  <Layers3 className="mx-auto mb-3 text-[var(--text-muted)]" size={28} />
                  <p className="text-sm text-[var(--text-muted)]">
                    先创建活动草稿，再冻结预组与组合。
                  </p>
                </div>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function ProgramRail({ event }: { event: ThemeAdminEventView | null }) {
  const steps = [
    { label: '活动', complete: Boolean(event) },
    { label: '预组', complete: (event?.decks.length ?? 0) >= 2 },
    { label: '组合', complete: Boolean(event?.matchups.some((matchup) => matchup.enabled)) },
    { label: '发布', complete: Boolean(event && event.lifecycle !== 'DRAFT') },
  ];
  return (
    <section className="theme-program-rail" aria-label="主题活动编排进度">
      <div className="theme-program-kicker">PROGRAM BOARD</div>
      <div className="theme-program-steps">
        {steps.map((step, index) => (
          <div
            className={`theme-program-step ${step.complete ? 'is-complete' : ''}`}
            key={step.label}
          >
            <span>{step.complete ? <Check size={14} /> : String(index + 1).padStart(2, '0')}</span>
            <strong>{step.label}</strong>
          </div>
        ))}
      </div>
      <p>{event ? `${event.versionKey} · ${lifecycleLabel(event.lifecycle)}` : '尚未选择活动'}</p>
    </section>
  );
}

function EventIndex({
  events,
  selectedId,
  environment,
  busy,
  onSelect,
  onCreate,
}: {
  events: ThemeAdminEventView[];
  selectedId: string;
  environment: ThemeAdminEnvironmentPreview | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <aside className="product-workbench self-start">
      <div className="product-workbench-toolbar">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">活动版本</div>
          <div className="text-xs text-[var(--text-muted)]">同一时刻仅开放一个版本</div>
        </div>
        <button
          className="button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
          onClick={onCreate}
          disabled={busy}
        >
          <Plus size={15} /> 新建
        </button>
      </div>
      <div className="product-list">
        {events.map((event) => (
          <button
            className={`theme-event-row product-list-row ${selectedId === event.id ? 'is-selected' : ''}`}
            key={event.id}
            onClick={() => onSelect(event.id)}
          >
            <span>
              <strong>{event.name}</strong>
              <small>{event.versionKey}</small>
            </span>
            <em data-lifecycle={event.lifecycle}>{lifecycleLabel(event.lifecycle)}</em>
          </button>
        ))}
        {events.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-muted)]">还没有活动版本</p>
        ) : null}
      </div>
      {environment ? (
        <div className="border-t border-[var(--border-subtle)] p-4 text-xs leading-5 text-[var(--text-muted)]">
          <div>{environment.rulesEnvironmentId}</div>
          <div>{environment.publishedCardCount} 张已发布卡牌</div>
          <div className="truncate" title={environment.cardCatalogHash}>
            {environment.cardCatalogHash}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function EventWorkspace({
  event,
  cloudDecks,
  busy,
  onEdit,
  onRun,
}: {
  event: ThemeAdminEventView;
  cloudDecks: ReturnType<typeof useDeckStore.getState>['cloudDecks'];
  busy: boolean;
  onEdit: () => void;
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  return (
    <div className="space-y-4">
      <section className="product-workbench p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-[var(--accent-secondary)]">
              <CalendarClock size={14} /> {event.scheduleLabel}
            </div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">{event.name}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
              {event.summary}
            </p>
          </div>
          <LifecycleActions event={event} busy={busy} onEdit={onEdit} onRun={onRun} />
        </div>
        <div className="mt-4 grid gap-2 border-t border-[var(--border-subtle)] pt-4 text-xs text-[var(--text-muted)] sm:grid-cols-2">
          <span>开始：{formatDate(event.startsAt)}</span>
          <span>结束：{formatDate(event.endsAt)}</span>
          <span className="truncate" title={event.environmentId}>
            环境：{event.environmentId}
          </span>
          <span>分配：{event.allocationAlgorithmVersion}</span>
        </div>
      </section>

      <MetricsStrip event={event} />

      <section className="product-workbench">
        <div className="product-workbench-toolbar">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">冻结预组</div>
            <div className="text-xs text-[var(--text-muted)]">
              从管理员自己的合法云端卡组复制不可变快照
            </div>
          </div>
          <span className="text-xs text-[var(--text-muted)]">{event.decks.length} 副</span>
        </div>
        {event.lifecycle === 'DRAFT' ? (
          <DeckFreezeForm event={event} cloudDecks={cloudDecks} busy={busy} onRun={onRun} />
        ) : null}
        <div className="product-list">
          {event.decks.map((deck) => (
            <div className="product-list-row grid gap-2 p-4 sm:grid-cols-[1fr_auto]" key={deck.id}>
              <div>
                <strong className="text-sm text-[var(--text-primary)]">{deck.displayName}</strong>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {deck.deckKey} · {difficultyLabel(deck.difficulty)} ·{' '}
                  {deck.playStyleTags.join(' / ')}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {deck.sourceLabel} · {deck.reviewNote}
                </p>
              </div>
              <div className="text-right text-xs text-[var(--text-muted)]">
                <div>主卡组 {sumDeck(deck.mainDeck)}</div>
                <div>能量 {sumDeck(deck.energyDeck)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="product-workbench">
        <div className="product-workbench-toolbar">
          <div>
            <div className="text-sm font-semibold text-[var(--text-primary)]">实测组合矩阵</div>
            <div className="text-xs text-[var(--text-muted)]">
              发布后只允许停用；不能原地追加或重新启用
            </div>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            {event.matchups.filter((item) => item.enabled).length} 组启用
          </span>
        </div>
        {event.lifecycle === 'DRAFT' && event.decks.length >= 2 ? (
          <MatchupForm event={event} busy={busy} onRun={onRun} />
        ) : null}
        <div className="product-list">
          {event.matchups.map((matchup) => (
            <div
              className="product-list-row flex flex-wrap items-center justify-between gap-3 p-4"
              key={matchup.id}
            >
              <div>
                <strong className="text-sm text-[var(--text-primary)]">
                  {matchup.firstDeckName} × {matchup.secondDeckName}
                </strong>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  权重 {matchup.weight} · {summarizeTest(matchup.testSummary)}
                </p>
              </div>
              <button
                className={
                  matchup.enabled
                    ? 'button-secondary px-3 py-2 text-sm'
                    : 'button-primary px-3 py-2 text-sm'
                }
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
                {matchup.enabled ? '停用组合' : '重新启用'}
              </button>
            </div>
          ))}
          {event.matchups.length === 0 ? (
            <p className="p-5 text-sm text-[var(--text-muted)]">尚未登记实测组合</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function LifecycleActions({
  event,
  busy,
  onEdit,
  onRun,
}: {
  event: ThemeAdminEventView;
  busy: boolean;
  onEdit: () => void;
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  const action = (kind: 'activate' | 'pause' | 'resume' | 'close') => {
    const warning =
      kind === 'close'
        ? '结束后不能恢复，确定结束本期主题活动吗？'
        : kind === 'activate'
          ? '发布后活动事实、预组和组合将冻结，确定发布吗？'
          : null;
    if (warning && !window.confirm(warning)) return;
    void onRun(() => runThemeAdminLifecycleAction(event.id, kind));
  };
  return (
    <div className="flex flex-wrap gap-2">
      {event.lifecycle === 'DRAFT' ? (
        <>
          <button className="button-secondary px-3 py-2 text-sm" disabled={busy} onClick={onEdit}>
            编辑活动
          </button>
          <button
            className="button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
            disabled={busy}
            onClick={() => action('activate')}
          >
            <ShieldCheck size={15} /> 发布
          </button>
        </>
      ) : null}
      {event.lifecycle === 'ACTIVE' ? (
        <button
          className="button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
          disabled={busy}
          onClick={() => action('pause')}
        >
          <CirclePause size={15} /> 暂停入队
        </button>
      ) : null}
      {event.lifecycle === 'PAUSED' ? (
        <button
          className="button-primary px-3 py-2 text-sm"
          disabled={busy}
          onClick={() => action('resume')}
        >
          恢复开放
        </button>
      ) : null}
      {event.lifecycle === 'ACTIVE' || event.lifecycle === 'PAUSED' ? (
        <button className="theme-danger-button" disabled={busy} onClick={() => action('close')}>
          结束活动
        </button>
      ) : null}
    </div>
  );
}

function MetricsStrip({ event }: { event: ThemeAdminEventView }) {
  const metrics = event.metrics;
  const values = [
    ['入队票据', metrics.joinedTicketCount],
    ['已分配', metrics.assignmentCount],
    ['已开局', metrics.startedMatchCount],
    ['已完成', metrics.completedMatchCount],
    ['无过错回队', metrics.noFaultRequeueCount],
  ] as const;
  return (
    <section className="theme-metrics-strip">
      {values.map(([label, value]) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
      <div className="theme-exposure-cell">
        <span>预组曝光</span>
        <p>
          {metrics.deckExposure.length
            ? metrics.deckExposure
                .map(
                  (item) =>
                    `${item.displayName} ${formatPercent(item.actualShare)} / 目标 ${formatPercent(item.expectedShare)}`
                )
                .join(' · ')
            : '暂无分配'}
        </p>
      </div>
    </section>
  );
}

function DeckFreezeForm({
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
  const [sourceDeckId, setSourceDeckId] = useState(
    cloudDecks.find((deck) => deck.is_valid)?.id ?? ''
  );
  const [deckKey, setDeckKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [tags, setTags] = useState('');
  const [difficulty, setDifficulty] = useState<'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'>(
    'INTERMEDIATE'
  );
  const [sourceLabel, setSourceLabel] = useState('内部实测卡组');
  const [sourceUrl, setSourceUrl] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    void onRun(() =>
      addThemeAdminDeck(event.id, {
        sourceDeckId,
        deckKey,
        displayName,
        playStyleTags: tags
          .split(/[，,]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        difficulty,
        sourceLabel,
        sourceUrl: sourceUrl.trim() || null,
        reviewNote,
      })
    ).then((completed) => {
      if (completed) {
        setDeckKey('');
        setDisplayName('');
        setTags('');
        setReviewNote('');
      }
    });
  };
  return (
    <form className="theme-inline-form" onSubmit={submit}>
      <Field label="云端卡组">
        <select
          className="input-field"
          value={sourceDeckId}
          onChange={(e) => setSourceDeckId(e.target.value)}
          required
        >
          <option value="">请选择</option>
          {cloudDecks.map((deck) => (
            <option key={deck.id} value={deck.id} disabled={!deck.is_valid}>
              {deck.name}
              {deck.is_valid ? '' : '（不合法）'}
            </option>
          ))}
        </select>
      </Field>
      <Field label="预组标识">
        <input
          className="input-field"
          value={deckKey}
          onChange={(e) => setDeckKey(e.target.value)}
          pattern="[a-z0-9][a-z0-9_-]+"
          required
        />
      </Field>
      <Field label="玩家显示名">
        <input
          className="input-field"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
      </Field>
      <Field label="玩法标签（逗号分隔）">
        <input
          className="input-field"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          required
        />
      </Field>
      <Field label="难度">
        <select
          className="input-field"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}
        >
          <option value="BEGINNER">入门</option>
          <option value="INTERMEDIATE">进阶</option>
          <option value="ADVANCED">高阶</option>
        </select>
      </Field>
      <Field label="来源说明">
        <input
          className="input-field"
          value={sourceLabel}
          onChange={(e) => setSourceLabel(e.target.value)}
          required
        />
      </Field>
      <Field label="来源链接（可选）">
        <input
          className="input-field"
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
        />
      </Field>
      <Field label="审阅记录">
        <input
          className="input-field"
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          required
        />
      </Field>
      <button
        className="button-primary min-h-11 self-end px-4 text-sm"
        disabled={busy || !sourceDeckId}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : '冻结预组'}
      </button>
    </form>
  );
}

function MatchupForm({
  event,
  busy,
  onRun,
}: {
  event: ThemeAdminEventView;
  busy: boolean;
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [first, setFirst] = useState(event.decks[0]?.id ?? '');
  const [second, setSecond] = useState(event.decks[1]?.id ?? '');
  const [weight, setWeight] = useState(1);
  const [summary, setSummary] = useState('');
  return (
    <form
      className="theme-inline-form theme-inline-form--matchup"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        void onRun(() =>
          addThemeAdminMatchup(event.id, {
            firstDeckVersionId: first,
            secondDeckVersionId: second,
            weight,
            testSummary: { summary },
          })
        ).then((completed) => {
          if (completed) setSummary('');
        });
      }}
    >
      <Field label="预组 A">
        <select className="input-field" value={first} onChange={(e) => setFirst(e.target.value)}>
          {event.decks.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.displayName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="预组 B">
        <select className="input-field" value={second} onChange={(e) => setSecond(e.target.value)}>
          {event.decks.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.displayName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="权重">
        <input
          className="input-field"
          type="number"
          min={1}
          max={1000}
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
        />
      </Field>
      <Field label="双向试打摘要">
        <input
          className="input-field"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          required
        />
      </Field>
      <button
        className="button-primary min-h-11 self-end px-4 text-sm"
        disabled={busy || !first || !second}
      >
        加入矩阵
      </button>
    </form>
  );
}

function DraftForm({
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
  const [draft, setDraft] = useState(() => draftFromEvent(event));
  return (
    <form
      className="product-workbench grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        const { weekdays, windowStart, windowEnd, ...payload } = draft;
        void onSubmit({
          ...payload,
          startsAt: new Date(payload.startsAt).toISOString(),
          endsAt: new Date(payload.endsAt).toISOString(),
          openWindows: [
            {
              weekdays: parseWeekdays(weekdays),
              startMinute: parseClock(windowStart),
              endMinute: parseEndClock(windowEnd),
            },
          ],
        });
      }}
    >
      <div className="sm:col-span-2 lg:col-span-3">
        <strong className="text-sm text-[var(--text-primary)]">
          {event ? '编辑活动草稿' : '新建活动草稿'}
        </strong>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          发布时会再次核对规则版本、卡牌目录、预组和组合。
        </p>
      </div>
      <Field label="版本标识">
        <input
          className="input-field"
          value={draft.versionKey}
          onChange={(e) => setDraft({ ...draft, versionKey: e.target.value })}
          pattern="[a-z0-9][a-z0-9_-]{2,63}"
          disabled={Boolean(event)}
          required
        />
      </Field>
      <Field label="活动名称">
        <input
          className="input-field"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          required
        />
      </Field>
      <Field label="时区">
        <input
          className="input-field"
          value={draft.platformTimeZone}
          onChange={(e) => setDraft({ ...draft, platformTimeZone: e.target.value })}
          required
        />
      </Field>
      <Field label="开始">
        <input
          className="input-field"
          type="datetime-local"
          value={draft.startsAt}
          onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
          required
        />
      </Field>
      <Field label="结束">
        <input
          className="input-field"
          type="datetime-local"
          value={draft.endsAt}
          onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
          required
        />
      </Field>
      <Field label="玩家时间说明">
        <input
          className="input-field"
          value={draft.scheduleLabel}
          onChange={(e) => setDraft({ ...draft, scheduleLabel: e.target.value })}
          required
        />
      </Field>
      <Field label="开放星期（1–7）">
        <input
          className="input-field"
          value={draft.weekdays}
          onChange={(e) => setDraft({ ...draft, weekdays: e.target.value })}
          required
        />
      </Field>
      <Field label="每日开始">
        <input
          className="input-field"
          type="time"
          value={draft.windowStart}
          onChange={(e) => setDraft({ ...draft, windowStart: e.target.value })}
          required
        />
      </Field>
      <Field label="每日结束">
        <input
          className="input-field"
          type="time"
          value={draft.windowEnd}
          onChange={(e) => setDraft({ ...draft, windowEnd: e.target.value })}
          required
        />
      </Field>
      <Field label="活动说明" wide>
        <textarea
          className="input-field min-h-20"
          value={draft.summary}
          onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          required
        />
      </Field>
      <Field label="玩家公告" wide>
        <textarea
          className="input-field min-h-20"
          value={draft.announcement}
          onChange={(e) => setDraft({ ...draft, announcement: e.target.value })}
          required
        />
      </Field>
      <Field label="每组合最小完成局">
        <input
          className="input-field"
          type="number"
          min={1}
          value={draft.evaluationPolicy.minimumCompletedMatchesPerPair}
          onChange={(e) =>
            setDraft({
              ...draft,
              evaluationPolicy: {
                ...draft.evaluationPolicy,
                minimumCompletedMatchesPerPair: Number(e.target.value),
              },
            })
          }
        />
      </Field>
      <Field label="最低完成率">
        <RatioInput
          value={draft.evaluationPolicy.minimumCompletionRate}
          onChange={(value) =>
            setDraft({
              ...draft,
              evaluationPolicy: { ...draft.evaluationPolicy, minimumCompletionRate: value },
            })
          }
        />
      </Field>
      <Field label="最高异常率">
        <RatioInput
          value={draft.evaluationPolicy.maximumExceptionRate}
          onChange={(value) =>
            setDraft({
              ...draft,
              evaluationPolicy: { ...draft.evaluationPolicy, maximumExceptionRate: value },
            })
          }
        />
      </Field>
      <Field label="最高曝光偏差">
        <RatioInput
          value={draft.evaluationPolicy.maximumExposureDeviation}
          onChange={(value) =>
            setDraft({
              ...draft,
              evaluationPolicy: { ...draft.evaluationPolicy, maximumExposureDeviation: value },
            })
          }
        />
      </Field>
      <Field label="最长中位等待（秒）">
        <input
          className="input-field"
          type="number"
          min={1}
          value={draft.evaluationPolicy.maximumMedianWaitSeconds}
          onChange={(e) =>
            setDraft({
              ...draft,
              evaluationPolicy: {
                ...draft.evaluationPolicy,
                maximumMedianWaitSeconds: Number(e.target.value),
              },
            })
          }
        />
      </Field>
      <Field label="组合胜率下限">
        <RatioInput
          value={draft.evaluationPolicy.winRateLowerBound}
          onChange={(value) =>
            setDraft({
              ...draft,
              evaluationPolicy: { ...draft.evaluationPolicy, winRateLowerBound: value },
            })
          }
        />
      </Field>
      <Field label="组合胜率上限">
        <RatioInput
          value={draft.evaluationPolicy.winRateUpperBound}
          onChange={(value) =>
            setDraft({
              ...draft,
              evaluationPolicy: { ...draft.evaluationPolicy, winRateUpperBound: value },
            })
          }
        />
      </Field>
      <Field label="基线窗口">
        <input
          className="input-field"
          value={draft.evaluationPolicy.baselineWindowLabel}
          onChange={(e) =>
            setDraft({
              ...draft,
              evaluationPolicy: { ...draft.evaluationPolicy, baselineWindowLabel: e.target.value },
            })
          }
          required
        />
      </Field>
      <div className="flex items-end justify-end gap-2 sm:col-span-2 lg:col-span-3">
        <button type="button" className="button-secondary min-h-11 px-4" onClick={onCancel}>
          取消
        </button>
        <button className="button-primary min-h-11 px-5" disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : '保存草稿'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={`grid gap-1.5 text-xs font-medium text-[var(--text-secondary)] ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function RatioInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <input
      className="input-field"
      type="number"
      min={0}
      max={1}
      step={0.01}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

function draftFromEvent(event: ThemeAdminEventView | null) {
  const now = new Date();
  const later = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const window = event?.openWindows[0];
  return {
    versionKey: event?.versionKey ?? '',
    name: event?.name ?? '',
    platformTimeZone: event?.platformTimeZone ?? 'Asia/Shanghai',
    startsAt: toLocalDateTime(event?.startsAt ?? now.getTime()),
    endsAt: toLocalDateTime(event?.endsAt ?? later.getTime()),
    scheduleLabel: event?.scheduleLabel ?? '周末 19:00–23:00',
    summary: event?.summary ?? '',
    announcement: event?.announcement ?? '本活动不计入排位，确认后随机分配本期预组。',
    weekdays: window?.weekdays.join(',') ?? '6,7',
    windowStart: formatMinute(window?.startMinute ?? 1140),
    windowEnd: formatMinute(window?.endMinute ?? 1380),
    evaluationPolicy: event?.evaluationPolicy ?? {
      minimumCompletedMatchesPerPair: 20,
      minimumCompletionRate: 0.8,
      maximumExceptionRate: 0.05,
      maximumExposureDeviation: 0.1,
      maximumMedianWaitSeconds: 180,
      winRateLowerBound: 0.35,
      winRateUpperBound: 0.65,
      baselineWindowLabel: '前两周同星期相邻时段',
    },
  };
}

function parseWeekdays(value: string) {
  return [
    ...new Set(
      value
        .split(/[，,\s]+/)
        .map(Number)
        .filter((day) => day >= 1 && day <= 7)
    ),
  ];
}
function parseClock(value: string) {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}
function parseEndClock(value: string) {
  const minute = parseClock(value);
  return minute === 0 ? 1440 : minute;
}
function formatMinute(value: number) {
  const normalized = value === 1440 ? 0 : value;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}
function toLocalDateTime(value: number) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function formatDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
    value
  );
}
function lifecycleLabel(value: ThemeAdminEventView['lifecycle']) {
  return { DRAFT: '草稿', ACTIVE: '开放中', PAUSED: '已暂停', CLOSED: '已结束' }[value];
}
function difficultyLabel(value: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED') {
  return { BEGINNER: '入门', INTERMEDIATE: '进阶', ADVANCED: '高阶' }[value];
}
function sumDeck(entries: readonly { count: number }[]) {
  return entries.reduce((sum, entry) => sum + entry.count, 0);
}
function formatPercent(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}
function summarizeTest(summary: Readonly<Record<string, unknown>>) {
  return typeof summary.summary === 'string' && summary.summary.trim()
    ? summary.summary
    : '已登记测试记录';
}
function readError(error: unknown) {
  return error instanceof Error ? error.message : '主题牌桌管理操作失败';
}
