/**
 * 游戏控制面板
 * 根据游戏模式（调试/对墙打）显示不同的控制项
 */

import { memo } from 'react';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { ArrowRightLeft, Crosshair, Eye, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';
import { GameMode } from '@game/shared/types/enums';

export const DebugControl = memo(function DebugControl() {
  // 状态选择器
  const matchView = useGameStore((s) => s.getMatchView());
  const currentTurnCount = useGameStore((s) => s.getTurnCountView());
  const currentViewingPlayer = useGameStore((s) => s.getViewingPlayerIdentity());
  const otherPlayer = useGameStore((s) => s.getOpponentPlayerIdentity());
  const gameMode = useGameStore((s) => s.gameMode);
  const isRemoteMode = useGameStore((s) => s.isRemoteMode());

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { setViewingPlayer, addLog, setGameMode } = useGameStore(
    useShallow((s) => ({
      setViewingPlayer: s.setViewingPlayer,
      addLog: s.addLog,
      setGameMode: s.setGameMode,
    }))
  );

  if (!matchView || isRemoteMode) return null;
  const isDebugMode = gameMode === GameMode.DEBUG;

  // 切换视角（仅调试模式）
  const handleSwitchView = () => {
    if (otherPlayer) {
      setViewingPlayer(otherPlayer.id);
      addLog(`视角切换为: ${otherPlayer.name}`, 'info');
    }
  };

  // 切换游戏模式
  const handleSwitchMode = () => {
    setGameMode(isDebugMode ? GameMode.SOLITAIRE : GameMode.DEBUG);
  };

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[140]">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'surface-panel-frosted flex items-center gap-3 rounded-2xl px-4 py-2 shadow-[var(--shadow-lg)]'
        )}
      >
        {/* 模式标记 */}
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full border',
              isDebugMode
                ? 'border-[var(--accent-secondary)]/25 bg-[var(--accent-secondary)]/12 text-[var(--accent-secondary)]'
                : 'border-[var(--semantic-info)]/25 bg-[var(--semantic-info)]/12 text-[var(--semantic-info)]'
            )}
          >
            {isDebugMode ? <Settings2 size={15} /> : <Crosshair size={15} />}
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
              模式
            </span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {isDebugMode ? '调试' : '对墙打'}
            </span>
          </div>
        </div>

        {/* 分隔线 */}
        <div
          className={cn(
            'h-6 w-px bg-[var(--border-default)]'
          )}
        />

        {/* 回合数 */}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs text-[var(--text-muted)]">
            回合:
          </span>
          <span className="font-bold text-[var(--text-primary)]">
            T{currentTurnCount ?? matchView.turnCount}
          </span>
        </div>

        {isDebugMode && (
          <>
            <div className="h-6 w-px bg-[var(--border-default)]" />

            <div className="flex items-center gap-2">
              <Eye size={14} className="text-[var(--text-muted)]" />
              <span className="text-xs text-[var(--text-muted)]">当前视角:</span>
              <span className="text-sm font-bold text-[var(--text-primary)]">
                {currentViewingPlayer?.name ?? '未知'}
              </span>
            </div>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleSwitchView}
              className="button-primary flex items-center gap-1.5 px-3 py-1 text-sm font-semibold"
            >
              <ArrowRightLeft size={14} />
              切换至 {otherPlayer?.name ?? '对手'}
            </motion.button>
          </>
        )}

        {/* 模式切换按钮 */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleSwitchMode}
          className="button-secondary flex h-9 w-9 items-center justify-center p-0"
          title={isDebugMode ? '切换到对墙打模式' : '切换到调试模式'}
        >
          {isDebugMode ? <Crosshair size={15} /> : <Settings2 size={15} />}
        </motion.button>
      </motion.div>
    </div>
  );
});

export default DebugControl;
