/**
 * 阶段指示器
 * 显示当前游戏阶段、子阶段和回合数，提供阶段流转按钮
 */

import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Check, Mic, Sparkles, Trophy } from 'lucide-react';
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
  const getCommandHint = useGameStore((s) => s.getCommandHint);
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView()) ?? SubPhase.NONE;
  const currentTurnCount = useGameStore((s) => s.getTurnCountView());
  const isInspectionWindow = matchView?.window?.windowType === 'INSPECTION';

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { endPhase, advancePhase, confirmSubPhase } = useGameStore(
    useShallow((s) => ({
      endPhase: s.endPhase,
      advancePhase: s.advancePhase,
      confirmSubPhase: s.confirmSubPhase,
    }))
  );

  const isMyTurn = useMemo(() => {
    if (isInspectionWindow) {
      return false;
    }
    if (permissionView) {
      return (permissionView.availableCommands ?? []).some((hint) => hint.enabled);
    }
    return false;
  }, [isInspectionWindow, permissionView]);

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

  // 是否显示操作按钮
  const showActionButton =
    !!actionConfig &&
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

  return (
    <div className="fixed right-4 bottom-4 z-[var(--z-phase-indicator)]">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-64 overflow-hidden rounded-[18px] border border-[var(--border-default)] bg-[var(--bg-frosted)] shadow-[var(--shadow-lg)] backdrop-blur-xl"
      >
        {turnNumber !== undefined && (
          <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-1 text-center">
            <span className="text-xs text-[var(--text-muted)]">回合</span>
            <span className="ml-2 text-lg font-bold text-[var(--text-primary)]">
              {currentTurnCount ?? turnNumber}
            </span>
          </div>
        )}

        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            <motion.div
              key={phase}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className={cn('w-3 h-3 rounded-full', info.colorClass)}
            />
            <span className="text-sm font-bold text-[var(--text-primary)]">{info.name}阶段</span>
          </div>

          {subPhaseConfig && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="mt-2 ml-5 flex items-center gap-2 text-xs text-[var(--text-secondary)]"
            >
              <span className="text-base">{subPhaseConfig.display.icon}</span>
              <span className="font-medium">{subPhaseConfig.display.name}</span>
              {subPhaseConfig.display.requiresUserAction && (
                <span className="rounded px-1.5 py-0.5 text-xs text-[var(--semantic-warning)]" style={{ background: 'color-mix(in srgb, var(--semantic-warning) 16%, transparent)' }}>
                  需要操作
                </span>
              )}
            </motion.div>
          )}

          <div
            className={cn(
              'mt-2 text-xs px-2 py-1 rounded text-center',
              isMyTurn
                ? 'text-[var(--semantic-success)]'
                : 'bg-[var(--bg-overlay)] text-[var(--text-muted)]'
            )}
            style={isMyTurn ? { background: 'color-mix(in srgb, var(--semantic-success) 16%, transparent)' } : undefined}
          >
            {isInspectionWindow ? '检视处理中' : isMyTurn ? '你的回合' : '对手回合'}
          </div>
        </div>

        {showActionButton && (
          <div className="px-4 pb-3 space-y-2">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleAction}
              className={cn(
                'w-full py-2 rounded-lg text-sm font-bold',
                'bg-gradient-to-r',
                actionConfig.buttonStyle,
                'text-white shadow-lg transition-colors'
              )}
            >
              <span className="mr-2 inline-flex align-middle">{mainButtonIcon}</span>
              {actionConfig.buttonText}
            </motion.button>
          </div>
        )}

        {phase === GamePhase.GAME_END && (
          <div className="px-4 pb-3">
            <div className="flex items-center justify-center gap-2 text-center font-bold text-[var(--accent-gold)]">
              <Trophy size={16} />
              游戏结束
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
});

export default PhaseIndicator;
