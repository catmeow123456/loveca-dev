/**
 * HomePage - 主页
 * 登录后的主界面，显示用户信息和入口按钮
 */

import { motion } from 'framer-motion';
import {
  BookOpen,
  Gamepad2,
  Globe,
  Layers3,
  LogOut,
  Settings,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { ThemeToggle } from '@/components/common';
import { useAuthStore } from '@/store/authStore';
import { isApiConfigured } from '@/lib/apiClient';

interface HomePageProps {
  onNavigateToDeckManager: () => void;
  onNavigateToGameSetup: () => void;
  onNavigateToCardAdmin: () => void;
}

export function HomePage({ onNavigateToDeckManager, onNavigateToGameSetup, onNavigateToCardAdmin }: HomePageProps) {
  const { profile, offlineMode, offlineUser, signOut } = useAuthStore();
  
  // 获取显示的用户名
  const displayUsername = offlineMode 
    ? offlineUser?.displayName || 'Guest' 
    : profile?.display_name || profile?.username || 'User';

  const connectionStatus = offlineMode
    ? { icon: WifiOff, label: '离线模式', detail: '数据仅保存在本地', tone: 'text-[var(--semantic-warning)]' }
    : isApiConfigured
      ? { icon: Globe, label: '云端已连接', detail: '卡组会自动同步', tone: 'text-[var(--semantic-success)]' }
      : { icon: Zap, label: '本地模式', detail: '未连接 API 服务', tone: 'text-[var(--text-secondary)]' };

  const actions = [
    {
      title: '卡组管理',
      description: '创建、编辑和整理卡组，保持构筑流程稳定高效。',
      cta: '进入管理',
      accent: 'var(--heart-pink)',
      icon: BookOpen,
      onClick: onNavigateToDeckManager,
      chips: ['创建新卡组', '编辑构筑', '导入导出'],
    },
    {
      title: '开始游戏',
      description: '选择对战模式与双方卡组，开始一场新的对战。',
      cta: '开始对战',
      accent: 'var(--heart-green)',
      icon: Gamepad2,
      onClick: onNavigateToGameSetup,
      chips: ['调试模式', '对墙打', '开局确认'],
    },
  ];

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <header className="safe-top relative z-10 mx-3 mt-3 rounded-[20px] border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 py-2 shadow-[var(--shadow-md)] backdrop-blur-xl sm:mx-4 sm:mt-4 sm:min-h-[72px] sm:rounded-[24px] sm:px-6 sm:py-0">
        <div className="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:min-h-[72px] sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)] sm:h-11 sm:w-11">
              <Layers3 size={18} className="text-[var(--accent-primary)] sm:size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base leading-none font-bold text-gradient-brand sm:text-xl">
                Loveca Card Game
              </h1>
            </div>
          </div>

          <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-3">
            <div className="status-pill min-w-0 max-w-[108px] px-2.5 py-1.5 sm:max-w-none sm:px-4 sm:py-2">
              <connectionStatus.icon size={14} className={connectionStatus.tone} />
              <span className="truncate text-sm font-medium text-[var(--text-primary)] sm:text-base">{displayUsername}</span>
            </div>
            <ThemeToggle />
            <button
              onClick={() => signOut()}
              className="button-ghost inline-flex h-10 items-center justify-center gap-2 px-2.5 py-2 sm:min-h-11 sm:px-4"
              title="登出"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">登出</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pb-6 pt-5 sm:p-6 md:p-8">
        <div className="w-full max-w-5xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-8 text-center sm:mb-12"
          >
            <img 
              src="/icon.jpg" 
              alt="Loveca Logo" 
              className="mx-auto mb-4 h-20 w-20 rounded-[24px] border border-[var(--border-default)] object-cover shadow-[var(--shadow-lg)] sm:mb-5 sm:h-24 sm:w-24 sm:rounded-[28px]"
            />
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[color:var(--bg-overlay)] px-4 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
              <Wifi size={14} />
              Game Hub
            </div>
            <div className="mb-4 flex justify-center">
              <div className="status-pill px-3 py-1.5 text-xs">
                <span className="font-semibold text-[var(--text-primary)]">当前版本</span>
                <span className="text-[var(--accent-primary)]">v{__APP_VERSION__}</span>
              </div>
            </div>
          </motion.div>

          <div className="grid gap-4 md:grid-cols-2 md:gap-6">
            {actions.map((action, index) => (
              <motion.button
                key={action.title}
                initial={{ opacity: 0, x: index === 0 ? -20 : 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.2 + index * 0.1 }}
                whileHover={{ y: -4, scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={action.onClick}
                className="surface-panel-frosted group relative overflow-hidden p-5 text-left sm:p-8"
              >
                <div className="absolute inset-y-0 left-0 w-1.5" style={{ background: action.accent }} />
                <div className="flex items-start gap-3 sm:gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--accent-primary)] shadow-[var(--shadow-sm)] sm:h-14 sm:w-14">
                    <action.icon size={26} />
                  </div>
                  <div className="flex-1">
                    <h3 className="mb-2 text-xl font-bold text-[var(--text-primary)] sm:text-2xl">{action.title}</h3>
                    <p className="mb-5 text-sm leading-relaxed text-[var(--text-secondary)] sm:mb-6 sm:text-base">{action.description}</p>
                    <div className="flex items-center gap-2 font-medium text-[var(--accent-primary)]">
                      <span>{action.cta}</span>
                      <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2">
                  {action.chips.map((chip) => (
                    <span key={chip} className="chip-badge px-3 py-1.5 text-xs">
                      {chip}
                    </span>
                  ))}
                </div>
              </motion.button>
            ))}
          </div>

          {!offlineMode && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="mt-6"
            >
              <motion.button
                whileHover={{ y: -3, scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={onNavigateToCardAdmin}
                className="surface-panel-frosted group flex w-full flex-col items-start gap-4 p-5 text-left sm:flex-row sm:items-center sm:p-6"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--accent-secondary)] shadow-[var(--shadow-sm)] sm:h-14 sm:w-14">
                  <Settings size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="mb-1 text-xl font-bold text-[var(--text-primary)]">
                    卡牌数据管理
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)]">
                    编辑卡牌数据、发布状态和资源信息。
                  </p>
                </div>
                <div className="flex items-center gap-2 font-medium text-[var(--accent-secondary)]">
                  <span>管理</span>
                  <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </div>
              </motion.button>
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mt-8 flex justify-center"
          >
            <div className="status-pill px-6 py-3">
              <connectionStatus.icon size={16} className={connectionStatus.tone} />
              <div className="text-left">
                <div className="text-sm font-medium text-[var(--text-primary)]">{connectionStatus.label}</div>
                <div className="text-xs text-[var(--text-muted)]">{connectionStatus.detail}</div>
              </div>
            </div>
          </motion.div>
        </div>
      </main>

      <footer className="safe-bottom relative z-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-[var(--border-subtle)] px-4 py-3 text-center text-xs text-[var(--text-muted)] sm:h-14 sm:py-0 sm:text-sm">
        <span>Loveca Card Game © 2024</span>
        <span>v{__APP_VERSION__}</span>
        <span>·</span>
        <span>卡牌数据来源 <a href="https://github.com/wlt233/llocg_db" target="_blank" rel="noopener noreferrer" className="text-[var(--text-secondary)] underline underline-offset-2 transition-colors hover:text-[var(--accent-primary)]">llocg_db</a></span>
      </footer>
    </div>
  );
}
