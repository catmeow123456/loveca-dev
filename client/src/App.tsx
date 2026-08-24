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
import { ServiceStatusPage } from '@/components/pages/ServiceStatusPage';
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
import { getSolitaireLeaveConfirmCopy } from '@/lib/leaveConfirmCopy';
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
import { useGameStore } from '@/store/gameStore';
import { useDeckStore } from '@/store/deckStore';
import { useAuthStore } from '@/store/authStore';
import { usePublicTableStore } from '@/store/publicTableStore';
import { useRankedStore } from '@/store/rankedStore';
import { usePlayerWallpaperStore } from '@/store/playerWallpaperStore';
import { useThemeTableStore } from '@/store/themeTableStore';
import { cardService } from '@/lib/cardService';
import { PublicTableGlobalLayer } from '@/components/public-table/PublicTableGlobalLayer';
import { RankedGlobalLayer } from '@/components/ranked/RankedGlobalLayer';
import { ThemeTableGlobalLayer } from '@/components/theme-table/ThemeTableGlobalLayer';
import { hasAnyManagementPermission, hasPermission } from '@game/shared/auth/permissions';
import type { DeckClassifierTemplateImportSource } from '@/components/admin/DeckClassifierAdminPage';
import { AUTHORIZATION_STALE_EVENT } from '@/lib/apiClient';
import {
  loadPublicSiteStatusSnapshot,
  type PublicSiteStatusSnapshotResult,
} from '@/lib/publicSiteStatusSnapshot';

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
const ThemeTablePage = lazy(() =>
  import('@/components/pages/ThemeTablePage').then((module) => ({
    default: module.ThemeTablePage,
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
const SharedDeckPage = lazy(() =>
  import('@/components/pages/SharedDeckPage').then((module) => ({ default: module.SharedDeckPage }))
);
const AccountCenterPage = lazy(() =>
  import('@/components/pages/AccountCenterPage').then((module) => ({
    default: module.AccountCenterPage,
  }))
);
const CardAdminPage = lazy(() => import('@/components/admin/CardAdminPage'));
const CardSyncAdminPage = lazy(() =>
  import('@/components/admin/CardSyncAdminPage').then((module) => ({
    default: module.CardSyncAdminPage,
  }))
);
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
const DeckClassifierAdminPage = lazy(() =>
  import('@/components/admin/DeckClassifierAdminPage').then((module) => ({
    default: module.DeckClassifierAdminPage,
  }))
);
const DeckPointTablesAdminPage = lazy(() =>
  import('@/components/admin/DeckPointTablesAdminPage').then((module) => ({
    default: module.DeckPointTablesAdminPage,
  }))
);
const MatchEmotesAdminPage = lazy(() =>
  import('@/components/admin/MatchEmotesAdminPage').then((module) => ({
    default: module.MatchEmotesAdminPage,
  }))
);
const AdminCenterPage = lazy(() =>
  import('@/components/admin/AdminCenterPage').then((module) => ({
    default: module.AdminCenterPage,
  }))
);
const AiEffectExtractionAdminPage = lazy(() =>
  import('@/components/admin/AiEffectExtractionAdminPage').then((module) => ({
    default: module.AiEffectExtractionAdminPage,
  }))
);
const ThemeTableAdminPage = lazy(() =>
  import('@/components/admin/ThemeTableAdminPage').then((module) => ({
    default: module.ThemeTableAdminPage,
  }))
);
const UserAdminPage = lazy(() =>
  import('@/components/admin/UserAdminPage').then((module) => ({
    default: module.UserAdminPage,
  }))
);
const PlatformOperationsPage = lazy(() =>
  import('@/components/admin/PlatformOperationsPage').then((module) => ({
    default: module.PlatformOperationsPage,
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
  | 'theme-table'
  | 'online-spectator'
  | 'match-records'
  | 'online-debug'
  | 'game'
  | 'admin-center'
  | 'card-admin'
  | 'card-sync-admin'
  | 'ai-effect-admin'
  | 'online-admin'
  | 'announcement-admin'
  | 'ranked-admin'
  | 'deck-classifier-admin'
  | 'deck-point-admin'
  | 'match-emotes-admin'
  | 'theme-table-admin'
  | 'users-admin'
  | 'platform-operations-admin';

const CARD_DATA_INDEPENDENT_PAGES = new Set<AppPage>([
  'admin-center',
  'card-admin',
  'card-sync-admin',
  'ai-effect-admin',
  'online-admin',
  'announcement-admin',
  'ranked-admin',
  'deck-classifier-admin',
  'deck-point-admin',
  'match-emotes-admin',
  'users-admin',
  'platform-operations-admin',
]);

function pageRequiresRuntimeCardData(page: AppPage): boolean {
  return !CARD_DATA_INDEPENDENT_PAGES.has(page);
}

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
    page === 'theme-table' ||
    page === 'online-spectator' ||
    page === 'match-records' ||
    page === 'online-debug' ||
    page === 'game' ||
    page === 'admin-center' ||
    page === 'card-admin' ||
    page === 'card-sync-admin' ||
    page === 'ai-effect-admin' ||
    page === 'online-admin' ||
    page === 'announcement-admin' ||
    page === 'ranked-admin' ||
    page === 'deck-classifier-admin' ||
    page === 'deck-point-admin' ||
    page === 'match-emotes-admin' ||
    page === 'theme-table-admin' ||
    page === 'users-admin' ||
    page === 'platform-operations-admin' ||
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
  const [cardDataInitialized, setCardDataInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authPage, setAuthPage] = useState<AuthPage>(initialAuthRequest.page);
  const [authToken, setAuthToken] = useState<string | null>(initialAuthRequest.token);
  const [currentPage, setCurrentPage] = useState<AppPage>(getInitialPage);
  const [deckClassifierTemplateImport, setDeckClassifierTemplateImport] =
    useState<DeckClassifierTemplateImportSource | null>(null);
  const maintenanceAdminRequested =
    new URLSearchParams(window.location.search).get('maintenanceAdmin') === '1' &&
    currentPage === 'announcement-admin';
  const [deckManagerReturnPage, setDeckManagerReturnPage] = useState<'home' | 'game-setup'>('home');
  const openDeckManager = useCallback((returnPage: 'home' | 'game-setup' = 'home') => {
    setDeckManagerReturnPage(returnPage);
    setCurrentPage('deck-manager');
  }, []);
  const enterOnlineRoom = useCallback(async () => {
    // 匹配期间允许玩家继续进行对墙打。真人房间就绪后，先结束这个
    // 可恢复的对墙打会话，避免旧远程桌面和新房间同时占用当前视图。
    const currentGame = useGameStore.getState();
    if (currentGame.remoteSession?.source === 'SOLITAIRE') {
      await currentGame.leaveCurrentGame();
    }
    setCurrentPage('online-room');
  }, []);
  const [appConfig, setAppConfig] = useState<PublicAppConfig>(DEFAULT_APP_CONFIG);
  const [configInitialized, setConfigInitialized] = useState(false);
  const [configLoadFailed, setConfigLoadFailed] = useState(false);
  const [publicSnapshot, setPublicSnapshot] = useState<PublicSiteStatusSnapshotResult | null>(null);
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
    const [, snapshot] = await Promise.all([
      refreshPublicConfigInBackground(),
      loadPublicSiteStatusSnapshot(),
    ]);
    setPublicSnapshot(snapshot);
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
  const invalidateSession = useAuthStore((s) => s.invalidateSession);
  const setPublicTableSessionUser = usePublicTableStore((s) => s.setSessionUser);
  const setWallpaperSessionUser = usePlayerWallpaperStore((s) => s.setSessionUser);
  const publicTableSessionUserId = user && profile && !offlineMode ? user.id : null;

  useEffect(() => {
    const handleAuthorizationStale = () => {
      setCurrentPage('home');
      setAuthPage('login');
      invalidateSession('权限已变更，请重新登录');
    };
    window.addEventListener(AUTHORIZATION_STALE_EVENT, handleAuthorizationStale);
    return () => window.removeEventListener(AUTHORIZATION_STALE_EVENT, handleAuthorizationStale);
  }, [invalidateSession]);

  useLayoutEffect(() => {
    setPublicTableSessionUser(publicTableSessionUserId);
    setWallpaperSessionUser(publicTableSessionUserId);
  }, [publicTableSessionUserId, setPublicTableSessionUser, setWallpaperSessionUser]);

  // Game state
  const matchView = useGameStore((s) => s.getMatchView());
  const capabilities = useGameStore(useShallow((s) => s.getBattleSurfaceCapabilities()));
  const loadCardData = useGameStore((s) => s.loadCardData);
  const leaveCurrentGame = useGameStore((s) => s.leaveCurrentGame);
  const restartCurrentGame = useGameStore((s) => s.restartCurrentGame);
  const connectRemoteSession = useGameStore((s) => s.connectRemoteSession);
  const applyRemoteSnapshot = useGameStore((s) => s.applyRemoteSnapshot);
  const initDeckStore = useDeckStore((s) => s.init);
  const [gameBriefingAcknowledged, setGameBriefingAcknowledged] = useState(false);
  const [isLeaveCurrentGameConfirmOpen, setIsLeaveCurrentGameConfirmOpen] = useState(false);
  const [isLeavingCurrentGame, setIsLeavingCurrentGame] = useState(false);
  const [isRestartCurrentGameConfirmOpen, setIsRestartCurrentGameConfirmOpen] = useState(false);
  const [isRestartingCurrentGame, setIsRestartingCurrentGame] = useState(false);
  const [isOnlineRoomImmersive, setIsOnlineRoomImmersive] = useState(false);
  const [isOnlineDebugImmersive, setIsOnlineDebugImmersive] = useState(false);
  const gameBriefingKeyRef = useRef<string | null>(null);
  const solitaireRestoreAttemptedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    loadPublicAppConfig()
      .then((config) => {
        if (!cancelled) {
          setConfigLoadFailed(false);
          setAppConfigIfChanged(config);
        }
      })
      .catch((configError) => {
        if (!cancelled) {
          setConfigLoadFailed(true);
        }
        if (import.meta.env.DEV) {
          console.warn('[App] 公开配置加载失败:', configError);
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
    let cancelled = false;
    void loadPublicSiteStatusSnapshot().then((result) => {
      if (!cancelled) setPublicSnapshot(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (!configInitialized || !publicSnapshot || authInitRef.current) return;
    if (configLoadFailed || publicSnapshot.kind !== 'VALID') return;

    const maintenanceDetected =
      publicSnapshot.snapshot.availability === 'MAINTENANCE' ||
      appConfig.siteStatus.lifecycle === 'MAINTENANCE';
    if (maintenanceDetected && !maintenanceAdminRequested) return;

    authInitRef.current = true;

    initializeAuth();
  }, [
    appConfig.siteStatus.lifecycle,
    configInitialized,
    configLoadFailed,
    initializeAuth,
    maintenanceAdminRequested,
    publicSnapshot,
  ]);

  // 只在需要构筑或对局卡池的页面初始化卡牌数据。管理页使用自己的分页接口，
  // 不应被完整 PUBLISHED 卡池阻塞。
  useEffect(() => {
    if (!authInitialized) return;

    if (
      authPage === 'reset-password' ||
      authPage === 'verify-email' ||
      authPage === 'verify-email-change'
    ) {
      return;
    }

    if (!pageRequiresRuntimeCardData(currentPage)) {
      return;
    }

    if (cardDataInitialized) {
      return;
    }

    let cancelled = false;

    const init = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // 从数据库加载已上线的卡牌数据（仅 PUBLISHED）
        const cards = await cardService.getAllCards(true, 'PUBLISHED');

        // 图片映射暂时为空（后续可从数据库或 CDN 获取）
        const imageMap = new Map<string, string>();

        if (cancelled) return;
        loadCardData(cards, imageMap);
        initDeckStore();
        setCardDataInitialized(true);
        setError(null);
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (import.meta.env.DEV) {
          console.warn('[App] 卡牌 API 不可用，已进入本地测试降级模式:', err);
          loadCardData([]);
          initDeckStore();
          setCardDataInitialized(true);
        } else {
          console.error('[App] 卡牌数据加载失败:', err);
          setError(err instanceof Error ? err.message : '未知错误');
        }
        setIsLoading(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [authInitialized, authPage, cardDataInitialized, currentPage, loadCardData, initDeckStore]);

  // 计算实际显示的页面（游戏结束后自动回到首页）
  const effectivePage: AppPage = currentPage === 'game' && !matchView ? 'home' : currentPage;
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    document.querySelector<HTMLElement>('.product-frame-content')?.scrollTo({ top: 0, left: 0 });
  }, [effectivePage]);
  const gameBriefingKey = matchView ? `${capabilities.surface}:${matchView.matchId}` : null;
  const currentGameLeaveConfirmCopy =
    capabilities.surface === 'SOLITAIRE' ? getSolitaireLeaveConfirmCopy() : null;
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
    if (solitaireRestoreAttemptedRef.current) {
      return;
    }

    if (!configInitialized || !authInitialized || !cardDataInitialized || isLoading || error) {
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

    const storedMatchId = readStoredSolitaireMatchId();
    if (!storedMatchId) {
      solitaireRestoreAttemptedRef.current = true;
      return;
    }

    solitaireRestoreAttemptedRef.current = true;
    let cancelled = false;

    const restoreSolitaireMatch = async () => {
      try {
        const snapshot = await fetchSolitaireMatchSnapshot(storedMatchId);
        if (!snapshot) {
          clearStoredSolitaireMatchId(storedMatchId);
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
        if (import.meta.env.DEV) {
          console.warn('[App] 对墙打刷新恢复失败，将在下次刷新时重试:', restoreError);
        }
      }
    };

    void restoreSolitaireMatch();

    return () => {
      cancelled = true;
    };
  }, [
    applyRemoteSnapshot,
    authInitialized,
    authPage,
    cardDataInitialized,
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

  const maintenanceRecoveryAllowed =
    maintenanceAdminRequested &&
    (!authInitialized ||
      !isAuthenticated ||
      Boolean(profile && hasPermission(profile.role, 'platform.manage')));
  const snapshotMaintenance =
    publicSnapshot?.kind === 'VALID' && publicSnapshot.snapshot.availability === 'MAINTENANCE'
      ? publicSnapshot.snapshot.maintenance
      : null;
  const apiMaintenance =
    configInitialized && appConfig.siteStatus.lifecycle === 'MAINTENANCE'
      ? appConfig.siteStatus.maintenance
      : null;

  if (!maintenanceRecoveryAllowed && (snapshotMaintenance || apiMaintenance)) {
    return (
      <ServiceStatusPage kind="MAINTENANCE" maintenance={snapshotMaintenance ?? apiMaintenance} />
    );
  }

  if (
    configInitialized &&
    publicSnapshot &&
    (configLoadFailed || publicSnapshot.kind !== 'VALID')
  ) {
    return <ServiceStatusPage kind="UNAVAILABLE" />;
  }

  // 等待独立公开快照、公开配置与认证初始化。维护快照一旦读取成功会在上方立即接管页面。
  if (!publicSnapshot || !configInitialized || !authInitialized) {
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
  const currentPageRequiresCardData = pageRequiresRuntimeCardData(effectivePage);
  if (
    currentPageRequiresCardData &&
    !cardDataInitialized &&
    !error &&
    (isAuthenticated || shareId || spectatorToken || spectatorLobbyRequested)
  ) {
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
  if (error && isAuthenticated && currentPageRequiresCardData) {
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
        emoteCatalog={appConfig.matchEmotes}
        onEmoteCatalogStale={refreshAppConfig}
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
        ? '登录管理云端卡组，或进入离线模式把卡组保存在当前浏览器。'
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
              openDeckManager('home');
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
      <ThemeTableGlobalLayer
        enabled={Boolean(user && profile && !offlineMode)}
        showWaitingNotice={effectivePage !== 'theme-table'}
        onEnterRoom={enterOnlineRoom}
      />
    </>
  );

  const productNavigation: ProductNavigationHandlers = {
    onHome: () => setCurrentPage('home'),
    onDecks: () => openDeckManager(effectivePage === 'game-setup' ? 'game-setup' : 'home'),
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
        useThemeTableStore.getState().refresh(),
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
  const withProductFrame = (content: ReactNode, active: ProductNavKey | null, immersive = false) =>
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
    const gameBriefingMode = capabilities.surface === 'SOLITAIRE' ? 'solitaire' : null;

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
              setIsLeaveCurrentGameConfirmOpen(true);
              return;
            }

            void leaveCurrentGame().finally(() => {
              setCurrentPage('game-setup');
            });
          }}
        />
        {gameBriefingMode && (
          <PreMatchBriefingModal
            isOpen={!gameBriefingAcknowledged}
            mode={gameBriefingMode}
            onClose={() => setGameBriefingAcknowledged(true)}
          />
        )}
        {currentGameLeaveConfirmCopy && (
          <ConfirmDialog
            isOpen={isLeaveCurrentGameConfirmOpen}
            title={currentGameLeaveConfirmCopy.title}
            message={currentGameLeaveConfirmCopy.message}
            confirmLabel={currentGameLeaveConfirmCopy.confirmLabel}
            isConfirming={isLeavingCurrentGame}
            onCancel={() => setIsLeaveCurrentGameConfirmOpen(false)}
            onConfirm={() => {
              setIsLeavingCurrentGame(true);
              void leaveCurrentGame().finally(() => {
                setIsLeavingCurrentGame(false);
                setIsLeaveCurrentGameConfirmOpen(false);
                setCurrentPage('game-setup');
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
        onNavigateToThemeTable={() => setCurrentPage('theme-table')}
        onManageDecks={() => openDeckManager('game-setup')}
        battleEntryVisibility={appConfig.features.battleEntries}
      />
    );
  }

  if (effectivePage === 'online-room') {
    return withProductFrame(
      <OnlineRoomPage
        onBack={() => setCurrentPage('home')}
        onBackToThemeTable={() => setCurrentPage('theme-table')}
        onImmersiveModeChange={setIsOnlineRoomImmersive}
        emoteCatalog={appConfig.matchEmotes}
        battleTimeouts={appConfig.features.battleTimeouts}
        onEmoteCatalogStale={refreshAppConfig}
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
      <RankedPage
        onBack={() => setCurrentPage('home')}
        onEnterRoom={enterOnlineRoom}
        battleTimeouts={appConfig.features.battleTimeouts}
      />,
      'battle'
    );
  }

  if (effectivePage === 'theme-table') {
    return withProductFrame(<ThemeTablePage onBack={() => setCurrentPage('home')} />, 'battle');
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
      <DeckManager
        onBack={() => {
          setCurrentPage(deckManagerReturnPage);
          setDeckManagerReturnPage('home');
        }}
        backLabel={deckManagerReturnPage === 'game-setup' ? '返回对局准备' : '返回大厅'}
        initialOpenDeckId={initialOpenDeckId}
      />,
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

  if (effectivePage === 'admin-center' && profile && hasAnyManagementPermission(profile.role)) {
    return withProductFrame(
      <AdminCenterPage
        role={profile.role}
        onBack={() => setCurrentPage('home')}
        onOpenMatchEmotes={() => setCurrentPage('match-emotes-admin')}
        onOpenAnnouncements={() => setCurrentPage('announcement-admin')}
        onOpenCards={() => setCurrentPage('card-admin')}
        onOpenCardSync={() => setCurrentPage('card-sync-admin')}
        onOpenAiExtraction={() => setCurrentPage('ai-effect-admin')}
        onOpenDeckPoints={() => setCurrentPage('deck-point-admin')}
        onOpenOnlineRooms={() => setCurrentPage('online-admin')}
        onOpenPlatformOperations={() => setCurrentPage('platform-operations-admin')}
        onOpenRanked={() => setCurrentPage('ranked-admin')}
        onOpenDeckClassifier={() => setCurrentPage('deck-classifier-admin')}
        onOpenThemeTable={() => setCurrentPage('theme-table-admin')}
        onOpenUsers={() => setCurrentPage('users-admin')}
        battleEntryVisibility={appConfig.features.battleEntries}
        onBattleEntryVisibilityChanged={refreshAppConfig}
      />,
      null
    );
  }

  // 卡牌管理页面
  if (effectivePage === 'card-admin' && profile && hasPermission(profile.role, 'cards.manage')) {
    return withProductFrame(
      <CardAdminPage
        onBack={() => setCurrentPage('admin-center')}
        onOpenAiConfig={() => setCurrentPage('ai-effect-admin')}
      />,
      null
    );
  }

  if (effectivePage === 'card-sync-admin' && profile && hasPermission(profile.role, 'cards.sync')) {
    return withProductFrame(
      <CardSyncAdminPage onBack={() => setCurrentPage('admin-center')} />,
      null
    );
  }

  if (
    effectivePage === 'ai-effect-admin' &&
    profile &&
    hasPermission(profile.role, 'cards.manage')
  ) {
    return withProductFrame(
      <AiEffectExtractionAdminPage
        onBack={() => setCurrentPage('admin-center')}
        onOpenCardAdmin={() => setCurrentPage('card-admin')}
      />,
      null
    );
  }

  if (
    effectivePage === 'online-admin' &&
    profile &&
    hasPermission(profile.role, 'platform.manage')
  ) {
    return withProductFrame(
      <OnlineRoomsAdminPage onBack={() => setCurrentPage('admin-center')} />,
      null
    );
  }

  if (
    effectivePage === 'platform-operations-admin' &&
    profile &&
    hasPermission(profile.role, 'platform.manage')
  ) {
    return withProductFrame(
      <PlatformOperationsPage onBack={() => setCurrentPage('admin-center')} />,
      null
    );
  }

  if (
    effectivePage === 'announcement-admin' &&
    profile &&
    hasPermission(profile.role, 'platform.manage')
  ) {
    return withProductFrame(
      <SiteAnnouncementsAdminPage
        onBack={() => setCurrentPage('admin-center')}
        siteStatus={appConfig.siteStatus}
        onSiteStatusChanged={refreshAppConfig}
      />,
      null
    );
  }

  if (
    effectivePage === 'ranked-admin' &&
    profile &&
    hasPermission(profile.role, 'season.ranked.manage')
  ) {
    return withProductFrame(
      <RankedAdminPage
        onBack={() => setCurrentPage('admin-center')}
        battleTimeouts={appConfig.features.battleTimeouts}
        onOpenDeckClassifier={(source) => {
          setDeckClassifierTemplateImport(source);
          setCurrentPage('deck-classifier-admin');
        }}
      />,
      null
    );
  }

  if (
    effectivePage === 'deck-classifier-admin' &&
    profile &&
    hasPermission(profile.role, 'season.deck_classifier.manage')
  ) {
    return withProductFrame(
      <DeckClassifierAdminPage
        onBack={() => {
          const returnPage = deckClassifierTemplateImport ? 'ranked-admin' : 'admin-center';
          setDeckClassifierTemplateImport(null);
          setCurrentPage(returnPage);
        }}
        initialTemplateImport={deckClassifierTemplateImport}
      />,
      null
    );
  }

  if (
    effectivePage === 'deck-point-admin' &&
    profile &&
    hasPermission(profile.role, 'rules.manage')
  ) {
    return withProductFrame(
      <DeckPointTablesAdminPage onBack={() => setCurrentPage('admin-center')} />,
      null
    );
  }

  if (
    effectivePage === 'match-emotes-admin' &&
    profile &&
    hasPermission(profile.role, 'platform.manage')
  ) {
    return withProductFrame(
      <MatchEmotesAdminPage
        onBack={() => setCurrentPage('admin-center')}
        onCatalogPublished={refreshAppConfig}
      />,
      null
    );
  }

  if (
    effectivePage === 'theme-table-admin' &&
    profile &&
    hasPermission(profile.role, 'season.theme.manage')
  ) {
    return withProductFrame(
      <ThemeTableAdminPage onBack={() => setCurrentPage('admin-center')} />,
      null
    );
  }

  if (effectivePage === 'users-admin' && profile && hasPermission(profile.role, 'users.list')) {
    return withProductFrame(<UserAdminPage onBack={() => setCurrentPage('admin-center')} />, null);
  }

  // 主页
  return withPublicTableLayer(
    <HomePage
      navigation={productNavigation}
      headerActions={authenticatedHeaderActions}
      mobileMenuActions={authenticatedMobileMenuActions}
      onNavigateToDeckManager={() => openDeckManager('home')}
      onNavigateToGameSetup={() => setCurrentPage('game-setup')}
      onAbandonSavedRoomForLocalGame={handleAbandonSavedRoomForLocalGame}
      onNavigateToOnlineRoom={() => setCurrentPage('online-room')}
      onNavigateToRanked={() => setCurrentPage('ranked')}
      onNavigateToThemeTable={() => setCurrentPage('theme-table')}
      onNavigateToOnlineSpectator={() => setCurrentPage('online-spectator')}
      onNavigateToMatchRecords={() => setCurrentPage('match-records')}
      onNavigateToOnlineDebug={() => setCurrentPage('online-debug')}
      onNavigateToAdminCenter={() => setCurrentPage('admin-center')}
      battleEntryVisibility={appConfig.features.battleEntries}
      siteStatus={appConfig.siteStatus}
    />
  );
}

function StartupErrorPage({ siteStatus }: { error: string; siteStatus: PublicSiteStatus }) {
  const maintenance = siteStatus.maintenance;
  const visibleMaintenance =
    maintenance &&
    (siteStatus.lifecycle === 'MAINTENANCE' || siteStatus.lifecycle === 'RESTRICTING_NEW_GAMES')
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
        <p className="mb-4 text-sm leading-6 text-[var(--text-secondary)]">
          当前无法完成页面初始化。请稍后重新加载；如果问题持续，请查看平台公告。
        </p>
        <button onClick={() => window.location.reload()} className="button-primary px-4 py-2">
          重新加载
        </button>
      </div>
    </div>
  );
}

const SITE_STATUS_LABELS: Record<SiteStatusLifecycle, string> = {
  NORMAL: '正常',
  RESTRICTING_NEW_GAMES: '限制新开局',
  MAINTENANCE: '维护中',
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
