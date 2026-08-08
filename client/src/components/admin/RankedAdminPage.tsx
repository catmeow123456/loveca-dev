import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Medal,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { PageHeader } from '@/components/common';
import { RankedSeasonNoticeDialog } from '@/components/ranked/RankedSeasonNoticeDialog';
import {
  createRankedSeason,
  applyRankedRatingRevision,
  executeRankedCorrection,
  fetchRankedEnvironment,
  fetchRankedMatches,
  fetchRankedRatingRevisions,
  fetchRankedSeasons,
  previewRankedRatingRevision,
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
  type RankedRatingRevisionHistoryItem,
  type RankedRatingRevisionParameters,
  type RankedRatingRevisionPreview,
  type RankedSeasonDraftPayload,
} from '@/lib/rankedAdminClient';

type Tab = 'season' | 'matches';
const MATCH_PAGE_SIZE = 20;

export function RankedAdminPage({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('season');
  const [seasons, setSeasons] = useState<RankedAdminSeason[]>([]);
  const [matches, setMatches] = useState<RankedAdminMatch[]>([]);
  const [matchTotal, setMatchTotal] = useState(0);
  const [matchPage, setMatchPage] = useState(0);
  const [matchUserQuery, setMatchUserQuery] = useState('');
  const [formalAlgorithm, setFormalAlgorithm] = useState('GLICKO1_PER_MATCH_V4');
  const [formalRatingConfig, setFormalRatingConfig] = useState<RankedRatingConfig>({
    algorithmVersion: 'GLICKO1_PER_MATCH_V4',
    ratingScale: 800,
    initialRating: 1500,
    initialRatingDeviation: 300,
    minimumRatingDeviation: 100,
    maximumRatingDeviation: 350,
    placementMatchCount: 5,
    softResetMode: 'RESET_TO_INITIAL',
    softResetCenter: 1500,
    softResetRetention: 0.5,
    softResetMinimumDeviation: 200,
    growthPool: {
      mode: 'POST_PLACEMENT_AVERAGE_CENTERED',
      enabled: true,
      centerRating: 1800,
      maximumTotalAdjustment: 16,
      transitionWidth: 250,
      positiveSplitMode: 'EQUAL',
      negativeWinnerShare: 0.75,
    },
  });
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingSeason, setEditingSeason] = useState<RankedAdminSeason | null>(null);
  const [noticeSeason, setNoticeSeason] = useState<RankedAdminSeason | null>(null);
  const [ratingRevisionSeason, setRatingRevisionSeason] = useState<RankedAdminSeason | null>(null);
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

  const loadMatchPage = async ({
    seasonId = selectedSeasonId,
    userQuery = matchUserQuery,
    page = matchPage,
  }: {
    seasonId?: string;
    userQuery?: string;
    page?: number;
  } = {}) => {
    const result = await fetchRankedMatches({
      seasonId: seasonId || undefined,
      userQuery: userQuery || undefined,
      limit: MATCH_PAGE_SIZE,
      offset: page * MATCH_PAGE_SIZE,
    });
    setMatches(result.matches);
    setMatchTotal(result.total);
  };

  const refreshMatchPage = async (options: Parameters<typeof loadMatchPage>[0]) => {
    setBusy(true);
    setError(null);
    try {
      await loadMatchPage(options);
    } catch (loadError) {
      setError(readError(loadError));
    } finally {
      setBusy(false);
    }
  };

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
      await loadMatchPage();
    } catch (loadError) {
      setError(readError(loadError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // Initial load intentionally defaults to all seasons and the first result page.
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
              onOpenSeasonNotice={setNoticeSeason}
              onOpenRatingRevision={setRatingRevisionSeason}
            />
          ) : (
            <MatchesPanel
              seasons={seasons}
              matches={matches}
              total={matchTotal}
              page={matchPage}
              pageSize={MATCH_PAGE_SIZE}
              userQuery={matchUserQuery}
              selectedSeasonId={selectedSeasonId}
              busy={busy}
              onSelectSeason={(seasonId) => {
                setSelectedSeasonId(seasonId);
                setMatchPage(0);
                void refreshMatchPage({ seasonId, page: 0 });
              }}
              onSearch={(userQuery) => {
                setMatchUserQuery(userQuery);
                setMatchPage(0);
                void refreshMatchPage({ userQuery, page: 0 });
              }}
              onPageChange={(page) => {
                setMatchPage(page);
                void refreshMatchPage({ page });
              }}
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
      <RankedSeasonNoticeDialog
        isOpen={noticeSeason !== null}
        seasonName={noticeSeason?.name}
        announcement={noticeSeason?.announcement}
        leaderboardMatchCount={noticeSeason?.leaderboardMinimumMatchCount}
        onClose={() => setNoticeSeason(null)}
      />
      {ratingRevisionSeason ? (
        <RatingRevisionDialog
          season={ratingRevisionSeason}
          onClose={() => setRatingRevisionSeason(null)}
          onApplied={async () => {
            setRatingRevisionSeason(null);
            await load();
          }}
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
  onOpenSeasonNotice,
  onOpenRatingRevision,
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
  onOpenSeasonNotice: (season: RankedAdminSeason) => void;
  onOpenRatingRevision: (season: RankedAdminSeason) => void;
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
                  <button
                    className="button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
                    onClick={() => onOpenSeasonNotice(season)}
                  >
                    <BookOpen size={15} />
                    查看公告
                  </button>
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
                      {supportsRatingRevision(season) ? (
                        <button
                          className="button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
                          disabled={busy}
                          onClick={() => onOpenRatingRevision(season)}
                        >
                          <SlidersHorizontal size={15} />
                          调整积分参数
                        </button>
                      ) : null}
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
  const leaderboardMatchCountIsFrozen = Boolean(season.ratingConfig.growthPool);
  const [name, setName] = useState(season.name);
  const [announcement, setAnnouncement] = useState(season.announcement);
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
        void onSubmit({ name, announcement, openWindows, leaderboardMinimumMatchCount });
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
          disabled={leaderboardMatchCountIsFrozen}
          required
        />
      </Field>
      <div className="sm:col-span-2">
        <Field label={`赛季公告（可选，${announcement.length}/2000）`}>
          <textarea
            className="input-field min-h-28 resize-y"
            value={announcement}
            maxLength={2000}
            placeholder="向玩家说明本赛季安排、奖励或注意事项"
            onChange={(event) => setAnnouncement(event.target.value)}
          />
        </Field>
      </div>
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
  const leaderboardMatchCountIsFrozen =
    draft.ratingAlgorithmVersion === defaultRatingConfig.algorithmVersion &&
    Boolean(defaultRatingConfig.growthPool);
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
      <div className="sm:col-span-2">
        <Field label={`赛季公告（可选，${draft.announcement.length}/2000）`}>
          <textarea
            className="input-field min-h-28 resize-y"
            value={draft.announcement}
            maxLength={2000}
            placeholder="向玩家说明本赛季安排、奖励或注意事项"
            onChange={(event) => setDraft({ ...draft, announcement: event.target.value })}
          />
        </Field>
      </div>
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
          disabled={leaderboardMatchCountIsFrozen}
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
  total,
  page,
  pageSize,
  userQuery,
  selectedSeasonId,
  busy,
  onSelectSeason,
  onSearch,
  onPageChange,
  onSettle,
  onCorrection,
}: {
  seasons: RankedAdminSeason[];
  matches: RankedAdminMatch[];
  total: number;
  page: number;
  pageSize: number;
  userQuery: string;
  selectedSeasonId: string;
  busy: boolean;
  onSelectSeason: (id: string) => void;
  onSearch: (userQuery: string) => void;
  onPageChange: (page: number) => void;
  onSettle: (match: RankedAdminMatch) => Promise<unknown>;
  onCorrection: (
    match: RankedAdminMatch,
    action: 'VOID' | 'REPLACE',
    replacementWinnerSeat?: 'FIRST' | 'SECOND'
  ) => Promise<void>;
}) {
  const [searchInput, setSearchInput] = useState(userQuery);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <form
        className="product-workbench grid gap-3 p-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(searchInput.trim());
        }}
      >
        <select
          className="input-field"
          value={selectedSeasonId}
          aria-label="筛选赛季"
          onChange={(event) => onSelectSeason(event.target.value)}
        >
          <option value="">全部赛季</option>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.name}
            </option>
          ))}
        </select>
        <input
          className="input-field"
          value={searchInput}
          aria-label="搜索对局用户"
          placeholder="搜索用户名、显示名称或用户 ID"
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <button className="button-primary inline-flex min-h-10 items-center justify-center gap-1.5 px-4 text-sm">
          <Search size={15} />
          搜索
        </button>
      </form>
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>共 {total} 场对局</span>
        {userQuery ? <span>当前搜索：{userQuery}</span> : <span>显示全部用户</span>}
      </div>
      {matches.length > 0 ? (
        <div className="product-workbench">
          {matches.map((match) => (
            <section key={match.matchId} className="product-list-row p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                    <MatchPlayerResult
                      name={playerName(match.firstPlayer)}
                      result={seatResult(match, 'FIRST')}
                    />
                    <span className="text-[var(--text-muted)]">vs</span>
                    <MatchPlayerResult
                      name={playerName(match.secondPlayer)}
                      result={seatResult(match, 'SECOND')}
                    />
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-muted)]">
                    {match.seasonKey} · {ratingStatusLabel(match.ratingStatus)} ·{' '}
                    {match.winnerSeat
                      ? `胜者：${winnerName(match, match.winnerSeat)} · ${resultTypeLabel(match.resultType)}`
                      : '胜负未定'}{' '}
                    · {match.endedAt ? formatDate(match.endedAt) : '进行中'}
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
          没有符合条件的排位对局
        </div>
      ) : null}
      {total > 0 ? (
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            type="button"
            className="button-secondary inline-flex h-9 items-center gap-1 px-3 text-xs"
            disabled={busy || page === 0}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft size={14} />
            上一页
          </button>
          <span className="min-w-20 text-center text-xs text-[var(--text-muted)]">
            {page + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="button-secondary inline-flex h-9 items-center gap-1 px-3 text-xs"
            disabled={busy || page + 1 >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            下一页
            <ChevronRight size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MatchPlayerResult({ name, result }: { name: string; result: 'WIN' | 'LOSS' | 'PENDING' }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate">{name}</span>
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
          result === 'WIN'
            ? 'bg-[color:color-mix(in_srgb,var(--semantic-success)_16%,transparent)] text-[var(--semantic-success)]'
            : result === 'LOSS'
              ? 'bg-[var(--bg-overlay)] text-[var(--text-muted)]'
              : 'bg-[color:color-mix(in_srgb,var(--semantic-warning)_14%,transparent)] text-[var(--semantic-warning)]'
        }`}
      >
        {result === 'WIN' ? '胜' : result === 'LOSS' ? '负' : '待定'}
      </span>
    </span>
  );
}

function RatingRevisionDialog({
  season,
  onClose,
  onApplied,
}: {
  season: RankedAdminSeason;
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [parameters, setParametersState] = useState<RankedRatingRevisionParameters>(() =>
    revisionParametersFromConfig(season.ratingConfig)
  );
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<RankedRatingRevisionPreview | null>(null);
  const [history, setHistory] = useState<RankedRatingRevisionHistoryItem[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supportsGrowth = Boolean(season.ratingConfig.growthPool);
  const originalRevision = history.at(-1);

  useEffect(() => {
    let active = true;
    void fetchRankedRatingRevisions(season.id)
      .then((items) => {
        if (active) setHistory(items);
      })
      .catch((loadError) => {
        if (active) setError(readError(loadError));
      });
    return () => {
      active = false;
    };
  }, [season.id]);

  const setParameters = (value: RankedRatingRevisionParameters) => {
    setParametersState(value);
    setPreview(null);
    setConfirmed(false);
  };

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    setConfirmed(false);
    try {
      setPreview(await previewRankedRatingRevision(season.id, parameters, reason));
    } catch (previewError) {
      setPreview(null);
      setError(readError(previewError));
    } finally {
      setBusy(false);
    }
  };

  const applyPreview = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await applyRankedRatingRevision(season.id, preview);
      await onApplied();
    } catch (applyError) {
      setError(readError(applyError));
    } finally {
      setBusy(false);
    }
  };

  const sortedChanges = useMemo(
    () =>
      [...(preview?.playerChanges ?? [])]
        .sort((first, second) => Math.abs(second.ratingDelta) - Math.abs(first.ratingDelta))
        .slice(0, 20),
    [preview]
  );

  return (
    <div className="fixed inset-0 z-[130] overflow-y-auto bg-black/60 p-4">
      <div
        className="surface-panel mx-auto my-4 w-full max-w-3xl p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ranked-rating-revision-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="ranked-rating-revision-title"
              className="font-semibold text-[var(--text-primary)]"
            >
              调整积分参数并全赛季回算
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {season.name} ·
              这是维护期高风险操作，必须先预览；应用时需暂停匹配且清空所有排位运行状态。
            </p>
          </div>
          <button
            className="button-secondary shrink-0 whitespace-nowrap px-3 py-2 text-sm"
            disabled={busy}
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        {history.length > 0 ? (
          <Field label="复用已应用过的参数">
            <select
              className="input-field mt-3"
              defaultValue=""
              onChange={(event) => {
                const selectedConfig =
                  event.target.value === 'original'
                    ? originalRevision?.sourceConfig
                    : history.find((candidate) => candidate.id === event.target.value)
                        ?.targetConfig;
                if (selectedConfig) {
                  setParameters(revisionParametersFromConfig(selectedConfig));
                  setPreview(null);
                  setConfirmed(false);
                }
              }}
            >
              <option value="">不复用，编辑当前参数</option>
              {originalRevision ? <option value="original">修订前原始参数</option> : null}
              {history.map((item) => (
                <option key={item.id} value={item.id}>
                  第 {item.revisionNumber} 版{item.current ? '（当前）' : ''} ·{' '}
                  {new Date(item.appliedAt).toLocaleString('zh-CN')}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <form
          className="mt-4 grid gap-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            void runPreview();
          }}
        >
          <RevisionNumberField
            label="Rating Scale"
            value={parameters.ratingScale}
            minimum={200}
            maximum={2000}
            onChange={(value) => setParameters({ ...parameters, ratingScale: value })}
          />
          <RevisionNumberField
            label="最低 RD"
            value={parameters.minimumRatingDeviation}
            minimum={30}
            maximum={200}
            onChange={(value) => setParameters({ ...parameters, minimumRatingDeviation: value })}
          />
          <RevisionNumberField
            label="定级/参榜场次"
            value={parameters.placementMatchCount}
            minimum={1}
            maximum={30}
            step={1}
            onChange={(value) => setParameters({ ...parameters, placementMatchCount: value })}
          />
          {supportsGrowth && parameters.growthPool ? (
            <>
              <label className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3 text-sm text-[var(--text-secondary)] sm:col-span-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={parameters.growthPool.enabled}
                  onChange={(event) =>
                    setParameters({
                      ...parameters,
                      growthPool: { ...parameters.growthPool!, enabled: event.target.checked },
                    })
                  }
                />
                <span>
                  <span className="block font-semibold text-[var(--text-primary)]">
                    启用成长补偿
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">
                    关闭后，本赛季所有已完成定级的对局都会按纯 Glicko
                    重新计算；其余设置会保留，方便之后重新启用。
                  </span>
                </span>
              </label>
              <RevisionNumberField
                label="成长基准分"
                value={parameters.growthPool.centerRating}
                minimum={1400}
                maximum={2400}
                disabled={!parameters.growthPool.enabled}
                onChange={(value) =>
                  setParameters({
                    ...parameters,
                    growthPool: { ...parameters.growthPool!, centerRating: value },
                  })
                }
              />
              <RevisionNumberField
                label="最大单局注入/回收总分"
                value={parameters.growthPool.maximumTotalAdjustment}
                minimum={1}
                maximum={50}
                disabled={!parameters.growthPool.enabled}
                onChange={(value) =>
                  setParameters({
                    ...parameters,
                    growthPool: { ...parameters.growthPool!, maximumTotalAdjustment: value },
                  })
                }
              />
              <RevisionNumberField
                label="高分局胜方回收比例（0–1）"
                value={parameters.growthPool.negativeWinnerShare}
                minimum={0.5}
                maximum={1}
                step={0.01}
                disabled={!parameters.growthPool.enabled}
                onChange={(value) =>
                  setParameters({
                    ...parameters,
                    growthPool: { ...parameters.growthPool!, negativeWinnerShare: value },
                  })
                }
              />
              <details className="rounded-lg border border-[var(--border-subtle)] sm:col-span-3">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--text-secondary)]">
                  高级选项
                </summary>
                <div className="border-t border-[var(--border-subtle)] p-3 sm:w-1/3">
                  <RevisionNumberField
                    label="过渡宽度"
                    value={parameters.growthPool.transitionWidth}
                    minimum={50}
                    maximum={1000}
                    disabled={!parameters.growthPool.enabled}
                    description="数值越小，越快从低分正和切换到高分负和；默认 250。"
                    onChange={(value) =>
                      setParameters({
                        ...parameters,
                        growthPool: { ...parameters.growthPool!, transitionWidth: value },
                      })
                    }
                  />
                </div>
              </details>
            </>
          ) : null}
          <label className="grid gap-1 text-sm text-[var(--text-secondary)] sm:col-span-3">
            调整原因
            <textarea
              className="input-field min-h-20"
              value={reason}
              minLength={5}
              maxLength={1000}
              placeholder="说明为什么调整，将进入永久审计记录"
              onChange={(event) => {
                setReason(event.target.value);
                setPreview(null);
                setConfirmed(false);
              }}
              required
            />
          </label>
          <div className="flex justify-end sm:col-span-3">
            <button className="button-primary min-h-11 px-5" disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : '生成回算预览'}
            </button>
          </div>
        </form>

        {error ? (
          <p className="mt-4 rounded-lg bg-[var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]">
            {error}
          </p>
        ) : null}

        {preview ? (
          <section className="mt-5 border-t border-[var(--border-subtle)] pt-4">
            <h3 className="font-semibold text-[var(--text-primary)]">回算预览</h3>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <PreviewMetric label="有效对局" value={preview.materializedMatchCount} />
              <PreviewMetric label="变化对局" value={preview.affectedMatchCount} />
              <PreviewMetric label="变化玩家" value={preview.affectedPlayerCount} />
              <PreviewMetric label="新进排行榜" value={preview.leaderboardEnteredCount} />
              <PreviewMetric label="离开排行榜" value={preview.leaderboardLeftCount} />
              <PreviewMetric
                label="最大分数变化"
                value={formatSignedMagnitude(preview.maximumAbsoluteRatingChange)}
              />
              <PreviewMetric label="榜内最大名次变化" value={preview.maximumAbsoluteRankChange} />
              <PreviewMetric
                label="最大单局差异"
                value={formatSignedMagnitude(preview.maximumAbsolutePerMatchDeltaChange)}
              />
              <PreviewMetric label="Seed RD 夹取" value={preview.seedDeviationClampCount} />
              <PreviewMetric
                label="流水版本"
                value={`${preview.sourceLedgerRevision} → ${preview.projectedLedgerRevision}`}
              />
            </div>
            <RevisionBlockers
              blockers={preview.blockers}
              queuePaused={season.queueAdmission === 'PAUSED'}
            />
            {sortedChanges.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-xs">
                  <thead className="text-[var(--text-muted)]">
                    <tr>
                      <th className="py-2 pr-3">玩家</th>
                      <th className="py-2 pr-3">积分</th>
                      <th className="py-2 pr-3">变化</th>
                      <th className="py-2 pr-3">RD</th>
                      <th className="py-2">名次</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedChanges.map((change) => (
                      <tr key={change.userId} className="border-t border-[var(--border-subtle)]">
                        <td className="py-2 pr-3 font-medium text-[var(--text-primary)]">
                          {change.playerName}
                        </td>
                        <td className="py-2 pr-3">
                          {formatRating(change.before?.rating)} →{' '}
                          {formatRating(change.after?.rating)}
                        </td>
                        <td className="py-2 pr-3">{formatDelta(change.ratingDelta)}</td>
                        <td className="py-2 pr-3">
                          {formatRating(change.before?.ratingDeviation)} →{' '}
                          {formatRating(change.after?.ratingDeviation)}
                        </td>
                        <td className="py-2">
                          {change.rankBefore ?? '未参榜'} → {change.rankAfter ?? '未参榜'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--text-muted)]">当前没有玩家积分变化。</p>
            )}
            <label className="mt-4 flex items-start gap-2 text-sm text-[var(--text-secondary)]">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                我已核对预览差异，理解应用后会用新参数原子重建本赛季全部积分与单局历史投影。
              </span>
            </label>
            <div className="mt-4 flex justify-end">
              <button
                className="rounded-lg bg-[var(--semantic-warning)] px-5 py-3 font-semibold text-white disabled:opacity-50"
                disabled={busy || !confirmed || !preview.canApply}
                onClick={() => void applyPreview()}
              >
                确认应用并全赛季回算
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function RevisionNumberField({
  label,
  value,
  minimum,
  maximum,
  step = 1,
  disabled = false,
  description,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step?: number;
  disabled?: boolean;
  description?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        className="input-field"
        min={minimum}
        max={maximum}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        required
      />
      {description ? <span className="text-xs text-[var(--text-muted)]">{description}</span> : null}
    </Field>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-[var(--bg-overlay)] p-2">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="mt-0.5 font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function RevisionBlockers({
  blockers,
  queuePaused,
}: {
  blockers: RankedRatingRevisionPreview['blockers'];
  queuePaused: boolean;
}) {
  const entries = [
    ['待结算对局', blockers.pendingMatches],
    ['进行中对局', blockers.runningMatches],
    ['活动票据', blockers.activeTickets],
    ['活动预留', blockers.activeReservations],
    ['玩家占用', blockers.activeParticipations],
    ['对局冻结环境异常', blockers.matchEnvironmentMismatches],
    ['对局规则版本异常', blockers.matchRecordRulesMismatches],
  ] as const;
  const blocked = !queuePaused || entries.some(([, count]) => count > 0);
  return (
    <div
      className={`mt-3 rounded-lg px-3 py-2 text-sm ${
        blocked
          ? 'bg-[var(--semantic-warning)]/10 text-[var(--semantic-warning)]'
          : 'bg-[var(--semantic-success)]/10 text-[var(--semantic-success)]'
      }`}
    >
      {queuePaused ? '匹配已暂停' : '匹配尚未暂停'}
      {' · '}
      {entries.map(([label, count]) => `${label} ${count}`).join(' · ')}
    </div>
  );
}

function supportsRatingRevision(season: RankedAdminSeason): boolean {
  const baseVersion =
    season.ratingConfig.parameterRevision?.baseAlgorithmVersion ?? season.ratingAlgorithmVersion;
  return baseVersion === 'GLICKO1_PER_MATCH_V3' || baseVersion === 'GLICKO1_PER_MATCH_V4';
}

function revisionParametersFromConfig(config: RankedRatingConfig): RankedRatingRevisionParameters {
  return {
    ratingScale: config.ratingScale,
    minimumRatingDeviation: config.minimumRatingDeviation,
    placementMatchCount: config.placementMatchCount,
    ...(config.growthPool
      ? {
          growthPool: {
            enabled: config.growthPool.enabled,
            centerRating: config.growthPool.centerRating,
            maximumTotalAdjustment: config.growthPool.maximumTotalAdjustment,
            transitionWidth: config.growthPool.transitionWidth,
            negativeWinnerShare: config.growthPool.negativeWinnerShare,
          },
        }
      : {}),
  };
}

function formatRating(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(1);
}

function formatDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function formatSignedMagnitude(value: number): string {
  return value.toFixed(1);
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
    announcement: '',
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
    leaderboardMinimumMatchCount: ratingConfig.placementMatchCount,
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
    announcement: season.announcement,
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

function seatResult(match: RankedAdminMatch, seat: 'FIRST' | 'SECOND'): 'WIN' | 'LOSS' | 'PENDING' {
  if (!match.winnerSeat) return 'PENDING';
  return match.winnerSeat === seat ? 'WIN' : 'LOSS';
}

function resultTypeLabel(value: string | null): string {
  return (
    {
      NORMAL: '正常结束',
      SURRENDER: '认输',
      DISCONNECT_FORFEIT: '断线判负',
      PLATFORM_NO_CONTEST: '平台无结果',
    }[value ?? ''] ??
    value ??
    '结果待定'
  );
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
