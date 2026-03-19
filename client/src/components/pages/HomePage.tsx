/**
 * HomePage - 主页
 * 登录后的主界面，显示用户信息和入口按钮
 */

import { motion } from 'framer-motion';
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#2d2820] via-[#1f1a15] to-[#2d2820] flex flex-col">
      {/* Header */}
      <header className="h-16 bg-[#3d3020]/80 backdrop-blur-sm border-b border-orange-300/15 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎴</span>
          <h1 className="text-xl font-bold bg-gradient-to-r from-orange-300 to-amber-300 bg-clip-text text-transparent">
            Loveca Card Game
          </h1>
        </div>
        
        {/* User Menu */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 bg-[#2d2820]/80 rounded-full border border-orange-300/20">
            {offlineMode ? (
              <span className="text-amber-400 text-sm">📴</span>
            ) : isApiConfigured ? (
              <span className="text-green-400 text-sm">🌐</span>
            ) : (
              <span className="text-gray-400 text-sm">⚡</span>
            )}
            <span className="text-orange-200 font-medium">{displayUsername}</span>
          </div>
          
          <button
            onClick={() => signOut()}
            className="px-4 py-2 text-orange-300/60 hover:text-orange-300 hover:bg-orange-500/10 rounded-full transition-all duration-300 border border-transparent hover:border-orange-300/20"
            title="登出"
          >
            🚪 登出
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-4xl w-full">
          {/* Welcome Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-12"
          >
            <img 
              src="/icon.jpg" 
              alt="Loveca Logo" 
              className="w-24 h-24 mx-auto mb-4 rounded-2xl shadow-lg shadow-orange-400/30"
            />
            <h2 className="text-3xl font-bold bg-gradient-to-r from-orange-300 via-amber-300 to-orange-300 bg-clip-text text-transparent mb-4">
              欢迎回来，{displayUsername}！
            </h2>
            <p className="text-orange-300/60 text-lg">
              选择一个选项开始你的卡牌之旅
            </p>
          </motion.div>

          {/* Action Cards */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Deck Manager Card */}
            <motion.button
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onNavigateToDeckManager}
              className="group p-8 bg-gradient-to-br from-[#3d3020] to-[#2d2820] rounded-2xl border border-orange-300/20 hover:border-orange-400/50 transition-all duration-300 hover:shadow-xl hover:shadow-orange-500/10 text-left"
            >
              <div className="flex items-start gap-4">
                <div className="text-5xl group-hover:scale-110 transition-transform duration-300">
                  📚
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-orange-100 mb-2 group-hover:text-orange-200 transition-colors">
                    卡组管理
                  </h3>
                  <p className="text-orange-300/60 mb-4">
                    创建、编辑和管理你的卡组。构建完美的策略！
                  </p>
                  <div className="flex items-center gap-2 text-orange-400 font-medium">
                    <span>进入管理</span>
                    <span className="group-hover:translate-x-1 transition-transform duration-300">→</span>
                  </div>
                </div>
              </div>
              
              {/* Decorative Elements */}
              <div className="mt-6 flex gap-3">
                <div className="px-3 py-1.5 bg-orange-500/10 rounded-full text-xs text-orange-300/70 border border-orange-300/20">
                  ✨ 创建新卡组
                </div>
                <div className="px-3 py-1.5 bg-orange-500/10 rounded-full text-xs text-orange-300/70 border border-orange-300/20">
                  📝 编辑卡组
                </div>
                <div className="px-3 py-1.5 bg-orange-500/10 rounded-full text-xs text-orange-300/70 border border-orange-300/20">
                  ☁️ 云端同步
                </div>
              </div>
            </motion.button>

            {/* Start Game Card */}
            <motion.button
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onNavigateToGameSetup}
              className="group p-8 bg-gradient-to-br from-[#3d3020] to-[#2d2820] rounded-2xl border border-orange-300/20 hover:border-green-400/50 transition-all duration-300 hover:shadow-xl hover:shadow-green-500/10 text-left"
            >
              <div className="flex items-start gap-4">
                <div className="text-5xl group-hover:scale-110 transition-transform duration-300">
                  🎮
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-orange-100 mb-2 group-hover:text-green-200 transition-colors">
                    开始游戏
                  </h3>
                  <p className="text-orange-300/60 mb-4">
                    选择双方卡组，开始一场精彩的对战！
                  </p>
                  <div className="flex items-center gap-2 text-green-400 font-medium">
                    <span>开始对战</span>
                    <span className="group-hover:translate-x-1 transition-transform duration-300">→</span>
                  </div>
                </div>
              </div>
              
              {/* Decorative Elements */}
              <div className="mt-6 flex gap-3">
                <div className="px-3 py-1.5 bg-green-500/10 rounded-full text-xs text-green-300/70 border border-green-300/20">
                  👤 选择 P1 卡组
                </div>
                <div className="px-3 py-1.5 bg-green-500/10 rounded-full text-xs text-green-300/70 border border-green-300/20">
                  👤 选择 P2 卡组
                </div>
                <div className="px-3 py-1.5 bg-green-500/10 rounded-full text-xs text-green-300/70 border border-green-300/20">
                  ⚔️ 开战
                </div>
              </div>
            </motion.button>
          </div>

          {/* Card Admin Card - Only show when online */}
          {!offlineMode && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="mt-6"
            >
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onNavigateToCardAdmin}
                className="group w-full p-6 bg-gradient-to-r from-[#3d3020]/80 to-[#2d2820]/80 rounded-2xl border border-orange-300/20 hover:border-purple-400/50 transition-all duration-300 hover:shadow-xl hover:shadow-purple-500/10 text-left"
              >
                <div className="flex items-center gap-4">
                  <div className="text-4xl group-hover:scale-110 transition-transform duration-300">
                    ⚙️
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-orange-100 mb-1 group-hover:text-purple-200 transition-colors">
                      卡牌数据管理
                    </h3>
                    <p className="text-orange-300/60 text-sm">
                      编辑卡牌数据、修改属性、添加新卡牌
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-purple-400 font-medium">
                    <span>管理</span>
                    <span className="group-hover:translate-x-1 transition-transform duration-300">→</span>
                  </div>
                </div>
              </motion.button>
            </motion.div>
          )}

          {/* Status Info */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="mt-8 text-center"
          >
            <div className="inline-flex items-center gap-3 px-6 py-3 bg-[#2d2820]/60 rounded-full border border-orange-300/10">
              {offlineMode ? (
                <>
                  <span className="text-amber-400">📴</span>
                  <span className="text-orange-300/50 text-sm">离线模式 - 数据仅保存在本地</span>
                </>
              ) : isApiConfigured ? (
                <>
                  <span className="text-green-400">🌐</span>
                  <span className="text-orange-300/50 text-sm">已连接到云端 - 卡组自动同步</span>
                </>
              ) : (
                <>
                  <span className="text-gray-400">⚡</span>
                  <span className="text-orange-300/50 text-sm">本地模式</span>
                </>
              )}
            </div>
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <footer className="h-12 flex items-center justify-center text-orange-300/30 text-sm border-t border-orange-300/10 gap-3">
        <span>Loveca Card Game © 2024</span>
        <span>v{__APP_VERSION__}</span>
        <span>·</span>
        <span>卡牌数据来源 <a href="https://github.com/wlt233/llocg_db" target="_blank" rel="noopener noreferrer" className="text-orange-300/50 hover:text-orange-300 transition-colors underline underline-offset-2">llocg_db</a></span>
      </footer>
    </div>
  );
}
