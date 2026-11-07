import { SOLITUDE_RAIN_DURATION, SOLITUDE_RAIN_SCORE_AT } from '@/lib/solitudeRain';
export type Rect = { left: number; top: number; width: number; height: number; rotation?: number };
export const ease = (t: number) => {
  const v = Math.max(0, Math.min(1, t));
  return v * v * (3 - 2 * v);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const tau = Math.PI * 2;

export interface RainRenderer {
  draw(
    timeMs: number,
    target: Rect,
    song: Rect | undefined,
    converted: number,
    score: number
  ): void;
  dispose(): void;
}

/** Light only. The real card remains in place; no copied or sampled member texture. */
export function createRainRenderer(canvas: HTMLCanvasElement): RainRenderer | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const clear = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  // A soft, filled light field; no outlined circles or hard-edged light cones.
  const glow = (x: number, y: number, rx: number, ry: number, color: string, alpha: number) => {
    if (alpha <= 0) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, color);
    g.addColorStop(0.32, color);
    g.addColorStop(1, 'transparent');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  };
  // A small light-only field gives both cones feathered edges and a shared overlap.
  // No card texture, GPU readback or hard luminous centerline is involved. The field
  // is intentionally soft; the real DOM card and rain retain their full resolution.
  const lightSurface = document.createElement('canvas');
  lightSurface.width = 160;
  lightSurface.height = 224;
  const lightContext = lightSurface.getContext('2d');
  if (!lightContext) return null;
  const lightPixels = lightContext.createImageData(lightSurface.width, lightSurface.height);
  const lightData = lightPixels.data;
  let lightGeometry: { w: number; h: number; side: number; gather: number } | undefined;
  let sampleLight: ((x: number, y: number, direction: number) => number) | undefined;
  const updateLighting = (w: number, h: number, side: number, gather: number) => {
    if (
      lightGeometry?.w === w &&
      lightGeometry.h === h &&
      lightGeometry.side === side &&
      lightGeometry.gather === gather
    )
      return;
    lightGeometry = { w, h, side, gather };
    const sourceX = w * mix(1.02, 0.88, gather);
    const sourceY = -h * 1.23 * side;
    const landingX = w * mix(0.42, 0.015, gather);
    // Let the two footprints meet across the open edge of the card. Their shared
    // light is visible against the dark table as well as on the printed paper.
    const landingY = -h * 0.4 * side;
    const dx = sourceX - landingX;
    const dy = landingY - sourceY;
    const lengthSquared = dx * dx + dy * dy;
    const inverseLength = 1 / Math.sqrt(lengthSquared);
    const radius = w * 0.39;
    const spotHeight = h * 0.38;
    const sample = (x: number, y: number, direction: number) => {
      // Mirror one cone: broad at the receiving paper, fading toward the light source.
      const rx = x + sourceX * direction;
      const ry = y - sourceY;
      const along = (rx * dx * direction + ry * dy) / lengthSquared;
      const distance = Math.abs(rx * dy - ry * dx * direction) * inverseLength;
      const spread = w * mix(0.09, 0.39, ease(along));
      const cross = Math.max(0, 1 - (distance / spread) ** 2);
      const cone = cross * cross * ease(along / 0.22) * (1 - ease((along - 0.75) / 0.43));
      const footprint = Math.max(
        0,
        1 - ((x + landingX * direction) / radius) ** 2 - ((y - landingY) / spotHeight) ** 2
      );
      return Math.max(cone * 0.75, footprint * footprint);
    };
    sampleLight = sample;
    const edgeStrength = 1 - 0.38 * ease((gather - 0.6) / 0.4);
    let index = 0;
    for (let iy = 0; iy < lightSurface.height; iy++) {
      const y = (iy / (lightSurface.height - 1) - 0.5) * h * 2.8;
      for (let ix = 0; ix < lightSurface.width; ix++, index += 4) {
        const x = (ix / (lightSurface.width - 1) - 0.5) * w * 2.4;
        const red = sample(x, y, 1);
        const blue = sample(x, y, -1);
        const overlap = Math.min(red, blue);
        // Only shared illumination is violet. Unshared portions keep their source color.
        const redOnly = (red - overlap) * edgeStrength;
        const blueOnly = (blue - overlap) * edgeStrength;
        const violet = overlap * 1.9;
        const total = redOnly + blueOnly + violet;
        if (total < 0.001) {
          lightData[index + 3] = 0;
          continue;
        }
        lightData[index] = (246 * redOnly + 65 * blueOnly + 188 * violet) / total;
        lightData[index + 1] = (78 * redOnly + 147 * blueOnly + 62 * violet) / total;
        lightData[index + 2] = (114 * redOnly + 249 * blueOnly + 252 * violet) / total;
        const onPaper = Math.abs(x) <= w / 2 && Math.abs(y) <= h / 2;
        const shared = overlap / Math.max(red, blue);
        // Keep paper exposure restrained; give the overlap more presence in open air.
        const exposure = onPaper ? 0.24 + 0.1 * shared : 0.52 + 0.3 * shared;
        lightData[index + 3] =
          Math.min(1, Math.max(redOnly, blueOnly) + overlap * 1.35) * exposure * 255;
      }
    }
    lightContext.putImageData(lightPixels, 0, 0);
  };
  const drawLighting = (w: number, h: number, side: number, gather: number, strength: number) => {
    if (strength <= 0) return;
    updateLighting(w, h, side, gather);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    // Reuse the settled light field while fading; opacity does not change its geometry.
    ctx.globalAlpha = strength;
    ctx.drawImage(lightSurface, -w * 1.2, -h * 1.4, w * 2.4, h * 2.8);
    ctx.restore();
  };
  return {
    draw(t, target, song, converted, score) {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(innerWidth * dpr),
        height = Math.round(innerHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      clear();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = target.left + target.width / 2,
        cy = target.top + target.height / 2;
      const rotation = ((target.rotation ?? 0) * Math.PI) / 180;
      const sideways = Math.abs(Math.sin(rotation)) > 0.7;
      const w = sideways ? target.height : target.width,
        h = sideways ? target.width : target.height;
      // Keep the light sources on the open-table side when a top-row member
      // has the opponent's hand immediately above it. Both land on the same paper.
      const lightSide = target.top < h * 1.35 ? -1 : 1;
      const appear = ease(t / 110),
        fade = 1 - ease((t - 1600) / (SOLITUDE_RAIN_DURATION - 1600));
      const atmosphere = appear * fade;
      const gather = ease((t - 80) / 1300);
      const key = converted > 0 ? ease((t - 1040) / 190) * (1 - ease((t - 1570) / 250)) : 0;
      const illumination = converted > 0 ? ease((t - 90) / 200) * (1 - ease((t - 1260) / 540)) : 0;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);

      // Keep the printed face unobscured. Rain has deliberate lanes OUTSIDE this hole,
      // rather than scattering most of the visible threads into the clipped region.
      const clipOutsideCard = () => {
        ctx.beginPath();
        ctx.rect(-w * 1.35, -h * 1.6, w * 2.7, h * 2.8);
        ctx.roundRect(-w / 2 - 0.5, -h / 2 - 0.5, w + 1, h + 1, 3);
        ctx.clip('evenodd');
      };
      ctx.save();
      clipOutsideCard();
      glow(0, -h * 0.12, w * 1.3, h * 1.3, '#060c1b', atmosphere * 0.5);
      ctx.restore();

      drawLighting(w, h, lightSide, gather, illumination);

      // Rain is rendered over the light field so its locally lit tips remain legible.
      ctx.save();
      clipOutsideCard();
      ctx.globalCompositeOperation = 'screen';

      // Three staggered threads in each lane avoid the empty gaps of a single
      // looping drop. Rain keeps moving through the light gathering and fade;
      // only the lighting changes to express the conversion.
      const rain = appear * (1 - ease((t - 1300) / 260));
      for (let i = 0; i < 36; i++) {
        const laneIndex = Math.floor(i / 3);
        const segment = i % 3;
        const seed = ((laneIndex + 1) * 0.61803398875) % 1;
        const edgeLane = laneIndex >= 8;
        const lane = laneIndex % 4;
        const x = edgeLane
          ? (lane / 3 - 0.5) * w * 0.78
          : (laneIndex < 4 ? -1 : 1) * w * (0.64 + lane * 0.105);
        const span = h * (edgeLane ? (lightSide > 0 ? 0.94 : 0.65) : 2.3);
        const phase = (seed + segment / 3 + (t * h * (0.0018 + seed * 0.0006)) / span) % 1;
        const y = h * (edgeLane ? (lightSide > 0 ? -1.52 : 0.52) : -1.4) + phase * span;
        const length = h * (0.1 + seed * 0.065);
        const boundary = ease(phase / 0.08) * (1 - ease((phase - 0.92) / 0.08));
        const rainColor = (at: number, bright: boolean) => {
          const px = x - length * 0.05 * at;
          const py = y + length * at;
          const overlap =
            sampleLight && illumination > 0
              ? Math.min(sampleLight(px, py, 1), sampleLight(px, py, -1))
              : 0;
          const lit = illumination * ease((overlap - 0.025) / 0.28);
          const base = bright ? [226, 234, 250] : [173, 197, 230];
          return `rgb(${mix(base[0], 203, lit)}, ${mix(base[1], 107, lit)}, ${mix(base[2], 255, lit)})`;
        };
        const g = ctx.createLinearGradient(x, y, x - length * 0.05, y + length);
        g.addColorStop(0, 'transparent');
        g.addColorStop(0.35, rainColor(0.35, false));
        g.addColorStop(0.65, rainColor(0.65, false));
        g.addColorStop(0.9, rainColor(0.9, true));
        g.addColorStop(1, 'transparent');
        ctx.strokeStyle = g;
        ctx.globalAlpha = rain * boundary * (0.38 + seed * 0.27);
        ctx.lineWidth = 0.85 + seed * 0.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - length * 0.05, y + length);
        ctx.stroke();
      }

      ctx.restore();

      // One neutral, narrow sheen crosses the actual paper and then leaves it alone.
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(-w / 2, -h / 2, w, h, 3);
      ctx.clip();
      const sweep = ease((t - 1130) / 270);
      const sx = mix(-w, w, sweep);
      const shine = ctx.createLinearGradient(sx - w * 0.18, -h / 2, sx + w * 0.18, h / 2);
      shine.addColorStop(0, 'transparent');
      shine.addColorStop(0.48, '#f6f3ff');
      shine.addColorStop(1, 'transparent');
      ctx.fillStyle = shine;
      ctx.globalAlpha = key * Math.sin(sweep * Math.PI) * 0.05;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
      ctx.restore();

      // Only the authority's awarded score gets the last drop, on its real LIVE anchor.
      if (score > 0 && song && t >= 1330) {
        const fall = ease((t - 1330) / (SOLITUDE_RAIN_SCORE_AT - 1330));
        const x = song.left + song.width * 0.5,
          y = song.top + song.height * 0.35;
        const py = y - (1 - fall) * Math.min(68, target.height * 0.48);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 1 - ease((t - SOLITUDE_RAIN_SCORE_AT) / 80);
        ctx.fillStyle = '#eeeaff';
        ctx.beginPath();
        ctx.ellipse(x, py, 1.3, mix(4.2, 1.8, fall), 0, 0, tau);
        ctx.fill();
        const hit =
          ease((t - SOLITUDE_RAIN_SCORE_AT + 10) / 20) *
          (1 - ease((t - SOLITUDE_RAIN_SCORE_AT - 20) / 140));
        glow(x, y, song.width * 0.35, 3, '#d9cef3', hit * 0.5);
        ctx.restore();
      }
    },
    dispose: clear,
  };
}
