/**
 * 效果发动窗口 (Modal)
 * 在效果发动窗口时点显示，提示玩家可发动的能力
 * 
 * 核心设计原则：信任用户手动操作，不自动执行卡牌效果
 */

import { memo, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { SubPhase, EffectWindowType } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';

interface EffectWindowProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 效果窗口类型配置
 */
const effectWindowConfig: Record<EffectWindowType, {
  title: string;
  icon: string;
  description: string;
  color: string;
}> = {
  [EffectWindowType.NONE]: {
    title: '',
    icon: '',
    description: '',
    color: 'bg-slate-500',
  },
  [EffectWindowType.LIVE_START]: {
    title: 'Live 开始时效果',
    icon: '⚡',
    description: '现在可以发动【Live开始时】效果。请手动执行效果后点击"确认完成"。',
    color: 'bg-pink-500',
  },
  [EffectWindowType.LIVE_SUCCESS]: {
    title: 'Live 成功时效果',
    icon: '🎉',
    description: '现在可以发动【Live成功时】效果。请手动执行效果后点击"确认完成"。',
    color: 'bg-emerald-500',
  },
  [EffectWindowType.AUTO_ABILITY]: {
    title: '自动能力发动',
    icon: '🔄',
    description: '有自动能力需要处理。请手动执行效果后点击"确认完成"。',
    color: 'bg-purple-500',
  },
};

/**
 * 子阶段对应的效果窗口类型
 */
function getEffectWindowType(subPhase: SubPhase): EffectWindowType {
  switch (subPhase) {
    case SubPhase.PERFORMANCE_LIVE_START_EFFECTS:
      return EffectWindowType.LIVE_START;
    case SubPhase.RESULT_FIRST_SUCCESS_EFFECTS:
    case SubPhase.RESULT_SECOND_SUCCESS_EFFECTS:
      return EffectWindowType.LIVE_SUCCESS;
    case SubPhase.EFFECT_WINDOW:
      return EffectWindowType.AUTO_ABILITY;
    default:
      return EffectWindowType.NONE;
  }
}

/**
 * 可发动能力的占位提示
 * 实际项目中应该从游戏状态中获取真实的可发动能力列表
 */
const AbilityHints = memo(function AbilityHints() {
  const gameState = useGameStore((s) => s.gameState);
  
  // TODO: 实现真实的能力检测逻辑
  // 目前仅作为占位显示
  
  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-400 mb-2">
        💡 提示：以下能力可能可以发动（需手动确认）
      </div>
      <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
        <div className="text-xs text-slate-500 text-center">
          暂无检测到的可发动能力
        </div>
      </div>
      <div className="text-xs text-slate-500 mt-2">
        请检查场上成员卡的能力文本，手动执行需要的效果。
      </div>
    </div>
  );
});

/**
 * 操作提示区域
 */
const OperationHints = memo(function OperationHints() {
  return (
    <div className="mt-4 p-3 bg-amber-500/10 rounded-lg border border-amber-500/30">
      <div className="text-sm font-medium text-amber-400 mb-2">📋 自由操作说明</div>
      <ul className="text-xs text-slate-300 space-y-1">
        <li>• 拖拽卡牌到目标区域执行移动</li>
        <li>• 点击卡组顶部抽取卡牌</li>
        <li>• 使用撤销按钮可回退操作</li>
        <li>• 完成后点击"确认完成"继续游戏</li>
      </ul>
    </div>
  );
});

export const EffectWindow = memo(function EffectWindow({
  isOpen,
  onClose,
}: EffectWindowProps) {
  // 状态选择器
  const gameState = useGameStore((s) => s.gameState);

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { confirmSubPhase, undoOperation } = useGameStore(
    useShallow((s) => ({
      confirmSubPhase: s.confirmSubPhase,
      undoOperation: s.undoOperation,
    }))
  );

  const currentSubPhase = gameState?.currentSubPhase ?? SubPhase.NONE;
  const effectType = getEffectWindowType(currentSubPhase);
  const config = effectWindowConfig[effectType];

  // 处理确认完成
  const handleConfirm = useCallback(() => {
    confirmSubPhase(currentSubPhase);
    onClose();
  }, [confirmSubPhase, currentSubPhase, onClose]);

  // 处理跳过
  const handleSkip = useCallback(() => {
    // 跳过效果直接确认完成
    confirmSubPhase(currentSubPhase);
    onClose();
  }, [confirmSubPhase, currentSubPhase, onClose]);

  // 处理撤销
  const handleUndo = useCallback(() => {
    undoOperation();
  }, [undoOperation]);

  // ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
      // Ctrl+Z 撤销
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };

    if (isOpen && effectType !== EffectWindowType.NONE) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose, handleUndo, effectType]);

  // 如果不是效果发动窗口，不显示
  if (effectType === EffectWindowType.NONE) {
    return null;
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-[100]"
            onClick={onClose}
          />

          {/* 弹窗内容 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-full max-w-md"
          >
            <div className="bg-slate-900 rounded-xl border border-slate-700 shadow-2xl overflow-hidden">
              {/* 标题栏 */}
              <div className={cn('px-6 py-4 border-b border-slate-700', config.color + '/20')}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{config.icon}</span>
                  <h2 className="text-lg font-bold text-white">{config.title}</h2>
                </div>
              </div>

              {/* 内容区域 */}
              <div className="px-6 py-4">
                {/* 说明文本 */}
                <p className="text-sm text-slate-300 leading-relaxed">
                  {config.description}
                </p>

                {/* 可发动能力列表 */}
                <div className="mt-4">
                  <AbilityHints />
                </div>

                {/* 操作提示 */}
                <OperationHints />

                {/* 操作历史 */}
                {gameState && gameState.operationHistory.length > 0 && (
                  <div className="mt-4 p-3 bg-slate-800/50 rounded-lg">
                    <div className="text-xs text-slate-400">
                      本窗口已执行 <span className="text-white font-bold">{gameState.operationHistory.length}</span> 步操作
                    </div>
                  </div>
                )}
              </div>

              {/* 按钮区域 */}
              <div className="px-6 py-4 bg-slate-800/50 border-t border-slate-700 flex gap-3">
                {/* 跳过按钮 */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleSkip}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                >
                  ⏭️ 跳过效果
                </motion.button>

                {/* 撤销按钮 */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleUndo}
                  className="py-2.5 px-4 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                >
                  ↩️
                </motion.button>

                {/* 确认按钮 */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleConfirm}
                  className={cn(
                    'flex-1 py-2.5 rounded-lg text-sm font-bold',
                    'bg-gradient-to-r from-emerald-500 to-green-500',
                    'hover:from-emerald-400 hover:to-green-400',
                    'text-white shadow-lg transition-colors'
                  )}
                >
                  ✅ 确认完成
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});

export default EffectWindow;
