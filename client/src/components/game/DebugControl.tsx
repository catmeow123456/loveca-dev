/**
 * 游戏控制面板
 * 根据游戏模式（调试/对墙打）显示不同的控制项
 */

import { memo } from 'react';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';
import { GameMode } from '@game/shared/types/enums';

export const DebugControl = memo(function DebugControl() {
  // 状态选择器
  const gameState = useGameStore((s) => s.gameState);
  const viewingPlayerId = useGameStore((s) => s.viewingPlayerId);
  const gameMode = useGameStore((s) => s.gameMode);

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { setViewingPlayer, addLog, setGameMode } = useGameStore(
    useShallow((s) => ({
      setViewingPlayer: s.setViewingPlayer,
      addLog: s.addLog,
      setGameMode: s.setGameMode,
    }))
  );

  if (!gameState) return null;

  const isSolitaire = gameMode === GameMode.SOLITAIRE;

  // 获取当前视角玩家信息
  const currentViewingPlayer = gameState.players.find((p) => p.id === viewingPlayerId);
  const otherPlayer = gameState.players.find((p) => p.id !== viewingPlayerId);

  // 切换视角（仅调试模式）
  const handleSwitchView = () => {
    if (otherPlayer) {
      setViewingPlayer(otherPlayer.id);
      addLog(`🔄 视角切换为: ${otherPlayer.name}`, 'info');
    }
  };

  // 切换游戏模式
  const handleSwitchMode = () => {
    const newMode = isSolitaire ? GameMode.DEBUG : GameMode.SOLITAIRE;
    setGameMode(newMode);
  };

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[60]">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'rounded-lg border shadow-xl px-4 py-2 flex items-center gap-4',
          isSolitaire
            ? 'bg-purple-900/95 border-purple-600'
            : 'bg-amber-900/95 border-amber-600'
        )}
      >
        {/* 模式标记 */}
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs font-bold uppercase tracking-wider',
              isSolitaire ? 'text-purple-300' : 'text-amber-300'
            )}
          >
            {isSolitaire ? '🎯 对墙打模式' : '🔧 调试模式'}
          </span>
        </div>

        {/* 分隔线 */}
        <div
          className={cn(
            'w-px h-6',
            isSolitaire ? 'bg-purple-600/50' : 'bg-amber-600/50'
          )}
        />

        {/* 回合数 */}
        <div className="flex items-center gap-2">
          <span className={cn('text-xs', isSolitaire ? 'text-purple-400' : 'text-amber-400')}>
            回合:
          </span>
          <span className="text-sm font-bold text-white">T{gameState.turnCount}</span>
        </div>

        {/* 调试模式专属：当前视角 + 切换按钮 */}
        {!isSolitaire && (
          <>
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
          </>
        )}

        {/* 模式切换按钮 */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleSwitchMode}
          className={cn(
            'px-3 py-1 rounded text-sm font-medium',
            'bg-white/10 hover:bg-white/20',
            'text-white/70 hover:text-white',
            'transition-colors border border-white/10'
          )}
          title={isSolitaire ? '切换到调试模式' : '切换到对墙打模式'}
        >
          {isSolitaire ? '🔧' : '🎯'}
        </motion.button>
      </motion.div>
    </div>
  );
});

export default DebugControl;
