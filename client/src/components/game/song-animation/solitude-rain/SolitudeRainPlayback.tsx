import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MotionConfigContext } from 'framer-motion';
import { HeartColor } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';
import { collectBattleAnimationAnchors } from '@/lib/battleAnimationEvents';
import { getPublicStageMemberTarget, sameEntranceTarget } from '@/lib/cardEntranceLanding';
import type { EffectImageCache } from '@/lib/effectImageCache';
import { HEART_ICON_SOURCE_BY_COLOR } from '@/lib/modifierIconAssets';
import {
  SOLITUDE_RAIN_DURATION,
  SOLITUDE_RAIN_HEART_AT,
  SOLITUDE_RAIN_SCORE_AT,
  type SolitudeRainPresentation,
} from '@/lib/solitudeRain';
import { EffectFeedbackValue } from '../../EffectFeedbackLayer';
import { prepareSolitudeRainImages } from './solitudeRainLoading';
import { createRainRenderer, ease, type Rect } from './solitudeRainRenderer';
import './solitudeRain.css';

export type SolitudeRainFrameStats = {
  frames: number;
  medianIntervalMs: number;
  p95IntervalMs: number;
  maxIntervalMs: number;
  p95DrawMs: number;
  maxDrawMs: number;
  slowFrames: number;
};

/** Same scene and timing for real commands and cosmetic replay. Only the shared barrier ACKs. */
export function SolitudeRainPlayback({
  source,
  images,
  reduced: deviceReduced,
  onDone,
  holdAt,
  timeScale = 1,
  onFrameStats,
}: {
  source: SolitudeRainPresentation;
  images: EffectImageCache;
  reduced: boolean;
  onDone: () => void;
  holdAt?: number;
  timeScale?: number;
  onFrameStats?: (stats: SolitudeRainFrameStats) => void;
}) {
  const motion = useContext(MotionConfigContext);
  const reduced = deviceReduced || motion.reducedMotion === 'always';
  const done = useRef(onDone);
  done.current = onDone;
  const statsReceiver = useRef(onFrameStats);
  statsReceiver.current = onFrameStats;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<HTMLImageElement[] | null>(null);
  const [frame, setFrame] = useState<{
    t: number;
    target: Rect;
    song?: Rect;
    minimal: boolean;
  } | null>(null);
  const valid = useGameStore((s) =>
    sameEntranceTarget(
      source.target,
      getPublicStageMemberTarget(s.playerViewState, source.target.objectId)
    )
  );
  useEffect(() => {
    if (!valid) done.current();
  }, [valid]);
  useEffect(() => {
    const controller = new AbortController();
    prepareSolitudeRainImages(images, [HEART_ICON_SOURCE_BY_COLOR.PURPLE], controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setLoaded(result);
      },
      () => {
        if (!controller.signal.aborted) done.current();
      }
    );
    return () => controller.abort();
  }, [source, images]);
  useLayoutEffect(() => {
    if (!loaded || !valid) return;
    if (!canvas.current) {
      done.current();
      return;
    }
    const anchors = collectBattleAnimationAnchors().cards;
    const target = anchors.get(source.target.objectId),
      song = anchors.get(source.sourceObjectId);
    if (!target?.width || !target.height) {
      done.current();
      return;
    }
    const surface = canvas.current;
    const renderer = reduced ? null : createRainRenderer(surface);
    const minimal = reduced || !renderer;
    // Lighting follows the real public card; its face is never substituted or occluded.
    const start = performance.now();
    let raf = 0;
    let previousFrame = 0;
    const intervals: number[] = [],
      draws: number[] = [];
    const measuring = holdAt === undefined && !!statsReceiver.current;
    const report = () => {
      if (!measuring || !intervals.length) return;
      const sorted = [...intervals].sort((a, b) => a - b);
      const sortedDraws = [...draws].sort((a, b) => a - b);
      const percentile = (values: number[], p: number) =>
        values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
      statsReceiver.current?.({
        frames: draws.length,
        medianIntervalMs: percentile(sorted, 0.5),
        p95IntervalMs: percentile(sorted, 0.95),
        maxIntervalMs: sorted.at(-1) ?? 0,
        p95DrawMs: percentile(sortedDraws, 0.95),
        maxDrawMs: sortedDraws.at(-1) ?? 0,
        slowFrames: intervals.filter((ms) => ms > 25).length,
      });
    };
    const tick = (now: number) => {
      const elapsed = holdAt ?? (now - start) * timeScale;
      if (holdAt === undefined && elapsed >= (minimal ? 550 : SOLITUDE_RAIN_DURATION)) {
        report();
        done.current();
        return;
      }
      const t = minimal ? SOLITUDE_RAIN_SCORE_AT + 80 : elapsed;
      const drawStart = measuring ? performance.now() : 0;
      renderer?.draw(t, target, song, source.convertedHeartCount, source.scoreBonus);
      if (measuring) {
        draws.push(performance.now() - drawStart);
        if (previousFrame) intervals.push(now - previousFrame);
        previousFrame = now;
      }
      setFrame({ t, target, song, minimal });
      if (holdAt === undefined) raf = requestAnimationFrame(tick);
    };
    tick(start);
    const cancel = () => done.current();
    window.addEventListener('resize', cancel);
    window.addEventListener('scroll', cancel, true);
    surface.addEventListener('contextlost', cancel);
    return () => {
      cancelAnimationFrame(raf);
      renderer?.dispose();
      window.removeEventListener('resize', cancel);
      window.removeEventListener('scroll', cancel, true);
      surface.removeEventListener('contextlost', cancel);
    };
  }, [source, loaded, valid, reduced, holdAt, timeScale]);
  const badge = (kind: 'HEART' | 'SCORE', rect: Rect, start: number, delta: number) => {
    if (!frame || frame.t < start || delta <= 0) return null;
    const minimal = frame.minimal;
    const alpha = minimal
      ? 1
      : ease((frame.t - start) / 75) * (1 - ease((frame.t - (SOLITUDE_RAIN_DURATION - 150)) / 150));
    return (
      <div
        className={`effect-result-label solitude-rain-value ${kind === 'HEART' ? 'effect-result-label--gain' : ''}`}
        data-solitude-feedback={kind}
        style={{
          left: Math.max(38, Math.min(innerWidth - 38, rect.left + rect.width / 2)),
          top: Math.max(
            8,
            rect.top + rect.height * 0.27 - (minimal ? 0 : ease((frame.t - start) / 400) * 10)
          ),
          opacity: alpha,
          transform: `translateX(-50%) scale(${minimal ? 1 : 0.9 + 0.1 * ease((frame.t - start) / 110)})`,
        }}
      >
        <EffectFeedbackValue
          change={kind === 'HEART' ? { kind, color: HeartColor.PURPLE, delta } : { kind, delta }}
        />
      </div>
    );
  };
  return (
    <div
      className="solitude-rain-layer"
      data-solitude-rain
      data-elapsed={frame ? Math.round(frame.t) : 'loading'}
      role="status"
      aria-label="Solitude Rain · 雨幕追光"
    >
      <canvas ref={canvas} />
      {frame && badge('HEART', frame.target, SOLITUDE_RAIN_HEART_AT, source.convertedHeartCount)}
      {frame?.song && badge('SCORE', frame.song, SOLITUDE_RAIN_SCORE_AT, source.scoreBonus)}
      <button className="card-entrance-skip" onClick={() => done.current()}>
        {holdAt === undefined ? '跳过演出' : '关闭定格'}
      </button>
    </div>
  );
}
