import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  History,
  ListTree,
  LockKeyhole,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  Trophy,
  UserRound,
  X,
} from 'lucide-react';
import { PageHeader, ThemeToggle } from '@/components/common';
import { GameBoard } from '@/components/game';
import {
  fetchMatchRecordDetail,
  fetchMatchRecords,
  fetchMatchRecordReplay,
  fetchMatchRecordTimeline,
} from '@/lib/onlineClient';
import { useGameStore } from '@/store/gameStore';
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

interface MatchRecordsPageProps {
  onBack: () => void;
}

export function MatchRecordsPage({ onBack }: MatchRecordsPageProps) {
  const [records, setRecords] = useState<readonly MatchRecordSummaryView[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MatchRecordDetailView | null>(null);
  const [timeline, setTimeline] = useState<readonly MatchRecordTimelineEntryView[]>([]);
  const [replay, setReplay] = useState<MatchRecordReplayView | null>(null);
  const [isLoadingRecords, setIsLoadingRecords] = useState(true);
  const [isLoadingNode, setIsLoadingNode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replayBoardOpen, setReplayBoardOpen] = useState(false);
  const latestReplayRequestRef = useRef(0);
  const replayBoardOpenRef = useRef(false);
  const enterReadonlyReplay = useGameStore((s) => s.enterReadonlyReplay);
  const leaveReadonlyReplay = useGameStore((s) => s.leaveReadonlyReplay);

  const selectedRecord =
    records.find((candidate) => candidate.matchId === selectedMatchId) ?? records[0] ?? null;

  const loadRecords = useCallback(async () => {
    setIsLoadingRecords(true);
    setError(null);
    try {
      const nextRecords = await fetchMatchRecords();
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
  }, []);

  const loadMatchNode = useCallback(
    async (matchId: string, checkpointSeq?: number) => {
      const requestId = ++latestReplayRequestRef.current;
      setIsLoadingNode(true);
      setError(null);
      try {
        const [nextDetail, nextTimeline, nextReplay] = await Promise.all([
          fetchMatchRecordDetail(matchId),
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
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (!selectedMatchId) {
      latestReplayRequestRef.current += 1;
      replayBoardOpenRef.current = false;
      setReplayBoardOpen(false);
      setDetail(null);
      setTimeline([]);
      setReplay(null);
      leaveReadonlyReplay();
      return;
    }

    replayBoardOpenRef.current = false;
    setReplayBoardOpen(false);
    leaveReadonlyReplay();
    void loadMatchNode(selectedMatchId);
  }, [leaveReadonlyReplay, loadMatchNode, selectedMatchId]);

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

  return (
    <div className="app-shell flex min-h-screen flex-col overflow-x-hidden">
      <PageHeader
        title="历史对局"
        icon={<History size={18} />}
        left={
          <button type="button" onClick={onBack} className="button-icon" aria-label="返回主页">
            <ArrowLeft size={16} />
          </button>
        }
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
            <ThemeToggle />
          </>
        }
      />

      <main className="relative z-10 flex-1 px-3 py-4 sm:px-4 lg:px-5 xl:px-6">
        <div className="mx-auto grid w-full max-w-[1540px] items-start gap-4 lg:grid-cols-[minmax(220px,280px)_minmax(360px,1fr)_minmax(260px,320px)] xl:grid-cols-[300px_minmax(0,1fr)_360px]">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28 }}
            className="surface-panel min-w-0 overflow-x-hidden rounded-lg p-3 sm:p-4 lg:sticky lg:top-[5.75rem] lg:max-h-[calc(100dvh-6.5rem)]"
          >
            <PanelTitle
              icon={<History size={16} />}
              title="对局列表"
              detail={`${records.length} 条`}
            />

            {isLoadingRecords ? (
              <LoadingPanel label="读取历史对局" />
            ) : records.length === 0 ? (
              <EmptyPanel title="暂无历史对局" detail="完成正式联机对局后会在这里显示。" />
            ) : (
              <div className="mt-3 grid gap-2 lg:max-h-[calc(100dvh-12rem)] lg:overflow-x-hidden lg:overflow-y-auto lg:pr-1">
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
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.04 }}
            className="grid min-w-0 gap-4"
          >
            {error ? (
              <div className="rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:var(--semantic-error)]/10 px-4 py-3 text-sm text-[var(--semantic-error)]">
                {error}
              </div>
            ) : null}

            <section className="surface-panel rounded-lg p-4">
              <PanelTitle
                icon={<ShieldCheck size={16} />}
                title={selectedRecord ? shortId(selectedRecord.matchId) : '未选择对局'}
                detail={
                  selectedRecord ? formatDateTime(selectedRecord.startedAt) : '请选择一条记录'
                }
              />
              {selectedRecord?.partialReasonSummary ? (
                <PartialRecordNotice detail={selectedRecord.partialReasonSummary} />
              ) : null}
              {selectedRecord ? (
                <MatchRecordSummary
                  detail={detail}
                  record={selectedRecord}
                  loading={isLoadingNode}
                />
              ) : (
                <EmptyPanel title="未选择对局" detail="从左侧选择一条历史记录。" />
              )}
            </section>

            <section className="surface-panel rounded-lg p-4">
              <PanelTitle
                icon={<ListTree size={16} />}
                title="Timeline"
                detail={timeline.length > 0 ? `${timeline.length} 节点` : '无节点'}
              />
              {isLoadingNode && timeline.length === 0 ? (
                <LoadingPanel label="读取 timeline" />
              ) : timeline.length === 0 ? (
                <EmptyPanel title="暂无 timeline" detail="该记录还没有可读时间线。" />
              ) : (
                <div className="mt-3 grid max-h-[520px] gap-2 overflow-x-hidden overflow-y-auto pr-1 lg:max-h-[420px] xl:max-h-[460px]">
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
            </section>
          </motion.section>

          <motion.aside
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: 0.08 }}
            className="surface-panel min-w-0 overflow-x-hidden rounded-lg p-3 sm:p-4 lg:sticky lg:top-[5.75rem] lg:col-span-1 lg:max-h-[calc(100dvh-6.5rem)] lg:overflow-y-auto lg:overscroll-contain"
          >
            <PanelTitle
              icon={<Eye size={16} />}
              title="回放节点"
              detail={replay ? `checkpoint ${replay.replayPosition.checkpointSeq}` : '未载入'}
            />

            {isLoadingNode && !replay ? (
              <LoadingPanel label="读取 checkpoint" />
            ) : replay ? (
              <div className="mt-4 grid min-w-0 gap-3 xl:gap-4">
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
                <ReplayMetricGrid replay={replay} />
                <ReplayStagePanel replay={replay} />
                <VisibleEventList events={replay.visibleEvents} />
                <PrivateEventList events={replay.visiblePrivateEvents} />
                <DecisionRecordList decisions={replay.visibleDecisions} />
                <ZoneList zones={visibleZones} />
                <FrontCardList cards={visibleFrontCards} />
              </div>
            ) : (
              <EmptyPanel title="暂无 checkpoint" detail="选择带 checkpoint 的 timeline 节点。" />
            )}
          </motion.aside>
        </div>
      </main>

      {replayBoardOpen && replay ? (
        <div className="fixed inset-0 z-[200] overflow-hidden bg-[var(--bg-surface)]">
          <div className="h-full w-full">
            <GameBoard />
          </div>
          <div className="pointer-events-auto fixed left-4 right-4 top-4 z-[230] flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] px-3 py-2 text-[var(--text-primary)] shadow-[var(--shadow-lg)] backdrop-blur-xl">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">历史桌面回放</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                <span>checkpoint {replay.replayPosition.checkpointSeq}</span>
                <span>timeline {replay.replayPosition.timelineSeq}</span>
                <span>{replay.recordCompleteness}</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => handleStepCheckpoint(-1)}
                disabled={!canGoPreviousCheckpoint || isLoadingNode}
                className="button-icon h-9 w-9 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="上一个 checkpoint"
                title="上一个 checkpoint"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => handleStepCheckpoint(1)}
                disabled={!canGoNextCheckpoint || isLoadingNode}
                className="button-icon h-9 w-9 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="下一个 checkpoint"
                title="下一个 checkpoint"
              >
                <ChevronRight size={16} />
              </button>
              <button
                type="button"
                onClick={handleCloseReplayBoard}
                className="button-icon h-9 w-9"
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border px-3 py-3 text-left transition ${
        selected
          ? 'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_11%,var(--bg-surface))]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)] hover:bg-[var(--bg-overlay)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-[var(--text-primary)]">
            {record.opponentDisplayName ?? '对手'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>{record.viewerSeat}</span>
            <span>T{record.turnCount}</span>
            <span>{formatDateTime(record.startedAt)}</span>
          </div>
        </div>
        <StatusPill status={record.status} completeness={record.completeness} />
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

function MatchRecordSummary({
  detail,
  record,
  loading,
}: {
  detail: MatchRecordDetailView | null;
  record: MatchRecordSummaryView;
  loading: boolean;
}) {
  const first = detail?.participants.find((participant) => participant.seat === 'FIRST');
  const second = detail?.participants.find((participant) => participant.seat === 'SECOND');
  const viewerDeck = detail?.deckSnapshots.find((snapshot) => snapshot.seat === record.viewerSeat);

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <InfoTile icon={<UserRound size={15} />} label="FIRST" value={first?.displayName ?? '-'} />
      <InfoTile icon={<UserRound size={15} />} label="SECOND" value={second?.displayName ?? '-'} />
      <InfoTile
        icon={<Trophy size={15} />}
        label="胜者"
        value={record.winnerSeat ?? (record.status === 'IN_PROGRESS' ? '进行中' : '-')}
      />
      <InfoTile label="记录状态" value={`${record.status} / ${record.completeness}`} />
      <InfoTile label="结束原因" value={record.endReason ?? '-'} />
      <InfoTile
        label="我的卡组"
        value={
          viewerDeck
            ? `${viewerDeck.mainDeckCount}+${viewerDeck.energyDeckCount} · ${viewerDeck.sourceDeckName ?? viewerDeck.source}`
            : loading
              ? '读取中'
              : '-'
        }
      />
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
      className={`grid min-h-20 w-full grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border px-3 py-2 text-left transition ${
        selected
          ? 'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))]'
          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)] hover:bg-[var(--bg-overlay)]'
      } disabled:cursor-default disabled:opacity-70`}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-overlay)] font-mono text-xs font-bold text-[var(--accent-primary)]">
        {entry.timelineSeq}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {entry.summary}
          </span>
          {hasCheckpoint ? (
            <span className="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
              CP {entry.relatedCheckpointSeq}
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
          <span>{entry.frameType}</span>
          <span>T{entry.turnCount}</span>
          <span>
            {entry.phase} / {entry.subPhase}
          </span>
          <span>{formatDateTime(entry.createdAt)}</span>
        </div>
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
        aria-label="上一个 checkpoint"
        title="上一个 checkpoint"
      >
        <ChevronLeft size={16} />
      </button>
      <div className="min-w-0 text-center">
        <div className="text-xs text-[var(--text-muted)]">checkpoint</div>
        <div className="mt-0.5 truncate font-mono text-sm font-bold text-[var(--text-primary)]">
          {label}
        </div>
      </div>
      <button
        type="button"
        onClick={onNext}
        disabled={!canNext}
        className="button-icon h-9 w-9 disabled:cursor-default disabled:opacity-40"
        aria-label="下一个 checkpoint"
        title="下一个 checkpoint"
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
    <div className="grid min-w-0 grid-cols-3 gap-2">
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
              <div className="truncate text-sm font-medium text-[var(--text-primary)]">
                {card.name}
              </div>
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
        <h2 className="truncate text-sm font-bold text-[var(--text-primary)]">{title}</h2>
      </div>
      <span className="max-w-[45%] shrink-0 truncate text-right text-xs text-[var(--text-muted)]">
        {detail}
      </span>
    </div>
  );
}

function InfoTile({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">{value}</div>
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
      {status}
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
  readonly name: string;
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
    .map((object) => ({
      objectId: object.publicObjectId,
      cardCode: object.frontInfo?.cardCode ?? '-',
      name: object.frontInfo?.name ?? '未知卡牌',
      cardType: object.frontInfo?.cardType ?? object.cardType ?? '-',
      ownerSeat: object.ownerSeat,
    }));
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
