import { useEffect, useRef, useState } from 'react';
import {
  BOKUHIKA_FLOWER_DURATION,
  createBokuhikaRenderer,
  progress,
  smooth,
} from './bokuhikaDrawing';
import './bokuhika.css';
import { BokuhikaPortraitRing } from './BokuhikaPortraitRing';
import { BOKUHIKA_SUCCESS_DURATION, type BokuhikaContribution } from './bokuhikaCast';
import { ENTRANCE_LOAD_TIMEOUT_MS } from '@/lib/cardEntranceAssets';

export interface BokuhikaSceneProps {
  /** Public card image only; the caller owns eligibility and timing. */
  imageUrl: string;
  elapsed: number;
  reducedMotion?: boolean;
  onReady?: () => void;
  /** Names come from the selected effect's rule evaluation. */
  contribution: BokuhikaContribution;
  portraitUrl: (cardCode: string) => string;
}

/** A deterministic frame, also used by preview scrubbing. No commands or animation clock. */
export function BokuhikaScene({
  imageUrl,
  elapsed,
  reducedMotion = false,
  onReady,
  contribution,
  portraitUrl,
}: BokuhikaSceneProps) {
  const petals = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createBokuhikaRenderer>>(null);
  const [ready, setReady] = useState(false),
    [fallback, setFallback] = useState(false);
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    let cancelled = false,
      finished = false;
    const image = new Image();
    setReady(false);
    setFallback(false);
    const finish = (failed: boolean) => {
      if (cancelled || finished) return;
      finished = true;
      window.clearTimeout(timeout);
      setFallback(failed);
      setReady(true);
      onReadyRef.current?.();
    };
    image.onload = () => {
      if (cancelled || finished) return;
      try {
        renderer.current =
          petals.current && !reducedMotion ? createBokuhikaRenderer(petals.current, image) : null;
        finish(!renderer.current && !reducedMotion);
      } catch {
        finish(true);
      }
    };
    image.onerror = () => finish(true);
    image.src = imageUrl;
    const timeout = window.setTimeout(() => finish(true), ENTRANCE_LOAD_TIMEOUT_MS);
    const contextLost = (e: Event) => {
      e.preventDefault();
      setFallback(true);
    };
    const canvas = petals.current;
    canvas?.addEventListener('webglcontextlost', contextLost);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      renderer.current?.dispose();
      renderer.current = null;
      canvas?.removeEventListener('webglcontextlost', contextLost);
    };
  }, [imageUrl, reducedMotion]);
  const center: readonly [number, number] = [size.width / 2, size.height * 0.49];
  const castScale = Math.min((size.width - 28) / 800, (size.height - 180) / 760, 1.05);
  const scale = castScale * 0.77;
  const duration = BOKUHIKA_SUCCESS_DURATION;
  const flowerTime = (elapsed * BOKUHIKA_FLOWER_DURATION) / duration;
  useEffect(() => {
    if (!ready || reducedMotion || fallback) return;
    renderer.current?.draw(flowerTime, size.width, size.height, center, Math.max(0.25, scale));
  }, [
    ready,
    fallback,
    reducedMotion,
    elapsed,
    flowerTime,
    size.width,
    size.height,
    scale,
    contribution,
  ]);
  const opacity =
    smooth(progress(elapsed, 0, 180)) * (1 - smooth(progress(elapsed, duration - 350, 350)));
  const simple = reducedMotion || fallback;
  return (
    <div
      className="bokuhika-scene"
      data-testid="bokuhika-scene"
      data-ready={ready}
      data-simple={simple}
      aria-label="我们是合而为一的光芒 · 歌曲演出"
      style={{ opacity: ready ? 1 : 0 }}
    >
      <div className="bokuhika-shade" style={{ opacity: opacity * (simple ? 0.55 : 0.78) }} />
      <canvas ref={petals} aria-hidden="true" style={{ display: simple ? 'none' : undefined }} />
      {simple && (
        <div className="bokuhika-simple" style={{ opacity, top: center[1] }}>
          <img src={imageUrl} alt="我们是合而为一的光芒" />
        </div>
      )}
      <BokuhikaPortraitRing
        contribution={contribution}
        imageUrl={portraitUrl}
        elapsed={elapsed}
        reducedMotion={simple}
        center={center}
        scale={castScale}
        viewport={size}
        opacity={opacity}
      />
    </div>
  );
}
