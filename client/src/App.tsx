/**
 * Loveca Card Game - Main Application
 */

import {
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { LogOut, UserRound } from 'lucide-react';
import { BattleViewportShell } from '@/components/game/BattleViewportShell';
import { PreMatchBriefingModal } from '@/components/game/PreMatchBriefingModal';
import { AiBattleEndPanel } from '@/components/pages/AiBattleEndPanel';
import {
  AnnouncementCenterButton,
  ConfirmDialog,
  ProductFrame,
  ThemeToggle,
  type ProductNavigationHandlers,
  type ProductNavKey,
} from '@/components/common';
import { HomePage } from '@/components/pages/HomePage';
import { PublicHomePage } from '@/components/pages/PublicHomePage';
import {
  LoginPage,
  RegisterPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from '@/components/auth';
import {
  DEFAULT_APP_CONFIG,
  buildPublicAppConfigRenderKey,
  loadPublicAppConfig,
  refreshPublicAppConfigStrict,
  type PublicAppConfig,
} from '@/lib/appConfig';
import type { PublicSiteStatus, SiteStatusLifecycle } from '@/lib/appConfig';
import { getAiBattleLeaveConfirmCopy, getSolitaireLeaveConfirmCopy } from '@/lib/leaveConfirmCopy';
import {
  getPublicConfigRefreshDelay,
  shouldRunFocusPublicConfigRefresh,
} from '@/lib/publicConfigRefresh';
import { fetchSolitaireMatchSnapshot } from '@/lib/solitaireMatchClient';
import { abandonOnlineRoomForLocalGame } from '@/lib/onlineClient';
import {
  clearStoredSolitaireMatchId,
  readStoredSolitaireMatchId,
} from '@/lib/solitaireMatchRecovery';
import {
  clearStoredAiBattleMatchId,
  fetchAiBattle,
  readStoredAiBattleMatchId,
  restartAiBattle,
  storeAiBattleMatchId,
} from '@/lib/aiBattleClient';
import { createAiBattlePollingScheduler } from '@/lib/aiBattlePolling';
import { ApiClientError } from '@/lib/apiClient';
import { useGameStore } from '@/store/gameStore';
import { useDeckStore } from '@/store/deckStore';
import { useAuthStore } from '@/store/authStore';
import { usePublicTableStore } from '@/store/publicTableStore';
import { useRankedStore } from '@/store/rankedStore';
import { cardService } from '@/lib/cardService';
import { PublicTableGlobalLayer } from '@/components/public-table/PublicTableGlobalLayer';
import { RankedGlobalLayer } from '@/components/ranked/RankedGlobalLayer';

const GameBoard = lazy(() => import('@/components/game/GameBoard'));
const DeckManager = lazy(() =>
  import('@/components/deck/DeckManager').then((module) => ({ default: module.DeckManager }))
);
const GameSetupPage = lazy(() =>
  import('@/components/pages/GameSetupPage').then((module) => ({ default: module.GameSetupPage }))
);
const OnlineDebugPage = lazy(() =>
  import('@/components/pages/OnlineDebugPage').then((module) => ({
    default: module.OnlineDebugPage,
  }))
);
const OnlineRoomPage = lazy(() =>
  import('@/components/pages/OnlineRoomPage').then((module) => ({ default: module.OnlineRoomPage }))
);
const PublicTablePage = lazy(() =>
  import('@/components/pages/PublicTablePage').then((module) => ({
    default: module.PublicTablePage,
  }))
);
const RankedPage = lazy(() =>
  import('@/components/pages/RankedPage').then((module) => ({
    default: module.RankedPage,
  }))
);
const OnlineSpectatorPage = lazy(() =>
  import('@/components/pages/OnlineSpectatorPage').then((module) => ({
    default: module.OnlineSpectatorPage,
  }))
);
const OnlineSpectatorLobbyPage = lazy(() =>
  import('@/components/pages/OnlineSpectatorLobbyPage').then((module) => ({
    default: module.OnlineSpectatorLobbyPage,
  }))
);
const MatchRecordsPage = lazy(() =>
  import('@/components/pages/MatchRecordsPage').then((module) => ({
    default: module.MatchRecordsPage,
  }))
);
const AiBattlePage = lazy(() =>
  import('@/components/pages/AiBattlePage').then((module) => ({
    default: module.AiBattlePage,
  }))
);
const SharedDeckPage = lazy(() =>
  import('@/components/pages/SharedDeckPage').then((module) => ({ default: module.SharedDeckPage }))
);
const AccountCenterPage = lazy(() =>
  import('@/components/pages/AccountCenterPage').then((module) => ({
    default: module.AccountCenterPage,
  }))
);
const CardAdminPage = lazy(() => import('@/components/admin/CardAdminPage'));
const OnlineRoomsAdminPage = lazy(() =>
  import('@/components/admin/OnlineRoomsAdminPage').then((module) => ({
    default: module.OnlineRoomsAdminPage,
  }))
);
const SiteAnnouncementsAdminPage = lazy(() =>
  import('@/components/admin/SiteAnnouncementsAdminPage').then((module) => ({
    default: module.SiteAnnouncementsAdminPage,
  }))
);
const RankedAdminPage = lazy(() =>
  import('@/components/admin/RankedAdminPage').then((module) => ({
    default: module.RankedAdminPage,
  }))
);

type AuthPage =
  | 'landing'
  | 'login'
  | 'register'
  | 'forgot-password'
  | 'reset-password'
  | 'verify-email'
  | 'verify-email-change';
type AppPage =
  | 'home'
  | 'account'
  | 'deck-manager'
  | 'game-setup'
  | 'online-room'
  | 'public-table'
  | 'ranked'
  | 'online-spectator'
  | 'ai-battle'
  | 'match-records'
  | 'online-debug'
  | 'game'
  | 'card-admin'
  | 'online-admin'
  | 'announcement-admin'
  | 'ranked-admin';

interface InitialAuthRequest {
  page: AuthPage;
  token: string | null;
}

function readAuthTokenFromUrl(): string | null {
  const hash = window.location.hash.replace(/^#/, '');
  return hash ? new URLSearchParams(hash).get('token') : null;
}

function getInitialAuthRequest(): InitialAuthRequest {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const token = readAuthTokenFromUrl();

  if (path === '/verify-email') {
    return { page: 'verify-email', token };
  }

  if (path === '/verify-email-change') {
    return { page: 'verify-email-change', token };
  }

  if (path === '/reset-password') {
    return { page: 'reset-password', token };
  }

  if (path === '/login') {
    return { page: 'login', token: null };
  }

  if (path === '/register') {
    return { page: 'register', token: null };
  }

  return { page: 'landing', token: null };
}

function getInitialPage(): AppPage {
  const page = new URLSearchParams(window.location.search).get('page');
  if (
    page === 'deck-manager' ||
    page === 'account' ||
    page === 'game-setup' ||
    page === 'online-room' ||
    page === 'public-table' ||
    page === 'ranked' ||
    page === 'online-spectator' ||
    page === 'ai-battle' ||
    page === 'match-records' ||
    page === 'online-debug' ||
    page === 'game' ||
    page === 'card-admin' ||
    page === 'online-admin' ||
    page === 'announcement-admin' ||
    page === 'ranked-admin' ||
    page === 'platform-config'
  ) {
    return page === 'platform-config' ? 'announcement-admin' : page;
  }
  return 'home';
}

function App() {
  const [initialAuthRequest] = useState<InitialAuthRequest>(() => getInitialAuthRequest());
  const isInitialAuthActionPage =
    initialAuthRequest.page === 'reset-password' ||
    initialAuthRequest.page === 'verify-email' ||
    initialAuthRequest.page === 'verify-email-change';
  const [isLoading, setIsLoading] = useState(!isInitialAuthActionPage);
  const [error, setError] = useState<string | null>(null);
  const [authPage, setAuthPage] = useState<AuthPage>(initialAuthRequest.page);
  const [authToken, setAuthToken] = useState<string | null>(initialAuthRequest.token);
  const [currentPage, setCurrentPage] = useState<AppPage>(getInitialPage);
  const enterOnlineRoom = useCallback(() => setCurrentPage('online-room'), []);
  const [appConfig, setAppConfig] = useState<PublicAppConfig>(DEFAULT_APP_CONFIG);
  const [configInitialized, setConfigInitialized] = useState(false);
  const appConfigRenderKeyRef = useRef(buildPublicAppConfigRenderKey(DEFAULT_APP_CONFIG));
  const publicConfigRefreshInFlightRef = useRef<Promise<boolean> | null>(null);
  const publicConfigLastAttemptAtRef = useRef<number | null>(null);
  const publicConfigRefreshFailureCountRef = useRef(0);

  useLayoutEffect(() => {
    if (!isInitialAuthActionPage || !initialAuthRequest.token) return;
    window.history.replaceState(null, '', window.location.pathname);
  }, [initialAuthRequest.token, isInitialAuthActionPage]);

  const setAppConfigIfChanged = useCallback((config: PublicAppConfig): boolean => {
    const nextKey = buildPublicAppConfigRenderKey(config);
    if (nextKey === appConfigRenderKeyRef.current) {
      return false;
    }

    appConfigRenderKeyRef.current = nextKey;
    setAppConfig(config);
    return true;
  }, []);

  const refreshPublicConfigInBackground = useCallback(async (): Promise<boolean> => {
    if (publicConfigRefreshInFlightRef.current) {
      return publicConfigRefreshInFlightRef.current;
    }

    const refreshPromise = (async () => {
      publicConfigLastAttemptAtRef.current = Date.now();
      const config = await refreshPublicAppConfigStrict();
      if (!config) {
        publicConfigRefreshFailureCountRef.current += 1;
        return false;
      }

      publicConfigRefreshFailureCountRef.current = 0;
      return setAppConfigIfChanged(config);
    })().finally(() => {
      publicConfigRefreshInFlightRef.current = null;
    });

    publicConfigRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [setAppConfigIfChanged]);

  const refreshAppConfig = useCallback(async () => {
    await refreshPublicConfigInBackground();
  }, [refreshPublicConfigInBackground]);

  // 防止 React 19 Strict Mode 下重复初始化
  const authInitRef = useRef(false);

  // Auth state - 使用 useShallow 合并多个状态
  const {
    user,
    profile,
    offlineMode,
    offlineUser,
    isInitialized: authInitialized,
  } = useAuthStore(
    useShallow((s) => ({
      user: s.user,
      profile: s.profile,
      offlineMode: s.offlineMode,
      offlineUser: s.offlineUser,
      isInitialized: s.isInitialized,
    }))
  );
  const initializeAuth = useAuthStore((s) => s.initialize);
  const enterOfflineMode = useAuthStore((s) => s.enterOfflineMode);
  const signOut = useAuthStore((s) => s.signOut);
  const setPublicTableSessionUser = usePublicTableStore((s) => s.setSessionUser);
  const publicTableSessionUserId = user && profile && !offlineMode ? user.id : null;

  useLayoutEffect(() => {
    setPublicTableSessionUser(publicTableSessionUserId);
  }, [publicTableSessionUserId, setPublicTableSessionUser]);

  // Game state
  const matchView = useGameStore((s) => s.getMatchView());
  const capabilities = useGameStore(useShallow((s) => s.getBattleSurfaceCapabilities()));
  const loadCardData = useGameStore((s) => s.loadCardData);
  const leaveCurrentGame = useGameStore((s) => s.leaveCurrentGame);
  const restartCurrentGame = useGameStore((s) => s.restartCurrentGame);
  const connectRemoteSession = useGameStore((s) => s.connectRemoteSession);
  const applyRemoteSnapshot = useGameStore((s) => s.applyRemoteSnapshot);
  const remoteSession = useGameStore((s) => s.remoteSession);
  const syncRemoteState = useGameStore((s) => s.syncRemoteState);
  const initDeckStore = useDeckStore((s) => s.init);
  const [gameBriefingAcknowledged, setGameBriefingAcknowledged] = useState(false);
  const [isLeaveCurrentGameConfirmOpen, setIsLeaveCurrentGameConfirmOpen] = useState(false);
  const [isLeavingCurrentGame, setIsLeavingCurrentGame] = useState(false);
  const [leaveCurrentGameError, setLeaveCurrentGameError] = useState<string | null>(null);
  const [isRestartCurrentGameConfirmOpen, setIsRestartCurrentGameConfirmOpen] = useState(false);
  const [isRestartingCurrentGame, setIsRestartingCurrentGame] = useState(false);
  const [isOnlineRoomImmersive, setIsOnlineRoomImmersive] = useState(false);
  const [isOnlineDebugImmersive, setIsOnlineDebugImmersive] = useState(false);
  const [isRestartingAiBattle, setIsRestartingAiBattle] = useState(false);
  const [isReturningFromAiBattle, setIsReturningFromAiBattle] = useState(false);
  const [aiBattleEndError, setAiBattleEndError] = useState<string | null>(null);
  const gameBriefingKeyRef = useRef<string | null>(null);
  const solitaireRestoreAttemptedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    loadPublicAppConfig()
      .then((config) => {
        if (!cancelled) {
          setAppConfigIfChanged(config);
        }
      })
      .catch((configError) => {
        if (import.meta.env.DEV) {
          console.warn('[App] 公开配置加载失败，使用默认配置:', configError);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setConfigInitialized(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setAppConfigIfChanged]);

  useEffect(() => {
    if (!configInitialized) {
      return;
    }

    let disposed = false;
    let timeoutId: number | null = null;

    const clearScheduledRefresh = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const scheduleNextRefresh = () => {
      if (disposed) {
        return;
      }

      const delay = getPublicConfigRefreshDelay(publicConfigRefreshFailureCountRef.current);
      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        if (document.visibilityState === 'hidden') {
          scheduleNextRefresh();
          return;
        }

        void refreshPublicConfigInBackground().finally(scheduleNextRefresh);
      }, delay);
    };

    const requestVisibleRefresh = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      void refreshPublicConfigInBackground();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        requestVisibleRefresh();
      }
    };

    const handleFocus = () => {
      const now = Date.now();
      if (!shouldRunFocusPublicConfigRefresh(publicConfigLastAttemptAtRef.current, now)) {
        return;
      }

      requestVisibleRefresh();
    };

    scheduleNextRefresh();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      disposed = true;
      clearScheduledRefresh();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [configInitialized, refreshPublicConfigInBackground]);

  useEffect(() => {
    if (!configInitialized || authInitRef.current) return;
    authInitRef.current = true;

    initializeAuth();
  }, [configInitialized, initializeAuth]);

  // 初始化卡牌数据 - 只从数据库加载
  useEffect(() => {
    if (!authInitialized) return;

    if (
      authPage === 'reset-password' ||
      authPage === 'verify-email' ||
      authPage === 'verify-email-change'
    ) {
      return;
    }

    const init = async () => {
      try {
        // 从数据库加载已上线的卡牌数据（仅 PUBLISHED）
        const cards = await cardService.getAllCards(true, 'PUBLISHED');

        // 图片映射暂时为空（后续可从数据库或 CDN 获取）
        const imageMap = new Map<string, string>();

        loadCardData(cards, imageMap);
        initDeckStore();
        setError(null);
        setIsLoading(false);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[App] 卡牌 API 不可用，已进入本地测试降级模式:', err);
          loadCardData([]);
          initDeckStore();
        } else {
          console.error('[App] 卡牌数据加载失败:', err);
          setError(err instanceof Error ? err.message : '未知错误');
        }
        setIsLoading(false);
      }
    };

    init();
  }, [authInitialized, authPage, loadCardData, initDeckStore]);

  // 计算实际显示的页面（游戏结束后自动回到首页）
  const effectivePage: AppPage = currentPage === 'game' && !matchView ? 'home' : currentPage;
  const gameBriefingKey = matchView ? `${capabilities.surface}:${matchView.matchId}` : null;
  const currentGameLeaveConfirmCopy =
    capabilities.surface === 'SOLITAIRE'
      ? getSolitaireLeaveConfirmCopy()
      : capabilities.surface === 'AI_BATTLE'
        ? getAiBattleLeaveConfirmCopy()
        : null;
  const currentGameRestartCopy =
    capabilities.surface === 'SOLITAIRE'
      ? {
          title: '重开对局？',
          message: '当前对局会结束并立即重开。',
          confirmLabel: '确认重开',
        }
      : capabilities.surface === 'LOCAL_DEBUG'
        ? {
            title: '重开对局？',
            message: '当前对局进度会被清空并立即重开。',
            confirmLabel: '确认重开',
          }
        : null;
  const isAuthenticated = !!(user && profile) || (offlineMode && !!offlineUser);
  const shareMatch = window.location.pathname.match(/^\/decks\/share\/([^/]+)$/);
  const shareId = shareMatch?.[1] ?? null;
  const spectatorMatch = window.location.pathname.match(/^\/online\/spectate\/([^/]+)$/);
  const spectatorToken = spectatorMatch?.[1] ? decodeURIComponent(spectatorMatch[1]) : null;
  const spectatorLobbyRequested =
    window.location.pathname.replace(/\/+$/, '') === '/online/spectate';
  const shareLoginRequested = new URLSearchParams(window.location.search).get('login') === '1';
  const initialOpenDeckId = new URLSearchParams(window.location.search).get('openDeckId');
  const emailFeature = appConfig.features.email;

  useEffect(() => {
    if (!gameBriefingKey) {
      gameBriefingKeyRef.current = null;
      return;
    }

    if (gameBriefingKeyRef.current === gameBriefingKey) {
      return;
    }

    gameBriefingKeyRef.current = gameBriefingKey;
    setGameBriefingAcknowledged(false);
  }, [gameBriefingKey]);

  useEffect(() => {
    if (currentPage !== 'game' || remoteSession?.source !== 'AI_BATTLE') {
      return;
    }

    const scheduler = createAiBattlePollingScheduler({
      syncRemoteState,
      onError: (syncError) => {
        if (import.meta.env.DEV) {
          console.warn('[App] AI 对局状态同步失败，将继续重试:', syncError);
        }
      },
    });
    scheduler.start();
    return () => scheduler.dispose();
  }, [currentPage, remoteSession?.matchId, remoteSession?.source, syncRemoteState]);

  useEffect(() => {
    if (solitaireRestoreAttemptedRef.current) {
      return;
    }

    if (!configInitialized || !authInitialized || isLoading || error) {
      return;
    }

    if (
      authPage === 'reset-password' ||
      authPage === 'verify-email' ||
      authPage === 'verify-email-change'
    ) {
      return;
    }

    if (!user || !profile || offlineMode || shareId || spectatorToken) {
      return;
    }

    const gameStoreState = useGameStore.getState();
    if (gameStoreState.getMatchView() || gameStoreState.remoteSession) {
      return;
    }

    const storedAiMatchId = readStoredAiBattleMatchId();
    const storedSolitaireMatchId = readStoredSolitaireMatchId();
    if (!storedAiMatchId && !storedSolitaireMatchId) {
      solitaireRestoreAttemptedRef.current = true;
      return;
    }

    solitaireRestoreAttemptedRef.current = true;
    let cancelled = false;

    const restoreRemoteMatch = async () => {
      try {
        if (storedAiMatchId) {
          const battle = await fetchAiBattle(storedAiMatchId);
          if (cancelled) return;
          connectRemoteSession({
            source: 'AI_BATTLE',
            matchId: battle.matchId,
            seat: battle.humanSeat,
            playerId: battle.snapshot.playerId,
          });
          await applyRemoteSnapshot(battle.snapshot);
          if (!cancelled) setCurrentPage('game');
          return;
        }

        const snapshot = await fetchSolitaireMatchSnapshot(storedSolitaireMatchId!);
        if (!snapshot) {
          clearStoredSolitaireMatchId(storedSolitaireMatchId!);
          return;
        }

        if (cancelled) {
          return;
        }

        connectRemoteSession({
          source: 'SOLITAIRE',
          matchId: snapshot.matchId,
          seat: snapshot.seat,
          playerId: snapshot.playerId,
        });
        await applyRemoteSnapshot(snapshot);

        if (!cancelled) {
          setCurrentPage('game');
        }
      } catch (restoreError) {
        if (
          storedAiMatchId &&
          restoreError instanceof ApiClientError &&
          (restoreError.status === 404 || restoreError.code === 'AI_BATTLE_NOT_FOUND')
        ) {
          clearStoredAiBattleMatchId(storedAiMatchId);
        }
        if (import.meta.env.DEV) {
          console.warn('[App] 远程测试对局刷新恢复失败:', restoreError);
        }
      }
    };

    void restoreRemoteMatch();

    return () => {
      cancelled = true;
      // React StrictMode 会在开发环境中挂载、清理后再挂载一次。
      // 清理未完成的恢复任务时必须允许下一次挂载重新发起恢复。
      solitaireRestoreAttemptedRef.current = false;
    };
  }, [
    applyRemoteSnapshot,
    authInitialized,
    authPage,
    configInitialized,
    connectRemoteSession,
    error,
    isLoading,
    offlineMode,
    profile,
    shareId,
    spectatorToken,
    user,
  ]);

  // 等待认证初始化
  if (!configInitialized || !authInitialized) {
    return (
      <div className="app-shell h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--accent-primary)] border-t-transparent" />
          <p className="text-sm text-[var(--text-secondary)]">初始化中...</p>
        </div>
      </div>
    );
  }

  // 公开首页与认证表单不依赖完整卡池；卡牌数据在后台加载，避免用整页启动屏
  // 阻断访客入口。共享卡组、观战和已登录工作区仍等待卡池准备完成。
  if (isLoading && (isAuthenticated || shareId || spectatorToken || spectatorLobbyRequested)) {
    return (
      <div className="app-shell h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--accent-primary)] border-t-transparent" />
          <p className="text-sm text-[var(--text-secondary)]">加载卡牌数据...</p>
        </div>
      </div>
    );
  }

  // 已进入账户/离线会话后仍保持原有启动失败边界；公开首页可以在卡牌 API
  // 暂时不可用时继续展示，并把状态降级到相关操作附近。
  if (error && isAuthenticated) {
    return <StartupErrorPage error={error} siteStatus={appConfig.siteStatus} />;
  }

  // 未登录且不是离线模式，显示登录/注册页面
  const switchToLogin = () => {
    setAuthPage('login');
    setAuthToken(null);
    setIsLoading(true);
    if (
      window.location.pathname === '/verify-email' ||
      window.location.pathname === '/verify-email-change' ||
      window.location.pathname === '/reset-password'
    ) {
      window.history.replaceState(null, '', '/');
    }
  };

  // 密码重置页面需要特殊处理：用户通过邮件链接进入时应显示重置页面
  if (authPage === 'reset-password') {
    return <ResetPasswordPage token={authToken} onSwitchToLogin={switchToLogin} />;
  }

  if (authPage === 'verify-email') {
    return <VerifyEmailPage token={authToken} onSwitchToLogin={switchToLogin} />;
  }

  if (authPage === 'verify-email-change') {
    return (
      <VerifyEmailPage purpose="email-change" token={authToken} onSwitchToLogin={switchToLogin} />
    );
  }

  if (shareId && (isAuthenticated || !shareLoginRequested)) {
    return (
      <SharedDeckPage
        shareId={shareId}
        onBackHome={() => {
          window.location.href = '/';
        }}
        onRequestLogin={() => {
          window.location.href = `/decks/share/${encodeURIComponent(shareId)}?login=1`;
        }}
      />
    );
  }

  if (spectatorToken) {
    return (
      <OnlineSpectatorPage
        token={spectatorToken}
        onBackHome={() => {
          window.location.href = '/';
        }}
      />
    );
  }

  if (spectatorLobbyRequested) {
    return (
      <OnlineSpectatorLobbyPage
        onBackHome={() => {
          window.location.href = '/';
        }}
      />
    );
  }

  if (!isAuthenticated) {
    const visibleAuthPage = shareLoginRequested && authPage === 'landing' ? 'login' : authPage;
    const loginSubtitle =
      currentPage === 'deck-manager'
        ? '登录后继续构筑与管理云端卡组。'
        : currentPage === 'game-setup'
          ? '登录后继续选择对战方式和本次使用的卡组。'
          : '登录账号，进入你的 Loveca 大厅。';
    const returnToLanding = () => {
      setCurrentPage('home');
      setAuthPage('landing');
    };

    switch (visibleAuthPage) {
      case 'landing':
        return (
          <PublicHomePage
            onLogin={() => {
              setCurrentPage('home');
              setAuthPage('login');
            }}
            onRegister={() => {
              setCurrentPage('home');
              setAuthPage('register');
            }}
            onManageDecks={() => {
              setCurrentPage('deck-manager');
              setAuthPage('login');
            }}
            onStartGame={() => {
              setCurrentPage('game-setup');
              setAuthPage('login');
            }}
            onSpectate={() => {
              window.location.href = '/online/spectate';
            }}
            onTryOffline={() => {
              setCurrentPage('game-setup');
              setError(null);
              enterOfflineMode('Guest');
            }}
            serviceAvailable={!error}
            siteStatus={appConfig.siteStatus}
          />
        );
      case 'register':
        return (
          <RegisterPage
            emailVerificationRequired={emailFeature.verificationRequired}
            onSwitchToLogin={() => setAuthPage('login')}
            onBackHome={returnToLanding}
          />
        );
      case 'forgot-password':
        if (!emailFeature.passwordResetEnabled)
          return (
            <LoginPage
              passwordResetEnabled={emailFeature.passwordResetEnabled}
              onSwitchToRegister={() => setAuthPage('register')}
              onSwitchToForgotPassword={() => setAuthPage('forgot-password')}
              onBackHome={returnToLanding}
              subtitle={loginSubtitle}
              offlineModeDisabled={currentPage === 'deck-manager'}
            />
          );
        return <ForgotPasswordPage onSwitchToLogin={() => setAuthPage('login')} />;
      default:
        return (
          <LoginPage
            passwordResetEnabled={emailFeature.passwordResetEnabled}
            onSwitchToRegister={() => setAuthPage('register')}
            onSwitchToForgotPassword={() => setAuthPage('forgot-password')}
            onBackHome={returnToLanding}
            subtitle={loginSubtitle}
            offlineModeDisabled={currentPage === 'deck-manager'}
          />
        );
    }
  }

  const withPublicTableLayer = (content: ReactNode) => (
    <>
      {content}
      <PublicTableGlobalLayer
        enabled={Boolean(user && profile && !offlineMode)}
        userId={publicTableSessionUserId}
        onEnterRoom={enterOnlineRoom}
      />
      <RankedGlobalLayer
        enabled={Boolean(user && profile && !offlineMode)}
        showWaitingNotice={effectivePage !== 'ranked'}
        onEnterRoom={enterOnlineRoom}
      />
    </>
  );

  const productNavigation: ProductNavigationHandlers = {
    onHome: () => setCurrentPage('home'),
    onDecks: () => setCurrentPage('deck-manager'),
    onBattle: () => setCurrentPage('game-setup'),
    onSpectate: () => setCurrentPage('online-spectator'),
    onHistory: () => setCurrentPage('match-records'),
  };
  const handleSignOut = () => {
    void signOut().finally(() => {
      setCurrentPage('home');
      setAuthPage('landing');
    });
  };
  const handleAbandonSavedRoomForLocalGame = async () => {
    const roomCode = window.sessionStorage.getItem('loveca.online.room');
    if (roomCode) {
      await abandonOnlineRoomForLocalGame(roomCode);
      window.sessionStorage.removeItem('loveca.online.room');
      await Promise.allSettled([
        usePublicTableStore.getState().refresh(),
        useRankedStore.getState().refresh(),
      ]);
    }
    setCurrentPage('game-setup');
  };
  const authenticatedHeaderActions = (
    <>
      <AnnouncementCenterButton siteStatus={appConfig.siteStatus} />
      <ThemeToggle />
      {profile ? (
        <button
          type="button"
          onClick={() => setCurrentPage('account')}
          className="button-icon !hidden md:!inline-flex"
          title="账户"
          aria-label="账户"
        >
          <UserRound size={16} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={handleSignOut}
        className="button-ghost !hidden min-h-10 items-center gap-2 px-3 text-sm md:!inline-flex"
        title="退出登录"
        aria-label="退出登录"
      >
        <LogOut size={16} />
        <span className="hidden lg:inline">退出登录</span>
      </button>
    </>
  );
  const authenticatedMobileMenuActions = (
    <div className="grid grid-cols-2 gap-2">
      {profile ? (
        <button
          type="button"
          onClick={() => setCurrentPage('account')}
          className="button-secondary min-h-11 px-3 text-sm font-semibold"
        >
          账户
        </button>
      ) : (
        <div />
      )}
      <button
        type="button"
        onClick={handleSignOut}
        className="button-secondary min-h-11 px-3 text-sm font-semibold"
      >
        退出登录
      </button>
    </div>
  );
  const withProductFrame = (
    content: ReactNode,
    active: ProductNavKey | null,
    immersive = false
  ) =>
    withPublicTableLayer(
      <ProductFrame
        active={active}
        navigation={productNavigation}
        actions={authenticatedHeaderActions}
        mobileMenuActions={authenticatedMobileMenuActions}
        immersive={immersive}
      >
        {content}
      </ProductFrame>
    );

  // 游戏进行中
  if (effectivePage === 'game' && matchView) {
    const gameBriefingMode =
      capabilities.surface === 'SOLITAIRE'
        ? 'solitaire'
        : capabilities.surface === 'AI_BATTLE'
          ? 'ai-battle'
          : null;
    const leaveDestination = capabilities.surface === 'AI_BATTLE' ? 'ai-battle' : 'game-setup';

    return withPublicTableLayer(
      <BattleViewportShell>
        <GameBoard
          onRestartGame={
            currentGameRestartCopy
              ? () => {
                  setIsRestartCurrentGameConfirmOpen(true);
                }
              : undefined
          }
          onLeaveLocalGame={() => {
            if (currentGameLeaveConfirmCopy) {
              setLeaveCurrentGameError(null);
              setIsLeaveCurrentGameConfirmOpen(true);
              return;
            }

            void leaveCurrentGame().finally(() => {
              setCurrentPage(leaveDestination);
            });
          }}
        />
        {gameBriefingMode && !matchView.endInfo && (
          <PreMatchBriefingModal
            isOpen={!gameBriefingAcknowledged}
            mode={gameBriefingMode}
            onClose={() => setGameBriefingAcknowledged(true)}
          />
        )}
        {capabilities.surface === 'AI_BATTLE' && matchView.endInfo && matchView.viewerSeat && (
          <AiBattleEndPanel
            endInfo={matchView.endInfo}
            viewerSeat={matchView.viewerSeat}
            isRestarting={isRestartingAiBattle}
            isReturning={isReturningFromAiBattle}
            error={aiBattleEndError}
            onRestart={() => {
              setIsRestartingAiBattle(true);
              setAiBattleEndError(null);
              void restartAiBattle(matchView.matchId)
                .then(async (battle) => {
                  storeAiBattleMatchId(battle.matchId);
                  connectRemoteSession({
                    source: 'AI_BATTLE',
                    matchId: battle.matchId,
                    seat: battle.humanSeat,
                    playerId: battle.snapshot.playerId,
                  });
                  await applyRemoteSnapshot(battle.snapshot);
                })
                .catch((restartError) => {
                  setAiBattleEndError(
                    restartError instanceof Error ? restartError.message : '重新开始 AI 对局失败'
                  );
                })
                .finally(() => {
                  setIsRestartingAiBattle(false);
                });
            }}
            onReturn={() => {
              setIsReturningFromAiBattle(true);
              setAiBattleEndError(null);
              void leaveCurrentGame()
                .then(() => {
                  setCurrentPage('ai-battle');
                })
                .catch((leaveError) => {
                  setAiBattleEndError(
                    leaveError instanceof Error ? leaveError.message : '返回 AI 对战入口失败'
                  );
                })
                .finally(() => {
                  setIsReturningFromAiBattle(false);
                });
            }}
          />
        )}
        {currentGameLeaveConfirmCopy && (
          <ConfirmDialog
            isOpen={isLeaveCurrentGameConfirmOpen}
            title={currentGameLeaveConfirmCopy.title}
            message={
              leaveCurrentGameError
                ? `${currentGameLeaveConfirmCopy.message} 上次尝试失败：${leaveCurrentGameError}`
                : currentGameLeaveConfirmCopy.message
            }
            confirmLabel={currentGameLeaveConfirmCopy.confirmLabel}
            isConfirming={isLeavingCurrentGame}
            onCancel={() => {
              setLeaveCurrentGameError(null);
              setIsLeaveCurrentGameConfirmOpen(false);
            }}
            onConfirm={() => {
              setIsLeavingCurrentGame(true);
              setLeaveCurrentGameError(null);
              void leaveCurrentGame()
                .then(() => {
                  setIsLeaveCurrentGameConfirmOpen(false);
                  setCurrentPage(leaveDestination);
                })
                .catch((leaveError) => {
                  setLeaveCurrentGameError(
                    leaveError instanceof Error ? leaveError.message : '暂时无法离开当前对局'
                  );
                })
                .finally(() => {
                  setIsLeavingCurrentGame(false);
                });
            }}
          />
        )}
        {currentGameRestartCopy && (
          <ConfirmDialog
            isOpen={isRestartCurrentGameConfirmOpen}
            title={currentGameRestartCopy.title}
            message={currentGameRestartCopy.message}
            confirmLabel={currentGameRestartCopy.confirmLabel}
            isConfirming={isRestartingCurrentGame}
            onCancel={() => setIsRestartCurrentGameConfirmOpen(false)}
            onConfirm={() => {
              setIsRestartingCurrentGame(true);
              void restartCurrentGame().then((result) => {
                setIsRestartingCurrentGame(false);
                if (result.success) {
                  setIsRestartCurrentGameConfirmOpen(false);
                }
              });
            }}
          />
        )}
      </BattleViewportShell>
    );
  }

  // 对局准备页面
  if (effectivePage === 'game-setup') {
    return withPublicTableLayer(
      <GameSetupPage
        navigation={productNavigation}
        headerActions={authenticatedHeaderActions}
        mobileMenuActions={authenticatedMobileMenuActions}
        onBack={() => setCurrentPage('home')}
        onGameStart={() => setCurrentPage('game')}
        onNavigateToOnlineRoom={() => setCurrentPage('online-room')}
        onNavigateToPublicTable={() => setCurrentPage('public-table')}
        onNavigateToRanked={() => setCurrentPage('ranked')}
      />
    );
  }

  if (effectivePage === 'online-room') {
    return withProductFrame(
      <OnlineRoomPage
        onBack={() => setCurrentPage('home')}
        onImmersiveModeChange={setIsOnlineRoomImmersive}
      />,
      'battle',
      isOnlineRoomImmersive
    );
  }

  if (effectivePage === 'public-table' && publicTableSessionUserId) {
    return withProductFrame(
      <PublicTablePage
        userId={publicTableSessionUserId}
        onBack={() => setCurrentPage('home')}
        onEnterRoom={enterOnlineRoom}
      />,
      'battle'
    );
  }

  if (effectivePage === 'ranked') {
    return withProductFrame(
      <RankedPage onBack={() => setCurrentPage('home')} onEnterRoom={enterOnlineRoom} />,
      'battle'
    );
  }

  if (effectivePage === 'online-spectator') {
    return withPublicTableLayer(
      <OnlineSpectatorLobbyPage
        navigation={productNavigation}
        headerActions={authenticatedHeaderActions}
        mobileMenuActions={authenticatedMobileMenuActions}
        onBackHome={() => setCurrentPage('home')}
      />
    );
  }

  if (effectivePage === 'ai-battle') {
    return withPublicTableLayer(
      <AiBattlePage
        onBack={() => setCurrentPage('home')}
        onGameStart={() => setCurrentPage('game')}
      />
    );
  }

  if (effectivePage === 'match-records') {
    return withProductFrame(<MatchRecordsPage onBack={() => setCurrentPage('home')} />, 'history');
  }

  if (effectivePage === 'online-debug') {
    return withProductFrame(
      <OnlineDebugPage
        onBack={() => setCurrentPage('home')}
        onImmersiveModeChange={setIsOnlineDebugImmersive}
      />,
      'battle',
      isOnlineDebugImmersive
    );
  }

  // 卡组管理页面
  if (effectivePage === 'deck-manager') {
    return withProductFrame(
      <DeckManager onBack={() => setCurrentPage('home')} initialOpenDeckId={initialOpenDeckId} />,
      'decks'
    );
  }

  if (effectivePage === 'account' && user && profile && !offlineMode) {
    return withProductFrame(
      <AccountCenterPage
        emailChangeEnabled={emailFeature.enabled}
        onBack={() => setCurrentPage('home')}
      />,
      null
    );
  }

  // 卡牌管理页面
  if (effectivePage === 'card-admin' && profile?.role === 'admin') {
    return withProductFrame(<CardAdminPage onBack={() => setCurrentPage('home')} />, null);
  }

  if (effectivePage === 'online-admin' && profile?.role === 'admin') {
    return withProductFrame(<OnlineRoomsAdminPage onBack={() => setCurrentPage('home')} />, null);
  }

  if (effectivePage === 'announcement-admin' && profile?.role === 'admin') {
    return withProductFrame(
      <SiteAnnouncementsAdminPage
        onBack={() => setCurrentPage('home')}
        siteStatus={appConfig.siteStatus}
        onSiteStatusChanged={refreshAppConfig}
      />,
      null
    );
  }

  if (effectivePage === 'ranked-admin' && profile?.role === 'admin') {
    return withProductFrame(<RankedAdminPage onBack={() => setCurrentPage('home')} />, null);
  }

  // 主页
  return withPublicTableLayer(
    <HomePage
      navigation={productNavigation}
      headerActions={authenticatedHeaderActions}
      mobileMenuActions={authenticatedMobileMenuActions}
      onNavigateToDeckManager={() => setCurrentPage('deck-manager')}
      onNavigateToGameSetup={() => setCurrentPage('game-setup')}
      onAbandonSavedRoomForLocalGame={handleAbandonSavedRoomForLocalGame}
      onNavigateToOnlineRoom={() => setCurrentPage('online-room')}
      onNavigateToRanked={() => setCurrentPage('ranked')}
      onNavigateToOnlineSpectator={() => setCurrentPage('online-spectator')}
      onNavigateToAiBattle={() => setCurrentPage('ai-battle')}
      onNavigateToMatchRecords={() => setCurrentPage('match-records')}
      onNavigateToOnlineDebug={() => setCurrentPage('online-debug')}
      onNavigateToCardAdmin={() => setCurrentPage('card-admin')}
      onNavigateToOnlineAdmin={() => setCurrentPage('online-admin')}
      onNavigateToAnnouncementAdmin={() => setCurrentPage('announcement-admin')}
      onNavigateToRankedAdmin={() => setCurrentPage('ranked-admin')}
      siteStatus={appConfig.siteStatus}
    />
  );
}

function StartupErrorPage({ error, siteStatus }: { error: string; siteStatus: PublicSiteStatus }) {
  const errorLines = error.split('\n');
  const maintenance = siteStatus.maintenance;
  const visibleMaintenance =
    maintenance &&
    (siteStatus.lifecycle === 'MAINTENANCE' ||
      siteStatus.lifecycle === 'RESTRICTING_NEW_GAMES' ||
      siteStatus.lifecycle === 'SCHEDULED')
      ? maintenance
      : null;

  return (
    <div className="app-shell flex min-h-screen items-center justify-center p-4">
      <div className="surface-panel w-full max-w-2xl p-6 text-center">
        {visibleMaintenance ? (
          <div className="mb-4 rounded-lg border border-[color:var(--semantic-warning)]/45 bg-[color:var(--semantic-warning)]/10 p-4 text-left">
            <div className="text-sm font-bold text-[var(--text-primary)]">
              {SITE_STATUS_LABELS[siteStatus.lifecycle]}：{visibleMaintenance.title}
            </div>
            <div className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
              {visibleMaintenance.summary}
            </div>
            {visibleMaintenance.startsAt || visibleMaintenance.estimatedEndsAt ? (
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                {visibleMaintenance.startsAt ? (
                  <span>开始 {formatStartupDateTime(visibleMaintenance.startsAt)}</span>
                ) : null}
                {visibleMaintenance.estimatedEndsAt ? (
                  <span>预计结束 {formatStartupDateTime(visibleMaintenance.estimatedEndsAt)}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <h2 className="mb-4 text-xl font-bold text-[var(--semantic-error)]">服务暂时不可用</h2>
        <div className="mb-4 max-h-96 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
          {errorLines.length > 1 ? (
            <ul className="space-y-2 text-left text-sm text-[var(--semantic-error)]">
              {errorLines.map((line, index) => (
                <li key={index} className="break-all">
                  • {line}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--semantic-error)]">{error}</p>
          )}
        </div>
        <button onClick={() => window.location.reload()} className="button-primary px-4 py-2">
          重新加载
        </button>
      </div>
    </div>
  );
}

const SITE_STATUS_LABELS: Record<SiteStatusLifecycle, string> = {
  NORMAL: '正常',
  SCHEDULED: '计划维护',
  RESTRICTING_NEW_GAMES: '限制新开局',
  MAINTENANCE: '维护中',
  COMPLETED: '已完成',
  POSTPONED: '已延期',
  CANCELLED: '已取消',
};

function formatStartupDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export default App;
