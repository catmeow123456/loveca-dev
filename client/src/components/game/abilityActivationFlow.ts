const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

const RADIUS = 6;
const TOP = 100 - RADIUS * 2;
const SIDE = 140 - RADIUS * 2;
const CORNER = (Math.PI * RADIUS) / 2;
const PERIMETER = (TOP + SIDE) * 2 + CORNER * 4;
const PROFILE_SAMPLES = 768;
const TAU = Math.PI * 2;

// Clockwise distance along the rounded card, beginning at the top-left tangent.
// This follows the same shape as the signed distance below, including the corners.
function edgePosition(x: number, y: number) {
  if (y < RADIUS) {
    if (x < RADIUS) {
      const angle = Math.atan2(y - RADIUS, x - RADIUS) + TAU;
      return PERIMETER - CORNER + RADIUS * (angle - Math.PI);
    }
    if (x > 100 - RADIUS) {
      const angle = Math.atan2(y - RADIUS, x - (100 - RADIUS));
      return TOP + RADIUS * (angle + Math.PI / 2);
    }
    return x - RADIUS;
  }
  if (y > 140 - RADIUS) {
    if (x < RADIUS) {
      const angle = Math.atan2(y - (140 - RADIUS), x - RADIUS);
      return TOP + SIDE + CORNER * 2 + TOP + RADIUS * (angle - Math.PI / 2);
    }
    if (x > 100 - RADIUS) {
      const angle = Math.atan2(y - (140 - RADIUS), x - (100 - RADIUS));
      return TOP + CORNER + SIDE + RADIUS * angle;
    }
    return TOP + CORNER * 2 + SIDE + (100 - RADIUS - x);
  }
  return x < 50 ? TOP * 2 + SIDE + CORNER * 3 + (140 - RADIUS - y) : TOP + CORNER + y - RADIUS;
}

const PROFILE_STRIDE = 12;

// The wake is the head's earlier path, not another copy of a moving outline.
// A point is born near the card, drifts out, folds and thins as its age increases.
function writeRibbonProfile(
  profile: Float32Array,
  time: number,
  secondary: boolean,
  speedMultiplier: number
) {
  const speed = (secondary ? 0.3 : 0.35) * speedMultiplier;
  const life = secondary ? 0.52 : 0.64;
  const clock = time - (secondary ? 0.1 : 0);
  const head = (secondary ? 0.69 : 0.15) + speed * clock;
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const p = i * PROFILE_STRIDE;
    const behind = (((head - i / PROFILE_SAMPLES) % 1) + 1) % 1;
    // Since head(t) is linear, this exactly recovers t - emissionTime.
    const historyAge = behind / speed;
    const age = historyAge / life;
    profile[p] = 0;
    if (age >= 1) continue;
    const birth = smooth((clock + 0.15 - historyAge) / 0.13);
    const envelope = smooth(age / 0.065) * (1 - smooth((age - 0.1) / 0.9)) * birth;
    const emissionTime = clock - historyAge;
    // The fold phase belongs to the emitted material; it is never random per frame.
    const phase = emissionTime * TAU * 2.1 + (secondary ? 2.2 : 0.4);
    const swell = Math.sin(Math.PI * age);
    const curl = Math.sin(phase + age * 3.1);
    const center = 1.7 + 8.2 * age ** 1.25 + 2.3 * curl * swell;
    const width = (0.75 + 3.8 * swell ** 0.8) * (0.83 + 0.17 * Math.cos(phase));
    const nose = Math.exp(-(((age - 0.13) / 0.12) ** 2));
    profile[p] = envelope * (secondary ? 0.48 : 1);
    profile[p + 1] = center;
    profile[p + 2] = width;
    profile[p + 3] = nose;
    profile[p + 4] = center - width * (0.4 + 0.4 * Math.sin(phase + age * 5));
    profile[p + 5] = center + (1.2 + 3.4 * age) * Math.sin(phase + age * 4.3 + 0.8);
    profile[p + 6] = center + 2 + 4.5 * age + 1.4 * Math.sin(phase + age * 5.8);
    // Two folds become visible behind the front at different ages. They peel apart
    // and fade at different rates, rather than tracing three parallel rectangles.
    profile[p + 7] = smooth((historyAge - 0.085) / 0.1) * (1 - smooth((age - 0.65) / 0.35));
    profile[p + 8] =
      smooth((historyAge - 0.17) / 0.12) *
      (1 - smooth((age - 0.5) / 0.5)) *
      smooth((Math.sin(phase + age * 5) + 0.4) / 1.4);
    profile[p + 9] = phase;
    profile[p + 10] = age;
    profile[p + 11] = 0.5 + 0.5 * Math.sin(phase + age * 2.4);
  }
}

const SPECTRUM = [
  [255, 91, 119],
  [255, 167, 76],
  [255, 231, 110],
  [111, 244, 142],
  [100, 227, 255],
  [128, 146, 255],
  [214, 122, 255],
];

/** Edge light only. Both materials share the exact same moving heads and trail age. */
export function createActivationFlowPainter(
  canvas: HTMLCanvasElement,
  speedMultiplier = 1.5,
  material: 'pearl' | 'rainbow' = 'pearl'
) {
  canvas.width = 328;
  canvas.height = 408;
  const context = canvas.getContext('2d');
  if (!context) return (_time: number) => {};

  const image = context.createImageData(canvas.width, canvas.height);
  // Pixel offset, signed edge distance, arc-profile index, coverage at the edge.
  // Geometry is fixed; the animation only transports light along this perimeter.
  const field: number[] = [];
  for (let row = 0; row < canvas.height; row++) {
    for (let col = 0; col < canvas.width; col++) {
      const x = (col + 0.5) / 2 - 32;
      const y = (row + 0.5) / 2 - 32;
      const qx = Math.abs(x - 50) - (50 - RADIUS);
      const qy = Math.abs(y - 70) - (70 - RADIUS);
      const distance =
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RADIUS;
      if (distance < -0.25 || distance > 25) continue;
      const position = (((edgePosition(x, y) / PERIMETER) % 1) + 1) % 1;
      field.push(
        (row * canvas.width + col) * 4,
        distance,
        Math.floor(position * PROFILE_SAMPLES),
        smooth((distance + 0.25) / 0.65) * (1 - smooth((distance - 21) / 4))
      );
    }
  }
  const geometry = new Float32Array(field);
  const main = new Float32Array(PROFILE_SAMPLES * PROFILE_STRIDE);
  const echo = new Float32Array(PROFILE_SAMPLES * PROFILE_STRIDE);

  return (time: number) => {
    const t = clamp(time);
    // Only transport is accelerated; trail age, unfolding and the 1s wrapper
    // still use real elapsed time. The comparison page can request the old 1x.
    writeRibbonProfile(main, t, false, speedMultiplier);
    writeRibbonProfile(echo, t, true, speedMultiplier);

    for (let i = 0; i < geometry.length; i += 4) {
      const pixel = geometry[i];
      const distance = geometry[i + 1];
      const p = geometry[i + 2] * PROFILE_STRIDE;
      // The two short wakes do not overlap around the perimeter. No full-ring
      // base glow: unoccupied stretches stay genuinely transparent.
      const profile = main[p] >= echo[p] ? main : echo;
      const strength = profile[p];
      const coverage = geometry[i + 3];
      if (strength < 0.001) {
        image.data[pixel + 3] = 0;
        continue;
      }
      if (material === 'rainbow') {
        const age = profile[p + 10];
        // A simple coloured stroke stays close to the edge. Its thinner, fading
        // tail follows the head's history rather than lighting the entire rim.
        const across = distance - 1.6;
        const coreWidth = (0.62 + 0.5 * (1 - age)) * 1.2;
        const core = Math.exp(-(across ** 2) / (2 * coreWidth ** 2));
        const halo = Math.exp(-(across ** 2) / (2 * (2.5 + age) ** 2));
        const light = strength * coverage;
        const coreWeight = core * 0.92;
        const haloWeight = halo * 0.38 * (1 - coreWeight);
        const alpha = (coreWeight + haloWeight) * light;
        // The rainbow travels with each stroke; it is not a stationary gradient
        // over a pulsing border. The second head starts at a different hue.
        const colourPosition = (age * 6 + (profile === echo ? 3 : 0)) % 7;
        const start = Math.floor(colourPosition);
        const mix = smooth(colourPosition - start);
        const from = SPECTRUM[start];
        const to = SPECTRUM[(start + 1) % SPECTRUM.length];
        const highlight = core * 0.28;
        for (let channel = 0; channel < 3; channel++) {
          const colour = from[channel] + (to[channel] - from[channel]) * mix;
          image.data[pixel + channel] = colour + (255 - colour) * highlight;
        }
        image.data[pixel + 3] = 255 * alpha;
        continue;
      }
      const center = profile[p + 1];
      const width = profile[p + 2];
      const nose = profile[p + 3];
      const age = profile[p + 10];
      const across = (distance - center) / width;
      const thickness =
        0.74 +
        0.18 * Math.sin(across * 2.2 + profile[p + 9] + age * 4) +
        0.08 * Math.sin(across * 4.7 - profile[p + 9] * 1.3);
      const light = strength * coverage;
      const coreWidth = 0.38 + 0.42 * nose + 0.12 * Math.sin(Math.PI * age);
      const coreDistance = distance - profile[p + 4];
      const core =
        Math.exp(-(coreDistance ** 2) / (2 * coreWidth ** 2)) * (0.16 + 0.72 * nose) * light;
      const foldDistance = distance - profile[p + 5];
      const foldWidth = 0.3 + 0.36 * Math.sin(Math.PI * age);
      const fold =
        Math.exp(-(foldDistance ** 2) / (2 * foldWidth ** 2)) * 0.37 * profile[p + 7] * light;
      const wispDistance = distance - profile[p + 6];
      const wispWidth = 0.25 + 0.32 * (1 - age);
      const wisp =
        Math.exp(-(wispDistance ** 2) / (2 * wispWidth ** 2)) * 0.2 * profile[p + 8] * light;
      // One side of a fold gathers more tightly; its outer face is wider and softer.
      // This avoids the symmetric cross-section of a glowing tube.
      const sheetAcross = across / (across < 0 ? 0.68 : 1.08);
      const body = Math.exp(-(sheetAcross ** 2) / 2) * 0.44 * thickness * light;
      const bloom = Math.exp(-(across ** 2) / 9) * (0.08 + 0.07 * nose) * light;
      // Fold highlights sit above a translucent, faintly pearlescent membrane.
      // A restrained warm/cool shift gives depth without rainbow bands or sparks.
      const foldWeight = fold * (1 - core);
      const wispWeight = wisp * (1 - core) * (1 - fold);
      const bodyWeight = body * (1 - core) * (1 - fold) * (1 - wisp);
      const bloomWeight = bloom * (1 - core) * (1 - fold) * (1 - wisp) * (1 - body);
      const alpha = core + foldWeight + wispWeight + bodyWeight + bloomWeight;
      const pearl = profile[p + 11];
      image.data[pixel] = Math.round(
        (255 * core +
          248 * foldWeight +
          220 * wispWeight +
          (218 + 26 * pearl) * bodyWeight +
          235 * bloomWeight) /
          alpha
      );
      image.data[pixel + 1] = Math.round(
        (250 * core +
          239 * foldWeight +
          225 * wispWeight +
          (212 + 12 * pearl) * bodyWeight +
          220 * bloomWeight) /
          alpha
      );
      image.data[pixel + 2] = Math.round(
        (230 * core +
          240 * foldWeight +
          249 * wispWeight +
          (241 - 31 * pearl) * bodyWeight +
          222 * bloomWeight) /
          alpha
      );
      image.data[pixel + 3] = Math.round(255 * alpha);
    }
    context.putImageData(image, 0, 0);
  };
}
