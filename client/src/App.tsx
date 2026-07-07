/**
 * Loveca Card Game - Main Application
 */

import { useEffect, useState, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { BattleViewportShell, GameBoard } from '@/components/game';
import { PreMatchBriefingModal } from '@/components/game/PreMatchBriefingModal';
import { ConfirmDialog } from '@/components/common';
import { DeckManager } from '@/components/deck/DeckManager';
import {
  HomePage,
  GameSetupPage,
  OnlineDebugPage,
  OnlineRoomPage,
  OnlineSpectatorPage,
  MatchRecordsPage,
  SharedDeckPage,
} from '@/components/pages';
import { CardAdminPage } from '@/components/admin/CardAdminPage';
import { OnlineRoomsAdminPage } from '@/components/admin/OnlineRoomsAdminPage';
import {
  LoginPage,
  RegisterPage,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from '@/components/auth';
import { DEFAULT_APP_CONFIG, loadPublicAppConfig, type PublicAppConfig } from '@/lib/appConfig';
import { getSolitaireLeaveConfirmCopy } from '@/lib/leaveConfirmCopy';
import { fetchSolitaireMatchSnapshot } from '@/lib/solitaireMatchClient';
import {
  clearStoredSolitaireMatchId,
  readStoredSolitaireMatchId,
} from '@/lib/solitaireMatchRecovery';
import { useGameStore } from '@/store/gameStore';
import { useDeckStore } from '@/store/deckStore';
import { useAuthStore } from '@/store/authStore';
import { cardService } from '@/lib/cardService';

type AuthPage = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'verify-email';
type AppPage =
  | 'home'
  | 'deck-manager'
  | 'game-setup'
  | 'online-room'
  | 'match-records'
  | 'online-debug'
  | 'game'
  | 'card-admin'
  | 'online-admin';

interface InitialAuthRequest {
  page: AuthPage;
  token: string | null;
}

function readAuthTokenFromUrl(): string | null {
  const searchToken = new URLSearchParams(window.location.search).get('token');
  if (searchToken) {
    return searchToken;
  }

  const hash = window.location.hash.replace(/^#\/?/, '');
  if (!hash) {
    return null;
  }

  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash;
  const hashParams = new URLSearchParams(hashQuery);
  return hashParams.get('token') ?? hashParams.get('access_token');
}

function getInitialAuthRequest(): InitialAuthRequest {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const hash = window.location.hash;
  const token = readAuthTokenFromUrl();

  if (path === '/verify-email') {
    return { page: 'verify-email', token };
  }

  if (
    path === '/reset-password' ||
    hash.includes('type=recovery') ||
    hash.includes('reset-password')
  ) {
    return { page: 'reset-password', token };
  }

  return { page: 'login', token: null };
}

function getInitialPage(): AppPage {
  const page = new URLSearchParams(window.location.search).get('page');
  if (
    page === 'deck-manager' ||
    page === 'game-setup' ||
    page === 'online-room' ||
    page === 'match-records' ||
    page === 'online-debug' ||
    page === 'game' ||
    page === 'card-admin' ||
    page === 'online-admin'
  ) {
    return page;
  }
  return 'home';
}

function App() {
  const [initialAuthRequest] = useState<InitialAuthRequest>(() => getInitialAuthRequest());
  const isInitialAuthActionPage =
    initialAuthRequest.page === 'reset-password' || initialAuthRequest.page === 'verify-email';
  const [isLoading, setIsLoading] = useState(!isInitialAuthActionPage);
  const [error, setError] = useState<string | null>(null);
  const [authPage, setAuthPage] = useState<AuthPage>(initialAuthRequest.page);
  const [authToken, setAuthToken] = useState<string | null>(initialAuthRequest.token);
  const [currentPage, setCurrentPage] = useState<AppPage>(getInitialPage);
  const [appConfig, setAppConfig] = useState<PublicAppConfig>(DEFAULT_APP_CONFIG);
  const [configInitialized, setConfigInitialized] = useState(false);

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

  // Game state
  const matchView = useGameStore((s) => s.getMatchView());
  const capabilities = useGameStore(useShallow((s) => s.getBattleSurfaceCapabilities()));
  const loadCardData = useGameStore((s) => s.loadCardData);
  const leaveCurrentGame = useGameStore((s) => s.leaveCurrentGame);
  const connectRemoteSession = useGameStore((s) => s.connectRemoteSession);
  const applyRemoteSnapshot = useGameStore((s) => s.applyRemoteSnapshot);
  const initDeckStore = useDeckStore((s) => s.init);
  const [gameBriefingAcknowledged, setGameBriefingAcknowledged] = useState(false);
  const [isLeaveCurrentGameConfirmOpen, setIsLeaveCurrentGameConfirmOpen] = useState(false);
  const [isLeavingCurrentGame, setIsLeavingCurrentGame] = useState(false);
  const gameBriefingKeyRef = useRef<string | null>(null);
  const solitaireRestoreAttemptedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    loadPublicAppConfig()
      .then((config) => {
        if (!cancelled) {
          setAppConfig(config);
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
  }, []);

  useEffect(() => {
    if (!configInitialized || authInitRef.current) return;
    authInitRef.current = true;

    initializeAuth();
  }, [configInitialized, initializeAuth]);

  // 初始化卡牌数据 - 只从数据库加载
  useEffect(() => {
    if (!authInitialized) return;

    if (authPage === 'reset-password' || authPage === 'verify-email') {
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
    capabilities.surface === 'SOLITAIRE' ? getSolitaireLeaveConfirmCopy() : null;
  const isAuthenticated = !!(user && profile) || (offlineMode && !!offlineUser);
  const shareMatch = window.location.pathname.match(/^\/decks\/share\/([^/]+)$/);
  const shareId = shareMatch?.[1] ?? null;
  const spectatorMatch = window.location.pathname.match(/^\/online\/spectate\/([^/]+)$/);
  const spectatorToken = spectatorMatch?.[1] ? decodeURIComponent(spectatorMatch[1]) : null;
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

    if (!configInitialized || !authInitialized || isLoading || error) {
      return;
    }

    if (authPage === 'reset-password' || authPage === 'verify-email') {
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

  // 显示加载状态
  if (isLoading) {
    return (
      <div className="app-shell h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--accent-primary)] border-t-transparent" />
          <p className="text-sm text-[var(--text-secondary)]">加载卡牌数据...</p>
        </div>
      </div>
    );
  }

  // 显示错误状态
  if (error) {
    const errorLines = error.split('\n');
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 p-4">
        <div className="surface-panel max-w-2xl p-6 text-center">
          <h2 className="mb-4 text-xl font-bold text-[var(--semantic-error)]">卡牌数据加载错误</h2>
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

  // 未登录且不是离线模式，显示登录/注册页面
  const switchToLogin = () => {
    setAuthPage('login');
    setAuthToken(null);
    setIsLoading(true);
    if (
      window.location.pathname === '/verify-email' ||
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

  if (!isAuthenticated) {
    switch (authPage) {
      case 'register':
        return (
          <RegisterPage
            emailVerificationRequired={emailFeature.verificationRequired}
            onSwitchToLogin={() => setAuthPage('login')}
          />
        );
      case 'forgot-password':
        if (!emailFeature.passwordResetEnabled)
          return (
            <LoginPage
              passwordResetEnabled={emailFeature.passwordResetEnabled}
              onSwitchToRegister={() => setAuthPage('register')}
              onSwitchToForgotPassword={() => setAuthPage('forgot-password')}
            />
          );
        return <ForgotPasswordPage onSwitchToLogin={() => setAuthPage('login')} />;
      default:
        return (
          <LoginPage
            passwordResetEnabled={emailFeature.passwordResetEnabled}
            onSwitchToRegister={() => setAuthPage('register')}
            onSwitchToForgotPassword={() => setAuthPage('forgot-password')}
          />
        );
    }
  }

  // 游戏进行中
  if (effectivePage === 'game' && matchView) {
    const gameBriefingMode = capabilities.surface === 'SOLITAIRE' ? 'solitaire' : null;

    return (
      <BattleViewportShell>
        <GameBoard
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
      </BattleViewportShell>
    );
  }

  // 游戏准备页面
  if (effectivePage === 'game-setup') {
    return (
      <GameSetupPage
        onBack={() => setCurrentPage('home')}
        onGameStart={() => setCurrentPage('game')}
        onNavigateToOnlineRoom={() => setCurrentPage('online-room')}
      />
    );
  }

  if (effectivePage === 'online-room') {
    return <OnlineRoomPage onBack={() => setCurrentPage('home')} />;
  }

  if (effectivePage === 'match-records') {
    return <MatchRecordsPage onBack={() => setCurrentPage('home')} />;
  }

  if (effectivePage === 'online-debug') {
    return <OnlineDebugPage onBack={() => setCurrentPage('home')} />;
  }

  // 卡组管理页面
  if (effectivePage === 'deck-manager') {
    return (
      <DeckManager onBack={() => setCurrentPage('home')} initialOpenDeckId={initialOpenDeckId} />
    );
  }

  // 卡牌管理页面
  if (effectivePage === 'card-admin' && profile?.role === 'admin') {
    return <CardAdminPage onBack={() => setCurrentPage('home')} />;
  }

  if (effectivePage === 'online-admin' && profile?.role === 'admin') {
    return <OnlineRoomsAdminPage onBack={() => setCurrentPage('home')} />;
  }

  // 主页
  return (
    <HomePage
      onNavigateToDeckManager={() => setCurrentPage('deck-manager')}
      onNavigateToGameSetup={() => setCurrentPage('game-setup')}
      onNavigateToOnlineRoom={() => setCurrentPage('online-room')}
      onNavigateToMatchRecords={() => setCurrentPage('match-records')}
      onNavigateToOnlineDebug={() => setCurrentPage('online-debug')}
      onNavigateToCardAdmin={() => setCurrentPage('card-admin')}
      onNavigateToOnlineAdmin={() => setCurrentPage('online-admin')}
    />
  );
}

export default App;
