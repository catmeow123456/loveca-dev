import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { entranceTimeline } from '@/lib/cardEntranceTimeline';
import {
  getShizukuStackElement,
  getShizukuStackFrame,
  roleProgress as p,
  type ShizukuRole,
} from '@/lib/shizukuRole';
import { HEART_ICON_SOURCE_BY_COLOR } from '@/lib/modifierIconAssets';
import { ShizukuRoleBookmark } from '@/components/card/ShizukuRoleMarker';
import type { BattleAnimationRect } from '@/lib/battleAnimationEvents';
import { getLandingCardGeometry } from '@/lib/cardEntranceLanding';
import './shizukuTheatre.css';

type Point = { x: number; y: number };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** A tapered cone with a soft cross-section, rather than a flat triangular fill. */
function TheatreBeam({
  from,
  to,
  width,
  opacity = 1,
}: {
  from: Point;
  to: Point;
  width: number;
  opacity?: number;
}) {
  const id = useId().replaceAll(':', '');
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI - 90;
  return (
    <g opacity={opacity} transform={`translate(${from.x} ${from.y}) rotate(${angle})`}>
      <defs>
        <filter id={`${id}-soft`} x="-30%" y="-5%" width="160%" height="110%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        <linearGradient id={`${id}-length`} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#e8f6ff" stopOpacity=".03" />
          <stop offset=".24" stopColor="#d1e9fa" stopOpacity=".1" />
          <stop offset=".82" stopColor="#d7efff" stopOpacity=".23" />
          <stop offset="1" stopColor="#d7efff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-edge`}>
          <stop stopColor="white" stopOpacity="0" />
          <stop offset=".2" stopColor="white" stopOpacity=".18" />
          <stop offset=".5" stopColor="white" />
          <stop offset=".8" stopColor="white" stopOpacity=".18" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask
          id={`${id}-mask`}
          maskUnits="userSpaceOnUse"
          x={-width / 2}
          y="0"
          width={width}
          height={length}
        >
          <rect x={-width / 2} width={width} height={length} fill={`url(#${id}-edge)`} />
        </mask>
      </defs>
      <path
        d={`M-1 0H1L${width / 2} ${length}H${-width / 2}Z`}
        fill={`url(#${id}-length)`}
        mask={`url(#${id}-mask)`}
        filter={`url(#${id}-soft)`}
      />
    </g>
  );
}

/** Export the same frame for the independent review controls. */
export function ShizukuEntranceLightScene({ elapsed: t }: { elapsed: number }) {
  const id = useId().replaceAll(':', '');
  const left = p(t, 0, 510),
    right = p(t, 140, 510);
  const alpha = p(t, 0, 180) * (1 - p(t, 1500, 450));
  return (
    <div className="shizuku-entrance-light" aria-hidden="true" style={{ opacity: alpha }}>
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
        <defs>
          <radialGradient id={`${id}-pool`}>
            <stop stopColor="#e5f3ff" stopOpacity=".2" />
            <stop offset=".45" stopColor="#bddef6" stopOpacity=".09" />
            <stop offset="1" stopColor="#bddef6" stopOpacity="0" />
          </radialGradient>
        </defs>
        <TheatreBeam
          from={{ x: 160, y: -80 }}
          to={{ x: mix(230, 485, left), y: 810 }}
          width={174}
        />
        <TheatreBeam
          from={{ x: 840, y: -80 }}
          to={{ x: mix(770, 515, right), y: 810 }}
          width={174}
          opacity={p(t, 140, 180) * 0.8}
        />
        <ellipse
          cx="500"
          cy="800"
          rx="165"
          ry="38"
          fill={`url(#${id}-pool)`}
          opacity={p(t, 230, 400)}
        />
      </svg>
    </div>
  );
}

export function ShizukuEntranceLight({
  startedAt,
  reduced,
}: {
  startedAt: number;
  reduced: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const tick = (now: number) => {
      const time = now - startedAt;
      setElapsed(time);
      if (time < entranceTimeline.portraitEnd) frame = requestAnimationFrame(tick);
    };
    tick(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [startedAt, reduced]);
  return reduced ? null : <ShizukuEntranceLightScene elapsed={elapsed} />;
}

export interface ShizukuRoleLayout {
  member: BattleAnimationRect;
  waiting: BattleAnimationRect;
  board: BattleAnimationRect;
  stacked: BattleAnimationRect;
}

/** Only the public card's image travels; the successful rules result has already committed. */
export function ShizukuRoleScene({
  source,
  layout,
  elapsed: t,
  reduced,
}: {
  source: ShizukuRole;
  layout: ShizukuRoleLayout;
  elapsed: number;
  reduced: boolean;
}) {
  const uid = useId().replaceAll(':', '');
  const { member, waiting, board, stacked } = layout;
  const card = getLandingCardGeometry(member, source.target.orientation);
  const stack = getShizukuStackFrame(member, stacked, source.target.orientation, t);
  const underCard = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    if (reduced) return;
    const element = getShizukuStackElement(source.sourceObjectId);
    if (!element) return;
    // An owned presentation effect leaves the real DOM styles and pile z-order
    // intact. Cancelling (skip, resize, teardown) restores the committed card.
    const animation = element.animate([{ opacity: 0 }], { duration: 1, fill: 'both' });
    animation.pause();
    animation.currentTime = 1;
    underCard.current = animation;
    return () => {
      animation.cancel();
      underCard.current = null;
    };
  }, [source.sourceObjectId, reduced]);
  useLayoutEffect(() => {
    const effect = underCard.current?.effect;
    if (!(effect instanceof KeyframeEffect)) return;
    effect.setKeyframes([
      {
        opacity: stack.opacity,
        transform: `translate(${stack.x - stacked.left - stacked.width / 2}px, ${stack.y - stacked.top - stacked.height / 2}px) rotate(${stack.rotation}deg) scale(${stack.width / stacked.width}, ${stack.height / stacked.height})`,
      },
    ]);
  }, [
    stack.x,
    stack.y,
    stack.width,
    stack.height,
    stack.rotation,
    stack.opacity,
    stacked,
    source.sourceObjectId,
    reduced,
  ]);
  const w = Math.min(112, Math.max(58, card.width * 0.92)),
    h = w * 1.4;
  const clampX = (x: number) =>
    Math.max(board.left + w * 0.6, Math.min(board.left + board.width - w * 0.6, x));
  const clampY = (y: number) =>
    Math.max(board.top + h * 0.6, Math.min(board.top + board.height - h * 0.6, y));
  const from = { x: clampX(waiting.left + waiting.width / 2), y: clampY(waiting.top - h * 0.22) };
  const direction = from.x > card.x ? 1 : -1;
  const rise = p(t, 0, 300),
    travel = p(t, 340, 660),
    sweep = p(t, 1080, 410);
  const arc = Math.sin(travel * Math.PI);
  const image = {
    x: mix(from.x, stack.x, travel),
    y: mix(from.y, stack.y, travel) - arc * Math.min(90, card.height * 0.48),
  };
  const imageW = mix(w, stack.width, travel),
    imageH = mix(h, stack.height, travel);
  const imageRotation = mix(-7 * direction, stack.rotation, travel);
  const coneOrigin = { x: from.x - direction * 115, y: Math.max(board.top - 20, from.y - 290) };
  const lightFade = p(t, 0, 190) * (1 - p(t, 1490, 250));
  const hearts = source.hearts.flatMap((heart) =>
    Array.from({ length: heart.count }, () => heart.color)
  );
  const markerW = Math.min(34, Math.max(20, card.width * 0.3));
  const r = (card.rotation * Math.PI) / 180;
  const dx = card.width * 0.47 - markerW / 2,
    dy = card.height * 0.46 - markerW * 0.45;
  const bookmark = {
    x: card.x + dx * Math.cos(r) - dy * Math.sin(r),
    y: card.y + dx * Math.sin(r) + dy * Math.cos(r),
  };
  if (reduced)
    return (
      <div
        className="shizuku-role-static"
        role="status"
        style={{ left: clampX(card.x), top: member.top - 34 }}
      >
        <span>
          <ShizukuRoleBookmark />
        </span>
        本次 LIVE · HEART 已替换
      </div>
    );
  return (
    <div
      className="shizuku-role-scene"
      aria-hidden="true"
      data-shizuku-role-phase={
        t < 340 ? 'source' : t < 1000 ? 'projection' : t < 1490 ? 'overlap' : 'settle'
      }
    >
      <svg className="shizuku-role-spots" style={{ opacity: lightFade }}>
        <defs>
          <radialGradient id={`${uid}-pool`}>
            <stop stopColor="#d4edff" stopOpacity=".18" />
            <stop offset="1" stopColor="#bddff5" stopOpacity="0" />
          </radialGradient>
        </defs>
        <TheatreBeam
          from={coneOrigin}
          to={{ x: image.x, y: image.y + imageH * 0.42 }}
          width={imageW * 0.78}
        />
        <ellipse
          cx={image.x}
          cy={image.y + imageH * 0.35}
          rx={imageW * 0.7}
          ry={imageW * 0.23}
          fill={`url(#${uid}-pool)`}
        />
      </svg>
      <div
        className="shizuku-role-source-shadow"
        style={{
          left: from.x,
          top: from.y + h * 0.35,
          width: w,
          height: h * 0.18,
          opacity: p(t, 0, 140) * (1 - p(t, 350, 300)),
          transform: `translate(-50%,-50%) scale(${mix(0.8, 1.16, rise)})`,
        }}
      />
      <div
        className="shizuku-role-source"
        style={{
          left: from.x,
          top: from.y,
          width: w,
          height: h,
          opacity: p(t, 0, 140) * (1 - p(t, 340, 300)),
          transform: `translate(-50%,-50%) perspective(650px) rotateX(${mix(42, -7, rise)}deg) rotateY(${-12 * direction * rise}deg) rotateZ(${-7 * direction}deg) scale(${mix(0.84, 1, rise)})`,
        }}
      >
        <img src={source.imagePath} alt="" />
        <div
          className="shizuku-source-sheen"
          style={{ opacity: Math.sin(rise * Math.PI) * 0.55 }}
        />
      </div>
      <div
        className="shizuku-role-projection"
        style={{
          left: image.x,
          top: image.y,
          width: imageW,
          height: imageH,
          opacity: p(t, 270, 180) * mix(0.65, 0.5, p(t, 1000, 300)) * (1 - stack.opacity),
          transform: `translate(-50%,-50%) perspective(700px) rotateY(${direction * (arc * 27 - (1 - travel) * 12)}deg) rotateZ(${imageRotation}deg) scale(${1 + arc * 0.1})`,
        }}
      >
        <div
          className="shizuku-projection-image"
          style={{
            maskImage: `linear-gradient(90deg, #0005 ${sweep * 104 - 4}%, #000 ${sweep * 104}%)`,
          }}
        >
          <img src={source.imagePath} alt="" />
          <div className="shizuku-projection-light" />
        </div>
      </div>
      <div
        className="shizuku-role-receive"
        style={{
          left: card.x,
          top: card.y,
          width: card.width,
          height: card.height,
          opacity: p(t, 990, 200) * (1 - p(t, 1530, 230)),
          transform: `translate(-50%,-50%) rotate(${card.rotation}deg)`,
        }}
      >
        <div
          className="shizuku-role-scan"
          style={{ left: `${-30 + sweep * 160}%`, opacity: Math.sin(sweep * Math.PI) }}
        />
      </div>
      <div
        className="shizuku-role-hearts"
        style={{
          left: card.x,
          top: card.y,
          width: card.width,
          height: card.height,
          transform: `translate(-50%,-50%) rotate(${card.rotation}deg)`,
        }}
      >
        {hearts.map((color, i) => {
          const columns = Math.min(6, hearts.length),
            row = Math.floor(i / columns);
          const inRow = Math.min(columns, hearts.length - row * columns),
            size = Math.min(18, card.width * 0.14);
          const show = p(t, 1150 + i * 25, 110);
          return (
            <img
              key={i}
              className="shizuku-role-heart"
              src={HEART_ICON_SOURCE_BY_COLOR[color]}
              alt=""
              style={{
                left: card.width / 2 + ((i % columns) - (inRow - 1) / 2) * size * 1.1,
                top: card.height * 0.7 + row * size * 1.15,
                width: size,
                height: size,
                opacity: show * (1 - p(t, 1510 + i * 12, 180)),
                transform: `translate(-50%,-50%) scale(${mix(0.6, 1, show)})`,
              }}
            />
          );
        })}
      </div>
      <div
        className="shizuku-role-seal"
        style={{
          left: bookmark.x,
          top: bookmark.y,
          width: markerW,
          height: markerW * 0.9,
          opacity: p(t, 1530, 250),
          transform: `translate(-50%,-50%) rotate(${card.rotation}deg)`,
        }}
      >
        <ShizukuRoleBookmark />
      </div>
    </div>
  );
}
