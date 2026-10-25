import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BOKUHIKA_FLOWER_DURATION,
  createBokuhikaRenderer,
  progress,
  smooth,
} from './bokuhikaDrawing';
import './bokuhika.css';
import { BokuhikaPortraitRing } from './BokuhikaPortraitRing';
import {
  BOKUHIKA_CAST,
  BOKUHIKA_SUCCESS_DURATION,
  type BokuhikaContribution,
} from './bokuhikaCast';
import type { EffectImageCache } from '@/lib/effectImageCache';
import { prepareBokuhikaImages } from './bokuhikaLoading';

export interface BokuhikaSceneProps {
  /** Public card image only; the caller owns eligibility and timing. */
  imageUrl: string;
  elapsed: number;
  reducedMotion?: boolean;
  onReady?: () => void;
  onUnavailable: () => void;
  images: EffectImageCache;
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
  onUnavailable,
  images,
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
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
  const urls = useMemo(
    () => [imageUrl, ...BOKUHIKA_CAST.map((member) => portraitUrl(member.cardCode))],
    [imageUrl, portraitUrl]
  );
  // SVG images can use a separate browser resource cache from HTMLImageElement.decode().
  // Keep the actual portrait nodes hidden until their load events also complete.
  const portraitLoads = useMemo(() => {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const loaded = new Set<string>();
    return {
      promise,
      complete: (code: string) => {
        loaded.add(code);
        if (loaded.size === BOKUHIKA_CAST.length) resolve();
      },
      fail: () => reject(new Error('Bokuhika portrait unavailable')),
    };
  }, [urls]);
  useEffect(() => {
    const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setReady(false);
    setFallback(false);
    prepareBokuhikaImages(images, urls, controller.signal, portraitLoads.promise).then(
      ([image]) => {
        if (controller.signal.aborted) return;
        try {
          renderer.current =
            petals.current && !reducedMotion ? createBokuhikaRenderer(petals.current, image) : null;
          setFallback(!renderer.current && !reducedMotion);
        } catch {
          setFallback(true);
        }
        setReady(true);
        onReadyRef.current?.();
      },
      () => {
        if (!controller.signal.aborted) unavailable.current();
      }
    );
    const contextLost = (e: Event) => {
      e.preventDefault();
      setFallback(true);
    };
    const canvas = petals.current;
    canvas?.addEventListener('webglcontextlost', contextLost);
    return () => {
      controller.abort();
      renderer.current?.dispose();
      renderer.current = null;
      canvas?.removeEventListener('webglcontextlost', contextLost);
    };
  }, [images, urls, portraitLoads, reducedMotion]);
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
      {ready && simple && (
        <div className="bokuhika-simple" style={{ opacity, top: center[1] }}>
          <img src={imageUrl} alt="我们是合而为一的光芒" />
        </div>
      )}
      <BokuhikaPortraitRing
        key={urls.join('|')}
        contribution={contribution}
        imageUrl={portraitUrl}
        onImageLoad={portraitLoads.complete}
        onImageError={portraitLoads.fail}
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
