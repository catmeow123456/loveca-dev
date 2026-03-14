/**
 * Live 判定结果动画组件
 * 显示 Live 成功/失败的全屏动画效果
 */

import { memo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

export type LiveResultType = 'success' | 'failure' | null;

/**
 * Live 分数信息
 */
export interface LiveScoreInfo {
  /** 己方分数 */
  selfScore: number;
  /** 对手分数 */
  opponentScore: number;
  /** 己方是否获胜 */
  selfWon: boolean;
  /** 对手是否获胜 */
  opponentWon: boolean;
  /** 是否平局（双方都赢） */
  isDraw: boolean;
}

interface LiveResultAnimationProps {
  /** 结果类型 */
  result: LiveResultType;
  /** 分数信息 */
  scoreInfo?: LiveScoreInfo | null;
  /** 动画结束回调 */
  onComplete?: () => void;
  /** 动画持续时间 (ms) */
  duration?: number;
}

export const LiveResultAnimation = memo(function LiveResultAnimation({
  result,
  scoreInfo,
  onComplete,
  duration = 2500,
}: LiveResultAnimationProps) {
  // 使用 ref 追踪上一次的 result，避免重复触发
  const prevResultRef = useRef<LiveResultType>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 直接使用 result 作为可见性判断
  const visible = result !== null;

  // 仅在 result 从 null 变为非 null 时启动定时器
  useEffect(() => {
    if (result !== null && prevResultRef.current === null) {
      // 清除之前的定时器
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      // 启动新定时器
      timerRef.current = setTimeout(() => {
        onComplete?.();
      }, duration);
    }
    prevResultRef.current = result;

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [result, duration, onComplete]);

  const config = result === 'success'
    ? {
        text: '🎉 LIVE SUCCESS!',
        subText: '演出成功！',
        bgClass: 'from-amber-500/30 via-yellow-500/20 to-orange-500/30',
        textClass: 'text-amber-400',
        glowClass: 'shadow-amber-500/50',
      }
    : {
        text: '💔 LIVE FAILED',
        subText: '演出失败...',
        bgClass: 'from-slate-500/30 via-gray-500/20 to-slate-600/30',
        textClass: 'text-slate-400',
        glowClass: 'shadow-slate-500/50',
      };

  return (
    <AnimatePresence>
      {visible && result && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center"
        >
          {/* 背景渐变 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn(
              'absolute inset-0 bg-gradient-to-br',
              config.bgClass
            )}
          />

          {/* 主要内容 */}
          <motion.div
            initial={{ scale: 0.5, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: -20 }}
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 20,
            }}
            className="relative z-10 text-center"
          >
            {/* 主标题 */}
            <motion.h1
              initial={{ letterSpacing: '0.5em', opacity: 0 }}
              animate={{ letterSpacing: '0.1em', opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className={cn(
                'text-5xl md:text-7xl font-black',
                config.textClass,
                'drop-shadow-2xl',
                config.glowClass
              )}
              style={{
                textShadow: result === 'success'
                  ? '0 0 40px rgba(251, 191, 36, 0.8), 0 0 80px rgba(251, 191, 36, 0.4)'
                  : '0 0 40px rgba(100, 116, 139, 0.6)',
              }}
            >
              {config.text}
            </motion.h1>

            {/* 副标题 */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.3 }}
              className={cn('text-xl md:text-2xl mt-4 font-bold', config.textClass)}
            >
              {config.subText}
            </motion.p>

            {/* 分数展示 */}
            {scoreInfo && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7, duration: 0.4 }}
                className="mt-6 flex items-center justify-center gap-8"
              >
                {/* 己方分数 */}
                <div className={cn(
                  'flex flex-col items-center px-6 py-3 rounded-lg',
                  scoreInfo.selfWon ? 'bg-amber-500/20' : 'bg-slate-700/50'
                )}>
                  <span className="text-slate-400 text-sm">己方</span>
                  <span className={cn(
                    'text-4xl font-black',
                    scoreInfo.selfWon ? 'text-amber-400' : 'text-slate-300'
                  )}>
                    {scoreInfo.selfScore}
                  </span>
                  {scoreInfo.selfWon && (
                    <span className="text-amber-400 text-xs mt-1">🏆 WIN</span>
                  )}
                </div>

                {/* VS */}
                <div className="text-slate-500 text-2xl font-bold">VS</div>

                {/* 对手分数 */}
                <div className={cn(
                  'flex flex-col items-center px-6 py-3 rounded-lg',
                  scoreInfo.opponentWon ? 'bg-rose-500/20' : 'bg-slate-700/50'
                )}>
                  <span className="text-slate-400 text-sm">对手</span>
                  <span className={cn(
                    'text-4xl font-black',
                    scoreInfo.opponentWon ? 'text-rose-400' : 'text-slate-300'
                  )}>
                    {scoreInfo.opponentScore}
                  </span>
                  {scoreInfo.opponentWon && !scoreInfo.selfWon && (
                    <span className="text-rose-400 text-xs mt-1">🏆 WIN</span>
                  )}
                </div>
              </motion.div>
            )}

            {/* 平局提示 */}
            {scoreInfo?.isDraw && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1, duration: 0.3 }}
                className="text-amber-300 text-lg mt-4"
              >
                ⚡ 双方平局！
              </motion.p>
            )}

            {/* 成功时的星星特效 */}
            {result === 'success' && (
              <motion.div
                className="absolute inset-0 pointer-events-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                {[...Array(8)].map((_, i) => (
                  <motion.span
                    key={i}
                    initial={{
                      opacity: 0,
                      scale: 0,
                      x: 0,
                      y: 0,
                    }}
                    animate={{
                      opacity: [0, 1, 0],
                      scale: [0, 1.5, 0],
                      x: Math.cos((i / 8) * Math.PI * 2) * 150,
                      y: Math.sin((i / 8) * Math.PI * 2) * 100,
                    }}
                    transition={{
                      delay: 0.3 + i * 0.1,
                      duration: 1,
                    }}
                    className="absolute top-1/2 left-1/2 text-3xl"
                  >
                    ⭐
                  </motion.span>
                ))}
              </motion.div>
            )}
          </motion.div>

          {/* 底部光晕 */}
          {result === 'success' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 0.5, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[200%] h-32 bg-gradient-to-t from-amber-500/40 to-transparent blur-3xl"
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default LiveResultAnimation;
