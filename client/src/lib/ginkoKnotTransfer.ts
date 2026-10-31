import {
  ginkoFlowerTimeline,
  paintAbilitySilk,
  flowerClamp as clamp,
  flowerEase,
} from './ginkoFlowerTransfer';
import { drawKnot, knotPaths, knotViewBox, type Point } from './ginkoKnotShape';
import { OrientationState } from '@game/shared/types/enums';
const ease = (time: number, a: number, b: number) => flowerEase((time - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const knotTiming = ginkoFlowerTimeline.knot;
type Rect = { left: number; top: number; width: number; height: number };
function needle(ctx: CanvasRenderingContext2D, position: Point, angle: number, opacity: number) {
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate(angle);
  ctx.globalAlpha *= opacity;
  const fill = ctx.createLinearGradient(0, -2, 0, 2);
  fill.addColorStop(0, '#657981');
  fill.addColorStop(0.45, '#fff7e1');
  fill.addColorStop(1, '#b9c7c7');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(-18, -1.25);
  ctx.quadraticCurveTo(-21, 0, -18, 1.25);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#677b83';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.ellipse(-16.5, 0, 1.5, 0.45, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
export function paintAbilityKnot(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  target: Rect,
  elapsed: number,
  objectId: string,
  orientation?: OrientationState
) {
  const scale = Math.min(1.15, Math.max(0.76, target.width / 112));
  const knot = { x: to.x, y: Math.max(42 * scale, target.top - 62 * scale) };
  const t = ginkoFlowerTimeline.copy;
  const silkTime =
    elapsed <= t.extract
      ? elapsed
      : elapsed <= t.silkArrive
        ? t.extract + ((elapsed - t.extract) / (t.silkArrive - t.extract)) * (t.receive - t.extract)
        : t.receive +
          ((elapsed - t.silkArrive) / (t.silkEnd - t.silkArrive)) * (t.total - t.receive);
  if (elapsed < t.silkEnd) paintAbilitySilk(ctx, from, knot, silkTime);
  if (elapsed < knotTiming.start) return;
  const dock = ease(elapsed, knotTiming.dock, knotTiming.end);
  // Measure the invisible DOM marker so horizontal cards and both seats land exactly.
  const marker = document
    .querySelector(`[data-ginko-knot-marker="${objectId}"]`)
    ?.getBoundingClientRect();
  const sideways = orientation === OrientationState.WAITING;
  const markerScale = marker?.width
    ? (sideways ? marker.height : marker.width) / knotViewBox.width
    : Math.min(34, Math.max(22, target.width * 0.3)) / knotViewBox.width;
  const destination = marker?.width
    ? {
        x:
          marker.left +
          markerScale * (sideways ? knotViewBox.height + knotViewBox.y : -knotViewBox.x),
        y: marker.top + markerScale * (sideways ? -knotViewBox.x : -knotViewBox.y),
      }
    : { x: target.left + target.width - 20, y: target.top + target.height - 29 };
  ctx.save();
  ctx.globalAlpha = ease(elapsed, knotTiming.start, knotTiming.start + 45);
  ctx.translate(lerp(knot.x, destination.x, dock), lerp(knot.y, destination.y, dock));
  ctx.rotate(sideways ? (Math.PI / 2) * dock : 0);
  const size = lerp(scale, markerScale, dock);
  ctx.scale(size, size);
  const first = clamp((elapsed - knotTiming.start) / (knotTiming.first - knotTiming.start));
  const second = clamp((elapsed - knotTiming.first) / (knotTiming.second - knotTiming.first));
  const third = clamp((elapsed - knotTiming.second) / (knotTiming.tied - knotTiming.second));
  drawKnot(
    ctx,
    first,
    second,
    third,
    ease(elapsed, knotTiming.tied - 200, knotTiming.tied),
    ease(elapsed, knotTiming.tied - 90, knotTiming.tied)
  );
  if (elapsed < knotTiming.tied) {
    const active =
      elapsed < knotTiming.first
        ? knotPaths.upper
        : elapsed < knotTiming.second
          ? knotPaths.left
          : knotPaths.right;
    const progress =
      elapsed < knotTiming.first ? first : elapsed < knotTiming.second ? second : third;
    const index = Math.min(active.length - 2, Math.floor(progress * (active.length - 1))),
      a = active[index]!,
      b = active[index + 1]!;
    needle(ctx, a, Math.atan2(b.y - a.y, b.x - a.x), 0.25 + 0.55 * Math.sin(Math.PI * progress));
  }
  ctx.restore();
}
