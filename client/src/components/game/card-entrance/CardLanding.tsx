import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { collectBattleAnimationAnchors } from '@/lib/battleAnimationEvents';
import {
  CARD_ENTRANCE_FLIGHT_MS,
  CARD_ENTRANCE_TRAVEL_MS,
  CARD_ENTRANCE_LANDING_DELAY_MS,
  getLandingCardGeometry,
  type EntranceStageTarget,
} from '@/lib/cardEntranceLanding';

export interface LandingPresentation {
  id: string;
  target: EntranceStageTarget;
  imagePath: string;
}

export function CardLanding({
  presentation,
  onImpact,
  onDone,
}: {
  presentation: LandingPresentation;
  onImpact: () => void;
  onDone: () => void;
}) {
  const card = useRef<HTMLImageElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const impactLayer = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onImpact, onDone });
  callbacks.current = { onImpact, onDone };
  const [impact, setImpact] = useState<{
    x: number;
    y: number;
    size: number;
  } | null>(null);

  useEffect(() => {
    let disposed = false;
    let flight: Animation | undefined;
    let shockTimer: number | undefined;
    const secondaryAnimations: Animation[] = [];
    const abort = () => callbacks.current.onDone();
    // Never fly toward stale coordinates after a resize or scroll.
    window.addEventListener('resize', abort);
    window.addEventListener('scroll', abort, true);
    const timer = window.setTimeout(() => {
      const image = card.current;
      if (!image?.complete || !image.naturalWidth) return abort();
      const objectId = presentation.target.objectId;
      const element = document.querySelector<HTMLElement>(
        `[data-object-id="${CSS.escape(objectId)}"]`
      );
      const rect = collectBattleAnimationAnchors().cards.get(objectId);
      const board = document.querySelector<HTMLElement>('[data-battle-ui-anchor="battle-board"]');
      if (!rect || !element || !board || rect.width <= 0 || rect.height <= 0) return abort();
      const end = getLandingCardGeometry(rect, presentation.target.orientation);
      const bounds = board.getBoundingClientRect();
      // Travel from the portrait area to the slot, then descend in depth at a fixed centre.
      const startX = bounds.left + bounds.width * 0.5 - end.x;
      const startY = bounds.top + bounds.height * 0.42 - end.y;
      const edgeRoom = Math.min(
        end.x - bounds.left,
        bounds.right - end.x,
        end.y - bounds.top,
        bounds.bottom - end.y
      );
      const scale = Math.max(
        1,
        Math.min(1.65, (edgeRoom * 2 - 12) / Math.max(rect.width, rect.height))
      );
      Object.assign(image.style, {
        left: `${end.x}px`,
        top: `${end.y}px`,
        width: `${end.width}px`,
        height: `${end.height}px`,
      });
      const transform = (x: number, y: number, tilt: number, rotation: number, zoom: number) =>
        `translate(-50%, -50%) translate(${x}px, ${y}px) perspective(800px) rotateX(${tilt}deg) rotateY(${-tilt * 0.6}deg) rotateZ(${rotation}deg) scale(${zoom})`;
      if (shadow.current) {
        Object.assign(shadow.current.style, {
          left: `${end.x}px`,
          top: `${end.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        secondaryAnimations.push(
          shadow.current.animate(
            [
              {
                opacity: 0,
                filter: 'blur(12px)',
                transform: `translate(-50%, -50%) translate(${startX}px, ${startY}px) scale(1.25)`,
                easing: 'cubic-bezier(.35,0,.65,1)',
              },
              {
                opacity: 0.22,
                filter: 'blur(12px)',
                transform: 'translate(-50%, -50%) scale(1.25)',
                offset: CARD_ENTRANCE_TRAVEL_MS / CARD_ENTRANCE_FLIGHT_MS,
                easing: 'cubic-bezier(.8,0,1,.65)',
              },
              {
                opacity: 0.78,
                filter: 'blur(2px)',
                transform: 'translate(-50%, -50%) scale(1.02)',
              },
            ],
            { duration: CARD_ENTRANCE_FLIGHT_MS, fill: 'forwards' }
          )
        );
      }
      flight = image.animate(
        [
          {
            opacity: 0,
            transform: transform(startX, startY, 7, end.rotation - 6, scale),
            offset: 0,
          },
          {
            opacity: 1,
            transform: transform(startX * 0.94, startY * 0.94, 7, end.rotation - 6, scale),
            offset: 45 / CARD_ENTRANCE_FLIGHT_MS,
            easing: 'cubic-bezier(.35,0,.65,1)',
          },
          {
            opacity: 1,
            transform: transform(0, 0, 7, end.rotation - 2, scale),
            offset: CARD_ENTRANCE_TRAVEL_MS / CARD_ENTRANCE_FLIGHT_MS,
            easing: 'cubic-bezier(.8,0,1,.65)',
          },
          // At the slot, press toward the tabletop without screen-space falling or rebound.
          { opacity: 1, transform: transform(0, 0, 0, end.rotation, 1), offset: 1 },
        ],
        { duration: CARD_ENTRANCE_FLIGHT_MS, fill: 'forwards' }
      );
      flight.onfinish = () => {
        if (disposed) return;
        // Reveal the actual card at contact; the flight image never lingers over it.
        image.style.visibility = 'hidden';
        callbacks.current.onImpact();
        setImpact({
          x: end.x,
          y: end.y,
          size: Math.max(end.width, end.height),
        });
        if (shadow.current) {
          // The real card is below this overlay: leave only an outer contact shadow.
          shadow.current.style.background = 'transparent';
          shadow.current.style.boxShadow = '0 1px 7px #160c29b3';
          secondaryAnimations.push(
            shadow.current.animate([{ opacity: 0.78 }, { opacity: 0 }], {
              delay: 40,
              duration: 320,
              fill: 'forwards',
            })
          );
        }
        // Hold the contact pose for 40ms before the impulse propagates. Rules never wait.
        shockTimer = window.setTimeout(() => {
          if (disposed) return;
          // Only animate already-rendered field cards: never hands, decks, or hidden identities.
          // Additive transforms preserve resting orientation and any existing card transform.
          const neighbors = board.querySelectorAll<HTMLElement>(
            '[data-battle-ui-anchor*="-stage-"] [data-object-id], [data-battle-ui-anchor$="-live-zone"] [data-object-id]'
          );
          const reach = Math.max(1, Math.hypot(bounds.width, bounds.height) * 0.55);
          for (const neighbor of neighbors) {
            if (
              neighbor.dataset.objectId === objectId ||
              getComputedStyle(neighbor).visibility !== 'visible'
            )
              continue;
            const neighborRect = neighbor.getBoundingClientRect();
            if (!neighborRect.width || !neighborRect.height) continue;
            const dx = neighborRect.left + neighborRect.width / 2 - end.x;
            const dy = neighborRect.top + neighborRect.height / 2 - end.y;
            const distance = Math.min(1, Math.hypot(dx, dy) / reach);
            const strength = 1 - distance * 0.75;
            const zoom = 1 + (bounds.width < 600 ? 0.07 : 0.1) * strength;
            const tiltX = (dy >= 0 ? -1 : 1) * 7 * strength;
            const tiltY = (dx >= 0 ? 1 : -1) * 9 * strength;
            // Lift toward the viewer: centred zoom, slight edge lift and a softer shadow.
            // No upward/downward screen translation; resting orientation remains additive.
            secondaryAnimations.push(
              neighbor.animate(
                [
                  {
                    transform: 'perspective(700px) rotateX(0deg) rotateY(0deg) scale(1)',
                    filter: 'drop-shadow(0px 0px 0px #160c2900)',
                    offset: 0,
                    easing: 'cubic-bezier(.15,.7,.3,1)',
                  },
                  {
                    transform: `perspective(700px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(${zoom})`,
                    filter: `drop-shadow(2px 3px ${8 * strength}px #160c2973)`,
                    offset: 0.32,
                    easing: 'cubic-bezier(.55,0,.85,.4)',
                  },
                  {
                    transform: 'perspective(700px) rotateX(0deg) rotateY(0deg) scale(1)',
                    filter: 'drop-shadow(0px 0px 0px #160c2900)',
                    offset: 0.84,
                  },
                  {
                    transform: 'perspective(700px) rotateX(0deg) rotateY(0deg) scale(1)',
                    filter: 'drop-shadow(0px 0px 0px #160c2900)',
                    offset: 1,
                  },
                ],
                { duration: 300, delay: distance * 40, composite: 'add' }
              )
            );
          }
          // Shake only the tabletop artwork and card zones. HUD, hands and controls stay fixed.
          const amplitude = bounds.width < 600 ? 1 : 2;
          const surfaces = board.querySelectorAll<HTMLElement>(
            '.board-background, [data-battle-ui-anchor*="-stage-"], [data-battle-ui-anchor$="-live-zone"]'
          );
          for (const surface of [
            ...surfaces,
            ...(impactLayer.current ? [impactLayer.current] : []),
          ]) {
            secondaryAnimations.push(
              surface.animate(
                [
                  { translate: '0px 0px' },
                  { translate: `${-amplitude}px ${amplitude * 0.5}px`, offset: 0.12 },
                  { translate: `${amplitude}px ${-amplitude * 0.5}px`, offset: 0.32 },
                  { translate: `${-amplitude * 0.5}px ${-amplitude * 0.25}px`, offset: 0.52 },
                  { translate: `${amplitude * 0.25}px 0px`, offset: 0.72 },
                  { translate: '0px 0px' },
                ],
                { duration: 160, easing: 'linear' }
              )
            );
          }
        }, 40);
      };
    }, CARD_ENTRANCE_LANDING_DELAY_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearTimeout(shockTimer);
      window.removeEventListener('resize', abort);
      window.removeEventListener('scroll', abort, true);
      flight?.cancel();
      for (const animation of secondaryAnimations) animation.cancel();
    };
  }, [presentation]);

  return (
    <div className="card-landing" data-testid="kanata-landing" aria-hidden="true">
      <div ref={shadow} className="card-landing-shadow" />
      <img
        ref={card}
        className="card-landing-card"
        src={presentation.imagePath}
        alt=""
        onError={() => callbacks.current.onDone()}
      />
      {impact && (
        <div
          ref={impactLayer}
          className="card-landing-impact"
          style={{ left: impact.x, top: impact.y, width: impact.size, height: impact.size }}
        >
          <span className="card-landing-flash" />
          <span className="card-landing-ring" />
          <span className="card-landing-ring card-landing-ring--echo" />
          <span className="card-landing-dust" />
          {Array.from({ length: 10 }, (_, i) => {
            const angle = (i / 10) * Math.PI * 2;
            return (
              <i
                key={i}
                className="card-landing-spark"
                style={
                  {
                    '--spark-x': `${Math.cos(angle) * impact.size * (i % 2 ? 1.1 : 0.85)}px`,
                    '--spark-y': `${Math.sin(angle) * impact.size * (i % 2 ? 1.1 : 0.85)}px`,
                    '--spark-turn': `${i * 41}deg`,
                  } as CSSProperties
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
