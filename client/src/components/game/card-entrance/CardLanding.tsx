import { entranceTimeline as timing, entranceRemaining } from '@/lib/cardEntranceTimeline';
import { useEffect, useRef, useState } from 'react';
import { LandingGroundLight } from './LandingGroundLight';
import { prepareLandingImpactTextures, type LandingImpactTextures } from './landingImpactTextures';
import { attachCardSurfaceLighting, type CardSurfaceLighting } from '@/lib/cardSurfaceLighting';
import { getAncestorTableRotation } from '@/lib/cardTableGeometry';
import { collectBattleAnimationAnchors } from '@/lib/battleAnimationEvents';
import {
  type EntranceStageTarget,
  getLandingCardGeometry,
  getLandingFlightFrame,
  getNeighborImpactResponse,
  getNeighborImpactHinge,
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
  const flyingCard = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const impactLayer = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onImpact, onDone });
  callbacks.current = { onImpact, onDone };
  const [impact, setImpact] = useState<{
    x: number;
    y: number;
    size: number;
    startedAt: number;
    textures: LandingImpactTextures | null;
  } | null>(null);

  useEffect(() => {
    let disposed = false;
    let flightFrame = 0;
    let shockTimer: number | undefined;
    const secondaryAnimations: Animation[] = [];
    const groundShadows: HTMLElement[] = [];
    const litSurfaces: CardSurfaceLighting[] = [];
    let textures: LandingImpactTextures | null = null;
    void prepareLandingImpactTextures().then((ready) => {
      if (!disposed) textures = ready;
    });
    const abort = () => callbacks.current.onDone();
    // Never fly toward stale coordinates after a resize or scroll.
    window.addEventListener('resize', abort);
    window.addEventListener('scroll', abort, true);
    const timer = window.setTimeout(
      () => {
        const image = card.current;
        const flight = flyingCard.current;
        if (!image?.complete || !image.naturalWidth || !flight) return abort();
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
        Object.assign(flight.style, {
          left: `${end.x}px`,
          top: `${end.y}px`,
          width: `${end.width}px`,
          height: `${end.height}px`,
        });
        const flightLighting = attachCardSurfaceLighting(flight, { restingRotation: end.rotation });
        litSurfaces.push(flightLighting);
        const transform = (x: number, y: number, tilt: number, rotation: number, zoom: number) =>
          `translate(-50%, -50%) translate(${x}px, ${y}px) perspective(800px) rotateZ(${rotation}deg) rotateX(${tilt}deg) rotateY(${-tilt * 0.6}deg) scale(${zoom})`;
        const contact = () => {
          if (disposed) return;
          // Reveal the actual card at contact; the flight image never lingers over it.
          flight.style.visibility = 'hidden';
          flightLighting.dispose();
          callbacks.current.onImpact();
          secondaryAnimations.push(
            element.animate(
              [
                { boxShadow: '0 0 0 1px #e4f2ff, 0 0 10px #b4d0ff80' },
                { boxShadow: '0 0 0 0px transparent' },
              ],
              { duration: timing.impact.flash }
            )
          );
          setImpact({
            x: end.x,
            y: end.y,
            size: Math.max(end.width, end.height),
            startedAt: performance.now(),
            textures,
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
              const distance = Math.hypot(dx, dy);
              const id = neighbor.dataset.objectId ?? '';
              const lift = impactVariation(id, 2166136261);
              const pace = impactVariation(id, 374761393);
              const response = getNeighborImpactResponse(distance, reach, lift);
              if (!response) continue;
              const { strength, angle, arrival } = response;
              const width = neighbor.offsetWidth;
              const height = neighbor.offsetHeight;
              const restingStyle = getComputedStyle(neighbor);
              const restingMatrix = new DOMMatrixReadOnly(
                restingStyle.transform === 'none' ? undefined : restingStyle.transform
              );
              const rotation =
                getAncestorTableRotation(neighbor) +
                (parseFloat(restingStyle.rotate) || 0) +
                (Math.atan2(restingMatrix.b, restingMatrix.a) * 180) / Math.PI;
              const hinge = getNeighborImpactHinge(-dx, -dy, rotation, width, height);
              if (!hinge) continue;
              const { pivotX, pivotY, axisX, axisY } = hinge;
              const elevation = Math.min(width, height) * 0.04 * strength;
              const perspective = Math.max(width, height) * 4.5;
              const pose = (heightFactor: number, lean: number) =>
                `perspective(${perspective}px) translateZ(${elevation * heightFactor}px) translate(${pivotX}px, ${pivotY}px) rotate3d(${axisX}, ${axisY}, 0, ${angle * lean}deg) translate(${-pivotX}px, ${-pivotY}px)`;
              const delay = arrival * timing.impact.spread;
              const duration = Math.min(
                timing.impact.neighbors * (0.8 + pace * 0.2),
                timing.impactDuration - delay - 16
              );
              const peak = 0.24 + pace * 0.1;
              const surfaceLighting = attachCardSurfaceLighting(neighbor, {
                restingRotation: rotation,
              });
              litSurfaces.push(surfaceLighting);
              secondaryAnimations.push(
                ...surfaceLighting.animatePoses(
                  [
                    {
                      offset: 0,
                      pose: { tiltX: 0, tiltY: 0, lift: 0 },
                      easing: 'cubic-bezier(.12,.75,.25,1)',
                    },
                    {
                      offset: peak,
                      pose: { tiltX: axisX * angle, tiltY: axisY * angle, lift: 1 },
                      easing: 'cubic-bezier(.55,0,.85,.4)',
                    },
                    {
                      offset: 0.72 + pace * 0.08,
                      pose: { tiltX: axisX * angle * 0.065, tiltY: axisY * angle * 0.065, lift: 0 },
                      easing: 'ease-out',
                    },
                    { offset: 1, pose: { tiltX: 0, tiltY: 0, lift: 0 } },
                  ],
                  { duration, delay }
                )
              );
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
                  { opacity: 0.14 * strength, filter: 'blur(1px)', offset: 0.78 },
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
                      boxShadow: '0 1px 0 #332a4080, 0 0 1px #ece4f650',
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
            const amplitude = Math.min(2, Math.max(end.width, end.height) * 0.012);
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
        // Card and shadow are sampled from the same height, including delayed frames.
        const flightStarted = performance.now();
        const drawFlight = (now: number) => {
          if (disposed) return;
          const elapsed = now - flightStarted;
          const { path, height, finished } = getLandingFlightFrame(
            elapsed,
            timing.travel,
            timing.press
          );
          const px = startX * (1 - path),
            py = startY * (1 - path);
          flight.style.opacity = String(Math.min(1, elapsed / timing.flightFade));
          flight.style.transform = transform(
            px,
            py,
            7 * height,
            end.rotation - (6 - 4 * path) * height,
            1 + (scale - 1) * height
          );
          flightLighting.setPose({ tiltX: 7 * height, tiltY: -4.2 * height, lift: height });
          if (shadow.current)
            Object.assign(shadow.current.style, {
              left: `${end.x}px`,
              top: `${end.y}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              opacity: String((0.12 + 0.5 * (1 - height)) * Math.min(1, elapsed / 120)),
              filter: `blur(${1.5 + height * 9}px)`,
              transform: `translate(-50%, -50%) translate(${px + height * end.width * 0.045}px, ${py + height * end.height * 0.045}px) scale(${1 + height * 0.12})`,
            });
          if (finished) contact();
          else flightFrame = requestAnimationFrame(drawFlight);
        };
        flightFrame = requestAnimationFrame(drawFlight);
      },
      entranceRemaining(startedAt, timing.landingAt)
    );
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearTimeout(shockTimer);
      window.removeEventListener('resize', abort);
      window.removeEventListener('scroll', abort, true);
      cancelAnimationFrame(flightFrame);
      for (const animation of secondaryAnimations) animation.cancel();
      for (const groundShadow of groundShadows) groundShadow.remove();
      for (const surface of litSurfaces) surface.dispose();
    };
  }, [presentation, startedAt]);

  return (
    <div className="card-landing" data-testid="card-landing" aria-hidden="true">
      <div ref={shadow} className="card-landing-shadow" />
      <div ref={flyingCard} className="card-landing-card">
        <img
          ref={card}
          src={presentation.imagePath}
          alt=""
          onError={() => callbacks.current.onDone()}
        />
      </div>
      {impact && (
        <div
          ref={impactLayer}
          className="card-landing-impact"
          style={{ left: impact.x, top: impact.y, width: 0, height: 0 }}
        >
          <LandingGroundLight {...impact} />
        </div>
      )}
    </div>
  );
}
