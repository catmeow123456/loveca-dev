import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store/gameStore';
import {
  collectBattleAnimationAnchors,
  type BattleAnimationRect,
} from '@/lib/battleAnimationEvents';
import { NICO_EVIDENCE_MS, type NicoEvidencePresentation } from '@/lib/nicoEvidence';

// Stretch the authored timeline uniformly, including fades and reduced-motion feedback.
const TIMELINE_MS = 1160;
const TIME_STRETCH = NICO_EVIDENCE_MS / TIMELINE_MS;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const p = clamp(n);
  return p * p * (3 - 2 * p);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
type Point = { x: number; y: number };
type Ctx = CanvasRenderingContext2D;

/** Shared by the real board and the replay/slow/hold preview. No authority or acknowledgement. */
export function NicoEvidencePlayback({
  cue,
  from,
  reduced,
  holdAt,
  timeScale = 1,
  onDone,
}: {
  cue: NicoEvidencePresentation;
  from?: BattleAnimationRect;
  reduced: boolean;
  holdAt?: number;
  timeScale?: number;
  onDone: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const finish = useRef(onDone);
  finish.current = onDone;
  const imageFor = useGameStore((s) => s.getCardImagePath);
  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) {
      finish.current();
      return;
    }
    const photo = new Image();
    photo.decoding = 'async';
    photo.src = imageFor(cue.cardCode);
    let frame = 0;
    const start = performance.now();
    const draw = (now: number) => {
      const elapsed = holdAt ?? (now - start) * timeScale;
      const host = collectBattleAnimationAnchors().cards.get(cue.hostId);
      if (
        !host ||
        (holdAt === undefined && elapsed >= (reduced ? 700 * TIME_STRETCH : NICO_EVIDENCE_MS))
      ) {
        finish.current();
        return;
      }
      const width = innerWidth,
        height = innerHeight,
        dpr = Math.min(devicePixelRatio || 1, 2);
      if (
        element.width !== Math.round(width * dpr) ||
        element.height !== Math.round(height * dpr)
      ) {
        element.width = Math.round(width * dpr);
        element.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawEvidence(ctx, {
        elapsed: elapsed / TIME_STRETCH,
        host,
        from,
        width,
        height,
        photo,
        cue,
        reduced,
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      photo.removeAttribute('src');
    };
  }, [cue, from, reduced, holdAt, timeScale, imageFor]);
  return (
    <canvas
      ref={canvas}
      data-nico-evidence={cue.hostId}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 97,
      }}
    />
  );
}

function drawEvidence(
  ctx: Ctx,
  {
    elapsed: t,
    host,
    from,
    width,
    height,
    photo,
    cue,
    reduced,
  }: {
    elapsed: number;
    host: BattleAnimationRect;
    from?: BattleAnimationRect;
    width: number;
    height: number;
    photo: HTMLImageElement;
    cue: NicoEvidencePresentation;
    reduced: boolean;
  }
) {
  const hc = { x: host.left + host.width / 2, y: host.top + host.height / 2 };
  // Keep the paper legible and close to its recipient on either seat, including a narrow table.
  const unit = Math.max(0.66, Math.min(1, host.width / 115, width / 460));
  const focus = {
    x: Math.max(64 * unit, Math.min(width - 85 * unit, hc.x + 28 * unit)),
    y: Math.max(88 * unit, Math.min(height - 110 * unit, host.top - 54 * unit)),
  };
  if (reduced) {
    const alpha = Math.min(1, t / 80, (700 - t) / 150);
    drawReceipt(ctx, host, cue.newCostKind, alpha, 1);
    return;
  }
  const arrival = smooth(t / 240),
    filing = smooth((t - 630) / 270);
  const origin = from ? { x: from.left + from.width / 2, y: from.top + from.height / 2 } : hc;
  const point = {
    x: lerp(lerp(origin.x, focus.x, arrival), hc.x, filing),
    y: lerp(
      lerp(origin.y, focus.y, arrival) - Math.sin(arrival * Math.PI) * 24 * unit,
      hc.y + host.height * 0.18,
      filing
    ),
  };
  const scale = unit * lerp(0.72 + 0.28 * arrival, 0.3, filing);
  const rotation = lerp(-0.12 * arrival, 0.025, filing);
  const paperAlpha = clamp(t / 80) * (1 - smooth((t - 810) / 110));
  const paper = () => drawClueCard(ctx, photo, cue.cardName, point, scale, rotation, filing);
  if (paperAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = paperAlpha;
    paper();
    ctx.restore();
  }

  const scan = smooth((t - 240) / 320);
  const lensAlpha = clamp((t - 150) / 100) * (1 - smooth((t - 590) / 140));
  if (lensAlpha > 0) {
    const lens = {
      x: focus.x + lerp(-25, 28, scan) * unit,
      y: focus.y + lerp(5, -46, scan) * unit - Math.sin(scan * Math.PI) * 12 * unit,
    };
    ctx.save();
    ctx.globalAlpha = lensAlpha;
    drawLens(ctx, lens, unit, paper, cue.newCostKind ? smooth((t - 490) / 100) : 0);
    ctx.restore();
  }
  // A curved red folder tie closes around the collected card; it is decoration, not a rule marker.
  if (t > 610 && t < 930) {
    ctx.save();
    ctx.globalAlpha = paperAlpha * smooth((t - 610) / 80);
    ctx.translate(point.x, point.y);
    ctx.rotate(rotation);
    ctx.scale(scale, scale);
    ctx.strokeStyle = '#b85260';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-51, 20);
    ctx.bezierCurveTo(-12, 25 - 16 * filing, 15, 24 - 16 * filing, 51, 20);
    ctx.stroke();
    ctx.restore();
  }
  if (t > 790) {
    const reveal = smooth((t - 790) / 130);
    drawReceipt(ctx, host, cue.newCostKind, reveal * clamp((TIMELINE_MS - t) / 160), reveal);
  }
}

function rounded(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawClueCard(
  ctx: Ctx,
  photo: HTMLImageElement,
  name: string,
  p: Point,
  scale: number,
  angle: number,
  filing: number
) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.shadowColor = '#29161077';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetY = 6;
  const paper = ctx.createLinearGradient(-55, -80, 50, 84);
  paper.addColorStop(0, '#fff7e7');
  paper.addColorStop(0.5, '#f0dfbd');
  paper.addColorStop(1, '#caa77c');
  ctx.fillStyle = paper;
  rounded(ctx, -55, -79, 110, 159, 5);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#b88e64';
  rounded(ctx, -49, -84, 43, 12, 3);
  ctx.fill();
  ctx.strokeStyle = '#a0784d88';
  ctx.lineWidth = 0.7;
  rounded(ctx, -51, -75, 102, 151, 3);
  ctx.stroke();
  ctx.save();
  rounded(ctx, -45, -68, 90, 126, 4);
  ctx.clip();
  ctx.fillStyle = '#ddc7a8';
  ctx.fillRect(-45, -68, 90, 126);
  if (photo.complete && photo.naturalWidth) ctx.drawImage(photo, -45, -68, 90, 126);
  else {
    // Slow/failed images must never block play or become a late replay. Public name only.
    ctx.fillStyle = '#785b45';
    ctx.textAlign = 'center';
    ctx.font = '10px sans-serif';
    ctx.fillText([...name].slice(0, 8).join(''), 0, -8, 82);
    ctx.fillText([...name].slice(8, 16).join(''), 0, 8, 82);
  }
  ctx.restore();
  // Open sleeve folds over the photograph as the card is tucked under the stage member.
  if (filing > 0) {
    const top = lerp(80, -73, filing);
    const fold = ctx.createLinearGradient(0, top, 0, 80);
    fold.addColorStop(0, '#f9ead0');
    fold.addColorStop(0.18, '#e2c699');
    fold.addColorStop(1, '#bd9469');
    ctx.fillStyle = fold;
    rounded(ctx, -53, top, 106, Math.max(0.1, 80 - top), 3);
    ctx.fill();
    ctx.strokeStyle = '#ac865b';
    ctx.beginPath();
    ctx.moveTo(-52, top + 2);
    ctx.lineTo(52, top + 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLens(ctx: Ctx, p: Point, unit: number, paper: () => void, discovery: number) {
  const radius = 31 * unit;
  ctx.save();
  // Refract the actual public card through the glass; a transparent circle alone looks flat.
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius - 3 * unit, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(p.x, p.y);
  ctx.scale(1.3, 1.3);
  ctx.translate(-p.x, -p.y);
  paper();
  ctx.restore();
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(unit, unit);
  ctx.rotate(-0.42);
  ctx.shadowColor = '#201d2466';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 3;
  const grip = ctx.createLinearGradient(-5, 28, 6, 28);
  grip.addColorStop(0, '#332923');
  grip.addColorStop(0.35, '#9a7352');
  grip.addColorStop(0.52, '#c6a17a');
  grip.addColorStop(1, '#3d2c24');
  ctx.fillStyle = grip;
  rounded(ctx, -5, 28, 10, 45, 4);
  ctx.fill();
  ctx.fillStyle = '#d3bd8c';
  ctx.fillRect(-5, 31, 10, 5);
  ctx.fillRect(-5, 64, 10, 2);
  const rim = ctx.createLinearGradient(-28, -30, 27, 32);
  rim.addColorStop(0, '#fff7dc');
  rim.addColorStop(0.24, '#bdb8a6');
  rim.addColorStop(0.48, '#f4f4e9');
  rim.addColorStop(0.65, '#676c6b');
  rim.addColorStop(1, '#e5cba1');
  ctx.strokeStyle = rim;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, 31, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  const glass = ctx.createLinearGradient(-26, -27, 30, 30);
  glass.addColorStop(0, '#d6eeec77');
  glass.addColorStop(0.47, '#fffdf716');
  glass.addColorStop(0.5, '#ffffff70');
  glass.addColorStop(0.57, '#ffffff08');
  glass.addColorStop(1, '#bddeee44');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.arc(0, 0, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffffcc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 25, 3.5, 4.6);
  ctx.stroke();
  if (discovery > 0) {
    ctx.globalAlpha *= discovery;
    ctx.strokeStyle = '#e5a2b6';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, 35, -0.8, -0.8 + 5.4 * discovery);
    ctx.stroke();
    ctx.fillStyle = '#fff2dc';
    ctx.beginPath();
    ctx.moveTo(27, -32);
    ctx.lineTo(29, -38);
    ctx.lineTo(31, -32);
    ctx.lineTo(37, -30);
    ctx.lineTo(31, -28);
    ctx.lineTo(29, -22);
    ctx.lineTo(27, -28);
    ctx.lineTo(21, -30);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawReceipt(
  ctx: Ctx,
  host: BattleAnimationRect,
  isNew: boolean,
  alpha: number,
  reveal: number
) {
  const x = Math.max(53, Math.min(innerWidth - 53, host.left + host.width * 0.7));
  const y = Math.max(30, host.top + 15);
  ctx.save();
  ctx.globalAlpha = clamp(alpha);
  ctx.translate(x, y);
  const scale = 0.84 + 0.16 * reveal;
  ctx.scale(scale, scale);
  if (isNew) {
    const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 46);
    glow.addColorStop(0, '#e7b2bc70');
    glow.addColorStop(1, '#e7b2bc00');
    ctx.fillStyle = glow;
    ctx.fillRect(-46, -46, 92, 92);
  }
  // Nico's crisp double ribbon, distinct from Ginko's flower knot.
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);
    const satin = ctx.createLinearGradient(4, -13, 26, 8);
    satin.addColorStop(0, '#efb1a6');
    satin.addColorStop(0.37, '#c15b61');
    satin.addColorStop(0.7, '#a63c4b');
    satin.addColorStop(1, '#dc8c85');
    ctx.fillStyle = satin;
    ctx.strokeStyle = '#f0b3a080';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.bezierCurveTo(11, -12, 19, -16, 24, -13);
    ctx.lineTo(27, 8);
    ctx.bezierCurveTo(18, 13, 8, 6, 2, 0);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#bb5961';
    ctx.beginPath();
    ctx.moveTo(4, 2);
    ctx.lineTo(15, 6);
    ctx.lineTo(19, 20);
    ctx.lineTo(12, 17);
    ctx.lineTo(8, 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f5bdb070';
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.quadraticCurveTo(16, -1, 23, -9);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#c87977';
  rounded(ctx, -5, -5, 10, 11, 3);
  ctx.fill();
  ctx.fillStyle = '#f3bfb0';
  ctx.fillRect(-3, -3, 1, 6);
  ctx.restore();
}
