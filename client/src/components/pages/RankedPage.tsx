import { useEffect, useMemo, useState } from 'react';
import { BookOpen, DoorOpen, Loader2, Medal, Search, ShieldCheck, Swords, X } from 'lucide-react';
import {
  ActionButton,
  DeckSelector,
  PageHeader,
  Panel,
  SelectMenu,
  type DeckDisplayItem,
} from '@/components/common';
import { DonutChart, type DonutChartItem } from '@/components/charts/DonutChart';
import { RankedSeasonNoticeDialog } from '@/components/ranked/RankedSeasonNoticeDialog';
import { ActivityCoverHero } from '@/components/activity-cover/ActivityCoverHero';
import { buildDeckDisplayItems } from '@/lib/deckDisplay';
import { useDeckPointTableRules } from '@/hooks/useDeckPointTable';
import {
  choosePreferredDeck,
  DECK_SELECTION_PREFERENCE_KEYS,
  readLastUsedDeckId,
  writeLastUsedDeckId,
} from '@/lib/deckSelectionPreferences';
import { createDeckRecordCardTypeResolver } from '@/lib/deckRecordUtils';
import { resolveCardImagePath } from '@/lib/imageService';
import {
  fetchRankedDeckArchetypeEnvironment,
  fetchRankedEnvironment,
  fetchRankedOverview,
  fetchRankedSeasons,
} from '@/lib/rankedClient';
import { useAuthStore } from '@/store/authStore';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { useRankedStore } from '@/store/rankedStore';
import type {
  RankedOverviewView,
  RankedSeasonEnvironmentView,
  RankedSeasonPublicView,
} from '@game/online/ranked-types';
import type {
  DeckArchetypeEnvironmentEntryView,
  DeckArchetypeEnvironmentView,
} from '@game/online/deck-classifier-types';
import type { BattleTimeoutConfig } from '@game/online/ranked-policy';
import type { AnyCardData } from '@game/domain/entities/card';

const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';

interface RankedEnvironmentState {
  readonly seasonId: string | null;
  readonly data: RankedSeasonEnvironmentView | null;
  readonly loading: boolean;
  readonly error: string | null;
}

interface RankedDeckEnvironmentState {
  readonly seasonId: string | null;
  readonly data: DeckArchetypeEnvironmentView | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export function RankedPage({
  onBack,
  onEnterRoom,
  battleTimeouts,
}: {
  onBack: () => void;
  onEnterRoom: () => void;
  battleTimeouts: BattleTimeoutConfig;
}) {
  const pointTable = useDeckPointTableRules();
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const cloudDecks = useDeckStore((state) => state.cloudDecks);
  const cloudDeckLoadState = useDeckStore((state) => state.cloudDeckLoadState);
  const cloudError = useDeckStore((state) => state.cloudError);
  const ensureCloudDecks = useDeckStore((state) => state.ensureCloudDecks);
  const refreshCloudDecks = useDeckStore((state) => state.refreshCloudDecks);
  const isLoadingCloud = cloudDeckLoadState === 'LOADING';
  const isRefreshingCloud = cloudDeckLoadState === 'REFRESHING';
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const overview = useRankedStore((state) => state.overview);
  const loading = useRankedStore((state) => state.loading);
  const error = useRankedStore((state) => state.error);
  const refresh = useRankedStore((state) => state.refresh);
  const join = useRankedStore((state) => state.join);
  const confirm = useRankedStore((state) => state.confirm);
  const cancel = useRankedStore((state) => state.cancel);
  const [selectedDeck, setSelectedDeck] = useState<DeckDisplayItem | null>(null);
  const [hasChosenDeck, setHasChosenDeck] = useState(false);
  const [lastUsedDeckId, setLastUsedDeckId] = useState(() =>
    readLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.ranked)
  );
  const [seasonOptions, setSeasonOptions] = useState<RankedSeasonPublicView[]>([]);
  const [historicalOverview, setHistoricalOverview] = useState<RankedOverviewView | null>(null);
  const [environmentState, setEnvironmentState] = useState<RankedEnvironmentState>({
    seasonId: null,
    data: null,
    loading: false,
    error: null,
  });
  const [environmentReloadKey, setEnvironmentReloadKey] = useState(0);
  const [deckEnvironmentState, setDeckEnvironmentState] = useState<RankedDeckEnvironmentState>({
    seasonId: null,
    data: null,
    loading: false,
    error: null,
  });
  const [deckEnvironmentReloadKey, setDeckEnvironmentReloadKey] = useState(0);
  const [isSeasonNoticeOpen, setIsSeasonNoticeOpen] = useState(false);
  const resolveDeckRecordCardType = useMemo(
    () => createDeckRecordCardTypeResolver(cardDataRegistry),
    [cardDataRegistry]
  );
  const deckDisplayItems = useMemo(
    () => buildDeckDisplayItems({ cloudDecks, resolveDeckRecordCardType, pointTable }),
    [cloudDecks, pointTable, resolveDeckRecordCardType]
  );
  const validDeckCount = useMemo(
    () => deckDisplayItems.filter((deck) => deck.isValid).length,
    [deckDisplayItems]
  );
  const preferredDeck = useMemo(
    () => choosePreferredDeck(deckDisplayItems, lastUsedDeckId),
    [deckDisplayItems, lastUsedDeckId]
  );
  const status = overview?.queue ?? null;
  const active = status && status.state !== 'IDLE';
  const displayedOverview = historicalOverview ?? overview;
  const displayedSeasonId = displayedOverview?.season?.id ?? null;
  const displayedEnvironment =
    environmentState.seasonId === displayedSeasonId ? environmentState.data : null;
  const isEnvironmentLoading =
    displayedSeasonId !== null &&
    (environmentState.seasonId !== displayedSeasonId || environmentState.loading);
  const environmentError =
    environmentState.seasonId === displayedSeasonId ? environmentState.error : null;
  const displayedDeckEnvironment =
    deckEnvironmentState.seasonId === displayedSeasonId ? deckEnvironmentState.data : null;
  const isDeckEnvironmentLoading =
    displayedSeasonId !== null &&
    (deckEnvironmentState.seasonId !== displayedSeasonId || deckEnvironmentState.loading);
  const deckEnvironmentError =
    deckEnvironmentState.seasonId === displayedSeasonId ? deckEnvironmentState.error : null;

  useEffect(() => {
    void ensureCloudDecks();
    void refresh().catch(() => undefined);
    void fetchRankedSeasons()
      .then(setSeasonOptions)
      .catch(() => undefined);
  }, [ensureCloudDecks, refresh]);

  useEffect(() => {
    if (selectedDeck || hasChosenDeck || !preferredDeck.deck) return;
    const timer = window.setTimeout(() => setSelectedDeck(preferredDeck.deck), 0);
    return () => window.clearTimeout(timer);
  }, [hasChosenDeck, preferredDeck.deck, selectedDeck]);

  useEffect(() => {
    if (!selectedDeck) return;
    const refreshed = deckDisplayItems.find((deck) => deck.id === selectedDeck.id && deck.isValid);
    if (refreshed === selectedDeck) return;
    const timer = window.setTimeout(() => setSelectedDeck(refreshed ?? null), 0);
    return () => window.clearTimeout(timer);
  }, [deckDisplayItems, selectedDeck]);

  useEffect(() => {
    if (active || !displayedSeasonId) return;
    let cancelled = false;
    void fetchRankedEnvironment(displayedSeasonId)
      .then((data) => {
        if (cancelled) return;
        setEnvironmentState({
          seasonId: displayedSeasonId,
          data,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setEnvironmentState({
          seasonId: displayedSeasonId,
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : '读取赛季卡牌使用率失败',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [active, displayedSeasonId, environmentReloadKey]);

  useEffect(() => {
    if (active || !displayedSeasonId) return;
    let cancelled = false;
    void fetchRankedDeckArchetypeEnvironment(displayedSeasonId)
      .then((data) => {
        if (cancelled) return;
        setDeckEnvironmentState({
          seasonId: displayedSeasonId,
          data,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDeckEnvironmentState({
          seasonId: displayedSeasonId,
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : '读取赛季卡组环境失败',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [active, deckEnvironmentReloadKey, displayedSeasonId]);

  const handleJoin = async () => {
    if (!selectedDeck?.cloudDeck) return;
    try {
      await join(selectedDeck.cloudDeck.id);
      writeLastUsedDeckId(DECK_SELECTION_PREFERENCE_KEYS.ranked, selectedDeck.cloudDeck.id);
      setLastUsedDeckId(selectedDeck.cloudDeck.id);
    } catch {
      // Store error is rendered with the primary action.
    }
  };

  const handleEnterRoom = () => {
    if (!status?.roomCode) return;
    window.sessionStorage.setItem(ONLINE_ROOM_STORAGE_KEY, status.roomCode);
    onEnterRoom();
  };

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <PageHeader
        title="赛季排位"
        icon={<Medal size={20} />}
        onBack={onBack}
        backLabel="返回大厅"
      />

      <main className="relative z-10 flex flex-1 justify-center px-4 py-5 sm:px-6">
        <div className="w-full max-w-4xl">
          {active ? (
            <QueueState
              status={status}
              loading={loading}
              error={error}
              onCancel={cancel}
              onConfirm={confirm}
              onEnterRoom={handleEnterRoom}
              onOpenSeasonNotice={() => setIsSeasonNoticeOpen(true)}
            />
          ) : (
            <>
              {seasonOptions.length > 1 ? (
                <SelectMenu
                  label="查看赛季"
                  value={displayedOverview?.season?.id ?? ''}
                  options={seasonOptions.map((season) => ({
                    value: season.id,
                    label: season.name,
                  }))}
                  onChange={(seasonId) => {
                    if (seasonId === overview?.season?.id) {
                      setHistoricalOverview(null);
                      return;
                    }
                    void fetchRankedOverview(seasonId)
                      .then(setHistoricalOverview)
                      .catch(() => undefined);
                  }}
                  className="mb-3 w-full max-w-xs"
                  menuMinWidth={256}
                />
              ) : null}
              <SeasonSummary
                overview={displayedOverview}
                onOpenSeasonNotice={() => setIsSeasonNoticeOpen(true)}
              />
              {!historicalOverview && overview?.availability.canJoin ? (
                <>
                  <div
                    className={`mt-4 ${
                      validDeckCount > 6 || isLoadingCloud
                        ? 'h-[58dvh] min-h-[420px] max-h-[640px] overflow-hidden'
                        : ''
                    }`}
                  >
                    <DeckSelector
                      cloudDecks={cloudDecks}
                      selectedId={selectedDeck?.id}
                      onSelect={(deck) => {
                        setHasChosenDeck(true);
                        setSelectedDeck(deck);
                      }}
                      isLoading={isLoadingCloud}
                      isRefreshing={isRefreshingCloud}
                      error={cloudError}
                      onRefresh={refreshCloudDecks}
                      title="选择卡组"
                      emptyText="还没有可用卡组，请先到卡组管理创建一副。"
                      density="compact"
                      lastUsedDeckId={lastUsedDeckId}
                    />
                  </div>
                  {error ? <ErrorMessage message={error} /> : null}
                  <Panel
                    padding="compact"
                    className="sticky bottom-3 mt-4 flex items-center gap-3 shadow-[var(--shadow-lg)] sm:shadow-none"
                  >
                    <div className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">
                      {selectedDeck?.name ?? '选择一副卡组'}
                    </div>
                    <ActionButton
                      className="shrink-0 px-6 disabled:opacity-45"
                      disabled={!selectedDeck || loading}
                      onClick={() => void handleJoin()}
                    >
                      {loading ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Swords size={16} />
                      )}
                      开始排位
                    </ActionButton>
                  </Panel>
                </>
              ) : null}
              <SeasonLists overview={displayedOverview} currentUserId={currentUserId} />
              {displayedSeasonId ? (
                <>
                  <SeasonDeckArchetypeUsage
                    environment={displayedDeckEnvironment}
                    loading={isDeckEnvironmentLoading}
                    error={deckEnvironmentError}
                    onRetry={() => {
                      setDeckEnvironmentState({
                        seasonId: displayedSeasonId,
                        data: null,
                        loading: true,
                        error: null,
                      });
                      setDeckEnvironmentReloadKey((key) => key + 1);
                    }}
                  />
                  <SeasonCardUsage
                    environment={displayedEnvironment}
                    loading={isEnvironmentLoading}
                    error={environmentError}
                    onRetry={() => {
                      setEnvironmentState({
                        seasonId: displayedSeasonId,
                        data: null,
                        loading: true,
                        error: null,
                      });
                      setEnvironmentReloadKey((key) => key + 1);
                    }}
                  />
                </>
              ) : null}
            </>
          )}
        </div>
      </main>
      <RankedSeasonNoticeDialog
        isOpen={isSeasonNoticeOpen}
        seasonName={displayedOverview?.season?.name}
        announcement={displayedOverview?.season?.announcement}
        leaderboardMatchCount={
          displayedOverview?.player?.placementRequired ??
          displayedOverview?.season?.placementMatchCount
        }
        battleTimeouts={battleTimeouts}
        onClose={() => setIsSeasonNoticeOpen(false)}
      />
    </div>
  );
}

type DeckEnvironmentRateKey =
  | 'playerEqualUsageRate'
  | 'playerEqualWinnerRate'
  | 'matchEqualUsageRate'
  | 'matchEqualWinnerRate'
  | 'topRankedPlayerEqualUsageRate';
type RankedEnvironmentTab = 'USAGE' | 'WINNER' | 'TOP_RANKED';

function SeasonDeckArchetypeUsage({
  environment,
  loading,
  error,
  onRetry,
}: {
  environment: DeckArchetypeEnvironmentView | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const cardDataRegistry = useGameStore((state) => state.cardDataRegistry);
  const [chartTab, setChartTab] = useState<RankedEnvironmentTab>('USAGE');
  if (environment?.visibleSections.length === 0) return null;
  const standardCharts =
    environment?.displayMode === 'PLAYER_EQUAL'
      ? PLAYER_EQUAL_CHARTS
      : environment?.displayMode === 'MATCH_EQUAL'
        ? MATCH_EQUAL_CHARTS
        : [...PLAYER_EQUAL_CHARTS, ...MATCH_EQUAL_CHARTS];
  const availableCharts: readonly {
    title: string;
    description: string;
    metric: DeckEnvironmentRateKey;
    tab: RankedEnvironmentTab;
  }[] = [
    ...standardCharts,
    ...(environment
      ? [
          {
            tab: 'TOP_RANKED' as const,
            title: `前 ${environment.topRankedPlayerCount} 名玩家·使用构成`,
            description: `从当前排行榜前 ${environment.topRankedPlayerCount} 名中，按每名有可分析卡组的玩家等权统计其赛季使用分布。`,
            metric: 'topRankedPlayerEqualUsageRate' as const,
          },
        ]
      : []),
  ];
  const enabledTabs = RANKED_ENVIRONMENT_TABS.filter((tab) =>
    environment?.visibleSections.includes(tab.value)
  );
  const activeChartTab = enabledTabs.some((tab) => tab.value === chartTab)
    ? chartTab
    : (enabledTabs[0]?.value ?? 'USAGE');
  const charts = availableCharts.filter((chart) => chart.tab === activeChartTab);

  return (
    <Panel as="section" padding="compact" className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">赛季卡组环境</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            使用占比表示卡组在环境中的构成；胜者构成表示获胜者使用了什么，不是胜率。
          </p>
        </div>
        {environment?.available && environment.release ? (
          <p className="text-xs text-[var(--text-muted)]">
            分类版本 v{environment.release.version} · {environment.sample.playerCount} 名玩家、
            {environment.sample.analyzedMatchCount} 场可分析对局
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--text-muted)]">
          <Loader2 size={16} className="animate-spin" />
          正在读取卡组环境…
        </div>
      ) : error ? (
        <div className="py-6 text-center">
          <p className="text-sm text-[var(--semantic-error)]">{error}</p>
          <ActionButton variant="ghost" size="compact" className="mt-3" onClick={onRetry}>
            重新读取
          </ActionButton>
        </div>
      ) : !environment?.available ? (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">
          卡组分类版本尚未发布，发布并完成首次分类后将在这里展示。
        </p>
      ) : environment.sample.analyzedMatchCount === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">
          暂无可统计的有效排位对局
        </p>
      ) : (
        <>
          {enabledTabs.length > 1 ? (
            <RankedEnvironmentTabs
              ariaLabel="卡组环境图表"
              panelId="ranked-deck-environment-chart-panel"
              tabs={enabledTabs}
              activeTab={activeChartTab}
              onChange={setChartTab}
            />
          ) : null}

          <div
            id="ranked-deck-environment-chart-panel"
            className="mt-4 space-y-4"
            role={enabledTabs.length > 1 ? 'tabpanel' : undefined}
            aria-labelledby={
              enabledTabs.length > 1
                ? `ranked-deck-environment-chart-panel-tab-${activeChartTab}`
                : undefined
            }
          >
            {charts.map((chart) => {
              const series = buildDeckChartSeries(
                environment.archetypes,
                chart.metric,
                cardDataRegistry
              );
              return (
                <div
                  key={chart.metric}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3 sm:p-4"
                >
                  {series.length === 0 ? (
                    <div className="py-12 text-center text-sm text-[var(--text-muted)]">
                      {chart.tab === 'TOP_RANKED'
                        ? '当前高排名玩家还没有可分析的卡组观察'
                        : '当前还没有可展示的卡组统计'}
                    </div>
                  ) : (
                    <DonutChart
                      className="donut-chart--deck-environment"
                      title={chart.title}
                      ariaLabel={`赛季${chart.title}`}
                      data={series}
                      variant="pie"
                      showNormalizedPercentage={false}
                      formatValue={formatPercentage}
                    />
                  )}
                  <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                    {chart.description}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--text-muted)]">
            <span>对局观测覆盖 {formatPercentage(environment.sample.observationCoverageRate)}</span>
            <span>
              分类结果覆盖 {formatPercentage(environment.sample.classificationCoverageRate)}
            </span>
            <span>
              已识别 {environment.sample.recognizedDeckObservationCount} /{' '}
              {environment.sample.deckObservationCount} 场
            </span>
            {environment.visibleSections.includes('TOP_RANKED') ? (
              <span>
                排行榜前 {environment.topRankedPlayerCount}：符合门槛{' '}
                {environment.sample.topRankedEligiblePlayerCount} 人，其中{' '}
                {environment.sample.topRankedAnalyzedPlayerCount} 人有可分析卡组
              </span>
            ) : null}
          </div>

          <DeckArchetypeStatsTable environment={environment} />
        </>
      )}
    </Panel>
  );
}

const PLAYER_EQUAL_CHARTS = [
  {
    tab: 'USAGE',
    title: '玩家等权·使用占比',
    description: '每名玩家先按自己的使用对局归一化，再让每名玩家权重相同。',
    metric: 'playerEqualUsageRate',
  },
  {
    tab: 'WINNER',
    title: '玩家等权·胜者构成',
    description: '每名有胜场的玩家先归一化其胜方卡组，再对玩家等权。',
    metric: 'playerEqualWinnerRate',
  },
] as const;

const MATCH_EQUAL_CHARTS = [
  {
    tab: 'USAGE',
    title: '对局等权·使用占比',
    description: '每名玩家每场对局的卡组记录权重相同，频繁参赛玩家会按其实际场次计入。',
    metric: 'matchEqualUsageRate',
  },
  {
    tab: 'WINNER',
    title: '对局等权·胜者构成',
    description: '每场可分析对局的胜者权重相同，展示所有胜方卡组的构成。',
    metric: 'matchEqualWinnerRate',
  },
] as const;

const RANKED_ENVIRONMENT_TABS = [
  { value: 'USAGE', label: '使用占比' },
  { value: 'WINNER', label: '胜者构成' },
  { value: 'TOP_RANKED', label: '高排名玩家' },
] as const;

function RankedEnvironmentTabs({
  ariaLabel,
  panelId,
  tabs,
  activeTab,
  onChange,
}: {
  ariaLabel: string;
  panelId: string;
  tabs: readonly (typeof RANKED_ENVIRONMENT_TABS)[number][];
  activeTab: RankedEnvironmentTab;
  onChange: (tab: RankedEnvironmentTab) => void;
}) {
  return (
    <div
      className="mt-4 flex gap-1 border-b border-[var(--border-subtle)] pb-1"
      role="tablist"
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => (
        <button
          id={`${panelId}-tab-${tab.value}`}
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.value}
          aria-controls={panelId}
          className={`min-h-10 flex-1 rounded-lg px-2 py-2 text-sm font-semibold transition-colors duration-150 sm:px-4 ${
            activeTab === tab.value
              ? 'bg-[var(--bg-overlay)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)]'
          }`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function buildDeckChartSeries(
  entries: readonly DeckArchetypeEnvironmentEntryView[],
  metric: DeckEnvironmentRateKey,
  cardDataRegistry: ReadonlyMap<string, AnyCardData>
): DonutChartItem[] {
  const special = entries.filter((entry) => entry.classificationStatus !== 'CLASSIFIED');
  const classified = entries
    .filter((entry) => entry.classificationStatus === 'CLASSIFIED')
    .sort((left, right) => right[metric] - left[metric] || left.sortOrder - right.sortOrder);
  const visible = classified.slice(0, 8);
  const remainder = classified.slice(8).reduce((sum, entry) => sum + entry[metric], 0);
  const series: DonutChartItem[] = visible.map((entry) => ({
    id: entry.archetypeId,
    label: entry.name,
    value: entry[metric],
    color: entry.color,
    ...(entry.representativeCardCode
      ? {
          imageUrl: resolveCardImagePath(
            {
              cardCode: entry.representativeCardCode,
              imageFilename: entry.representativeImageFilename,
            },
            'medium'
          ),
          imageCrop:
            cardDataRegistry.get(entry.representativeCardCode)?.cardType === 'LIVE'
              ? 'live'
              : 'portrait',
        }
      : {}),
  }));
  if (remainder > 0) {
    series.push({
      id: 'visual:other-recognized',
      label: '其他已识别卡组',
      value: remainder,
      color: '#CBD5E1',
    });
  }
  series.push(
    ...special
      .filter((entry) => entry[metric] > 0)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((entry) => ({
        id: entry.archetypeId,
        label: entry.name,
        value: entry[metric],
        color: entry.color,
      }))
  );
  return series;
}

function DeckArchetypeStatsTable({ environment }: { environment: DeckArchetypeEnvironmentView }) {
  const showUsage = environment.visibleSections.includes('USAGE');
  const showPlayer = showUsage && environment.displayMode !== 'MATCH_EQUAL';
  const showMatch = showUsage && environment.displayMode !== 'PLAYER_EQUAL';
  const showTopRanked = environment.visibleSections.includes('TOP_RANKED');
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-[var(--bg-overlay)] text-[var(--text-muted)]">
          <tr>
            <th className="px-3 py-2 font-semibold">卡组分类</th>
            {showPlayer ? <th className="px-3 py-2 text-right font-semibold">玩家等权</th> : null}
            {showMatch ? <th className="px-3 py-2 text-right font-semibold">对局等权</th> : null}
            {showTopRanked ? (
              <th className="px-3 py-2 text-right font-semibold">
                前 {environment.topRankedPlayerCount} 玩家
              </th>
            ) : null}
            <th className="px-3 py-2 text-right font-semibold">出场</th>
            <th className="px-3 py-2 text-right font-semibold">胜率</th>
            <th className="px-3 py-2 text-right font-semibold">非镜像胜率</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)]">
          {environment.archetypes.map((entry) => (
            <tr key={entry.archetypeId}>
              <td className="whitespace-nowrap px-3 py-2 font-semibold text-[var(--text-primary)]">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: entry.color }}
                  aria-hidden="true"
                />
                {entry.name}
              </td>
              {showPlayer ? (
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                  {formatPercentage(entry.playerEqualUsageRate)}
                </td>
              ) : null}
              {showMatch ? (
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                  {formatPercentage(entry.matchEqualUsageRate)}
                </td>
              ) : null}
              {showTopRanked ? (
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                  {formatPercentage(entry.topRankedPlayerEqualUsageRate)}
                </td>
              ) : null}
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                {entry.appearanceCount} 场
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                {entry.winRate === null ? '—' : formatPercentage(entry.winRate)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--text-secondary)]">
                {entry.nonMirrorWinRate === null
                  ? '—'
                  : `${formatPercentage(entry.nonMirrorWinRate)}（${entry.nonMirrorAppearanceCount} 场）`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SeasonSummary({
  overview,
  onOpenSeasonNotice,
}: {
  overview: ReturnType<typeof useRankedStore.getState>['overview'];
  onOpenSeasonNotice: () => void;
}) {
  if (!overview) {
    return <Panel className="text-sm text-[var(--text-muted)]">正在读取赛季…</Panel>;
  }
  const player = overview.player;
  const cover = overview.season?.cover ?? {
    mode: 'DEFAULT' as const,
    revision: 0,
    maskLevel: 'STANDARD' as const,
    wide: null,
    compact: null,
  };
  return (
    <ActivityCoverHero
      activityKey={overview.season?.id ?? 'no-ranked-season'}
      cover={cover}
      variant="ranked"
      className="p-6 sm:p-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/65">
            赛季排位
          </div>
          <div className="mt-3 text-2xl font-bold tracking-[-0.025em] text-white sm:text-4xl">
            {overview.season?.name ?? '暂无赛季'}
          </div>
          <div className="mt-3 text-sm text-white/72">
            {overview.availability.message}
            {overview.availability.currentWindowEndsAt
              ? ` · 开放至 ${formatShortTime(overview.availability.currentWindowEndsAt)}`
              : overview.availability.nextOpensAt
                ? ` · 下次 ${formatShortTime(overview.availability.nextOpensAt)}`
                : ''}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <button
            type="button"
            onClick={onOpenSeasonNotice}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-white/25 bg-black/15 px-3 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <BookOpen size={14} />
            赛季公告
          </button>
          {player ? (
            <div className="text-right">
              <div className="text-2xl font-bold text-white">{player.rating ?? '—'}</div>
              <div className="text-xs text-white/65">
                {player.placement
                  ? `${player.placementCompleted} / ${player.placementRequired} 场 · 满 ${player.placementRequired} 场进入排行榜`
                  : player.rank !== null
                    ? `第 ${player.rank} 名 · 赛季积分`
                    : '赛季积分'}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {player ? (
        <div className="mt-12 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-white/16 pt-3 text-sm sm:mt-16">
          <div className="flex items-center gap-3 text-white/82">
            <span className="text-white/55">战绩</span>
            <span>{player.completedMatches} 场</span>
            <span>{player.wins} 胜</span>
            <span>{player.losses} 负</span>
          </div>
          {overview.season ? (
            <div className="flex items-center gap-2 text-white/55">
              <span>赛季结束</span>
              <time
                dateTime={new Date(overview.season.scheduledEndsAt).toISOString()}
                className="text-white/82"
              >
                {formatShortDate(overview.season.scheduledEndsAt)}
              </time>
            </div>
          ) : null}
        </div>
      ) : null}
    </ActivityCoverHero>
  );
}

function SeasonLists({
  overview,
  currentUserId,
}: {
  overview: ReturnType<typeof useRankedStore.getState>['overview'];
  currentUserId: string | null;
}) {
  if (!overview) {
    return null;
  }
  const hasPersonalRank = overview.player?.rank !== null && overview.player?.rank !== undefined;
  const shouldShowLeaderboard = overview.leaderboard.length > 0 || hasPersonalRank;
  if (overview.recentMatches.length === 0 && !shouldShowLeaderboard) {
    return null;
  }
  const hasBothLists = overview.recentMatches.length > 0 && shouldShowLeaderboard;
  const personalRank = overview.player?.rank ?? null;
  const showPersonalRankAfterLeaderboard = personalRank !== null && personalRank > 10;
  return (
    <div className={`mt-4 grid gap-4 ${hasBothLists ? 'md:grid-cols-2' : ''}`}>
      {overview.recentMatches.length > 0 ? (
        <Panel as="section" padding="compact">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">最近对局</h2>
          <div className="mt-2 divide-y divide-[var(--border-subtle)]">
            {overview.recentMatches.slice(0, 5).map((match) => (
              <div key={match.matchId} className="flex items-center justify-between py-2 text-sm">
                <span className="truncate text-[var(--text-secondary)]">
                  {match.opponentDisplayName}
                </span>
                <span
                  className={
                    match.result === 'WIN'
                      ? 'text-[var(--semantic-success)]'
                      : 'text-[var(--text-muted)]'
                  }
                >
                  {match.result === 'WIN' ? '胜' : match.result === 'LOSS' ? '负' : '无效'}
                  {match.ratingDelta !== null
                    ? ` ${match.ratingDelta >= 0 ? '+' : ''}${match.ratingDelta}`
                    : ''}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
      {shouldShowLeaderboard ? (
        <Panel as="section" padding="compact">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">排行榜</h2>
          <div className="mt-2 divide-y divide-[var(--border-subtle)]">
            {overview.leaderboard.slice(0, 10).map((entry) => {
              const isCurrentUser = entry.userId === currentUserId;
              return (
                <div
                  key={entry.userId}
                  className={`grid grid-cols-[2rem_1fr_auto] gap-2 rounded-lg px-2 py-2 text-sm ${
                    isCurrentUser
                      ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)]'
                      : ''
                  }`}
                >
                  <span className="text-[var(--text-muted)]">{entry.rank}</span>
                  <span
                    className={`truncate ${
                      isCurrentUser
                        ? 'font-semibold text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    {entry.displayName}
                    {isCurrentUser ? '（我）' : ''}
                  </span>
                  <span className="font-semibold text-[var(--text-primary)]">{entry.rating}</span>
                </div>
              );
            })}
          </div>
          {showPersonalRankAfterLeaderboard ? (
            <div className="mt-2 border-t border-[var(--border-default)] pt-2">
              <div className="grid grid-cols-[2rem_1fr_auto] gap-2 rounded-lg bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)] px-2 py-2 text-sm">
                <span className="text-[var(--text-muted)]">{personalRank}</span>
                <span className="font-semibold text-[var(--text-primary)]">我的排名</span>
                <span className="font-semibold text-[var(--text-primary)]">
                  {overview.player?.rating ?? '—'}
                </span>
              </div>
            </div>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}

function SeasonCardUsage({
  environment,
  loading,
  error,
  onRetry,
}: {
  environment: RankedSeasonEnvironmentView | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [chartTab, setChartTab] = useState<RankedEnvironmentTab>('USAGE');
  if (environment?.visibleSections.length === 0) return null;
  const enabledTabs = RANKED_ENVIRONMENT_TABS.filter((tab) =>
    environment?.visibleSections.includes(tab.value)
  );
  const activeChartTab = enabledTabs.some((tab) => tab.value === chartTab)
    ? chartTab
    : (enabledTabs[0]?.value ?? 'USAGE');
  const rankings =
    environment?.rankings.filter((ranking) => ranking.section === activeChartTab) ?? [];
  const hasCards = rankings.some((ranking) => ranking.cards.length > 0);

  return (
    <Panel as="section" padding="compact" className="mt-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">赛季卡牌使用率</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            展示各卡被卡组采用的比例；胜者构成不是单卡胜率，各卡比例也不要求合计为 100%。
          </p>
        </div>
        {environment ? (
          <p className="text-xs text-[var(--text-muted)]">
            {environment.sample.playerCount} 名玩家、{environment.sample.analyzedMatchCount}
            场可分析对局 · 数据覆盖 {formatPercentage(environment.sample.coverageRate)}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--text-muted)]">
          <Loader2 size={16} className="animate-spin" />
          正在读取赛季环境…
        </div>
      ) : error ? (
        <div className="py-6 text-center">
          <p className="text-sm text-[var(--semantic-error)]">{error}</p>
          <ActionButton variant="ghost" size="compact" className="mt-3" onClick={onRetry}>
            重新读取
          </ActionButton>
        </div>
      ) : !environment || environment.sample.analyzedMatchCount === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">
          暂无可统计的有效排位对局
        </p>
      ) : (
        <>
          {enabledTabs.length > 1 ? (
            <RankedEnvironmentTabs
              ariaLabel="卡牌使用率图表"
              panelId="ranked-card-environment-chart-panel"
              tabs={enabledTabs}
              activeTab={activeChartTab}
              onChange={setChartTab}
            />
          ) : null}

          <div
            id="ranked-card-environment-chart-panel"
            className="mt-4 space-y-4"
            role={enabledTabs.length > 1 ? 'tabpanel' : undefined}
            aria-labelledby={
              enabledTabs.length > 1
                ? `ranked-card-environment-chart-panel-tab-${activeChartTab}`
                : undefined
            }
          >
            {!hasCards ? (
              <p className="py-8 text-center text-sm text-[var(--text-muted)]">
                {activeChartTab === 'TOP_RANKED'
                  ? '当前高排名玩家还没有可分析的卡组观察'
                  : '当前还没有可展示的卡牌统计'}
              </p>
            ) : (
              rankings.map((ranking) => (
                <CardUsageRanking
                  key={`${ranking.section}:${ranking.weighting}`}
                  ranking={ranking}
                  topRankedPlayerCount={environment.topRankedPlayerCount}
                />
              ))
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--text-muted)]">
            {activeChartTab === 'USAGE' ? (
              <span>
                全部样本：{environment.sample.playerCount} 名玩家、
                {environment.sample.deckObservationCount} 场卡组记录
              </span>
            ) : activeChartTab === 'WINNER' ? (
              <span>
                胜方样本：{environment.sample.winningPlayerCount} 名获胜玩家、
                {environment.sample.analyzedMatchCount} 场对局
              </span>
            ) : (
              <span>
                排行榜前 {environment.topRankedPlayerCount}：符合门槛{' '}
                {environment.sample.topRankedEligiblePlayerCount} 人，其中{' '}
                {environment.sample.topRankedAnalyzedPlayerCount} 人有可分析卡组，共{' '}
                {environment.sample.topRankedDeckObservationCount} 场卡组记录
              </span>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

type RankedCardUsageRanking = RankedSeasonEnvironmentView['rankings'][number];

function CardUsageRanking({
  ranking,
  topRankedPlayerCount,
}: {
  ranking: RankedCardUsageRanking;
  topRankedPlayerCount: number;
}) {
  const title =
    ranking.section === 'TOP_RANKED'
      ? `前 ${topRankedPlayerCount} 名玩家·使用占比`
      : `${ranking.weighting === 'PLAYER_EQUAL' ? '玩家等权' : '对局等权'}·${
          ranking.section === 'USAGE' ? '使用占比' : '胜者构成'
        }`;
  const description =
    ranking.section === 'TOP_RANKED'
      ? `从当前排行榜前 ${topRankedPlayerCount} 名中，对有可分析卡组的玩家先分别归一化，再按玩家等权统计。`
      : ranking.weighting === 'PLAYER_EQUAL'
        ? ranking.section === 'USAGE'
          ? '每名玩家先按自己的赛季卡组采用情况归一化，再让每名玩家权重相同。'
          : '每名有胜场的玩家先按自己的胜方卡组归一化，再让每名获胜玩家权重相同。'
        : ranking.section === 'USAGE'
          ? '每名玩家每场对局的卡组记录权重相同，频繁参赛玩家会按实际场次计入。'
          : '每场可分析对局的胜方卡组权重相同，展示所有胜方卡组采用了哪些卡。';
  const cards = ranking.cards.slice(0, 30);
  const columns = [cards.slice(0, 15), cards.slice(15, 30)].filter((column) => column.length > 0);

  return (
    <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3 sm:p-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{description}</p>
      <div className={`mt-3 grid gap-x-5 ${columns.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {columns.map((column, columnIndex) => (
          <ol
            key={columnIndex}
            start={column[0]?.rank ?? 1}
            className="divide-y divide-[var(--border-subtle)]"
          >
            {column.map((card) => {
              const percentage = formatPercentage(card.adoptionRate);
              const width = Math.max(0, Math.min(1, card.adoptionRate)) * 100;
              return (
                <li
                  key={card.baseCardCode}
                  value={card.rank}
                  className="grid grid-cols-[2rem_2.5rem_minmax(0,1fr)_auto] items-center gap-2 py-2"
                >
                  <span className="text-center text-sm tabular-nums text-[var(--text-muted)]">
                    {card.rank}
                  </span>
                  <img
                    src={resolveCardImagePath(
                      {
                        cardCode: card.cardCode,
                        imageFilename: card.imageFilename,
                      },
                      'thumb'
                    )}
                    alt=""
                    loading="lazy"
                    className="h-14 w-10 rounded object-cover object-top shadow-[var(--shadow-sm)]"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      {card.name}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                      {card.baseCardCode} · {card.playerCount} 人 / {card.deckCount} 场
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-base)]">
                      <div
                        className="h-full rounded-full bg-[var(--accent-primary)]"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                    {percentage}
                  </span>
                </li>
              );
            })}
          </ol>
        ))}
      </div>
    </section>
  );
}

function QueueState({
  status,
  loading,
  error,
  onCancel,
  onConfirm,
  onEnterRoom,
  onOpenSeasonNotice,
}: {
  status: NonNullable<ReturnType<typeof useRankedStore.getState>['overview']>['queue'];
  loading: boolean;
  error: string | null;
  onCancel: () => Promise<void>;
  onConfirm: () => Promise<void>;
  onEnterRoom: () => void;
  onOpenSeasonNotice: () => void;
}) {
  const waiting = status.state === 'WAITING';
  const matched = status.state === 'MATCHED';
  return (
    <Panel as="section" padding="spacious" className="mx-auto mt-6 max-w-md text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-primary)]/12 text-[var(--accent-primary)]">
        {matched ? (
          <DoorOpen size={20} />
        ) : waiting ? (
          <Search size={20} />
        ) : (
          <ShieldCheck size={20} />
        )}
      </div>
      <h1 className="mt-3 text-xl font-semibold text-[var(--text-primary)]">
        {waiting
          ? '正在匹配对手'
          : matched
            ? '排位对局已准备好'
            : status.state === 'CREATING_ROOM'
              ? '正在进入对局'
              : '找到对手'}
      </h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        {waiting
          ? status.deckName
          : status.confirmed
            ? '已确认，等待对方'
            : matched
              ? `房间 ${status.roomCode}`
              : '请确认开局'}
      </p>
      <button
        type="button"
        onClick={onOpenSeasonNotice}
        className="button-ghost mt-4 inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] px-4 text-sm"
      >
        <BookOpen size={15} />
        查看赛季公告
      </button>
      {error ? <ErrorMessage message={error} /> : null}
      {waiting || status.state === 'CONFIRMED' ? (
        <ActionButton
          variant="secondary"
          className="mt-5 w-full"
          disabled={loading}
          onClick={() => void onCancel().catch(() => undefined)}
        >
          <X size={16} />
          取消匹配
        </ActionButton>
      ) : null}
      {status.state === 'PENDING_CONFIRMATION' ? (
        <div className="mt-5 grid grid-cols-2 gap-3">
          <ActionButton variant="secondary" onClick={() => void onCancel()}>
            取消
          </ActionButton>
          <ActionButton onClick={() => void onConfirm()}>确认开局</ActionButton>
        </div>
      ) : null}
      {status.state === 'CREATING_ROOM' ? (
        <Loader2 size={18} className="mx-auto mt-5 animate-spin text-[var(--accent-primary)]" />
      ) : null}
      {matched ? (
        <ActionButton className="mt-5 w-full" onClick={onEnterRoom}>
          返回房间
        </ActionButton>
      ) : null}
    </Panel>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="mt-3 rounded-lg bg-[var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]">
      {message}
    </p>
  );
}

function formatShortTime(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatShortDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
  }).format(new Date(value));
}

const percentageFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'percent',
  maximumFractionDigits: 1,
});

function formatPercentage(value: number) {
  return percentageFormatter.format(Math.max(0, Math.min(1, value)));
}
