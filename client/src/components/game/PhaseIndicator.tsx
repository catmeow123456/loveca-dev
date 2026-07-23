/**
 * 阶段指示器
 * 显示当前游戏阶段、子阶段和回合数，提供阶段流转按钮
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Check, Mic, Sparkles, Trophy, Undo2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { GameCommandType } from '@game/application/game-commands';
import { GamePhase, SubPhase } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';
import {
  getPhaseConfig,
  getSubPhaseConfig,
  isUserActionRequired,
} from '@game/shared/phase-config';

interface PhaseIndicatorProps {
  phase: GamePhase;
  turnNumber?: number;
  /** 打开判定面板的回调 */
  onOpenJudgment?: () => void;
}

/**
 * 根据阶段和子阶段获取按钮配置
 */
function getPhaseActionConfig(
  phase: GamePhase,
  subPhase: SubPhase | undefined,
  isFirstPlayerTurn: boolean
): {
  command: GameCommandType | 'OPEN_JUDGMENT' | null;
  buttonText: string;
  buttonStyle: string;
} | null {
  // 根据子阶段决定按钮
  if (subPhase && subPhase !== SubPhase.NONE) {
    if (
      subPhase === SubPhase.RESULT_SCORE_CONFIRM ||
      subPhase === SubPhase.RESULT_ANIMATION
    ) {
      return null;
    }

    // 演出判定阶段：显示专用判定按钮（打开 JudgmentPanel）
    if (subPhase === SubPhase.PERFORMANCE_JUDGMENT) {
      return {
        command: 'OPEN_JUDGMENT',
        buttonText: 'Live 判定',
        buttonStyle: 'from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400',
      };
    }

    if (subPhase === SubPhase.RESULT_SETTLEMENT) {
      return {
        command: GameCommandType.CONFIRM_STEP,
        buttonText: '确认结算',
        buttonStyle: 'from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400',
      };
    }

    if (isUserActionRequired(subPhase)) {
      return {
        command: GameCommandType.CONFIRM_STEP,
        buttonText: '确认完成',
        buttonStyle: 'from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400',
      };
    }

    return null; // 自动子阶段，不显示按钮
  }

  // 原有阶段按钮逻辑
  switch (phase) {
    case GamePhase.MAIN_PHASE:
      return {
        command: GameCommandType.END_PHASE,
        buttonText: 'Live Start!',
        buttonStyle: 'from-rose-500 to-pink-500 hover:from-rose-400 hover:to-pink-400',
      };
    case GamePhase.LIVE_SET_PHASE:
      return {
        command: GameCommandType.CONFIRM_STEP,
        buttonText: 'Live 准备就绪',
        buttonStyle: 'from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400',
      };
    case GamePhase.PERFORMANCE_PHASE:
      return {
        command: GameCommandType.CONFIRM_STEP,
        buttonText: isFirstPlayerTurn ? '进入后攻表演' : '进入结算阶段',
        buttonStyle: 'from-pink-500 to-purple-500 hover:from-pink-400 hover:to-purple-400',
      };
    default:
      return null;
  }
}

export const PhaseIndicator = memo(function PhaseIndicator({
  phase,
  turnNumber,
  onOpenJudgment,
}: PhaseIndicatorProps) {
  // 状态选择器
  const activeSeat = useGameStore((s) => s.getActiveSeatView());
  const permissionView = useGameStore((s) => s.getPermissionView());
  const matchView = useGameStore((s) => s.getMatchView());
  const capabilities = useGameStore(useShallow((s) => s.getBattleSurfaceCapabilities()));
  const isReadOnly = capabilities.isReadOnly;
  const canShowUndo = capabilities.undoPolicy !== 'NONE';
  const canUndoLastStep = useGameStore((s) => s.canUndoLastStep());
  const latestUndoLog = useGameStore((s) => {
    const latestLog = s.ui.logs[s.ui.logs.length - 1];
    return latestLog &&
      (latestLog.message === '已发送撤销请求' || latestLog.message.startsWith('请求撤销失败:'))
      ? latestLog
      : null;
  });
  const getCommandHint = useGameStore((s) => s.getCommandHint);
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView()) ?? SubPhase.NONE;
  const currentTurnCount = useGameStore((s) => s.getTurnCountView());
  const isInspectionWindow = matchView?.window?.windowType === 'INSPECTION';

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { endPhase, advancePhase, confirmSubPhase, undoLastStep } = useGameStore(
    useShallow((s) => ({
      endPhase: s.endPhase,
      advancePhase: s.advancePhase,
      confirmSubPhase: s.confirmSubPhase,
      undoLastStep: s.undoLastStep,
    }))
  );
  const [undoActionFeedback, setUndoActionFeedback] = useState<string | null>(null);
  const undoActionFeedbackTimeoutRef = useRef<number | null>(null);

  const showUndoActionFeedback = useCallback((message: string, durationMs = 3200) => {
    if (undoActionFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(undoActionFeedbackTimeoutRef.current);
    }
    setUndoActionFeedback(message);
    undoActionFeedbackTimeoutRef.current = window.setTimeout(() => {
      setUndoActionFeedback(null);
      undoActionFeedbackTimeoutRef.current = null;
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (undoActionFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(undoActionFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!latestUndoLog) return;
    showUndoActionFeedback(
      latestUndoLog.message === '已发送撤销请求'
        ? '请求已发送，等待对手回应'
        : latestUndoLog.message.replace(/^请求撤销失败:\s*/, '')
    );
  }, [latestUndoLog, showUndoActionFeedback]);

  const isMyTurn = useMemo(() => {
    if (isReadOnly) {
      return false;
    }
    if (isInspectionWindow) {
      return false;
    }
    if (permissionView) {
      return (permissionView.availableCommands ?? []).some((hint) => hint.enabled);
    }
    return false;
  }, [isInspectionWindow, isReadOnly, permissionView]);

  // 判断是否是先攻玩家的回合
  const isFirstPlayerTurn = activeSeat === 'FIRST';
  
  // 从配置中获取阶段和子阶段信息
  const phaseConfig = getPhaseConfig(phase);
  const subPhaseConfig = currentSubPhase !== SubPhase.NONE ? getSubPhaseConfig(currentSubPhase) : null;

  const info = phaseConfig?.display ?? { name: phase, colorClass: 'bg-slate-500' };
  const actionConfig = getPhaseActionConfig(phase, currentSubPhase, isFirstPlayerTurn);
  const actionHint =
    actionConfig?.command && actionConfig.command !== 'OPEN_JUDGMENT'
      ? getCommandHint(actionConfig.command)
      : null;
  const undoGrant = matchView?.undo?.grant ?? null;
  const hasViewerUndoGrant =
    !!undoGrant &&
    !!matchView?.viewerSeat &&
    undoGrant.requesterSeat === matchView.viewerSeat &&
    undoGrant.boundaryKey === matchView.undo?.entry?.boundaryKey;
  const undoButtonLabel =
    capabilities.undoPolicy === 'REMOTE_REQUEST'
      ? hasViewerUndoGrant
        ? '继续撤销'
        : '请求撤销'
      : '撤销上一步';
  const undoDisabledReason =
    matchView?.undo?.disabledReason ??
    (capabilities.undoPolicy === 'REMOTE_REQUEST'
      ? '当前没有可请求撤销的步骤'
      : '当前没有可撤销的步骤');

  // 是否显示操作按钮
  const showActionButton =
    !!actionConfig &&
    !isReadOnly &&
    !isInspectionWindow &&
    (actionConfig.command === 'OPEN_JUDGMENT' ? isMyTurn : actionHint?.enabled === true);

  const mainButtonIcon =
    currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT
        ? <BarChart3 size={16} />
        : currentSubPhase && currentSubPhase !== SubPhase.NONE
          ? <Check size={16} />
        : phase === GamePhase.MAIN_PHASE
          ? <Sparkles size={16} />
          : phase === GamePhase.PERFORMANCE_PHASE
            ? <Mic size={16} />
            : <Check size={16} />;

  // 处理主按钮点击
  const handleAction = () => {
    if (isReadOnly) {
      return;
    }

    // 演出判定阶段：打开判定面板（不直接 confirmSubPhase）
    if (currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT && onOpenJudgment) {
      onOpenJudgment();
      return;
    }

    // 如果有子阶段，确认子阶段完成
    if (currentSubPhase && currentSubPhase !== SubPhase.NONE) {
      confirmSubPhase(currentSubPhase);
      return;
    }
    
    if (phase === GamePhase.MAIN_PHASE) {
      // 主要阶段结束 -> 进入 Live 阶段
      endPhase();
    } else {
      // 其他阶段 -> 推进到下一阶段
      advancePhase();
    }
  };

  const handleUndoAction = () => {
    if (!canUndoLastStep) {
      showUndoActionFeedback(undoDisabledReason);
      return;
    }

    const result = undoLastStep();
    if (result.error) {
      showUndoActionFeedback(result.error);
      return;
    }
    if (result.pending && capabilities.undoPolicy === 'REMOTE_REQUEST') {
      showUndoActionFeedback('正在发送撤销请求…');
    }
  };

  return (
    <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] left-1/2 z-[var(--z-phase-indicator)] w-[calc(100vw-1rem)] max-w-[360px] -translate-x-1/2 md:bottom-4 md:left-auto md:right-4 md:top-auto md:w-auto md:max-w-[calc(100vw-2rem)] md:translate-x-0 md:translate-y-0">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full overflow-hidden rounded-[14px] border border-[color:color-mix(in_srgb,var(--border-default)_50%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_34%,transparent)] shadow-[var(--shadow-sm)] backdrop-blur-[2px] md:hidden"
      >
        <div className="px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <motion.div
              key={phase}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className={cn('h-2.5 w-2.5 shrink-0 rounded-full', info.colorClass)}
            />
            <span className="shrink-0 text-[11px] font-bold text-[var(--text-muted)]">
              T{currentTurnCount ?? turnNumber ?? '-'}
            </span>
            <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="shrink-0 text-xs font-bold text-[var(--text-primary)]">
                {info.name}
              </span>
              {subPhaseConfig && (
                <span className="min-w-0 truncate text-[11px] text-[var(--text-secondary)]">
                  {subPhaseConfig.display.icon} {subPhaseConfig.display.name}
                </span>
              )}
            </div>
            {showActionButton ? (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleAction}
                className={cn(
                  'inline-flex min-h-8 max-w-[128px] shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-bold',
                  'bg-gradient-to-r',
                  actionConfig.buttonStyle,
                  'text-white shadow-md transition-colors'
                )}
                style={{ fontSize: '11px' }}
              >
                <span className="inline-flex shrink-0 align-middle">{mainButtonIcon}</span>
                <span className="truncate">{actionConfig.buttonText}</span>
              </motion.button>
            ) : (
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 text-[10px]',
                  isMyTurn
                    ? 'text-[var(--semantic-success)]'
                    : 'bg-[var(--bg-overlay)] text-[var(--text-muted)]'
                )}
                style={isMyTurn ? { background: 'color-mix(in srgb, var(--semantic-success) 16%, transparent)' } : undefined}
              >
                {isReadOnly ? '回放' : isInspectionWindow ? '检视' : isMyTurn ? '我方' : '对手'}
              </span>
            )}
          </div>
        </div>
        {phase === GamePhase.GAME_END && (
          <div className="px-4 pb-2">
            <div className="flex items-center justify-center gap-2 text-center font-bold text-[var(--accent-gold)]">
              <Trophy size={16} />
              游戏结束
            </div>
          </div>
        )}
      </motion.div>

      <motion.div
        data-desktop-phase-dock
        initial={{ opacity: 0, x: 18, scale: 0.98 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="hidden min-h-12 items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_92%,transparent)] p-1.5 shadow-[var(--shadow-lg)] backdrop-blur-xl md:flex"
      >
        <div className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-2.5">
          <span className="font-mono text-[11px] font-bold tabular-nums text-[var(--text-muted)]">
            T{currentTurnCount ?? turnNumber ?? '-'}
          </span>
          <span className="h-4 w-px bg-[var(--border-subtle)]" aria-hidden="true" />
          <motion.span
            key={phase}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn('h-2.5 w-2.5 shrink-0 rounded-full', info.colorClass)}
            aria-hidden="true"
          />
          <span className="whitespace-nowrap text-xs font-bold text-[var(--text-primary)]">
            {info.name}阶段
          </span>
          {subPhaseConfig && (
            <span className="max-w-28 truncate text-[11px] font-medium text-[var(--text-secondary)]">
              {subPhaseConfig.display.icon} {subPhaseConfig.display.name}
            </span>
          )}
        </div>

        <span
          className={cn(
            'inline-flex h-8 shrink-0 items-center rounded-md border px-2 text-[11px] font-semibold',
            isMyTurn
              ? 'border-emerald-300/30 bg-emerald-500/10 text-[var(--semantic-success)]'
              : 'border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--text-muted)]'
          )}
        >
          {isReadOnly ? '回放' : isInspectionWindow ? '检视' : isMyTurn ? '我方行动' : '对手行动'}
        </span>

        {showActionButton && (
          <motion.button
            whileHover={{ scale: 1.015 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleAction}
            className={cn(
              'inline-flex h-9 max-w-40 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r px-3 font-bold text-white shadow-md',
              actionConfig.buttonStyle
            )}
            style={{ fontSize: '12px' }}
            title={actionConfig.buttonText}
          >
            <span className="inline-flex shrink-0">{mainButtonIcon}</span>
            <span className="truncate">{actionConfig.buttonText}</span>
          </motion.button>
        )}

        {canShowUndo && !isReadOnly && (
          <button
            type="button"
            onClick={handleUndoAction}
            aria-disabled={!canUndoLastStep}
            className={cn(
              'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 font-semibold transition active:scale-[0.98]',
              canUndoLastStep
                ? 'border-[var(--border-default)] bg-[var(--bg-overlay)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-overlay))]'
                : 'cursor-help border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_40%,transparent)] text-[var(--text-muted)]'
            )}
            style={{ fontSize: '11px' }}
            title={canUndoLastStep ? undoButtonLabel : undoDisabledReason}
          >
            <Undo2 size={13} />
            {undoButtonLabel}
          </button>
        )}

        {phase === GamePhase.GAME_END && (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 text-xs font-bold text-[var(--accent-gold)]">
            <Trophy size={14} />
            游戏结束
          </span>
        )}
      </motion.div>

      {undoActionFeedback && (
        <p
          role="status"
          aria-live="polite"
          className="absolute bottom-full right-0 mb-2 hidden w-64 rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] px-3 py-2 text-center font-medium leading-snug text-[var(--text-secondary)] shadow-[var(--shadow-md)] md:block"
          style={{ fontSize: '11px' }}
        >
          {undoActionFeedback}
        </p>
      )}
    </div>
  );
});

export default PhaseIndicator;
