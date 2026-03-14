/**
 * 调试控制面板
 * 用于切换视角、帮助对手出牌等调试功能
 */

import { memo } from 'react';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';

export const DebugControl = memo(function DebugControl() {
  // 状态选择器
  const gameState = useGameStore((s) => s.gameState);
  const viewingPlayerId = useGameStore((s) => s.viewingPlayerId);

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { setViewingPlayer, addLog } = useGameStore(
    useShallow((s) => ({
      setViewingPlayer: s.setViewingPlayer,
      addLog: s.addLog,
    }))
  );

  if (!gameState) return null;

  // 获取当前视角玩家信息
  const currentViewingPlayer = gameState.players.find((p) => p.id === viewingPlayerId);
  const otherPlayer = gameState.players.find((p) => p.id !== viewingPlayerId);

  // 切换视角
  const handleSwitchView = () => {
    if (otherPlayer) {
      setViewingPlayer(otherPlayer.id);
      addLog(`🔄 视角切换为: ${otherPlayer.name}`, 'info');
    }
  };

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[60]">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-amber-900/95 rounded-lg border border-amber-600 shadow-xl px-4 py-2 flex items-center gap-4"
      >
        {/* 调试模式标记 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-amber-300 font-bold uppercase tracking-wider">
            🔧 调试模式
          </span>
        </div>

        {/* 分隔线 */}
        <div className="w-px h-6 bg-amber-600/50" />

        {/* 当前视角 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-amber-400">当前视角:</span>
          <span className="text-sm font-bold text-white">
            {currentViewingPlayer?.name ?? '未知'}
          </span>
        </div>

        {/* 切换按钮 */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleSwitchView}
          className={cn(
            'px-3 py-1 rounded text-sm font-bold',
            'bg-gradient-to-r from-amber-500 to-orange-500',
            'hover:from-amber-400 hover:to-orange-400',
            'text-white shadow transition-colors'
          )}
        >
          🔄 切换至 {otherPlayer?.name ?? '对手'}
        </motion.button>
      </motion.div>
    </div>
  );
});

export default DebugControl;
