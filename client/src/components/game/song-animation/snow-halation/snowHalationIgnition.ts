export interface SnowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export const snowClamp = (n: number) => Math.max(0, Math.min(1, n));
export const snowEase = (n: number) => {
  const p = snowClamp(n);
  return p * p * (3 - 2 * p);
};

/** The existing cheer clock owns this source light, the standard glyph, and its departure. */
export function drawSnowHeartIgnition(
  ctx: CanvasRenderingContext2D,
  card: SnowRect,
  elapsedMs: number
) {
  if (elapsedMs < 0 || elapsedMs >= 580) return;
  const light = snowEase(elapsedMs / 55) * (1 - snowEase((elapsedMs - 340) / 240));
  const forming = snowEase(elapsedMs / 55) * (1 - snowEase((elapsedMs - 130) / 120));
  const x = card.x + card.width / 2,
    y = card.y + card.height * 0.48;
  ctx.save();
  // A legible, persistent orange rim wraps the source rather than a tiny corner sparkle.
  ctx.beginPath();
  ctx.roundRect(card.x + 1.5, card.y + 1.5, card.width - 3, card.height - 3, 4);
  ctx.strokeStyle = `rgba(255,133,23,${light * 0.72})`;
  ctx.lineWidth = 5;
  ctx.shadowColor = '#ff9226';
  ctx.shadowBlur = 15;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = `rgba(255,173,54,${light})`;
  ctx.lineWidth = 2.3;
  ctx.stroke();
  ctx.strokeStyle = `rgba(255,230,158,${light * 0.86})`;
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.clip();
  // Keep the standard orange glyph readable over busy card art.
  ctx.fillStyle = `rgba(36,15,5,${forming * 0.24})`;
  ctx.fillRect(card.x, card.y, card.width, card.height);
  ctx.globalCompositeOperation = 'screen';
  const wash = ctx.createRadialGradient(x, y, 2, x, y, card.height * 0.75);
  wash.addColorStop(0, `rgba(255,173,54,${light * 0.27})`);
  wash.addColorStop(0.55, `rgba(255,130,18,${light * 0.14})`);
  wash.addColorStop(1, 'rgba(255,130,18,0)');
  ctx.fillStyle = wash;
  ctx.fillRect(card.x, card.y, card.width, card.height);
  // Four short light folds gather from the card edges into the emerging heart.
  const converge = snowEase(elapsedMs / 210);
  for (const [dx, dy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const sx = x + dx * card.width * 0.42,
      sy = y + dy * card.height * 0.4;
    const endX = x + dx * (1 - converge) * 10;
    const endY = y + dy * (1 - converge) * 10;
    const beam = ctx.createLinearGradient(sx, sy, x, y);
    beam.addColorStop(0, `rgba(255,150,30,${forming * 0.16})`);
    beam.addColorStop(0.55, `rgba(255,194,98,${forming * 0.7})`);
    beam.addColorStop(1, `rgba(255,243,201,${forming})`);
    ctx.strokeStyle = beam;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(x + dx * card.width * 0.13, sy, endX, endY);
    ctx.stroke();
  }
  const radius = 10 + snowEase(elapsedMs / 180) * 25;
  const core = ctx.createRadialGradient(x, y, 1, x, y, radius);
  core.addColorStop(0, `rgba(255,242,200,${forming * 0.9})`);
  core.addColorStop(0.3, `rgba(255,167,53,${forming * 0.8})`);
  core.addColorStop(1, 'rgba(255,136,22,0)');
  ctx.fillStyle = core;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}
