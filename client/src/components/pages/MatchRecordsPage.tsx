import {
  AdminMatchRecordFiltersPanel,
  type AdminActivityFilterOption,
} from '@/components/common/AdminMatchRecordFiltersPanel';
import { buildMatchRecordFilters } from '@/lib/matchRecordFilters';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  History,
  ListTree,
  LockKeyhole,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  ActionButton,
  EmptyState,
  ErrorNotice,
  LoadingState,
  PageHeader,
  Panel,
  SectionHeading,
  StatusBadge,
} from '@/components/common';
import { GameBoard } from '@/components/game';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  exportAdminMatchRecordBundle,
  fetchAdminMatchRecordAuditPage,
  fetchAdminMatchRecordDetail,
  fetchAdminMatchRecordReplay,
  fetchAdminMatchRecords,
  fetchAdminMatchRecordTimeline,
  fetchMatchRecordDetail,
  fetchMatchRecordAuditPage,
  fetchMatchRecords,
  fetchMatchRecordReplay,
  fetchMatchRecordTimeline,
  type AdminMatchRecordFilters,
} from '@/lib/onlineClient';
import { useGameStore } from '@/store/gameStore';
import { useAuthStore } from '@/store/authStore';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import { ApiClientError } from '@/lib/apiClient';
import { ReplayNodeRequestCache } from '@/lib/replayNodeRequestCache';
import {
  estimateUtf8Bytes,
  isReplayAdjacentPrefetchEnabled,
  recordReplayPerformanceEvent,
  replayPerformanceNow,
} from '@/lib/replayPerformance';
import { fetchRankedSeasons } from '@/lib/rankedAdminClient';
import { fetchThemeAdminEvents } from '@/lib/themeTableAdminClient';
import type {
  MatchRecordDetailView,
  MatchRecordAuditPageView,
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
import { getPhaseName } from '@game/shared/phase-config';
import { GamePhase } from '@game/shared/types/enums';
import type { Ref } from 'react';
import { hasPermission } from '@game/shared/auth/permissions';
import { AiRecordedBilling } from '@/components/admin/AiRecordedBilling';
import { exportAiRecordedEvidence } from '@/lib/aiBattleClient';
import { saveAs } from 'file-saver';

const RECORD_PAGE_SIZE = 30;

interface MatchRecordsPageProps {
  onBack: () => void;
  initialMatchId?: string | null;
}

type MatchRecordAuditPages = Readonly<
  Partial<Record<'PUBLIC_EVENTS' | 'PRIVATE_EVENTS' | 'DECISIONS', MatchRecordAuditPageView>>
>;

interface FailedReplayNode {
  readonly checkpointSeq: number;
  readonly message: string;
}

export function MatchRecordsPage({ onBack, initialMatchId = null }: MatchRecordsPageProps) {
  const [records, setRecords] = useState<readonly MatchRecordSummaryView[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(initialMatchId);
  const [detail, setDetail] = useState<MatchRecordDetailView | null>(null);
  const [timeline, setTimeline] = useState<readonly MatchRecordTimelineEntryView[]>([]);
  const [replay, setReplay] = useState<MatchRecordReplayView | null>(null);
  const [isLoadingRecords, setIsLoadingRecords] = useState(true);
  const [isLoadingContext, setIsLoadingContext] = useState(false);
  const [isLoadingNode, setIsLoadingNode] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const detailErrorActionRef = useRef<'context' | 'open' | 'export' | 'ai-export'>('context');
  const [failedReplayNode, setFailedReplayNode] = useState<FailedReplayNode | null>(null);
  const [adminUserQuery, setAdminUserQuery] = useState('');
  const [adminPlayerAQuery, setAdminPlayerAQuery] = useState('');
  const [adminPlayerBQuery, setAdminPlayerBQuery] = useState('');
  const [adminDateFrom, setAdminDateFrom] = useState('');
  const [adminDateTo, setAdminDateTo] = useState('');
  const [adminActivity, setAdminActivity] = useState('');
  const [adminActivityOptions, setAdminActivityOptions] = useState<
    readonly AdminActivityFilterOption[]
  >([]);
  const [adminActivityOptionsError, setAdminActivityOptionsError] = useState<string | null>(null);
  const [adminFilters, setAdminFilters] = useState<AdminMatchRecordFilters>({});
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [isLoadingMoreRecords, setIsLoadingMoreRecords] = useState(false);
  const [hasMoreRecords, setHasMoreRecords] = useState(false);
  const loadedRecordCountRef = useRef(0);
  const failedRecordsAppendRef = useRef(false);
  const isNarrow = useMediaQuery('(max-width: 1023px)');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(initialMatchId));
  const listScrollRef = useRef(0);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);
  const detailHeadingRef = useRef<HTMLDivElement | null>(null);
  const [debugDetailsOpen, setDebugDetailsOpen] = useState(false);
  const [auditPages, setAuditPages] = useState<MatchRecordAuditPages>({});
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [loadingMoreAuditKind, setLoadingMoreAuditKind] = useState<
    'PUBLIC_EVENTS' | 'PRIVATE_EVENTS' | 'DECISIONS' | null
  >(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [adminViewerSeat, setAdminViewerSeat] = useState<Seat>('FIRST');
  const [replayBoardOpen, setReplayBoardOpen] = useState(false);
  const profile = useAuthStore((s) => s.profile);
  const hasManagementHistoryAccess = profile
    ? hasPermission(profile.role, 'season.ranked.manage')
    : false;
  const canExport = profile ? hasPermission(profile.role, 'platform.manage') : false;
  const latestReplayRequestRef = useRef(0);
  const latestAuditRequestRef = useRef(0);
  const replayContextAbortRef = useRef<AbortController | null>(null);
  const replayAuditAbortRef = useRef<AbortController | null>(null);
  const prefetchedNodeKeysRef = useRef(new Set<string>());
  const prefetchInFlightNodeKeysRef = useRef(new Set<string>());
  const consumedPrefetchNodeKeysRef = useRef(new Set<string>());
  const currentViewerSeatRef = useRef<Seat | null>(null);
  const replayBoardOpenRef = useRef(false);
  const lastViewerSeatReloadKeyRef = useRef<string | null>(null);
  const hasManagementHistoryAccessRef = useRef(hasManagementHistoryAccess);
  const adminViewerSeatRef = useRef(adminViewerSeat);
  const enterReadonlyReplay = useGameStore((s) => s.enterReadonlyReplay);
  const leaveReadonlyReplay = useGameStore((s) => s.leaveReadonlyReplay);

  const [replayNodeCache] = useState(() => new ReplayNodeRequestCache<MatchRecordReplayView>(12));

  const selectedRecord =
    records.find((candidate) => candidate.matchId === selectedMatchId) ??
    (detail?.matchId === selectedMatchId ? detail : null);
  const showRecordDetails = records.length > 0 || selectedMatchId !== null;

  useEffect(() => {
    hasManagementHistoryAccessRef.current = hasManagementHistoryAccess;
  }, [hasManagementHistoryAccess]);

  useEffect(() => {
    adminViewerSeatRef.current = adminViewerSeat;
  }, [adminViewerSeat]);

  useEffect(() => {
    replayNodeCache.setEventListener((cacheEvent) => {
      if (cacheEvent.type === 'CACHE_HIT') {
        recordReplayPerformanceEvent('NODE_CACHE_HIT');
      } else if (cacheEvent.type === 'CACHE_EVICTED') {
        recordReplayPerformanceEvent('NODE_CACHE_EVICTED');
        if (prefetchedNodeKeysRef.current.delete(cacheEvent.key)) {
          recordReplayPerformanceEvent('PREFETCH_UNUSED', { count: 1 });
        }
      } else if (cacheEvent.type === 'IN_FLIGHT_REUSED') {
        recordReplayPerformanceEvent('NODE_IN_FLIGHT_REUSED');
      }
    });
    return () => replayNodeCache.setEventListener();
  }, [replayNodeCache]);

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
            label: `主题牌桌 · ${event.name}`,
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

  const recordsRequestRef = useRef(0);
  useEffect(
    () => () => {
      recordsRequestRef.current += 1;
    },
    []
  );
  const loadRecords = useCallback(
    async (append = false) => {
      const requestId = ++recordsRequestRef.current;
      if (append) setIsLoadingMoreRecords(true);
      else setIsLoadingRecords(true);
      setRecordsError(null);
      failedRecordsAppendRef.current = append;
      try {
        const page = hasManagementHistoryAccess
          ? await fetchAdminMatchRecords(adminFilters)
          : await fetchMatchRecords({
              limit: RECORD_PAGE_SIZE + 1,
              offset: append ? loadedRecordCountRef.current : 0,
            });
        if (requestId !== recordsRequestRef.current) return;
        const nextRecords = hasManagementHistoryAccess ? page : page.slice(0, RECORD_PAGE_SIZE);
        loadedRecordCountRef.current =
          (append ? loadedRecordCountRef.current : 0) + nextRecords.length;
        setHasMoreRecords(!hasManagementHistoryAccess && page.length > RECORD_PAGE_SIZE);
        setRecords((current) =>
          append
            ? [
                ...current,
                ...nextRecords.filter(
                  (record) => !current.some((item) => item.matchId === record.matchId)
                ),
              ]
            : nextRecords
        );
        if (!append)
          setSelectedMatchId((current) =>
            current &&
            (!hasManagementHistoryAccess ||
              current === initialMatchId ||
              nextRecords.some((record) => record.matchId === current))
              ? current
              : (nextRecords[0]?.matchId ?? null)
          );
      } catch (loadError) {
        if (requestId !== recordsRequestRef.current) return;
        setRecordsError(loadError instanceof Error ? loadError.message : '读取历史对局失败');
      } finally {
        if (requestId === recordsRequestRef.current) {
          setIsLoadingRecords(false);
          setIsLoadingMoreRecords(false);
        }
      }
    },
    [adminFilters, hasManagementHistoryAccess, initialMatchId]
  );

  useEffect(() => {
    if (!isNarrow) return;
    const frame = requestAnimationFrame(() => {
      if (mobileDetailOpen) {
        scrollRootRef.current?.scrollTo({ top: 0 });
        detailHeadingRef.current?.focus({ preventScroll: true });
      } else {
        scrollRootRef.current?.scrollTo({ top: listScrollRef.current });
        selectedButtonRef.current?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isNarrow, mobileDetailOpen]);

  const handleSelectRecord = (matchId: string) => {
    listScrollRef.current = scrollRootRef.current?.scrollTop ?? 0;
    setSelectedMatchId(matchId);
    setMobileDetailOpen(true);
  };

  const loadReplayNode = useCallback(
    async (matchId: string, checkpointSeq?: number) => {
      const viewerSeat = currentViewerSeatRef.current;
      if (!viewerSeat || checkpointSeq === undefined) {
        return;
      }
      const requestId = ++latestReplayRequestRef.current;
      const nodeKey = createReplayNodeKey(matchId, viewerSeat, checkpointSeq);
      const nodeCache = replayNodeCache;
      const consumedCompletedPrefetch = prefetchedNodeKeysRef.current.delete(nodeKey);
      const consumedInFlightPrefetch = prefetchInFlightNodeKeysRef.current.delete(nodeKey);
      if (consumedInFlightPrefetch) {
        consumedPrefetchNodeKeysRef.current.add(nodeKey);
      }
      if (consumedCompletedPrefetch || consumedInFlightPrefetch) {
        recordReplayPerformanceEvent('PREFETCH_HIT', { checkpointSeq });
      }
      nodeCache.cancelInFlightExcept(nodeKey);
      replayAuditAbortRef.current?.abort();
      replayAuditAbortRef.current = null;
      setIsLoadingNode(true);
      setContextError(null);
      setFailedReplayNode(null);
      setIsLoadingAudit(false);
      setLoadingMoreAuditKind(null);
      setAuditPages({});
      setAuditError(null);
      latestAuditRequestRef.current += 1;
      try {
        const adminSeat = adminViewerSeatRef.current;
        const requestStartedAt = replayPerformanceNow();
        const nodeLoad = nodeCache.getOrLoad(nodeKey, async (signal) => {
          recordReplayPerformanceEvent('NODE_REQUEST_STARTED', { checkpointSeq });
          try {
            const nextReplay = hasManagementHistoryAccessRef.current
              ? await fetchAdminMatchRecordReplay(matchId, {
                  checkpointSeq,
                  viewerSeat: adminSeat,
                  signal,
                })
              : await fetchMatchRecordReplay(matchId, { checkpointSeq, signal });
            recordReplayPerformanceEvent('NODE_REQUEST_COMPLETED', () => ({
              checkpointSeq,
              durationMs: replayPerformanceNow() - requestStartedAt,
              responseBytes: estimateUtf8Bytes(nextReplay),
            }));
            return nextReplay;
          } catch (loadError) {
            recordReplayRequestFailure(loadError, checkpointSeq, requestStartedAt);
            throw loadError;
          }
        });
        const nextReplay = await nodeLoad.promise;
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
        setReplay(nextReplay);
      } catch (loadError) {
        if (requestId !== latestReplayRequestRef.current) {
          return;
        }
        if (isAbortedReplayRequest(loadError)) {
          return;
        }
        const message = loadError instanceof Error ? loadError.message : '读取历史节点失败';
        setContextError(message);
        setFailedReplayNode({ checkpointSeq, message });
      } finally {
        if (requestId === latestReplayRequestRef.current) {
          setIsLoadingNode(false);
        }
      }
    },
    [enterReadonlyReplay, replayNodeCache]
  );

  const loadMatchContext = useCallback(
    async (matchId: string, checkpointSeq?: number) => {
      const requestId = ++latestReplayRequestRef.current;
      const requestStartedAt = replayPerformanceNow();
      recordReplayPerformanceEvent('CONTEXT_REQUEST_STARTED');
      replayContextAbortRef.current?.abort();
      replayAuditAbortRef.current?.abort();
      recordUnusedReplayPrefetches(
        prefetchedNodeKeysRef.current,
        prefetchInFlightNodeKeysRef.current,
        consumedPrefetchNodeKeysRef.current
      );
      replayNodeCache.clear();
      const controller = new AbortController();
      replayContextAbortRef.current = controller;
      replayAuditAbortRef.current = null;
      currentViewerSeatRef.current = null;
      latestAuditRequestRef.current += 1;
      setIsLoadingContext(true);
      setIsLoadingNode(false);
      setContextError(null);
      setFailedReplayNode(null);
      setIsLoadingAudit(false);
      setLoadingMoreAuditKind(null);
      setAuditPages({});
      setAuditError(null);
      setDetail(null);
      setTimeline([]);
      setReplay(null);
      try {
        const adminSeat = adminViewerSeatRef.current;
        const nextDetail = hasManagementHistoryAccessRef.current
          ? await fetchAdminMatchRecordDetail(matchId, { signal: controller.signal })
          : await fetchMatchRecordDetail(matchId, { signal: controller.signal });
        if (requestId !== latestReplayRequestRef.current) return;
        const viewerSeat = hasManagementHistoryAccessRef.current
          ? adminSeat
          : nextDetail.viewerSeat;
        currentViewerSeatRef.current = viewerSeat;
        setDetail(nextDetail);
        if (nextDetail.completeness === 'METADATA_ONLY') {
          recordReplayPerformanceEvent('CONTEXT_REQUEST_COMPLETED', () => ({
            durationMs: replayPerformanceNow() - requestStartedAt,
            timelineRows: 0,
            responseBytes: estimateUtf8Bytes(nextDetail),
          }));
          return;
        }

        const [nextTimeline, nextReplay] = hasManagementHistoryAccessRef.current
          ? await Promise.all([
              fetchAdminMatchRecordTimeline(matchId, adminSeat, { signal: controller.signal }),
              fetchAdminMatchRecordReplay(matchId, {
                checkpointSeq,
                viewerSeat: adminSeat,
                signal: controller.signal,
              }),
            ])
          : await Promise.all([
              fetchMatchRecordTimeline(matchId, { signal: controller.signal }),
              fetchMatchRecordReplay(matchId, { checkpointSeq, signal: controller.signal }),
            ]);
        if (requestId !== latestReplayRequestRef.current) return;
        replayNodeCache.set(
          createReplayNodeKey(matchId, viewerSeat, nextReplay.replayPosition.checkpointSeq),
          nextReplay
        );
        setTimeline(nextTimeline.timelineSummary);
        setReplay(nextReplay);
        recordReplayPerformanceEvent('CONTEXT_REQUEST_COMPLETED', () => ({
          durationMs: replayPerformanceNow() - requestStartedAt,
          timelineRows: nextTimeline.timelineSummary.length,
          responseBytes: estimateUtf8Bytes([nextDetail, nextTimeline, nextReplay]),
        }));
      } catch (loadError) {
        if (isAbortedReplayRequest(loadError)) {
          recordReplayPerformanceEvent('CONTEXT_REQUEST_ABORTED', {
            durationMs: replayPerformanceNow() - requestStartedAt,
          });
          return;
        }
        if (requestId !== latestReplayRequestRef.current) return;
        recordReplayPerformanceEvent(
          loadError instanceof ApiClientError && loadError.code === 'TIMEOUT'
            ? 'CONTEXT_REQUEST_TIMEOUT'
            : 'CONTEXT_REQUEST_FAILED',
          { durationMs: replayPerformanceNow() - requestStartedAt }
        );
        detailErrorActionRef.current = 'context';
        setContextError(loadError instanceof Error ? loadError.message : '读取历史对局上下文失败');
      } finally {
        if (replayContextAbortRef.current === controller) {
          replayContextAbortRef.current = null;
        }
        if (requestId === latestReplayRequestRef.current) {
          setIsLoadingContext(false);
        }
      }
    },
    [replayNodeCache]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRecords(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRecords]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selectedMatchId) {
        latestReplayRequestRef.current += 1;
        replayContextAbortRef.current?.abort();
        replayContextAbortRef.current = null;
        replayAuditAbortRef.current?.abort();
        replayAuditAbortRef.current = null;
        recordUnusedReplayPrefetches(
          prefetchedNodeKeysRef.current,
          prefetchInFlightNodeKeysRef.current,
          consumedPrefetchNodeKeysRef.current
        );
        replayNodeCache.clear();
        currentViewerSeatRef.current = null;
        replayBoardOpenRef.current = false;
        lastViewerSeatReloadKeyRef.current = null;
        setReplayBoardOpen(false);
        setDetail(null);
        setTimeline([]);
        setReplay(null);
        setFailedReplayNode(null);
        leaveReadonlyReplay();
        return;
      }

      const authIdentity = profile?.id ?? 'anonymous';
      const contextPrefix = `${authIdentity}:${selectedMatchId}:`;
      const reloadKey = `${contextPrefix}${hasManagementHistoryAccess ? adminViewerSeat : 'participant'}`;
      if (lastViewerSeatReloadKeyRef.current === reloadKey) {
        return;
      }
      const isViewerSeatChange =
        lastViewerSeatReloadKeyRef.current?.startsWith(contextPrefix) === true;
      const checkpoint = isViewerSeatChange ? replay?.replayPosition.checkpointSeq : undefined;
      replayBoardOpenRef.current = false;
      lastViewerSeatReloadKeyRef.current = reloadKey;
      setReplayBoardOpen(false);
      leaveReadonlyReplay();
      void loadMatchContext(selectedMatchId, checkpoint);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    adminViewerSeat,
    hasManagementHistoryAccess,
    leaveReadonlyReplay,
    loadMatchContext,
    profile?.id,
    replayNodeCache,
    replay?.replayPosition.checkpointSeq,
    selectedMatchId,
  ]);

  useEffect(() => {
    const prefetchedNodeKeys = prefetchedNodeKeysRef.current;
    const prefetchInFlightNodeKeys = prefetchInFlightNodeKeysRef.current;
    const consumedPrefetchNodeKeys = consumedPrefetchNodeKeysRef.current;
    return () => {
      latestReplayRequestRef.current += 1;
      latestAuditRequestRef.current += 1;
      replayContextAbortRef.current?.abort();
      replayAuditAbortRef.current?.abort();
      recordUnusedReplayPrefetches(
        prefetchedNodeKeys,
        prefetchInFlightNodeKeys,
        consumedPrefetchNodeKeys
      );
      replayNodeCache.clear();
      currentViewerSeatRef.current = null;
      replayBoardOpenRef.current = false;
      leaveReadonlyReplay();
    };
  }, [leaveReadonlyReplay, replayNodeCache]);

  useEffect(() => {
    if (!debugDetailsOpen || !selectedMatchId || !replay) {
      latestAuditRequestRef.current += 1;
      replayAuditAbortRef.current?.abort();
      replayAuditAbortRef.current = null;
      return;
    }

    const requestId = ++latestAuditRequestRef.current;
    replayAuditAbortRef.current?.abort();
    const controller = new AbortController();
    replayAuditAbortRef.current = controller;
    const timelineSeq = replay.replayPosition.timelineSeq;
    const viewerSeat = replay.viewerSeat;
    queueMicrotask(() => {
      if (requestId !== latestAuditRequestRef.current) return;
      setIsLoadingAudit(true);
      setAuditPages({});
      setAuditError(null);
    });
    const loadPage = hasManagementHistoryAccess
      ? (kind: 'PUBLIC_EVENTS' | 'PRIVATE_EVENTS' | 'DECISIONS') =>
          fetchAdminMatchRecordAuditPage(selectedMatchId, viewerSeat, {
            kind,
            timelineSeq,
            signal: controller.signal,
          })
      : (kind: 'PUBLIC_EVENTS' | 'PRIVATE_EVENTS' | 'DECISIONS') =>
          fetchMatchRecordAuditPage(selectedMatchId, {
            kind,
            timelineSeq,
            signal: controller.signal,
          });

    void Promise.all([loadPage('PUBLIC_EVENTS'), loadPage('PRIVATE_EVENTS'), loadPage('DECISIONS')])
      .then((pages) => {
        if (requestId !== latestAuditRequestRef.current) return;
        setAuditPages(Object.fromEntries(pages.map((page) => [page.kind, page])));
      })
      .catch((loadError) => {
        if (requestId !== latestAuditRequestRef.current) return;
        if (isAbortedReplayRequest(loadError)) return;
        setAuditError(loadError instanceof Error ? loadError.message : '读取历史对局审计详情失败');
      })
      .finally(() => {
        if (replayAuditAbortRef.current === controller) {
          replayAuditAbortRef.current = null;
        }
        if (requestId === latestAuditRequestRef.current) setIsLoadingAudit(false);
      });
  }, [debugDetailsOpen, hasManagementHistoryAccess, replay, selectedMatchId]);

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
  const auditPublicEvents =
    auditPages.PUBLIC_EVENTS?.kind === 'PUBLIC_EVENTS'
      ? [...auditPages.PUBLIC_EVENTS.items].reverse()
      : [];
  const auditPrivateEvents =
    auditPages.PRIVATE_EVENTS?.kind === 'PRIVATE_EVENTS'
      ? [...auditPages.PRIVATE_EVENTS.items].reverse()
      : [];
  const auditDecisions =
    auditPages.DECISIONS?.kind === 'DECISIONS' ? [...auditPages.DECISIONS.items].reverse() : [];

  useEffect(() => {
    if (
      !isReplayAdjacentPrefetchEnabled() ||
      !selectedMatchId ||
      !replay ||
      replay.recordStatus === 'IN_PROGRESS' ||
      isLoadingContext ||
      isLoadingNode ||
      currentCheckpointIndex < 0 ||
      !canPrefetchReplayOnCurrentNetwork()
    ) {
      return;
    }

    return scheduleReplayPrefetch(() => {
      const viewerSeat = replay.viewerSeat;
      const nodeCache = replayNodeCache;
      if (currentViewerSeatRef.current !== viewerSeat) {
        return;
      }
      const candidates = [
        checkpointEntries[currentCheckpointIndex - 1],
        checkpointEntries[currentCheckpointIndex + 1],
      ];
      for (const entry of candidates) {
        const targetCheckpointSeq = entry?.relatedCheckpointSeq;
        if (!targetCheckpointSeq) {
          continue;
        }
        const nodeKey = createReplayNodeKey(selectedMatchId, viewerSeat, targetCheckpointSeq);
        const prefetchStartedAt = replayPerformanceNow();
        const load = nodeCache.getOrLoad(nodeKey, async (signal) => {
          recordReplayPerformanceEvent('PREFETCH_STARTED', {
            checkpointSeq: targetCheckpointSeq,
          });
          const prefetchedReplay = hasManagementHistoryAccessRef.current
            ? await fetchAdminMatchRecordReplay(selectedMatchId, {
                checkpointSeq: targetCheckpointSeq,
                viewerSeat,
                signal,
              })
            : await fetchMatchRecordReplay(selectedMatchId, {
                checkpointSeq: targetCheckpointSeq,
                signal,
              });
          recordReplayPerformanceEvent('PREFETCH_COMPLETED', () => ({
            checkpointSeq: targetCheckpointSeq,
            durationMs: replayPerformanceNow() - prefetchStartedAt,
            responseBytes: estimateUtf8Bytes(prefetchedReplay),
          }));
          return prefetchedReplay;
        });
        if (load.source !== 'NETWORK') {
          continue;
        }
        prefetchInFlightNodeKeysRef.current.add(nodeKey);
        void load.promise.then(
          () => {
            prefetchInFlightNodeKeysRef.current.delete(nodeKey);
            if (consumedPrefetchNodeKeysRef.current.delete(nodeKey)) {
              return;
            }
            if (nodeCache.has(nodeKey)) {
              prefetchedNodeKeysRef.current.add(nodeKey);
            }
          },
          (prefetchError: unknown) => {
            prefetchInFlightNodeKeysRef.current.delete(nodeKey);
            consumedPrefetchNodeKeysRef.current.delete(nodeKey);
            recordReplayPerformanceEvent(
              isAbortedReplayRequest(prefetchError) ? 'PREFETCH_CANCELLED' : 'PREFETCH_FAILED',
              {
                checkpointSeq: targetCheckpointSeq,
                durationMs: replayPerformanceNow() - prefetchStartedAt,
              }
            );
          }
        );
      }
    });
  }, [
    checkpointEntries,
    currentCheckpointIndex,
    isLoadingContext,
    isLoadingNode,
    replay,
    replayNodeCache,
    selectedMatchId,
  ]);

  const handleSelectTimeline = (entry: MatchRecordTimelineEntryView) => {
    if (!selectedMatchId || entry.relatedCheckpointSeq === null) {
      return;
    }
    void loadReplayNode(selectedMatchId, entry.relatedCheckpointSeq);
  };

  const handleStepCheckpoint = (direction: -1 | 1) => {
    if (!selectedMatchId || currentCheckpointIndex < 0) {
      return;
    }
    const nextEntry = checkpointEntries[currentCheckpointIndex + direction];
    if (!nextEntry?.relatedCheckpointSeq) {
      return;
    }
    void loadReplayNode(selectedMatchId, nextEntry.relatedCheckpointSeq);
  };

  const handleOpenReplayBoard = useCallback(async () => {
    if (!replay) {
      return;
    }
    setContextError(null);
    setFailedReplayNode(null);
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
      detailErrorActionRef.current = 'open';
      setContextError(openError instanceof Error ? openError.message : '打开桌面回放失败');
    }
  }, [enterReadonlyReplay, leaveReadonlyReplay, replay]);

  const handleCloseReplayBoard = useCallback(() => {
    replayBoardOpenRef.current = false;
    setReplayBoardOpen(false);
    leaveReadonlyReplay();
  }, [leaveReadonlyReplay]);

  const handleRetryReplayNode = useCallback(() => {
    if (!selectedMatchId || !failedReplayNode) {
      return;
    }
    void loadReplayNode(selectedMatchId, failedReplayNode.checkpointSeq);
  }, [failedReplayNode, loadReplayNode, selectedMatchId]);

  const handleToggleDebugDetails = useCallback(() => {
    if (debugDetailsOpen) {
      latestAuditRequestRef.current += 1;
      replayAuditAbortRef.current?.abort();
      replayAuditAbortRef.current = null;
      setIsLoadingAudit(false);
      setLoadingMoreAuditKind(null);
      setAuditPages({});
      setAuditError(null);
    }
    setDebugDetailsOpen((open) => !open);
  }, [debugDetailsOpen]);

  const handleLoadMoreAudit = useCallback(
    async (kind: 'PUBLIC_EVENTS' | 'PRIVATE_EVENTS' | 'DECISIONS') => {
      if (!selectedMatchId || !replay || loadingMoreAuditKind !== null) return;
      const currentPage = auditPages[kind];
      if (!currentPage?.nextCursor) return;
      const requestId = latestAuditRequestRef.current;
      replayAuditAbortRef.current?.abort();
      const controller = new AbortController();
      replayAuditAbortRef.current = controller;
      const cursor = currentPage.nextCursor;
      const request = {
        kind,
        timelineSeq: replay.replayPosition.timelineSeq,
        cursorTimelineSeq: cursor.timelineSeq,
        ...(kind === 'DECISIONS'
          ? { cursorDecisionId: 'decisionId' in cursor ? cursor.decisionId : undefined }
          : { cursorEventSeq: 'eventSeq' in cursor ? cursor.eventSeq : undefined }),
        signal: controller.signal,
      };
      setLoadingMoreAuditKind(kind);
      setAuditError(null);
      try {
        const nextPage = hasManagementHistoryAccess
          ? await fetchAdminMatchRecordAuditPage(selectedMatchId, replay.viewerSeat, request)
          : await fetchMatchRecordAuditPage(selectedMatchId, request);
        if (requestId !== latestAuditRequestRef.current) return;
        setAuditPages((current) => mergeAuditPages(current, nextPage));
      } catch (loadError) {
        if (requestId !== latestAuditRequestRef.current) return;
        if (isAbortedReplayRequest(loadError)) return;
        setAuditError(loadError instanceof Error ? loadError.message : '读取更早的审计详情失败');
      } finally {
        if (replayAuditAbortRef.current === controller) {
          replayAuditAbortRef.current = null;
        }
        if (requestId === latestAuditRequestRef.current) setLoadingMoreAuditKind(null);
      }
    },
    [auditPages, hasManagementHistoryAccess, loadingMoreAuditKind, replay, selectedMatchId]
  );

  const handleApplyAdminFilters = useCallback(() => {
    setAdminFilters(
      buildMatchRecordFilters({
        userQuery: adminUserQuery,
        playerAQuery: adminPlayerAQuery,
        playerBQuery: adminPlayerBQuery,
        dateFrom: adminDateFrom,
        dateTo: adminDateTo,
        activity: adminActivity,
      })
    );
  }, [
    adminActivity,
    adminDateFrom,
    adminDateTo,
    adminUserQuery,
    adminPlayerAQuery,
    adminPlayerBQuery,
  ]);

  const handleResetAdminFilters = useCallback(() => {
    setAdminUserQuery('');
    setAdminPlayerAQuery('');
    setAdminPlayerBQuery('');
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
    setContextError(null);
    try {
      const bundle = await exportAdminMatchRecordBundle(selectedRecord.matchId);
      downloadJson(
        `loveca-match-${selectedRecord.roomCode}-${selectedRecord.matchId}.replay.json`,
        bundle
      );
    } catch (exportError) {
      detailErrorActionRef.current = 'export';
      setContextError(exportError instanceof Error ? exportError.message : '导出历史对局失败');
    } finally {
      setIsExporting(false);
    }
  }, [canExport, selectedRecord]);

  const handleExportAiEvidence = useCallback(async () => {
    if (
      !selectedRecord ||
      selectedRecord.originKind !== 'AI_DEBUG' ||
      !profile ||
      !hasPermission(profile.role, 'rules.manage')
    )
      return;
    setIsExporting(true);
    setContextError(null);
    try {
      saveAs(
        await exportAiRecordedEvidence(selectedRecord.matchId),
        `loveca-ai-${selectedRecord.matchId}.jsonl`
      );
    } catch (exportError) {
      detailErrorActionRef.current = 'ai-export';
      setContextError(exportError instanceof Error ? exportError.message : '导出 AI 决定材料失败');
    } finally {
      setIsExporting(false);
    }
  }, [profile, selectedRecord]);

  if (replayBoardOpen && replay) {
    return (
      <ReplayBoardSurface
        replay={replay}
        currentCheckpointIndex={currentCheckpointIndex}
        checkpointCount={checkpointEntries.length}
        canGoPrevious={canGoPreviousCheckpoint}
        canGoNext={canGoNextCheckpoint}
        isLoadingNode={isLoadingNode}
        nodeLoadError={failedReplayNode?.message ?? null}
        onStep={handleStepCheckpoint}
        onRetryNode={handleRetryReplayNode}
        onClose={handleCloseReplayBoard}
      />
    );
  }

  return (
    <div ref={scrollRootRef} className="app-shell flex min-h-screen flex-col overflow-x-hidden">
      <PageHeader
        title="历史对局"
        icon={<History size={18} />}
        onBack={onBack}
        backLabel="返回大厅"
        right={
          <>
            <ActionButton
              variant="icon"
              onClick={() => void loadRecords()}
              disabled={isLoadingRecords || isLoadingMoreRecords}
              aria-label="刷新历史对局"
              title="刷新历史对局"
            >
              <RefreshCw size={16} className={isLoadingRecords ? 'animate-spin' : ''} />
            </ActionButton>
          </>
        }
      />

      <main className="relative z-10 flex-1 px-3 pb-24 pt-4 sm:px-4 sm:pb-24 lg:px-5 lg:pb-4 xl:px-6">
        <div
          className={`mx-auto grid w-full items-start gap-4 ${
            showRecordDetails
              ? 'max-w-[1480px] lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]'
              : 'max-w-3xl'
          }`}
        >
          <section
            aria-label="对局列表"
            className={`product-workbench min-w-0 flex-col overflow-hidden p-3 sm:p-4 lg:flex ${
              records.length > 0 ? 'lg:sticky lg:top-[5.75rem] lg:h-[calc(100dvh-6.5rem)]' : ''
            } ${mobileDetailOpen && showRecordDetails ? 'hidden' : 'flex'}`}
          >
            <PanelTitle
              icon={<History size={16} />}
              title="对局列表"
              detail={
                recordsError && records.length === 0
                  ? '读取失败'
                  : `${records.length} 条${hasMoreRecords ? ' · 可加载更多' : ''}`
              }
            />

            {!hasManagementHistoryAccess ? (
              <p className="mt-2 text-xs text-[var(--text-muted)]">最近 10 天的对局</p>
            ) : null}
            {recordsError ? (
              <ErrorNotice
                className="mt-3"
                message={recordsError}
                retryDisabled={isLoadingRecords || isLoadingMoreRecords}
                onRetry={() => void loadRecords(failedRecordsAppendRef.current)}
              />
            ) : null}
            {hasManagementHistoryAccess ? (
              <AdminMatchRecordFiltersPanel
                collapsible
                userQuery={adminUserQuery}
                playerAQuery={adminPlayerAQuery}
                playerBQuery={adminPlayerBQuery}
                onPlayerAQueryChange={setAdminPlayerAQuery}
                onPlayerBQueryChange={setAdminPlayerBQuery}
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

            {isLoadingRecords && records.length === 0 ? (
              <LoadingState variant="panel" className="mt-3" label="读取历史对局" />
            ) : records.length === 0 ? (
              recordsError ? null : (
                <EmptyState
                  variant="panel"
                  className="mt-3"
                  title="暂无历史对局"
                  description="完成正式联机或对墙打后会在这里显示。"
                />
              )
            ) : (
              <div
                className="mt-3 min-w-0 overflow-x-hidden border-y border-[var(--border-subtle)] lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                aria-busy={isLoadingRecords || isLoadingMoreRecords}
              >
                {records.map((record) => (
                  <MatchRecordButton
                    key={record.matchId}
                    record={record}
                    selected={record.matchId === selectedRecord?.matchId}
                    personal={!hasManagementHistoryAccess}
                    buttonRef={
                      record.matchId === selectedRecord?.matchId ? selectedButtonRef : undefined
                    }
                    onClick={() => handleSelectRecord(record.matchId)}
                  />
                ))}
                {hasMoreRecords ? (
                  <ActionButton
                    variant="ghost"
                    onClick={() => void loadRecords(true)}
                    disabled={isLoadingMoreRecords || isLoadingRecords}
                    className="w-full"
                  >
                    {isLoadingMoreRecords ? '读取中…' : '加载更多对局'}
                  </ActionButton>
                ) : null}
              </div>
            )}
          </section>

          {showRecordDetails && (
            <section
              aria-label="对局详情"
              className={`min-w-0 gap-4 lg:grid ${mobileDetailOpen ? 'grid' : 'hidden'}`}
            >
              <div
                ref={detailHeadingRef}
                tabIndex={-1}
                className="min-w-0 focus:outline-none lg:hidden"
              >
                <ActionButton variant="ghost" onClick={() => setMobileDetailOpen(false)}>
                  <ArrowLeft size={16} /> 返回对局列表
                </ActionButton>
              </div>
              {contextError ? (
                <ErrorNotice
                  className="mt-3"
                  message={contextError}
                  retryDisabled={isLoadingContext || isLoadingNode || isExporting}
                  onRetry={() => {
                    if (failedReplayNode) handleRetryReplayNode();
                    else if (detailErrorActionRef.current === 'open') void handleOpenReplayBoard();
                    else if (detailErrorActionRef.current === 'export')
                      void handleExportSelectedRecord();
                    else if (detailErrorActionRef.current === 'ai-export')
                      void handleExportAiEvidence();
                    else if (selectedMatchId) void loadMatchContext(selectedMatchId);
                  }}
                />
              ) : null}

              <Panel as="section" padding="compact" className="min-w-0">
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
                      {selectedRecord.originKind === 'AI_DEBUG' &&
                      profile &&
                      hasPermission(profile.role, 'rules.manage') ? (
                        <button
                          type="button"
                          onClick={() => void handleExportAiEvidence()}
                          disabled={isExporting}
                          className="button-ghost inline-flex h-9 items-center justify-center gap-1.5 border border-[var(--border-default)] px-3 text-xs font-semibold disabled:opacity-50"
                        >
                          <Download size={14} />
                          导出 AI 决定材料
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {selectedRecord?.partialReasonSummary ? (
                  <PartialRecordNotice detail={selectedRecord.partialReasonSummary} />
                ) : null}
                {selectedRecord?.originKind === 'AI_DEBUG' &&
                  profile &&
                  hasPermission(profile.role, 'rules.manage') &&
                  detail?.matchId === selectedRecord.matchId && (
                    <AiRecordedBilling
                      key={selectedRecord.matchId}
                      matchId={selectedRecord.matchId}
                    />
                  )}
                {selectedRecord ? (
                  <MatchRecordSummary
                    detail={detail?.matchId === selectedRecord.matchId ? detail : null}
                    record={selectedRecord}
                    viewerSeat={
                      hasManagementHistoryAccess ? adminViewerSeat : selectedRecord.viewerSeat
                    }
                    loading={isLoadingContext}
                  />
                ) : (
                  <EmptyState
                    variant="panel"
                    className="mt-3"
                    title="未选择对局"
                    description="从左侧选择一条历史记录。"
                  />
                )}
              </Panel>

              {selectedMatchId ? (
                <Panel as="section" padding="compact" className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <PanelTitle
                      icon={<Eye size={16} />}
                      title="对局回放"
                      detail={replay ? formatSeatPerspective(replay.viewerSeat) : ''}
                    />
                    {replay ? (
                      <ActionButton
                        onClick={() => void handleOpenReplayBoard()}
                        disabled={isLoadingNode}
                      >
                        <Eye size={15} /> 打开桌面回放
                      </ActionButton>
                    ) : null}
                  </div>
                  {isLoadingContext && !replay ? (
                    <LoadingState variant="panel" className="mt-3" label="读取回放" />
                  ) : replay ? (
                    <>
                      <div className="mt-4 max-w-sm">
                        <CheckpointNavigator
                          currentIndex={currentCheckpointIndex}
                          total={checkpointEntries.length}
                          canPrevious={canGoPreviousCheckpoint && !isLoadingNode}
                          canNext={canGoNextCheckpoint && !isLoadingNode}
                          onPrevious={() => handleStepCheckpoint(-1)}
                          onNext={() => handleStepCheckpoint(1)}
                        />
                      </div>
                      {replay.partialReasonSummary ? (
                        <PartialRecordNotice detail={replay.partialReasonSummary} compact />
                      ) : null}
                      {timeline.length > 0 ? (
                        <VirtualizedTimeline
                          key={selectedMatchId}
                          timeline={timeline}
                          checkpointSeq={checkpointSeq}
                          onSelect={handleSelectTimeline}
                        />
                      ) : (
                        <p className="mt-4 text-sm text-[var(--text-muted)]">
                          这场对局暂无可读进程。
                        </p>
                      )}
                    </>
                  ) : !contextError ? (
                    <EmptyState
                      variant="panel"
                      className="mt-3"
                      title={
                        selectedRecord?.completeness === 'METADATA_ONLY'
                          ? '回放数据已清理'
                          : '暂无可用回放'
                      }
                      description={
                        selectedRecord?.completeness === 'METADATA_ONLY'
                          ? '完整回放保留最近 10 天，该对局仅保留结果和卡组来源等信息。'
                          : '这场对局尚无可读取的回放。'
                      }
                    />
                  ) : null}
                </Panel>
              ) : null}

              {replay ? (
                <Panel as="section" padding="compact" className="min-w-0">
                  <button
                    type="button"
                    onClick={handleToggleDebugDetails}
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
                  {debugDetailsOpen && isLoadingAudit ? (
                    <LoadingState variant="panel" className="mt-3" label="读取审计详情" />
                  ) : debugDetailsOpen && auditError ? (
                    <div className="mt-3 rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:var(--semantic-error)]/10 px-3 py-2 text-xs text-[var(--semantic-error)]">
                      {auditError}
                    </div>
                  ) : debugDetailsOpen ? (
                    <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <ReplayStagePanel replay={replay} />
                      <ReplayMetricGrid replay={replay} />
                      <VisibleEventList
                        events={auditPublicEvents}
                        hasMore={Boolean(auditPages.PUBLIC_EVENTS?.nextCursor)}
                        loadingMore={loadingMoreAuditKind === 'PUBLIC_EVENTS'}
                        onLoadMore={() => void handleLoadMoreAudit('PUBLIC_EVENTS')}
                      />
                      <PrivateEventList
                        events={auditPrivateEvents}
                        hasMore={Boolean(auditPages.PRIVATE_EVENTS?.nextCursor)}
                        loadingMore={loadingMoreAuditKind === 'PRIVATE_EVENTS'}
                        onLoadMore={() => void handleLoadMoreAudit('PRIVATE_EVENTS')}
                      />
                      <DecisionRecordList
                        decisions={auditDecisions}
                        hasMore={Boolean(auditPages.DECISIONS?.nextCursor)}
                        loadingMore={loadingMoreAuditKind === 'DECISIONS'}
                        onLoadMore={() => void handleLoadMoreAudit('DECISIONS')}
                      />
                      <ZoneList zones={visibleZones} />
                      <FrontCardList cards={visibleFrontCards} />
                    </div>
                  ) : (
                    <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
                      按需查看阶段、事件、决策与卡牌投影等审计信息。
                    </p>
                  )}
                </Panel>
              ) : null}
            </section>
          )}
        </div>
      </main>
      {replay && mobileDetailOpen ? (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-[220] lg:hidden">
          <div className="flex items-center gap-3 rounded-[var(--radius-panel)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2.5 shadow-[var(--shadow-md)]">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[var(--text-secondary)]">当前回放节点</div>
              <div className="truncate text-xs text-[var(--text-muted)]">
                Checkpoint {replay.replayPosition.checkpointSeq} ·{' '}
                {selectedRecord ? formatRecordTitle(selectedRecord) : '历史对局'}
              </div>
            </div>
            <ActionButton
              onClick={() => void handleOpenReplayBoard()}
              disabled={isLoadingNode}
              className="shrink-0"
            >
              <Eye size={14} />
              打开回放
            </ActionButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ReplayBoardSurface({
  replay,
  currentCheckpointIndex,
  checkpointCount,
  canGoPrevious,
  canGoNext,
  isLoadingNode,
  nodeLoadError,
  onStep,
  onRetryNode,
  onClose,
}: {
  replay: MatchRecordReplayView;
  currentCheckpointIndex: number;
  checkpointCount: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  isLoadingNode: boolean;
  nodeLoadError: string | null;
  onStep: (direction: -1 | 1) => void;
  onRetryNode: () => void;
  onClose: () => void;
}) {
  const isMobileBattlefield = useMediaQuery('(max-width: 767px)');
  const replayToolbar = (
    <div className="battle-toolbar-control-group inline-flex h-11 max-w-full items-center overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-frosted)] text-[var(--text-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-2 px-3 text-sm font-semibold">
        <History size={15} aria-hidden="true" className="shrink-0 text-[var(--accent-primary)]" />
        <span className="hidden sm:inline">历史回放</span>
        <span className="whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
          {currentCheckpointIndex >= 0 ? currentCheckpointIndex + 1 : 0}/{checkpointCount}
        </span>
      </div>
      <span className="h-5 w-px shrink-0 bg-[var(--border-default)]" />
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={!canGoPrevious || isLoadingNode}
        className="button-ghost grid h-10 w-10 shrink-0 place-items-center rounded-none p-0 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="上一个回放节点"
        title="上一个回放节点"
      >
        <ChevronLeft size={16} />
      </button>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={!canGoNext || isLoadingNode}
        className="button-ghost grid h-10 w-10 shrink-0 place-items-center rounded-none p-0 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="下一个回放节点"
        title="下一个回放节点"
      >
        <ChevronRight size={16} />
      </button>
      <span className="h-5 w-px shrink-0 bg-[var(--border-default)]" />
      <button
        type="button"
        onClick={onClose}
        className="button-ghost grid h-10 w-10 shrink-0 place-items-center rounded-none p-0"
        aria-label="关闭桌面回放"
        title="关闭桌面回放"
      >
        <X size={16} />
      </button>
    </div>
  );
  return (
    <div className="app-shell min-h-screen overflow-hidden bg-[var(--bg-surface)]">
      <div className="fixed inset-0 z-[var(--z-battle-replay-surface)] overflow-hidden bg-[var(--bg-surface)]">
        <div className="h-full w-full">
          <GameBoard desktopHeaderActions={replayToolbar} />
        </div>
        {isMobileBattlefield && (
          <div className="pointer-events-auto fixed left-2 top-[calc(env(safe-area-inset-top)+0.5rem)] z-[var(--z-battle-chrome)] max-w-[calc(100vw-1rem)]">
            {replayToolbar}
          </div>
        )}
        {nodeLoadError ? (
          <div
            role="alert"
            className="pointer-events-auto fixed left-2 top-[calc(env(safe-area-inset-top)+4rem)] z-[230] flex w-[min(420px,calc(100vw-1rem))] items-center gap-3 rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,var(--bg-frosted))] px-3 py-2.5 text-[var(--semantic-error)] shadow-[var(--shadow-md)] backdrop-blur-xl md:left-4 md:top-[4.5rem]"
          >
            <AlertTriangle size={17} aria-hidden="true" className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold">回放节点加载失败</div>
              <div className="mt-0.5 break-words text-xs text-[var(--text-secondary)]">
                {nodeLoadError}
              </div>
            </div>
            <button
              type="button"
              onClick={onRetryNode}
              disabled={isLoadingNode}
              className="button-ghost inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[color:var(--semantic-error)]/30 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={14} aria-hidden="true" />
              重试
            </button>
          </div>
        ) : null}
        {replay.partialReasonSummary ? (
          <div className="pointer-events-none fixed bottom-4 left-4 right-4 z-[230] rounded-lg border border-[var(--semantic-warning)]/40 bg-[color:color-mix(in_srgb,var(--semantic-warning)_14%,var(--bg-frosted))] px-3 py-2 text-xs font-medium text-[var(--semantic-warning)] shadow-[var(--shadow-md)] backdrop-blur-xl md:left-auto md:w-[min(420px,calc(100vw-2rem))]">
            {replay.partialReasonSummary}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function MatchRecordButton({
  record,
  selected,
  personal,
  buttonRef,
  onClick,
}: {
  record: MatchRecordSummaryView;
  selected: boolean;
  personal: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
  onClick: () => void;
}) {
  const title = personal
    ? record.matchMode === 'SOLITAIRE'
      ? '对墙打'
      : `对战 ${record.opponentDisplayName ?? '未知对手'}`
    : formatRecordTitle(record);
  const result = personal ? formatPersonalResult(record) : null;
  return (
    <button
      type="button"
      ref={buttonRef}
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      className={`block w-full min-w-0 border-b border-[var(--border-subtle)] px-3 py-3 text-left transition last:border-b-0 ${selected ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_8%,var(--bg-surface))]' : 'bg-transparent hover:bg-[var(--bg-elevated)]'}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        {result ? (
          <span
            className={`shrink-0 text-sm font-semibold ${result === '胜利' ? 'text-[var(--semantic-success)]' : result === '失败' ? 'text-[var(--semantic-error)]' : 'text-[var(--text-secondary)]'}`}
          >
            {result}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 break-words text-sm font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere] line-clamp-2">
          {title}
        </span>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
        <span>{formatDateTime(record.startedAt)}</span>
        <span>{record.turnCount} 回合</span>
        {!personal ? <span className="font-mono">{shortId(record.matchId)}</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <MatchModeLabel record={record} />
        {!personal ||
        record.completeness !== 'FULL' ||
        record.status === 'INTERRUPTED' ||
        record.status === 'CORRUPTED' ? (
          <StatusPill status={record.status} completeness={record.completeness} />
        ) : null}
      </div>
      {record.partialReasonSummary ? (
        <div className="mt-2 flex min-w-0 items-start gap-1.5 text-xs text-[var(--semantic-warning)]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {record.partialReasonSummary}
          </span>
        </div>
      ) : null}
    </button>
  );
}

export function formatPersonalResult(
  record: Pick<
    MatchRecordSummaryView,
    'matchMode' | 'status' | 'winnerSeat' | 'viewerSeat' | 'endReason'
  >
): string {
  if (record.status === 'IN_PROGRESS') return '进行中';
  if (record.status === 'INTERRUPTED') return '中断';
  if (record.status === 'CORRUPTED') return '异常';
  if (record.endReason === 'DRAW') return '平局';
  if (record.winnerSeat) return record.winnerSeat === record.viewerSeat ? '胜利' : '失败';
  return record.status === 'SURRENDERED' ? '认输结束' : '已结束';
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
    <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <MatchModeLabel record={record} />
        <span className="min-w-0 break-words text-sm font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">
          {resultSummary}
        </span>
      </div>
      {deckSummary ? (
        <div className="mt-2 break-words text-xs text-[var(--text-secondary)] [overflow-wrap:anywhere]">
          {formatSeatPerspective(viewerSeat)}卡组：
          <span className="font-medium text-[var(--text-secondary)]">{deckSummary}</span>
        </div>
      ) : null}
    </div>
  );
}

export function TimelineRow({
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
      className={`grid h-[76px] w-full grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2 text-left transition last:border-b-0 ${
        selected
          ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_8%,var(--bg-surface))]'
          : 'bg-transparent hover:bg-[var(--bg-overlay)]'
      } disabled:cursor-default disabled:opacity-70`}
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-overlay)] font-mono text-[10px] font-semibold text-[var(--accent-primary)]">
        {entry.timelineSeq}
      </div>
      <div className="min-w-0">
        <div className="line-clamp-2 break-words text-sm font-medium leading-5 text-[var(--text-primary)] [overflow-wrap:anywhere]">
          {entry.summary || formatFrameTypeLabel(entry.frameType)}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-[var(--text-muted)]">
          <span>第 {entry.turnCount} 回合</span>
          <span>{getPhaseName(entry.phase as GamePhase)}</span>
          {hasCheckpoint ? (
            <span className="text-[var(--accent-primary)]">节点 {entry.relatedCheckpointSeq}</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

const TIMELINE_ROW_HEIGHT = 76;
const TIMELINE_VIEWPORT_HEIGHT = 560;
const TIMELINE_OVERSCAN_ROWS = 6;

function VirtualizedTimeline({
  timeline,
  checkpointSeq,
  onSelect,
}: {
  timeline: readonly MatchRecordTimelineEntryView[];
  checkpointSeq: number | null;
  onSelect: (entry: MatchRecordTimelineEntryView) => void;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const viewportHeight = Math.min(
    TIMELINE_VIEWPORT_HEIGHT,
    Math.max(TIMELINE_ROW_HEIGHT, timeline.length * TIMELINE_ROW_HEIGHT)
  );
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / TIMELINE_ROW_HEIGHT) - TIMELINE_OVERSCAN_ROWS
  );
  const endIndex = Math.min(
    timeline.length,
    Math.ceil((scrollTop + viewportHeight) / TIMELINE_ROW_HEIGHT) + TIMELINE_OVERSCAN_ROWS
  );

  useEffect(() => {
    if (checkpointSeq === null) return;
    const selectedIndex = timeline.findIndex(
      (entry) => entry.relatedCheckpointSeq === checkpointSeq
    );
    const viewport = viewportRef.current;
    if (selectedIndex < 0 || !viewport) return;
    const rowTop = selectedIndex * TIMELINE_ROW_HEIGHT;
    const rowBottom = rowTop + TIMELINE_ROW_HEIGHT;
    if (rowTop < viewport.scrollTop) {
      viewport.scrollTo({ top: rowTop });
    } else if (rowBottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTo({ top: rowBottom - viewport.clientHeight });
    }
  }, [checkpointSeq, timeline]);

  return (
    <div
      ref={viewportRef}
      className="mt-3 overflow-x-hidden overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
      style={{ height: viewportHeight }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      aria-label="对局进程时间线"
    >
      <div className="relative" style={{ height: timeline.length * TIMELINE_ROW_HEIGHT }}>
        {timeline.slice(startIndex, endIndex).map((entry, visibleIndex) => (
          <div
            key={entry.timelineSeq}
            className="absolute inset-x-0"
            style={{ top: (startIndex + visibleIndex) * TIMELINE_ROW_HEIGHT }}
          >
            <TimelineRow
              entry={entry}
              selected={
                entry.relatedCheckpointSeq !== null && entry.relatedCheckpointSeq === checkpointSeq
              }
              onClick={() => onSelect(entry)}
            />
          </div>
        ))}
      </div>
    </div>
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
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
      <ActionButton
        variant="icon"
        onClick={onPrevious}
        disabled={!canPrevious}
        aria-label="上一个回放节点"
        title="上一个回放节点"
      >
        <ChevronLeft size={16} />
      </ActionButton>
      <div className="min-w-0 text-center">
        <div className="text-xs text-[var(--text-muted)]">回放节点</div>
        <div className="mt-0.5 truncate font-mono text-sm font-bold text-[var(--text-primary)]">
          {label}
        </div>
      </div>
      <ActionButton
        variant="icon"
        onClick={onNext}
        disabled={!canNext}
        aria-label="下一个回放节点"
        title="下一个回放节点"
      >
        <ChevronRight size={16} />
      </ActionButton>
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
      <MiniMetric
        label="模式"
        value={formatMatchModeLabel({
          matchMode: replay.sourceMatchMode,
          originKind: replay.originKind,
          casualRuleMode: replay.casualRuleMode,
        })}
      />
      <MiniMetric label="视角" value={replay.viewerSeat} />
      <MiniMetric label="对象" value={objectCount} />
      <MiniMetric label="正面" value={frontCount} />
    </div>
  );
}

function mergeAuditPages(
  current: MatchRecordAuditPages,
  nextPage: MatchRecordAuditPageView
): MatchRecordAuditPages {
  const existing = current[nextPage.kind];
  if (!existing || existing.kind !== nextPage.kind) {
    return { ...current, [nextPage.kind]: nextPage };
  }
  if (nextPage.kind === 'PUBLIC_EVENTS' && existing.kind === 'PUBLIC_EVENTS') {
    return {
      ...current,
      PUBLIC_EVENTS: {
        ...nextPage,
        items: [...existing.items, ...nextPage.items],
      },
    };
  }
  if (nextPage.kind === 'PRIVATE_EVENTS' && existing.kind === 'PRIVATE_EVENTS') {
    return {
      ...current,
      PRIVATE_EVENTS: {
        ...nextPage,
        items: [...existing.items, ...nextPage.items],
      },
    };
  }
  if (nextPage.kind === 'DECISIONS' && existing.kind === 'DECISIONS') {
    return {
      ...current,
      DECISIONS: {
        ...nextPage,
        items: [...existing.items, ...nextPage.items],
      },
    };
  }
  return current;
}

function VisibleEventList({
  events,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  events: readonly MatchRecordVisibleEventView[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
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
          {events.map((event) => (
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
      <AuditLoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

function PrivateEventList({
  events,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  events: readonly MatchRecordVisiblePrivateEventView[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
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
        <div className="grid max-h-52 min-w-0 divide-y divide-[var(--border-subtle)] overflow-x-hidden overflow-y-auto">
          {events.map((event) => (
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
      <AuditLoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

function DecisionRecordList({
  decisions,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  decisions: readonly MatchRecordDecisionView[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
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
          {decisions.map((decision) => (
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
      <AuditLoadMoreButton hasMore={hasMore} loading={loadingMore} onClick={onLoadMore} />
    </div>
  );
}

function AuditLoadMoreButton({
  hasMore,
  loading,
  onClick,
}: {
  hasMore: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  if (!hasMore) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="button-ghost min-h-9 w-full rounded-none border-t border-[var(--border-subtle)] px-3 text-xs font-semibold disabled:opacity-50"
    >
      {loading ? '读取中…' : '加载更早记录'}
    </button>
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
    <SectionHeading
      size="compact"
      title={
        <span className="flex min-w-0 items-start gap-2">
          <span className="shrink-0 text-[var(--accent-primary)]">{icon}</span>
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{title}</span>
        </span>
      }
      action={
        detail ? (
          <span className="truncate text-right text-xs text-[var(--text-muted)]">{detail}</span>
        ) : undefined
      }
    />
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

function StatusPill({
  status,
  completeness,
}: {
  status: MatchRecordSummaryView['status'];
  completeness: MatchRecordSummaryView['completeness'];
}) {
  const tone = completeness !== 'FULL' ? 'warning' : status === 'COMPLETED' ? 'success' : 'neutral';
  return (
    <StatusBadge tone={tone} className="shrink-0">
      {formatRecordStatus({ status, completeness })}
    </StatusBadge>
  );
}

function MatchModeLabel({ record }: { record: MatchRecordSummaryView }) {
  return (
    <span className="shrink-0 text-xs text-[var(--text-secondary)]">
      {formatMatchModeLabel(record)}
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

function formatMatchModeLabel(
  record: Pick<MatchRecordSummaryView, 'matchMode' | 'originKind' | 'casualRuleMode'>
): string {
  if (record.originKind === 'AI_DEBUG') return 'AI 调试';
  if (record.casualRuleMode)
    return record.casualRuleMode === 'UNLIMITED' ? '娱乐对战 · PT 不限' : '标准对战';
  if (record.originKind === 'RANKED') return '赛季排位';
  return record.matchMode === 'SOLITAIRE' ? '对墙打' : '正式联机';
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
    ? `${formatMatchModeLabel(record)} · ${record.opponentDisplayName}`
    : `${formatMatchModeLabel(record)} · ${record.roomCode}`;
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

function createReplayNodeKey(matchId: string, viewerSeat: Seat, checkpointSeq: number): string {
  return `${matchId}:${viewerSeat}:${checkpointSeq}`;
}

function scheduleReplayPrefetch(run: () => void): () => void {
  const idleWindow = window as typeof window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const handle = idleWindow.requestIdleCallback(run, { timeout: 1_000 });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(run, 250);
  return () => window.clearTimeout(handle);
}

function canPrefetchReplayOnCurrentNetwork(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const connection = (
    navigator as Navigator & {
      readonly connection?: { readonly saveData?: boolean; readonly effectiveType?: string };
    }
  ).connection;
  if (!connection) {
    return true;
  }
  return (
    connection.saveData !== true &&
    connection.effectiveType !== 'slow-2g' &&
    connection.effectiveType !== '2g'
  );
}

function recordUnusedReplayPrefetches(
  prefetchedNodeKeys: Set<string>,
  prefetchInFlightNodeKeys: Set<string>,
  consumedPrefetchNodeKeys: Set<string>
): void {
  const unusedCount = prefetchedNodeKeys.size + prefetchInFlightNodeKeys.size;
  if (unusedCount > 0) {
    recordReplayPerformanceEvent('PREFETCH_UNUSED', { count: unusedCount });
  }
  prefetchedNodeKeys.clear();
  prefetchInFlightNodeKeys.clear();
  consumedPrefetchNodeKeys.clear();
}

function isAbortedReplayRequest(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'ABORTED';
}

function recordReplayRequestFailure(
  error: unknown,
  checkpointSeq: number,
  requestStartedAt: number
): void {
  const durationMs = replayPerformanceNow() - requestStartedAt;
  if (isAbortedReplayRequest(error)) {
    recordReplayPerformanceEvent('NODE_REQUEST_ABORTED', { checkpointSeq, durationMs });
    return;
  }
  if (error instanceof ApiClientError && error.code === 'TIMEOUT') {
    recordReplayPerformanceEvent('NODE_REQUEST_TIMEOUT', { checkpointSeq, durationMs });
    return;
  }
  recordReplayPerformanceEvent('NODE_REQUEST_FAILED', { checkpointSeq, durationMs });
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
