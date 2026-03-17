/**
 * Loveca Card Game - Main Application
 */

import { useEffect, useState, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GameBoard } from '@/components/game';
import { DeckManager } from '@/components/deck/DeckManager';
import { HomePage, GameSetupPage } from '@/components/pages';
import { CardAdminPage } from '@/components/admin/CardAdminPage';
import { LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage } from '@/components/auth';
import { isEmailEnabled } from '@/lib/apiClient';
import { useGameStore } from '@/store/gameStore';
import { useDeckStore } from '@/store/deckStore';
import { useAuthStore } from '@/store/authStore';
import { cardService } from '@/lib/cardService';

type AuthPage = 'login' | 'register' | 'forgot-password' | 'reset-password';
type AppPage = 'home' | 'deck-manager' | 'game-setup' | 'game' | 'card-admin';

function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authPage, setAuthPage] = useState<AuthPage>('login');
  const [currentPage, setCurrentPage] = useState<AppPage>('home');
  
  // 防止 React 19 Strict Mode 下重复初始化
  const authInitRef = useRef(false);
  
  // Auth state - 使用 useShallow 合并多个状态
  const { user, profile, offlineMode, offlineUser, isInitialized: authInitialized } = useAuthStore(
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
  const gameState = useGameStore((s) => s.gameState);
  const loadCardData = useGameStore((s) => s.loadCardData);
  const initDeckStore = useDeckStore((s) => s.init);

  // 初始化认证 - 使用 ref 确保只执行一次
  useEffect(() => {
    if (authInitRef.current) return;
    authInitRef.current = true;

    // 检测 URL 中的 recovery token（从密码重置邮件链接进入）
    const hash = window.location.hash;
    if (hash.includes('type=recovery') || hash.includes('#/reset-password')) {
      setAuthPage('reset-password');
    }

    initializeAuth();
  }, [initializeAuth]);

  // 初始化卡牌数据 - 只从数据库加载
  useEffect(() => {
    if (!authInitialized) return;

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
        console.error('[App] 卡牌数据加载失败:', err);
        setError(err instanceof Error ? err.message : '未知错误');
        setIsLoading(false);
      }
    };

    init();
  }, [authInitialized, loadCardData, initDeckStore]);

  // 计算实际显示的页面（游戏结束后自动回到首页）
  const effectivePage: AppPage = (currentPage === 'game' && !gameState) ? 'home' : currentPage;

  // 等待认证初始化
  if (!authInitialized) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-400">初始化中...</p>
        </div>
      </div>
    );
  }

  // 显示加载状态
  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-400">加载卡牌数据...</p>
        </div>
      </div>
    );
  }

  // 显示错误状态
  if (error) {
    const errorLines = error.split('\n');
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 p-4">
        <div className="text-center max-w-2xl">
          <h2 className="text-red-400 text-xl font-bold mb-4">卡牌数据加载错误</h2>
          <div className="bg-slate-800 rounded-lg p-4 mb-4 max-h-96 overflow-y-auto">
            {errorLines.length > 1 ? (
              <ul className="text-left text-red-300 text-sm space-y-2">
                {errorLines.map((line, index) => (
                  <li key={index} className="break-all">• {line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-red-300 text-sm">{error}</p>
            )}
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  // 未登录且不是离线模式，显示登录/注册页面
  const isAuthenticated = !!(user && profile) || (offlineMode && !!offlineUser);

  // 密码重置页面需要特殊处理：用户通过邮件链接进入时应显示重置页面
  if (authPage === 'reset-password') {
    return <ResetPasswordPage onSwitchToLogin={() => setAuthPage('login')} />;
  }

  if (!isAuthenticated) {
    switch (authPage) {
      case 'register':
        return <RegisterPage onSwitchToLogin={() => setAuthPage('login')} />;
      case 'forgot-password':
        if (!isEmailEnabled) return <LoginPage onSwitchToRegister={() => setAuthPage('register')} onSwitchToForgotPassword={() => setAuthPage('forgot-password')} />;
        return <ForgotPasswordPage onSwitchToLogin={() => setAuthPage('login')} />;
      default:
        return (
          <LoginPage
            onSwitchToRegister={() => setAuthPage('register')}
            onSwitchToForgotPassword={() => setAuthPage('forgot-password')}
          />
        );
    }
  }

  // 游戏进行中
  if (effectivePage === 'game' && gameState) {
    return (
      <div className="h-screen overflow-hidden">
        <GameBoard />
      </div>
    );
  }

  // 游戏准备页面
  if (effectivePage === 'game-setup') {
    return (
      <GameSetupPage
        onBack={() => setCurrentPage('home')}
        onGameStart={() => setCurrentPage('game')}
      />
    );
  }

  // 卡组管理页面
  if (effectivePage === 'deck-manager') {
    return (
      <DeckManager
        onBack={() => setCurrentPage('home')}
      />
    );
  }

  // 卡牌管理页面
  if (effectivePage === 'card-admin') {
    return (
      <CardAdminPage
        onBack={() => setCurrentPage('home')}
      />
    );
  }

  // 主页
  return (
    <HomePage
      onNavigateToDeckManager={() => setCurrentPage('deck-manager')}
      onNavigateToGameSetup={() => setCurrentPage('game-setup')}
      onNavigateToCardAdmin={() => setCurrentPage('card-admin')}
    />
  );
}

export default App;
