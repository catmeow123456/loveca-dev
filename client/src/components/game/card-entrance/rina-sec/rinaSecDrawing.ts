import { entranceTimeline } from '@/lib/cardEntranceTimeline';
import { getLandingFlightFrame } from '@/lib/cardEntranceLanding';
import {
  clamp,
  easeOut,
  progress,
  rinaSecFrame,
  rinaSecTiming as timing,
  smooth,
  type RinaSecScene,
} from './rinaSecTimeline';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RinaSecLayout {
  board: Rect;
  member: Rect;
  live: Rect;
  deck: Rect;
  waiting: Rect;
  memberRotation?: number;
  side?: 'self' | 'opponent';
}
export interface RinaSecImages {
  member: HTMLImageElement;
  oldLive: CanvasImageSource;
  newLive: CanvasImageSource;
}
type Point = { x: number; y: number };
const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const pink = '#ffabd9',
  mint = '#b8f9ec';
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r = 6) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function curve(a: Point, b: Point, p: number, lift: number): Point {
  return { x: mix(a.x, b.x, p), y: mix(a.y, b.y, p) - Math.sin(p * Math.PI) * lift };
}
function glow(ctx: CanvasRenderingContext2D, p: Point, size: number, color: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(1, size));
  g.addColorStop(0, color);
  g.addColorStop(1, color.slice(0, 7) + '00');
  ctx.fillStyle = g;
  ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2);
  ctx.restore();
}

/** A dot-matrix face in a bevelled physical board; no raster asset or character repaint. */
function faceBoard(
  ctx: CanvasRenderingContext2D,
  p: Point,
  width: number,
  expression: 'work' | 'happy' | 'switch' | 'connect',
  charge: number,
  opacity: number,
  beat = 0
) {
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.translate(p.x, p.y);
  const w = width,
    h = width * 0.66;
  ctx.shadowColor = '#030714b0';
  ctx.shadowBlur = w * 0.12;
  ctx.shadowOffsetY = w * 0.045;
  const edge = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  edge.addColorStop(0, '#fff6fa');
  edge.addColorStop(0.46, '#dbd6e7');
  edge.addColorStop(0.7, '#f7f1fb');
  edge.addColorStop(1, '#8e91ae');
  ctx.fillStyle = edge;
  rounded(ctx, -w / 2, -h / 2, w, h, w * 0.07);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = '#141b2a';
  rounded(ctx, -w * 0.454, -h * 0.423, w * 0.908, h * 0.846, w * 0.043);
  ctx.fill();
  ctx.strokeStyle = '#ffbcdf70';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  const cell = w / 34,
    top = -h * 0.34;
  for (let y = 0; y < 15; y++)
    for (let x = 0; x < 29; x++) {
      ctx.fillStyle = '#a6b0cf12';
      ctx.fillRect((x - 14.5) * cell, top + y * cell, cell * 0.46, cell * 0.46);
    }
  const dots: [number, number][] = [];
  if (expression === 'switch') {
    // Two opposed arrows make the board's intent readable before either card moves.
    for (let x = -8; x <= 8; x++) dots.push([x, -3], [x, 4]);
    for (let i = 1; i <= 3; i++)
      dots.push([8 - i, -3 - i], [8 - i, -3 + i], [-8 + i, 4 - i], [-8 + i, 4 + i]);
  } else if (expression === 'connect') {
    for (let x = 0; x < 6; x++) for (let y = -5 + x; y <= 5 - x; y++) dots.push([-10 + x, y]);
    for (let x = 0; x < 4; x++) {
      const height = Math.round(2 + (Math.sin(beat + x * 0.9) + 1) * 3);
      for (let y = 0; y < height; y++) dots.push([1 + x * 3, 5 - y]);
    }
  } else if (expression === 'happy') {
    for (const ox of [-8, 5]) for (let i = 0; i < 5; i++) dots.push([ox + i, -Math.min(i, 4 - i)]);
    for (let i = -3; i <= 3; i++) dots.push([i, 4 + (Math.abs(i) < 3 ? 1 : 0)]);
  } else {
    for (const ox of [-7, 6]) for (let y = -2; y <= 1; y++) dots.push([ox, y]);
    for (let i = -3; i <= 3; i++) dots.push([i, 5]);
  }
  if (expression === 'work' || expression === 'happy')
    dots.push([-11, 3], [-10, 4], [10, 4], [11, 3]);
  const dotColor = expression === 'connect' ? mint : pink;
  const count = Math.ceil(charge * dots.length);
  for (const [i, dot] of dots.entries()) {
    if (i >= count) continue;
    ctx.fillStyle = dotColor;
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = cell * 1.5;
    ctx.fillRect(dot[0] * cell, dot[1] * cell - cell * 1.6, cell * 0.85, cell * 0.85);
  }
  ctx.shadowBlur = 0;
  const sheen = ctx.createLinearGradient(-w / 2, -h / 2, w / 3, h / 2);
  sheen.addColorStop(0, '#ffffff1c');
  sheen.addColorStop(0.52, '#ffffff00');
  ctx.fillStyle = sheen;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
  ctx.fillStyle = charge >= 1 ? mint : '#8b8295';
  rounded(ctx, w * 0.31, h * 0.447, w * 0.065, 2, 1);
  ctx.fill();
  ctx.restore();
}

function card(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  p: Point,
  width: number,
  height: number,
  lift = 0,
  rotation = 0,
  alpha = 1
) {
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.translate(p.x, p.y);
  ctx.rotate(rotation);
  ctx.shadowColor = '#020613b0';
  ctx.shadowBlur = 3 + lift * 18;
  ctx.shadowOffsetY = 2 + lift * 10;
  ctx.fillStyle = '#121728';
  rounded(ctx, -width / 2, -height / 2, width, height, 4);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.save();
  ctx.clip();
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  const sheen = ctx.createLinearGradient(-width / 2, -height / 2, width / 2, height / 2);
  sheen.addColorStop(0, `rgba(250,244,255,${lift * 0.22})`);
  sheen.addColorStop(0.5, '#ffffff00');
  sheen.addColorStop(1, `rgba(24,17,54,${lift * 0.18})`);
  ctx.fillStyle = sheen;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.restore();
  ctx.strokeStyle = '#edceef80';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.restore();
}

/** Three hollow dot-matrix fronts carry the board's command without filling the card face. */
function boardRipple(
  ctx: CanvasRenderingContext2D,
  origin: Point,
  target: Point,
  t: number,
  color: string,
  cardWidth: number
) {
  if (t <= 0 || t >= 1) return;
  const lift = Math.min(38, Math.abs(target.x - origin.x) * 0.14 + 12);
  const width = Math.min(76, Math.max(36, cardWidth * 0.54));
  const spacing = Math.max(4.5, width / 11);
  const size = Math.max(2.4, spacing * 0.57);
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  for (let layer = 2; layer >= 0; layer--) {
    const p = t * 1.5 - layer * 0.2;
    if (p <= 0 || p >= 1) continue;
    const point = curve(origin, target, p, lift);
    const tangent = Math.atan2(
      target.y - origin.y - Math.cos(p * Math.PI) * Math.PI * lift,
      target.x - origin.x
    );
    const span = width * (0.22 + 0.78 * easeOut(progress(p, 0, 0.7)));
    const halfDots = Math.max(2, Math.floor(span / spacing / 2));
    const alpha = progress(p, 0, 0.1) * (1 - progress(p, 0.82, 1));
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(tangent);
    for (let band = 2; band >= 0; band--) {
      for (let i = -halfDots; i <= halfDots; i++) {
        const u = i / halfDots;
        // A convex front and two dimmer dotted rows create thickness, not a solid beam.
        if (band === 2 && Math.abs(i) % 2 === 1) continue;
        const x = -u * u * span * 0.23 - band * spacing * 0.8;
        const y = i * spacing;
        const edge = 1 - Math.pow(Math.abs(u), 3) * 0.45;
        ctx.globalAlpha = alpha * edge * [0.95, 0.42, 0.16][band];
        ctx.shadowBlur = band === 0 ? size * 2.2 : 0;
        const dot = size * (band === 0 ? 1 : 0.78);
        ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

/** Two shared beats at the borders acknowledge a completed swap, leaving both faces clear. */
function syncBorder(ctx: CanvasRenderingContext2D, rect: Rect, t: number) {
  if (t <= 0 || t >= 1) return;
  const beat = Math.pow(Math.sin((t % 0.5) * Math.PI * 2), 1.5);
  const gap = 4 + beat * 2;
  ctx.save();
  ctx.globalAlpha = beat * 0.8;
  ctx.strokeStyle = mint;
  ctx.shadowColor = mint;
  ctx.shadowBlur = 5 * beat;
  ctx.lineWidth = 1.4;
  rounded(ctx, rect.x - gap, rect.y - gap, rect.width + gap * 2, rect.height + gap * 2, 6);
  ctx.stroke();
  ctx.fillStyle = mint;
  const step = 9;
  for (let x = 7; x < rect.width; x += step) {
    ctx.fillRect(rect.x + x, rect.y - gap - 1.5, 3, 3);
    ctx.fillRect(rect.x + x, rect.y + rect.height + gap - 1.5, 3, 3);
  }
  for (let y = 7; y < rect.height; y += step) {
    ctx.fillRect(rect.x - gap - 1.5, rect.y + y, 3, 3);
    ctx.fillRect(rect.x + rect.width + gap - 1.5, rect.y + y, 3, 3);
  }
  ctx.restore();
}

/** One complete image throughout; scale preserves the card's proportions. */
function flyWholeLive(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  from: Point,
  to: Point,
  width: number,
  height: number,
  endScale: number,
  t: number,
  lift: number,
  rotation: number,
  color: string
) {
  const p = smooth(t),
    altitude = Math.sin(p * Math.PI);
  const point = curve(from, to, p, lift);
  const scale = mix(1, endScale, p) + altitude * 0.08;
  card(
    ctx,
    image,
    point,
    width * scale,
    height * scale,
    altitude * 0.65,
    rotation * smooth(progress(p, 0.45, 1)) - altitude * 0.035
  );
  // A restrained coloured edge is the card's response to the board's command.
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.rotate(rotation * smooth(progress(p, 0.45, 1)) - altitude * 0.035);
  ctx.globalAlpha = altitude * 0.65;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  rounded(ctx, (-width * scale) / 2, (-height * scale) / 2, width * scale, height * scale, 4);
  ctx.stroke();
  ctx.restore();
}

function cornerMarks(ctx: CanvasRenderingContext2D, rect: Rect, color: string, opacity: number) {
  ctx.save();
  ctx.globalAlpha *= clamp(opacity);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  const gap = 5,
    len = 10;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const x = rect.x + rect.width / 2 + sx * (rect.width / 2 + gap);
      const y = rect.y + rect.height / 2 + sy * (rect.height / 2 + gap);
      ctx.beginPath();
      ctx.moveTo(x - sx * len, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - sy * len);
      ctx.stroke();
    }
  ctx.restore();
}

export function drawRinaSec(
  ctx: CanvasRenderingContext2D,
  scene: RinaSecScene,
  time: number,
  reduced: boolean,
  layout: RinaSecLayout,
  images: RinaSecImages
) {
  const { board, member, live, deck, waiting } = layout;
  const frame = rinaSecFrame(scene, time, reduced),
    m = center(member),
    l = center(live);
  if (reduced) {
    cornerMarks(ctx, scene === 'entrance' ? member : live, pink, 1 - progress(time, 120, 240));
    return;
  }
  if (scene === 'entrance') {
    const c = { x: board.x + board.width * 0.5, y: board.y + board.height * 0.42 };
    const size = Math.min(235, board.width * 0.44);
    if (time < 1050) {
      const open = easeOut(progress(time, 0, 220)),
        dissolve = smooth(progress(time, 550, 980));
      ctx.save();
      ctx.fillStyle = `rgba(12,17,31,${0.38 * open * (1 - dissolve)})`;
      ctx.fillRect(board.x, board.y, board.width, board.height);
      ctx.restore();
      glow(ctx, c, size, '#d795d94d', open * (1 - dissolve));
      faceBoard(
        ctx,
        c,
        size * (0.94 + open * 0.06),
        time < 330 ? 'work' : 'happy',
        progress(time, 80, 300),
        open * (1 - dissolve)
      );
      for (let i = 0; i < 30; i++) {
        const p = progress(time, 510 + (i % 6) * 15, 1020 + (i % 6) * 15);
        const side = i % 2 ? -1 : 1,
          row = Math.floor(i / 2) - 7;
        const x = c.x + side * (size * 0.46 + easeOut(p) * size * 0.52);
        const y = c.y + row * size * 0.04 + Math.sin(p * Math.PI) * row * 2;
        ctx.save();
        ctx.globalAlpha = Math.sin(p * Math.PI) * 0.72;
        ctx.fillStyle = i % 3 ? pink : mint;
        ctx.fillRect(x, y, 3 + (i % 3), 3 + (i % 3));
        ctx.restore();
      }
    }
    const flightStart = timing.portraitAt + entranceTimeline.landingAt;
    if (time >= flightStart && !frame.memberVisible) {
      const f = getLandingFlightFrame(
        time - flightStart,
        entranceTimeline.travel,
        entranceTimeline.press
      );
      const scale = 1 + 0.6 * f.height;
      card(
        ctx,
        images.member,
        { x: mix(c.x, m.x, f.path), y: mix(c.y, m.y, f.path) },
        (layout.memberRotation ? member.height : member.width) * scale,
        (layout.memberRotation ? member.width : member.height) * scale,
        f.height,
        (layout.memberRotation ?? 0) * f.path - 0.075 * f.height
      );
    }
    if (frame.memberVisible) {
      const p = progress(time, flightStart + entranceTimeline.flight, timing.entrance);
      cornerMarks(ctx, member, pink, 1 - p);
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.5;
      ctx.strokeStyle = mint;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, member.width * (0.45 + easeOut(p) * 1.2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    return;
  }
  const bw = Math.min(135, Math.max(82, member.width * 1.22));
  const bpos = {
    x: Math.max(board.x + bw / 2 + 5, Math.min(board.x + board.width - bw / 2 - 5, m.x)),
    y:
      layout.side === 'opponent'
        ? Math.min(board.y + board.height - bw * 0.4, member.y + member.height + bw * 0.43 + 10)
        : Math.max(board.y + bw * 0.4, member.y - bw * 0.43 - 10),
  };
  const oldPart = time < timing.newCueAt;
  const localTime = oldPart ? time : time - timing.newCueAt;
  const boardAlpha =
    progress(localTime, 0, 120) *
    (1 -
      progress(
        time,
        oldPart ? timing.newCueAt - 110 : timing.live - 170,
        oldPart ? timing.newCueAt : timing.live
      ));
  // Board emerges directly above Rina, gives a command, then answers the completed move.
  cornerMarks(ctx, member, oldPart ? pink : mint, (1 - progress(localTime, 120, 400)) * 0.7);
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.globalAlpha = boardAlpha * 0.55;
    ctx.fillStyle = oldPart ? pink : mint;
    ctx.fillRect(
      m.x - 1,
      layout.side === 'opponent' ? member.y + member.height + 1 + i * 4 : member.y - 3 - i * 4,
      2,
      2
    );
    ctx.restore();
  }
  const expression =
    time >= timing.newArriveAt + 220
      ? 'happy'
      : oldPart
        ? time < 140
          ? 'work'
          : 'switch'
        : 'connect';
  const sourceCenter = oldPart ? l : center(waiting);
  const side = sourceCenter.x < bpos.x ? -1 : 1;
  const source = {
    x: sourceCenter.x - side * (live.width * (oldPart ? 0.5 : 0.34) + 5),
    y: sourceCenter.y,
  };
  const origin = { x: bpos.x + side * bw * 0.49, y: bpos.y };
  const cueStart = oldPart ? timing.oldCueAt : timing.newCueAt + 100;
  const leaveAt = oldPart ? timing.oldLeaveAt : timing.newLeaveAt;
  boardRipple(
    ctx,
    origin,
    source,
    progress(time, cueStart, leaveAt),
    oldPart ? pink : mint,
    live.width
  );
  // Draw the physical board in front of the expanding wave's trailing dots.
  faceBoard(ctx, bpos, bw, expression, 1, boardAlpha, (time - timing.newCueAt) / 130);

  if (time < timing.oldLeaveAt) {
    const pickup = smooth(progress(time, timing.oldLeaveAt - 100, timing.oldLeaveAt));
    card(
      ctx,
      images.oldLive,
      { x: l.x, y: l.y - pickup * 5 },
      live.width,
      live.height,
      pickup * 0.3
    );
    cornerMarks(ctx, live, pink, progress(time, timing.oldLeaveAt - 120, timing.oldLeaveAt));
  } else if (time < timing.oldArriveAt) {
    const scale = Math.min(deck.height / live.width, deck.width / live.height);
    flyWholeLive(
      ctx,
      images.oldLive,
      { x: l.x, y: l.y - 5 },
      center(deck),
      live.width,
      live.height,
      scale,
      progress(time, timing.oldLeaveAt, timing.oldArriveAt),
      Math.min(board.width < 600 ? 40 : 120, board.height * 0.14),
      Math.PI / 2,
      pink
    );
  }
  if (time >= timing.oldArriveAt && oldPart)
    cornerMarks(ctx, deck, pink, 1 - progress(time, timing.oldArriveAt, timing.newCueAt));

  if (time >= timing.newCueAt && time < timing.newLeaveAt) {
    const pickup = smooth(progress(time, timing.newLeaveAt - 120, timing.newLeaveAt));
    const source = center(waiting);
    card(
      ctx,
      images.newLive,
      { x: source.x, y: source.y - pickup * 5 },
      live.width * 0.68,
      live.height * 0.68,
      pickup * 0.3,
      0,
      progress(time, timing.newCueAt, timing.newCueAt + 90)
    );
    cornerMarks(
      ctx,
      {
        x: source.x - live.width * 0.34,
        y: source.y - live.height * 0.34,
        width: live.width * 0.68,
        height: live.height * 0.68,
      },
      mint,
      progress(time, timing.newLeaveAt - 120, timing.newLeaveAt)
    );
  }
  if (time >= timing.newLeaveAt && time < timing.newArriveAt) {
    const source = center(waiting);
    flyWholeLive(
      ctx,
      images.newLive,
      { x: source.x, y: source.y - 5 },
      l,
      live.width * 0.68,
      live.height * 0.68,
      1 / 0.68,
      progress(time, timing.newLeaveAt, timing.newArriveAt),
      Math.min(board.width < 600 ? 82 : 120, board.height * 0.14),
      0,
      mint
    );
  }
  if (frame.newLiveVisible) {
    card(ctx, images.newLive, l, live.width, live.height);
    const landed = progress(time, timing.newArriveAt, timing.newArriveAt + 280);
    cornerMarks(ctx, live, mint, 1 - landed);
    const acknowledgement = progress(time, timing.newArriveAt, timing.newArriveAt + 220);
    syncBorder(ctx, live, acknowledgement);
    syncBorder(
      ctx,
      { x: bpos.x - bw / 2, y: bpos.y - bw * 0.33, width: bw, height: bw * 0.66 },
      acknowledgement
    );
  }
}
