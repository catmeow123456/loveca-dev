/**
 * Live 胜者动画组件
 * 仅在当前观察者属于本轮胜者时显示全屏结果动画
 */

import { memo, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';

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
  /** 是否显示胜者动画 */
  visible: boolean;
  /** 当前观察者是否为胜者 */
  isViewerWinner: boolean;
  /** 分数信息 */
  scoreInfo?: LiveScoreInfo | null;
  /** 动画结束回调 */
  onComplete?: () => void;
  /** 动画持续时间 (ms) */
  duration?: number;
}

export const LiveResultAnimation = memo(function LiveResultAnimation({
  visible,
  isViewerWinner,
  scoreInfo,
  onComplete,
  duration = 2500,
}: LiveResultAnimationProps) {
  const prevVisibleRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        onComplete?.();
      }, duration);
    }
    prevVisibleRef.current = visible;

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [duration, onComplete, visible]);

  const title = scoreInfo?.isDraw ? 'DOUBLE VICTORY!' : 'LIVE VICTORY!';
  const subtitle = scoreInfo?.isDraw ? '双方都赢下了本轮 Live！' : '你赢下了本轮 Live！';

  return (
    <AnimatePresence>
      {visible && isViewerWinner && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(251,191,36,0.28),transparent_62%)]"
          />

          <motion.div
            initial={{ scale: 0.5, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.85, opacity: 0, y: -16 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
            className="relative z-10 text-center"
          >
            <motion.h1
              initial={{ letterSpacing: '0.5em', opacity: 0 }}
              animate={{ letterSpacing: '0.08em', opacity: 1 }}
              transition={{ delay: 0.15, duration: 0.45 }}
              className={cn(
                'text-5xl md:text-7xl font-black text-[var(--accent-gold)] drop-shadow-2xl'
              )}
              style={{
                textShadow:
                  '0 0 40px rgba(251, 191, 36, 0.8), 0 0 80px rgba(251, 191, 36, 0.35)',
              }}
            >
              {title}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.3 }}
              className="mt-4 text-xl font-bold text-amber-100 md:text-2xl"
            >
              {subtitle}
            </motion.p>

            {scoreInfo && (
              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.65, duration: 0.35 }}
                className="mt-6 flex items-center justify-center gap-8"
              >
                <div
                  className={cn(
                    'flex flex-col items-center rounded-lg px-6 py-3',
                    scoreInfo.selfWon ? 'bg-amber-500/20' : 'bg-slate-700/50'
                  )}
                >
                  <span className="text-sm text-slate-300">己方</span>
                  <span
                    className={cn(
                      'text-4xl font-black',
                      scoreInfo.selfWon ? 'text-amber-300' : 'text-slate-200'
                    )}
                  >
                    {scoreInfo.selfScore}
                  </span>
                </div>

                <div className="text-2xl font-bold text-amber-200/70">VS</div>

                <div
                  className={cn(
                    'flex flex-col items-center rounded-lg px-6 py-3',
                    scoreInfo.opponentWon ? 'bg-amber-500/20' : 'bg-slate-700/50'
                  )}
                >
                  <span className="text-sm text-slate-300">对手</span>
                  <span
                    className={cn(
                      'text-4xl font-black',
                      scoreInfo.opponentWon ? 'text-amber-300' : 'text-slate-200'
                    )}
                  >
                    {scoreInfo.opponentScore}
                  </span>
                </div>
              </motion.div>
            )}

            <motion.div
              className="absolute inset-0 pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              {[...Array(12)].map((_, index) => {
                const hue = (index % 6) * 55;
                return (
                  <motion.span
                    key={index}
                    initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                    animate={{
                      opacity: [0, 1, 0],
                      scale: [0, 1.6, 0],
                      x: Math.cos((index / 12) * Math.PI * 2) * 180,
                      y: Math.sin((index / 12) * Math.PI * 2) * 110,
                    }}
                    transition={{ delay: 0.25 + index * 0.06, duration: 1 }}
                    className="absolute left-1/2 top-1/2 text-3xl"
                    style={{ filter: `drop-shadow(0 0 10px hsla(${hue}, 90%, 70%, 0.9))` }}
                  >
                    ✦
                  </motion.span>
                );
              })}
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.65 }}
            animate={{ opacity: 0.5, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45 }}
            className="absolute bottom-0 left-1/2 h-32 w-[200%] -translate-x-1/2 bg-gradient-to-t from-amber-500/40 to-transparent blur-3xl"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default LiveResultAnimation;
