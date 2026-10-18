const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
// At full hover the card is 1.1x larger than the approved version. Compensate
// that enlargement so the visible reach from its edge still contracts by one third.
const INK_REACH_SCALE = 2 / 3 / 1.1;

// A fixed, continuous dye field. No individual puffs, emitters or orbiting waves.
const lattice = new Float32Array(64 * 64);
let seed = 731;
for (let i = 0; i < lattice.length; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  lattice[i] = (seed / 0xffffffff) * 2 - 1;
}
function noise(x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = smooth(x - ix),
    fy = smooth(y - iy);
  const a = lattice[(iy & 63) * 64 + (ix & 63)];
  const b = lattice[(iy & 63) * 64 + ((ix + 1) & 63)];
  const c = lattice[((iy + 1) & 63) * 64 + (ix & 63)];
  const d = lattice[((iy + 1) & 63) * 64 + ((ix + 1) & 63)];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Local edge art only: never samples or filters the card image underneath it. */
export function createActivationInkPainter(canvas: HTMLCanvasElement) {
  // Two samples per card-space unit: bounded work at every board size / device pixel ratio.
  canvas.width = 328;
  canvas.height = 408;
  const context = canvas.getContext('2d');
  if (!context) return (_time: number) => {};
  const image = context.createImageData(canvas.width, canvas.height);
  // Pixel index, distance, position, velocity, local reach, density, mask.
  // Cache geometry and a slow curl flow; all pigment samples travel through the same field.
  const field = new Float32Array(canvas.width * canvas.height * 9);
  let count = 0;
  for (let row = 0; row < canvas.height; row++) {
    for (let col = 0; col < canvas.width; col++) {
      const px = (col + 0.5) / 2 - 32;
      const py = (row + 0.5) / 2 - 32;
      const qx = Math.abs(px - 50) - 44,
        qy = Math.abs(py - 70) - 64;
      const dx = Math.max(qx, 0),
        dy = Math.max(qy, 0);
      const length = Math.hypot(dx, dy);
      const physicalDistance = length + Math.min(Math.max(qx, qy), 0) - 6;
      const distance =
        Math.max(physicalDistance, 0) / INK_REACH_SCALE + Math.min(physicalDistance, 0);
      if (distance < -0.5 || distance > 29) continue;
      const nx = length ? (dx / length) * Math.sign(px - 50) : 0;
      const ny = length ? (dy / length) * Math.sign(py - 70) : 0;
      // Resample the accepted wash along the edge normal, preserving its pigment
      // layout and softness while bringing the whole shape closer to the card.
      const x = px + nx * (distance - physicalDistance);
      const y = py + ny * (distance - physicalDistance);
      const broad = noise(x * 0.044 + 9, y * 0.044 - 3);
      const fx = x * 0.075 + 21,
        fy = y * 0.075 - 7;
      // Curl of one scalar potential: neighboring dye stretches and turns together.
      const vx = (noise(fx, fy + 0.1) - noise(fx, fy - 0.1)) * 12 + nx * 2;
      const vy = (noise(fx - 0.1, fy) - noise(fx + 0.1, fy)) * 12 + ny * 2;
      field.set(
        [
          (row * canvas.width + col) * 4,
          distance,
          x,
          y,
          vx,
          vy,
          1 + 0.36 * broad,
          0.72 + 0.2 * noise(x * 0.068 - 7, y * 0.068 + 11),
          smooth((distance + 0.5) * 2) * (1 - smooth((distance - 24) / 5)),
        ],
        count
      );
      count += 9;
    }
  }

  return (time: number) => {
    const spread = 10 + 14 * smooth(time);
    const dilution = 1 - 0.38 * smooth((time - 0.5) / 0.5);
    for (let i = 0; i < count; i += 9) {
      const offset = field[i],
        distance = field[i + 1];
      // First-order backtrace through the cached velocity. This is a small visual
      // approximation of dye advection, not a fluid solver or a new texture each frame.
      const x = field[i + 2] - field[i + 4] * time,
        y = field[i + 3] - field[i + 5] * time;
      const bendX = noise(x * 0.065 + 11, y * 0.065 - 5);
      const bendY = noise(x * 0.065 - 8, y * 0.065 + 19);
      const flow = noise(x * 0.12 + bendX * 1.4, y * 0.12 + bendY * 1.4);
      const fold = noise(x * 0.19 + flow * 1.6, y * 0.19 + bendX * 1.6);
      // One continuous wash opens from the card. Large pigment masses carry the
      // image; the smaller folds only soften their boundaries, never draw contours.
      const warpedDistance = Math.max(0, distance + (flow * 3 + bendY * 3) * smooth(distance / 3));
      const outward = clamp(warpedDistance / (spread * field[i + 6]));
      const sheet = (1 - smooth(outward)) ** 0.55 * field[i + 7] * dilution * field[i + 8];
      const pool = noise(x * 0.045 + bendX * 0.75 + 29, y * 0.045 + bendY * 0.75 - 11);
      const concentration = pool * 0.55 + flow * 0.32 + fold * 0.13;
      const bleed = smooth((concentration + 0.22) / 0.54);
      const darkMass = smooth((concentration + 0.02) / 0.28);
      // Pale ground connects the entire wash and lets dark ink remain legible on
      // the illustrated table. Denser ink sits inside that ground with a broad gray
      // transition, rather than a white outline or isolated transparent strands.
      const paleAlpha = 0.62 * sheet;
      const inkAlpha = (0.18 * bleed + 0.86 * darkMass) * sheet;
      const paleWeight = paleAlpha * (1 - inkAlpha);
      const alpha = inkAlpha + paleWeight;
      // Ordinary alpha compositing keeps the background visible; no additive glow.
      const shade = alpha ? Math.round((12 * inkAlpha + 218 * paleWeight) / alpha) : 0;
      image.data[offset] = shade;
      image.data[offset + 1] = shade;
      image.data[offset + 2] = shade;
      image.data[offset + 3] = Math.round(255 * alpha);
    }
    context.putImageData(image, 0, 0);
  };
}
