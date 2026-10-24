import { useEffect, useRef, type CSSProperties } from 'react';
import { BOKUHIKA_CAST, castAngle, type BokuhikaContribution } from './bokuhikaCast';
import { progress, smooth } from './bokuhikaDrawing';

interface Props {
  contribution: BokuhikaContribution;
  imageUrl: (code: string) => string;
  onImageLoad: (cardCode: string) => void;
  onImageError: () => void;
  elapsed: number;
  reducedMotion: boolean;
  center: readonly [number, number];
  scale: number;
  viewport: { width: number; height: number };
  opacity: number;
}

/** Portraits are a fixed illustrated legend, not pictures of private game objects. */
export function BokuhikaPortraitRing({
  contribution,
  imageUrl,
  onImageLoad,
  onImageError,
  elapsed,
  reducedMotion,
  center,
  scale,
  viewport,
  opacity,
}: Props) {
  const rays = useRef<HTMLCanvasElement>(null);
  const lit = BOKUHIKA_CAST.filter((m) => contribution.members.includes(m.id));
  useEffect(() => {
    const canvas = rays.current,
      ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(viewport.width * dpr),
      height = Math.round(viewport.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    if (reducedMotion) return;
    ctx.translate(...center);
    ctx.scale(scale, scale);
    BOKUHIKA_CAST.forEach((member, i) => {
      const rank = lit.findIndex((m) => m.id === member.id);
      if (rank < 0) return;
      const angle = castAngle(i),
        x = Math.cos(angle) * 335,
        y = Math.sin(angle) * 335;
      const on = smooth(progress(elapsed, 420 + rank * 145, 270));
      ctx.globalAlpha = opacity * on;
      const pool = ctx.createRadialGradient(x, y, 15, x, y, 92);
      pool.addColorStop(0, member.color + '70');
      pool.addColorStop(0.55, member.color + '20');
      pool.addColorStop(1, member.color + '00');
      ctx.fillStyle = pool;
      ctx.fillRect(x - 95, y - 95, 190, 190);
      const t = progress(elapsed, 1770 + rank * 65, 650);
      if (t <= 0 || t >= 1) return;
      // A broad, tapering curved wisp: no straight beam, no uncounted contributors.
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let j = 0; j < 32; j++) {
        const p = t - j * 0.009;
        if (p < 0) continue;
        const a = angle + Math.sin(p * Math.PI) * 0.32,
          r = 335 * (1 - smooth(p));
        const px = Math.cos(a) * r,
          py = Math.sin(a) * r;
        ctx.globalAlpha = opacity * Math.sin(t * Math.PI) * (0.16 * (1 - j / 32));
        const glow = ctx.createRadialGradient(px, py, 0, px, py, 22 * (1 - j / 48));
        glow.addColorStop(0, '#fff8f0');
        glow.addColorStop(0.22, member.color);
        glow.addColorStop(1, member.color + '00');
        ctx.fillStyle = glow;
        ctx.fillRect(px - 23, py - 23, 46, 46);
      }
      // Give the moving light a clear luminous center, surrounded by its member color.
      const headAngle = angle + Math.sin(t * Math.PI) * 0.32;
      const headRadius = 335 * (1 - smooth(t));
      const hx = Math.cos(headAngle) * headRadius,
        hy = Math.sin(headAngle) * headRadius;
      ctx.globalAlpha = opacity * Math.sin(t * Math.PI) * 0.92;
      const core = ctx.createRadialGradient(hx, hy, 0, hx, hy, 10);
      core.addColorStop(0, '#fffef9');
      core.addColorStop(0.2, '#fffef9');
      core.addColorStop(0.55, member.color);
      core.addColorStop(1, member.color + '00');
      ctx.fillStyle = core;
      ctx.fillRect(hx - 10, hy - 10, 20, 20);
      ctx.restore();
    });
  }, [
    elapsed,
    reducedMotion,
    viewport.width,
    viewport.height,
    scale,
    center[0],
    center[1],
    opacity,
    contribution,
  ]);
  return (
    <div className="bokuhika-cast" aria-label={`本次效果加 ${contribution.scoreBonus} 分`}>
      <canvas ref={rays} aria-hidden="true" />
      {BOKUHIKA_CAST.map((member, i) => {
        const rank = lit.findIndex((m) => m.id === member.id),
          selected = rank >= 0;
        const on = selected
          ? reducedMotion
            ? 1
            : smooth(progress(elapsed, 420 + rank * 145, 270))
          : 0;
        const angle = castAngle(i),
          size = 104 * scale;
        const [x, y, cropSize] = member.crop;
        return (
          <div
            key={member.id}
            className="bokuhika-portrait"
            data-member={member.id}
            data-counted={selected}
            aria-label={`${member.label}：${selected ? '计入 +1' : '未计入'}`}
            style={
              {
                left: center[0] + Math.cos(angle) * 335 * scale,
                top: center[1] + Math.sin(angle) * 335 * scale,
                width: size,
                height: size,
                opacity: opacity * (0.28 + 0.72 * on),
                transform: `translate(-50%,-50%) scale(${1 + Math.sin(on * Math.PI) * 0.07})`,
                '--member-color': member.color,
                '--member-on': on,
              } as CSSProperties
            }
          >
            <div
              className="bokuhika-portrait-frame"
              style={{ filter: `saturate(${on}) brightness(${0.45 + 0.55 * on})` }}
            >
              <svg viewBox={`${x} ${y} ${cropSize} ${cropSize}`} aria-hidden="true">
                <image
                  href={imageUrl(member.cardCode)}
                  onLoad={() => onImageLoad(member.cardCode)}
                  onError={onImageError}
                  width="1000"
                  height="1400"
                  preserveAspectRatio="none"
                />
              </svg>
            </div>
            <svg
              className="bokuhika-portrait-seal"
              viewBox="0 0 120 120"
              aria-hidden="true"
              style={{ opacity: on }}
            >
              <circle cx="60" cy="60" r="57" />
              <path d="M60 0 Q66 6 60 12 Q54 6 60 0 M120 60 Q114 66 108 60 Q114 54 120 60 M60 120 Q54 114 60 108 Q66 114 60 120 M0 60 Q6 54 12 60 Q6 66 0 60" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
