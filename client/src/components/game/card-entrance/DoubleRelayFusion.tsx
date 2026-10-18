import { useLayoutEffect, useId, useRef } from 'react';
import { OrientationState } from '@game/shared/types/enums';
import { getBattleStageAnchor } from '@/lib/battleUiAnchors';
import {
  doubleRelayFrame,
  relayBeamPoint,
  type DoubleRelaySource,
} from '@/lib/doubleRelayEntrance';

/** Public stage cards dissolve into two light trails, form one card, then hand off to the portrait. */
export function DoubleRelayFusion({
  sources,
  cardPath,
  startedAt,
  onInvalid,
}: {
  sources: readonly DoubleRelaySource[];
  cardPath: string;
  startedAt: number | null;
  onInvalid: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const invalid = useRef(onInvalid);
  invalid.current = onInvalid;
  const id = useId().replace(/:/g, '');
  useLayoutEffect(() => {
    const layer = root.current;
    const board = document.querySelector<HTMLElement>('[data-battle-ui-anchor="battle-board"]');
    if (!layer || !board) return;
    const bounds = board.getBoundingClientRect();
    const end = { x: bounds.left + bounds.width * 0.5, y: bounds.top + bounds.height * 0.42 };
    const actors = sources.map((source, index) => {
      const anchor = getBattleStageAnchor(
        source.side,
        source.slot.toLowerCase() as 'left' | 'center' | 'right'
      );
      const slot = document.querySelector<HTMLElement>(`[data-battle-ui-anchor="${anchor}"]`);
      const rect = slot?.firstElementChild?.getBoundingClientRect();
      const element = layer.querySelector<HTMLElement>(`[data-relay-source="${index}"]`);
      const glow = element?.querySelector<HTMLElement>('.double-relay-source-glow');
      const card = element?.querySelector<HTMLElement>('.double-relay-source-face');
      const paths = layer.querySelectorAll<SVGPathElement>(`[data-relay-beam="${index}"]`);
      const head = layer.querySelector<SVGCircleElement>(`[data-relay-head="${index}"]`);
      if (!rect?.width || !rect.height || !element || !card || !glow || !head) return null;
      const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      Object.assign(element.style, {
        left: `${start.x}px`,
        top: `${start.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      return {
        start,
        width: rect.width,
        element,
        card,
        glow,
        paths,
        head,
        rotation: source.orientation === OrientationState.WAITING ? 90 : 0,
      };
    });
    if (actors.some((actor) => !actor)) {
      invalid.current();
      return;
    }
    const core = layer.querySelector<HTMLElement>('.double-relay-core')!;
    const formed = layer.querySelector<HTMLImageElement>('.double-relay-formed')!;
    const width = Math.min(200, actors[0]!.width * 1.65, bounds.width * 0.31);
    for (const element of [core, formed])
      Object.assign(element.style, { left: `${end.x}px`, top: `${end.y}px` });
    formed.style.width = `${width}px`;
    core.style.width = core.style.height = `${width * 2.4}px`;
    let frame = 0,
      disposed = false;
    const abort = () => invalid.current();
    window.addEventListener('resize', abort);
    window.addEventListener('scroll', abort, true);
    const tick = (now: number) => {
      if (disposed) return;
      const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt);
      const f = doubleRelayFrame(elapsed);
      layer.dataset.phase = f.phase;
      layer.style.opacity = f.finished ? '0' : '1';
      actors.forEach((actor, index) => {
        if (!actor) return;
        const sign = actor.start.x <= actors[1 - index]!.start.x ? -1 : 1;
        actor.element.style.opacity = String(1 - f.travel);
        actor.card.style.opacity = String(1 - f.dissolve);
        actor.card.style.filter = `brightness(${1 + f.charge * 0.6 + f.dissolve * 1.8}) saturate(${1 - f.dissolve * 0.65})`;
        actor.card.style.transform = `translateY(${-f.dissolve * 22}px) rotate(${actor.rotation}deg) scale(${1 + f.charge * 0.045 - f.dissolve * 0.6},${1 + f.charge * 0.045 - f.dissolve * 0.15})`;
        actor.glow.style.opacity = String(f.charge * (1 - f.travel));
        actor.glow.style.transform = `translateY(${-f.dissolve * 22}px) scale(${0.85 + f.charge * 0.25 - f.dissolve * 0.6},${0.85 + f.charge * 0.25})`;
        const released = { x: actor.start.x, y: actor.start.y - 22 };
        // The moving tail shortens continuously into the common convergence point.
        const length = 0.27 * (1 - f.merge);
        const points = Array.from({ length: 20 }, (_, i) =>
          relayBeamPoint(released, end, sign, Math.max(0, f.travel - length * (1 - i / 19)))
        );
        const d = points
          .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
          .join(' ');
        const beamOpacity = f.dissolve * (1 - f.merge);
        actor.paths.forEach((path) => {
          path.setAttribute('d', d);
          path.style.opacity = String(beamOpacity);
        });
        const tip = points[19]!;
        actor.head.setAttribute('cx', String(tip.x));
        actor.head.setAttribute('cy', String(tip.y));
        actor.head.setAttribute('r', String(3 + 4 * f.dissolve));
        actor.head.style.opacity = String(beamOpacity);
      });
      const convergence = Math.max(0, (f.travel - 0.82) / 0.18);
      core.style.opacity = String(Math.max(convergence * 0.45, f.merge) * f.fade);
      core.style.transform = `translate(-50%,-50%) scale(${0.16 + f.merge * 0.84}) rotate(${f.merge * 35}deg)`;
      formed.style.opacity = String(f.form * f.fade);
      formed.style.transform = `translate(-50%,-50%) perspective(700px) rotateY(${(1 - f.form) * 45}deg) scale(${0.65 + f.form * 0.35})`;
      formed.style.filter = `brightness(${1 + (1 - f.form) * 2}) drop-shadow(0 0 18px rgba(180,245,255,.65))`;
      if (!f.finished) frame = requestAnimationFrame(tick);
    };
    tick(performance.now());
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', abort);
      window.removeEventListener('scroll', abort, true);
    };
  }, [sources, startedAt]);
  return (
    <div
      ref={root}
      className="double-relay-fusion"
      data-testid="double-relay-fusion"
      aria-hidden="true"
    >
      <svg className="double-relay-beams" width="100%" height="100%">
        <defs>
          <filter id={`${id}-blur`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        {sources.map((source, i) => (
          <g key={source.objectId}>
            <path
              data-relay-beam={i}
              fill="none"
              stroke={i ? '#ffc4eb' : '#a9f7ff'}
              strokeWidth="24"
              strokeLinecap="round"
              filter={`url(#${id}-blur)`}
              opacity="0"
            />
            <path
              data-relay-beam={i}
              fill="none"
              stroke={i ? '#ffb9e7' : '#8deeff'}
              strokeWidth="7"
              strokeLinecap="round"
              opacity="0"
            />
            <path
              data-relay-beam={i}
              fill="none"
              stroke="#fff8eb"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0"
            />
            <circle data-relay-head={i} fill="#fffcec" opacity="0" />
          </g>
        ))}
      </svg>
      {sources.map((source, i) => (
        <div
          className="double-relay-source"
          data-relay-source={i}
          data-orientation={source.orientation}
          key={source.objectId}
        >
          <div className={`double-relay-source-glow double-relay-source-glow--${i}`} />
          <img
            className="double-relay-source-face"
            src={source.imagePath}
            alt=""
            draggable={false}
          />
        </div>
      ))}
      <div className="double-relay-core" />
      <img className="double-relay-formed" src={cardPath} alt="" draggable={false} />
    </div>
  );
}
