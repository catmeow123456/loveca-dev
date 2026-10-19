/** 登录后大厅：选择玩法、准备一副卡组、继续当前任务。 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTextPresentation } from '@/lib/appPresentation';
import {
  ArrowRight,
  Bot,
  Bug,
  CalendarClock,
  Check,
  ChevronRight,
  DoorOpen,
  Eye,
  History,
  Layers3,
  Medal,
  Pencil,
  RefreshCw,
  School,
  ShieldAlert,
  Sparkles,
  Swords,
  Target,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type { CasualTableCurrentView } from '@game/online/casual-table-types';
import type { MatchRecordSummaryView } from '@game/online/replay-types';
import { hasAnyManagementPermission, hasPermission } from '@game/shared/auth/permissions';
import { GameMode } from '@game/shared/types/enums';
import {
  AppCredits,
  LegalNotice,
  ProductFrame,
  DeckSelector,
  formatRelativeTime,
  type ProductNavigationHandlers,
} from '@/components/common';
import { useCasualTableStore } from '@/store/casualTableStore';
import { useAuthStore } from '@/store/authStore';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { isApiConfigured } from '@/lib/apiClient';
import { fetchMatchRecords } from '@/lib/onlineClient';
import { useDeckPointTableRules } from '@/hooks/useDeckPointTable';
import { buildHomeDeckProjection } from '@/lib/homeDeckProjection';
import {
  choosePreferredDeck,
  DECK_SELECTION_PREFERENCE_KEYS,
  readLastUsedDeckId,
  writeLastUsedDeckId,
} from '@/lib/deckSelectionPreferences';
import type {
  PlayerBattleEntryVisibility,
  PublicSiteMaintenanceStatus,
  PublicSiteStatus,
  SiteStatusLifecycle,
} from '@/lib/appConfig';
import { HomeEntryPanel, type HomeEntryAction } from './HomeEntryPanel';
import { HomeDialog } from './HomeDialog';
import { HomeDeckDetails } from './HomeDeckDetails';
import './home-page.css';

const LIFECYCLE_LABELS: Record<SiteStatusLifecycle, string> = {
  NORMAL: '正常',
  RESTRICTING_NEW_GAMES: '限制新开局',
  MAINTENANCE: '维护中',
};

type ModeId = 'casual' | 'ranked' | 'theme' | 'solitaire' | 'debug';
interface LobbyMode {
  id: ModeId;
  label: string;
  description: string;
  icon: LucideIcon;
  action: string;
  preferenceKey?: string;
  localMode?: GameMode.SOLITAIRE | GameMode.DEBUG;
  onEnter: () => void;
}
interface HomePageProps {
  navigation: ProductNavigationHandlers;
  headerActions: ReactNode;
  mobileMenuActions: ReactNode;
  onNavigateToDeckManager: () => void;
  onEditDeck: (deckId: string) => void;
  onNavigateToLocalSetup: (mode: GameMode.SOLITAIRE | GameMode.DEBUG) => void;
  onNavigateToLobby: () => void;
  onAbandonSavedRoomForLocalGame: (
    expected: CasualTableCurrentView | null | undefined
  ) => Promise<void>;
  onNavigateToRanked: () => void;
  onNavigateToThemeTable: () => void;
  onNavigateToMatchRecords: (matchId?: string) => void;
  onNavigateToOnlineDebug: () => void;
  onNavigateToAdminCenter: () => void;
  onNavigateToAiBattle: () => void;
  onNavigateToTutorial: () => void;
  battleEntryVisibility: PlayerBattleEntryVisibility;
  siteStatus: PublicSiteStatus;
}

export function HomePage({
  navigation,
  headerActions,
  mobileMenuActions,
  onNavigateToDeckManager,
  onEditDeck,
  onNavigateToLocalSetup,
  onNavigateToLobby,
  onAbandonSavedRoomForLocalGame,
  onNavigateToRanked,
  onNavigateToThemeTable,
  onNavigateToMatchRecords,
  onNavigateToOnlineDebug,
  onNavigateToAdminCenter,
  onNavigateToAiBattle,
  onNavigateToTutorial,
  battleEntryVisibility,
  siteStatus,
}: HomePageProps) {
  const textOnly = useTextPresentation();
  const { user, profile, offlineMode, offlineUser } = useAuthStore();
  const cloudDecks = useDeckStore((s) => s.cloudDecks);
  const localDecks = useDeckStore((s) => s.localDecks);
  const cloudDecksLoadedAt = useDeckStore((s) => s.cloudDecksLoadedAt);
  const cloudDeckLoadState = useDeckStore((s) => s.cloudDeckLoadState);
  const cloudError = useDeckStore((s) => s.cloudError);
  const ensureCloudDecks = useDeckStore((s) => s.ensureCloudDecks);
  const refreshCloudDecks = useDeckStore((s) => s.refreshCloudDecks);
  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);
  const getCardImagePath = useGameStore((s) => s.getCardImagePath);
  const pointTable = useDeckPointTableRules();
  const currentTask = useCasualTableStore((s) => s.status);
  const table = currentTask?.table;
  const savedRoomCode = table?.state === 'BOUND' ? table.roomCode : null;
  const hasOtherRoom =
    currentTask?.otherParticipation?.kind === 'ONLINE_ROOM' ||
    currentTask?.otherParticipation?.kind === 'ONLINE_MATCH';
  const canUseOnline = !offlineMode && isApiConfigured;
  const canReturnRoom = canUseOnline && Boolean(savedRoomCode || hasOtherRoom);
  const endedRoom = table?.runtime?.status === 'ENDED';
  const ownerId = offlineMode ? `offline:${offlineUser?.username ?? ''}` : (user?.id ?? '');
  const displayUsername = offlineMode
    ? offlineUser?.displayName || '玩家'
    : profile?.display_name || profile?.username || '玩家';
  const [modeId, setModeId] = useState<ModeId>(canUseOnline ? 'casual' : 'solitaire');
  const [selection, setSelection] = useState<{
    ownerId: string;
    ids: Partial<Record<ModeId, string>>;
  }>({ ownerId, ids: {} });
  const [dialog, setDialog] = useState<'choose' | string | null>(null);
  const [isAbandoningRoom, setIsAbandoningRoom] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  useEffect(() => {
    if (canUseOnline) void ensureCloudDecks();
  }, [canUseOnline, ensureCloudDecks]);
  const { deckItems, validDeckItems, validCloudDecks } = useMemo(
    () =>
      buildHomeDeckProjection({
        cloudDecks: canUseOnline ? cloudDecks : [],
        localDecks: offlineMode ? localDecks : [],
        cardDataRegistry,
        pointTable,
      }),
    [canUseOnline, cloudDecks, localDecks, offlineMode, cardDataRegistry, pointTable]
  );

  const localModes: LobbyMode[] = [
    {
      id: 'solitaire',
      label: '对墙打',
      description: '使用自己的卡组练习',
      icon: Target,
      action: '前往对墙打',
      preferenceKey: DECK_SELECTION_PREFERENCE_KEYS.solitaire,
      localMode: GameMode.SOLITAIRE,
      onEnter: () => onNavigateToLocalSetup(GameMode.SOLITAIRE),
    },
    {
      id: 'debug',
      label: '双人调试',
      description: '在同一设备操作双方',
      icon: Bug,
      action: '前往双人调试',
      preferenceKey: DECK_SELECTION_PREFERENCE_KEYS.localDebugPlayer1,
      localMode: GameMode.DEBUG,
      onEnter: () => onNavigateToLocalSetup(GameMode.DEBUG),
    },
  ];
  const modes: LobbyMode[] = canUseOnline
    ? [
        {
          id: 'casual',
          label: '对战大厅',
          description: '自由选组 · 创建或加入房间',
          icon: Swords,
          action: '进入对战大厅',
          preferenceKey: DECK_SELECTION_PREFERENCE_KEYS.publicTable,
          onEnter: onNavigateToLobby,
        },
        ...(battleEntryVisibility.ranked
          ? [
              {
                id: 'ranked' as const,
                label: '赛季排位',
                description: '当前赛季 · 实力较量',
                icon: Medal,
                action: '前往赛季排位',
                preferenceKey: DECK_SELECTION_PREFERENCE_KEYS.ranked,
                onEnter: onNavigateToRanked,
              },
            ]
          : []),
        ...(battleEntryVisibility.themeTable
          ? [
              {
                id: 'theme' as const,
                label: '娱乐模式',
                description: '平台预组 · 轻松体验',
                icon: Sparkles,
                action: '前往娱乐模式',
                onEnter: onNavigateToThemeTable,
              },
            ]
          : []),
      ]
    : localModes;
  const mode = modes.find((entry) => entry.id === modeId) ?? modes[0];
  const ModeIcon = mode.icon;
  const isPlatformMode = mode.id === 'theme';
  const preferredDeck = choosePreferredDeck(
    validDeckItems,
    mode.preferenceKey ? readLastUsedDeckId(mode.preferenceKey) : null
  ).deck;
  const selectedId = selection.ownerId === ownerId ? selection.ids[mode.id] : null;
  const selectedDeck = validDeckItems.find((deck) => deck.id === selectedId) ?? preferredDeck;
  const isLoading =
    canUseOnline &&
    cloudDecksLoadedAt === null &&
    (cloudDeckLoadState === 'LOADING' || cloudDeckLoadState === 'IDLE');
  const isRefreshing = canUseOnline && cloudDeckLoadState === 'REFRESHING';
  const firstReadFailed =
    canUseOnline && cloudDecksLoadedAt === null && cloudDeckLoadState === 'ERROR';
  const needsDeck = !isPlatformMode && !selectedDeck && !isLoading && !firstReadFailed;
  const localBlocked = Boolean(mode.localMode && canReturnRoom);
  const launchDisabled =
    (!isPlatformMode && (isLoading || firstReadFailed || !selectedDeck)) || localBlocked;

  function rememberDeck(preferenceKey?: string) {
    if (preferenceKey && selectedDeck) writeLastUsedDeckId(preferenceKey, selectedDeck.id);
  }
  function enterMode() {
    if (launchDisabled) return;
    rememberDeck(mode.preferenceKey);
    mode.onEnter();
  }
  function enterLocal(localMode: GameMode.SOLITAIRE | GameMode.DEBUG) {
    if (canReturnRoom) return;
    rememberDeck(
      localMode === GameMode.SOLITAIRE
        ? DECK_SELECTION_PREFERENCE_KEYS.solitaire
        : DECK_SELECTION_PREFERENCE_KEYS.localDebugPlayer1
    );
    onNavigateToLocalSetup(localMode);
  }
  async function abandonRoom() {
    setIsAbandoningRoom(true);
    setRoomError(null);
    try {
      await onAbandonSavedRoomForLocalGame(currentTask);
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : '放弃联机对局失败');
    } finally {
      setIsAbandoningRoom(false);
    }
  }
  const entries: HomeEntryAction[] = [
    { id: 'tutorial', title: '新手教程', icon: School, onClick: onNavigateToTutorial },
    {
      id: 'spectate',
      title: '观战',
      icon: Eye,
      onClick: navigation.onSpectate,
      disabled: !canUseOnline,
      disabledReason: canUseOnline ? undefined : '联网登录后可用',
    },
    {
      id: 'match-records',
      title: '历史对局',
      icon: History,
      onClick: () => onNavigateToMatchRecords(),
      disabled: !canUseOnline,
      disabledReason: canUseOnline ? undefined : '联网登录后可用',
    },
    {
      id: 'solitaire',
      title: '对墙打',
      icon: Target,
      onClick: () => enterLocal(GameMode.SOLITAIRE),
      disabled: canReturnRoom,
      disabledReason: canReturnRoom ? '请先处理当前房间' : undefined,
    },
    { id: 'deck-manager', title: '卡组管理', icon: Layers3, onClick: onNavigateToDeckManager },
    {
      id: 'debug',
      title: '双人调试',
      icon: Bug,
      onClick: () => enterLocal(GameMode.DEBUG),
      disabled: canReturnRoom,
      disabledReason: canReturnRoom ? '请先处理当前房间' : undefined,
    },
    ...(import.meta.env.VITE_DEBUG_SEAT
      ? [
          {
            id: 'online-debug' as const,
            title: '联机调试',
            icon: Swords,
            onClick: onNavigateToOnlineDebug,
            disabled: !canUseOnline,
            disabledReason: canUseOnline ? undefined : '联网登录后可用',
          },
        ]
      : []),
  ];
  const detailDeck =
    dialog && dialog !== 'choose' ? deckItems.find((deck) => deck.id === dialog) : null;

  if (textOnly)
    return (
      <ProductFrame
        active="home"
        navigation={navigation}
        actions={headerActions}
        mobileMenuActions={mobileMenuActions}
      >
        <main className="excel-entry">
          <h1>大厅 · {displayUsername}</h1>
          <p>{canUseOnline ? '已联网' : '离线模式'}</p>
          {canReturnRoom && (
            <section aria-label="当前房间">
              <h2>{savedRoomCode ? `房间 ${savedRoomCode}` : '你有正在进行的房间'}</h2>
              <p>{endedRoom ? '对局已结束 · 可协商再战' : '你的席位仍在保留'}</p>
              <button onClick={onNavigateToLobby}>返回房间</button>
              <details>
                <summary>其他操作</summary>
                <p>
                  {endedRoom
                    ? '另开本地对局会离开当前赛后房间。'
                    : '另开本地对局会放弃当前联机对局，且不保留原房间恢复入口。'}
                </p>
                <button disabled={isAbandoningRoom} onClick={() => void abandonRoom()}>
                  {isAbandoningRoom ? '正在处理…' : '另开本地对局'}
                </button>
              </details>
            </section>
          )}
          {roomError && <p role="alert">{roomError}</p>}
          <label>
            选择玩法
            <select value={mode.id} onChange={(event) => setModeId(event.target.value as ModeId)}>
              {modes.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </label>
          <p>{mode.description}</p>
          {isPlatformMode ? (
            <p>此玩法使用普通界面，按 Ctrl+Alt+E 切换后可进入。</p>
          ) : (
            <>
              <p>
                当前卡组：{selectedDeck?.name ?? '未选择'} · 合法卡组 {validDeckItems.length} 副
              </p>
              <DeckSelector
                cloudDecks={canUseOnline ? cloudDecks : []}
                localDecks={offlineMode ? localDecks : []}
                selectedId={selectedDeck?.id}
                onSelect={(deck) =>
                  setSelection((current) => ({
                    ownerId,
                    ids: {
                      ...(current.ownerId === ownerId ? current.ids : {}),
                      [mode.id]: deck.id,
                    },
                  }))
                }
                isLoading={isLoading}
                isRefreshing={isRefreshing}
                error={canUseOnline ? cloudError : null}
                onRefresh={canUseOnline ? () => void refreshCloudDecks() : undefined}
                title="选择本次使用的卡组"
              />
              <button disabled={launchDisabled} onClick={enterMode}>
                {mode.action}
              </button>
              {needsDeck && <p>需要一副符合规则的卡组</p>}
              {localBlocked && <p>请先处理当前联机房间</p>}
            </>
          )}
          {canUseOnline && (
            <section aria-label="本地练习">
              <button disabled={canReturnRoom} onClick={() => enterLocal(GameMode.SOLITAIRE)}>
                对墙打
              </button>
              {canReturnRoom && <p>请先处理当前房间</p>}
            </section>
          )}
          <SiteStatusBanner siteStatus={siteStatus} />
        </main>
      </ProductFrame>
    );

  return (
    <ProductFrame
      active="home"
      navigation={navigation}
      className="lobby-page"
      actions={headerActions}
      mobileMenuActions={mobileMenuActions}
      footer={
        <footer className="lobby-footer safe-bottom">
          <AppCredits version={__APP_VERSION__} />
          <LegalNotice className="pt-1" />
        </footer>
      }
    >
      <main className="lobby-main">
        <div className="lobby-content">
          <header className="lobby-intro">
            <div>
              <p>欢迎回来，{displayUsername}</p>
              <h1>Loveca 大厅</h1>
            </div>
            {offlineMode && (
              <span className="lobby-offline">
                <WifiOff size={15} aria-hidden="true" />
                离线模式
              </span>
            )}
          </header>
          <SiteStatusBanner siteStatus={siteStatus} />
          {canReturnRoom && (
            <section className="lobby-room-banner" aria-label="当前房间">
              <DoorOpen size={22} aria-hidden="true" />
              <div className="lobby-room-copy">
                <h2>{savedRoomCode ? `房间 ${savedRoomCode}` : '你有正在进行的房间'}</h2>
                <p>{endedRoom ? '对局已结束 · 可协商再战' : '你的席位仍在保留'}</p>
              </div>
              <button type="button" className="home-primary-button" onClick={onNavigateToLobby}>
                返回房间
                <ArrowRight size={17} aria-hidden="true" />
              </button>
              <details className="lobby-room-options">
                <summary>其他操作</summary>
                <p>
                  {endedRoom
                    ? '另开本地对局会离开当前赛后房间。'
                    : '另开本地对局会放弃当前联机对局，且不保留原房间恢复入口。'}
                </p>
                <button
                  type="button"
                  className="home-secondary-button"
                  disabled={isAbandoningRoom}
                  onClick={() => void abandonRoom()}
                >
                  {isAbandoningRoom ? '正在处理…' : '另开本地对局'}
                </button>
              </details>
            </section>
          )}
          {roomError && (
            <p className="home-inline-warning" role="alert">
              {roomError}
            </p>
          )}
          <div
            className={`lobby-workspace${modes.length < 3 ? ' lobby-workspace--few-modes' : ''}`}
          >
            <section
              className="lobby-mode-directory"
              aria-label="选择玩法"
              style={{ '--lobby-mode-count': modes.length } as CSSProperties}
            >
              {modes.map(({ icon: Icon, ...entry }) => (
                <button
                  key={entry.id}
                  type="button"
                  className="lobby-mode-row"
                  aria-pressed={mode.id === entry.id}
                  aria-controls="home-preparation-panel"
                  onClick={() => setModeId(entry.id)}
                >
                  <span className="lobby-mode-icon">
                    <Icon size={25} aria-hidden="true" />
                  </span>
                  <span className="lobby-mode-copy">
                    <strong>{entry.label}</strong>
                    <small>{entry.description}</small>
                  </span>
                  {entry.id === 'theme' && <span className="lobby-mode-status">无需组卡</span>}
                  <span className="lobby-mode-indicator" aria-hidden="true">
                    {mode.id === entry.id && <Check size={19} strokeWidth={2.5} />}
                  </span>
                </button>
              ))}
            </section>
            <section
              id="home-preparation-panel"
              className="lobby-deck-panel"
              aria-label="对战准备"
              aria-busy={!isPlatformMode && isLoading}
            >
              <header className="lobby-preparation-heading" aria-live="polite" aria-atomic="true">
                <div key={mode.id} className="lobby-preparation-title">
                  <ModeIcon size={20} aria-hidden="true" />
                  <h2>{mode.label}</h2>
                </div>
                {!isPlatformMode && selectedDeck && (
                  <span className="lobby-ready">
                    <i />
                    构筑可用
                  </span>
                )}
              </header>
              {isPlatformMode ? (
                <div className="lobby-current-deck">
                  <span className="lobby-deck-placeholder">
                    <Layers3 size={32} aria-hidden="true" />
                  </span>
                  <div>
                    <p className="home-field-label">使用卡组</p>
                    <h3>平台预组</h3>
                    <p className="home-muted">无需自建卡组</p>
                  </div>
                </div>
              ) : selectedDeck ? (
                <div className="lobby-current-deck">
                  <button
                    type="button"
                    className="lobby-deck-cover"
                    aria-label={`查看卡组 ${selectedDeck.name}`}
                    onClick={() => setDialog(selectedDeck.id)}
                  >
                    {selectedDeck.previewCardCodes[0] ? (
                      <img src={getCardImagePath(selectedDeck.previewCardCodes[0])} alt="" />
                    ) : (
                      <Layers3 size={30} aria-hidden="true" />
                    )}
                  </button>
                  <div>
                    <p className="home-field-label">当前卡组</p>
                    <h3>
                      <button type="button" onClick={() => setDialog(selectedDeck.id)}>
                        {selectedDeck.name}
                      </button>
                    </h3>
                    <div className="lobby-deck-tools">
                      <button
                        type="button"
                        className="home-text-button"
                        onClick={() => {
                          setDialog('choose');
                          if (canUseOnline) void ensureCloudDecks();
                        }}
                      >
                        更换卡组
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="home-text-button"
                        onClick={() => setDialog(selectedDeck.id)}
                      >
                        查看构筑
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="lobby-current-deck">
                  <span className="lobby-deck-placeholder">
                    {isLoading ? (
                      <RefreshCw size={28} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Layers3 size={32} aria-hidden="true" />
                    )}
                  </span>
                  <div>
                    <p className="home-field-label">当前卡组</p>
                    <h3>
                      {isLoading
                        ? '正在读取卡组'
                        : firstReadFailed
                          ? '暂时无法读取卡组'
                          : deckItems.length
                            ? '还没有可用卡组'
                            : '还没有卡组'}
                    </h3>
                    {!isLoading &&
                      (firstReadFailed ? (
                        <button
                          type="button"
                          className="home-text-button"
                          onClick={() => void refreshCloudDecks()}
                        >
                          重新读取
                          <RefreshCw size={14} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="home-text-button"
                          onClick={onNavigateToDeckManager}
                        >
                          {deckItems.length ? '调整构筑' : '构筑卡组'}
                          <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      ))}
                  </div>
                </div>
              )}
              {!isPlatformMode && canUseOnline && cloudError && (
                <div className="home-inline-warning" role="status">
                  <TriangleAlert size={16} aria-hidden="true" />
                  <span>{cloudError}</span>
                  {selectedDeck && (
                    <button
                      type="button"
                      className="home-text-button"
                      disabled={isRefreshing}
                      onClick={() => void refreshCloudDecks()}
                    >
                      {isRefreshing ? '正在重试…' : '重试'}
                    </button>
                  )}
                </div>
              )}
              <div className="lobby-launch-action">
                <button
                  type="button"
                  className={canReturnRoom ? 'home-secondary-button' : 'home-primary-button'}
                  disabled={launchDisabled}
                  onClick={enterMode}
                >
                  {mode.action}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </div>
              {needsDeck && (
                <p className="lobby-action-caption">
                  需要一副符合规则的卡组
                  {canUseOnline && battleEntryVisibility.themeTable && (
                    <>
                      ，或
                      <button type="button" onClick={() => setModeId('theme')}>
                        体验娱乐模式
                      </button>
                    </>
                  )}
                </p>
              )}
              {localBlocked && <p className="lobby-action-caption">请先处理当前联机房间</p>}
            </section>
            <HomeEntryPanel actions={entries} />
            <HomeRecentMatch
              userId={canUseOnline ? (user?.id ?? null) : null}
              displayUsername={displayUsername}
              onOpen={onNavigateToMatchRecords}
            />
          </div>
          {profile && hasAnyManagementPermission(profile.role) && (
            <section className="lobby-operations" aria-label="运营工具">
              <button type="button" className="home-text-button" onClick={onNavigateToAdminCenter}>
                <ShieldAlert size={17} aria-hidden="true" />
                {profile.role === 'season_admin' ? '赛季运营中心' : '运营管理中心'}
              </button>
              {hasPermission(profile.role, 'rules.manage') && (
                <button type="button" className="home-text-button" onClick={onNavigateToAiBattle}>
                  <Bot size={17} aria-hidden="true" />
                  AI 对战
                </button>
              )}
            </section>
          )}
        </div>
      </main>
      {dialog === 'choose' && (
        <HomeDialog
          title="更换卡组"
          onClose={() => setDialog(null)}
          action={
            <button
              type="button"
              className="home-text-button"
              onClick={() => {
                setDialog(null);
                onNavigateToDeckManager();
              }}
            >
              <Layers3 size={16} aria-hidden="true" />
              卡组管理
            </button>
          }
        >
          <div className="home-deck-selector">
            <DeckSelector
              cloudDecks={canUseOnline ? validCloudDecks : []}
              localDecks={offlineMode ? localDecks : []}
              selectedId={selectedDeck?.id}
              onSelect={(deck) => {
                setSelection((current) => ({
                  ownerId,
                  ids: { ...(current.ownerId === ownerId ? current.ids : {}), [mode.id]: deck.id },
                }));
                setDialog(null);
              }}
              isLoading={isLoading}
              isRefreshing={isRefreshing}
              error={canUseOnline ? cloudError : null}
              density="compact"
              title="选择本次使用的卡组"
              emptyText="还没有符合规则的卡组。"
            />
          </div>
          {canUseOnline && cloudError && (
            <div className="home-deck-retry">
              <button
                type="button"
                className="home-text-button"
                disabled={isLoading || isRefreshing}
                onClick={() => void refreshCloudDecks()}
              >
                {isLoading || isRefreshing ? '正在重试…' : '重试读取卡组'}
              </button>
            </div>
          )}
        </HomeDialog>
      )}
      {dialog && dialog !== 'choose' && (
        <HomeDialog
          title={detailDeck?.name ?? '卡组已不可用'}
          onClose={() => setDialog(null)}
          action={
            detailDeck && (
              <button
                type="button"
                className="home-text-button"
                onClick={() => {
                  setDialog(null);
                  onEditDeck(detailDeck.id);
                }}
              >
                <Pencil size={16} aria-hidden="true" />
                编辑卡组
              </button>
            )
          }
        >
          {detailDeck ? (
            <HomeDeckDetails deck={detailDeck} />
          ) : (
            <p className="home-dialog-intro">这副卡组已不在当前列表中，请重新选择。</p>
          )}
        </HomeDialog>
      )}
    </ProductFrame>
  );
}

function HomeRecentMatch({
  userId,
  displayUsername,
  onOpen,
}: {
  userId: string | null;
  displayUsername: string;
  onOpen: (matchId?: string) => void;
}) {
  const [result, setResult] = useState<{
    userId: string;
    record: MatchRecordSummaryView | null;
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void fetchMatchRecords().then(
      (records) => {
        const record =
          [...records]
            .filter((item) => item.status !== 'IN_PROGRESS')
            .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))[0] ?? null;
        if (!cancelled) setResult({ userId, record, error: false });
      },
      () => {
        if (!cancelled) setResult({ userId, record: null, error: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [userId, reload]);
  const current = result?.userId === userId ? result : null;
  const record = current?.record;
  const outcome =
    record?.status === 'INTERRUPTED'
      ? '已中断'
      : record?.winnerSeat
        ? record.winnerSeat === record.viewerSeat
          ? '胜利'
          : '落败'
        : '已结束';
  return (
    <section className="lobby-recent" aria-labelledby="home-recent-heading">
      <div className="lobby-section-heading">
        <h2 id="home-recent-heading">最近一场</h2>
        <button
          type="button"
          className="home-text-button"
          disabled={!userId}
          onClick={() => onOpen()}
        >
          全部历史
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
      {!userId ? (
        <p className="home-muted">联网登录后可查看历史对局</p>
      ) : !current ? (
        <p className="home-muted" role="status">
          正在读取最近对局…
        </p>
      ) : current.error ? (
        <div className="home-recent-error">
          <p className="home-muted">暂时无法读取历史对局</p>
          <button
            type="button"
            className="home-text-button"
            onClick={() => {
              setResult(null);
              setReload((value) => value + 1);
            }}
          >
            重试
          </button>
        </div>
      ) : record ? (
        <button
          type="button"
          className="lobby-match-preview"
          onClick={() => onOpen(record.matchId)}
        >
          <span>
            <strong>
              {displayUsername}
              <span className="home-muted"> vs </span>
              {record.opponentDisplayName ?? '对手'}
            </strong>
            <small>
              {record.originKind === 'AI_DEBUG'
                ? 'AI 调试'
                : record.matchMode === 'SOLITAIRE'
                  ? '对墙打'
                  : record.originKind === 'RANKED'
                    ? '赛季排位'
                    : '自由对战'}{' '}
              · {formatRelativeTime(new Date(record.endedAt ?? record.startedAt))}
            </small>
          </span>
          <span className="lobby-match-result">
            {outcome}
            <ChevronRight size={14} aria-hidden="true" />
          </span>
        </button>
      ) : (
        <p className="home-muted">还没有已结束的对局</p>
      )}
    </section>
  );
}
function SiteStatusBanner({ siteStatus }: { siteStatus: PublicSiteStatus }) {
  const maintenance = siteStatus.maintenance;
  if (!maintenance || !shouldHighlightSiteStatus(siteStatus.lifecycle)) {
    return null;
  }

  const isCritical =
    siteStatus.lifecycle === 'MAINTENANCE' || siteStatus.lifecycle === 'RESTRICTING_NEW_GAMES';

  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-3 ${
        isCritical
          ? 'border-[color:var(--semantic-warning)]/50 bg-[color:var(--semantic-warning)]/12'
          : 'border-[color:var(--semantic-info)]/45 bg-[color:var(--semantic-info)]/10'
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <CalendarClock
            size={18}
            className={`mt-0.5 shrink-0 ${
              isCritical ? 'text-[var(--semantic-warning)]' : 'text-[var(--semantic-info)]'
            }`}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--text-secondary)]">
                {LIFECYCLE_LABELS[siteStatus.lifecycle]}
              </span>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {maintenance.title}
              </h2>
            </div>
            <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
              {maintenance.summary}
            </p>
            <MaintenanceMeta maintenance={maintenance} compact />
          </div>
        </div>
        {maintenance.action ? (
          <div className="shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)]">
            {maintenance.action}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MaintenanceMeta({
  maintenance,
  compact = false,
}: {
  maintenance: PublicSiteMaintenanceStatus;
  compact?: boolean;
}) {
  const parts = [
    maintenance.startsAt ? `开始 ${formatStatusDateTime(maintenance.startsAt)}` : null,
    maintenance.estimatedEndsAt
      ? `预计结束 ${formatStatusDateTime(maintenance.estimatedEndsAt)}`
      : null,
    maintenance.restrictsNewGamesAt
      ? `限制新开局 ${formatStatusDateTime(maintenance.restrictsNewGamesAt)}`
      : null,
    maintenance.impactScopes.length > 0 ? `影响 ${maintenance.impactScopes.join('、')}` : null,
  ].filter((part): part is string => part !== null);

  if (parts.length === 0) {
    return null;
  }

  return (
    <div
      className={`mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-[var(--text-muted)] ${
        compact ? '' : 'pt-1'
      }`}
    >
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </div>
  );
}

function shouldHighlightSiteStatus(lifecycle: SiteStatusLifecycle): boolean {
  return lifecycle === 'RESTRICTING_NEW_GAMES' || lifecycle === 'MAINTENANCE';
}

function formatStatusDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, '0');
  const timezoneOffsetMinutes = -date.getTimezoneOffset();
  const offsetSign = timezoneOffsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(timezoneOffsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetMinutes = absoluteOffset % 60;
  const offset =
    offsetMinutes === 0
      ? `UTC${offsetSign}${offsetHours}`
      : `UTC${offsetSign}${offsetHours}:${pad(offsetMinutes)}`;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())} ${offset}`;
}
