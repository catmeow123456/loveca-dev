import { SealedBuilder, SealedRematchControls } from '@/components/casual-table/SealedBuilder';
import type { CasualFormat } from '@game/online/casual-table-types';
import {
  CasualRuleBadge,
  CasualRuleMark,
  CasualRuleSelector,
} from '@/components/common/CasualRuleSelector';
import {
  useCasualRuleMode,
  writeCasualRuleMode,
  casualRuleName,
  casualRuleDescription,
  casualPointSummary,
  casualDeckPreferenceKey,
} from '@/lib/casualRules';
import type { CasualRuleMode } from '@game/online/casual-table-types';
import { PresentationImage } from '@/components/excel/PresentationRoot';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Hash,
  Plus,
  PackageOpen,
  Heart,
  Trophy,
  RefreshCw,
  Search,
  Swords,
  Target,
  UserRound,
  X,
} from 'lucide-react';
import { GameMode } from '@game/shared/types/enums';
import { ActionButton, DeckSelector, TextInput, type DeckDisplayItem } from '@/components/common';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';
import { useCasualTableStore } from '@/store/casualTableStore';
import { useGameStore } from '@/store/gameStore';
import { useDeckPointTableRules, useDeckPointTableDisplayReady } from '@/hooks/useDeckPointTable';
import { buildDeckDisplayItems } from '@/lib/deckDisplay';
import {
  createDeckRecordCardTypeResolver,
  isDeckRecordValidForCurrentCardPool,
} from '@/lib/deckRecordUtils';
import { useDeckStore } from '@/store/deckStore';
import { getCasualLobby, previewCasualRoom, spectateCasualRoom } from '@/lib/casualTableClient';
import { ApiClientError } from '@/lib/apiClient';
import {
  fetchOnlineRoomSpectatorEntry,
  createOnlineRoomSpectatorEntryLink,
} from '@/lib/onlineClient';
import type { OnlineRoomSpectatorEntryView } from '@game/online/release-types';
import { openCasualDestination } from '@/lib/casualNavigation';
import { getCasualClosureMessage } from '@/lib/roomLifecycleCopy';
import { readLastUsedDeckId, writeLastUsedDeckId } from '@/lib/deckSelectionPreferences';
import type {
  CasualLobbyQuery,
  CasualLobbyView,
  CasualRoomSummary,
  CasualTableCommandTarget,
} from '@game/online/casual-table-types';
import './casual-lobby.css';

type FlowKind =
  | 'FIND'
  | 'CREATE'
  | 'JOIN'
  | 'DECK'
  | 'REMATCH'
  | 'ACCEPT'
  | 'CONTINUE'
  | 'CODE'
  | 'SPECTATE'
  | 'NOTE'
  | 'CANCEL'
  | 'LEAVE';
interface Flow {
  kind: FlowKind;
  requestId: string;
  target?: CasualTableCommandTarget;
  row?: CasualRoomSummary;
  source?: CasualTableCommandTarget;
  rematchId?: string;
  nextRuleMode?: CasualRuleMode;
}
const names = {
  WAITING: '等待加入',
  RESERVED: '双方准备',
  BUILDING: '开盒组牌',
  OPENING: '开局中',
  PLAYING: '对战中',
  ENDED: '已结束',
};
const duration = (since: number, now: number) => {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

async function lookupLobbyCode(code: string) {
  try {
    return { casual: await previewCasualRoom(code), activity: null };
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== 'CASUAL_ROOM_NOT_FOUND') throw error;
    return { casual: null, activity: await fetchOnlineRoomSpectatorEntry(code, true) };
  }
}

export function CasualLobbyPage({
  userId,
  onBack,
  onManageDecks,
  onLocalSetup,
}: {
  userId: string;
  onBack: () => void;
  onManageDecks: () => void;
  onLocalSetup: (mode: GameMode.SOLITAIRE | GameMode.DEBUG) => void;
}) {
  const status = useCasualTableStore((state) => state.status);
  const hydrated = useCasualTableStore((state) => state.hydrated);
  const busy = useCasualTableStore((state) => state.busy);
  const storeError = useCasualTableStore((state) => state.error);
  const clearStoreError = useCasualTableStore((state) => state.clearError);
  const mutate = useCasualTableStore((state) => state.mutate);
  const table = status?.table;
  const cloudDecks = useDeckStore((state) => state.cloudDecks);
  const deckLoadState = useDeckStore((state) => state.cloudDeckLoadState);
  const cloudError = useDeckStore((state) => state.cloudError);
  const ensureDecks = useDeckStore((state) => state.ensureCloudDecks);
  const refreshDecks = useDeckStore((state) => state.refreshCloudDecks);
  const [selected, setSelected] = useState<DeckDisplayItem | null>(null);
  const registry = useGameStore((state) => state.cardDataRegistry);
  const getCardImagePath = useGameStore((state) => state.getCardImagePath);
  const preferredMode = useCasualRuleMode(userId);
  const ruleMode = table?.ruleMode ?? preferredMode;
  const [preferredFormat, setPreferredFormat] = useState<CasualFormat>('CONSTRUCTED');
  const format: CasualFormat =
    table?.format ?? (ruleMode === 'UNLIMITED' ? preferredFormat : 'CONSTRUCTED');
  const [flow, setFlow] = useState<Flow | null>(null);
  const selectionMode = flow?.kind === 'JOIN' ? flow.row!.ruleMode : ruleMode;
  const selectionFormat = flow?.kind === 'JOIN' ? flow.row!.format : format;
  const sealedSelection = selectionFormat === 'SEALED_BP7';
  const lastDeck = readLastUsedDeckId(casualDeckPreferenceKey(userId, selectionMode));
  const pointTable = useDeckPointTableRules();
  const pointTableDisplayReady = useDeckPointTableDisplayReady();
  const validCloudDecks = useMemo(
    () =>
      cloudDecks.filter((deck) =>
        isDeckRecordValidForCurrentCardPool(deck, registry, pointTable, selectionMode)
      ),
    [cloudDecks, registry, pointTable, selectionMode]
  );
  const choices = useMemo(
    () =>
      buildDeckDisplayItems({
        cloudDecks: validCloudDecks,
        pointTable,
        ruleMode: selectionMode,
        resolveDeckRecordCardType: createDeckRecordCardTypeResolver(registry),
      }).filter((deck) => deck.isValid),
    [validCloudDecks, pointTable, registry, selectionMode]
  );
  const chosen =
    choices.find((deck) => deck.id === selected?.id) ??
    choices.find((deck) => deck.cloudDeck?.id === lastDeck) ??
    choices[0] ??
    null;
  const switchRule = (next: CasualRuleMode) => {
    const valid = cloudDecks.filter((deck) =>
      isDeckRecordValidForCurrentCardPool(deck, registry, pointTable, next)
    );
    const targetLast = readLastUsedDeckId(casualDeckPreferenceKey(userId, next));
    const nextChoices = buildDeckDisplayItems({
      cloudDecks: valid,
      pointTable,
      ruleMode: next,
      resolveDeckRecordCardType: createDeckRecordCardTypeResolver(registry),
    });
    setSelected(
      nextChoices.find((deck) => deck.id === targetLast) ??
        nextChoices.find((deck) => deck.id === chosen?.id) ??
        null
    );
    writeCasualRuleMode(userId, next);
  };
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const selectedDeckButtonRef = useRef<HTMLButtonElement>(null);
  const pickerWasOpen = useRef(false);
  useLayoutEffect(() => {
    if (pickerWasOpen.current && !deckPickerOpen && flow) {
      selectedDeckButtonRef.current?.focus({ preventScroll: true });
    }
    pickerWasOpen.current = deckPickerOpen;
  }, [deckPickerOpen, flow]);
  const flowRef = useRef(flow);
  useLayoutEffect(() => {
    flowRef.current = flow;
  }, [flow]);
  const listFailed = useRef(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [recoveringJoin, setRecoveringJoin] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{ kind: 'code' | 'invite' } | null>(null);
  useEffect(() => {
    if (!copyFeedback) return;
    const timeout = window.setTimeout(() => setCopyFeedback(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [copyFeedback]);
  const [now, setNow] = useState(Date.now);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [snapshot, setSnapshot] = useState<CasualLobbyView | null>(null);
  const [rows, setRows] = useState<CasualRoomSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [loadedSearch, setLoadedSearch] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [preview, setPreview] = useState<CasualRoomSummary | null>(null);
  const [activityPreview, setActivityPreview] = useState<OnlineRoomSpectatorEntryView | null>(null);
  const [looking, setLooking] = useState(false);
  const lookupEpoch = useRef(0);
  const [spectatingTable, setSpectatingTable] = useState<string | null>(null);
  const spectatorPending = useRef(false);
  const latest = useRef<CasualRoomSummary[]>([]);
  const shown = useRef(rows);
  useLayoutEffect(() => {
    shown.current = rows;
  }, [rows]);
  const readEpoch = useRef(0);
  const readPromise = useRef<Promise<void> | null>(null);
  const readRef = useRef<(applyOrder?: boolean, more?: boolean) => Promise<void>>(() =>
    Promise.resolve()
  );
  const queryKey = `${ruleMode}:${format}:${debouncedSearch}`;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const read = useCallback(
    (applyOrder = false, more = false): Promise<void> => {
      if (readPromise.current) {
        // An explicit refresh needs a fresh response, even if a poll started before a mutation.
        return applyOrder || more
          ? readPromise.current.then(() => readRef.current(applyOrder, more))
          : readPromise.current;
      }
      const epoch = readEpoch.current;
      setReading(true);
      const promise = (async () => {
        try {
          const params: CasualLobbyQuery = { search: debouncedSearch, ruleMode, format };
          let next = await getCasualLobby(
            more && snapshot?.nextCursor ? { ...params, cursor: snapshot.nextCursor } : params
          );
          let incoming = more ? [...latest.current, ...next.rooms] : [...next.rooms];
          const desired = more ? incoming.length : Math.max(50, latest.current.length);
          while (!more && incoming.length < desired && next.nextCursor) {
            next = await getCasualLobby({ ...params, cursor: next.nextCursor });
            incoming.push(...next.rooms);
          }
          if (epoch !== readEpoch.current) return;
          incoming = incoming.filter((row) => row.ruleMode === ruleMode && row.format === format);
          incoming = [...new Map(incoming.map((row) => [row.tableId, row])).values()];
          latest.current = incoming;
          setSnapshot(next);
          setLoadedSearch(queryKey);
          listFailed.current = false;
          setListError(null);
          const previous = shown.current;
          if (applyOrder || more || !previous.length) {
            setRows(incoming);
            setPendingCount(0);
          } else {
            const byId = new Map(incoming.map((row) => [row.tableId, row]));
            setRows(
              previous.map(
                (row) =>
                  byId.get(row.tableId) ?? {
                    ...row,
                    status: 'ENDED',
                    isMine: false,
                    canJoin: false,
                    spectatorViews: [],
                    note: '房间已关闭或已离开当前列表',
                  }
              )
            );
            const existing = new Set(previous.map((row) => row.tableId));
            setPendingCount(incoming.filter((row) => !existing.has(row.tableId)).length);
          }
        } catch (error) {
          listFailed.current = true;
          if (epoch === readEpoch.current)
            setListError(error instanceof Error ? error.message : '房间列表加载失败');
        } finally {
          if (epoch === readEpoch.current) setReading(false);
        }
      })().finally(() => {
        if (readPromise.current === promise) readPromise.current = null;
      });
      readPromise.current = promise;
      return promise;
    },
    [queryKey, debouncedSearch, ruleMode, format, snapshot?.nextCursor]
  );
  useLayoutEffect(() => {
    readRef.current = read;
  }, [read]);
  useEffect(() => {
    readEpoch.current += 1;
    readPromise.current = null;
    latest.current = [];
    const resetTimer = window.setTimeout(() => {
      setPendingCount(0);
      setListError(null);
      setSnapshot(null);
      setRows([]);
      void poll(true);
    }, 0);
    let stopped = false;
    let timer: number;
    let failures = 0;
    const poll = async (applyOrder = false) => {
      if (document.visibilityState !== 'visible') return;
      await readRef.current(applyOrder);
      if (!stopped) {
        failures = listFailed.current ? Math.min(failures + 1, 3) : 0;
        timer = window.setTimeout(() => void poll(), Math.min(30_000, 5000 * 2 ** failures));
      }
    };
    const visibility = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(resetTimer);
      readEpoch.current += 1;
      readPromise.current = null;
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [queryKey, userId]);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase();
    if (!code) return;
    let active = true;
    const timer = window.setTimeout(() => {
      const epoch = ++lookupEpoch.current;
      setFlow({ kind: 'CODE', requestId: crypto.randomUUID() });
      setLooking(true);
      void lookupLobbyCode(code)
        .then(
          (room) => {
            if (active && epoch === lookupEpoch.current) {
              setPreview(room.casual);
              setActivityPreview(room.activity);
            }
          },
          (error: unknown) => {
            if (active && epoch === lookupEpoch.current)
              setLocalError(error instanceof Error ? error.message : '房间不存在');
          }
        )
        .finally(() => {
          if (active && epoch === lookupEpoch.current) setLooking(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [userId]);

  const action = async (path: string, body: unknown) => {
    setLocalError(null);
    try {
      await mutate(path, body);
      await read(true);
      return true;
    } catch (error) {
      if (
        ['join', 'switch'].includes(path) &&
        error instanceof ApiClientError &&
        ['CASUAL_STATE_CHANGED', 'CASUAL_ROOM_FULL', 'CASUAL_ROOM_NOT_FOUND'].includes(error.code)
      ) {
        setRecoveringJoin(true);
        setFlow(null);
        setLocalError('房间状态已变化，请从列表重新选择。');
        await read(true);
        setRecoveringJoin(false);
        return false;
      }
      setLocalError(error instanceof Error ? error.message : '操作没有完成');
      return false;
    }
  };
  const open = (kind: FlowKind, row?: CasualRoomSummary) => {
    clearStoreError();
    lookupEpoch.current += 1;
    setLooking(false);
    setLocalError(null);
    setPreview(null);
    setActivityPreview(null);
    setDeckPickerOpen(kind === 'DECK');
    if (kind === 'JOIN') setSelected(null);
    if (kind === 'JOIN' && (status?.otherParticipation || (table && table.state !== 'WAITING'))) {
      setLocalError('请先处理我的当前房间，再加入另一间房');
      return;
    }
    setFlow({
      kind,
      row,
      requestId: crypto.randomUUID(),
      target: kind === 'JOIN' ? row : (table ?? undefined),
      source: kind === 'JOIN' && table?.state === 'WAITING' ? table : undefined,
      rematchId: table?.runtime?.rematch?.requestId,
    });
    if (!['CODE', 'SPECTATE', 'NOTE', 'CANCEL', 'LEAVE'].includes(kind)) void ensureDecks();
  };
  const copy = async (value: string, kind: 'code' | 'invite') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback({ kind });
    } catch {
      setCopyFeedback(null);
      setLocalError('复制失败，请手动复制房间号');
    }
  };
  const enterSpectator = async (row: CasualRoomSummary, seat: 'FIRST' | 'SECOND') => {
    if (spectatorPending.current) return;
    spectatorPending.current = true;
    setSpectatingTable(row.tableId);
    setLooking(true);
    setLocalError(null);
    try {
      const link = await spectateCasualRoom(row, seat);
      window.location.assign(link.path);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '该视角未开放');
      void read();
    } finally {
      spectatorPending.current = false;
      setSpectatingTable(null);
      setLooking(false);
    }
  };
  const enterActivitySpectator = async (
    entry: OnlineRoomSpectatorEntryView,
    seat: 'FIRST' | 'SECOND'
  ) => {
    if (spectatorPending.current) return;
    spectatorPending.current = true;
    setSpectatingTable(entry.roomCode);
    setLooking(true);
    setLocalError(null);
    try {
      const link = await createOnlineRoomSpectatorEntryLink(
        entry.roomCode,
        seat,
        entry.roomGeneration
      );
      window.location.assign(link.path);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '该视角当前不可观战');
    } finally {
      spectatorPending.current = false;
      setSpectatingTable(null);
      setLooking(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!flow || (flow.kind === 'CREATE' && deckPickerOpen)) return;
    const data = new FormData(event.currentTarget);
    const customRoomCode = String(data.get('roomCode') ?? '')
      .trim()
      .toUpperCase();
    if (flow.kind === 'CREATE' && customRoomCode && !/^[A-Z0-9]{4,12}$/.test(customRoomCode)) {
      setLocalError('房间号需为 4–12 位字母或数字，或留空自动生成');
      return;
    }
    if (flow.kind === 'CODE') {
      const epoch = ++lookupEpoch.current;
      setLooking(true);
      setLocalError(null);
      try {
        const code = String(data.get('roomCode') ?? '')
          .trim()
          .toUpperCase();
        setActivityPreview(null);
        setPreview(null);
        const result = await lookupLobbyCode(code);
        if (epoch === lookupEpoch.current && flowRef.current?.requestId === flow.requestId) {
          setPreview(result.casual);
          setActivityPreview(result.activity);
        }
      } catch (error) {
        if (epoch !== lookupEpoch.current || flowRef.current?.requestId !== flow.requestId) return;
        setPreview(null);
        setLocalError(error instanceof Error ? error.message : '房间不存在');
      } finally {
        if (epoch === lookupEpoch.current) setLooking(false);
      }
      return;
    }
    const deckId = chosen?.cloudDeck?.id;
    if (!sealedSelection && !deckId) {
      setLocalError('请选择一副合法云端卡组');
      return;
    }
    const entry = {
      requestId: flow.requestId,
      ruleMode: selectionMode,
      format: selectionFormat,
      ...(sealedSelection ? {} : { deckId }),
      spectatorEnabled: data.has('spectatorEnabled'),
    };
    let path = '',
      body: unknown;
    switch (flow.kind) {
      case 'FIND':
        path = 'find';
        body = entry;
        break;
      case 'CREATE':
        path = 'create';
        body = {
          ...entry,
          discoverability: data.get('access'),
          note: String(data.get('note') ?? '').trim(),
          roomCode: customRoomCode,
        };
        break;
      case 'JOIN':
        path = flow.source ? 'switch' : 'join';
        body = flow.source
          ? { source: flow.source, destination: flow.row, entry }
          : { target: flow.row, entry };
        break;
      case 'DECK':
        path = 'deck';
        body = { target: flow.target, deckId };
        break;
      case 'REMATCH':
        path = 'rematch/request';
        body = { target: flow.target, deckId, spectatorEnabled: entry.spectatorEnabled };
        break;
      case 'ACCEPT':
        path = 'rematch/respond';
        body = {
          target: flow.target,
          requestId: flow.rematchId,
          deckId,
          spectatorEnabled: entry.spectatorEnabled,
        };
        break;
      case 'CONTINUE':
        path = 'continue-public';
        body = { target: flow.target, entry, publishNewRoom: data.has('publishNewRoom') };
        break;
      default:
        return;
    }
    if (await action(path, body)) {
      if (!sealedSelection && deckId)
        writeLastUsedDeckId(casualDeckPreferenceKey(userId, selectionMode), deckId);
      setPreferredFormat(selectionFormat);
      writeCasualRuleMode(userId, selectionMode);
      setFlow(null);
    }
  };
  const title = flow
    ? {
        FIND: '找对手',
        CREATE: '创建房间',
        JOIN: flow.source ? '切换到另一间房' : '加入房间',
        DECK: '更换卡组',
        REMATCH: '再来一局',
        ACCEPT: '同意再战并选组',
        CONTINUE: '继续公开找人',
        CODE: '输入房间号',
        SPECTATE: '选择观战视角',
        NOTE: '房间备注',
        LEAVE: table?.runtime?.status === 'OPENING' ? '退出本轮开局？' : '离开房间？',
        CANCEL: flow.nextRuleMode
          ? `结束等待并切换到${casualRuleName(flow.nextRuleMode)}？`
          : table?.state === 'WAITING'
            ? '取消等待？'
            : '取消本次配对？',
      }[flow.kind]
    : '';
  const isForm = flow && !['SPECTATE', 'NOTE', 'CANCEL', 'LEAVE'].includes(flow.kind);
  const pending = table?.state === 'RESERVED';
  const confirmed = table?.members.find((member) => member.userId === userId)?.confirmed;
  const activeRuntime = table?.state === 'BOUND';
  const ended = table?.runtime?.status === 'ENDED';
  const rematch = table?.runtime?.rematch;
  const ownError = localError ?? storeError;
  const visibleRows = rows.filter((row) => row.ruleMode === ruleMode && row.format === format);
  const snapshotMatchesMode = loadedSearch?.startsWith(`${ruleMode}:${format}:`) ?? false;
  const stale = snapshot && now - snapshot.snapshotAt > 10_000;
  const localSetupBlocked = !hydrated || busy || Boolean(table || status?.otherParticipation);
  const createDeckPickerOpen = flow?.kind === 'CREATE' && deckPickerOpen;
  const deckSelector = flow && (
    <DeckSelector
      ruleMode={selectionMode}
      cloudDecks={cloudDecks}
      onSwitchToUnlimited={
        !table && ['FIND', 'CREATE'].includes(flow.kind) ? () => switchRule('UNLIMITED') : undefined
      }
      selectedId={chosen?.id}
      onSelect={(deck) => {
        setSelected(deck);
        setDeckPickerOpen(false);
      }}
      isLoading={deckLoadState === 'LOADING'}
      isRefreshing={deckLoadState === 'REFRESHING'}
      error={cloudError}
      onRefresh={() => void refreshDecks()}
      title="选择本局卡组"
      density="compact"
      layout={flow.kind === 'CREATE' ? 'list' : 'grid'}
      autoFocusSelection={flow.kind === 'CREATE' && deckPickerOpen}
      lastUsedDeckId={lastDeck}
      emptyActionLabel="管理卡组"
      onEmptyAction={() => {
        setFlow(null);
        onManageDecks();
      }}
    />
  );

  const roomCodeAction = table ? (
    <button
      className="casual-copy-code button-ghost"
      aria-label="复制房间号"
      title={copyFeedback?.kind === 'code' ? '房间号已复制' : '复制房间号'}
      onClick={() => void copy(table.roomCode, 'code')}
    >
      <span className="casual-code">{table.roomCode}</span>
      {copyFeedback?.kind === 'code' ? (
        <Check size={14} aria-hidden="true" className="casual-copy-complete" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
    </button>
  ) : null;

  return (
    <main className={`casual-lobby${table?.state === 'BUILDING' ? ' casual-lobby--sealed' : ''}`}>
      <header className="casual-heading">
        <div>
          <button className="button-ghost casual-home" onClick={onBack}>
            <ArrowLeft size={16} />
            返回首页
          </button>
          <h1>{table?.state === 'BUILDING' ? 'BP7 开盒赛' : '对战大厅'}</h1>
        </div>
        {!localSetupBlocked && (
          <details className="casual-practice">
            <summary>
              练习与调试 <ChevronDown size={15} aria-hidden="true" />
            </summary>
            <div className="casual-practice-options" role="group" aria-label="练习与调试">
              <button className="button-ghost" onClick={() => onLocalSetup(GameMode.SOLITAIRE)}>
                <Target size={17} aria-hidden="true" />
                对墙打
              </button>
              <button className="button-ghost" onClick={() => onLocalSetup(GameMode.DEBUG)}>
                <Bug size={17} aria-hidden="true" />
                双人调试
              </button>
            </div>
          </details>
        )}
      </header>
      <section
        className={
          table || status?.otherParticipation ? 'casual-current ui-panel' : 'casual-announcements'
        }
        aria-label="我的房间"
      >
        {(table || status?.otherParticipation) && (
          <div className="casual-current-top">
            <div className="casual-current-label">
              {table && <CasualRuleMark mode={table.ruleMode} />}
              <div>
                <h2 id="casual-current-title" tabIndex={-1}>
                  我的房间
                </h2>
                {table && <CasualRuleBadge mode={table.ruleMode} showMark={false} />}
              </div>
            </div>
            {roomCodeAction}
          </div>
        )}
        {!hydrated ? (
          <p role="status">正在恢复当前房间…</p>
        ) : table ? (
          <>
            <div
              className={`casual-current-body${table.state === 'WAITING' ? ' casual-current-body--waiting' : ''}`}
            >
              <div className="casual-current-main">
                {table.state === 'WAITING' ? (
                  <div className="casual-waiting">
                    <div className="casual-waiting-status">
                      <div className="casual-waiting-seats" aria-hidden="true">
                        <span className="casual-waiting-seat casual-waiting-seat--occupied">
                          <UserRound size={22} />
                        </span>
                        <span className="casual-waiting-connection">
                          <i />
                          <i />
                          <i />
                        </span>
                        <span className="casual-waiting-seat casual-waiting-seat--empty">
                          <UserRound size={22} />
                        </span>
                      </div>
                      <div className="casual-waiting-caption">
                        <span
                          role="status"
                          aria-label={
                            table.discoverability === 'PUBLIC' ? '正在公开等人' : '凭链接等人'
                          }
                          className="casual-waiting-title"
                        >
                          等待加入
                        </span>
                        <span className="casual-waiting-detail">
                          {table.discoverability === 'PUBLIC' ? '公开房间' : '凭链接加入'}
                          <span aria-hidden="true"> · </span>
                          <span className="casual-waiting-time">
                            已等待 {duration(table.waitingSince, now)}
                          </span>
                        </span>
                      </div>
                    </div>
                    <ActionButton
                      variant="secondary"
                      aria-label="复制邀请"
                      onClick={() =>
                        void copy(
                          `${casualRuleName(table.ruleMode)}${table.ruleMode === 'UNLIMITED' ? '（PT 不限）' : ''} · 房间 ${table.roomCode}\n${window.location.origin}/?page=battle-lobby&room=${table.roomCode}`,
                          'invite'
                        )
                      }
                    >
                      {copyFeedback?.kind === 'invite' ? (
                        <Check size={16} aria-hidden="true" className="casual-copy-complete" />
                      ) : (
                        <Copy size={16} aria-hidden="true" />
                      )}
                      <span className="casual-copy-label">
                        <span className="invisible" aria-hidden="true">
                          复制邀请
                        </span>
                        <span>{copyFeedback?.kind === 'invite' ? '已复制' : '复制邀请'}</span>
                      </span>
                    </ActionButton>
                  </div>
                ) : (
                  <h3>
                    {pending
                      ? confirmed
                        ? '你已确认，等待对手'
                        : '对手已加入，请确认开局'
                      : table.state === 'BUILDING'
                        ? '开盒并组建本局卡组'
                        : table.state === 'BOOTSTRAPPING'
                          ? '双方已确认，正在开局'
                          : ended
                            ? '本局已结束'
                            : table.runtime?.status === 'OPENING'
                              ? '正在等待开局'
                              : '你的房间正在对战'}
                  </h3>
                )}
                {(table.state !== 'WAITING' || table.members.length > 1) && (
                  <p>
                    {table.members
                      .map(
                        (member) =>
                          `${member.displayName}${table.runtime?.departedUserIds.includes(member.userId) ? '（已离开）' : ''}`
                      )
                      .join(' · ')}
                  </p>
                )}
                {table.state !== 'BUILDING' && (
                  <div className="casual-current-deck">
                    <p className="casual-muted">
                      {table.ownDeck?.name}
                      {table.ownDeck && table.format !== 'SEALED_BP7' && (
                        <>
                          {' '}
                          ·{' '}
                          {table.ruleMode === 'UNLIMITED'
                            ? `${table.ownDeck.pointTotal} PT`
                            : casualPointSummary(
                                table.ownDeck.pointTotal,
                                table.ownDeck.pointLimit,
                                table.ruleMode
                              )}
                        </>
                      )}
                      {pending && (
                        <>
                          <span aria-hidden="true">
                            {' '}
                            · 剩余{' '}
                            {Math.max(
                              0,
                              Math.ceil(((table.confirmationExpiresAt ?? now) - now) / 1000)
                            )}{' '}
                            秒
                          </span>
                          <span className="sr-only">请在本轮确认期限内确认</span>
                        </>
                      )}
                    </p>
                    {table.state === 'WAITING' && table.format !== 'SEALED_BP7' && (
                      <ActionButton
                        variant="ghost"
                        className="casual-current-deck-change"
                        disabled={busy}
                        onClick={() => open('DECK')}
                      >
                        更换卡组
                      </ActionButton>
                    )}
                  </div>
                )}
                {table.discoverability === 'UNLISTED' && table.state === 'WAITING' && (
                  <p className="casual-muted">不会出现在公开列表；知道房间号或链接的玩家可加入。</p>
                )}
                {rematch && (
                  <p role="status">
                    {rematch.requesterUserId === userId
                      ? '已发送再战请求，等待对手同意。'
                      : '对手请求再来一局，请选择卡组并回应。'}
                  </p>
                )}
              </div>
              {table.state !== 'WAITING' && table.state !== 'BUILDING' && (
                <div className="casual-actions">
                  {pending && (
                    <>
                      <button
                        className="button-ghost"
                        disabled={busy}
                        onClick={() => open('CANCEL')}
                      >
                        取消配对
                      </button>
                      <button
                        className="button-primary"
                        disabled={busy || confirmed}
                        onClick={() => void action('confirm', { target: table })}
                      >
                        {confirmed ? '已确认' : '确认开局'}
                      </button>
                    </>
                  )}
                  {activeRuntime && (
                    <>
                      {ended && table.format === 'SEALED_BP7' && (
                        <SealedRematchControls table={table} userId={userId} now={now} />
                      )}
                      {ended && table.format !== 'SEALED_BP7' && table.canRematch && !rematch && (
                        <button
                          className="button-primary"
                          disabled={busy}
                          onClick={() => open('REMATCH')}
                        >
                          再来一局
                        </button>
                      )}
                      {ended && table.canContinuePublic && (
                        <button
                          className="button-primary"
                          disabled={busy}
                          onClick={() => open('CONTINUE')}
                        >
                          继续公开找人
                        </button>
                      )}
                      {rematch?.responderUserId === userId && (
                        <>
                          <button
                            className="button-secondary"
                            disabled={busy}
                            onClick={() =>
                              void action('rematch/respond', {
                                target: table,
                                requestId: rematch.requestId,
                                deckId: null,
                                spectatorEnabled: null,
                              })
                            }
                          >
                            拒绝
                          </button>
                          <button
                            className="button-primary"
                            disabled={busy}
                            onClick={() => open('ACCEPT')}
                          >
                            同意并选组
                          </button>
                        </>
                      )}
                      {rematch?.requesterUserId === userId && (
                        <button
                          className="button-secondary"
                          disabled={busy}
                          onClick={() =>
                            void action('rematch/respond', {
                              target: table,
                              requestId: rematch.requestId,
                              deckId: null,
                              spectatorEnabled: null,
                            })
                          }
                        >
                          撤回请求
                        </button>
                      )}
                      <button
                        className={ended ? 'button-secondary' : 'button-primary'}
                        onClick={() => openCasualDestination('online-room', table.roomCode)}
                      >
                        {ended ? '查看本局结果' : '返回房间'}
                      </button>
                      {(ended || table.runtime?.status === 'OPENING') && (
                        <button
                          className="button-secondary"
                          disabled={busy}
                          onClick={() => open('LEAVE')}
                        >
                          离开房间
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            {table.state === 'BUILDING' && (
              <SealedBuilder
                table={table}
                userId={userId}
                now={now}
                roomCodeAction={roomCodeAction}
              />
            )}
            {table.state !== 'BOOTSTRAPPING' && (
              <div className="casual-current-footer">
                <label className="casual-check">
                  <input
                    type="checkbox"
                    checked={table.spectatorEnabled}
                    disabled={busy}
                    onChange={(event) =>
                      void action('spectator-preference', {
                        target: table,
                        enabled: event.target.checked,
                      })
                    }
                  />
                  开放我的观战视角
                </label>
                {table.state === 'WAITING' && (
                  <div
                    className="casual-current-exit-actions"
                    role="group"
                    aria-label="结束当前等待"
                  >
                    <button
                      className="button-ghost casual-change-rule"
                      disabled={busy}
                      onClick={() => {
                        open('CANCEL');
                        setFlow((current) =>
                          current
                            ? {
                                ...current,
                                nextRuleMode: table.ruleMode === 'NORMAL' ? 'UNLIMITED' : 'NORMAL',
                              }
                            : current
                        );
                      }}
                    >
                      切换模式…
                    </button>
                    <ActionButton variant="ghost" disabled={busy} onClick={() => open('CANCEL')}>
                      取消等待
                    </ActionButton>
                  </div>
                )}
              </div>
            )}
          </>
        ) : status?.otherParticipation ? (
          <div className="casual-current-body">
            <p>你已有排位、活动或真人对局任务。</p>
            <button
              className="button-primary"
              onClick={() => openCasualDestination(status.otherParticipation!.destination)}
            >
              返回当前任务
            </button>
          </div>
        ) : null}
        {snapshot?.unavailableReason && (
          <p role="status" className="casual-error">
            {snapshot.unavailableReason}
          </p>
        )}
        {ownError && !flow && (
          <p className="casual-error" role="alert">
            {ownError}
          </p>
        )}
        <span role="status" className="sr-only">
          {copyFeedback ? (copyFeedback.kind === 'code' ? '房间号已复制' : '邀请已复制') : ''}
        </span>
        {!table &&
          status?.notice &&
          !['PLAYER_CANCELED', 'ROOM_LEFT', 'CONTINUED_PUBLICLY', 'SWITCHED_ROOM'].includes(
            status.notice.reason
          ) &&
          !ownError && (
            <p className="casual-muted" role="status">
              {getCasualClosureMessage(status.notice.reason)}
            </p>
          )}
      </section>
      {!table && !status?.otherParticipation && (
        <section className="casual-preparation" aria-label="对战准备">
          <CasualRuleSelector
            value={ruleMode}
            disabled={!hydrated || busy || Boolean(flow)}
            onChange={switchRule}
          />
          {ruleMode === 'UNLIMITED' && (
            <div className="casual-format-selector" role="group" aria-label="娱乐玩法">
              <button
                className={format === 'CONSTRUCTED' ? 'button-primary' : 'button-ghost'}
                aria-pressed={format === 'CONSTRUCTED'}
                disabled={busy || Boolean(flow)}
                onClick={() => setPreferredFormat('CONSTRUCTED')}
              >
                自由构筑
              </button>
              <button
                className={format === 'SEALED_BP7' ? 'button-primary' : 'button-ghost'}
                aria-pressed={format === 'SEALED_BP7'}
                disabled={busy || Boolean(flow)}
                onClick={() => setPreferredFormat('SEALED_BP7')}
              >
                BP7 开盒赛
              </button>
            </div>
          )}
          <button
            className="button-primary casual-find"
            disabled={!hydrated || busy || Boolean(snapshot?.unavailableReason)}
            onClick={() => open('FIND')}
          >
            <Swords size={17} />
            找对手
          </button>
        </section>
      )}
      <section className="casual-rooms" aria-labelledby="casual-rooms-title">
        <div className="casual-section-heading">
          <div className="casual-room-heading">
            <h2 id="casual-rooms-title">
              <CasualRuleMark mode={ruleMode} />
              {format === 'SEALED_BP7' ? 'BP7 开盒赛' : casualRuleName(ruleMode)}房间
            </h2>
            {snapshot &&
              snapshotMatchesMode &&
              snapshot.counts.waiting + snapshot.counts.preparing + snapshot.counts.playing > 0 && (
                <p>
                  {snapshot.counts.waiting} 间等人 · {snapshot.counts.preparing} 间准备 ·{' '}
                  {snapshot.counts.playing} 间对战中
                </p>
              )}
          </div>
          <div className="casual-room-commands" aria-label="房间操作">
            {!table && !status?.otherParticipation && (
              <button
                className="button-ghost casual-room-command"
                disabled={!hydrated || busy || Boolean(snapshot?.unavailableReason)}
                onClick={() => open('CREATE')}
              >
                <Plus size={16} />
                创建房间
              </button>
            )}
            <button className="button-ghost casual-room-command" onClick={() => open('CODE')}>
              <Hash size={16} />
              输入房间号
            </button>
          </div>
        </div>
        <div className="casual-toolbar">
          <label className="casual-search">
            <Search size={16} />
            <input
              aria-label="搜索昵称或房间号"
              placeholder="昵称或房间号"
              maxLength={80}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <span className="casual-list-progress" role="status">
            {snapshot && !listError && queryKey !== loadedSearch ? '正在搜索…' : ''}
          </span>
          <button
            className="button-ghost casual-refresh"
            aria-label="刷新房间"
            title="刷新房间"
            disabled={reading}
            onClick={() => void read(true)}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <div id="casual-rooms-panel" role="region" aria-label="房间列表" aria-busy={reading}>
          {(listError || stale) && (
            <p role="status" className="casual-error">
              {listError ?? '状态可能已变化'}
              {snapshot ? ` · 上次更新 ${new Date(snapshot.snapshotAt).toLocaleTimeString()}` : ''}
              <button className="button-ghost" onClick={() => void read(true)}>
                重试
              </button>
            </p>
          )}
          {pendingCount > 0 && (
            <button
              className="casual-update button-secondary"
              onClick={() => {
                setRows(latest.current);
                setPendingCount(0);
              }}
            >
              有 {pendingCount} 间新房间，更新列表
            </button>
          )}
          {!snapshot || !snapshotMatchesMode ? (
            <div className="casual-empty" role="status">
              {listError ? '房间列表加载失败，请重试。' : '正在加载公开房间…'}
            </div>
          ) : !visibleRows.length ? (
            <div
              className={`casual-empty${table || status?.otherParticipation ? ' casual-empty--secondary' : ''}`}
            >
              <h3>
                {debouncedSearch
                  ? '没有找到这个房间或玩家'
                  : `暂无${casualRuleName(ruleMode)}公开房间`}
              </h3>
              {debouncedSearch || (!table && !status?.otherParticipation) ? (
                <p>
                  {debouncedSearch ? '换个昵称或房间号试试。' : '找个对手，或创建房间邀请朋友。'}
                </p>
              ) : null}
              {search && (
                <button className="button-secondary" onClick={() => setSearch('')}>
                  清除搜索
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="casual-row casual-row-head" aria-hidden="true">
                <span>参与者／房间号</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              <ul className="casual-room-list" aria-label="公开房间列表">
                {visibleRows.map((row) => (
                  <li className="casual-row" key={row.tableId}>
                    <div className="casual-identity">
                      <strong>{row.members.map((member) => member.displayName).join(' · ')}</strong>
                      <div className="casual-room-details">
                        <span className="casual-code">
                          {row.roomCode}
                          {row.isMine ? ' · 我的房间' : ''}
                        </span>
                      </div>
                      {row.note && (
                        <button
                          type="button"
                          className="casual-room-note"
                          aria-label={`查看房间 ${row.roomCode} 的备注`}
                          title={row.note}
                          onClick={() => open('NOTE', row)}
                        >
                          <span>{row.note}</span>
                          <ChevronRight size={12} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <div className="casual-row-status">
                      <span className={`casual-state casual-state-${row.status.toLowerCase()}`}>
                        {names[row.status]}
                      </span>
                      {row.status === 'PLAYING' && !row.spectatorViews.length && (
                        <small>未开放观战</small>
                      )}
                    </div>
                    {(row.isMine || row.canJoin || row.spectatorViews.length > 0) && (
                      <div className="casual-row-action">
                        <button
                          className={!row.isMine && row.canJoin ? 'casual-join' : 'button-ghost'}
                          aria-label={
                            row.isMine
                              ? `返回我的房间 ${row.roomCode}`
                              : row.canJoin
                                ? `加入 ${row.members[0]?.displayName} 的房间`
                                : `观战 ${row.members.map((member) => member.displayName).join('与')} 的对局`
                          }
                          disabled={
                            Boolean(spectatingTable) ||
                            (!row.isMine &&
                              row.canJoin &&
                              (Boolean(snapshot?.unavailableReason) || busy || recoveringJoin))
                          }
                          aria-busy={spectatingTable === row.tableId}
                          onClick={() =>
                            row.isMine
                              ? document.getElementById('casual-current-title')?.focus()
                              : row.canJoin
                                ? open('JOIN', row)
                                : row.spectatorViews.length === 1
                                  ? void enterSpectator(row, row.spectatorViews[0].seat)
                                  : open('SPECTATE', row)
                          }
                        >
                          {spectatingTable === row.tableId
                            ? '进入中…'
                            : row.isMine
                              ? '我的房间'
                              : row.canJoin
                                ? '加入房间'
                                : '观战'}
                          {!row.isMine && row.canJoin && (
                            <ArrowRight size={14} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {snapshot.nextCursor && loadedSearch === queryKey && (
                <button
                  className="button-secondary casual-load-more"
                  disabled={reading}
                  onClick={() => void read(true, true)}
                >
                  继续加载房间
                </button>
              )}
            </>
          )}
        </div>
      </section>
      {flow && (
        <LobbyDialog
          title={createDeckPickerOpen ? '选择本局卡组' : title}
          closeDisabled={busy || Boolean(spectatingTable)}
          onClose={() => {
            if (!busy && !spectatorPending.current) {
              lookupEpoch.current += 1;
              setLooking(false);
              setFlow(null);
              setLocalError(null);
            }
          }}
        >
          {flow.kind === 'CANCEL' || flow.kind === 'LEAVE' ? (
            <>
              <p>
                {flow.kind === 'LEAVE'
                  ? table?.runtime?.status === 'OPENING'
                    ? '退出将关闭本轮开局，双方席位都会释放。'
                    : '离开后不再参与这个房间的再战。对手仍可保留赛后结果并继续找人。'
                  : flow.nextRuleMode
                    ? `将取消本次等待并切换到${casualRuleName(flow.nextRuleMode)}，切换后请重新找人。`
                    : '本次操作会释放你的席位。下一次主动找人会重新计算等待时间。'}
              </p>
              <div className="casual-actions">
                <button className="button-secondary" disabled={busy} onClick={() => setFlow(null)}>
                  {flow.kind === 'LEAVE' ? '留在房间' : '继续等待'}
                </button>
                <button
                  className="button-primary"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await action(flow.kind === 'LEAVE' ? 'leave' : 'cancel', {
                        target: flow.target,
                      })
                    ) {
                      if (flow.nextRuleMode) {
                        switchRule(flow.nextRuleMode);
                      }
                      setFlow(null);
                    }
                  }}
                >
                  {flow.kind === 'LEAVE'
                    ? '确认退出'
                    : flow.nextRuleMode
                      ? '取消等待并切换'
                      : '确认取消'}
                </button>
              </div>
            </>
          ) : flow.kind === 'NOTE' ? (
            <div className="casual-note-content">
              <p className="casual-muted">
                {flow.row?.members.map((member) => member.displayName).join(' · ')}
                {' · '}
                {flow.row?.roomCode}
              </p>
              <p>{flow.row?.note}</p>
            </div>
          ) : flow.kind === 'SPECTATE' ? (
            <>
              <p>只展示玩家已开放的视角。入场时会再次核验授权。</p>
              <div className="casual-actions">
                {flow.row?.spectatorViews.map((view) => (
                  <button
                    className="button-primary"
                    key={view.seat}
                    disabled={looking}
                    onClick={() => void enterSpectator(flow.row!, view.seat)}
                  >
                    观看 {view.displayName} 的视角
                  </button>
                ))}
              </div>
            </>
          ) : (
            isForm && (
              <form
                onSubmit={(event) => void submit(event)}
                className={`casual-form${flow.kind === 'CREATE' ? ' casual-create-form' : ''}`}
              >
                {flow.kind === 'CODE' ? (
                  <>
                    <label>
                      房间号
                      <input
                        name="roomCode"
                        autoCapitalize="characters"
                        autoComplete="off"
                        required
                        maxLength={12}
                        defaultValue={new URLSearchParams(window.location.search).get('room') ?? ''}
                        onChange={() => {
                          lookupEpoch.current += 1;
                          setLooking(false);
                          setPreview(null);
                          setActivityPreview(null);
                          setLocalError(null);
                        }}
                      />
                    </label>
                    <button className="button-primary" disabled={looking}>
                      {looking ? '正在查找…' : '查找房间'}
                    </button>
                    {activityPreview && (
                      <div className="casual-preview">
                        <strong>
                          {activityPreview.seats.map((view) => view.displayName).join(' · ')}
                        </strong>
                        <p>{activityPreview.roomCode} · 对战中</p>
                        <div className="casual-actions">
                          {activityPreview.seats
                            .filter((view) => view.enabled)
                            .map((view) => (
                              <button
                                type="button"
                                className="button-primary"
                                key={view.seat}
                                disabled={looking}
                                onClick={() =>
                                  void enterActivitySpectator(activityPreview, view.seat)
                                }
                              >
                                观看 {view.displayName} 的视角
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                    {preview && (
                      <div className="casual-preview">
                        <strong>
                          {preview.members.map((member) => member.displayName).join(' · ')}
                        </strong>
                        <p>
                          {preview.roomCode} · {names[preview.status]}
                          <CasualRuleBadge mode={preview.ruleMode} />
                        </p>
                        {preview.isMine ? (
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => setFlow(null)}
                          >
                            查看我的当前状态
                          </button>
                        ) : preview.canJoin ? (
                          <button
                            type="button"
                            className="button-primary"
                            disabled={Boolean(snapshot?.unavailableReason)}
                            onClick={() => open('JOIN', preview)}
                          >
                            {preview.format === 'SEALED_BP7' ? '加入开盒赛' : '选择卡组并加入'}
                          </button>
                        ) : preview.spectatorViews.length ? (
                          <button
                            type="button"
                            className="button-primary"
                            onClick={() => open('SPECTATE', preview)}
                          >
                            选择观战视角
                          </button>
                        ) : (
                          <p>房间当前无法加入，且未开放观战。</p>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {createDeckPickerOpen && (
                      <div className="casual-create-deck-picker">
                        <ActionButton
                          variant="ghost"
                          className="casual-picker-back"
                          onClick={() => setDeckPickerOpen(false)}
                        >
                          <ArrowLeft size={16} aria-hidden="true" />
                          返回房间设置
                        </ActionButton>
                        {deckSelector}
                      </div>
                    )}
                    <div className="casual-room-settings" hidden={createDeckPickerOpen}>
                      <CasualRuleBadge mode={selectionMode} />
                      {flow.kind !== 'CREATE' && !sealedSelection && (
                        <p>{casualRuleDescription(selectionMode)}</p>
                      )}
                      {flow.kind === 'FIND' && (
                        <div className="casual-match-hint">
                          <Search size={20} aria-hidden="true" />
                          <div>
                            <strong>
                              {sealedSelection ? '寻找开盒赛对手' : '寻找正在等候的对手'}
                            </strong>
                            <p>优先加入公开房间；暂无对手时，为你创建房间等待。</p>
                          </div>
                        </div>
                      )}
                      {flow.kind === 'JOIN' && (
                        <p>
                          {flow.row?.members[0]?.displayName} · {flow.row?.roomCode}。
                          {sealedSelection ? '双方确认后开盒。' : '选组期间不占座。'}
                          {flow.source
                            ? '成功加入后才取消原等待；目标失效时保留原房间。'
                            : '加入后由双方确认开局。'}
                        </p>
                      )}
                      {['REMATCH', 'ACCEPT'].includes(flow.kind) && (
                        <p>选择本次卡组。双方同意后仍需在新轮次各自确认开局。</p>
                      )}
                      {sealedSelection ? (
                        <section className="sealed-format-summary" aria-label="开盒赛玩法">
                          <div className="sealed-format-heading">
                            <span className="sealed-format-icon">
                              <PackageOpen size={23} aria-hidden="true" />
                            </span>
                            <div>
                              <h3>BP7 开盒赛</h3>
                              <p>双方各开一盒，用开出的卡牌组牌，无需预选卡组。</p>
                            </div>
                          </div>
                          <dl className="sealed-format-facts">
                            <div>
                              <dt>每人一盒</dt>
                              <dd>
                                50 <small>张</small>
                              </dd>
                              <dd className="sealed-fact-detail">10 包 × 5 张</dd>
                            </div>
                            <div>
                              <dt>开盒及组牌</dt>
                              <dd>
                                15 <small>分钟</small>
                              </dd>
                              <dd className="sealed-fact-detail">双方共用倒计时</dd>
                            </div>
                            <div>
                              <dt>本局卡组</dt>
                              <dd>
                                24 <small>＋</small> 6
                              </dd>
                              <dd className="sealed-fact-detail">成员 ＋ 固定 Live</dd>
                            </div>
                          </dl>
                          <div className="sealed-format-rules">
                            <span>
                              <Heart size={15} aria-hidden="true" />
                              印刷必要心视为灰心
                            </span>
                            <span>
                              <Trophy size={15} aria-hidden="true" />
                              两首 Live 获胜
                            </span>
                          </div>
                          <p className="sealed-format-note">
                            能量自动补足 12 张 · 模拟封入，非官方概率
                          </p>
                        </section>
                      ) : (chosen || flow.kind === 'CREATE') && !deckPickerOpen ? (
                        <div className="casual-selected-deck">
                          {chosen?.previewCardCodes[0] && (
                            <PresentationImage
                              src={getCardImagePath(chosen.previewCardCodes[0])}
                              alt=""
                            />
                          )}
                          <div>
                            {flow.kind !== 'CREATE' && <small>本局卡组</small>}
                            <strong>{chosen?.name ?? '未选择卡组'}</strong>
                            <span>
                              {!chosen
                                ? '选择卡组后创建房间'
                                : pointTableDisplayReady
                                  ? casualPointSummary(
                                      chosen.pointTotal,
                                      pointTable.pointLimit,
                                      selectionMode
                                    )
                                  : 'PT 暂无法读取'}
                            </span>
                          </div>
                          <ActionButton
                            ref={selectedDeckButtonRef}
                            variant={flow.kind === 'CREATE' ? 'ghost' : 'secondary'}
                            onClick={() => setDeckPickerOpen(true)}
                          >
                            {chosen ? '更换' : '选择卡组'}
                          </ActionButton>
                        </div>
                      ) : flow.kind !== 'CREATE' ? (
                        <div className="casual-deck-selector">{deckSelector}</div>
                      ) : null}
                      {flow.kind === 'CREATE' && (
                        <>
                          <label>
                            <span className="casual-field-label">
                              房间号（可选）
                              <small id="casual-custom-code-hint">4–12 位字母或数字</small>
                            </span>
                            <TextInput
                              name="roomCode"
                              className="mt-2 block"
                              aria-label="房间号（可选）"
                              maxLength={12}
                              placeholder="留空自动生成"
                              autoCapitalize="characters"
                              autoComplete="off"
                              spellCheck={false}
                              aria-describedby="casual-custom-code-hint"
                            />
                          </label>
                          <fieldset className="casual-access">
                            <legend>访问方式</legend>
                            <div className="casual-access-options">
                              <label className="casual-choice">
                                <input type="radio" name="access" value="PUBLIC" defaultChecked />
                                公开找人
                              </label>
                              <label className="casual-choice">
                                <input type="radio" name="access" value="UNLISTED" />
                                凭链接加入
                              </label>
                            </div>
                          </fieldset>
                          <label>
                            备注（可选）
                            <TextInput
                              name="note"
                              className="mt-2 block"
                              maxLength={40}
                              placeholder="最多 40 字"
                            />
                          </label>
                        </>
                      )}
                      {flow.kind !== 'DECK' && (
                        <label className="casual-check">
                          <input
                            name="spectatorEnabled"
                            type="checkbox"
                            defaultChecked={table?.spectatorEnabled ?? false}
                          />
                          开放我的观战视角
                        </label>
                      )}
                      {flow.kind === 'CONTINUE' && table?.discoverability === 'UNLISTED' && (
                        <label className="casual-check">
                          <input name="publishNewRoom" type="checkbox" required />
                          关闭原凭链接房间，新建公开房间并在大厅找人
                        </label>
                      )}
                      <div className="casual-actions">
                        {flow.kind === 'CREATE' && ownError && (
                          <p className="casual-error" role="alert">
                            {ownError}
                          </p>
                        )}
                        <ActionButton
                          variant={flow.kind === 'CREATE' ? 'ghost' : 'secondary'}
                          disabled={busy}
                          onClick={() => setFlow(null)}
                        >
                          取消
                        </ActionButton>
                        <ActionButton
                          type="submit"
                          disabled={
                            busy ||
                            (!sealedSelection && !chosen) ||
                            (['FIND', 'CREATE', 'JOIN', 'CONTINUE'].includes(flow.kind) &&
                              Boolean(snapshot?.unavailableReason))
                          }
                        >
                          {busy
                            ? '正在处理…'
                            : flow.kind === 'JOIN'
                              ? flow.source
                                ? '取消当前等待并加入'
                                : selectionMode !== ruleMode
                                  ? `按${casualRuleName(selectionMode)}加入`
                                  : '加入房间'
                              : flow.kind === 'CREATE'
                                ? `创建${sealedSelection ? '开盒赛' : selectionMode === 'UNLIMITED' ? '娱乐' : '标准'}房间`
                                : flow.kind === 'FIND'
                                  ? '开始找对手'
                                  : '确认'}
                        </ActionButton>
                      </div>
                    </div>
                  </>
                )}
              </form>
            )
          )}
          {ownError && flow.kind !== 'CREATE' && (
            <p className="casual-error" role="alert">
              {ownError}
            </p>
          )}
        </LobbyDialog>
      )}
    </main>
  );
}

function LobbyDialog({
  title,
  children,
  onClose,
  closeDisabled,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeDisabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  useDialogAccessibility({
    isOpen: true,
    dialogRef: ref,
    initialFocusRef: closeButton,
    onEscape: onClose,
  });
  return (
    <div className="casual-dialog-backdrop">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="casual-dialog">
        <header>
          <h2 id={id}>{title}</h2>
          <ActionButton
            ref={closeButton}
            variant="icon"
            aria-label="关闭弹层"
            disabled={closeDisabled}
            onClick={onClose}
          >
            <X size={18} />
          </ActionButton>
        </header>
        <div className="casual-dialog-content">{children}</div>
      </div>
    </div>
  );
}
