import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  Filter,
  History,
  ListTree,
  LockKeyhole,
  MousePointerClick,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { ActionButton, PageHeader, SelectMenu } from '@/components/common';
import { GameBoard } from '@/components/game';
import {
  exportAdminMatchRecordBundle,
  fetchAdminMatchRecordDetail,
  fetchAdminMatchRecordReplay,
  fetchAdminMatchRecords,
  fetchAdminMatchRecordTimeline,
  fetchMatchRecordDetail,
  fetchMatchRecords,
  fetchMatchRecordReplay,
  fetchMatchRecordTimeline,
  type AdminMatchRecordFilters,
} from '@/lib/onlineClient';
import { useGameStore } from '@/store/gameStore';
import { useAuthStore } from '@/store/authStore';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import { fetchRankedSeasons } from '@/lib/rankedAdminClient';
import { fetchThemeAdminEvents } from '@/lib/themeTableAdminClient';
import type {
  MatchRecordDetailView,
  MatchRecordDecisionView,
  MatchRecordReplayView,
  MatchRecordSummaryView,
  MatchRecordTimelineEntryView,
  MatchRecordVisibleEventView,
  MatchRecordVisiblePrivateEventView,
  Seat,
  ViewCardObject,
  ViewZoneState,
} from '@game/online';
import { hasPermission } from '@game/shared/auth/permissions';

interface MatchRecordsPageProps {
  onBack: () => void;
}

interface AdminActivityFilterOption {
  readonly value: string;
  readonly label: string;
}

export function MatchRecordsPage({ onBack }: MatchRecordsPageProps) {
  const [records, setRecords] = useState<readonly MatchRecordSummaryView[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MatchRecordDetailView | null>(null);
  const [timeline, setTimeline] = useState<readonly MatchRecordTimelineEntryView[]>([]);
  const [replay, setReplay] = useState<MatchRecordReplayView | null>(null);
  const [isLoadingRecords, setIsLoadingRecords] = useState(true);
  const [isLoadingNode, setIsLoadingNode] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminUserQuery, setAdminUserQuery] = useState('');
  const [adminDateFrom, setAdminDateFrom] = useState('');
  const [adminDateTo, setAdminDateTo] = useState('');
  const [adminActivity, setAdminActivity] = useState('');
  const [adminActivityOptions, setAdminActivityOptions] = useState<
    readonly AdminActivityFilterOption[]
  >([]);
  const [adminActivityOptionsError, setAdminActivityOptionsError] = useState<string | null>(null);
  const [adminFilters, setAdminFilters] = useState<AdminMatchRecordFilters>({});
  const [debugDetailsOpen, setDebugDetailsOpen] = useState(false);
  const [adminViewerSeat, setAdminViewerSeat] = useState<Seat>('FIRST');
  const [replayBoardOpen, setReplayBoardOpen] = useState(false);
  const profile = useAuthStore((s) => s.profile);
  const hasManagementHistoryAccess = profile
    ? hasPermission(profile.role, 'season.ranked.manage')
    : false;
  const canExport = profile ? hasPermission(profile.role, 'platform.manage') : false;
  const latestReplayRequestRef = useRef(0);
  const replayBoardOpenRef = useRef(false);
  const lastViewerSeatReloadKeyRef = useRef<string | null>(null);
  const hasManagementHistoryAccessRef = useRef(hasManagementHistoryAccess);
  const adminViewerSeatRef = useRef(adminViewerSeat);
  const enterReadonlyReplay = useGameStore((s) => s.enterReadonlyReplay);
  const leaveReadonlyReplay = useGameStore((s) => s.leaveReadonlyReplay);

  const selectedRecord =
    records.find((candidate) => candidate.matchId === selectedMatchId) ?? records[0] ?? null;

  useEffect(() => {
    hasManagementHistoryAccessRef.current = hasManagementHistoryAccess;
  }, [hasManagementHistoryAccess]);

  useEffect(() => {
    adminViewerSeatRef.current = adminViewerSeat;
  }, [adminViewerSeat]);

  useEffect(() => {
    if (!hasManagementHistoryAccess) {
      return;
    }
    let cancelled = false;
    void Promise.all([fetchRankedSeasons(), fetchThemeAdminEvents()])
      .then(([seasons, themeEvents]) => {
        if (cancelled) return;
        setAdminActivityOptions([
          ...seasons.map((season) => ({
            value: `ranked:${season.id}`,
            label: `排位 · ${season.name}`,
          })),
          ...themeEvents.map((event) => ({
            value: `theme:${event.id}`,
            label: `娱乐模式 · ${event.name}`,
          })),
        ]);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setAdminActivityOptions([]);
        setAdminActivityOptionsError(
          loadError instanceof Error ? loadError.message : '读取赛季活动筛选项失败'
        );
      });
    return () => {
      cancelled = true;
    };
  }, [hasManagementHistoryAccess]);

  const loadRecords = useCallback(async () => {
    setIsLoadingRecords(true);
    setError(null);
    try {
      const nextRecords = hasManagementHistoryAccess
        ? await fetchAdminMatchRecords(adminFilters)
        : await fetchMatchRecords();
      setRecords(nextRecords);
      setSelectedMatchId((current) =>
        current && nextRecords.some((record) => record.matchId === current)
          ? current
          : (nextRecords[0]?.matchId ?? null)
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取历史对局失败');
    } finally {
      setIsLoadingRecords(false);
    }
  }, [adminFilters, hasManagementHistoryAccess]);

  const loadMatchNode = useCallback(
    async (matchId: string, checkpointSeq?: number) => {
      const requestId = ++latestReplayRequestRef.current;
      setIsLoadingNode(true);
      setError(null);
      try {
        const adminSeat = adminViewerSeatRef.current;
        const nextDetail = hasManagementHistoryAccessRef.current
          ? await fetchAdminMatchRecordDetail(matchId)
          : await fetchMatchRecordDetail(matchId);
        if (requestId !== latestReplayRequestRef.current) {
          return;
        }
        if (nextDetail.completeness === 'METADATA_ONLY') {
          setDetail(nextDetail);
          setTimeline([]);
          setReplay(null);
          replayBoardOpenRef.current = false;
          setReplayBoardOpen(false);
          leaveReadonlyReplay();
          return;
        }
        const [nextTimeline, nextReplay] = hasManagementHistoryAccessRef.current
          ? await Promise.all([
              fetchAdminMatchRecordTimeline(matchId, adminSeat),
              fetchAdminMatchRecordReplay(matchId, { checkpointSeq, viewerSeat: adminSeat }),
            ])
          : await Promise.all([
              fetchMatchRecordTimeline(matchId),
              fetchMatchRecordReplay(matchId, { checkpointSeq }),
            ]);
        if (requestId !== latestReplayRequestRef.current) {
          return;
        }
        if (replayBoardOpenRef.current) {
          await enterReadonlyReplay(nextReplay, {
            shouldCommit: () => requestId === latestReplayRequestRef.current,
          });
        }
        if (requestId !== latestReplayRequestRef.current) {
          return;
        }
        setDetail(nextDetail);
        setTimeline(nextTimeline.timelineSummary);
        setReplay(nextReplay);
      } catch (loadError) {
        if (requestId !== latestReplayRequestRef.current) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : '读取历史节点失败');
        setDetail(null);
        setTimeline([]);
        setReplay(null);
        replayBoardOpenRef.current = false;
        setReplayBoardOpen(false);
        leaveReadonlyReplay();
      } finally {
        if (requestId === latestReplayRequestRef.current) {
          setIsLoadingNode(false);
        }
      }
    },
    [enterReadonlyReplay, leaveReadonlyReplay]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRecords(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRecords]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selectedMatchId) {
        latestReplayRequestRef.current += 1;
        replayBoardOpenRef.current = false;
        lastViewerSeatReloadKeyRef.current = null;
        setReplayBoardOpen(false);
        setDetail(null);
        setTimeline([]);
        setReplay(null);
        leaveReadonlyReplay();
        return;
      }

      const reloadKey = `${selectedMatchId}:${hasManagementHistoryAccess ? adminViewerSeat : 'participant'}`;
      if (lastViewerSeatReloadKeyRef.current === reloadKey) {
        return;
      }
      const isViewerSeatChange =
        lastViewerSeatReloadKeyRef.current?.startsWith(`${selectedMatchId}:`) === true;
      const checkpoint = isViewerSeatChange ? replay?.replayPosition.checkpointSeq : undefined;
      replayBoardOpenRef.current = false;
      lastViewerSeatReloadKeyRef.current = reloadKey;
      setReplayBoardOpen(false);
      leaveReadonlyReplay();
      void loadMatchNode(selectedMatchId, checkpoint);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    adminViewerSeat,
    hasManagementHistoryAccess,
    leaveReadonlyReplay,
    loadMatchNode,
    replay?.replayPosition.checkpointSeq,
    selectedMatchId,
  ]);

  useEffect(() => {
    return () => {
      latestReplayRequestRef.current += 1;
      replayBoardOpenRef.current = false;
      leaveReadonlyReplay();
    };
  }, [leaveReadonlyReplay]);

  useEffect(() => {
    if (!replayBoardOpen) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [replayBoardOpen]);

  const checkpointSeq = replay?.replayPosition.checkpointSeq ?? null;
  const visibleZones = useMemo(
    () => (replay ? summarizeZones(replay.playerViewState.table.zones) : []),
    [replay]
  );
  const visibleFrontCards = useMemo(
    () => (replay ? summarizeFrontCards(replay.playerViewState.objects) : []),
    [replay]
  );
  const checkpointEntries = useMemo(
    () => timeline.filter((entry) => entry.relatedCheckpointSeq !== null),
    [timeline]
  );
  const currentCheckpointIndex = useMemo(
    () =>
      checkpointSeq === null
        ? -1
        : checkpointEntries.findIndex((entry) => entry.relatedCheckpointSeq === checkpointSeq),
    [checkpointEntries, checkpointSeq]
  );
  const canGoPreviousCheckpoint = currentCheckpointIndex > 0;
  const canGoNextCheckpoint =
    currentCheckpointIndex >= 0 && currentCheckpointIndex < checkpointEntries.length - 1;

  const handleSelectTimeline = (entry: MatchRecordTimelineEntryView) => {
    if (!selectedMatchId || entry.relatedCheckpointSeq === null) {
      return;
    }
    void loadMatchNode(selectedMatchId, entry.relatedCheckpointSeq);
  };

  const handleStepCheckpoint = (direction: -1 | 1) => {
    if (!selectedMatchId || currentCheckpointIndex < 0) {
      return;
    }
    const nextEntry = checkpointEntries[currentCheckpointIndex + direction];
    if (!nextEntry?.relatedCheckpointSeq) {
      return;
    }
    void loadMatchNode(selectedMatchId, nextEntry.relatedCheckpointSeq);
  };

  const handleOpenReplayBoard = useCallback(async () => {
    if (!replay) {
      return;
    }
    setError(null);
    replayBoardOpenRef.current = true;
    const requestId = latestReplayRequestRef.current;
    try {
      await enterReadonlyReplay(replay, {
        shouldCommit: () => requestId === latestReplayRequestRef.current,
      });
      setReplayBoardOpen(true);
    } catch (openError) {
      replayBoardOpenRef.current = false;
      setReplayBoardOpen(false);
      leaveReadonlyReplay();
      setError(openError instanceof Error ? openError.message : '打开桌面回放失败');
    }
  }, [enterReadonlyReplay, leaveReadonlyReplay, replay]);

  const handleCloseReplayBoard = useCallback(() => {
    replayBoardOpenRef.current = false;
    setReplayBoardOpen(false);
    leaveReadonlyReplay();
  }, [leaveReadonlyReplay]);

  const handleApplyAdminFilters = useCallback(() => {
    const nextFilters: {
      userQuery?: string;
      startedFrom?: number;
      startedTo?: number;
      rankedSeasonId?: string;
      themeTableVersionId?: string;
    } = {};
    const query = adminUserQuery.trim();
    if (query) {
      nextFilters.userQuery = query;
    }
    const from = parseDateInputStart(adminDateFrom);
    const to = parseDateInputEnd(adminDateTo);
    if (from !== null) {
      nextFilters.startedFrom = from;
    }
    if (to !== null) {
      nextFilters.startedTo = to;
    }
    if (adminActivity.startsWith('ranked:')) {
      nextFilters.rankedSeasonId = adminActivity.slice('ranked:'.length);
    } else if (adminActivity.startsWith('theme:')) {
      nextFilters.themeTableVersionId = adminActivity.slice('theme:'.length);
    }
    setAdminFilters(nextFilters);
  }, [adminActivity, adminDateFrom, adminDateTo, adminUserQuery]);

  const handleResetAdminFilters = useCallback(() => {
    setAdminUserQuery('');
    setAdminDateFrom('');
    setAdminDateTo('');
    setAdminActivity('');
    setAdminFilters({});
  }, []);

  const handleExportSelectedRecord = useCallback(async () => {
    if (!selectedRecord || !canExport) {
      return;
    }
    setIsExporting(true);
    setError(null);
    try {
      const bundle = await exportAdminMatchRecordBundle(selectedRecord.matchId);
      downloadJson(
        `loveca-match-${selectedRecord.roomCode}-${selectedRecord.matchId}.replay.json`,
        bundle
      );
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '导出历史对局失败');
    } finally {
      setIsExporting(false);
    }
  }, [canExport, selectedRecord]);

  return (
    <div className="app-shell flex min-h-screen flex-col overflow-x-hidden">
      <PageHeader
        title="历史对局"
        icon={<History size={18} />}
        onBack={onBack}
        backLabel="返回大厅"
        right={
          <>
            <button
              type="button"
              onClick={() => void loadRecords()}
              disabled={isLoadingRecords}
              className="button-icon"
              aria-label="刷新历史对局"
              title="刷新历史对局"
            >
              <RefreshCw size={16} className={isLoadingRecords ? 'animate-spin' : ''} />
            </button>
          </>
        }
      />

      <main className="relative z-10 flex-1 px-3 pb-24 pt-4 sm:px-4 sm:pb-24 lg:px-5 lg:pb-4 xl:px-6">
        <div className="mx-auto grid w-full max-w-[1480px] items-start gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <section className="product-workbench flex min-w-0 flex-col overflow-hidden p-3 sm:p-4 lg:sticky lg:top-[5.75rem] lg:h-[calc(100dvh-6.5rem)]">
            <PanelTitle
              icon={<History size={16} />}
              title="对局列表"
              detail={`${records.length} 条`}
            />

            {hasManagementHistoryAccess ? (
              <AdminMatchRecordFiltersPanel
                userQuery={adminUserQuery}
                dateFrom={adminDateFrom}
                dateTo={adminDateTo}
                activity={adminActivity}
                activityOptions={adminActivityOptions}
                activityOptionsError={adminActivityOptionsError}
                appliedFilterCount={Object.keys(adminFilters).length}
                onUserQueryChange={setAdminUserQuery}
                onDateFromChange={setAdminDateFrom}
                onDateToChange={setAdminDateTo}
                onActivityChange={setAdminActivity}
                onApply={handleApplyAdminFilters}
                onReset={handleResetAdminFilters}
                disabled={isLoadingRecords}
              />
            ) : null}

            {isLoadingRecords ? (
              <LoadingPanel label="读取历史对局" />
            ) : records.length === 0 ? (
              <EmptyPanel title="暂无历史对局" detail="完成正式联机或对墙打后会在这里显示。" />
            ) : (
              <div className="mt-3 overflow-x-hidden border-y border-[var(--border-subtle)] lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                {records.map((record) => (
                  <MatchRecordButton
                    key={record.matchId}
                    record={record}
                    selected={record.matchId === selectedRecord?.matchId}
                    onClick={() => setSelectedMatchId(record.matchId)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="grid min-w-0 gap-4">
            {error ? (
              <div className="rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:var(--semantic-error)]/10 px-4 py-3 text-sm text-[var(--semantic-error)]">
                {error}
              </div>
            ) : null}

            <section className="surface-panel rounded-lg p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <PanelTitle
                  icon={<ShieldCheck size={16} />}
                  title={selectedRecord ? formatRecordTitle(selectedRecord) : '未选择对局'}
                  detail={
                    selectedRecord ? formatDateTime(selectedRecord.startedAt) : '请选择一条记录'
                  }
                />
                {hasManagementHistoryAccess && selectedRecord ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <SeatSegmentedControl value={adminViewerSeat} onChange={setAdminViewerSeat} />
                    {canExport ? (
                      <button
                        type="button"
                        onClick={() => void handleExportSelectedRecord()}
                        disabled={isExporting || selectedRecord.completeness === 'METADATA_ONLY'}
                        className="button-ghost inline-flex h-9 items-center justify-center gap-1.5 border border-[var(--border-default)] px-3 text-xs font-semibold disabled:opacity-50"
                        title={
                          selectedRecord.completeness === 'METADATA_ONLY'
                            ? '该记录的回放数据已清理'
                            : '导出回放'
                        }
                      >
                        <Download size={14} />
                        导出
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {selectedRecord?.partialReasonSummary ? (
                <PartialRecordNotice detail={selectedRecord.partialReasonSummary} />
              ) : null}
              {selectedRecord ? (
                <MatchRecordSummary
                  detail={detail}
                  record={selectedRecord}
                  viewerSeat={
                    hasManagementHistoryAccess ? adminViewerSeat : selectedRecord.viewerSeat
                  }
                  loading={isLoadingNode}
                />
              ) : (
                <EmptyPanel title="未选择对局" detail="从左侧选择一条历史记录。" />
              )}
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
              <div className="surface-panel rounded-lg p-4">
                <PanelTitle
                  icon={<Eye size={16} />}
                  title="桌面回放"
                  detail={replay ? formatSeatPerspective(replay.viewerSeat) : '未载入'}
                />

                {isLoadingNode && !replay ? (
                  <LoadingPanel label="读取 checkpoint" />
                ) : replay ? (
                  <div className="mt-4 grid min-w-0 gap-3">
                    <CheckpointNavigator
                      currentIndex={currentCheckpointIndex}
                      total={checkpointEntries.length}
                      canPrevious={canGoPreviousCheckpoint}
                      canNext={canGoNextCheckpoint}
                      onPrevious={() => handleStepCheckpoint(-1)}
                      onNext={() => handleStepCheckpoint(1)}
                    />
                    <button
                      type="button"
                      onClick={() => void handleOpenReplayBoard()}
                      disabled={isLoadingNode}
                      className="button-primary inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Eye size={15} />
                      打开桌面回放
                    </button>
                    {replay.partialReasonSummary ? (
                      <PartialRecordNotice detail={replay.partialReasonSummary} compact />
                    ) : null}
                  </div>
                ) : (
                  <EmptyPanel
                    title={
                      selectedRecord?.completeness === 'METADATA_ONLY'
                        ? '回放数据已清理'
                        : '暂无 checkpoint'
                    }
                    detail={
                      selectedRecord?.completeness === 'METADATA_ONLY'
                        ? '该对局仅保留结果、参与者和卡组来源等元信息。'
                        : '选择带 checkpoint 的 timeline 节点。'
                    }
                  />
                )}
              </div>

              <div className="surface-panel rounded-lg p-4">
                <PanelTitle
                  icon={<ListTree size={16} />}
                  title="对局进程"
                  detail={timeline.length > 0 ? `${timeline.length} 条` : '无记录'}
                />
                {isLoadingNode && timeline.length === 0 ? (
                  <LoadingPanel label="读取 timeline" />
                ) : timeline.length === 0 ? (
                  <EmptyPanel
                    title={
                      selectedRecord?.completeness === 'METADATA_ONLY'
                        ? '时间线已清理'
                        : '暂无 timeline'
                    }
                    detail={
                      selectedRecord?.completeness === 'METADATA_ONLY'
                        ? '完整回放仅保留最近 10 天。'
                        : '该记录还没有可读时间线。'
                    }
                  />
                ) : (
                  <div className="mt-3 max-h-[560px] overflow-x-hidden overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    {timeline.map((entry) => (
                      <TimelineRow
                        key={entry.timelineSeq}
                        entry={entry}
                        selected={
                          entry.relatedCheckpointSeq !== null &&
                          entry.relatedCheckpointSeq === checkpointSeq
                        }
                        onClick={() => handleSelectTimeline(entry)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>

            {replay ? (
              <section className="surface-panel rounded-lg p-4">
                <button
                  type="button"
                  onClick={() => setDebugDetailsOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-[var(--accent-primary)]">
                      <ListTree size={16} />
                    </span>
                    <span className="text-sm font-bold text-[var(--text-primary)]">调试详情</span>
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {debugDetailsOpen ? '收起' : '展开'}
                  </span>
                </button>
                {debugDetailsOpen ? (
                  <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <ReplayStagePanel replay={replay} />
                    <ReplayMetricGrid replay={replay} />
                    <VisibleEventList events={replay.visibleEvents} />
                    <PrivateEventList events={replay.visiblePrivateEvents} />
                    <DecisionRecordList decisions={replay.visibleDecisions} />
                    <ZoneList zones={visibleZones} />
                    <FrontCardList cards={visibleFrontCards} />
                  </div>
                ) : (
                  <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                    按需查看阶段、事件、决策与卡牌投影等审计信息。
                  </p>
                )}
              </section>
            ) : null}
          </section>
        </div>
      </main>

      {replayBoardOpen && replay ? (
        <div className="fixed inset-0 z-[var(--z-battle-replay-surface)] overflow-hidden bg-[var(--bg-surface)]">
          <div className="h-full w-full">
            <GameBoard />
          </div>
          <div className="pointer-events-auto fixed left-2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[230] max-w-[calc(100vw-1rem)] md:left-4 md:top-4">
            <div className="inline-flex h-11 max-w-full items-center overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-frosted)] text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl">
              <div className="flex min-w-0 items-center gap-2 px-3 text-sm font-semibold">
                <History
                  size={15}
                  aria-hidden="true"
                  className="shrink-0 text-[var(--accent-primary)]"
                />
                <span className="hidden sm:inline">历史回放</span>
                <span className="whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                  {currentCheckpointIndex >= 0 ? currentCheckpointIndex + 1 : 0}/
                  {checkpointEntries.length}
                </span>
              </div>
              <span className="h-5 w-px shrink-0 bg-[var(--border-default)]" />
              <button
                type="button"
                onClick={() => handleStepCheckpoint(-1)}
                disabled={!canGoPreviousCheckpoint || isLoadingNode}
                className="button-ghost grid h-10 w-10 shrink-0 place-items-center rounded-none p-0 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="上一个回放节点"
                title="上一个回放节点"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => handleStepCheckpoint(1)}
                disabled={!canGoNextCheckpoint || isLoadingNode}
                className="button-ghost grid h-10 w-10 shrink-0 place-items-center rounded-none p-0 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="下一个回放节点"
                title="下一个回放节点"
              >
                <ChevronRight size={16} />
              </button>
              <span className="h-5 w-px shrink-0 bg-[var(--border-default)]" />
              <button
                type="button"
                onClick={handleCloseReplayBoard}
                className="button-ghost grid h-10 w-10 shrink-0 place-items-center rounded-none p-0"
                aria-label="关闭桌面回放"
                title="关闭桌面回放"
              >
                <X size={16} />
              </button>
            </div>
          </div>
          {replay.partialReasonSummary ? (
            <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-[230] rounded-lg border border-[var(--semantic-warning)]/40 bg-[color:color-mix(in_srgb,var(--semantic-warning)_14%,var(--bg-frosted))] px-3 py-2 text-xs font-medium text-[var(--semantic-warning)] shadow-[var(--shadow-md)] backdrop-blur-xl md:left-auto md:w-[min(420px,calc(100vw-2rem))]">
              {replay.partialReasonSummary}
            </div>
          ) : null}
        </div>
      ) : null}
      {!replayBoardOpen && replay ? (
        <div className="fixed inset-x-3 bottom-3 z-[220] md:hidden">
          <div className="flex items-center gap-3 rounded-xl border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_96%,transparent)] px-3 py-2.5 shadow-[var(--shadow-lg)] backdrop-blur-xl">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold text-[var(--accent-primary)]">
                当前回放节点
              </div>
              <div className="truncate text-xs text-[var(--text-muted)]">
                Checkpoint {replay.replayPosition.checkpointSeq} ·{' '}
                {selectedRecord ? formatRecordTitle(selectedRecord) : '历史对局'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleOpenReplayBoard()}
              disabled={isLoadingNode}
              className="button-primary inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Eye size={14} />
              打开回放
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MatchRecordButton({
  record,
  selected,
  onClick,
}: {
  record: MatchRecordSummaryView;
  selected: boolean;
  onClick: () => void;
}) {
  const title = formatRecordTitle(record);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border-b border-[var(--border-subtle)] px-2.5 py-2.5 text-left transition last:border-b-0 ${
        selected
          ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_11%,var(--bg-surface))]'
          : 'bg-transparent hover:bg-[var(--bg-elevated)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-[var(--text-primary)]">{title}</div>
          <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-[11px] text-[var(--text-muted)]">
            <span>{formatDateTime(record.startedAt)}</span>
            <span>T{record.turnCount}</span>
            <span className="truncate">{shortId(record.matchId)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <ModePill mode={record.matchMode} />
          <StatusPill status={record.status} completeness={record.completeness} />
        </div>
      </div>
      {record.partialReasonSummary ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--semantic-warning)]">
          <AlertTriangle size={13} />
          <span className="truncate">{record.partialReasonSummary}</span>
        </div>
      ) : null}
    </button>
  );
}

function AdminMatchRecordFiltersPanel({
  userQuery,
  dateFrom,
  dateTo,
  activity,
  activityOptions,
  activityOptionsError,
  appliedFilterCount,
  onUserQueryChange,
  onDateFromChange,
  onDateToChange,
  onActivityChange,
  onApply,
  onReset,
  disabled,
}: {
  userQuery: string;
  dateFrom: string;
  dateTo: string;
  activity: string;
  activityOptions: readonly AdminActivityFilterOption[];
  activityOptionsError: string | null;
  appliedFilterCount: number;
  onUserQueryChange: (value: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onActivityChange: (value: string) => void;
  onApply: () => void;
  onReset: () => void;
  disabled: boolean;
}) {
  const hasFilterValue = Boolean(
    activity || userQuery.trim() || dateFrom || dateTo || appliedFilterCount > 0
  );

  return (
    <form
      className="-mx-3 mt-3 border-y border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-elevated)_52%,var(--bg-surface))] px-3 py-3 sm:-mx-4 sm:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) onApply();
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-[var(--text-primary)]">
          <Filter size={14} aria-hidden="true" className="shrink-0 text-[var(--accent-primary)]" />
          <h3 className="truncate text-xs font-semibold">筛选对局</h3>
        </div>
        <span
          className={`shrink-0 text-[11px] font-medium ${
            appliedFilterCount > 0 ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'
          }`}
        >
          {appliedFilterCount > 0 ? `${appliedFilterCount} 项生效` : '全部记录'}
        </span>
      </div>

      <div className="mt-2.5 grid gap-2.5">
        <SelectMenu
          label="按所属活动筛选"
          value={activity}
          options={[{ value: '', label: '全部活动' }, ...activityOptions]}
          onChange={onActivityChange}
          disabled={disabled}
          className="w-full shadow-none"
        />

        {activityOptionsError ? (
          <p
            className="flex items-start gap-1.5 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-warning)_25%,var(--border-subtle))] bg-[color:color-mix(in_srgb,var(--semantic-warning)_7%,transparent)] px-2.5 py-2 text-[11px] leading-4 text-[var(--semantic-warning)]"
            role="status"
          >
            <AlertTriangle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{activityOptionsError}</span>
          </p>
        ) : null}

        <label className="relative block">
          <span className="sr-only">搜索参与者或对局</span>
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            value={userQuery}
            onChange={(event) => onUserQueryChange(event.target.value)}
            type="search"
            autoComplete="off"
            maxLength={120}
            className="input-field h-10 pl-9 pr-3 text-sm"
            placeholder="用户名、房间号或对局 ID"
          />
        </label>

        <fieldset className="grid gap-1.5">
          <legend className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]">
            <CalendarDays size={13} aria-hidden="true" />
            开局日期
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid min-w-0 gap-1 text-[10px] text-[var(--text-muted)]">
              开始
              <input
                value={dateFrom}
                onChange={(event) => onDateFromChange(event.target.value)}
                type="date"
                max={dateTo || undefined}
                className="input-field h-10 min-w-0 px-2 text-[11px]"
              />
            </label>
            <label className="grid min-w-0 gap-1 text-[10px] text-[var(--text-muted)]">
              结束
              <input
                value={dateTo}
                onChange={(event) => onDateToChange(event.target.value)}
                type="date"
                min={dateFrom || undefined}
                className="input-field h-10 min-w-0 px-2 text-[11px]"
              />
            </label>
          </div>
        </fieldset>
      </div>

      <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-2">
        <ActionButton
          type="button"
          variant="ghost"
          size="compact"
          onClick={onReset}
          disabled={disabled || !hasFilterValue}
          className="border border-[var(--border-default)]"
        >
          清空
        </ActionButton>
        <ActionButton type="submit" size="compact" disabled={disabled}>
          <Search size={14} aria-hidden="true" />
          查询
        </ActionButton>
      </div>
    </form>
  );
}

function SeatSegmentedControl({
  value,
  onChange,
}: {
  value: Seat;
  onChange: (seat: Seat) => void;
}) {
  return (
    <div
      role="group"
      className="inline-flex rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-1"
      aria-label="选择回放视角"
    >
      {(['FIRST', 'SECOND'] as const).map((seat) => (
        <button
          key={seat}
          type="button"
          onClick={() => onChange(seat)}
          className={`h-7 rounded-md px-2 text-[11px] font-semibold transition ${
            value === seat
              ? 'bg-[var(--accent-primary)] text-white'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)]'
          }`}
        >
          {seat === 'FIRST' ? '先攻视角' : '后攻视角'}
        </button>
      ))}
    </div>
  );
}

function MatchRecordSummary({
  detail,
  record,
  viewerSeat,
  loading,
}: {
  detail: MatchRecordDetailView | null;
  record: MatchRecordSummaryView;
  viewerSeat: Seat;
  loading: boolean;
}) {
  const first = detail?.participants.find((participant) => participant.seat === 'FIRST');
  const second = detail?.participants.find((participant) => participant.seat === 'SECOND');
  const winner =
    record.winnerSeat === 'FIRST' ? first : record.winnerSeat === 'SECOND' ? second : null;
  const loser =
    record.winnerSeat === 'FIRST' ? second : record.winnerSeat === 'SECOND' ? first : null;
  const viewerDeck = detail?.deckSnapshots.find((snapshot) => snapshot.seat === viewerSeat);
  const endReasonSummary =
    record.endReason === 'OPPONENT_SURRENDER' && loser
      ? `${loser.displayName} 认输`
      : formatMatchEndReason(record.endReason);
  const resultSummary =
    record.status === 'IN_PROGRESS'
      ? '进行中'
      : winner
        ? `${winner.displayName} 获胜${record.endReason ? ` · ${endReasonSummary}` : ''}`
        : endReasonSummary;
  const deckSummary = viewerDeck
    ? `${viewerDeck.sourceDeckName ?? '未命名卡组'} · ${viewerDeck.mainDeckCount}+${viewerDeck.energyDeckCount}`
    : loading
      ? '读取中'
      : null;

  return (
    <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <ModePill mode={record.matchMode} />
        <span className="text-sm font-semibold text-[var(--text-primary)]">{resultSummary}</span>
      </div>
      {deckSummary ? (
        <div className="mt-2 border-t border-[var(--border-subtle)] pt-2 text-xs text-[var(--text-muted)]">
          {formatSeatPerspective(viewerSeat)}卡组：
          <span className="font-medium text-[var(--text-secondary)]">{deckSummary}</span>
        </div>
      ) : null}
    </div>
  );
}

function TimelineRow({
  entry,
  selected,
  onClick,
}: {
  entry: MatchRecordTimelineEntryView;
  selected: boolean;
  onClick: () => void;
}) {
  const hasCheckpoint = entry.relatedCheckpointSeq !== null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!hasCheckpoint}
      title={entry.summary}
      className={`grid min-h-14 w-full grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2 text-left transition last:border-b-0 ${
        selected
          ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-surface))]'
          : 'bg-transparent hover:bg-[var(--bg-overlay)]'
      } disabled:cursor-default disabled:opacity-70`}
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-overlay)] font-mono text-[10px] font-semibold text-[var(--accent-primary)]">
        {entry.timelineSeq}
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold text-[var(--text-primary)]">
            {formatFrameTypeLabel(entry.frameType)}
          </span>
          {hasCheckpoint ? (
            <span className="shrink-0 text-[10px] font-medium text-[var(--accent-primary)]">
              节点 {entry.relatedCheckpointSeq}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">第 {entry.turnCount} 回合</div>
      </div>
    </button>
  );
}

function CheckpointNavigator({
  currentIndex,
  total,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
}: {
  currentIndex: number;
  total: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const label = currentIndex >= 0 ? `${currentIndex + 1} / ${total}` : `0 / ${total}`;

  return (
    <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
      <button
        type="button"
        onClick={onPrevious}
        disabled={!canPrevious}
        className="button-icon h-9 w-9 disabled:cursor-default disabled:opacity-40"
        aria-label="上一个回放节点"
        title="上一个回放节点"
      >
        <ChevronLeft size={16} />
      </button>
      <div className="min-w-0 text-center">
        <div className="text-xs text-[var(--text-muted)]">回放节点</div>
        <div className="mt-0.5 truncate font-mono text-sm font-bold text-[var(--text-primary)]">
          {label}
        </div>
      </div>
      <button
        type="button"
        onClick={onNext}
        disabled={!canNext}
        className="button-icon h-9 w-9 disabled:cursor-default disabled:opacity-40"
        aria-label="下一个回放节点"
        title="下一个回放节点"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function ReplayMetricGrid({ replay }: { replay: MatchRecordReplayView }) {
  const objectCount = Object.keys(replay.playerViewState.objects).length;
  const frontCount = Object.values(replay.playerViewState.objects).filter(
    (object) => object.surface === 'FRONT'
  ).length;

  return (
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <MiniMetric label="模式" value={formatMatchModeLabel(replay.sourceMatchMode)} />
      <MiniMetric label="视角" value={replay.viewerSeat} />
      <MiniMetric label="对象" value={objectCount} />
      <MiniMetric label="正面" value={frontCount} />
    </div>
  );
}

function VisibleEventList({ events }: { events: readonly MatchRecordVisibleEventView[] }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase text-[var(--text-muted)]">
          <Clock3 size={13} />
          <span>可见事件</span>
        </div>
        <span className="text-[10px] text-[var(--text-muted)]">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <div className="px-3 py-4 text-sm text-[var(--text-muted)]">暂无可见事件</div>
      ) : (
        <div className="grid max-h-52 min-w-0 divide-y divide-[var(--border-subtle)] overflow-x-hidden overflow-y-auto">
          {events.slice(-8).map((event) => (
            <div key={event.eventId} className="min-w-0 px-3 py-2">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {event.summary}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                    <span>timeline {event.timelineSeq}</span>
                    <span>event {event.eventSeq}</span>
                    <span>{event.eventType}</span>
                    <span>T{event.turnCount}</span>
                  </div>
                  <EventPayloadPreview payload={event.payload} />
                </div>
                <span className="max-w-[42%] shrink-0 truncate text-right font-mono text-[10px] text-[var(--text-muted)]">
                  {event.source ?? event.actorSeat ?? '-'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PrivateEventList({ events }: { events: readonly MatchRecordVisiblePrivateEventView[] }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase text-[var(--text-muted)]">
          <LockKeyhole size={13} />
          <span>我的私密事件</span>
        </div>
        <span className="text-[10px] text-[var(--text-muted)]">{events.length}</span>
      </div>
      {events.length === 0 ? (
        <div className="px-3 py-4 text-sm text-[var(--text-muted)]">暂无私密事件</div>
      ) : (
        <div className="grid min-w-0 divide-y divide-[var(--border-subtle)]">
          {events.slice(-5).map((event) => (
            <div key={event.eventId} className="min-w-0 px-3 py-2">
              <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                {event.summary}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                <span>timeline {event.timelineSeq}</span>
                <span>event {event.eventSeq}</span>
                <span>{event.eventType}</span>
                <span>T{event.turnCount}</span>
              </div>
              <EventPayloadPreview payload={event.payload} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionRecordList({ decisions }: { decisions: readonly MatchRecordDecisionView[] }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase text-[var(--text-muted)]">
          <MousePointerClick size={13} />
          <span>我的决策</span>
        </div>
        <span className="text-[10px] text-[var(--text-muted)]">{decisions.length}</span>
      </div>
      {decisions.length === 0 ? (
        <div className="px-3 py-4 text-sm text-[var(--text-muted)]">暂无决策记录</div>
      ) : (
        <div className="grid max-h-52 min-w-0 divide-y divide-[var(--border-subtle)] overflow-x-hidden overflow-y-auto">
          {decisions.slice(-8).map((decision) => (
            <div key={decision.decisionId} className="min-w-0 px-3 py-2">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {decision.stepText ?? decision.effectTextSnapshot ?? decision.decisionType}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                    <span>timeline {decision.timelineSeq}</span>
                    <span>{decision.status}</span>
                    <span>{decision.stepId ?? '-'}</span>
                    <span>候选 {decision.visibleCandidates.length}</span>
                  </div>
                  <DecisionSubmissionPreview decision={decision} />
                </div>
                <span className="max-w-[42%] shrink-0 truncate text-right font-mono text-[10px] text-[var(--text-muted)]">
                  {decision.sourceBaseCardCode ?? decision.abilityId ?? '-'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionSubmissionPreview({ decision }: { decision: MatchRecordDecisionView }) {
  const text = formatDecisionSubmission(decision);
  if (!text) {
    return null;
  }
  return (
    <div className="mt-1 max-w-full truncate rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">
      {text}
    </div>
  );
}

function EventPayloadPreview({ payload }: { payload: unknown }) {
  const preview = formatEventPayload(payload);
  if (!preview) {
    return null;
  }
  return (
    <div className="mt-1 max-w-full truncate rounded border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">
      {preview}
    </div>
  );
}

function ReplayStagePanel({ replay }: { replay: MatchRecordReplayView }) {
  const match = replay.playerViewState.match;
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-[var(--text-primary)]">{match.phase}</div>
          <div className="mt-1 text-xs text-[var(--text-secondary)]">{match.subPhase}</div>
        </div>
        <div className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs font-semibold text-[var(--text-secondary)]">
          T{match.turnCount}
        </div>
      </div>
      <div className="mt-3 grid gap-1.5 text-xs text-[var(--text-muted)]">
        <span>active {match.activeSeat ?? '-'}</span>
        <span>priority {match.prioritySeat ?? '-'}</span>
        <span>public seq {match.seq}</span>
      </div>
    </div>
  );
}

function ZoneList({ zones }: { zones: readonly ZoneSummary[] }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-xs font-semibold uppercase text-[var(--text-muted)]">
        Zones
      </div>
      <div className="max-h-64 overflow-x-hidden overflow-y-auto">
        {zones.map((zone) => (
          <div
            key={zone.key}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0"
          >
            <div className="min-w-0">
              <div className="truncate font-mono text-xs text-[var(--text-secondary)]">
                {zone.label}
              </div>
              <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                {zone.ownerSeat ?? '-'}
              </div>
            </div>
            <div className="text-sm font-bold text-[var(--text-primary)]">{zone.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FrontCardList({ cards }: { cards: readonly FrontCardSummary[] }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-xs font-semibold uppercase text-[var(--text-muted)]">
        可见正面卡
      </div>
      {cards.length === 0 ? (
        <div className="px-3 py-4 text-sm text-[var(--text-muted)]">暂无正面卡</div>
      ) : (
        <div className="grid min-w-0 divide-y divide-[var(--border-subtle)]">
          {cards.map((card) => (
            <div key={card.objectId} className="min-w-0 px-3 py-2">
              <div
                className="truncate text-sm font-medium text-[var(--text-primary)]"
                title={card.title}
              >
                {card.nameCn}
              </div>
              {card.nameJp && (
                <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                  {card.nameJp}
                </div>
              )}
              <div className="mt-0.5 flex min-w-0 flex-wrap gap-2 text-xs text-[var(--text-muted)]">
                <span>{card.cardType}</span>
                <span className="min-w-0 max-w-full truncate">{card.cardCode}</span>
                <span>{card.ownerSeat}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PartialRecordNotice({ detail, compact = false }: { detail: string; compact?: boolean }) {
  return (
    <div
      className={`mt-3 flex items-start gap-2 rounded-lg border border-[color:var(--semantic-warning)]/35 bg-[color:var(--semantic-warning)]/10 px-3 ${
        compact ? 'py-2' : 'py-3'
      } text-xs text-[var(--semantic-warning)]`}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{detail}</span>
    </div>
  );
}

function PanelTitle({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[var(--accent-primary)]">{icon}</span>
        <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
      </div>
      <span className="max-w-[45%] shrink-0 truncate text-right text-xs text-[var(--text-muted)]">
        {detail}
      </span>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 truncate text-sm font-bold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="mt-3 flex min-h-36 items-center justify-center rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-sm text-[var(--text-muted)]">
      <RefreshCw size={15} className="mr-2 animate-spin" />
      {label}
    </div>
  );
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mt-3 rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-4 py-8 text-center">
      <div className="text-sm font-semibold text-[var(--text-secondary)]">{title}</div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">{detail}</div>
    </div>
  );
}

function StatusPill({
  status,
  completeness,
}: {
  status: MatchRecordSummaryView['status'];
  completeness: MatchRecordSummaryView['completeness'];
}) {
  const tone =
    completeness !== 'FULL'
      ? 'border-[color:var(--semantic-warning)]/40 text-[var(--semantic-warning)]'
      : status === 'COMPLETED'
        ? 'border-[color:var(--semantic-success)]/40 text-[var(--semantic-success)]'
        : 'border-[var(--border-subtle)] text-[var(--text-muted)]';
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      {formatRecordStatus({ status, completeness })}
    </span>
  );
}

function ModePill({ mode }: { mode: MatchRecordSummaryView['matchMode'] }) {
  const tone =
    mode === 'SOLITAIRE'
      ? 'border-[color:var(--semantic-warning)]/35 text-[var(--semantic-warning)]'
      : 'border-[var(--border-subtle)] text-[var(--text-muted)]';
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      {formatMatchModeLabel(mode)}
    </span>
  );
}

interface ZoneSummary {
  readonly key: string;
  readonly label: string;
  readonly ownerSeat?: Seat;
  readonly count: number;
}

interface FrontCardSummary {
  readonly objectId: string;
  readonly cardCode: string;
  readonly nameCn: string;
  readonly nameJp?: string;
  readonly title: string;
  readonly cardType: string;
  readonly ownerSeat: Seat;
}

function summarizeZones(zones: Readonly<Record<string, ViewZoneState>>): readonly ZoneSummary[] {
  return Object.entries(zones)
    .map(([key, zone]) => ({
      key,
      label: zoneLabel(key, zone),
      ownerSeat: zone.ownerSeat,
      count: zone.count,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function summarizeFrontCards(
  objects: Readonly<Record<string, ViewCardObject>>
): readonly FrontCardSummary[] {
  return Object.values(objects)
    .filter((object) => object.surface === 'FRONT' && object.frontInfo)
    .slice(0, 8)
    .map((object) => {
      const localizedName = object.frontInfo ? getCardLocalizedInfo(object.frontInfo) : null;

      return {
        objectId: object.publicObjectId,
        cardCode: object.frontInfo?.cardCode ?? '-',
        nameCn: localizedName?.displayNameCn ?? '未知卡牌',
        nameJp: localizedName?.nameJp ?? undefined,
        title: localizedName?.title ?? '未知卡牌',
        cardType: object.frontInfo?.cardType ?? object.cardType ?? '-',
        ownerSeat: object.ownerSeat,
      };
    });
}

function zoneLabel(key: string, zone: ViewZoneState): string {
  return key
    .replace(`${zone.ownerSeat ?? ''}_`, '')
    .replace(/_/g, ' ')
    .toLowerCase();
}

function formatDateTime(value: number | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function formatMatchModeLabel(mode: MatchRecordSummaryView['matchMode']): string {
  return mode === 'SOLITAIRE' ? '对墙打' : '正式联机';
}

function formatSeatPerspective(seat: Seat): string {
  return seat === 'FIRST' ? '先攻视角' : '后攻视角';
}

function formatMatchEndReason(reason: string | null): string {
  switch (reason) {
    case 'VICTORY_CONDITION':
      return '达成胜利条件';
    case 'OPPONENT_SURRENDER':
      return '认输结束';
    case 'DRAW':
      return '平局';
    case 'CARD_EFFECT':
      return '卡牌效果结束对局';
    case 'INFINITE_LOOP':
      return '无限循环判定';
    case null:
      return '对局结束';
    default:
      return '对局结束';
  }
}

function formatRecordStatus(
  record: Pick<MatchRecordSummaryView, 'status' | 'completeness'>
): string {
  const status =
    record.status === 'IN_PROGRESS'
      ? '进行中'
      : record.status === 'COMPLETED'
        ? '已完成'
        : record.status === 'SURRENDERED'
          ? '认输'
          : record.status === 'INTERRUPTED'
            ? '中断'
            : '异常';
  return record.completeness === 'METADATA_ONLY'
    ? `${status} · 仅元信息`
    : record.completeness === 'FULL'
      ? status
      : `${status} · 部分`;
}

function formatRecordTitle(record: MatchRecordSummaryView): string {
  const participants = record.participants ?? [];
  const first = participants.find((participant) => participant.seat === 'FIRST')?.displayName;
  const second = participants.find((participant) => participant.seat === 'SECOND')?.displayName;
  if (first && second) {
    return `${first} vs ${second}`;
  }
  return record.opponentDisplayName
    ? `${formatMatchModeLabel(record.matchMode)} · ${record.opponentDisplayName}`
    : `${formatMatchModeLabel(record.matchMode)} · ${record.roomCode}`;
}

function formatFrameTypeLabel(frameType: MatchRecordTimelineEntryView['frameType']): string {
  switch (frameType) {
    case 'MATCH_INITIALIZED':
      return '开始';
    case 'COMMAND_ACCEPTED':
      return '操作';
    case 'COMMAND_REJECTED':
      return '失败操作';
    case 'SYSTEM_TRANSITION':
      return '系统推进';
    case 'UNDO_ACCEPTED':
    case 'UNDO_APPLIED':
    case 'UNDO_REJECTED':
    case 'UNDO_REQUESTED':
    case 'UNDO_EXPIRED':
      return '撤销';
    case 'PUBLIC_EVENT':
      return '公开事件';
    case 'PRIVATE_EVENT':
      return '私密事件';
    case 'SEALED_AUDIT':
      return '封存审计';
    case 'GAME_EVENT':
      return '游戏事件';
    case 'DECISION_OPENED':
      return '等待玩家决定';
    case 'DECISION_SUBMITTED':
      return '玩家已决定';
    case 'CHECKPOINT_WRITTEN':
      return '保存回放节点';
    case 'MATCH_SEALED':
      return '对局结束';
    case 'RANDOMNESS_RECORDED':
      return '记录随机结果';
    default:
      return frameType;
  }
}

function parseDateInputStart(value: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function parseDateInputEnd(value: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value}T23:59:59.999`);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[^\w.!-]+/g, '_');
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatEventPayload(payload: unknown): string | null {
  if (payload === null || payload === undefined) {
    return null;
  }
  if (typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const parts: string[] = [];

    if (typeof record.type === 'string' && record.type.trim()) {
      parts.push(record.type);
    }
    if (typeof record.seat === 'string' && record.seat.trim()) {
      parts.push(record.seat);
    }
    if (typeof record.actorSeat === 'string' && record.actorSeat.trim()) {
      parts.push(`actor ${record.actorSeat}`);
    }
    if (typeof record.seq === 'number') {
      parts.push(`seq ${record.seq}`);
    }

    const nestedPayload =
      record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? (record.payload as Record<string, unknown>)
        : null;
    if (nestedPayload) {
      const payloadKeys = Object.keys(nestedPayload).slice(0, 4);
      if (payloadKeys.length > 0) {
        parts.push(`payload: ${payloadKeys.join(', ')}`);
      }
    }

    if (parts.length > 0) {
      return parts.join(' · ');
    }

    const keys = Object.keys(record).slice(0, 4);
    return keys.length > 0 ? `fields: ${keys.join(', ')}` : null;
  }

  try {
    const text = JSON.stringify(payload);
    if (!text || text === '{}') {
      return null;
    }
    return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  } catch {
    return '[unserializable]';
  }
}

function formatDecisionSubmission(decision: MatchRecordDecisionView): string | null {
  if (decision.status === 'OPENED') {
    return decision.visibleCandidates.length > 0
      ? `opened candidates=${decision.visibleCandidates.length}`
      : 'opened';
  }
  const submission = decision.submission;
  if (!submission) {
    return decision.resultSummary;
  }
  const parts = [
    submission.commandType ? `cmd=${submission.commandType}` : null,
    submission.selectedCardId !== undefined ? `card=${submission.selectedCardId ?? 'none'}` : null,
    submission.selectedCardIds ? `cards=${submission.selectedCardIds.join(',')}` : null,
    submission.selectedSlot ? `slot=${submission.selectedSlot}` : null,
    submission.selectedOptionId ? `option=${submission.selectedOptionId}` : null,
    submission.selectedNumber !== undefined
      ? `number=${submission.selectedNumber ?? 'none'}`
      : null,
    submission.stageFormationMoveHistory
      ? `formationMoves=${submission.stageFormationMoveHistory.length}`
      : null,
    submission.selectedPendingAbilityId ? `pending=${submission.selectedPendingAbilityId}` : null,
    submission.faceDown !== undefined ? `faceDown=${String(submission.faceDown)}` : null,
    submission.resolveInOrder ? 'resolveInOrder' : null,
    submission.skipped ? 'skipped' : null,
  ].filter(Boolean);
  return [parts.join(' '), decision.resultSummary].filter(Boolean).join(' · ') || null;
}

function shortId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 7)}...${value.slice(-4)}` : value;
}
