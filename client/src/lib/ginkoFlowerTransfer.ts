import type { PlayerViewState } from '@game/online/types';
import { getEntranceStageTarget } from './cardEntranceLanding';
import type { DoubleRelaySource, RelayPoint } from './doubleRelayEntrance';

export const ginkoFlowerTimeline = {
  relay: { charge: 150, arrive: 1100, portraitAt: 1300 },
  copy: { extract: 150, silkArrive: 500, silkEnd: 730, receive: 1030, total: 1250, reduced: 200 },
  notice: { hold: 1000, fade: 200 },
  // Keep all three stitches and the complete-knot hold; tighten the approach and docking.
  knot: { start: 420, first: 570, second: 720, tied: 900, dock: 1030, end: 1250 },
} as const;
export const flowerClamp = (n: number) => Math.max(0, Math.min(1, n));
export const flowerEase = (n: number) => {
  const t = flowerClamp(n);
  return t * t * (3 - 2 * t);
};

export function getKahoRelaySource(
  view: PlayerViewState,
  objectId: string,
  imagePath: (code: string) => string
): DoubleRelaySource | undefined {
  const source = view.match.entrance?.kahoRelays?.find((r) => r.objectId === objectId)?.source;
  if (!source) return undefined;
  const object = view.objects[source.objectId];
  const code = object?.frontInfo?.cardCode;
  return object?.surface === 'FRONT' && code
    ? {
        ...source,
        cardCode: code,
        imagePath: imagePath(code),
        side: object.ownerSeat === view.match.viewerSeat ? 'self' : 'opponent',
      }
    : undefined;
}

export function getAbilityTransferSource(
  view: PlayerViewState,
  imagePath: (code: string) => string
) {
  const transfer = view.match.entrance?.abilityTransfer;
  if (!transfer) return undefined;
  const target = getEntranceStageTarget(view, transfer.hostObjectId);
  const source = view.objects[transfer.sourceObjectId];
  const code = source?.frontInfo?.cardCode;
  if (!target || source?.surface !== 'FRONT' || !code) return undefined;
  return {
    ...transfer,
    target,
    imagePath: imagePath(code),
    name: source.frontInfo?.nameCn || source.frontInfo?.nameJp || code,
    side: source.ownerSeat === view.match.viewerSeat ? ('self' as const) : ('opponent' as const),
  };
}
export type AbilityTransferSource = NonNullable<ReturnType<typeof getAbilityTransferSource>>;

export function paintFlower(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  alpha: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = flowerClamp(alpha);
  ctx.fillStyle = '#ffe4a1';
  ctx.shadowColor = '#c4ffe6';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(-size, 0);
  ctx.bezierCurveTo(-size * 0.3, -size, size * 0.7, -size * 0.65, size, 0);
  ctx.bezierCurveTo(size * 0.3, size * 0.65, -size * 0.65, size * 0.45, -size, 0);
  ctx.fill();
  ctx.restore();
}

/** Layered, tapered membranes of light. Filled ribbons keep this from reading as a line. */
export function paintAbilitySilk(
  ctx: CanvasRenderingContext2D,
  from: RelayPoint,
  to: RelayPoint,
  elapsed: number
) {
  const t = ginkoFlowerTimeline.copy;
  const progress = flowerEase((elapsed - t.extract) / (t.receive - t.extract));
  const finish = flowerEase((elapsed - t.receive) / (t.total - t.receive));
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const bow = Math.max(65, Math.min(150, distance * 0.32));
  const point = (p: number) => ({
    x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p - Math.sin(Math.PI * p) * bow,
  });
  // A soft sheen lifts from the source face before the silk leaves it.
  const charge = Math.sin(Math.PI * flowerClamp(elapsed / t.extract));
  if (charge > 0) {
    const glow = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, 45);
    glow.addColorStop(0, `rgba(255,235,185,${charge * 0.38})`);
    glow.addColorStop(0.5, `rgba(115,235,197,${charge * 0.24})`);
    glow.addColorStop(1, '#8ce7c000');
    ctx.fillStyle = glow;
    ctx.fillRect(from.x - 45, from.y - 45, 90, 90);
  }
  if (elapsed < t.extract) return;
  const tail = Math.max(0, progress - 0.65),
    head = progress;
  for (let ribbon = 0; ribbon < 3; ribbon++) {
    const left: RelayPoint[] = [],
      right: RelayPoint[] = [];
    for (let i = 0; i <= 36; i++) {
      const u = i / 36,
        p = tail + (head - tail) * u;
      const center = point(p);
      const dx = to.x - from.x,
        dy = to.y - from.y - Math.cos(Math.PI * p) * bow * Math.PI;
      const length = Math.hypot(dx, dy) || 1;
      const normal = { x: -dy / length, y: dx / length };
      const twist = Math.sin(u * Math.PI * 2 + elapsed / 160 + ribbon * 2.1);
      const width = Math.sin(Math.PI * u) ** 0.65 * (ribbon === 0 ? 17 : 8) * (1 - finish * 0.6);
      const offset = twist * Math.sin(Math.PI * u) * (ribbon === 0 ? 3 : 11);
      left.push({
        x: center.x + normal.x * (offset + width),
        y: center.y + normal.y * (offset + width),
      });
      right.push({
        x: center.x + normal.x * (offset - width),
        y: center.y + normal.y * (offset - width),
      });
    }
    const gradient = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    gradient.addColorStop(0, '#5dd7b000');
    gradient.addColorStop(0.3, ribbon === 1 ? '#ffe2aa55' : '#55cbb65c');
    gradient.addColorStop(0.7, ribbon === 1 ? '#fff0cdba' : '#b5ffe2b0');
    gradient.addColorStop(1, '#fff6dfdd');
    ctx.save();
    ctx.globalAlpha = (1 - finish) * Math.min(1, progress * 8);
    ctx.fillStyle = gradient;
    ctx.shadowColor = '#8ce9cdb0';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    left.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    right.reverse().forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < 15; i++) {
    const p = flowerClamp(progress - i * 0.032),
      center = point(p);
    const flutter = Math.sin(i * 2.4 + elapsed / 180) * 16;
    ctx.save();
    ctx.globalAlpha = (1 - finish) * (0.65 - i * 0.025);
    ctx.fillStyle = i % 3 ? '#d8f8dc' : '#ffe0a3';
    ctx.shadowColor = '#e4ffdf';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.ellipse(
      center.x + Math.cos(i * 1.7) * 9,
      center.y + flutter,
      1 + (i % 3) * 0.4,
      2 + (i % 2),
      i * 0.6,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();
  }
}

export interface KahoPetal {
  readonly delay: number;
  readonly size: number;
  readonly angle: number;
  readonly shade: number;
}

/** Stable distribution keeps replayed previews and both seats visually consistent. */
export function createKahoPetals(): KahoPetal[] {
  return Array.from({ length: 76 }, (_, i) => ({
    delay: ((i * 23) % 71) * 3.2,
    size: 7 + (i % 5) * 1.5,
    angle: i * 2.399,
    shade: i % 4,
  }));
}

/** Visible notched petals, with a matte body and a small vein rather than a light flare. */
function paintKahoPetal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  alpha: number,
  shade: number
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = flowerClamp(alpha);
  ctx.fillStyle = ['#ffd6e3', '#f7afc7', '#ffe5ed', '#e9a4bb'][shade]!;
  ctx.strokeStyle = ['#d897ac', '#c87c98', '#dcabc0', '#bd7f9a'][shade]!;
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  ctx.moveTo(-size, 0);
  ctx.bezierCurveTo(-size * 0.3, -size * 0.85, size * 0.6, -size * 0.85, size, -size * 0.22);
  ctx.lineTo(size * 0.72, 0);
  ctx.lineTo(size, size * 0.22);
  ctx.bezierCurveTo(size * 0.6, size * 0.85, -size * 0.3, size * 0.85, -size, 0);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha *= 0.35;
  ctx.beginPath();
  ctx.moveTo(-size * 0.75, 0);
  ctx.quadraticCurveTo(0, -size * 0.15, size * 0.55, 0);
  ctx.stroke();
  ctx.restore();
}

/** Petals scatter along individual curves, then arrive at the center successively. */
export function paintKahoFlowerRelay(
  ctx: CanvasRenderingContext2D,
  from: RelayPoint,
  portrait: { left: number; top: number; width: number; height: number },
  petals: readonly KahoPetal[],
  elapsed: number
) {
  const t = ginkoFlowerTimeline.relay;
  const gather = flowerEase((elapsed - t.arrive) / (t.portraitAt - t.arrive));
  const viewportWidth = ctx.canvas.width / (window.devicePixelRatio || 1);
  const viewportHeight = ctx.canvas.height / (window.devicePixelRatio || 1);
  const spreadX = Math.min(viewportWidth * 0.43, portrait.width * 1.1) * 0.5;
  const spreadY = Math.min(viewportHeight * 0.31, portrait.height * 0.42) * 0.5;
  const to = { x: portrait.left + portrait.width * 0.5, y: portrait.top + portrait.height * 0.43 };
  for (let i = 0; i < petals.length; i++) {
    const petal = petals[i]!;
    const flightStart = t.charge + petal.delay;
    if (elapsed < flightStart) continue;
    const radius = 0.45 + (i % 7) / 12;
    const outward = {
      x: Math.max(
        22,
        Math.min(viewportWidth - 22, to.x + Math.cos(petal.angle) * spreadX * radius)
      ),
      y: Math.max(
        50,
        Math.min(viewportHeight - 50, to.y + Math.sin(petal.angle) * spreadY * radius)
      ),
    };
    // No shared turning frame or stationary cloud. Earlier arrivals fade while others keep flying.
    const arrivalAt = t.arrive - 400 + ((i * 37) % 101) * 4;
    const q = flowerClamp((elapsed - flightStart) / (arrivalAt - flightStart));
    const control = {
      x: outward.x + Math.cos(petal.angle + 1.3) * 22,
      y: outward.y + Math.sin(petal.angle + 1.3) * 22,
    };
    const n = 1 - q;
    const x =
      n ** 3 * from.x + 3 * n ** 2 * q * outward.x + 3 * n * q ** 2 * control.x + q ** 3 * to.x;
    const y =
      n ** 3 * from.y + 3 * n ** 2 * q * outward.y + 3 * n * q ** 2 * control.y + q ** 3 * to.y;
    const fade = 1 - flowerEase((elapsed - arrivalAt) / 120);
    const size = petal.size * Math.min(1, portrait.width / 340) * (1 - gather * 0.65);
    paintKahoPetal(
      ctx,
      x,
      y,
      size,
      petal.angle + q * (i % 2 ? 3 : -3),
      flowerEase((elapsed - flightStart) / 70) * (1 - gather) * fade,
      petal.shade
    );
  }
}

/** Portrait decoration shares the mesh clock and the original hand position. */
export function paintPortraitFlowers(
  canvas: HTMLCanvasElement,
  elapsed: number,
  hand: readonly [number, number],
  reduced: boolean,
  receivedPrelude = false
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (canvas.width !== 640 || canvas.height !== 900) {
    canvas.width = 640;
    canvas.height = 900;
  }
  ctx.clearRect(0, 0, 640, 900);
  if (reduced || elapsed < 0) return;
  const t = elapsed / 1950,
    glow = Math.max(
      Math.sin(Math.PI * flowerClamp(t)),
      receivedPrelude ? 1 - flowerClamp(elapsed / 650) : 0
    );
  const x = hand[0] * 640,
    y = hand[1] * 900;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, 70);
  gradient.addColorStop(0, `rgba(255,235,160,${glow * 0.55})`);
  gradient.addColorStop(0.35, `rgba(115,242,196,${glow * 0.22})`);
  gradient.addColorStop(1, 'rgba(115,242,196,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x - 70, y - 70, 140, 140);
  for (let i = 0; i < 6; i++) {
    const p = flowerClamp((t - 0.1 - i * 0.035) / 0.8);
    paintFlower(
      ctx,
      x + Math.sin(i * 2.4 + p) * (15 + p * 70),
      y - p * 100,
      3 + (i % 3),
      i + p * 3,
      Math.sin(Math.PI * p) * 0.75
    );
  }
}
