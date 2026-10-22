import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getEntranceStageTarget, sameEntranceTarget } from '@/lib/cardEntranceLanding';
import { ENTRANCE_LOAD_TIMEOUT_MS } from '@/lib/cardEntranceAssets';
import type { RinaLiveSwapSource } from '@/lib/rinaLiveSwap';
import { drawRinaSec } from './rinaSecDrawing';
import { readRinaBattleLayout } from './rinaBattleLayout';
import { rinaSecTiming as timing } from './rinaSecTimeline';
import './rinaSec.css';

/** A public, already-committed movement. The shared authority barrier owns all continuation. */
export function RinaLivePlayback({
  source,
  reduced,
  onDone,
}: {
  source: RinaLiveSwapSource;
  reduced: boolean;
  onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const [face, setFace] = useState<HTMLImageElement | null>(null);
  const valid = useGameStore((s) =>
    sameEntranceTarget(
      source.target,
      s.playerViewState ? getEntranceStageTarget(s.playerViewState, source.hostObjectId) : null
    )
  );
  useEffect(() => {
    if (!valid) done.current();
  }, [valid]);
  useEffect(() => {
    if (reduced || !valid) return;
    const image = new Image();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      cancelled = true;
      image.removeAttribute('src');
      done.current();
    }, ENTRANCE_LOAD_TIMEOUT_MS);
    image.src = source.imagePath;
    image
      .decode()
      .then(() => {
        if (!cancelled) {
          clearTimeout(timer);
          if (image.naturalWidth && image.naturalHeight) setFace(image);
          else done.current();
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearTimeout(timer);
          done.current();
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      image.removeAttribute('src');
    };
  }, [source.imagePath, reduced, valid]);
  useLayoutEffect(() => {
    if ((!face && !reduced) || !valid) return;
    const layout = readRinaBattleLayout(source.target, source.side, source.liveIndex);
    const c = canvas.current,
      ctx = c?.getContext('2d');
    if (!layout || !c || !ctx) {
      done.current();
      return;
    }
    // Stored LIVE images can be portrait-oriented for the table's -90 degree wrapper.
    // Normalize once to the intact horizontal face used by the approved choreography.
    let liveFace: CanvasImageSource | null = face;
    if (face && face.naturalHeight > face.naturalWidth) {
      const rotated = document.createElement('canvas');
      rotated.width = face.naturalHeight;
      rotated.height = face.naturalWidth;
      const paint = rotated.getContext('2d');
      if (!paint) {
        done.current();
        return;
      }
      paint.translate(0, rotated.height);
      paint.rotate(-Math.PI / 2);
      paint.drawImage(face, 0, 0);
      liveFace = rotated;
    }
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = Math.round(innerWidth * dpr);
    c.height = Math.round(innerHeight * dpr);
    ctx.scale(dpr, dpr);
    const start = reduced || source.phase === 'RETURN' ? 0 : timing.newCueAt;
    const duration = reduced
      ? timing.reduced
      : source.phase === 'RETURN'
        ? timing.newCueAt
        : timing.live - timing.newCueAt;
    const started = performance.now();
    let raf = 0;
    const abort = () => done.current();
    const tick = (now: number) => {
      const elapsed = now - started;
      if (elapsed >= duration) {
        done.current();
        return;
      }
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      root.current!.dataset.phase = source.phase;
      // Reduced mode never reads image fields; only a short corner hint is drawn.
      drawRinaSec(ctx, 'live', start + elapsed, reduced, layout, {
        member: face!,
        oldLive: liveFace!,
        newLive: liveFace!,
      });
      raf = requestAnimationFrame(tick);
    };
    tick(started);
    window.addEventListener('resize', abort);
    window.addEventListener('scroll', abort, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', abort);
      window.removeEventListener('scroll', abort, true);
    };
  }, [face, reduced, valid, source]);
  return (
    <div ref={root} className="rina-sec-presentation" role="status" aria-label="璃奈专属换曲">
      <canvas ref={canvas} className="rina-sec-canvas" aria-hidden="true" />
      <button
        className="card-entrance-skip"
        onClick={(e) => {
          e.stopPropagation();
          onDone();
        }}
      >
        跳过演出
      </button>
    </div>
  );
}
