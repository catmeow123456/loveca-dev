import coreUrl from './impact-textures/Particle02.png';
import rayUrl from './impact-textures/Line6.png';
import fleckUrl from './impact-textures/Particle01.png';
import ringUrl from './impact-textures/Shock_wave_ring0011.png';

export interface LandingImpactTextures {
  core: HTMLCanvasElement;
  ray: HTMLCanvasElement;
  fleck: HTMLCanvasElement;
  ring: HTMLCanvasElement;
}

// These tiny shared textures are optional decoration. Decode during the portrait;
// they must never extend the entrance clock or the authority's acknowledgement.
let prepared: Promise<LandingImpactTextures | null> | undefined;
export function prepareLandingImpactTextures(): Promise<LandingImpactTextures | null> {
  if (prepared) return prepared;
  prepared = Promise.all([
    prepareSprite(coreUrl, [231, 240, 255]),
    prepareSprite(rayUrl, [178, 210, 255]),
    prepareSprite(fleckUrl, [218, 229, 255]),
    prepareRingSprite(),
  ])
    .then(([core, ray, fleck, ring]) => ({ core, ray, fleck, ring }))
    .catch(() => {
      prepared = undefined;
      return null;
    });
  return prepared;
}

async function prepareSprite(url: string, tint: [number, number, number]) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx || !canvas.width || !canvas.height) throw new Error('Impact texture unavailable');
  ctx.drawImage(image, 0, 0);
  // Original CC0 sprites store luminosity on opaque black, for additive blending.
  // Convert luminosity to alpha once so transparent regions never paint black boxes.
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const light = Math.max(pixels.data[i]!, pixels.data[i + 1]!, pixels.data[i + 2]!);
    pixels.data[i + 3] = Math.round((pixels.data[i + 3]! * light) / 255);
    pixels.data[i] = tint[0];
    pixels.data[i + 1] = tint[1];
    pixels.data[i + 2] = tint[2];
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

async function prepareRingSprite() {
  // Effekseer's ring texture is a strip: its bright top is the outward edge,
  // the uneven fading tail points inward. Wrap it once during preparation.
  const strip = await prepareSprite(ringUrl, [182, 212, 255]);
  const source = strip.getContext('2d')!.getImageData(0, 0, strip.width, strip.height).data;
  const ring = document.createElement('canvas');
  ring.width = ring.height = 512;
  const ctx = ring.getContext('2d');
  if (!ctx) throw new Error('Impact ring unavailable');
  const pixels = ctx.createImageData(ring.width, ring.height);
  const center = ring.width / 2;
  const outer = center - 8;
  const thickness = outer * 0.16;
  for (let y = 0; y < ring.height; y++) {
    for (let x = 0; x < ring.width; x++) {
      const dx = x + 0.5 - center,
        dy = y + 0.5 - center;
      const radius = Math.hypot(dx, dy);
      if (radius > outer || radius < outer - thickness) continue;
      const turn = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5;
      const sx = Math.floor(turn * strip.width * 4) % strip.width;
      const sy = Math.min(
        strip.height - 1,
        Math.floor(((outer - radius) / thickness) * strip.height)
      );
      const from = (sy * strip.width + sx) * 4;
      const to = (y * ring.width + x) * 4;
      pixels.data.set(source.subarray(from, from + 4), to);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  return ring;
}
