/**
 * 游戏控制面板
 * 根据本地/联机模式显示不同的控制项
 */

import { memo, useId } from 'react';
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { Crosshair, Eye, Settings2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';
import type { BattleSurfaceKind } from '@/store/battleSurfaceCapabilities';
import { GameMode } from '@game/shared/types/enums';
import './debug-control.css';

export const DebugControl = memo(function DebugControl() {
  const perspectiveId = useId();
  // 状态选择器
  const matchView = useGameStore((s) => s.getMatchView());
  const currentViewingPlayer = useGameStore((s) => s.getViewingPlayerIdentity());
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
  const handleSwitchView = (seat: 'FIRST' | 'SECOND') => {
    const player = matchView.participants[seat];
    if (player.id === currentViewingPlayer?.id) return;
    setViewingPlayer(player.id);
    addLog(`视角切换为: ${player.name}`, 'info');
  };

  // 切换游戏模式
  const handleSwitchMode = () => {
    if (capabilities.canSwitchLocalMode) {
      setGameMode(isLocalDebugSurface ? GameMode.SOLITAIRE : GameMode.DEBUG);
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
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

      {capabilities.canSwitchPerspective && (
        <>
          <div className="h-5 w-px shrink-0 bg-[var(--border-default)]" />

          <div className="battle-perspective-switch" role="radiogroup" aria-label="调试视角">
            <Eye size={15} aria-hidden="true" />
            {(['FIRST', 'SECOND'] as const).map((seat, index) => (
              <label key={seat} title={`P${index + 1} · ${matchView.participants[seat].name}`}>
                <input
                  type="radio"
                  name={perspectiveId}
                  checked={currentViewingPlayer?.id === matchView.participants[seat].id}
                  aria-label={`P${index + 1} 视角：${matchView.participants[seat].name}`}
                  onChange={() => handleSwitchView(seat)}
                />
                <span>P{index + 1}</span>
              </label>
            ))}
          </div>
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
    case 'TUTORIAL':
      return '新手教程';
    case 'AI_DEBUG':
      return 'AI 调试';
    case 'ONLINE':
    default:
      return '联机';
  }
}

export default DebugControl;
