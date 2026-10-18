import { useLayoutEffect, useRef } from 'react';
import { entranceTimeline } from '@/lib/cardEntranceTimeline';
import { getLandingImpactRadius, getLandingSpreadProgress } from '@/lib/cardEntranceLanding';
import type { LandingImpactTextures } from './landingImpactTextures';
import { getAncestorTableRotation } from '@/lib/cardTableGeometry';

/** Project the rendered surface including rotated LIVE wrappers, then align to
 * viewport bounds. Anonymous card backs use the same identity-free geometry. */
function eraseCard(
  ctx: CanvasRenderingContext2D,
  element: HTMLElement,
  ancestorRotation: number,
  x: number,
  y: number
) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height || getComputedStyle(element).visibility !== 'visible') return;
  const style = getComputedStyle(element);
  const transform = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
  const rotation = ancestorRotation + (parseFloat(style.rotate) || 0);
  const matrix = new DOMMatrix().rotate(0, 0, rotation).multiply(transform);
  const w = element.offsetWidth,
    h = element.offsetHeight;
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ]
    .map(([cx, cy]) => new DOMPoint(cx, cy).matrixTransform(matrix))
    .map((p) => ({ x: p.x / p.w, y: p.y / p.w }));
  const minX = Math.min(...corners.map((p) => p.x)),
    minY = Math.min(...corners.map((p) => p.y));
  const sx = rect.width / Math.max(0.01, Math.max(...corners.map((p) => p.x)) - minX);
  const sy = rect.height / Math.max(0.01, Math.max(...corners.map((p) => p.y)) - minY);
  ctx.beginPath();
  corners.forEach((p, i) => {
    const px = rect.left + (p.x - minX) * sx - x;
    const py = rect.top + (p.y - minY) * sy - y;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  });
  ctx.closePath();
  ctx.fill();
}

/** Expanding ground ring and short textured burst, masked by actual card quads. */
export function LandingGroundLight({
  x,
  y,
  size,
  startedAt,
  textures,
}: {
  x: number;
  y: number;
  size: number;
  startedAt: number;
  textures: LandingImpactTextures | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const radius = getLandingImpactRadius(size);
  const extent = radius + 24;
  useLayoutEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    element.width = Math.ceil(extent * 2 * ratio);
    element.height = Math.ceil(extent * 2 * ratio);
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-battle-ui-anchor*="-stage-"] [data-card-surface], [data-battle-ui-anchor$="-live-zone"] [data-card-surface]'
      )
    );
    const surfaces = cards.map((card) => ({ card, rotation: getAncestorTableRotation(card) }));
    let frame = 0;
    const draw = (now: number) => {
      const elapsed = now - startedAt;
      const t = Math.min(1, elapsed / entranceTimeline.impact.burst);
      ctx.setTransform(ratio, 0, 0, ratio, extent * ratio, extent * ratio);
      ctx.clearRect(-extent, -extent, extent * 2, extent * 2);
      ctx.globalCompositeOperation = 'lighter';
      // A sharp contact burst followed by a readable expanding ground ring.
      // Both use the same contact clock; the ring survives the shorter white core.
      if (textures) {
        const attack = Math.min(1, elapsed / (entranceTimeline.impact.flash * 0.2));
        const coreSize = size * (2.35 + 0.12 * getLandingSpreadProgress(t));
        ctx.globalAlpha = attack * (1 - t) ** 3 * 0.95;
        ctx.drawImage(textures.core, -coreSize / 2, -coreSize / 2, coreSize, coreSize);
        // Unequal soft lobes expose the contact around the card silhouette;
        // the central white core itself is correctly hidden beneath the card.
        for (let i = 0; i < 4; i++) {
          const angle = i * 1.57 + 0.45;
          const diameter = size * (0.92 + (i % 2) * 0.12);
          ctx.drawImage(
            textures.core,
            Math.cos(angle) * size * 0.32 - diameter / 2,
            Math.sin(angle) * size * 0.4 - diameter / 2,
            diameter,
            diameter
          );
        }
        for (let i = 0; i < 22; i++) {
          // Fixed variation belongs to the visual, never to the game's random source.
          const variation = (Math.sin(i * 17.13 + 2.9) + 1) / 2;
          const p = Math.min(
            1,
            elapsed / (entranceTimeline.impact.burst * (0.55 + variation * 0.45))
          );
          const travel = getLandingSpreadProgress(p);
          const angle = i * 2.39996 + variation * 0.17;
          const reach = size * (0.43 + variation * 0.2 + travel * 0.22);
          const length = size * (0.55 + variation * 0.65) * (0.7 + travel * 0.3) * (1 - p * 0.6);
          const width = size * (0.09 + variation * 0.07) * (1 - p * 0.5);
          ctx.save();
          ctx.rotate(angle + Math.PI / 2);
          ctx.globalAlpha = attack * (1 - p) ** 1.25 * (0.65 + variation * 0.35);
          ctx.drawImage(textures.ray, -width / 2, -reach - length / 2, width, length);
          ctx.restore();
        }
        for (let i = 0; i < 12; i++) {
          const variation = (Math.sin(i * 9.71 + 0.8) + 1) / 2;
          const p = Math.min(
            1,
            elapsed / (entranceTimeline.impact.burst * (0.7 + variation * 0.3))
          );
          const angle = i * 2.39996 + 0.45;
          const reach = size * (0.48 + (0.25 + variation * 0.5) * getLandingSpreadProgress(p));
          const diameter = size * (0.035 + variation * 0.025) * (1 - p * 0.55);
          ctx.globalAlpha = attack * (1 - p) ** 1.8;
          ctx.drawImage(
            textures.fleck,
            Math.cos(angle) * reach - diameter / 2,
            Math.sin(angle) * reach - diameter / 2,
            diameter,
            diameter
          );
        }
      }
      const ringT = Math.min(1, elapsed / entranceTimeline.impact.ring);
      const ringRadius = size * (0.22 + 0.88 * getLandingSpreadProgress(ringT));
      const ringFade =
        Math.min(1, elapsed / (entranceTimeline.impact.flash * 0.25)) *
        (1 - Math.max(0, ringT - 0.16) / 0.84) ** 0.9;
      ctx.globalAlpha = ringFade;
      if (textures) {
        // The source leaves an 8px gutter around a 248px radius.
        const diameter = ringRadius * (512 / 248);
        ctx.drawImage(textures.ring, -diameter / 2, -diameter / 2, diameter, diameter);
      }
      // A slim bright leading edge makes the circular expansion legible at 1x.
      // It also remains as the low-cost fallback if optional textures fail.
      ctx.beginPath();
      ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = '#d4e5ff';
      ctx.lineWidth = Math.max(1, size * 0.012 * (1 - ringT * 0.5));
      ctx.shadowColor = '#92b3ff';
      ctx.shadowBlur = size * 0.035;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      const bounds = element.getBoundingClientRect();
      for (const { card, rotation } of surfaces)
        if (card.isConnected)
          eraseCard(ctx, card, rotation, bounds.left + extent, bounds.top + extent);
      ctx.globalCompositeOperation = 'source-over';
      if (elapsed < entranceTimeline.impactDuration) frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [x, y, size, startedAt, radius, extent, textures]);
  return (
    <canvas
      ref={canvas}
      data-landing-ground-light
      style={{
        position: 'absolute',
        left: -extent,
        top: -extent,
        width: extent * 2,
        height: extent * 2,
        pointerEvents: 'none',
      }}
    />
  );
}
