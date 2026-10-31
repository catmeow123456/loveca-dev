import { izumiReplayTiming as t } from '@/lib/izumiReplay';

export type Point = { x: number; y: number };
export const clamp = (v: number) => Math.max(0, Math.min(1, v));
export const ease = (v: number) => {
  const p = clamp(v);
  return p * p * (3 - 2 * p);
};
export function arc(from: Point, to: Point, progress: number, bend: number): Point {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress - Math.sin(progress * Math.PI) * bend,
  };
}

/** Soft flowing light follows the card, without a separate moon or spotlight. */
function flowLight(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  head: number,
  alpha: number,
  width: number,
  bend: number
) {
  const tail = Math.max(0, head - 0.72);
  for (let layer = 0; layer < 3; layer++) {
    const left: Point[] = [],
      right: Point[] = [];
    for (let i = 0; i <= 40; i++) {
      const u = i / 40,
        p = tail + (head - tail) * u;
      const center = arc(from, to, p, bend);
      const dx = to.x - from.x,
        dy = to.y - from.y - Math.cos(p * Math.PI) * Math.PI * bend;
      const length = Math.hypot(dx, dy) || 1;
      const breadth = Math.sin(Math.PI * u) ** 0.7 * width * (1 - layer * 0.28);
      left.push({ x: center.x - (dy / length) * breadth, y: center.y + (dx / length) * breadth });
      right.push({
        x: center.x + (dy / length) * breadth * 0.45,
        y: center.y - (dx / length) * breadth * 0.45,
      });
    }
    const shade = ctx.createLinearGradient(from.x, from.y, to.x, to.y);
    shade.addColorStop(0, '#6572bc00');
    shade.addColorStop(0.42, '#717aca24');
    shade.addColorStop(0.76, layer === 2 ? '#ede5ffad' : '#c1cbef60');
    shade.addColorStop(1, '#fff5e3dd');
    ctx.save();
    ctx.globalAlpha = alpha * (layer === 0 ? 0.55 : 0.45);
    ctx.fillStyle = shade;
    ctx.filter = `blur(${layer === 0 ? 5 : 2}px)`;
    ctx.shadowColor = '#a6b9ff';
    ctx.shadowBlur = layer === 0 ? 18 : 3;
    ctx.beginPath();
    left.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    right.reverse().forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function pool(ctx: CanvasRenderingContext2D, at: Point, size: number, alpha: number) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.scale(1, 0.42);
  const light = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
  light.addColorStop(0, '#fff4e580');
  light.addColorStop(0.3, '#bcc7ff40');
  light.addColorStop(1, '#9c9eff00');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function petal(
  ctx: CanvasRenderingContext2D,
  at: Point,
  size: number,
  turn: number,
  alpha: number
) {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(turn);
  ctx.scale(Math.max(0.24, Math.abs(Math.cos(turn * 1.3))), 1);
  ctx.globalAlpha = alpha;
  const shade = ctx.createLinearGradient(-size, -size, size, size);
  shade.addColorStop(0, '#fcf7ec');
  shade.addColorStop(0.55, '#e3e5f8');
  shade.addColorStop(1, '#8998c9');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(-size, 0);
  ctx.bezierCurveTo(-size * 0.65, -size, size * 0.5, -size * 1.15, size, -size * 0.25);
  ctx.bezierCurveTo(size * 1.05, size * 0.6, -size * 0.45, size * 0.65, -size, 0);
  ctx.fill();
  ctx.restore();
}

export function paintIzumiMoonlight(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  layout: {
    host: Point;
    stage: Point;
    waiting: Point;
    destination: Point;
    size: number;
  },
  portrait: boolean,
  reduced: boolean
) {
  const { host, stage, waiting, destination, size } = layout;
  if (reduced) {
    pool(ctx, stage, size * 0.7, 1 - elapsed / t.reduced);
    return;
  }
  const invite = ease(elapsed / t.bow),
    retreat = ease((elapsed - t.bow) / (t.waiting - t.bow));
  const arrival = ease((elapsed - t.returnAt) / (t.end - t.returnAt));
  const fade = 1 - ease((elapsed - 850) / 150);
  pool(ctx, host, size * 0.56, Math.sin(Math.PI * clamp(elapsed / 420)) * 0.8);
  if (elapsed < t.returnAt) {
    flowLight(ctx, host, stage, invite, (1 - retreat) * 0.8, size * 0.12, size * 0.08);
    pool(ctx, stage, size * 0.78, Math.sin(Math.PI * invite) * 0.8);
    if (elapsed > t.bow) flowLight(ctx, stage, waiting, retreat, 0.72, size * 0.16, size * 0.18);
  } else {
    flowLight(
      ctx,
      waiting,
      destination,
      arrival,
      fade,
      size * (portrait ? 0.27 : 0.15),
      size * 0.45
    );
    pool(ctx, destination, size * (portrait ? 1.25 : 0.8), arrival * fade);
  }
  for (let i = 0; i < 12; i++) {
    const progress = clamp((elapsed - t.invite - i * 12) / (t.end - t.invite));
    if (progress <= 0 || progress >= 1) continue;
    const at = arc(stage, destination, progress, size * (0.25 + (i % 3) * 0.12));
    at.x += Math.sin(i * 2.4 + progress * 5) * size * 0.3;
    at.y += Math.cos(i * 1.7 + progress * 4) * size * 0.2;
    petal(
      ctx,
      at,
      Math.max(3, size * (0.018 + (i % 3) * 0.005)),
      i + elapsed / (310 + i * 17),
      Math.sin(Math.PI * progress) * fade * 0.65
    );
  }
}
