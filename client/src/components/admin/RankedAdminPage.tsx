import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  ImageIcon,
  Award,
} from 'lucide-react';
import { AdminPageHeader } from './AdminPageHeader';
import { AdminViewTabs } from './AdminViewTabs';
import { SeasonOpenWindowsFields } from './SeasonOpenWindowsFields';
import { ConfirmDialog, SelectMenu, type SelectMenuOption } from '@/components/common';
import { RankedSeasonNoticeDialog } from '@/components/ranked/RankedSeasonNoticeDialog';
import { ActivityCoverEditor } from '@/components/activity-cover/ActivityCoverEditor';
import { ActivityBadgeEditor } from '@/components/activity-badge/ActivityBadgeEditor';
import {
  createRankedSeason,
  deleteRankedSeasonDraft,
  applyRankedRatingRevision,
  executeRankedCorrection,
  fetchRankedAdminDeckStatistics,
  fetchRankedAdminPlayers,
  fetchRankedEnvironment,
  fetchRankedMatch,
  fetchRankedMatches,
  fetchRankedOverview,
  fetchRankedRatingRevisions,
  fetchRankedSeasons,
  previewRankedRatingRevision,
  previewRankedCorrection,
  rankedAdminPlayerSnapshotKey,
  runRankedSeasonAction,
  setRankedAdmission,
  settleRankedMatch,
  updateActiveRankedSeasonOperations,
  updateRankedSeason,
  type RankedActiveSeasonOperationsPayload,
  type RankedAdminMatch,
  type RankedAdminMatchDeck,
  type RankedAdminMatchDeckCard,
  type RankedAdminMatchDetail,
  type RankedAdminOverview,
  type RankedAdminDeckStatistics as RankedAdminDeckStatisticsData,
  type RankedAdminDeckStatisticsCategory,
  type RankedAdminPlayerListItem,
  type RankedAdminPlayerPage,
  type RankedAdminPlayerStatus,
  type RankedAdminPlayerSummary,
  type RankedAdminSeason,
  type RankedCorrectionPreview,
  type RankedRatingConfig,
  type RankedRatingRevisionHistoryItem,
  type RankedRatingRevisionParameters,
  type RankedRatingRevisionPreview,
  type RankedSeasonDraftPayload,
} from '@/lib/rankedAdminClient';
import { resolveCardImagePath } from '@/lib/imageService';
import {
  formatRankedOpenWindows,
  getRankedOpenWindowsValidationError,
  prepareRankedOpenWindowsForApi,
  prepareRankedOpenWindowsForForm,
} from '@/lib/rankedOpenWindows';

type Tab = 'overview' | 'season' | 'matches';
type MatchRatingStatus = RankedAdminMatch['ratingStatus'] | '';
const MATCH_PAGE_SIZE = 20;
const RANKED_PLAYER_PAGE_SIZE = 50;
const RANKED_PLAYER_LOCATE_WINDOW_SIZE = 7;
const RANKED_PLAYER_SEARCH_LIMIT = 10;
const RANKED_PLAYER_LOCATE_MAX_SNAPSHOT_RETRIES = 1;
const DECK_CATEGORY_PREVIEW_COUNT = 3;
const MATCH_RATING_STATUS_OPTIONS: readonly SelectMenuOption<MatchRatingStatus>[] = [
  { value: '', label: '全部计分状态' },
  { value: 'PENDING', label: '等待计分' },
  { value: 'SETTLED', label: '已计分' },
  { value: 'VOIDED', label: '不计分' },
];
const SOFT_RESET_MODE_OPTIONS: readonly SelectMenuOption<
  RankedSeasonDraftPayload['softReset']['mode']
>[] = [
  { value: 'RESET_TO_INITIAL', label: '重置为默认值' },
  { value: 'RETAIN_TOWARD_CENTER', label: '向中心值保留' },
];

export function RankedAdminPage({
  onBack,
  battleTimeouts,
  onOpenDeckClassifier,
}: {
  onBack: () => void;
  battleTimeouts: import('@game/online/ranked-policy').BattleTimeoutConfig;
  onOpenDeckClassifier: (source: {
    readonly matchId: string;
    readonly seat: 'FIRST' | 'SECOND';
    readonly name: string;
    readonly note: string;
  }) => void;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [seasons, setSeasons] = useState<RankedAdminSeason[]>([]);
  const [overview, setOverview] = useState<RankedAdminOverview | null>(null);
  const [overviewSeasonId, setOverviewSeasonId] = useState('');
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [insightsRefreshRevision, setInsightsRefreshRevision] = useState(0);
  const overviewRequestSequence = useRef(0);
  const matchRequestSequence = useRef(0);
  const [matches, setMatches] = useState<RankedAdminMatch[]>([]);
  const [matchBusy, setMatchBusy] = useState(false);
  const matchBusySequence = useRef(0);
  const [matchTotal, setMatchTotal] = useState(0);
  const [matchPage, setMatchPage] = useState(0);
  const [matchUserQuery, setMatchUserQuery] = useState('');
  const [matchRatingStatus, setMatchRatingStatus] = useState<MatchRatingStatus>('');
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
  const [deletingSeason, setDeletingSeason] = useState<RankedAdminSeason | null>(null);
  const [noticeSeason, setNoticeSeason] = useState<RankedAdminSeason | null>(null);
  const [coverSeason, setCoverSeason] = useState<RankedAdminSeason | null>(null);
  const [badgeSeason, setBadgeSeason] = useState<RankedAdminSeason | null>(null);
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
    ratingStatus = matchRatingStatus,
    page = matchPage,
  }: {
    seasonId?: string;
    userQuery?: string;
    ratingStatus?: MatchRatingStatus;
    page?: number;
  } = {}) => {
    const requestSequence = ++matchRequestSequence.current;
    try {
      const result = await fetchRankedMatches({
        seasonId: seasonId || undefined,
        userQuery: userQuery || undefined,
        ratingStatus: ratingStatus || undefined,
        limit: MATCH_PAGE_SIZE,
        offset: page * MATCH_PAGE_SIZE,
      });
      if (matchRequestSequence.current !== requestSequence) return;
      setMatches(result.matches);
      setMatchTotal(result.total);
    } catch (loadError) {
      if (matchRequestSequence.current === requestSequence) throw loadError;
    }
  };

  const loadOverview = async (seasonId: string) => {
    const requestSequence = ++overviewRequestSequence.current;
    if (!seasonId) {
      setOverview(null);
      setOverviewBusy(false);
      return;
    }
    setOverviewBusy(true);
    try {
      const result = await fetchRankedOverview(seasonId);
      if (overviewRequestSequence.current === requestSequence) setOverview(result);
    } catch (loadError) {
      if (overviewRequestSequence.current === requestSequence) throw loadError;
    } finally {
      if (overviewRequestSequence.current === requestSequence) setOverviewBusy(false);
    }
  };

  const refreshOverview = async (seasonId: string) => {
    setError(null);
    try {
      await loadOverview(seasonId);
    } catch (loadError) {
      setError(readError(loadError));
    }
  };

  const refreshMatchPage = async (options: Parameters<typeof loadMatchPage>[0]) => {
    const busySequence = ++matchBusySequence.current;
    setMatchBusy(true);
    setError(null);
    try {
      await loadMatchPage(options);
    } catch (loadError) {
      setError(readError(loadError));
    } finally {
      if (matchBusySequence.current === busySequence) setMatchBusy(false);
    }
  };

  const load = async () => {
    setInsightsRefreshRevision((current) => current + 1);
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
      const nextMatchSeasonId = seasonList.some((season) => season.id === selectedSeasonId)
        ? selectedSeasonId
        : '';
      const nextMatchPage = nextMatchSeasonId === selectedSeasonId ? matchPage : 0;
      setSelectedSeasonId(nextMatchSeasonId);
      setMatchPage(nextMatchPage);
      const nextOverviewSeasonId = seasonList.some((season) => season.id === overviewSeasonId)
        ? overviewSeasonId
        : preferredOverviewSeasonId(seasonList);
      setOverviewSeasonId(nextOverviewSeasonId);
      await Promise.all([
        loadMatchPage({ seasonId: nextMatchSeasonId, page: nextMatchPage }),
        loadOverview(nextOverviewSeasonId),
      ]);
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
      <AdminPageHeader
        title="赛季排位管理"
        category="对局与赛季"
        onBack={onBack}
        actions={
          <>
            <button className="button-icon" onClick={() => void load()} aria-label="刷新">
              <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
            </button>
          </>
        }
      />

      <main className="product-page-main flex-1">
        <div className="mx-auto w-full max-w-5xl">
          <AdminViewTabs
            label="排位管理视图"
            value={tab}
            tabs={[
              { value: 'overview', label: '概览' },
              { value: 'season', label: '赛季' },
              { value: 'matches', label: '对局处理' },
            ]}
            onChange={setTab}
          />
          {error ? (
            <p className="mb-4 rounded-xl bg-[var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]">
              {error}
            </p>
          ) : null}
          {tab === 'overview' ? (
            <OverviewPanel
              seasons={seasons}
              selectedSeasonId={overviewSeasonId}
              overview={overview}
              busy={overviewBusy}
              insightsRefreshRevision={insightsRefreshRevision}
              onSelectSeason={(seasonId) => {
                setOverviewSeasonId(seasonId);
                setOverview(null);
                void refreshOverview(seasonId);
              }}
            />
          ) : tab === 'season' ? (
            <div className="space-y-4">
              {coverSeason ? (
                <ActivityCoverEditor
                  key={coverSeason.id}
                  activityType="RANKED"
                  activityId={coverSeason.id}
                  activityName={coverSeason.name}
                  onClose={() => setCoverSeason(null)}
                  onPublished={load}
                />
              ) : null}
              {badgeSeason ? (
                <ActivityBadgeEditor
                  key={badgeSeason.id}
                  activityType="RANKED"
                  activityId={badgeSeason.id}
                  activityName={badgeSeason.name}
                  onClose={() => setBadgeSeason(null)}
                />
              ) : null}
              <SeasonPanel
                seasons={seasons}
                formalAlgorithm={formalAlgorithm}
                formalRatingConfig={formalRatingConfig}
                creating={creating}
                editingSeason={editingSeason}
                busy={busy || matchBusy}
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
                onDelete={setDeletingSeason}
                onAdmission={(season, admission) =>
                  run(() => setRankedAdmission(season.id, admission))
                }
                onOpenSeasonNotice={setNoticeSeason}
                onOpenCover={(season) => {
                  setBadgeSeason(null);
                  setCoverSeason(season);
                }}
                onOpenBadge={(season) => {
                  setCoverSeason(null);
                  setBadgeSeason(season);
                }}
                onOpenRatingRevision={setRatingRevisionSeason}
              />
            </div>
          ) : (
            <MatchesPanel
              seasons={seasons}
              matches={matches}
              total={matchTotal}
              page={matchPage}
              pageSize={MATCH_PAGE_SIZE}
              userQuery={matchUserQuery}
              ratingStatus={matchRatingStatus}
              selectedSeasonId={selectedSeasonId}
              busy={busy || matchBusy}
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
              onSelectRatingStatus={(ratingStatus) => {
                setMatchRatingStatus(ratingStatus);
                setMatchPage(0);
                void refreshMatchPage({ ratingStatus, page: 0 });
              }}
              onPageChange={(page) => {
                setMatchPage(page);
                void refreshMatchPage({ page });
              }}
              onSettle={(match) => run(() => settleRankedMatch(match.matchId))}
              onCorrection={startCorrection}
              onOpenDeckClassifier={onOpenDeckClassifier}
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
        battleTimeouts={battleTimeouts}
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
      <ConfirmDialog
        isOpen={deletingSeason !== null}
        title="删除未开始赛季？"
        message={
          deletingSeason
            ? `将永久删除“${deletingSeason.name}”（${deletingSeason.seasonKey}）。此操作不可恢复，已经开始的赛季不会受到影响。`
            : ''
        }
        confirmLabel="确认删除"
        isConfirming={busy}
        onCancel={() => setDeletingSeason(null)}
        onConfirm={() => {
          if (!deletingSeason) return;
          const target = deletingSeason;
          void run(() => deleteRankedSeasonDraft(target.id)).then((deleted) => {
            if (!deleted) return;
            if (editingSeason?.id === target.id) setEditingSeason(null);
            if (noticeSeason?.id === target.id) setNoticeSeason(null);
            setDeletingSeason(null);
          });
        }}
      />
    </div>
  );
}

function OverviewPanel({
  seasons,
  selectedSeasonId,
  overview,
  busy,
  insightsRefreshRevision,
  onSelectSeason,
}: {
  seasons: RankedAdminSeason[];
  selectedSeasonId: string;
  overview: RankedAdminOverview | null;
  busy: boolean;
  insightsRefreshRevision: number;
  onSelectSeason: (seasonId: string) => void;
}) {
  const season = seasons.find((item) => item.id === selectedSeasonId) ?? null;
  if (seasons.length === 0) {
    return (
      <div className="product-workbench p-8 text-center text-sm text-[var(--text-muted)]">
        还没有可查看的赛季
      </div>
    );
  }

  const statistics = overview?.statistics;
  const health = overview?.health;
  const hasPendingRating = (health?.pendingMatches ?? 0) > 0;
  const healthSummary = !overview
    ? busy
      ? '读取运行状态中…'
      : '暂无运行状态'
    : hasPendingRating
      ? '有待计分对局需关注'
      : '运行健康，无待计分积压';
  const metricItems: { label: string; value: string }[] = [
    { label: '总参赛人数', value: formatOverviewInteger(statistics?.totalParticipants) },
    {
      label: '完成定级人数',
      value: formatOverviewInteger(statistics?.placementCompletedPlayers),
    },
    {
      label: '进入排行榜人数',
      value: formatOverviewInteger(statistics?.leaderboardPlayers),
    },
    { label: '总有效对局', value: formatOverviewInteger(statistics?.totalSettledMatches) },
    { label: '今日对局', value: formatOverviewInteger(statistics?.matchesToday) },
    { label: '近 7 日对局', value: formatOverviewInteger(statistics?.matchesLast7Days) },
    {
      label: '近 7 日活跃玩家',
      value: formatOverviewInteger(statistics?.activePlayersLast7Days),
    },
    {
      label: '每名玩家平均场次',
      value: statistics ? statistics.averageMatchesPerPlayer.toFixed(1) : '—',
    },
    {
      label: '排行榜最低分',
      value:
        statistics?.leaderboardCutoffRating === null ||
        statistics?.leaderboardCutoffRating === undefined
          ? '—'
          : statistics.leaderboardCutoffRating.toFixed(1),
    },
  ];

  return (
    <div className="space-y-4">
      <section className="product-workbench p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="grid max-w-sm gap-1 text-sm text-[var(--text-secondary)]">
              <span>查看赛季</span>
              <SelectMenu
                label="概览赛季"
                value={selectedSeasonId}
                options={seasons.map((item) => ({ value: item.id, label: item.name }))}
                onChange={onSelectSeason}
                className="w-full"
                menuMinWidth={256}
              />
            </div>
          </div>
          <div className="text-right text-xs text-[var(--text-muted)]">
            <div>{season ? `${season.seasonKey} · ${lifecycleLabel(season.lifecycle)}` : '—'}</div>
            <div className="mt-1">
              {overview
                ? `更新于 ${formatDate(overview.generatedAt)}`
                : busy
                  ? '读取中…'
                  : '暂无数据'}
            </div>
          </div>
        </div>
      </section>

      {season ? (
        <section className="product-workbench p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-[var(--text-primary)]">运行状态</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                赛季状态、匹配开关与当前开放时段的实际组合结果
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                season.effectiveQueueOpen
                  ? 'bg-[color:color-mix(in_srgb,var(--semantic-success)_14%,transparent)] text-[var(--semantic-success)]'
                  : 'bg-[var(--bg-overlay)] text-[var(--text-muted)]'
              }`}
            >
              {season.effectiveQueueOpen ? '当前可匹配' : '当前不可匹配'}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <OverviewStatus label="赛季周期" value={lifecycleLabel(season.lifecycle)} />
            <OverviewStatus
              label="匹配开关"
              value={season.queueAdmission === 'OPEN' ? '开放' : '暂停'}
            />
            <OverviewStatus
              label="开放时段"
              value={season.withinOpenWindow ? '时段内' : '时段外'}
            />
            <OverviewStatus
              label="实际入队"
              value={season.effectiveQueueOpen ? '允许' : '不允许'}
            />
          </div>
        </section>
      ) : null}

      <section className="product-workbench p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-[var(--text-primary)]">运行健康</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              候场、预留与对局结算的实时积压情况
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              !overview
                ? 'bg-[var(--bg-overlay)] text-[var(--text-muted)]'
                : hasPendingRating
                  ? 'bg-[color:color-mix(in_srgb,var(--semantic-warning)_14%,transparent)] text-[var(--semantic-warning)]'
                  : 'bg-[color:color-mix(in_srgb,var(--semantic-success)_14%,transparent)] text-[var(--semantic-success)]'
            }`}
          >
            {healthSummary}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <OverviewStatus label="候场玩家" value={formatOverviewInteger(health?.waitingTickets)} />
          <OverviewStatus
            label="活动预留"
            value={formatOverviewInteger(health?.activeReservations)}
          />
          <OverviewStatus
            label="进行中对局"
            value={formatOverviewInteger(health?.runningMatches)}
          />
          <OverviewStatus
            label="待计分对局"
            value={formatOverviewInteger(health?.pendingMatches)}
          />
          <OverviewStatus
            label="最早待计分时间"
            value={
              !health
                ? '—'
                : health.oldestPendingEndedAt
                  ? formatDate(health.oldestPendingEndedAt)
                  : '无'
            }
          />
        </div>
      </section>

      <section className="product-workbench p-4">
        <h2 className="font-semibold text-[var(--text-primary)]">赛季经营数据</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {metricItems.map((item) => (
            <OverviewMetric key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      </section>

      <RankedDeckStatistics
        key={`deck-statistics:${selectedSeasonId}:${insightsRefreshRevision}`}
        seasonId={selectedSeasonId}
      />

      <RankedPlayersTable
        key={`players:${selectedSeasonId}:${insightsRefreshRevision}`}
        seasonId={selectedSeasonId}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <DistributionPanel
          title="玩家场次分布"
          rows={(overview?.matchCountDistribution ?? []).map((item) => ({
            label: item.label,
            count: item.playerCount,
          }))}
        />
        <DistributionPanel
          title="积分分布"
          rows={(overview?.ratingDistribution ?? []).map((item) => ({
            label: `${formatRatingBoundary(item.minimumRating)}–<${formatRatingBoundary(item.maximumRatingExclusive)}`,
            count: item.playerCount,
          }))}
        />
      </div>
    </div>
  );
}

function RankedDeckStatistics({ seasonId }: { seasonId: string }) {
  const [statistics, setStatistics] = useState<RankedAdminDeckStatisticsData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryQuery, setCategoryQuery] = useState('');
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
  const requestSequence = useRef(0);

  async function loadStatistics() {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError(null);
    try {
      const result = await fetchRankedAdminDeckStatistics(seasonId);
      if (requestSequence.current !== sequence) return;
      setStatistics(result);
    } catch (loadError) {
      if (requestSequence.current === sequence) setError(readError(loadError));
    } finally {
      if (requestSequence.current === sequence) setBusy(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadStatistics(), 0);
    return () => {
      window.clearTimeout(timer);
      requestSequence.current += 1;
    };
    // This component is remounted when the selected season changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCategory = (archetypeId: string) => {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(archetypeId)) next.delete(archetypeId);
      else next.add(archetypeId);
      return next;
    });
  };

  const normalizedCategoryQuery = categoryQuery.trim().toLocaleLowerCase();
  const matchingCategories = useMemo(() => {
    if (!statistics?.available) return [];
    if (!normalizedCategoryQuery) return statistics.categories;
    return statistics.categories.filter((category) =>
      [category.name, category.groupName, category.categoryKey].some((value) =>
        value.toLocaleLowerCase().includes(normalizedCategoryQuery)
      )
    );
  }, [normalizedCategoryQuery, statistics]);
  const visibleCategories = normalizedCategoryQuery
    ? matchingCategories
    : showAllCategories
      ? matchingCategories
      : matchingCategories.slice(0, DECK_CATEGORY_PREVIEW_COUNT);

  return (
    <section className="product-workbench p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-[var(--text-primary)]">卡组分类统计</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            场数按双方卡组席位计数；展开分类可查看各玩家的使用次数与胜率
          </p>
        </div>
        {statistics?.release ? (
          <span className="rounded-full bg-[var(--bg-overlay)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
            分类版本 v{statistics.release.version}
          </span>
        ) : null}
      </div>

      {busy ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--text-muted)]">
          <Loader2 size={16} className="animate-spin" />
          正在读取分类统计…
        </div>
      ) : null}
      {!busy && error ? (
        <div className="mt-3">
          <LookupError
            message={error}
            retryLabel="重试读取"
            onRetry={() => void loadStatistics()}
          />
        </div>
      ) : null}
      {!busy && !error && statistics && !statistics.available ? (
        <div className="mt-3 rounded-xl bg-[var(--bg-overlay)] px-3 py-6 text-center text-sm text-[var(--text-muted)]">
          当前没有可用的卡组分类发布
        </div>
      ) : null}
      {!busy && !error && statistics?.available ? (
        <>
          <DeckStatisticsSample data={statistics} />
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              />
              <input
                className="input-field min-h-10 w-full pl-9"
                value={categoryQuery}
                aria-label="搜索卡组分类"
                placeholder="搜索分类名称、分组或分类键"
                autoComplete="off"
                onChange={(event) => setCategoryQuery(event.target.value)}
              />
            </div>
            {!normalizedCategoryQuery &&
            statistics.categories.length > DECK_CATEGORY_PREVIEW_COUNT ? (
              <button
                type="button"
                className="button-secondary min-h-10 px-4 text-sm"
                aria-expanded={showAllCategories}
                onClick={() => setShowAllCategories((current) => !current)}
              >
                {showAllCategories
                  ? `收起至前 ${DECK_CATEGORY_PREVIEW_COUNT} 类`
                  : `展开全部 ${statistics.categories.length} 类`}
              </button>
            ) : null}
          </div>
          {normalizedCategoryQuery && matchingCategories.length === 0 ? (
            <div className="mt-3 rounded-xl bg-[var(--bg-overlay)] px-3 py-6 text-center text-sm text-[var(--text-muted)]">
              没有找到匹配的卡组分类
            </div>
          ) : null}
          {visibleCategories.length > 0 ? (
            <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
              <table className="min-w-[56rem] w-full text-left text-sm" aria-label="卡组分类统计">
                <thead className="bg-[var(--bg-elevated)] text-xs text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">卡组分类</th>
                    <th className="px-3 py-2 text-center font-medium">使用场数</th>
                    <th className="px-3 py-2 text-center font-medium">玩家数</th>
                    <th className="px-3 py-2 text-center font-medium">胜利</th>
                    <th className="px-3 py-2 text-center font-medium">失败</th>
                    <th className="px-3 py-2 text-center font-medium">胜率</th>
                    <th className="min-w-44 px-3 py-2 text-center font-medium">最常使用者</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCategories.map((category) => {
                    const expanded = expandedCategories.has(category.archetypeId);
                    return (
                      <Fragment key={category.archetypeId}>
                        <tr className="border-t border-[var(--border-subtle)] text-[var(--text-secondary)]">
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              className="flex w-full min-w-0 items-center gap-2 text-left"
                              aria-expanded={expanded}
                              onClick={() => toggleCategory(category.archetypeId)}
                            >
                              <ChevronRight
                                size={15}
                                className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
                              />
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: category.color }}
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-semibold text-[var(--text-primary)]">
                                  {category.name}
                                </span>
                                {category.groupName ? (
                                  <span className="block truncate text-xs text-[var(--text-muted)]">
                                    {category.groupName}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </td>
                          <DeckStatisticsNumber value={category.appearanceCount} align="center" />
                          <DeckStatisticsNumber value={category.playerCount} align="center" />
                          <DeckStatisticsNumber value={category.winnerCount} align="center" />
                          <DeckStatisticsNumber value={category.lossCount} align="center" />
                          <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums">
                            {formatRate(category.winRate)}
                          </td>
                          <DeckStatisticsTopPlayers category={category} />
                        </tr>
                        {expanded ? <DeckStatisticsPlayerRows category={category} /> : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function DeckStatisticsSample({ data }: { data: RankedAdminDeckStatisticsData }) {
  const { sample } = data;
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-muted)]">
      <span>
        严格样本 {sample.analyzedMatchCount}/{sample.settledMatchCount} 局
      </span>
      <span>长期观察覆盖 {formatRate(sample.observationCoverageRate)}</span>
      <span>分类覆盖 {formatRate(sample.classificationCoverageRate)}</span>
      {sample.invalidDeckObservationCount + sample.excludedDeckObservationCount > 0 ? (
        <span>
          未计入样本 {sample.invalidDeckObservationCount + sample.excludedDeckObservationCount} 席
        </span>
      ) : null}
    </div>
  );
}

function DeckStatisticsNumber({
  value,
  align = 'right',
}: {
  value: number;
  align?: 'center' | 'right';
}) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-2.5 tabular-nums ${
        align === 'center' ? 'text-center' : 'text-right'
      }`}
    >
      {value.toLocaleString('zh-CN')}
    </td>
  );
}

function DeckStatisticsTopPlayers({ category }: { category: RankedAdminDeckStatisticsCategory }) {
  const maximumAppearanceCount = category.players[0]?.appearanceCount ?? 0;
  const leaders = category.players.filter(
    (player) => player.appearanceCount === maximumAppearanceCount
  );
  if (leaders.length === 0) {
    return (
      <td className="min-w-44 px-3 py-2.5 text-center text-[var(--text-muted)]">
        <div>—</div>
        <div className="mt-0.5 text-xs">暂无使用记录</div>
      </td>
    );
  }
  const fullNames = leaders
    .map((player) => `${player.displayName || player.username}（@${player.username}）`)
    .join('、');
  return (
    <td className="min-w-44 px-3 py-2.5 text-center" title={fullNames}>
      <div className="break-words font-medium text-[var(--text-primary)]">
        {leaders.map((player) => player.displayName || player.username).join('、')}
      </div>
      <div className="mt-0.5 text-xs text-[var(--text-muted)]">
        {leaders.length === 1
          ? `@${leaders[0]!.username} · ${maximumAppearanceCount} 场`
          : `${leaders.length} 人并列 · 各 ${maximumAppearanceCount} 场`}
      </div>
    </td>
  );
}

function DeckStatisticsPlayerRows({ category }: { category: RankedAdminDeckStatisticsCategory }) {
  return (
    <tr className="border-t border-[var(--border-subtle)] bg-[var(--bg-overlay)]">
      <td colSpan={7} className="p-3">
        {category.players.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
            <table
              className="min-w-[32rem] w-full text-left text-xs"
              aria-label={`${category.name}玩家明细`}
            >
              <thead className="bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">玩家</th>
                  <th className="px-3 py-2 text-center font-medium">使用场数</th>
                  <th className="px-3 py-2 text-center font-medium">胜利</th>
                  <th className="px-3 py-2 text-center font-medium">失败</th>
                  <th className="px-3 py-2 text-center font-medium">胜率</th>
                </tr>
              </thead>
              <tbody>
                {category.players.map((player) => (
                  <tr
                    key={player.userId}
                    className="border-t border-[var(--border-subtle)] text-[var(--text-secondary)]"
                  >
                    <td className="max-w-64 px-3 py-2">
                      <div className="truncate font-medium text-[var(--text-primary)]">
                        {player.displayName || player.username}
                      </div>
                      <div className="truncate text-[var(--text-muted)]">@{player.username}</div>
                    </td>
                    <DeckStatisticsNumber value={player.appearanceCount} align="center" />
                    <DeckStatisticsNumber value={player.winnerCount} align="center" />
                    <DeckStatisticsNumber value={player.lossCount} align="center" />
                    <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums">
                      {formatRate(player.winRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-3 text-center text-xs text-[var(--text-muted)]">暂无玩家使用记录</div>
        )}
      </td>
    </tr>
  );
}

function RankedPlayersTable({ seasonId }: { seasonId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<RankedAdminPlayerListItem[]>([]);
  const [page, setPage] = useState<RankedAdminPlayerPage | null>(null);
  const [loadedOffset, setLoadedOffset] = useState(0);
  const [highlightedUserId, setHighlightedUserId] = useState<string | null>(null);
  const [locatedQuery, setLocatedQuery] = useState('');
  const [candidatePage, setCandidatePage] = useState<RankedAdminPlayerPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [loadingDirection, setLoadingDirection] = useState<'previous' | 'next' | null>(null);
  const [failedDirection, setFailedDirection] = useState<'previous' | 'next' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [autoLoadReady, setAutoLoadReady] = useState(false);
  const requestSequence = useRef(0);
  const loadingRef = useRef(false);
  const loadMoreTargetRef = useRef<HTMLDivElement>(null);

  async function loadFirstPage() {
    const sequence = ++requestSequence.current;
    loadingRef.current = true;
    setExpanded(true);
    setPlayers([]);
    setPage(null);
    setLoadedOffset(0);
    setHighlightedUserId(null);
    setLocatedQuery('');
    setCandidatePage(null);
    setBusy(true);
    setLoadingDirection(null);
    setFailedDirection(null);
    setError(null);
    setSearchError(null);
    setAutoLoadReady(false);
    try {
      const result = await fetchRankedAdminPlayers({
        seasonId,
        limit: RANKED_PLAYER_PAGE_SIZE,
        offset: 0,
      });
      if (requestSequence.current !== sequence) return;
      setPlayers(result.players);
      setPage(result);
      setLoadedOffset(result.offset);
    } catch (loadError) {
      if (requestSequence.current === sequence) setError(readError(loadError));
    } finally {
      if (requestSequence.current === sequence) {
        loadingRef.current = false;
        setBusy(false);
      }
    }
  }

  async function loadLocatedWindow(
    target: RankedAdminPlayerListItem,
    searchSnapshot: RankedAdminPlayerPage,
    sequence: number,
    normalizedQuery: string,
    snapshotRetryCount: number
  ) {
    setExpanded(true);
    setPlayers([]);
    setPage(null);
    setBusy(true);
    setError(null);
    setFailedDirection(null);
    setAutoLoadReady(false);
    const result = await fetchRankedAdminPlayers({
      seasonId,
      limit: RANKED_PLAYER_LOCATE_WINDOW_SIZE,
      offset: Math.max(0, target.listPosition - 4),
    });
    if (requestSequence.current !== sequence) return;
    if (
      rankedAdminPlayerSnapshotKey(result) !== rankedAdminPlayerSnapshotKey(searchSnapshot) ||
      !result.players.some((player) => player.userId === target.userId)
    ) {
      if (snapshotRetryCount < RANKED_PLAYER_LOCATE_MAX_SNAPSHOT_RETRIES) {
        void locatePlayer(normalizedQuery, snapshotRetryCount + 1);
      } else {
        setSearchError('定位期间排位数据持续变化，请稍后重试');
      }
      return;
    }
    setPlayers(result.players);
    setPage(result);
    setLoadedOffset(result.offset);
    setHighlightedUserId(target.userId);
    setLocatedQuery(normalizedQuery);
    setCandidatePage(null);
  }

  async function locatePlayer(nextQuery: string, snapshotRetryCount = 0) {
    const normalizedQuery = nextQuery.trim().replace(/^@/u, '');
    if (!normalizedQuery) {
      setQuery('');
      void loadFirstPage();
      return;
    }
    const sequence = ++requestSequence.current;
    loadingRef.current = true;
    setSearchBusy(true);
    setSearchError(null);
    setCandidatePage(null);
    try {
      const result = await fetchRankedAdminPlayers({
        seasonId,
        query: normalizedQuery,
        limit: RANKED_PLAYER_SEARCH_LIMIT,
        offset: 0,
      });
      if (requestSequence.current !== sequence) return;
      if (result.total === 0 || result.players.length === 0) {
        setSearchError('本赛季没有找到匹配的计分玩家');
        return;
      }
      const needle = normalizedQuery.toLocaleLowerCase();
      const exactMatches = result.players.filter((player) =>
        [player.userId, player.username, player.displayName].some(
          (value) => value?.toLocaleLowerCase() === needle
        )
      );
      const target =
        exactMatches.length === 1
          ? exactMatches[0]!
          : result.total === 1
            ? result.players[0]!
            : null;
      if (!target) {
        setCandidatePage(result);
        return;
      }
      await loadLocatedWindow(target, result, sequence, normalizedQuery, snapshotRetryCount);
    } catch (loadError) {
      if (requestSequence.current === sequence) setSearchError(readError(loadError));
    } finally {
      if (requestSequence.current === sequence) {
        loadingRef.current = false;
        setSearchBusy(false);
        setBusy(false);
      }
    }
  }

  async function locateCandidate(target: RankedAdminPlayerListItem) {
    if (!candidatePage) return;
    const sequence = ++requestSequence.current;
    loadingRef.current = true;
    setSearchBusy(true);
    setSearchError(null);
    try {
      await loadLocatedWindow(target, candidatePage, sequence, query.trim().replace(/^@/u, ''), 0);
    } catch (loadError) {
      if (requestSequence.current === sequence) setSearchError(readError(loadError));
    } finally {
      if (requestSequence.current === sequence) {
        loadingRef.current = false;
        setSearchBusy(false);
        setBusy(false);
      }
    }
  }

  function reloadCurrentViewAfterSnapshotChange() {
    if (locatedQuery) void locatePlayer(locatedQuery);
    else void loadFirstPage();
  }

  async function loadPreviousPage() {
    if (loadingRef.current || !page || loadedOffset === 0) return;
    const nextOffset = Math.max(0, loadedOffset - RANKED_PLAYER_PAGE_SIZE);
    const sequence = ++requestSequence.current;
    loadingRef.current = true;
    setLoadingDirection('previous');
    setFailedDirection(null);
    setError(null);
    try {
      const result = await fetchRankedAdminPlayers({
        seasonId,
        limit: loadedOffset - nextOffset,
        offset: nextOffset,
      });
      if (requestSequence.current !== sequence) return;
      if (rankedAdminPlayerSnapshotKey(result) !== rankedAdminPlayerSnapshotKey(page)) {
        reloadCurrentViewAfterSnapshotChange();
        return;
      }
      setPlayers((current) => [...result.players, ...current]);
      setPage(result);
      setLoadedOffset(result.offset);
    } catch (loadError) {
      if (requestSequence.current === sequence) {
        setError(readError(loadError));
        setFailedDirection('previous');
      }
    } finally {
      if (requestSequence.current === sequence) {
        loadingRef.current = false;
        setLoadingDirection(null);
      }
    }
  }

  async function loadNextPage() {
    if (loadingRef.current || !page || loadedOffset + players.length >= page.total) return;
    const sequence = ++requestSequence.current;
    loadingRef.current = true;
    setLoadingDirection('next');
    setFailedDirection(null);
    setError(null);
    try {
      const result = await fetchRankedAdminPlayers({
        seasonId,
        limit: RANKED_PLAYER_PAGE_SIZE,
        offset: loadedOffset + players.length,
      });
      if (requestSequence.current !== sequence) return;
      if (rankedAdminPlayerSnapshotKey(result) !== rankedAdminPlayerSnapshotKey(page)) {
        reloadCurrentViewAfterSnapshotChange();
        return;
      }
      setPlayers((current) => [...current, ...result.players]);
      setPage(result);
    } catch (loadError) {
      if (requestSequence.current === sequence) {
        setError(readError(loadError));
        setFailedDirection('next');
      }
    } finally {
      if (requestSequence.current === sequence) {
        loadingRef.current = false;
        setLoadingDirection(null);
      }
    }
  }

  useEffect(
    () => () => {
      requestSequence.current += 1;
      loadingRef.current = false;
    },
    []
  );

  useEffect(() => {
    if (!highlightedUserId) return;
    const timer = window.setTimeout(() => {
      document
        .getElementById(`ranked-player-${highlightedUserId}`)
        ?.scrollIntoView({ block: 'center' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [highlightedUserId]);

  const hasPrevious = page !== null && loadedOffset > 0;
  const hasNext = page !== null && loadedOffset + players.length < page.total;

  useEffect(() => {
    if (!expanded || !page || !hasNext || autoLoadReady) return;
    const container = loadMoreTargetRef.current?.closest('.product-frame-content');
    if (!container) return;
    const enableAutoLoad = () => setAutoLoadReady(true);
    const enableAutoLoadFromKey = (event: KeyboardEvent) => {
      if (['ArrowDown', 'End', 'PageDown', ' '].includes(event.key)) enableAutoLoad();
    };
    container.addEventListener('wheel', enableAutoLoad, { passive: true });
    container.addEventListener('touchmove', enableAutoLoad, { passive: true });
    container.addEventListener('pointerdown', enableAutoLoad, { passive: true });
    window.addEventListener('keydown', enableAutoLoadFromKey);
    return () => {
      container.removeEventListener('wheel', enableAutoLoad);
      container.removeEventListener('touchmove', enableAutoLoad);
      container.removeEventListener('pointerdown', enableAutoLoad);
      window.removeEventListener('keydown', enableAutoLoadFromKey);
    };
  }, [autoLoadReady, expanded, hasNext, page]);

  useEffect(() => {
    const target = loadMoreTargetRef.current;
    if (
      !target ||
      !expanded ||
      !autoLoadReady ||
      !hasNext ||
      busy ||
      loadingDirection !== null ||
      error ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadNextPage();
      },
      { rootMargin: '240px 0px', threshold: 0 }
    );
    observer.observe(target);
    return () => observer.disconnect();
    // Reconnect with the latest page snapshot after each append.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoadReady, expanded, hasNext, busy, loadingDirection, error, page, players.length]);

  const toggleExpanded = () => {
    if (expanded) {
      requestSequence.current += 1;
      loadingRef.current = false;
      setExpanded(false);
      setBusy(false);
      setSearchBusy(false);
      setLoadingDirection(null);
      return;
    }
    setExpanded(true);
    if (!page) void loadFirstPage();
  };

  const clearSearch = () => {
    setQuery('');
    setCandidatePage(null);
    setSearchError(null);
    void loadFirstPage();
  };

  return (
    <section className="product-workbench p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-[var(--text-primary)]">全部参赛玩家</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            默认收起列表；可搜索并定位某位玩家，再向前或向后继续查看完整名单
          </p>
        </div>
        <div className="flex items-center gap-3">
          {page ? (
            <div className="text-right text-xs text-[var(--text-muted)]">
              <div>流水修订 {page.ledgerRevision}</div>
              <div className="mt-1">
                {page.total === 0
                  ? '已显示 0/0 人'
                  : `已显示 ${loadedOffset + 1}–${loadedOffset + players.length}/${page.total} 人`}
              </div>
            </div>
          ) : null}
          <button
            type="button"
            className="button-secondary min-h-9 px-4 text-sm"
            aria-expanded={expanded}
            onClick={toggleExpanded}
          >
            {expanded ? '收起玩家列表' : '展开玩家列表'}
          </button>
        </div>
      </div>

      <form
        className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void locatePlayer(query);
        }}
      >
        <input
          className="input-field"
          value={query}
          aria-label="定位排位玩家"
          placeholder="输入用户名、显示名称或用户 ID"
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setCandidatePage(null);
            setSearchError(null);
          }}
        />
        <button
          className="button-primary inline-flex min-h-10 items-center justify-center gap-1.5 px-4 text-sm"
          disabled={searchBusy}
        >
          {searchBusy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          定位
        </button>
        {query || locatedQuery || candidatePage ? (
          <button
            type="button"
            className="button-secondary min-h-10 px-4 text-sm"
            disabled={searchBusy}
            onClick={clearSearch}
          >
            清空
          </button>
        ) : null}
      </form>

      {searchError ? (
        <div className="mt-3 rounded-xl bg-[var(--bg-overlay)] px-3 py-3 text-sm text-[var(--text-muted)]">
          {searchError}
        </div>
      ) : null}
      {candidatePage ? (
        <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3">
          <div className="text-xs text-[var(--text-muted)]">
            找到 {candidatePage.total} 名匹配玩家，请选择要定位的人
            {candidatePage.total > candidatePage.players.length
              ? `（仅显示前 ${candidatePage.players.length} 名）`
              : ''}
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="玩家定位候选">
            {candidatePage.players.map((candidate) => (
              <button
                key={candidate.userId}
                type="button"
                className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-left hover:border-[var(--border-strong)]"
                disabled={searchBusy}
                aria-label={`定位 @${candidate.username}`}
                onClick={() => void locateCandidate(candidate)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                    {candidate.displayName || candidate.username}
                  </span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">
                    @{candidate.username}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
                  列表第 {candidate.listPosition} 位
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {expanded ? (
        <>
          {busy ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--text-muted)]">
              <Loader2 size={16} className="animate-spin" />
              正在读取参赛玩家…
            </div>
          ) : null}
          {!busy && error && players.length === 0 ? (
            <div className="mt-3">
              <LookupError
                message={error}
                retryLabel="重试读取"
                onRetry={() =>
                  locatedQuery ? void locatePlayer(locatedQuery) : void loadFirstPage()
                }
              />
            </div>
          ) : null}
          {!busy && !error && page?.total === 0 ? (
            <div className="mt-3 rounded-xl bg-[var(--bg-overlay)] px-3 py-6 text-center text-sm text-[var(--text-muted)]">
              本赛季暂无参赛玩家
            </div>
          ) : null}
          {!busy && players.length > 0 && page ? (
            <>
              {hasPrevious ? (
                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    className="button-secondary inline-flex min-h-9 items-center justify-center gap-1.5 px-4 text-sm"
                    disabled={loadingDirection !== null}
                    onClick={() => void loadPreviousPage()}
                  >
                    {loadingDirection === 'previous' ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : null}
                    {loadingDirection === 'previous' ? '加载中…' : '加载更高名次玩家'}
                  </button>
                </div>
              ) : null}
              <RankedPlayerListTable
                players={players}
                page={page}
                highlightedUserId={highlightedUserId}
              />
              <div className="mt-3 flex flex-col items-center gap-2">
                {error ? (
                  <div className="w-full">
                    <LookupError
                      message={error}
                      retryLabel="重试加载"
                      onRetry={() =>
                        failedDirection === 'previous'
                          ? void loadPreviousPage()
                          : void loadNextPage()
                      }
                    />
                  </div>
                ) : null}
                {hasNext ? (
                  <button
                    type="button"
                    className="button-secondary inline-flex min-h-9 items-center justify-center gap-1.5 px-4 text-sm"
                    disabled={loadingDirection !== null}
                    onClick={() => void loadNextPage()}
                  >
                    {loadingDirection === 'next' ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : null}
                    {loadingDirection === 'next' ? '加载中…' : '加载更低名次玩家'}
                  </button>
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">已到达本赛季玩家列表末尾</span>
                )}
                <div ref={loadMoreTargetRef} className="h-px w-full" aria-hidden="true" />
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function LookupError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[color:color-mix(in_srgb,var(--semantic-error)_10%,transparent)] px-3 py-2 text-sm text-[var(--semantic-error)]">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="button-secondary px-3 py-1.5 text-xs" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

function playerDeckClassificationDisplay(
  classification: RankedAdminPlayerSummary['deckClassification'],
  ratedMatchCount: number
): { value: string; detail: string; partial: boolean } {
  const leaderNames = classification.leaders.map((leader) => leader.name).join('、');
  const value = !classification.release
    ? '尚未发布分类'
    : classification.leaders.length === 0
      ? classification.observedMatchCount === 0
        ? '暂无卡组观察'
        : '暂无已识别分类'
      : `${leaderNames}${classification.isTied ? '（并列）' : ''}`;
  const leadingMatchCount = classification.leaders[0]?.matchCount ?? 0;
  const coverage = `${classification.classifiedMatchCount}/${ratedMatchCount} 场已分类`;
  const detail = !classification.release
    ? '发布卡组分类后显示映射名称'
    : classification.leaders.length === 0
      ? coverage
      : `${classification.isTied ? '各' : ''}使用 ${leadingMatchCount} 场 · ${coverage}`;
  return { value, detail, partial: classification.coverageStatus === 'PARTIAL' };
}

function RankedPlayerListTable({
  players,
  page,
  highlightedUserId,
}: {
  players: RankedAdminPlayerListItem[];
  page: RankedAdminPlayerPage;
  highlightedUserId: string | null;
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
      <table className="min-w-[64rem] w-full text-left text-sm" aria-label="全部参赛玩家">
        <thead className="bg-[var(--bg-elevated)] text-xs text-[var(--text-muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">排名</th>
            <th className="px-3 py-2 font-medium">玩家</th>
            <th className="px-3 py-2 text-center font-medium">状态</th>
            <th className="px-3 py-2 text-center font-medium">评分</th>
            <th className="px-3 py-2 text-center font-medium">RD</th>
            <th className="px-3 py-2 text-center font-medium">场数</th>
            <th className="px-3 py-2 text-center font-medium">胜利</th>
            <th className="px-3 py-2 text-center font-medium">失败</th>
            <th className="min-w-56 px-3 py-2 text-center font-medium">最常用卡组</th>
          </tr>
        </thead>
        <tbody>
          {players.map((row) => {
            const classification = playerDeckClassificationDisplay(
              row.deckClassification,
              row.ratedMatchCount
            );
            const statusProgress = rankedPlayerStatusProgress(row, page);
            return (
              <tr
                key={row.userId}
                id={`ranked-player-${row.userId}`}
                aria-current={row.userId === highlightedUserId ? 'true' : undefined}
                className={`border-t border-[var(--border-subtle)] text-[var(--text-secondary)] ${
                  row.userId === highlightedUserId
                    ? 'bg-[color:color-mix(in_srgb,var(--semantic-info)_14%,transparent)] outline outline-1 -outline-offset-1 outline-[var(--semantic-info)]'
                    : ''
                }`}
              >
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                  {row.rank === null ? '—' : `#${row.rank}`}
                </td>
                <td className="max-w-56 px-3 py-2.5">
                  <div className="truncate">{row.displayName || row.username}</div>
                  <div className="truncate text-xs font-normal text-[var(--text-muted)]">
                    @{row.username}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-center">
                  <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-1 text-xs font-semibold text-[var(--text-secondary)]">
                    {rankedPlayerStatusLabel(row.status)}
                  </span>
                  {statusProgress ? (
                    <div className="mt-1 text-xs text-[var(--text-muted)]">{statusProgress}</div>
                  ) : null}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums">
                  {formatPlayerRating(row.rating)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums">
                  {formatPlayerRating(row.ratingDeviation)}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums">
                  {row.ratedMatchCount}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums">
                  {row.wins}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums">
                  {row.losses}
                </td>
                <td className="min-w-56 px-3 py-2.5 text-center">
                  <div className="break-words">{classification.value}</div>
                  <div
                    className={`mt-0.5 text-xs font-normal ${
                      classification.partial
                        ? 'text-[var(--semantic-warning)]'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {classification.detail}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function rankedPlayerStatusProgress(
  player: RankedAdminPlayerSummary,
  page: RankedAdminPlayerPage
): string | null {
  if (player.status === 'PLACEMENT') {
    return `${Math.min(player.ratedMatchCount, page.placementRequired)}/${page.placementRequired} 场定级`;
  }
  if (player.status === 'PLACED_NOT_ELIGIBLE') {
    return `${player.ratedMatchCount}/${page.leaderboardMinimumMatchCount} 场参榜`;
  }
  return null;
}

function OverviewStatus({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg-overlay)] px-3 py-2.5">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--bg-overlay)] p-3">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

function DistributionPanel({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; count: number }[];
}) {
  const maximum = Math.max(0, ...rows.map((row) => row.count));
  return (
    <section className="product-workbench p-4">
      <h2 className="font-semibold text-[var(--text-primary)]">{title}</h2>
      {rows.length > 0 ? (
        <div className="mt-3 space-y-2.5">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-2"
            >
              <span className="truncate text-xs text-[var(--text-secondary)]" title={row.label}>
                {row.label}
              </span>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
                <div
                  className="h-full rounded-full bg-[var(--accent-primary)]"
                  style={{ width: `${maximum === 0 ? 0 : (row.count / maximum) * 100}%` }}
                />
              </div>
              <span className="text-right text-xs tabular-nums text-[var(--text-muted)]">
                {row.count} 人
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-8 text-center text-sm text-[var(--text-muted)]">暂无分布数据</div>
      )}
    </section>
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
  onDelete,
  onAdmission,
  onOpenSeasonNotice,
  onOpenCover,
  onOpenBadge,
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
  onDelete: (season: RankedAdminSeason) => void;
  onAdmission: (season: RankedAdminSeason, admission: 'OPEN' | 'PAUSED') => Promise<unknown>;
  onOpenSeasonNotice: (season: RankedAdminSeason) => void;
  onOpenCover: (season: RankedAdminSeason) => void;
  onOpenBadge: (season: RankedAdminSeason) => void;
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
                  <button
                    className="button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
                    onClick={() => onOpenCover(season)}
                  >
                    <ImageIcon size={15} />
                    活动封面
                  </button>
                  <button
                    className="button-secondary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
                    onClick={() => onOpenBadge(season)}
                  >
                    <Award size={15} />
                    赛季徽章
                  </button>
                  {season.lifecycle === 'DRAFT' ? (
                    <>
                      <button
                        className="button-secondary px-3 py-2 text-sm"
                        disabled={busy}
                        onClick={() => onEdit(season)}
                      >
                        编辑赛季与公告
                      </button>
                      <button
                        className="button-primary px-3 py-2 text-sm"
                        disabled={busy}
                        onClick={() => void onAction(season, 'activate')}
                      >
                        开始赛季
                      </button>
                      <button
                        className="rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,var(--border-default))] px-3 py-2 text-sm text-[var(--semantic-error)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--semantic-error)_10%,transparent)]"
                        disabled={busy}
                        onClick={() => onDelete(season)}
                      >
                        删除赛季
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
                        编辑赛季与公告
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
                <span>{formatRankedOpenWindows(season.openWindows)}</span>
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
    prepareRankedOpenWindowsForForm(season.openWindows)
  );
  const openWindowsError = getRankedOpenWindowsValidationError(openWindows);
  return (
    <form
      className="product-workbench grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (openWindowsError) return;
        void onSubmit({
          name,
          announcement,
          openWindows: prepareRankedOpenWindowsForApi(openWindows),
          leaderboardMinimumMatchCount,
        });
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
      <SeasonOpenWindowsFields openWindows={openWindows} onChange={setOpenWindows} />
      <div className="flex items-end justify-end gap-2 sm:col-span-2">
        <button type="button" className="button-secondary min-h-11 px-4" onClick={onCancel}>
          取消
        </button>
        <button
          className="button-primary min-h-11 px-5"
          disabled={busy || Boolean(openWindowsError)}
        >
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
  const openWindowsError = getRankedOpenWindowsValidationError(draft.openWindows);
  const leaderboardMatchCountIsFrozen =
    draft.ratingAlgorithmVersion === defaultRatingConfig.algorithmVersion &&
    Boolean(defaultRatingConfig.growthPool);
  return (
    <form
      className="product-workbench grid gap-3 p-4 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (openWindowsError) return;
        void onSubmit({
          ...draft,
          openWindows: prepareRankedOpenWindowsForApi(draft.openWindows),
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
      <div className="grid gap-1 text-sm text-[var(--text-secondary)]">
        <span>新赛季积分重置</span>
        <SelectMenu
          label="新赛季积分重置"
          value={draft.softReset.mode}
          options={SOFT_RESET_MODE_OPTIONS}
          onChange={(mode) =>
            setDraft({
              ...draft,
              softReset: {
                ...draft.softReset,
                mode,
              },
            })
          }
          className="w-full"
        />
      </div>
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
      <SeasonOpenWindowsFields
        openWindows={draft.openWindows}
        onChange={(openWindows) => setDraft({ ...draft, openWindows })}
      />
      <div className="flex items-end justify-end gap-2">
        {onCancel ? (
          <button type="button" className="button-secondary min-h-11 px-4" onClick={onCancel}>
            取消
          </button>
        ) : null}
        <button
          className="button-primary min-h-11 px-5"
          disabled={busy || Boolean(openWindowsError)}
        >
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
  ratingStatus,
  selectedSeasonId,
  busy,
  onSelectSeason,
  onSearch,
  onSelectRatingStatus,
  onPageChange,
  onSettle,
  onCorrection,
  onOpenDeckClassifier,
}: {
  seasons: RankedAdminSeason[];
  matches: RankedAdminMatch[];
  total: number;
  page: number;
  pageSize: number;
  userQuery: string;
  ratingStatus: MatchRatingStatus;
  selectedSeasonId: string;
  busy: boolean;
  onSelectSeason: (id: string) => void;
  onSearch: (userQuery: string) => void;
  onSelectRatingStatus: (ratingStatus: MatchRatingStatus) => void;
  onPageChange: (page: number) => void;
  onSettle: (match: RankedAdminMatch) => Promise<unknown>;
  onCorrection: (
    match: RankedAdminMatch,
    action: 'VOID' | 'REPLACE',
    replacementWinnerSeat?: 'FIRST' | 'SECOND'
  ) => Promise<void>;
  onOpenDeckClassifier: (source: {
    readonly matchId: string;
    readonly seat: 'FIRST' | 'SECOND';
    readonly name: string;
    readonly note: string;
  }) => void;
}) {
  const [searchInput, setSearchInput] = useState(userQuery);
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);
  const [matchDetails, setMatchDetails] = useState<Record<string, RankedAdminMatchDetail>>({});
  const [detailLoadingIds, setDetailLoadingIds] = useState<ReadonlySet<string>>(new Set());
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const loadMatchDetail = async (matchId: string) => {
    setDetailLoadingIds((current) => new Set(current).add(matchId));
    setDetailErrors((current) => {
      const next = { ...current };
      delete next[matchId];
      return next;
    });
    try {
      const detail = await fetchRankedMatch(matchId);
      setMatchDetails((current) => ({ ...current, [matchId]: detail }));
    } catch (loadError) {
      setDetailErrors((current) => ({ ...current, [matchId]: readError(loadError) }));
    } finally {
      setDetailLoadingIds((current) => {
        const next = new Set(current);
        next.delete(matchId);
        return next;
      });
    }
  };

  const toggleMatchDecks = (match: RankedAdminMatch) => {
    if (expandedMatchId === match.matchId) {
      setExpandedMatchId(null);
      return;
    }
    setExpandedMatchId(match.matchId);
    if (matchDetails[match.matchId] || detailLoadingIds.has(match.matchId)) return;
    void loadMatchDetail(match.matchId);
  };

  return (
    <div className="space-y-3">
      <form
        className="product-workbench grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,13rem)_minmax(0,11rem)_minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(searchInput.trim());
        }}
      >
        <SelectMenu
          label="筛选赛季"
          value={selectedSeasonId}
          options={[
            { value: '', label: '全部赛季' },
            ...seasons.map((season) => ({ value: season.id, label: season.name })),
          ]}
          onChange={onSelectSeason}
          className="w-full"
        />
        <SelectMenu
          label="筛选计分状态"
          value={ratingStatus}
          options={MATCH_RATING_STATUS_OPTIONS}
          onChange={onSelectRatingStatus}
          className="w-full"
        />
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
                      ratingDelta={match.firstRatingDelta}
                    />
                    <span className="text-[var(--text-muted)]">vs</span>
                    <MatchPlayerResult
                      name={playerName(match.secondPlayer)}
                      result={seatResult(match, 'SECOND')}
                      ratingDelta={match.secondRatingDelta}
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
                  <button
                    type="button"
                    className="button-secondary px-3 py-2 text-sm"
                    aria-expanded={expandedMatchId === match.matchId}
                    onClick={() => void toggleMatchDecks(match)}
                  >
                    {expandedMatchId === match.matchId ? '收起卡组' : '查看卡组'}
                  </button>
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
              {expandedMatchId === match.matchId ? (
                <MatchDeckDetails
                  match={match}
                  detail={matchDetails[match.matchId]}
                  loading={detailLoadingIds.has(match.matchId)}
                  error={detailErrors[match.matchId]}
                  onRetry={() => {
                    setMatchDetails((current) => {
                      const next = { ...current };
                      delete next[match.matchId];
                      return next;
                    });
                    void loadMatchDetail(match.matchId);
                  }}
                  onOpenDeckClassifier={onOpenDeckClassifier}
                />
              ) : null}
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

function MatchDeckDetails({
  match,
  detail,
  loading,
  error,
  onRetry,
  onOpenDeckClassifier,
}: {
  match: RankedAdminMatch;
  detail?: RankedAdminMatchDetail;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onOpenDeckClassifier: (source: {
    readonly matchId: string;
    readonly seat: 'FIRST' | 'SECOND';
    readonly name: string;
    readonly note: string;
  }) => void;
}) {
  if (loading) {
    return (
      <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[var(--bg-overlay)] px-4 py-8 text-sm text-[var(--text-muted)]">
        <Loader2 size={16} className="animate-spin" />
        正在读取双方主卡组…
      </div>
    );
  }
  if (error) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3 rounded-xl bg-[var(--bg-overlay)] px-4 py-6 text-sm">
        <span className="text-[var(--semantic-error)]">{error}</span>
        <button type="button" className="button-secondary px-3 py-2 text-xs" onClick={onRetry}>
          重新读取
        </button>
      </div>
    );
  }
  if (!detail) return null;

  const firstDeck = detail.decks.find((deck) => deck.seat === 'FIRST');
  const secondDeck = detail.decks.find((deck) => deck.seat === 'SECOND');
  return (
    <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">双方主卡组</h3>
        <span className="text-xs text-[var(--text-muted)]">
          仅展示长期保存的主卡组；同基础卡号的罕度与异画已合并
        </span>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <MatchDeckPanel
          matchId={match.matchId}
          seatLabel="先攻"
          playerName={playerName(match.firstPlayer)}
          deck={firstDeck}
          onOpenDeckClassifier={onOpenDeckClassifier}
        />
        <MatchDeckPanel
          matchId={match.matchId}
          seatLabel="后攻"
          playerName={playerName(match.secondPlayer)}
          deck={secondDeck}
          onOpenDeckClassifier={onOpenDeckClassifier}
        />
      </div>
    </div>
  );
}

function MatchDeckPanel({
  matchId,
  seatLabel,
  playerName: name,
  deck,
  onOpenDeckClassifier,
}: {
  matchId: string;
  seatLabel: string;
  playerName: string;
  deck?: RankedAdminMatchDeck;
  onOpenDeckClassifier: (source: {
    readonly matchId: string;
    readonly seat: 'FIRST' | 'SECOND';
    readonly name: string;
    readonly note: string;
  }) => void;
}) {
  if (!deck) {
    return (
      <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-4">
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">
          {seatLabel} · {name}
        </h4>
        <p className="mt-4 text-center text-sm text-[var(--text-muted)]">
          该席位没有长期卡组记录，可能是卡组观察功能上线前的历史对局
        </p>
      </section>
    );
  }
  const members = deck.mainDeckCards.filter((card) => card.cardType === 'MEMBER');
  const lives = deck.mainDeckCards.filter((card) => card.cardType === 'LIVE');
  const total = deck.mainDeckCards.reduce((sum, card) => sum + card.count, 0);
  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {seatLabel} · {name}
          </h4>
          <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
            {deck.sourceDeckName || '未记录卡组名称'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <span className="rounded-full bg-[var(--bg-surface)] px-2.5 py-1 text-xs tabular-nums text-[var(--text-muted)]">
            {total} 张
          </span>
          <button
            type="button"
            className="button-secondary px-2.5 py-1.5 text-xs"
            onClick={() =>
              onOpenDeckClassifier({
                matchId,
                seat: deck.seat,
                name: deck.sourceDeckName?.trim() || `对局 ${matchId.slice(0, 8)} · ${deck.seat}`,
                note: `从赛季排位管理导入；对局 ${matchId}；席位 ${deck.seat}`,
              })
            }
          >
            导入为分类样板
          </button>
        </div>
      </div>
      <DeckCardGroup
        title={`成员卡 · ${members.reduce((sum, card) => sum + card.count, 0)} 张`}
        cards={members}
      />
      <DeckCardGroup
        title={`Live 卡 · ${lives.reduce((sum, card) => sum + card.count, 0)} 张`}
        cards={lives}
      />
    </section>
  );
}

function DeckCardGroup({ title, cards }: { title: string; cards: RankedAdminMatchDeckCard[] }) {
  return (
    <div className="mt-4">
      <h5 className="mb-2 text-xs font-semibold text-[var(--text-muted)]">{title}</h5>
      <div className="grid gap-2 sm:grid-cols-2">
        {cards.map((card) => (
          <div
            key={card.baseCardCode}
            className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg bg-[var(--bg-surface)] p-1.5"
          >
            <img
              src={resolveCardImagePath(
                { cardCode: card.cardCode, imageFilename: card.imageFilename },
                'thumb'
              )}
              alt=""
              loading="lazy"
              className="h-12 w-9 rounded object-cover object-top"
            />
            <div className="min-w-0">
              <div
                className="truncate text-xs font-semibold text-[var(--text-primary)]"
                title={card.name}
              >
                {card.name}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
                {card.baseCardCode}
              </div>
            </div>
            <span className="pr-1 text-xs font-semibold tabular-nums text-[var(--text-primary)]">
              ×{card.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchPlayerResult({
  name,
  result,
  ratingDelta,
}: {
  name: string;
  result: 'WIN' | 'LOSS' | 'PENDING';
  ratingDelta: number | null;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate">{name}</span>
      <span
        className={`text-xs font-semibold tabular-nums ${
          ratingDelta === null
            ? 'text-[var(--text-muted)]'
            : ratingDelta > 0
              ? 'text-[var(--semantic-success)]'
              : ratingDelta < 0
                ? 'text-[var(--semantic-error)]'
                : 'text-[var(--text-muted)]'
        }`}
        title="本局积分变化"
      >
        {formatRatingDelta(ratingDelta)}
      </span>
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
          <div className="grid gap-1 text-sm text-[var(--text-secondary)]">
            <span>复用已应用过的参数</span>
            <SelectMenu
              label="复用已应用过的参数"
              value=""
              options={[
                { value: '', label: '不复用，编辑当前参数' },
                ...(originalRevision ? [{ value: 'original', label: '修订前原始参数' }] : []),
                ...history.map((item) => ({
                  value: item.id,
                  label: `第 ${item.revisionNumber} 版${item.current ? '（当前）' : ''} · ${new Date(item.appliedAt).toLocaleString('zh-CN')}`,
                })),
              ]}
              onChange={(revisionId) => {
                const selectedConfig =
                  revisionId === 'original'
                    ? originalRevision?.sourceConfig
                    : history.find((candidate) => candidate.id === revisionId)?.targetConfig;
                if (selectedConfig) {
                  setParameters(revisionParametersFromConfig(selectedConfig));
                  setPreview(null);
                  setConfirmed(false);
                }
              }}
              className="mt-2 w-full"
              menuMinWidth={320}
            />
          </div>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm text-[var(--text-secondary)]">
      {label}
      {children}
    </label>
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
    openWindows: prepareRankedOpenWindowsForForm(season.openWindows),
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

function lifecycleLabel(value: RankedAdminSeason['lifecycle']) {
  return { DRAFT: '未开始', ACTIVE: '开放中', FINALIZING: '结算中', CLOSED: '已结束' }[value];
}

function preferredOverviewSeasonId(seasons: RankedAdminSeason[]): string {
  return (
    seasons.find((season) => season.lifecycle === 'ACTIVE')?.id ??
    seasons.find((season) => season.lifecycle === 'FINALIZING')?.id ??
    seasons.find((season) => season.lifecycle === 'CLOSED')?.id ??
    seasons[0]?.id ??
    ''
  );
}

function formatOverviewInteger(value: number | undefined): string {
  return value === undefined ? '—' : Math.round(value).toLocaleString('zh-CN');
}

function formatRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function formatRatingBoundary(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPlayerRating(value: number): string {
  return Math.round(value).toLocaleString('zh-CN');
}

function rankedPlayerStatusLabel(status: RankedAdminPlayerStatus): string {
  return {
    PLACEMENT: '定级中',
    PLACED_NOT_ELIGIBLE: '已定级',
    RANKED: '已入榜',
  }[status];
}

function formatRatingDelta(value: number | null): string {
  if (value === null) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
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

function readError(error: unknown) {
  return error instanceof Error ? error.message : '操作没有完成';
}
