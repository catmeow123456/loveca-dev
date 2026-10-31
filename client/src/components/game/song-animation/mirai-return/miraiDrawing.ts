import { clamp, ease } from '@/lib/miraiReturn';
export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export interface MiraiLayout {
  board: Rect;
  waiting: Rect;
  deck: Rect;
  targets: Rect[];
}
export const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const curve = (a: Point, b: Point, c: Point, d: Point, t: number): Point => ({
  x: (1 - t) ** 3 * a.x + 3 * (1 - t) ** 2 * t * b.x + 3 * (1 - t) * t * t * c.x + t ** 3 * d.x,
  y: (1 - t) ** 3 * a.y + 3 * (1 - t) ** 2 * t * b.y + 3 * (1 - t) * t * t * c.y + t ** 3 * d.y,
});
function note(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha: number,
  tilt = 0
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = '#fff3bc';
  ctx.strokeStyle = '#fff3bc';
  ctx.lineWidth = size * 0.12;
  ctx.lineCap = 'round';
  ctx.shadowColor = '#d9aaff';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.37, size * 0.25, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(size * 0.32, -size * 0.1);
  ctx.lineTo(size * 0.32, -size * 1.12);
  ctx.bezierCurveTo(size * 0.45, -size * 0.78, size * 0.9, -size * 0.86, size * 0.63, -size * 0.4);
  ctx.stroke();
  ctx.restore();
}
/** Deterministic drawing only. All nine faces come from the authority's public pre-shuffle set. */
export function drawMirai(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  layout: MiraiLayout,
  cover: HTMLImageElement,
  cards: HTMLImageElement[],
  blade: HTMLImageElement,
  reduced: boolean
) {
  const { board, waiting, deck, targets } = layout;
  const c = center(board),
    w = Math.min(board.width * 0.7, 440, board.height * 0.78);
  const y = board.y + board.height * 0.5,
    scale = w / 540;
  const reveal = ease(elapsed / 280),
    fade = 1 - ease((elapsed - 1650) / 450);
  ctx.save();
  ctx.beginPath();
  ctx.rect(board.x, board.y, board.width, board.height);
  ctx.clip();
  if (reduced) {
    for (const r of targets) {
      ctx.strokeStyle = '#ddc5ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x - 2, r.y - 2, r.width + 4, r.height + 4);
    }
    ctx.fillStyle = '#201b3de8';
    ctx.beginPath();
    ctx.roundRect(c.x - 120, y - 24, 240, 48, 12);
    ctx.fill();
    ctx.fillStyle = '#fff3d4';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('9 张回到卡组底 · BLADE +1', c.x, y + 5);
    ctx.restore();
    return;
  }
  // A soft night-sky aperture keeps the five-person jacket composition intact.
  const haze = ctx.createRadialGradient(c.x, y, w * 0.08, c.x, y, w * 0.68);
  haze.addColorStop(0, `rgba(15,13,40,${0.9 * reveal * fade})`);
  haze.addColorStop(0.75, `rgba(15,13,40,${0.65 * reveal * fade})`);
  haze.addColorStop(1, 'rgba(15,13,40,0)');
  ctx.fillStyle = haze;
  ctx.fillRect(c.x - w * 0.9, y - w * 0.7, w * 1.8, w * 1.5);
  const artY = y - w * 0.52 + Math.sin(elapsed / 700) * 1.2 * scale;
  ctx.save();
  ctx.globalAlpha = reveal * fade;
  ctx.beginPath();
  ctx.roundRect(c.x - w / 2, artY, w, w * 0.74, 18 * scale);
  ctx.clip();
  // Crop only the jacket's upper title area; never repaint or separate occluded hands.
  const sy = cover.height * 0.26;
  ctx.drawImage(cover, 0, sy, cover.width, cover.height - sy, c.x - w / 2, artY, w, w * 0.74);
  const veil = ctx.createLinearGradient(0, artY, 0, artY + w * 0.74);
  veil.addColorStop(0, '#131428a8');
  veil.addColorStop(0.22, '#13142800');
  veil.addColorStop(0.76, '#13142800');
  veil.addColorStop(1, '#131428');
  ctx.fillStyle = veil;
  ctx.fillRect(c.x - w / 2, artY, w, w * 0.74);
  ctx.restore();
  // Five origin voices form a shallow luminous score below the singers, with no head replacement.
  const scoreY = y + w * 0.17;
  for (let line = 0; line < 5; line++) {
    ctx.save();
    ctx.globalAlpha = reveal * fade * 0.4;
    ctx.lineWidth = 0.8 * scale;
    ctx.strokeStyle = line % 2 ? '#c5b7ff' : '#bdeaff';
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const u = i / 80;
      const px = c.x - w * 0.48 + u * w * 0.96;
      const py = scoreY + line * 6 * scale + Math.sin(u * Math.PI * 2 - elapsed / 600) * 8 * scale;
      if (!i) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < 5; i++) {
    const px = c.x + w * (i - 2) * 0.19,
      py = scoreY;
    const a = ease((elapsed - 110 - i * 25) / 240) * (1 - ease((elapsed - 900) / 350));
    ctx.save();
    ctx.globalAlpha = a * 0.55;
    ctx.strokeStyle = '#f4d5ff';
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    ctx.moveTo(px, y - w * 0.1);
    ctx.bezierCurveTo(px - 12 * scale, y + w * 0.02, px + 20 * scale, py - 22 * scale, px, py);
    ctx.stroke();
    ctx.restore();
  }
  const origin = center(waiting),
    dest = { x: deck.x + deck.width * 0.5, y: deck.y + deck.height * 0.83 };
  // Public card -> rounded note head, with a curling corner becoming the stem.
  for (let i = 0; i < 9; i++) {
    const age = elapsed - 190 - i * 36;
    if (age < 0 || elapsed >= 1210) continue;
    const rise = ease(age / 390),
      morph = ease((age - 280) / 320),
      mixing = ease((elapsed - 940) / 270);
    const lane = (i - 4) / 4,
      end = { x: c.x + lane * w * 0.4, y: scoreY + Math.abs(lane) * w * 0.055 };
    let p = curve(
      origin,
      { x: origin.x + (end.x - origin.x) * 0.18, y: origin.y - w * 0.28 },
      { x: end.x, y: end.y - w * 0.24 },
      end,
      rise
    );
    p = {
      x: mix(p.x, c.x + Math.sin(i * 2.4 + elapsed / 130) * w * 0.085, mixing),
      y: mix(p.y, scoreY + Math.cos(i * 2.4 + elapsed / 130) * w * 0.045, mixing),
    };
    const cw = mix(62 * scale, 22 * scale, morph),
      ch = mix(86 * scale, 14 * scale, morph);
    ctx.save();
    ctx.globalAlpha = ease(age / 90) * (1 - ease((elapsed - 1140) / 70));
    ctx.translate(p.x, p.y);
    ctx.rotate(mix(lane * 0.15 + Math.sin(age / 160) * 0.07, -0.3, morph));
    ctx.shadowColor = '#dec2ff';
    ctx.shadowBlur = 8 * morph;
    ctx.beginPath();
    ctx.roundRect(-cw / 2, -ch / 2, cw, ch, mix(5 * scale, ch * 0.5, morph));
    ctx.save();
    ctx.clip();
    ctx.drawImage(cards[i], -cw / 2, -ch / 2, cw, ch);
    ctx.fillStyle = `rgba(255,239,188,${morph * 0.98})`;
    ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
    ctx.restore();
    ctx.strokeStyle = `rgba(255,239,210,${0.8})`;
    ctx.lineWidth = 1 * scale;
    ctx.stroke();
    if (morph > 0) {
      ctx.strokeStyle = '#fff1bf';
      ctx.lineWidth = 2.4 * scale * morph;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cw * 0.4, 0);
      ctx.bezierCurveTo(
        cw * 0.48,
        -12 * scale * morph,
        cw * 0.48,
        -24 * scale * morph,
        cw * 0.48,
        -35 * scale * morph
      );
      ctx.bezierCurveTo(
        cw * 0.8,
        -25 * scale * morph,
        cw * 1.2,
        -25 * scale * morph,
        cw * 0.85,
        -15 * scale * morph
      );
      ctx.stroke();
    }
    ctx.restore();
  }
  // A separate, anonymous phrase emerges only after all card identities have dissolved.
  if (elapsed > 1100) {
    const start = { x: c.x, y: scoreY };
    const b = { x: c.x + w * 0.4, y: scoreY - w * 0.25 },
      d = { x: dest.x - w * 0.2, y: dest.y - w * 0.2 };
    const presence = ease((elapsed - 1100) / 100) * (1 - ease((elapsed - 1730) / 180));
    for (let line = 0; line < 5; line++) {
      ctx.save();
      ctx.globalAlpha = presence * 0.28;
      ctx.strokeStyle = '#cec3ff';
      ctx.lineWidth = 0.8 * scale;
      ctx.beginPath();
      for (let s = 0; s <= 60; s++) {
        const p = curve(start, b, d, dest, s / 60);
        const off = Math.sin((s / 60) * Math.PI) * (line - 2) * 5 * scale;
        if (!s) ctx.moveTo(p.x, p.y + off);
        else ctx.lineTo(p.x, p.y + off);
      }
      ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < 9; i++) {
      const progress = clamp((elapsed - 1150 - i * 25) / 530),
        p = curve(start, b, d, dest, ease(progress));
      const a = ease((elapsed - 1120 - i * 25) / 100) * (1 - ease((progress - 0.84) / 0.16));
      note(
        ctx,
        p.x,
        p.y + Math.sin(progress * Math.PI) * ((i % 3) - 1) * 12 * scale,
        27 * scale * (1 - progress * 0.45),
        a,
        Math.sin(progress * 5 + i) * 0.14
      );
    }
    ctx.save();
    ctx.globalAlpha = presence * 0.7;
    ctx.strokeStyle = '#e9d4ff';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(deck.x, dest.y);
    ctx.quadraticCurveTo(dest.x, dest.y + 5 * scale, deck.x + deck.width, dest.y);
    ctx.stroke();
    ctx.restore();
  }
  const reward = ease((elapsed - 1650) / 180) * (1 - ease((elapsed - 1920) / 180));
  for (const r of targets) {
    const p = center(r),
      bw = Math.min(72, r.width * 0.85);
    ctx.save();
    ctx.globalAlpha = reward;
    ctx.shadowColor = '#cab7ff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#18152ae8';
    ctx.beginPath();
    ctx.roundRect(p.x - bw / 2, r.y - 19, bw, 32, 9);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.drawImage(blade, p.x - bw / 2 + 7, r.y - 15, 24, 24);
    ctx.fillStyle = '#fff4d8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 19px sans-serif';
    ctx.fillText('+1', p.x + 13, r.y + 8);
    ctx.restore();
  }
  ctx.restore();
}
