import { useEffect, useMemo, useState } from 'react';
import { Loader2, Medal, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/common';
import {
  createRankedSeason,
  executeRankedCorrection,
  fetchRankedEnvironment,
  fetchRankedMatches,
  fetchRankedSeasons,
  previewRankedCorrection,
  runRankedSeasonAction,
  setRankedAdmission,
  settleRankedMatch,
  updateActiveRankedSeasonOperations,
  updateRankedSeason,
  type RankedActiveSeasonOperationsPayload,
  type RankedAdminMatch,
  type RankedAdminSeason,
  type RankedCorrectionPreview,
  type RankedRatingConfig,
  type RankedSeasonDraftPayload,
} from '@/lib/rankedAdminClient';

type Tab = 'season' | 'matches';

export function RankedAdminPage({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('season');
  const [seasons, setSeasons] = useState<RankedAdminSeason[]>([]);
  const [matches, setMatches] = useState<RankedAdminMatch[]>([]);
  const [formalAlgorithm, setFormalAlgorithm] = useState('GLICKO1_PER_MATCH_V2');
  const [formalRatingConfig, setFormalRatingConfig] = useState<RankedRatingConfig>({
    initialRating: 1500,
    initialRatingDeviation: 300,
    softResetMode: 'RESET_TO_INITIAL',
    softResetCenter: 1500,
    softResetRetention: 0.5,
    softResetMinimumDeviation: 200,
  });
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingSeason, setEditingSeason] = useState<RankedAdminSeason | null>(null);
  const [correction, setCorrection] = useState<{
    match: RankedAdminMatch;
    preview: RankedCorrectionPreview;
    replacementWinnerSeat?: 'FIRST' | 'SECOND';
    replacementResultType?: 'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT';
    idempotencyKey: string;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const [environment, seasonList] = await Promise.all([
        fetchRankedEnvironment(),
        fetchRankedSeasons(),
      ]);
      const formal = environment.algorithms.find((item) => item.status === 'FORMAL');
      if (formal) {
        setFormalAlgorithm(formal.algorithmVersion);
        setFormalRatingConfig(formal.config);
      }
      setSeasons(seasonList);
      const nextSeasonId =
        selectedSeasonId || seasonList.find((item) => item.lifecycle !== 'CLOSED')?.id || '';
      setSelectedSeasonId(nextSeasonId);
      setMatches(await fetchRankedMatches(nextSeasonId || undefined));
    } catch (loadError) {
      setError(readError(loadError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // The initial request intentionally uses the first active season.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedSeasonId) return;
    void fetchRankedMatches(selectedSeasonId)
      .then(setMatches)
      .catch((loadError) => setError(readError(loadError)));
  }, [selectedSeasonId]);

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

  const startCorrection = async (
    match: RankedAdminMatch,
    action: 'VOID' | 'REPLACE',
    replacementWinnerSeat?: 'FIRST' | 'SECOND'
  ) => {
    setBusy(true);
    setError(null);
    try {
      const replacementResultType =
        action === 'REPLACE' ? correctionResultTypeForMatch(match) : undefined;
      const preview = await previewRankedCorrection(
        match,
        action,
        replacementWinnerSeat,
        replacementResultType
      );
      setCorrection({
        match,
        preview,
        replacementWinnerSeat,
        replacementResultType,
        idempotencyKey: crypto.randomUUID(),
      });
      setReason('');
    } catch (previewError) {
      setError(readError(previewError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <PageHeader
        title="赛季排位管理"
        icon={<Medal size={20} />}
        onBack={onBack}
        backLabel="返回大厅"
        right={
          <>
            <button className="button-icon" onClick={() => void load()} aria-label="刷新">
              <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
            </button>
          </>
        }
      />

      <main className="product-page-main flex-1">
        <div className="mx-auto w-full max-w-5xl">
          <div
            className="mb-4 flex gap-1 border-b border-[var(--border-subtle)] pb-1"
            role="tablist"
            aria-label="排位管理视图"
          >
            <TabButton active={tab === 'season'} onClick={() => setTab('season')}>
              赛季
            </TabButton>
            <TabButton active={tab === 'matches'} onClick={() => setTab('matches')}>
              对局处理
            </TabButton>
          </div>
          {error ? (
            <p className="mb-4 rounded-xl bg-[var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]">
              {error}
            </p>
          ) : null}
          {tab === 'season' ? (
            <SeasonPanel
              seasons={seasons}
              formalAlgorithm={formalAlgorithm}
              formalRatingConfig={formalRatingConfig}
              creating={creating}
              editingSeason={editingSeason}
              busy={busy}
              onToggleCreate={() => {
                setEditingSeason(null);
                setCreating((value) => !value);
              }}
              onEdit={(season) => {
                setCreating(false);
                setEditingSeason(season);
              }}
              onCancelEdit={() => setEditingSeason(null)}
              onCreate={(payload) =>
                run(() => createRankedSeason(payload)).then((created) => {
                  if (created) setCreating(false);
                })
              }
              onUpdate={(season, payload) =>
                run(() => updateRankedSeason(season.id, payload)).then((updated) => {
                  if (updated) setEditingSeason(null);
                })
              }
              onUpdateActive={(season, payload) =>
                run(() => updateActiveRankedSeasonOperations(season.id, payload)).then(
                  (updated) => {
                    if (updated) setEditingSeason(null);
                  }
                )
              }
              onAction={(season, action) => run(() => runRankedSeasonAction(season.id, action))}
              onAdmission={(season, admission) =>
                run(() => setRankedAdmission(season.id, admission))
              }
            />
          ) : (
            <MatchesPanel
              seasons={seasons}
              matches={matches}
              selectedSeasonId={selectedSeasonId}
              busy={busy}
              onSelectSeason={setSelectedSeasonId}
              onSettle={(match) => run(() => settleRankedMatch(match.matchId))}
              onCorrection={startCorrection}
            />
          )}
        </div>
      </main>

      {correction ? (
        <CorrectionDialog
          correction={correction}
          reason={reason}
          error={error}
          busy={busy}
          onReasonChange={setReason}
          onCancel={() => setCorrection(null)}
          onExecute={() =>
            run(() =>
              executeRankedCorrection(
                correction.match,
                correction.preview,
                reason,
                correction.idempotencyKey,
                correction.replacementWinnerSeat,
                correction.replacementResultType
              )
            ).then((completed) => {
              if (completed) setCorrection(null);
            })
          }
        />
      ) : null}
    </div>
  );
}

function SeasonPanel({
  seasons,
  formalAlgorithm,
  formalRatingConfig,
  creating,
  editingSeason,
  busy,
  onToggleCreate,
  onEdit,
  onCancelEdit,
  onCreate,
  onUpdate,
  onUpdateActive,
  onAction,
  onAdmission,
}: {
  seasons: RankedAdminSeason[];
  formalAlgorithm: string;
  formalRatingConfig: RankedRatingConfig;
  creating: boolean;
  editingSeason: RankedAdminSeason | null;
  busy: boolean;
  onToggleCreate: () => void;
  onEdit: (season: RankedAdminSeason) => void;
  onCancelEdit: () => void;
  onCreate: (payload: RankedSeasonDraftPayload) => Promise<unknown>;
  onUpdate: (season: RankedAdminSeason, payload: RankedSeasonDraftPayload) => Promise<unknown>;
  onUpdateActive: (
    season: RankedAdminSeason,
    payload: RankedActiveSeasonOperationsPayload
  ) => Promise<unknown>;
  onAction: (
    season: RankedAdminSeason,
    action: 'activate' | 'finalize' | 'close'
  ) => Promise<unknown>;
  onAdmission: (season: RankedAdminSeason, admission: 'OPEN' | 'PAUSED') => Promise<unknown>;
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="button-secondary px-4 py-2 text-sm" onClick={onToggleCreate}>
          {creating ? '收起' : '新建赛季'}
        </button>
      </div>
      {creating ? (
        <SeasonDraftForm
          algorithm={formalAlgorithm}
          defaultRatingConfig={formalRatingConfig}
          busy={busy}
          onSubmit={onCreate}
        />
      ) : null}
      {editingSeason ? (
        editingSeason.lifecycle === 'DRAFT' ? (
          <SeasonDraftForm
            key={editingSeason.id}
            algorithm={formalAlgorithm}
            defaultRatingConfig={formalRatingConfig}
            busy={busy}
            season={editingSeason}
            onCancel={onCancelEdit}
            onSubmit={(payload) => onUpdate(editingSeason, payload)}
          />
        ) : (
          <ActiveSeasonOperationsForm
            key={editingSeason.id}
            busy={busy}
            season={editingSeason}
            onCancel={onCancelEdit}
            onSubmit={(payload) => onUpdateActive(editingSeason, payload)}
          />
        )
      ) : null}
      {seasons.length > 0 ? (
        <div className="product-workbench">
          {seasons.map((season) => (
            <section key={season.id} className="product-list-row p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-[var(--text-primary)]">{season.name}</h2>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {season.seasonKey} · {lifecycleLabel(season.lifecycle)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {season.lifecycle === 'DRAFT' ? (
                    <>
                      <button
                        className="button-secondary px-3 py-2 text-sm"
                        disabled={busy}
                        onClick={() => onEdit(season)}
                      >
                        编辑
                      </button>
                      <button
                        className="button-primary px-3 py-2 text-sm"
                        disabled={busy}
                        onClick={() => void onAction(season, 'activate')}
                      >
                        开始赛季
                      </button>
                    </>
                  ) : null}
                  {season.lifecycle === 'ACTIVE' ? (
                    <>
                      <button
                        className="button-secondary px-3 py-2 text-sm"
                        disabled={busy}
                        onClick={() => onEdit(season)}
                      >
                        编辑
                      </button>
                      <button
                        className="button-secondary px-3 py-2 text-sm"
                        disabled={busy}
                        onClick={() =>
                          void onAdmission(
                            season,
                            season.queueAdmission === 'OPEN' ? 'PAUSED' : 'OPEN'
                          )
                        }
                      >
                        {season.queueAdmission === 'OPEN' ? '暂停匹配' : '开放匹配'}
                      </button>
                      <button
                        className="rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-warning)_35%,var(--border-default))] px-3 py-2 text-sm text-[var(--semantic-warning)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--semantic-warning)_10%,transparent)]"
                        disabled={busy}
                        onClick={() => void onAction(season, 'finalize')}
                      >
                        结束赛季
                      </button>
                    </>
                  ) : null}
                  {season.lifecycle === 'FINALIZING' ? (
                    <button
                      className="button-primary px-3 py-2 text-sm"
                      disabled={busy}
                      onClick={() => void onAction(season, 'close')}
                    >
                      完成结算
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-muted)]">
                <span>匹配：{season.queueAdmission === 'OPEN' ? '开放' : '暂停'}</span>
                <span>排行榜：满 {season.leaderboardMinimumMatchCount} 场</span>
                <span>{formatOpenWindows(season.openWindows)}</span>
                <span>结束：{formatDate(season.scheduledEndsAt)}</span>
              </div>
            </section>
          ))}
        </div>
      ) : null}
      {seasons.length === 0 && !creating ? (
        <div className="product-workbench p-8 text-center text-sm text-[var(--text-muted)]">
          还没有赛季
        </div>
      ) : null}
    </div>
  );
}

function ActiveSeasonOperationsForm({
  busy,
  season,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  season: RankedAdminSeason;
  onCancel: () => void;
  onSubmit: (payload: RankedActiveSeasonOperationsPayload) => Promise<unknown>;
}) {
  const [name, setName] = useState(season.name);
  const [leaderboardMinimumMatchCount, setLeaderboardMinimumMatchCount] = useState(
    season.leaderboardMinimumMatchCount
  );
  const [openWindows, setOpenWindows] = useState(() =>
    season.openWindows.map((window) => ({
      weekdays: [...window.weekdays],
      startMinute: window.startMinute,
      endMinute: window.endMinute,
    }))
  );
  return (
    <form
      className="product-workbench grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({ name, openWindows, leaderboardMinimumMatchCount });
      }}
    >
      <div className="text-sm font-semibold text-[var(--text-primary)] sm:col-span-2">
        编辑进行中赛季
      </div>
      <Field label="名称">
        <input
          className="input-field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>
      <Field label="进入排行榜所需场次">
        <input
          type="number"
          min={1}
          max={100}
          step={1}
          className="input-field"
          value={leaderboardMinimumMatchCount}
          onChange={(event) => setLeaderboardMinimumMatchCount(Number(event.target.value))}
          required
        />
      </Field>
      <OpenWindowFields
        openWindow={openWindows[0]}
        onChange={(openWindow) => setOpenWindows([openWindow, ...openWindows.slice(1)])}
      />
      <div className="flex items-end justify-end gap-2 sm:col-span-2">
        <button type="button" className="button-secondary min-h-11 px-4" onClick={onCancel}>
          取消
        </button>
        <button className="button-primary min-h-11 px-5" disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : '保存'}
        </button>
      </div>
    </form>
  );
}

function SeasonDraftForm({
  algorithm,
  defaultRatingConfig,
  busy,
  season,
  onCancel,
  onSubmit,
}: {
  algorithm: string;
  defaultRatingConfig: RankedRatingConfig;
  busy: boolean;
  season?: RankedAdminSeason;
  onCancel?: () => void;
  onSubmit: (payload: RankedSeasonDraftPayload) => Promise<unknown>;
}) {
  const initial = useMemo(
    () =>
      season ? createDraftFromSeason(season) : createDraftDefaults(algorithm, defaultRatingConfig),
    [algorithm, defaultRatingConfig, season]
  );
  const [draft, setDraft] = useState(initial);
  return (
    <form
      className="product-workbench grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          ...draft,
          startsAt: new Date(draft.startsAt).toISOString(),
          scheduledEndsAt: new Date(draft.scheduledEndsAt).toISOString(),
          finalizingDeadlineAt: new Date(draft.finalizingDeadlineAt).toISOString(),
        });
      }}
    >
      <Field label="赛季标识">
        <input
          className="input-field"
          value={draft.seasonKey}
          onChange={(event) => setDraft({ ...draft, seasonKey: event.target.value })}
          required
        />
      </Field>
      <Field label="名称">
        <input
          className="input-field"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          required
        />
      </Field>
      <Field label="开始">
        <input
          type="datetime-local"
          className="input-field"
          value={draft.startsAt}
          onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
          required
        />
      </Field>
      <Field label="结束">
        <input
          type="datetime-local"
          className="input-field"
          value={draft.scheduledEndsAt}
          onChange={(event) => setDraft({ ...draft, scheduledEndsAt: event.target.value })}
          required
        />
      </Field>
      <Field label="最晚结算">
        <input
          type="datetime-local"
          className="input-field"
          value={draft.finalizingDeadlineAt}
          onChange={(event) => setDraft({ ...draft, finalizingDeadlineAt: event.target.value })}
          required
        />
      </Field>
      <Field label="进入排行榜所需场次">
        <input
          type="number"
          min={1}
          max={100}
          step={1}
          className="input-field"
          value={draft.leaderboardMinimumMatchCount}
          onChange={(event) =>
            setDraft({
              ...draft,
              leaderboardMinimumMatchCount: Number(event.target.value),
            })
          }
          required
        />
      </Field>
      <Field label="新赛季积分重置">
        <select
          className="input-field"
          value={draft.softReset.mode}
          onChange={(event) =>
            setDraft({
              ...draft,
              softReset: {
                ...draft.softReset,
                mode: event.target.value as RankedSeasonDraftPayload['softReset']['mode'],
              },
            })
          }
        >
          <option value="RESET_TO_INITIAL">重置为默认值</option>
          <option value="RETAIN_TOWARD_CENTER">向中心值保留</option>
        </select>
      </Field>
      {draft.softReset.mode === 'RETAIN_TOWARD_CENTER' ? (
        <>
          <Field label="重置中心值">
            <input
              type="number"
              className="input-field"
              value={draft.softReset.center}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  softReset: { ...draft.softReset, center: Number(event.target.value) },
                })
              }
              required
            />
          </Field>
          <Field label="原积分保留比例">
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              className="input-field"
              value={draft.softReset.retention}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  softReset: { ...draft.softReset, retention: Number(event.target.value) },
                })
              }
              required
            />
          </Field>
          <Field label="重置后最小 RD">
            <input
              type="number"
              min={1}
              className="input-field"
              value={draft.softReset.minimumDeviation}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  softReset: {
                    ...draft.softReset,
                    minimumDeviation: Number(event.target.value),
                  },
                })
              }
              required
            />
          </Field>
        </>
      ) : null}
      <OpenWindowFields
        openWindow={draft.openWindows[0]}
        onChange={(openWindow) =>
          setDraft({ ...draft, openWindows: [openWindow, ...draft.openWindows.slice(1)] })
        }
      />
      <div className="flex items-end justify-end gap-2">
        {onCancel ? (
          <button type="button" className="button-secondary min-h-11 px-4" onClick={onCancel}>
            取消
          </button>
        ) : null}
        <button className="button-primary min-h-11 px-5" disabled={busy}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : season ? '保存' : '创建赛季'}
        </button>
      </div>
    </form>
  );
}

function MatchesPanel({
  seasons,
  matches,
  selectedSeasonId,
  busy,
  onSelectSeason,
  onSettle,
  onCorrection,
}: {
  seasons: RankedAdminSeason[];
  matches: RankedAdminMatch[];
  selectedSeasonId: string;
  busy: boolean;
  onSelectSeason: (id: string) => void;
  onSettle: (match: RankedAdminMatch) => Promise<unknown>;
  onCorrection: (
    match: RankedAdminMatch,
    action: 'VOID' | 'REPLACE',
    replacementWinnerSeat?: 'FIRST' | 'SECOND'
  ) => Promise<void>;
}) {
  return (
    <div className="space-y-3">
      <select
        className="input-field max-w-xs"
        value={selectedSeasonId}
        onChange={(event) => onSelectSeason(event.target.value)}
      >
        <option value="">全部赛季</option>
        {seasons.map((season) => (
          <option key={season.id} value={season.id}>
            {season.name}
          </option>
        ))}
      </select>
      {matches.length > 0 ? (
        <div className="product-workbench">
          {matches.map((match) => (
            <section key={match.matchId} className="product-list-row p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                    {playerName(match.firstPlayer)} vs {playerName(match.secondPlayer)}
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                    {ratingStatusLabel(match.ratingStatus)} ·{' '}
                    {match.endedAt ? formatDate(match.endedAt) : '进行中'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {match.ratingStatus === 'PENDING' ? (
                    <button
                      className="button-primary px-3 py-2 text-sm"
                      disabled={busy}
                      onClick={() => void onSettle(match)}
                    >
                      重试计分
                    </button>
                  ) : null}
                  {match.ratingStatus === 'SETTLED' ? (
                    <>
                      <button
                        className="rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_32%,var(--border-default))] px-3 py-2 text-sm text-[var(--semantic-error)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--semantic-error)_10%,transparent)]"
                        disabled={busy}
                        onClick={() => void onCorrection(match, 'VOID')}
                      >
                        设为不计分
                      </button>
                      <button
                        className="button-secondary px-3 py-2 text-sm"
                        disabled={busy}
                        onClick={() =>
                          void onCorrection(
                            match,
                            'REPLACE',
                            match.winnerSeat === 'FIRST' ? 'SECOND' : 'FIRST'
                          )
                        }
                      >
                        改判
                      </button>
                    </>
                  ) : null}
                  {match.ratingStatus === 'VOIDED' ? (
                    <>
                      <button
                        className="button-secondary px-3 py-2 text-sm"
                        disabled={busy}
                        onClick={() => void onCorrection(match, 'REPLACE', 'FIRST')}
                      >
                        恢复为先攻胜
                      </button>
                      <button
                        className="button-secondary px-3 py-2 text-sm"
                        disabled={busy}
                        onClick={() => void onCorrection(match, 'REPLACE', 'SECOND')}
                      >
                        恢复为后攻胜
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </section>
          ))}
        </div>
      ) : null}
      {matches.length === 0 ? (
        <div className="product-workbench p-8 text-center text-sm text-[var(--text-muted)]">
          没有排位对局
        </div>
      ) : null}
    </div>
  );
}

function CorrectionDialog({
  correction,
  reason,
  error,
  busy,
  onReasonChange,
  onCancel,
  onExecute,
}: {
  correction: {
    match: RankedAdminMatch;
    preview: RankedCorrectionPreview;
    replacementWinnerSeat?: 'FIRST' | 'SECOND';
    replacementResultType?: 'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT';
    idempotencyKey: string;
  };
  reason: string;
  error: string | null;
  busy: boolean;
  onReasonChange: (value: string) => void;
  onCancel: () => void;
  onExecute: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4">
      <form
        className="surface-panel w-full max-w-md p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ranked-correction-title"
        onSubmit={(event) => {
          event.preventDefault();
          onExecute();
        }}
      >
        <h2 id="ranked-correction-title" className="font-semibold text-[var(--text-primary)]">
          {correction.preview.action === 'VOID' ? '设为不计分' : '改判结果'}
        </h2>
        {correction.preview.action === 'REPLACE' && correction.replacementWinnerSeat ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            胜方：
            <span className="font-semibold text-[var(--text-primary)]">
              {winnerName(correction.match, correction.match.winnerSeat)}
            </span>
            <span className="mx-1 text-[var(--text-muted)]">→</span>
            <span className="font-semibold text-[var(--text-primary)]">
              {winnerName(correction.match, correction.replacementWinnerSeat)}
            </span>
          </p>
        ) : null}
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          将影响 {correction.preview.affectedPlayerCount} 名玩家，赛季计分版本{' '}
          {correction.preview.currentLedgerRevision} → {correction.preview.projectedLedgerRevision}
        </p>
        <textarea
          className="input-field mt-4 min-h-24 w-full"
          placeholder="填写原因（至少 5 个字）"
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          minLength={5}
          required
        />
        {error ? <p className="mt-2 text-sm text-[var(--semantic-error)]">{error}</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            className="button-secondary min-h-11"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="submit"
            className={`min-h-11 rounded-lg border px-4 font-semibold transition-colors disabled:opacity-50 ${
              correction.preview.action === 'VOID'
                ? 'border-[color:color-mix(in_srgb,var(--semantic-error)_42%,transparent)] bg-[var(--semantic-error)] text-white hover:bg-[color:color-mix(in_srgb,var(--semantic-error)_86%,black)]'
                : 'button-primary'
            }`}
            disabled={busy}
          >
            确认执行
          </button>
        </div>
      </form>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${
        active ? 'bg-[var(--bg-overlay)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm text-[var(--text-secondary)]">
      {label}
      {children}
    </label>
  );
}

function OpenWindowFields({
  openWindow,
  onChange,
}: {
  openWindow?: { weekdays: number[]; startMinute: number; endMinute: number };
  onChange: (openWindow: { weekdays: number[]; startMinute: number; endMinute: number }) => void;
}) {
  const current = openWindow ?? {
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    startMinute: 0,
    endMinute: 1440,
  };
  return (
    <>
      <Field label="每日开放">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <input
            type="time"
            className="input-field"
            value={minuteToTime(current.startMinute)}
            onChange={(event) =>
              onChange({ ...current, startMinute: timeToMinute(event.target.value) })
            }
          />
          <span>—</span>
          <input
            type="time"
            className="input-field"
            value={minuteToTime(current.endMinute, true)}
            onChange={(event) =>
              onChange({ ...current, endMinute: timeToMinute(event.target.value, true) })
            }
          />
        </div>
      </Field>
      <Field label="开放日">
        <div className="grid grid-cols-7 gap-1">
          {['一', '二', '三', '四', '五', '六', '日'].map((label, index) => {
            const weekday = index + 1;
            const selected = current.weekdays.includes(weekday);
            return (
              <button
                key={weekday}
                type="button"
                className={`h-9 rounded-lg text-xs ${
                  selected
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]'
                }`}
                onClick={() => {
                  const weekdays = selected
                    ? current.weekdays.filter((value) => value !== weekday)
                    : [...current.weekdays, weekday].sort();
                  if (weekdays.length > 0) {
                    onChange({ ...current, weekdays });
                  }
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </Field>
    </>
  );
}

function createDraftDefaults(algorithm: string, ratingConfig: RankedRatingConfig) {
  const start = new Date();
  start.setMinutes(start.getMinutes() - start.getTimezoneOffset(), 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 28);
  const deadline = new Date(end);
  deadline.setDate(deadline.getDate() + 2);
  return {
    seasonKey: `season-${start.toISOString().slice(0, 10)}`,
    name: '新赛季',
    platformTimeZone: 'Asia/Shanghai',
    openWindows: [{ weekdays: [1, 2, 3, 4, 5, 6, 7], startMinute: 0, endMinute: 1440 }],
    startsAt: start.toISOString().slice(0, 16),
    scheduledEndsAt: end.toISOString().slice(0, 16),
    finalizingDeadlineAt: deadline.toISOString().slice(0, 16),
    ratingAlgorithmVersion: algorithm,
    softReset: {
      mode: ratingConfig.softResetMode,
      center: ratingConfig.softResetCenter,
      retention: ratingConfig.softResetRetention,
      minimumDeviation: ratingConfig.softResetMinimumDeviation,
    },
    leaderboardMinimumMatchCount: 10,
  };
}

function createDraftFromSeason(season: RankedAdminSeason) {
  const toLocalInput = (value: string) => {
    const date = new Date(value);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  };
  return {
    seasonKey: season.seasonKey,
    name: season.name,
    platformTimeZone: season.platformTimeZone,
    openWindows: season.openWindows.map((window) => ({
      weekdays: [...window.weekdays],
      startMinute: window.startMinute,
      endMinute: window.endMinute,
    })),
    startsAt: toLocalInput(season.startsAt),
    scheduledEndsAt: toLocalInput(season.scheduledEndsAt),
    finalizingDeadlineAt: toLocalInput(season.finalizingDeadlineAt),
    ratingAlgorithmVersion: season.ratingAlgorithmVersion,
    softReset: {
      mode: season.ratingConfig.softResetMode,
      center: season.ratingConfig.softResetCenter,
      retention: season.ratingConfig.softResetRetention,
      minimumDeviation: season.ratingConfig.softResetMinimumDeviation,
    },
    leaderboardMinimumMatchCount: season.leaderboardMinimumMatchCount,
  };
}

function minuteToTime(minute: number, isEnd = false) {
  if (isEnd && minute === 1440) return '00:00';
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

function timeToMinute(value: string, isEnd = false) {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  const result = hour * 60 + minute;
  return isEnd && result === 0 ? 1440 : result;
}

function lifecycleLabel(value: RankedAdminSeason['lifecycle']) {
  return { DRAFT: '未开始', ACTIVE: '开放中', FINALIZING: '结算中', CLOSED: '已结束' }[value];
}

function ratingStatusLabel(value: RankedAdminMatch['ratingStatus']) {
  return { PENDING: '等待计分', SETTLED: '已计分', VOIDED: '不计分' }[value];
}

function playerName(player: RankedAdminMatch['firstPlayer']) {
  return player.displayName || player.username;
}

function winnerName(match: RankedAdminMatch, winnerSeat: RankedAdminMatch['winnerSeat']): string {
  if (winnerSeat === 'FIRST') return playerName(match.firstPlayer);
  if (winnerSeat === 'SECOND') return playerName(match.secondPlayer);
  return '无';
}

function correctionResultTypeForMatch(
  match: RankedAdminMatch
): 'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT' {
  if (match.resultType === 'SURRENDER' || match.resultType === 'DISCONNECT_FORFEIT') {
    return match.resultType;
  }
  return match.priorResultType ?? 'NORMAL';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatOpenWindows(windows: RankedAdminSeason['openWindows']): string {
  const first = windows[0];
  if (!first) return '未设置时段';
  const weekdays =
    first.weekdays.length === 7
      ? '每天'
      : first.weekdays
          .map((weekday) => `周${['一', '二', '三', '四', '五', '六', '日'][weekday - 1]}`)
          .join('、');
  const time = `${minuteToTime(first.startMinute)}–${minuteToTime(first.endMinute, true)}`;
  return `${weekdays} ${time}${windows.length > 1 ? ` 等 ${windows.length} 个时段` : ''}`;
}

function readError(error: unknown) {
  return error instanceof Error ? error.message : '操作没有完成';
}
