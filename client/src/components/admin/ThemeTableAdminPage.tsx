import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  CirclePause,
  Layers3,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import * as yaml from 'yaml';
import { DeckConfigSchema, type DeckConfig } from '@game/domain/card-data/deck-loader';
import { CardType } from '@game/shared/types/enums';
import type { AnyCardData } from '@game/domain/entities/card';
import { AdminPageHeader } from './AdminPageHeader';
import { AdminViewTabs } from './AdminViewTabs';
import { SeasonOpenWindowsFields } from './SeasonOpenWindowsFields';
import { CardEditor } from '@/components/deck-editor';
import { SelectMenu } from '@/components/common';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import {
  addThemeAdminDeck,
  createThemeAdminDraft,
  deleteThemeAdminDeck,
  fetchThemeAdminEvents,
  runThemeAdminLifecycleAction,
  setThemeAdminMatchupEnabled,
  updateThemeAdminDraft,
  updateThemeAdminDeck,
  updateThemeAdminOperations,
  type ThemeAdminDeckView,
  type ThemeAdminDraftPayload,
  type ThemeAdminEventView,
  type ThemeAdminOperationsPayload,
} from '@/lib/themeTableAdminClient';
import {
  formatRankedOpenWindows,
  getRankedOpenWindowsValidationError,
  prepareRankedOpenWindowsForApi,
  prepareRankedOpenWindowsForForm,
  type EditableRankedOpenWindow,
} from '@/lib/rankedOpenWindows';
import './theme-table-admin.css';

type Tab = 'overview' | 'seasons';
type EditorMode = 'closed' | 'create' | 'edit';
interface ThemeDeckEditorState {
  readonly eventId: string;
  readonly eventName: string;
  readonly deck: ThemeAdminDeckView;
}

const TABS = [
  { value: 'overview', label: '概览' },
  { value: 'seasons', label: '娱乐模式' },
] as const;

export function ThemeTableAdminPage({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [events, setEvents] = useState<ThemeAdminEventView[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('closed');
  const [deckEditor, setDeckEditor] = useState<ThemeDeckEditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cloudDecks = useDeckStore((state) => state.cloudDecks);
  const ensureCloudDecks = useDeckStore((state) => state.ensureCloudDecks);
  const refreshCloudDecks = useDeckStore((state) => state.refreshCloudDecks);

  const selected = useMemo(
    () => events.find((event) => event.id === selectedId) ?? events[0] ?? null,
    [events, selectedId]
  );

  const load = async (forceDeckRefresh = false) => {
    setBusy(true);
    setError(null);
    try {
      const [nextEvents] = await Promise.all([
        fetchThemeAdminEvents(),
        forceDeckRefresh ? refreshCloudDecks() : ensureCloudDecks(),
      ]);
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

  if (deckEditor) {
    return (
      <ThemeDeckEditorPage
        key={deckEditor.deck.id}
        state={deckEditor}
        busy={busy}
        error={error}
        onBack={() => setDeckEditor(null)}
        onSave={(deck, displayName, sourceUrl) =>
          run(() =>
            updateThemeAdminDeck(deckEditor.eventId, deckEditor.deck.id, {
              sourceType: 'YAML',
              yamlContent: yaml.stringify({ ...deck, player_name: displayName }),
              displayName,
              playStyleTags: [...deckEditor.deck.playStyleTags],
              difficulty: deckEditor.deck.difficulty,
              sourceLabel: deckEditor.deck.sourceLabel,
              sourceUrl,
              reviewNote: deckEditor.deck.reviewNote,
            })
          ).then((completed) => {
            if (completed) setDeckEditor(null);
            return completed;
          })
        }
      />
    );
  }

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <AdminPageHeader
        title="娱乐模式管理"
        category="对局与赛季"
        onBack={onBack}
        actions={
          <button className="button-icon" onClick={() => void load(true)} aria-label="刷新">
            <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
          </button>
        }
      />

      <main className="product-page-main flex-1">
        <div className="mx-auto w-full max-w-5xl">
          <AdminViewTabs label="娱乐模式管理视图" value={tab} tabs={TABS} onChange={setTab} />

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
              onSubmitSeason={(event, payload) =>
                run(() => {
                  if (!event) return createThemeAdminDraft(payload);
                  if (event.lifecycle === 'DRAFT') {
                    return updateThemeAdminDraft(event.id, payload);
                  }
                  return updateThemeAdminOperations(event.id, operationsPayloadFromDraft(payload));
                }).then((completed) => {
                  if (completed) setEditorMode('closed');
                })
              }
              onLifecycle={(event, action) =>
                run(() => runThemeAdminLifecycleAction(event.id, action))
              }
              onRun={run}
              onEditDeck={(event, deck) =>
                setDeckEditor({ eventId: event.id, eventName: event.name, deck })
              }
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
          <p className="text-sm text-[var(--text-muted)]">还没有娱乐模式活动</p>
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
          <div className="grid gap-1 text-sm text-[var(--text-secondary)]">
            <span>查看娱乐模式</span>
            <SelectMenu
              label="查看娱乐模式"
              value={selected.id}
              options={events.map((event) => ({ value: event.id, label: event.name }))}
              onChange={onSelect}
              className="min-w-64"
              menuMinWidth={256}
            />
          </div>
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
                  <small>累计目标 {formatPercent(item.expectedShare)}</small>
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
  onSubmitSeason,
  onLifecycle,
  onRun,
  onEditDeck,
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
  onSubmitSeason: (
    event: ThemeAdminEventView | null,
    payload: ThemeAdminDraftPayload
  ) => Promise<unknown>;
  onLifecycle: (
    event: ThemeAdminEventView,
    action: 'activate' | 'pause' | 'resume' | 'close'
  ) => Promise<unknown>;
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
  onEditDeck: (event: ThemeAdminEventView, deck: ThemeAdminDeckView) => void;
}) {
  const [managedSeasonId, setManagedSeasonId] = useState<string | null>(null);
  const editingEvent = editorMode === 'edit' ? selected : null;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="button-secondary px-4 py-2 text-sm" onClick={onOpenCreate}>
          <span className="inline-flex items-center gap-1.5">
            <Plus size={15} /> 新建娱乐模式
          </span>
        </button>
      </div>

      {editorMode !== 'closed' ? (
        <ThemeSeasonForm
          key={`${editorMode}:${editingEvent?.id ?? 'new'}`}
          event={editingEvent}
          busy={busy}
          onCancel={onCloseEditor}
          onSubmit={(payload) => onSubmitSeason(editingEvent, payload)}
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
                  <span>{formatRankedOpenWindows(event.openWindows)}</span>
                  <span>结束：{formatDate(event.endsAt)}</span>
                  <span>{enabledMatchupCount(event)} 个可分配组合</span>
                </div>
                {expanded ? (
                  <DeckPoolPanel
                    event={event}
                    cloudDecks={cloudDecks}
                    busy={busy}
                    onRun={onRun}
                    onEditDeck={(deck) => onEditDeck(event, deck)}
                  />
                ) : null}
              </section>
            );
          })}
        </div>
      ) : editorMode === 'closed' ? (
        <div className="product-workbench p-8 text-center text-sm text-[var(--text-muted)]">
          还没有娱乐模式活动
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
        ? '确定开始娱乐模式吗？'
        : action === 'close'
          ? '结束后不能恢复，确定结束本期娱乐模式吗？'
          : null;
    if (warning && !window.confirm(warning)) return;
    void onLifecycle(event, action);
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button className="button-secondary px-3 py-2 text-sm" onClick={onManage}>
        {expanded ? '收起卡组池' : '管理卡组池'}
      </button>
      {event.lifecycle !== 'CLOSED' ? (
        <button className="button-secondary px-3 py-2 text-sm" disabled={busy} onClick={onEdit}>
          编辑活动
        </button>
      ) : null}
      {event.lifecycle === 'DRAFT' ? (
        <>
          <button
            className="button-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
            disabled={busy || event.decks.length < 1 || enabledMatchupCount(event) === 0}
            onClick={() => runAction('activate')}
          >
            <ShieldCheck size={15} /> 开始活动
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
          结束活动
        </button>
      ) : null}
    </div>
  );
}

function ThemeDeckEditorPage({
  state,
  busy,
  error,
  onBack,
  onSave,
}: {
  state: ThemeDeckEditorState;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (deck: DeckConfig, displayName: string, sourceUrl: string | null) => Promise<boolean>;
}) {
  const cardDataRegistry = useGameStore((store) => store.cardDataRegistry);
  const prepared = useMemo(
    () => buildEditableThemeDeck(state.deck, cardDataRegistry),
    [cardDataRegistry, state.deck]
  );

  if (!prepared.deck) {
    return (
      <div className="app-shell flex min-h-screen flex-col">
        <AdminPageHeader
          title={`编辑卡组 · ${state.eventName}`}
          category="对局与赛季"
          onBack={onBack}
        />
        <main className="product-page-main flex-1">
          <div className="product-workbench mx-auto max-w-3xl p-6">
            <p className="text-sm text-[var(--semantic-error)]">{prepared.error}</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <ThemeDeckEditorWorkspace
      state={state}
      initialDeck={prepared.deck}
      busy={busy}
      error={error}
      onBack={onBack}
      onSave={onSave}
    />
  );
}

function ThemeDeckEditorWorkspace({
  state,
  initialDeck,
  busy,
  error,
  onBack,
  onSave,
}: {
  state: ThemeDeckEditorState;
  initialDeck: DeckConfig;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (deck: DeckConfig, displayName: string, sourceUrl: string | null) => Promise<boolean>;
}) {
  const [deck, setDeck] = useState(initialDeck);
  const [displayName, setDisplayName] = useState(state.deck.displayName);
  const [sourceUrl, setSourceUrl] = useState(state.deck.sourceUrl ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const validateDeck = useDeckStore((store) => store.validateDeck);
  const validation = useMemo(() => validateDeck(deck), [deck, validateDeck]);
  const initialSnapshot = useMemo(
    () => JSON.stringify([initialDeck, state.deck.displayName, state.deck.sourceUrl ?? '']),
    [initialDeck, state.deck.displayName, state.deck.sourceUrl]
  );
  const isDirty = JSON.stringify([deck, displayName, sourceUrl]) !== initialSnapshot;

  const close = () => {
    if (isDirty && !window.confirm('放弃尚未保存的卡组修改？')) return;
    onBack();
  };

  const save = async () => {
    const normalizedName = displayName.trim();
    if (!normalizedName) {
      setLocalError('请输入卡组名称');
      return;
    }
    if (!validation.valid) {
      setLocalError(validation.errors[0] ?? '卡组不符合当前构筑规则');
      return;
    }
    let normalizedSourceUrl: string | null = null;
    if (sourceUrl.trim()) {
      try {
        const parsed = new URL(sourceUrl.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
        normalizedSourceUrl = parsed.toString();
      } catch {
        setLocalError('来源链接必须是完整的 HTTP 或 HTTPS 地址');
        return;
      }
    }
    setLocalError(null);
    await onSave({ ...deck, player_name: normalizedName }, normalizedName, normalizedSourceUrl);
  };

  return (
    <div className="app-shell flex h-screen min-h-0 flex-col overflow-hidden">
      <AdminPageHeader
        title={`编辑卡组 · ${state.eventName}`}
        category="对局与赛季"
        onBack={close}
        actions={
          <button
            type="button"
            className="button-primary inline-flex min-h-10 items-center gap-1.5 px-4 text-sm"
            disabled={busy || !displayName.trim() || !validation.valid}
            onClick={() => void save()}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            保存
          </button>
        }
      />
      <main className="min-h-0 flex-1 overflow-hidden p-3 sm:p-5">
        <div className="workspace-shell mx-auto flex h-full min-h-0 max-w-[1500px] flex-col overflow-hidden">
          <div className="workspace-toolbar grid gap-3 px-3 py-3 md:grid-cols-[minmax(180px,0.7fr)_minmax(280px,1.3fr)] md:px-4">
            <label className="grid gap-1 text-xs text-[var(--text-muted)]">
              卡组名称
              <input
                className="input-field px-3 py-2 text-sm font-semibold"
                value={displayName}
                maxLength={100}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                  setLocalError(null);
                }}
              />
            </label>
            <label className="grid gap-1 text-xs text-[var(--text-muted)]">
              来源链接（可选）
              <input
                className="input-field px-3 py-2 text-sm"
                inputMode="url"
                placeholder="https://decklog.bushiroad.com/view/..."
                value={sourceUrl}
                maxLength={1000}
                onChange={(event) => {
                  setSourceUrl(event.target.value);
                  setLocalError(null);
                }}
              />
            </label>
          </div>
          {localError || error ? (
            <p className="mx-4 mt-2 rounded-lg bg-[var(--semantic-error)]/10 px-3 py-2 text-xs text-[var(--semantic-error)]">
              {localError ?? error}
            </p>
          ) : null}
          <div className="min-h-0 flex-1 overflow-hidden">
            <CardEditor deck={deck} onDeckChange={setDeck} onValidate={validateDeck} />
          </div>
        </div>
      </main>
    </div>
  );
}

function buildEditableThemeDeck(
  source: ThemeAdminDeckView,
  cardDataRegistry: ReadonlyMap<string, AnyCardData>
): { deck: DeckConfig | null; error: string | null } {
  const members: DeckConfig['main_deck']['members'] = [];
  const lives: DeckConfig['main_deck']['lives'] = [];
  const missing: string[] = [];
  for (const entry of source.mainDeck) {
    const card = cardDataRegistry.get(entry.cardCode);
    if (!card) {
      missing.push(entry.cardCode);
      continue;
    }
    const target =
      card.cardType === CardType.MEMBER ? members : card.cardType === CardType.LIVE ? lives : null;
    if (!target) {
      missing.push(entry.cardCode);
      continue;
    }
    target.push({ card_code: entry.cardCode, count: entry.count });
  }
  if (missing.length > 0) {
    return {
      deck: null,
      error: `以下卡牌尚未加载，不能安全编辑：${missing.slice(0, 5).join('、')}`,
    };
  }
  return {
    deck: {
      player_name: source.displayName,
      description: source.reviewNote,
      main_deck: { members, lives },
      energy_deck: source.energyDeck.map((entry) => ({
        card_code: entry.cardCode,
        count: entry.count,
      })),
    },
    error: null,
  };
}

function DeckPoolPanel({
  event,
  cloudDecks,
  busy,
  onRun,
  onEditDeck,
}: {
  event: ThemeAdminEventView;
  cloudDecks: ReturnType<typeof useDeckStore.getState>['cloudDecks'];
  busy: boolean;
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
  onEditDeck: (deck: ThemeAdminDeckView) => void;
}) {
  const poolReady = event.decks.length >= 1 && enabledMatchupCount(event) > 0;
  return (
    <div className="mt-4 rounded-xl bg-[var(--bg-overlay)] p-4">
      <div className="theme-season-readiness">
        <div>
          <span>娱乐模式</span>
          <strong>信息已保存</strong>
        </div>
        <div data-ready={poolReady}>
          <span>卡组池</span>
          <strong>{poolReady ? '可以开始活动' : '还需加入 1 副'}</strong>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">平台分配卡组池</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
            每副卡组都会加入内战，并与池内其他卡组组成等权对局。
          </p>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{event.decks.length} 副</span>
      </div>

      {event.lifecycle !== 'CLOSED' ? (
        <DeckPoolAddForm event={event} cloudDecks={cloudDecks} busy={busy} onRun={onRun} />
      ) : null}

      <div className="theme-deck-pool-grid mt-3">
        {event.decks.map((deck) => (
          <div key={deck.id}>
            <div className="theme-deck-pool-card__heading">
              <strong>{deck.displayName}</strong>
              {event.lifecycle !== 'CLOSED' ? (
                <div className="theme-deck-pool-card__actions">
                  <button
                    type="button"
                    className="theme-deck-pool-card__action"
                    disabled={busy}
                    aria-label={`编辑${deck.displayName}`}
                    onClick={() => onEditDeck(deck)}
                  >
                    <Pencil size={13} aria-hidden="true" />
                    编辑
                  </button>
                  <button
                    type="button"
                    className="theme-deck-pool-card__action theme-deck-pool-card__action--danger"
                    disabled={busy}
                    aria-label={`从卡组池移除${deck.displayName}`}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `从卡组池移除“${deck.displayName}”？若卡组池因此变空，当前匹配会暂停。`
                        )
                      )
                        return;
                      void onRun(() => deleteThemeAdminDeck(event.id, deck.id));
                    }}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    移除
                  </button>
                </div>
              ) : null}
            </div>
            <span>
              主卡组 {sumDeck(deck.mainDeck)} · 能量 {sumDeck(deck.energyDeck)}
            </span>
          </div>
        ))}
        {event.decks.length === 0 ? (
          <p className="py-4 text-sm text-[var(--text-muted)]">从云端卡组加入，或直接导入 YAML。</p>
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
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    const deck = validDecks.find((candidate) => candidate.id === sourceDeckId);
    if (!deck) return;
    void onRun(() =>
      addThemeAdminDeck(event.id, {
        sourceType: 'CLOUD',
        sourceDeckId,
        deckKey: nextDeckKey(event),
        displayName: deck.name,
        playStyleTags: [],
        difficulty: 'INTERMEDIATE',
        sourceLabel: '娱乐模式卡组池',
        sourceUrl: null,
        reviewNote: '加入娱乐模式卡组池时审核',
      })
    );
  };

  const importYaml = (changeEvent: ChangeEvent<HTMLInputElement>) => {
    const file = changeEvent.target.files?.[0];
    changeEvent.target.value = '';
    if (!file) return;
    setImportError(null);
    setImporting(true);
    void (async () => {
      try {
        if (file.size > 100_000) throw new Error('YAML 文件不能超过 100 KB');
        const yamlContent = await file.text();
        const parsed = DeckConfigSchema.safeParse(yaml.parse(yamlContent));
        if (!parsed.success) {
          throw new Error(`YAML 结构错误：${parsed.error.issues[0]?.message ?? '无法识别卡组'}`);
        }
        await onRun(() =>
          addThemeAdminDeck(event.id, {
            sourceType: 'YAML',
            yamlContent,
            deckKey: nextDeckKey(event),
            displayName: parsed.data.player_name,
            playStyleTags: [],
            difficulty: 'INTERMEDIATE',
            sourceLabel: `YAML · ${file.name}`,
            sourceUrl: null,
            reviewNote: '由管理员直接导入娱乐模式卡组池',
          })
        );
      } catch (error) {
        setImportError(error instanceof Error ? error.message : 'YAML 导入失败');
      } finally {
        setImporting(false);
      }
    })();
  };
  return (
    <div className="theme-deck-pool-import mt-3">
      <form className="theme-deck-pool-import__cloud" onSubmit={submit}>
        <SelectMenu
          label="选择云端卡组"
          value={sourceDeckId}
          options={[
            { value: '', label: '选择一副合法云端卡组' },
            ...validDecks.map((deck) => ({ value: deck.id, label: deck.name })),
          ]}
          onChange={setSourceDeckId}
          className="h-11 min-w-0 flex-1"
          menuMinWidth={288}
        />
        <button className="button-primary min-h-11 px-4 text-sm" disabled={busy || !sourceDeckId}>
          {busy && !importing ? <Loader2 size={16} className="animate-spin" /> : '从云端加入'}
        </button>
      </form>
      <span className="theme-deck-pool-import__divider">或</span>
      <input
        ref={fileInputRef}
        className="sr-only"
        type="file"
        accept=".yaml,.yml,text/yaml,application/x-yaml"
        aria-label="导入 YAML 卡组"
        onChange={importYaml}
      />
      <button
        type="button"
        className="button-secondary inline-flex min-h-11 items-center justify-center gap-1.5 px-4 text-sm"
        disabled={busy || importing}
        onClick={() => fileInputRef.current?.click()}
      >
        {importing ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Upload size={15} aria-hidden="true" />
        )}
        导入 YAML
      </button>
      {importError ? <p className="theme-deck-pool-import__error">{importError}</p> : null}
    </div>
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
          scheduleLabel: formatRankedOpenWindows(draft.openWindows),
          summary: description,
          announcement: `本娱乐模式不计入排位，双方将从本期卡组池获得平台分配的预组。\n\n${description}`,
          evaluationPolicy: event?.evaluationPolicy ?? defaultEvaluationPolicy(),
        });
      }}
    >
      <div className="sm:col-span-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          {event ? '编辑娱乐模式' : '新建娱乐模式'}
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {event && event.lifecycle !== 'DRAFT'
            ? '调整玩家看到的活动名称、时间和说明。'
            : '设置活动时间后，再加入供系统分配的卡组池。'}
        </p>
      </div>
      <Field label="活动名称">
        <input
          className="input-field"
          value={draft.name}
          placeholder="例如：夏日组合挑战"
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
            placeholder="说明本期娱乐模式、适合体验的玩法和注意事项"
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
          {busy ? <Loader2 size={16} className="animate-spin" /> : event ? '保存' : '创建活动'}
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

function operationsPayloadFromDraft(payload: ThemeAdminDraftPayload): ThemeAdminOperationsPayload {
  return {
    name: payload.name,
    openWindows: payload.openWindows,
    startsAt: payload.startsAt,
    endsAt: payload.endsAt,
    scheduleLabel: payload.scheduleLabel,
    summary: payload.summary,
    announcement: payload.announcement,
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
  let index = 1;
  while (event.decks.some((deck) => deck.deckKey === `deck-${String(index).padStart(2, '0')}`)) {
    index += 1;
  }
  return `deck-${String(index).padStart(2, '0')}`;
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

function formatPercent(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value);
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : '娱乐模式管理操作失败';
}
