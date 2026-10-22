export type Point = { x: number; y: number };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
function cubic(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const n = 1 - t;
  return {
    x: n ** 3 * a.x + 3 * n ** 2 * t * b.x + 3 * n * t ** 2 * c.x + t ** 3 * d.x,
    y: n ** 3 * a.y + 3 * n ** 2 * t * b.y + 3 * n * t ** 2 * c.y + t ** 3 * d.y,
  };
}
function path(ctx: CanvasRenderingContext2D, points: readonly Point[]) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
}
function partial(points: readonly Point[], fraction: number): Point[] {
  const f = clamp(fraction) * (points.length - 1),
    n = Math.floor(f);
  const a = points[n]!,
    b = points[n + 1];
  return [
    ...points.slice(0, n + 1),
    ...(b ? [{ x: a.x + (b.x - a.x) * (f - n), y: a.y + (b.y - a.y) * (f - n) }] : []),
  ];
}
type Curve = readonly [Point, Point, Point, Point];
const p = (x: number, y: number): Point => ({ x, y });
function sample(curves: readonly Curve[]): Point[] {
  return curves.flatMap((c) => Array.from({ length: 33 }, (_, i) => cubic(...c, i / 32)));
}
// Front-facing reconstruction: the occluded upper loop is complete, side loops
// share a frontal plane, and both free ends hang down. The same geometry is used
// for the large sewing animation and the small on-card marker.
export const knotPaths = {
  upper: sample([
    [p(0, -2), p(-27, -25), p(-10, -38), p(0, -31)],
    [p(0, -31), p(10, -38), p(27, -25), p(0, -2)],
  ]),
  left: sample([
    [p(-2, 0), p(-20, -19), p(-43, -14), p(-34, 6)],
    [p(-34, 6), p(-28, 23), p(-11, 17), p(-2, 0)],
  ]),
  right: sample([
    [p(2, 0), p(20, -19), p(43, -14), p(34, 6)],
    [p(34, 6), p(28, 23), p(11, 17), p(2, 0)],
  ]),
  tailLeft: sample([
    [p(-3, 4), p(-9, 17), p(-12, 25), p(-13, 36)],
    [p(-13, 36), p(-14, 47), p(-12, 56), p(-15, 65)],
  ]),
  tailRight: sample([
    [p(3, 4), p(9, 17), p(12, 26), p(13, 37)],
    [p(13, 37), p(14, 47), p(17, 55), p(16, 62)],
  ]),
  center: sample([
    [p(-5, -4), p(-13, 1), p(-5, 10), p(1, 3)],
    [p(1, 3), p(12, -5), p(5, -12), p(-2, -4)],
    [p(-2, -4), p(-10, 6), p(5, 13), p(5, 4)],
    [p(5, 4), p(5, -3), p(-1, -8), p(-5, -4)],
  ]),
};
export const knotViewBox = { x: -44, y: -40, width: 88, height: 110 };
export const knotColors = { shadow: '#823b49', body: '#cf6370', highlight: '#ef9ca3' };
// Five separate white petals sit over the interlacing red cord, matching the
// distinctive flower in the reference. Shared by Canvas and the attached SVG.
export const knotFlowerPetals = Array.from({ length: 5 }, (_, i) => {
  const angle = (i * Math.PI * 2) / 5,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return sample([
    [p(0, -0.8), p(-6, -4), p(-5, -11.8), p(0, -11.8)],
    [p(0, -11.8), p(5, -11.8), p(6, -4), p(0, -0.8)],
  ]).map(({ x, y }) => p(x * c - y * s, x * s + y * c));
});
export const knotFlowerColors = { body: '#fff9ef', edge: '#c98b91', center: '#edc6b4' };
export function knotPolyline(points: readonly Point[]) {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}
function cord(ctx: CanvasRenderingContext2D, points: Point[], fraction: number, thin = false) {
  if (fraction <= 0) return;
  path(ctx, partial(points, fraction));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = knotColors.shadow;
  ctx.lineWidth = thin ? 4.3 : 5.3;
  ctx.stroke();
  ctx.strokeStyle = knotColors.body;
  ctx.lineWidth = thin ? 2.8 : 3.8;
  ctx.stroke();
  ctx.save();
  ctx.translate(-0.35, -0.45);
  path(ctx, partial(points, fraction));
  ctx.strokeStyle = knotColors.highlight;
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.restore();
}
export function drawKnot(
  ctx: CanvasRenderingContext2D,
  upper = 1,
  left = 1,
  right = 1,
  tails = 1,
  center = 1
) {
  cord(ctx, knotPaths.tailLeft, tails, true);
  cord(ctx, knotPaths.tailRight, tails, true);
  cord(ctx, knotPaths.upper, upper);
  cord(ctx, knotPaths.left, left);
  cord(ctx, knotPaths.right, right);
  cord(ctx, knotPaths.center, center);
  knotFlowerPetals.forEach((petal, i) => {
    const reveal = Math.max(0, Math.min(1, center * 2 - i * 0.25));
    if (!reveal) return;
    ctx.save();
    ctx.globalAlpha *= reveal;
    path(ctx, petal);
    ctx.closePath();
    ctx.fillStyle = knotFlowerColors.body;
    ctx.fill();
    ctx.strokeStyle = knotFlowerColors.edge;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  });
  if (center > 0) {
    ctx.save();
    ctx.globalAlpha *= center;
    ctx.beginPath();
    ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = knotFlowerColors.center;
    ctx.fill();
    ctx.restore();
  }
}
