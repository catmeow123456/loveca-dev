import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { AdminPageHeader } from './AdminPageHeader';
import { AdminViewTabs } from './AdminViewTabs';
import { SeasonOpenWindowsFields } from './SeasonOpenWindowsFields';
import { ConfirmDialog, SelectMenu, type SelectMenuOption } from '@/components/common';
import { RankedSeasonNoticeDialog } from '@/components/ranked/RankedSeasonNoticeDialog';
import {
  createRankedSeason,
  deleteRankedSeasonDraft,
  applyRankedRatingRevision,
  executeRankedCorrection,
  fetchRankedAdminPlayerContext,
  fetchRankedEnvironment,
  fetchRankedMatch,
  fetchRankedMatches,
  fetchRankedOverview,
  fetchRankedRatingRevisions,
  fetchRankedSeasons,
  previewRankedRatingRevision,
  previewRankedCorrection,
  runRankedSeasonAction,
  searchRankedAdminPlayers,
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
  type RankedAdminPlayerContext,
  type RankedAdminPlayerRankRow,
  type RankedAdminPlayerSearchResult,
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
              onSelectSeason={(seasonId) => {
                setOverviewSeasonId(seasonId);
                setOverview(null);
                void refreshOverview(seasonId);
              }}
            />
          ) : tab === 'season' ? (
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
  onSelectSeason,
}: {
  seasons: RankedAdminSeason[];
  selectedSeasonId: string;
  overview: RankedAdminOverview | null;
  busy: boolean;
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

      <RankedPlayerLookup key={selectedSeasonId} seasonId={selectedSeasonId} />

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

function RankedPlayerLookup({ seasonId }: { seasonId: string }) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<RankedAdminPlayerSearchResult[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [context, setContext] = useState<RankedAdminPlayerContext | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [contextBusy, setContextBusy] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const searchRequestSequence = useRef(0);
  const contextRequestSequence = useRef(0);

  const searchPlayers = async () => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      searchRequestSequence.current += 1;
      contextRequestSequence.current += 1;
      setCandidates([]);
      setSelectedUserId(null);
      setContext(null);
      setSearchBusy(false);
      setContextBusy(false);
      setHasSearched(false);
      setSearchError('请输入用户名、显示名称或用户 ID');
      setContextError(null);
      return;
    }
    const requestSequence = ++searchRequestSequence.current;
    const requestSeasonId = seasonId;
    contextRequestSequence.current += 1;
    setSearchBusy(true);
    setHasSearched(false);
    setSearchError(null);
    setContextError(null);
    setCandidates([]);
    setSelectedUserId(null);
    setContext(null);
    setContextBusy(false);
    try {
      const result = await searchRankedAdminPlayers(requestSeasonId, normalizedQuery, 10);
      if (searchRequestSequence.current !== requestSequence) {
        return;
      }
      setCandidates(result);
      setHasSearched(true);
    } catch (loadError) {
      if (searchRequestSequence.current === requestSequence) {
        setSearchError(readError(loadError));
      }
    } finally {
      if (searchRequestSequence.current === requestSequence) {
        setSearchBusy(false);
      }
    }
  };

  const loadPlayerContext = async (userId: string) => {
    const requestSequence = ++contextRequestSequence.current;
    const requestSeasonId = seasonId;
    setSelectedUserId(userId);
    setContext(null);
    setContextBusy(true);
    setContextError(null);
    try {
      const result = await fetchRankedAdminPlayerContext(requestSeasonId, userId);
      if (contextRequestSequence.current !== requestSequence) {
        return;
      }
      setContext(result);
    } catch (loadError) {
      if (contextRequestSequence.current === requestSequence) {
        setContextError(readError(loadError));
      }
    } finally {
      if (contextRequestSequence.current === requestSequence) {
        setContextBusy(false);
      }
    }
  };

  return (
    <section className="product-workbench p-4">
      <div>
        <h2 className="font-semibold text-[var(--text-primary)]">玩家积分查询</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          查看玩家当前积分、定级进度与排行榜上下文
        </p>
      </div>
      <form
        className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void searchPlayers();
        }}
      >
        <input
          className="input-field"
          value={query}
          aria-label="搜索排位玩家"
          placeholder="输入用户名、显示名称或用户 ID"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="button-primary inline-flex min-h-10 items-center justify-center gap-1.5 px-4 text-sm"
          disabled={searchBusy}
        >
          {searchBusy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          搜索玩家
        </button>
      </form>

      <div className="mt-3" aria-live="polite">
        {searchError ? (
          <LookupError
            message={searchError}
            retryLabel="重试搜索"
            onRetry={query.trim() ? () => void searchPlayers() : undefined}
          />
        ) : null}
        {!searchError && searchBusy ? (
          <div className="flex items-center justify-center gap-2 py-5 text-sm text-[var(--text-muted)]">
            <Loader2 size={16} className="animate-spin" />
            正在搜索玩家…
          </div>
        ) : null}
        {!searchBusy && !searchError && hasSearched && candidates.length === 0 ? (
          <div className="rounded-xl bg-[var(--bg-overlay)] px-3 py-5 text-center text-sm text-[var(--text-muted)]">
            本赛季没有找到匹配的计分玩家
          </div>
        ) : null}
        {!searchBusy && candidates.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {candidates.map((candidate) => (
              <button
                key={candidate.userId}
                type="button"
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  candidate.userId === selectedUserId
                    ? 'border-[var(--accent-primary)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-overlay)] hover:border-[var(--border-default)]'
                }`}
                aria-pressed={candidate.userId === selectedUserId}
                onClick={() => void loadPlayerContext(candidate.userId)}
              >
                <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                  {candidate.displayName || candidate.username}
                </div>
                <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                  @{candidate.username} · {candidate.userId}
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {contextBusy ? (
        <div
          className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-[var(--bg-overlay)] py-7 text-sm text-[var(--text-muted)]"
          aria-live="polite"
        >
          <Loader2 size={16} className="animate-spin" />
          正在读取玩家积分…
        </div>
      ) : null}
      {!contextBusy && contextError ? (
        <div className="mt-3">
          <LookupError
            message={contextError}
            retryLabel="重试读取"
            onRetry={selectedUserId ? () => void loadPlayerContext(selectedUserId) : undefined}
          />
        </div>
      ) : null}
      {!contextBusy && !contextError && context ? (
        <RankedPlayerContextCard context={context} />
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

function RankedPlayerContextCard({ context }: { context: RankedAdminPlayerContext }) {
  const { player } = context;
  return (
    <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-[var(--text-primary)]">
              {player.displayName || player.username}
            </h3>
            <span className="rounded-full bg-[var(--bg-elevated)] px-2 py-0.5 text-xs font-semibold text-[var(--text-secondary)]">
              {rankedPlayerStatusLabel(player.status)}
            </span>
          </div>
          <p className="mt-1 break-all text-xs text-[var(--text-muted)]">
            @{player.username} · {player.userId}
          </p>
        </div>
        <div className="text-right text-xs text-[var(--text-muted)]">
          <div>流水修订 {context.ledgerRevision}</div>
          <div className="mt-1">更新于 {formatDate(context.generatedAt)}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <PlayerScoreMetric label="当前评分" value={formatPlayerRating(player.rating)} prominent />
        <PlayerScoreMetric label="RD" value={formatPlayerRating(player.ratingDeviation)} />
        <PlayerScoreMetric label="已计分场数" value={`${player.ratedMatchCount}`} />
        <PlayerScoreMetric
          label="当前排名"
          value={player.rank === null ? '—' : `#${player.rank}`}
        />
      </div>

      <RankedPlayerStatusNote context={context} />

      {player.leaderboardEligible ? (
        <RankedPlayerNeighborTable rows={context.neighbors.rows} />
      ) : null}
    </div>
  );
}

function PlayerScoreMetric({
  label,
  value,
  prominent = false,
}: {
  label: string;
  value: string;
  prominent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-[var(--bg-elevated)] px-3 py-2.5">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div
        className={`mt-1 font-semibold tabular-nums text-[var(--text-primary)] ${
          prominent ? 'text-2xl' : 'text-lg'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function RankedPlayerStatusNote({ context }: { context: RankedAdminPlayerContext }) {
  const { player } = context;
  if (player.status === 'PLACEMENT') {
    return (
      <p className="mt-3 rounded-lg bg-[color:color-mix(in_srgb,var(--semantic-warning)_10%,transparent)] px-3 py-2 text-sm text-[var(--text-secondary)]">
        定级进度 {Math.min(player.ratedMatchCount, context.placementRequired)}/
        {context.placementRequired}。尚未完成定级，当前评分不代表最终定位。
        {player.leaderboardEligible ? '已达到当前排行榜门槛。' : ''}
      </p>
    );
  }
  if (player.status === 'PLACED_NOT_ELIGIBLE') {
    return (
      <p className="mt-3 rounded-lg bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-secondary)]">
        已完成定级，当前 {player.ratedMatchCount}/{context.leaderboardMinimumMatchCount}{' '}
        场，尚未达到排行榜门槛。
      </p>
    );
  }
  return (
    <p className="mt-3 text-xs text-[var(--text-muted)]">
      排名与玩家端榜单一致；下方展示该玩家上下各最多 3 名。
    </p>
  );
}

function RankedPlayerNeighborTable({ rows }: { rows: RankedAdminPlayerRankRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
      <table className="min-w-full text-left text-sm" aria-label="玩家排名上下文">
        <thead className="bg-[var(--bg-elevated)] text-xs text-[var(--text-muted)]">
          <tr>
            <th className="px-3 py-2 font-medium">排名</th>
            <th className="px-3 py-2 font-medium">玩家</th>
            <th className="px-3 py-2 text-right font-medium">评分</th>
            <th className="px-3 py-2 text-right font-medium">RD</th>
            <th className="px-3 py-2 text-right font-medium">场数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.userId}
              className={
                row.isTarget
                  ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)] font-semibold text-[var(--text-primary)]'
                  : 'border-t border-[var(--border-subtle)] text-[var(--text-secondary)]'
              }
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
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                {formatPlayerRating(row.rating)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                {formatPlayerRating(row.ratingDeviation)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                {row.ratedMatchCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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

function formatRatingBoundary(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPlayerRating(value: number): string {
  return Math.round(value).toLocaleString('zh-CN');
}

function rankedPlayerStatusLabel(status: RankedAdminPlayerContext['player']['status']): string {
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
