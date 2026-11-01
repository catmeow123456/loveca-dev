import { useId, useLayoutEffect, useRef } from 'react';
import type { BattleAnimationEvent, BattleAnimationRect } from '@/lib/battleAnimationEvents';
import { CARE_MOVE_MS } from '@/lib/careMovementPresentation';
import { CareCardTrim } from './CareDecor';

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  const p = clamp(x);
  return p * p * (3 - 2 * p);
};
const mix = (a: number, b: number, p: number) => a + (b - a) * p;
function pose(rect: BattleAnimationRect, exactSize = false) {
  const width = Math.max(
    18,
    Math.min(exactSize ? Infinity : 132, rect.width, (rect.height * 5) / 7)
  );
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width,
    height: (width * 7) / 5,
    rotation: rect.rotation ?? 0,
  };
}
/** An even-odd hole keeps the real receiving member in front throughout the flight. */
function receiverClip(rect: BattleAnimationRect): string {
  const l = rect.left,
    t = rect.top,
    r = l + rect.width,
    b = t + rect.height;
  const radius = Math.min(8, rect.width * 0.05);
  return (
    `M-200 -200H${window.innerWidth + 200}V${window.innerHeight + 200}H-200Z ` +
    `M${l + radius} ${t}H${r - radius}Q${r} ${t} ${r} ${t + radius}V${b - radius}` +
    `Q${r} ${b} ${r - radius} ${b}H${l + radius}Q${l} ${b} ${l} ${b - radius}V${t + radius}Q${l} ${t} ${l + radius} ${t}Z`
  );
}
const cubic = (a: number, b: number, c: number, d: number, t: number) =>
  (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t * t * c + t ** 3 * d;

/** Physical card and decoration share a single frame, source pose, destination and finish. */
export function CareCardFlight({
  event,
  imagePath,
  onDone,
  holdAt,
  timeScale = 1,
}: {
  event: Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }>;
  imagePath: string;
  onDone: () => void;
  holdAt?: number;
  timeScale?: number;
}) {
  const clipId = `care-receiver-${useId().replace(/:/g, '')}`;
  const clip = useRef<SVGPathElement>(null);
  const receiver = event.careMovement?.receiver;
  const ref = useRef<HTMLDivElement>(null),
    finish = useRef(onDone);
  finish.current = onDone;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const kind = event.careMovement!.kind;
    const from = pose(event.fromRect, kind === 'AYUMU_GIVE'),
      to = pose(event.toRect, kind === 'AYUMU_GIVE');
    const receiverElement = receiver
      ? document.querySelector<HTMLElement>(`[data-object-id="${CSS.escape(receiver.objectId)}"]`)
      : null;
    const duration = CARE_MOVE_MS[kind],
      start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const elapsed = holdAt ?? (now - start) * timeScale,
        p = clamp(elapsed / duration),
        t = smooth(p);
      if (holdAt === undefined && elapsed >= duration) {
        finish.current();
        return;
      }
      const height = mix(from.height, to.height, t),
        width = (height * 5) / 7;
      const tuck = kind === 'AYUMU_GIVE' && !!receiver;
      // Approach from the lower-left, then slide into the real offset energy footprint.
      // Occlusion begins on contact, never by switching z-index at the final frame.
      const x = tuck
        ? cubic(from.x, mix(from.x, to.x, 0.4), to.x - to.width * 0.65, to.x, t)
        : mix(from.x, to.x, t);
      const y = tuck
        ? cubic(from.y, from.y - 12, to.y + to.height * 0.4, to.y, t)
        : mix(from.y, to.y, t) -
          Math.sin(t * Math.PI) * Math.min(46, Math.abs(to.x - from.x) * 0.15 + 16);
      if (receiver && clip.current) {
        if (receiverElement && !receiverElement.isConnected) {
          finish.current();
          return;
        }
        const mask = receiverClip(receiverElement?.getBoundingClientRect() ?? receiver.rect);
        if (clip.current.getAttribute('d') !== mask) clip.current.setAttribute('d', mask);
      }
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      el.style.left = `${x - width / 2}px`;
      el.style.top = `${y - height / 2}px`;
      el.style.opacity = String(kind === 'AYUMU_RETURN' ? 1 - 0.55 * smooth((p - 0.8) / 0.2) : 1);
      el.style.transform = `rotate(${mix(from.rotation, to.rotation, t)}deg)`;
      el.style.setProperty(
        '--care-trim-opacity',
        String(smooth(p / 0.1) * (1 - smooth((p - 0.78) / 0.22)))
      );
      el.style.setProperty('--care-wing-angle', `${Math.sin(p * Math.PI * 5) * 10}deg`);
      el.style.setProperty('--care-bell-angle', `${Math.sin(p * Math.PI * 7) * 9 * (1 - p)}deg`);
      el.style.setProperty('--care-wrap-open', `${kind === 'AYUMU_RETURN' ? smooth(p) * 15 : 0}px`);
      el.style.setProperty(
        '--care-wrap-opacity',
        String(kind === 'AYUMU_RETURN' ? 1 - smooth((p - 0.2) / 0.65) : 1)
      );
      frame = requestAnimationFrame(draw);
    };
    draw(start);
    return () => cancelAnimationFrame(frame);
  }, [event, holdAt, timeScale, receiver]);
  return (
    <>
      {receiver && (
        <svg width="0" height="0" className="absolute" aria-hidden="true">
          <defs>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <path ref={clip} clipRule="evenodd" />
            </clipPath>
          </defs>
        </svg>
      )}
      <div
        className="care-flight-occlusion"
        data-care-receiver={receiver?.objectId}
        style={receiver ? { clipPath: `url(#${clipId})` } : undefined}
      >
        <div
          ref={ref}
          className="care-flight-card"
          data-care-flight={event.careMovement!.kind}
          data-battle-card-move={event.render.objectId}
          aria-hidden="true"
        >
          <div className="care-flight-face">
            <img src={imagePath} alt="" draggable={false} />
          </div>
          <CareCardTrim kind={event.careMovement!.kind} />
        </div>
      </div>
    </>
  );
}
