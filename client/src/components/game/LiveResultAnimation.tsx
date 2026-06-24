/**
 * Live 胜者动画组件
 * 仅在当前观察者属于本轮胜者时显示全屏结果动画
 */

import { memo, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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

const BEAM_STREAKS = [
  { top: '18%', rotate: -10, delay: 0.08, width: '44vw' },
  { top: '32%', rotate: -8, delay: 0.18, width: '58vw' },
  { top: '62%', rotate: -11, delay: 0.28, width: '50vw' },
  { top: '76%', rotate: -9, delay: 0.38, width: '38vw' },
] as const;

export const LiveResultAnimation = memo(function LiveResultAnimation({
  visible,
  isViewerWinner,
  scoreInfo,
  onComplete,
  duration = 2800,
}: LiveResultAnimationProps) {
  const reduceMotion = useReducedMotion();
  const prevVisibleRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxScore = useMemo(
    () => Math.max(scoreInfo?.selfScore ?? 0, scoreInfo?.opponentScore ?? 0, 1),
    [scoreInfo?.opponentScore, scoreInfo?.selfScore]
  );

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

  const title = scoreInfo?.isDraw ? 'DOUBLE VICTORY' : 'LIVE VICTORY';
  const subtitle = scoreInfo?.isDraw ? '双方 Live 成功' : '本轮 Live 胜利';

  return (
    <AnimatePresence>
      {visible && isViewerWinner && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center overflow-hidden px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0.08 : 0.18 }}
        >
          <motion.div
            className="absolute inset-0 bg-[rgba(255,248,252,0.24)] backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.08 : 0.22 }}
          />

          <motion.div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, color-mix(in srgb, white 14%, transparent) 0%, color-mix(in srgb, var(--semantic-info) 20%, transparent) 42%, color-mix(in srgb, white 10%, transparent) 100%), linear-gradient(112deg, transparent 0%, color-mix(in srgb, var(--accent-primary) 16%, transparent) 44%, transparent 64%), linear-gradient(68deg, transparent 12%, color-mix(in srgb, var(--accent-gold) 12%, transparent) 52%, transparent 88%)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: reduceMotion ? 0.72 : [0, 0.95, 0.78] }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 1.2, ease: [0.2, 0.8, 0.2, 1] }}
          />

          {!reduceMotion &&
            BEAM_STREAKS.map((streak, index) => (
              <motion.span
                key={index}
                className="absolute left-[-28vw] h-px origin-left bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--accent-primary)_58%,white),color-mix(in_srgb,var(--semantic-info)_68%,white),transparent)] shadow-[0_0_14px_color-mix(in_srgb,var(--semantic-info)_34%,transparent)]"
                style={{
                  top: streak.top,
                  width: streak.width,
                  rotate: `${streak.rotate}deg`,
                }}
                initial={{ x: '-20vw', opacity: 0 }}
                animate={{ x: '150vw', opacity: [0, 0.92, 0.72, 0] }}
                transition={{
                  delay: streak.delay,
                  duration: 1.15,
                  ease: [0.2, 0.72, 0.16, 1],
                }}
              />
            ))}

          <motion.div
            className="relative z-10 flex w-full max-w-[760px] flex-col items-center text-center"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.985 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.995 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.34, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <motion.div
              className="mb-4 flex items-center gap-3 text-[11px] font-bold uppercase text-[color:color-mix(in_srgb,var(--semantic-info)_72%,white)]"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduceMotion ? 0 : 0.12, duration: 0.22 }}
            >
              <span className="h-px w-10 bg-[color:color-mix(in_srgb,var(--semantic-info)_62%,transparent)]" />
              <span>LIVE RESULT</span>
              <span className="h-px w-10 bg-[color:color-mix(in_srgb,var(--semantic-info)_62%,transparent)]" />
            </motion.div>

            <motion.h1
              className="text-4xl font-black leading-none text-[color:color-mix(in_srgb,white_58%,var(--semantic-info))] sm:text-5xl md:text-6xl"
              style={{
                textShadow:
                  '0 1px 0 rgba(255,255,255,0.36), 0 12px 28px rgba(0,0,0,0.34), 0 0 26px color-mix(in srgb, var(--semantic-info) 42%, transparent)',
              }}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, filter: 'blur(6px)' }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: reduceMotion ? 0 : 0.2, duration: 0.34, ease: [0.2, 0.8, 0.2, 1] }}
            >
              {title}
            </motion.h1>

            <motion.div
              className="mt-3 flex items-center gap-2 text-sm font-semibold text-[color:color-mix(in_srgb,var(--text-primary)_86%,transparent)]"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduceMotion ? 0 : 0.34, duration: 0.22 }}
            >
              <span className="h-2 w-2 rotate-45 bg-[var(--accent-primary)] shadow-[0_0_12px_color-mix(in_srgb,var(--accent-primary)_70%,transparent)]" />
              <span>{subtitle}</span>
              <span className="h-2 w-2 rotate-45 bg-[var(--accent-gold)] shadow-[0_0_12px_color-mix(in_srgb,var(--accent-gold)_62%,transparent)]" />
            </motion.div>

            {scoreInfo && (
              <motion.div
                className="mt-8 w-full border-y border-[color:color-mix(in_srgb,var(--semantic-info)_38%,white)] bg-[color:color-mix(in_srgb,white_30%,var(--bg-frosted))] px-3 py-4 shadow-[0_14px_38px_rgba(80,100,130,0.22)] backdrop-blur-md sm:px-5"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                transition={{ delay: reduceMotion ? 0 : 0.48, duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <ScoreLane
                    label="己方"
                    score={scoreInfo.selfScore}
                    won={scoreInfo.selfWon}
                    maxScore={maxScore}
                    reduceMotion={reduceMotion}
                    align="right"
                  />
                  <div className="hidden h-14 w-px bg-[color:color-mix(in_srgb,var(--border-default)_70%,transparent)] sm:block" />
                  <ScoreLane
                    label="对手"
                    score={scoreInfo.opponentScore}
                    won={scoreInfo.opponentWon}
                    maxScore={maxScore}
                    reduceMotion={reduceMotion}
                    align="left"
                  />
                </div>
              </motion.div>
            )}

            <motion.div
              className="mt-5 h-px w-[min(62vw,420px)] bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--semantic-info)_72%,white),color-mix(in_srgb,var(--accent-gold)_56%,white),transparent)]"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ delay: reduceMotion ? 0 : 0.62, duration: reduceMotion ? 0.1 : 0.36 }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

function ScoreLane({
  label,
  score,
  won,
  maxScore,
  reduceMotion,
  align,
}: {
  readonly label: string;
  readonly score: number;
  readonly won: boolean;
  readonly maxScore: number;
  readonly reduceMotion: boolean | null;
  readonly align: 'left' | 'right';
}) {
  const percent = Math.max(8, Math.min(100, (score / maxScore) * 100));
  const alignClass = align === 'right' ? 'sm:items-end sm:text-right' : 'sm:items-start sm:text-left';
  const headerClass = align === 'right' ? 'sm:flex-row-reverse' : '';
  const scoreRowClass = align === 'right' ? 'sm:flex-row-reverse' : '';
  const trackJustifyClass = align === 'right' ? 'sm:justify-end' : 'sm:justify-start';

  return (
    <div className={cn('flex min-w-0 flex-col gap-2', alignClass)}>
      <div className={cn('flex h-6 w-full items-center gap-2', headerClass)}>
        <span className="block text-xs font-semibold text-[color:color-mix(in_srgb,white_38%,var(--text-secondary))]">
          {label}
        </span>
        <span
          className={cn(
            'inline-flex h-5 min-w-12 items-center justify-center border px-2 text-[10px] font-bold',
            won
              ? 'border-[color:color-mix(in_srgb,var(--accent-gold)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-gold)_12%,transparent)] text-[color:color-mix(in_srgb,var(--accent-gold-light)_76%,white)]'
              : 'invisible border-transparent'
          )}
        >
          WIN
        </span>
      </div>
      <div className={cn('flex min-h-11 w-full items-end gap-3', scoreRowClass)}>
        <motion.span
          className={cn(
            'block min-w-[3ch] text-4xl font-black leading-none',
            won
              ? 'text-[color:color-mix(in_srgb,var(--accent-gold-light)_68%,white)]'
              : 'text-[color:color-mix(in_srgb,white_34%,var(--text-primary))]'
          )}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ delay: reduceMotion ? 0 : 0.58, duration: 0.24 }}
        >
          {score}
        </motion.span>
        <div className="min-w-0 flex-1 pb-2">
          <div
            className={cn(
              'flex h-2 overflow-hidden bg-[color:color-mix(in_srgb,white_20%,var(--bg-overlay))]',
              trackJustifyClass
            )}
          >
            <motion.span
              className={cn(
                'block h-full',
                won
                  ? 'bg-[linear-gradient(90deg,color-mix(in_srgb,var(--semantic-info)_88%,white),color-mix(in_srgb,var(--accent-primary)_72%,white),color-mix(in_srgb,var(--accent-gold)_68%,white))]'
                  : 'bg-[color:color-mix(in_srgb,white_30%,var(--text-muted))]'
              )}
              initial={{ width: '0%' }}
              animate={{ width: `${percent}%` }}
              transition={{
                delay: reduceMotion ? 0 : 0.62,
                duration: reduceMotion ? 0.1 : 0.42,
                ease: [0.2, 0.8, 0.2, 1],
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default LiveResultAnimation;
