import { entranceTimeline as timing, entranceRemaining } from '@/lib/cardEntranceTimeline';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { collectBattleAnimationAnchors } from '@/lib/battleAnimationEvents';
import {
  getLandingCardGeometry,
  getNeighborImpactHinge,
  type EntranceStageTarget,
} from '@/lib/cardEntranceLanding';

// Stable per public object: variations do not change between frames or consume rule RNG.
function impactVariation(objectId: string, salt: number): number {
  let hash = salt;
  for (const char of objectId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffffffff;
}

export interface LandingPresentation {
  id: string;
  target: EntranceStageTarget;
  imagePath: string;
}

export function CardLanding({
  presentation,
  startedAt,
  onImpact,
  onDone,
}: {
  presentation: LandingPresentation;
  startedAt: number;
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
    const groundShadows: HTMLElement[] = [];
    const abort = () => callbacks.current.onDone();
    // Never fly toward stale coordinates after a resize or scroll.
    window.addEventListener('resize', abort);
    window.addEventListener('scroll', abort, true);
    const timer = window.setTimeout(
      () => {
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
                  offset: timing.travel / timing.flight,
                  easing: 'cubic-bezier(.8,0,1,.65)',
                },
                {
                  opacity: 0.78,
                  filter: 'blur(2px)',
                  transform: 'translate(-50%, -50%) scale(1.02)',
                },
              ],
              { duration: timing.flight, fill: 'forwards' }
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
              offset: timing.flightFade / timing.flight,
              easing: 'cubic-bezier(.35,0,.65,1)',
            },
            {
              opacity: 1,
              transform: transform(0, 0, 7, end.rotation - 2, scale),
              offset: timing.travel / timing.flight,
              easing: 'cubic-bezier(.8,0,1,.65)',
            },
            // At the slot, press toward the tabletop without screen-space falling or rebound.
            { opacity: 1, transform: transform(0, 0, 0, end.rotation, 1), offset: 1 },
          ],
          { duration: timing.flight, fill: 'forwards' }
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
                delay: timing.impact.contact,
                duration: timing.impact.shadow,
                fill: 'forwards',
              })
            );
          }
          // Start the tabletop impulse at contact; neighbors respond as the wave reaches them.
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
              const id = neighbor.dataset.objectId ?? '';
              const lift = impactVariation(id, 2166136261);
              const pace = impactVariation(id, 374761393);
              const strength = (1 - distance * 0.8) * (0.78 + lift * 0.44);
              const width = neighbor.offsetWidth;
              const height = neighbor.offsetHeight;
              const restingStyle = getComputedStyle(neighbor);
              const restingMatrix = new DOMMatrixReadOnly(
                restingStyle.transform === 'none' ? undefined : restingStyle.transform
              );
              const rotation =
                (parseFloat(restingStyle.rotate) || 0) +
                (Math.atan2(restingMatrix.b, restingMatrix.a) * 180) / Math.PI;
              const hinge = getNeighborImpactHinge(-dx, -dy, rotation, width, height);
              if (!hinge) continue;
              const { pivotX, pivotY, axisX, axisY } = hinge;
              const angle = Math.min(46, (36 + lift * 12) * (0.65 + strength * 0.35));
              const elevation = Math.min(width, height) * 0.04 * strength;
              const perspective = Math.max(width, height) * 4.5;
              const pose = (heightFactor: number, lean: number) =>
                `perspective(${perspective}px) translateZ(${elevation * heightFactor}px) translate(${pivotX}px, ${pivotY}px) rotate3d(${axisX}, ${axisY}, 0, ${angle * lean}deg) translate(${-pivotX}px, ${-pivotY}px)`;
              const duration = timing.impact.neighbors * (0.8 + pace * 0.2);
              const delay = distance * timing.impact.spread;
              const peak = 0.24 + pace * 0.1;
              // A separate, flat silhouette stays on the tabletop instead of rotating with the art.
              // Insert a disposable sibling, never reparent React's card or change its resting styles.
              const groundShadow = document.createElement('div');
              groundShadow.className = 'card-landing-neighbor-shadow';
              groundShadow.setAttribute('aria-hidden', 'true');
              Object.assign(groundShadow.style, {
                left: `${neighbor.offsetLeft}px`,
                top: `${neighbor.offsetTop}px`,
                width: `${width}px`,
                height: `${height}px`,
                rotate: restingStyle.rotate,
                transform: restingStyle.transform,
                transformOrigin: restingStyle.transformOrigin,
              });
              neighbor.before(groundShadow);
              groundShadows.push(groundShadow);
              const shadowMotion = groundShadow.animate(
                [
                  { opacity: 0, filter: 'blur(1px)', offset: 0 },
                  { opacity: 0.48 * strength, filter: `blur(${3 + 5 * strength}px)`, offset: peak },
                  { opacity: 0.28, filter: 'blur(1px)', offset: 0.78 },
                  { opacity: 0, filter: 'blur(0px)', offset: 1 },
                ],
                { duration, delay, easing: 'ease-out' }
              );
              shadowMotion.onfinish = () => groundShadow.remove();
              secondaryAnimations.push(shadowMotion);
              secondaryAnimations.push(
                neighbor.animate(
                  [
                    {
                      transform: pose(0, 0),
                      boxShadow: '0 0 0 transparent',
                      zIndex: '2',
                      offset: 0,
                      easing: 'cubic-bezier(.12,.75,.25,1)',
                    },
                    {
                      transform: pose(1, 1),
                      boxShadow: '1px 2px 0 #332a40, 0 0 1px #ece4f6',
                      zIndex: '2',
                      offset: peak,
                      easing: 'cubic-bezier(.55,0,.85,.4)',
                    },
                    {
                      transform: pose(0, 0.065),
                      boxShadow: '0 1px 1px #160c2940',
                      zIndex: '2',
                      offset: 0.72 + pace * 0.08,
                      easing: 'ease-out',
                    },
                    {
                      transform: pose(0, 0),
                      boxShadow: '0 0 0 transparent',
                      zIndex: '2',
                      offset: 1,
                    },
                  ],
                  {
                    duration,
                    delay,
                    composite: 'add',
                  }
                )
              );
            }
            // Shake only the tabletop artwork and card zones. HUD, hands and controls stay fixed.
            const amplitude = bounds.width < 600 ? 2.5 : 5;
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
                    { translate: `${-amplitude}px ${amplitude * 0.5}px`, offset: 0.07 },
                    { translate: `${amplitude}px ${-amplitude * 0.5}px`, offset: 0.23 },
                    { translate: `${-amplitude * 0.5}px ${-amplitude * 0.25}px`, offset: 0.45 },
                    { translate: `${amplitude * 0.25}px 0px`, offset: 0.7 },
                    { translate: '0px 0px' },
                  ],
                  { duration: timing.impact.shake, easing: 'linear' }
                )
              );
            }
          }, timing.impact.contact);
        };
      },
      entranceRemaining(startedAt, timing.landingAt)
    );
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearTimeout(shockTimer);
      window.removeEventListener('resize', abort);
      window.removeEventListener('scroll', abort, true);
      flight?.cancel();
      for (const animation of secondaryAnimations) animation.cancel();
      for (const groundShadow of groundShadows) groundShadow.remove();
    };
  }, [presentation, startedAt]);

  return (
    <div className="card-landing" data-testid="card-landing" aria-hidden="true">
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
