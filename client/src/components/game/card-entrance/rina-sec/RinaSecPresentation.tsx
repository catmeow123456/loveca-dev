import { useEffect, useRef, type CSSProperties } from 'react';
import { createCardEntranceMesh } from '@/lib/cardEntranceMesh';
import { entrancePortraitFrame } from '@/lib/cardEntranceTimeline';
import type { CardEntranceProfile } from '@/lib/cardEntranceProfiles';
import { CardEntranceNameplate } from '../CardEntranceNameplate';
import { drawRinaSec, type RinaSecImages, type RinaSecLayout } from './rinaSecDrawing';
import { rinaSecFrame, supportsRinaSec, type RinaSecScene } from './rinaSecTimeline';
import '../cardEntrance.css';
import './rinaSec.css';

export interface RinaSecAssets extends RinaSecImages {
  portrait: HTMLImageElement;
  blink: HTMLImageElement | null;
}
/** Controlled-time art shared by the preview and the synchronized battle player. */
export function RinaSecPresentation({
  cardCode,
  scene,
  elapsed,
  reduced,
  layout,
  assets,
  profile,
  onError,
}: {
  cardCode: string;
  scene: RinaSecScene;
  elapsed: number;
  reduced: boolean;
  layout: RinaSecLayout;
  assets: RinaSecAssets;
  profile: CardEntranceProfile;
  onError: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    portrait = useRef<HTMLCanvasElement>(null);
  const mesh = useRef<ReturnType<typeof createCardEntranceMesh>>(null);
  const allowed = supportsRinaSec(cardCode);
  useEffect(() => {
    if (!allowed || scene !== 'entrance' || reduced || !portrait.current) return;
    const target = portrait.current;
    target.addEventListener('webglcontextlost', onError);
    try {
      mesh.current = createCardEntranceMesh(
        target,
        assets.portrait,
        profile.mesh,
        assets.blink && profile.blink
          ? { image: assets.blink, faces: profile.blink.faces }
          : undefined
      );
      if (!mesh.current) onError();
    } catch {
      onError();
    }
    return () => {
      target.removeEventListener('webglcontextlost', onError);
      mesh.current?.dispose();
      mesh.current = null;
    };
  }, [assets, profile, allowed, scene, reduced, onError]);
  const frame = rinaSecFrame(scene, elapsed, reduced);
  const visual = entrancePortraitFrame(frame.portraitTime, reduced);
  const showPortrait =
    allowed && scene === 'entrance' && !reduced && frame.portraitTime >= 0 && !visual.finished;
  useEffect(() => {
    if (showPortrait) mesh.current?.draw(frame.portraitTime / 1000, false);
  }, [showPortrait, frame.portraitTime, assets]);
  useEffect(() => {
    if (!allowed || !canvas.current) return;
    const c = canvas.current,
      dpr = Math.min(2, devicePixelRatio || 1);
    const width = innerWidth,
      height = innerHeight;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawRinaSec(ctx, scene, elapsed, reduced, layout, assets);
  }, [allowed, scene, elapsed, reduced, layout, assets]);
  if (!allowed) return null;
  const height = Math.min(layout.board.height * 0.87, layout.board.width * 1.03);
  return (
    <div
      className="rina-sec-presentation"
      data-scene={scene}
      aria-label={scene === 'entrance' ? '璃奈专属登场' : '璃奈专属换曲'}
    >
      <div
        className="rina-sec-portrait card-entrance--centered"
        style={
          {
            left: layout.board.x,
            top: layout.board.y,
            width: layout.board.width,
            height: layout.board.height,
            opacity: showPortrait ? visual.opacity : 0,
            '--name-opacity': visual.label,
            '--name-y': `${(1 - visual.label) * 12}px`,
            '--entrance-light': '#cea2ef70',
          } as CSSProperties
        }
      >
        <div className="rina-sec-portrait-glow" />
        <canvas
          ref={portrait}
          style={{
            height,
            width: (height * 1060) / 1484,
            transform: `translateX(calc(-50% + ${visual.x}px))`,
          }}
        />
        <CardEntranceNameplate name={profile.name} />
      </div>
      <canvas ref={canvas} className="rina-sec-canvas" aria-hidden="true" />
    </div>
  );
}
