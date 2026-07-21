/**
 * 游戏控制面板
 * 根据本地/联机模式显示不同的控制项
 */

import { memo } from 'react';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { ArrowRightLeft, Crosshair, Eye, Settings2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';
import type { BattleSurfaceKind } from '@/store/battleSurfaceCapabilities';
import { GameMode } from '@game/shared/types/enums';

export const DebugControl = memo(function DebugControl() {
  // 状态选择器
  const matchView = useGameStore((s) => s.getMatchView());
  const currentTurnCount = useGameStore((s) => s.getTurnCountView());
  const currentViewingPlayer = useGameStore((s) => s.getViewingPlayerIdentity());
  const otherPlayer = useGameStore((s) => s.getOpponentPlayerIdentity());
  const freePlayEnabled = useGameStore((s) => s.freePlayEnabled);
  const capabilities = useGameStore(useShallow((s) => s.getBattleSurfaceCapabilities()));

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { setViewingPlayer, addLog, setGameMode, setFreePlayEnabled } = useGameStore(
    useShallow((s) => ({
      setViewingPlayer: s.setViewingPlayer,
      addLog: s.addLog,
      setGameMode: s.setGameMode,
      setFreePlayEnabled: s.setFreePlayEnabled,
    }))
  );

  if (!matchView) return null;
  const isLocalDebugSurface = capabilities.surface === 'LOCAL_DEBUG';
  const modeLabel = getBattleSurfaceLabel(capabilities.surface);
  const manualOperation = matchView.manualOperation;
  const freePlayLabel = freePlayEnabled ? '自由模式' : '规则模式';
  const freePlayTitle = manualOperation?.pendingRequest
    ? '正在等待对方回应自由模式请求'
    : manualOperation && !manualOperation.canSwitchNow
      ? (manualOperation.disabledReason ?? '当前不能切换操作模式')
      : freePlayEnabled
        ? '点击恢复规则模式'
        : capabilities.surface === 'ONLINE'
          ? '开启自由模式需要对方同意'
          : '点击开启自由模式';
  const manualOperationSwitchDisabled =
    !!manualOperation?.pendingRequest || manualOperation?.canSwitchNow === false;

  // 切换视角（仅调试模式）
  const handleSwitchView = () => {
    if (otherPlayer) {
      setViewingPlayer(otherPlayer.id);
      addLog(`视角切换为: ${otherPlayer.name}`, 'info');
    }
  };

  // 切换游戏模式
  const handleSwitchMode = () => {
    if (capabilities.canSwitchLocalMode) {
      setGameMode(isLocalDebugSurface ? GameMode.SOLITAIRE : GameMode.DEBUG);
    }
  };

  return (
    <div className="pointer-events-none fixed left-1/2 top-2 z-[140] w-[calc(100vw-1rem)] -translate-x-1/2">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          'surface-panel-frosted pointer-events-auto mx-auto flex w-fit max-w-full items-center gap-2 overflow-hidden rounded-lg px-2.5 py-1.5 shadow-[var(--shadow-lg)]'
        )}
      >
        {/* 模式标记 */}
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <div
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md border',
              isLocalDebugSurface
                ? 'border-[var(--accent-secondary)]/25 bg-[var(--accent-secondary)]/12 text-[var(--accent-secondary)]'
                : 'border-[var(--semantic-info)]/25 bg-[var(--semantic-info)]/12 text-[var(--semantic-info)]'
            )}
          >
            {isLocalDebugSurface ? <Settings2 size={15} /> : <Crosshair size={15} />}
          </div>
          <div className="flex items-baseline gap-1.5 leading-none">
            <span className="text-[11px] text-[var(--text-muted)]">模式</span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">{modeLabel}</span>
          </div>
        </div>

        {/* 分隔线 */}
        <div className={cn('h-5 w-px shrink-0 bg-[var(--border-default)]')} />

        {/* 回合数 */}
        <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm">
          <span className="text-xs text-[var(--text-muted)]">回合:</span>
          <span className="font-bold text-[var(--text-primary)]">
            T{currentTurnCount ?? matchView.turnCount}
          </span>
        </div>

        {capabilities.canSwitchPerspective && (
          <>
            <div className="h-5 w-px shrink-0 bg-[var(--border-default)]" />

            <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
              <Eye size={14} className="shrink-0 text-[var(--text-muted)]" />
              <span className="shrink-0 text-xs text-[var(--text-muted)]">当前视角:</span>
              <span
                className="max-w-28 truncate text-sm font-bold text-[var(--text-primary)] lg:max-w-40"
                title={currentViewingPlayer?.name ?? '未知'}
              >
                {currentViewingPlayer?.name ?? '未知'}
              </span>
            </div>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleSwitchView}
              className="button-primary flex h-8 min-w-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-sm font-semibold"
              title={`切换至 ${otherPlayer?.name ?? '对手'}`}
            >
              <ArrowRightLeft size={14} className="shrink-0" />
              <span className="shrink-0">切换至</span>
              <span className="max-w-24 truncate lg:max-w-36">{otherPlayer?.name ?? '对手'}</span>
            </motion.button>
          </>
        )}

        {capabilities.showFreePlayControl && (
          <>
            <div className="h-5 w-px shrink-0 bg-[var(--border-default)]" />

            <motion.button
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => setFreePlayEnabled(!freePlayEnabled)}
              disabled={manualOperationSwitchDisabled}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-semibold transition',
                freePlayEnabled
                  ? 'border-[var(--semantic-warning)]/40 bg-[var(--semantic-warning)]/15 text-[var(--semantic-warning)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface)]/50 text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                manualOperationSwitchDisabled && 'cursor-not-allowed opacity-55'
              )}
              title={freePlayTitle}
            >
              <Zap size={14} className="shrink-0" />
              {freePlayLabel}
            </motion.button>
          </>
        )}

        {capabilities.canSwitchLocalMode ? (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleSwitchMode}
            className="button-secondary flex h-8 w-8 shrink-0 items-center justify-center p-0"
            title={isLocalDebugSurface ? '切换到对墙打模式' : '切换到调试模式'}
          >
            {isLocalDebugSurface ? <Crosshair size={15} /> : <Settings2 size={15} />}
          </motion.button>
        ) : null}
      </motion.div>
    </div>
  );
});

function getBattleSurfaceLabel(surface: BattleSurfaceKind): string {
  switch (surface) {
    case 'LOCAL_DEBUG':
      return '调试';
    case 'SOLITAIRE':
      return '对墙打';
    case 'REMOTE_DEBUG':
      return '远程调试';
    case 'ONLINE':
    default:
      return '联机';
  }
}

export default DebugControl;
