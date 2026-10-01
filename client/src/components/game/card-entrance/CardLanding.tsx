import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { collectBattleAnimationAnchors } from '@/lib/battleAnimationEvents';
import {
  CARD_ENTRANCE_FLIGHT_MS,
  CARD_ENTRANCE_LANDING_DELAY_MS,
  getLandingCardGeometry,
  type EntranceStageTarget,
} from '@/lib/cardEntranceLanding';
import { OrientationState } from '@game/shared/types/enums';

export interface LandingPresentation {
  id: string;
  target?: EntranceStageTarget;
  previewAnchor?: string;
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
  const callbacks = useRef({ onImpact, onDone });
  callbacks.current = { onImpact, onDone };
  const [impact, setImpact] = useState<{ x: number; y: number; size: number } | null>(null);

  useEffect(() => {
    let disposed = false;
    let flight: Animation | undefined;
    const secondaryAnimations: Animation[] = [];
    const abort = () => callbacks.current.onDone();
    // Never fly toward stale coordinates after a resize or scroll.
    window.addEventListener('resize', abort);
    window.addEventListener('scroll', abort, true);
    const timer = window.setTimeout(() => {
      const image = card.current;
      if (!image?.complete || !image.naturalWidth) return abort();
      const objectId = presentation.target?.objectId;
      const element = objectId
        ? document.querySelector<HTMLElement>(`[data-object-id="${CSS.escape(objectId)}"]`)
        : document.querySelector<HTMLElement>(
            `[data-battle-ui-anchor="${presentation.previewAnchor}"] [data-zone-id]`
          );
      const rect = objectId
        ? collectBattleAnimationAnchors().cards.get(objectId)
        : element?.getBoundingClientRect();
      const board = document.querySelector<HTMLElement>('[data-battle-ui-anchor="battle-board"]');
      if (!rect || !element || !board || rect.width <= 0 || rect.height <= 0) return abort();
      const end = getLandingCardGeometry(
        rect,
        presentation.target?.orientation ?? OrientationState.ACTIVE
      );
      const bounds = board.getBoundingClientRect();
      const startX = bounds.left + bounds.width * 0.5 - end.x;
      const startY = bounds.top + bounds.height * 0.42 - end.y;
      const scale = Math.max(1.65, Math.min(2.8, Math.min(270, bounds.width * 0.43) / end.width));
      Object.assign(image.style, {
        left: `${end.x}px`,
        top: `${end.y}px`,
        width: `${end.width}px`,
        height: `${end.height}px`,
      });
      const transform = (x: number, y: number, tilt: number, rotation: number, zoom: number) =>
        `translate(-50%, -50%) translate(${x}px, ${y}px) perspective(800px) rotateX(${tilt}deg) rotateZ(${rotation}deg) scale(${zoom})`;
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
                filter: 'blur(18px)',
                transform: `translate(-50%, -50%) translateX(${startX * 0.4}px) scale(2.2, 1.3)`,
              },
              {
                opacity: 0.22,
                filter: 'blur(16px)',
                transform: `translate(-50%, -50%) translateX(${startX * 0.4}px) scale(2.2, 1.3)`,
                offset: 0.42,
                easing: 'cubic-bezier(.8,0,1,.65)',
              },
              {
                opacity: 0.78,
                filter: 'blur(2px)',
                transform: 'translate(-50%, -50%) scale(1.03, .98)',
              },
            ],
            { duration: CARD_ENTRANCE_FLIGHT_MS, fill: 'forwards' }
          )
        );
      }
      flight = image.animate(
        [
          { opacity: 0, transform: transform(startX, startY - 22, 28, -8, scale), offset: 0 },
          { opacity: 1, transform: transform(startX, startY - 30, 25, -6, scale), offset: 0.16 },
          {
            opacity: 1,
            transform: transform(startX, startY - 34, 25, -6, scale * 1.025),
            offset: 0.42,
            easing: 'cubic-bezier(.8,0,1,.65)',
          },
          // Accelerate all the way into contact; no easing-out or elastic bounce.
          { opacity: 1, transform: transform(0, 0, 0, end.rotation, 1), offset: 1 },
        ],
        { duration: CARD_ENTRANCE_FLIGHT_MS, fill: 'forwards' }
      );
      flight.onfinish = () => {
        if (disposed) return;
        // Reveal the actual card at contact; the flight image never lingers over it.
        if (presentation.target) image.style.visibility = 'hidden';
        callbacks.current.onImpact();
        setImpact({ x: end.x, y: end.y, size: Math.max(end.width, end.height) });
        if (shadow.current) {
          secondaryAnimations.push(
            shadow.current.animate([{ opacity: 0.78 }, { opacity: 0 }], {
              duration: 240,
              fill: 'forwards',
            })
          );
        }
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
          const height = (bounds.width < 600 ? 14 : 24) * strength;
          const tilt = (dx >= 0 ? 1 : -1) * 4 * strength;
          secondaryAnimations.push(
            neighbor.animate(
              [
                {
                  translate: '0px 0px',
                  transform: 'perspective(700px) rotateX(0deg) rotateZ(0deg)',
                  offset: 0,
                  easing: 'cubic-bezier(.15,.7,.3,1)',
                },
                {
                  translate: `0px ${-height}px`,
                  transform: `perspective(700px) rotateX(${10 * strength}deg) rotateZ(${tilt}deg)`,
                  offset: 0.32,
                  easing: 'cubic-bezier(.55,0,.85,.4)',
                },
                {
                  translate: '0px 0px',
                  transform: 'perspective(700px) rotateX(0deg) rotateZ(0deg)',
                  offset: 0.84,
                },
                {
                  translate: '0px 0px',
                  transform: 'perspective(700px) rotateX(0deg) rotateZ(0deg)',
                  offset: 1,
                },
              ],
              { duration: 300, delay: distance * 40, composite: 'add' }
            )
          );
        }
        // Shake only the tabletop artwork and card zones. HUD, hands and controls stay fixed.
        const amplitude = bounds.width < 600 ? 4 : 7;
        const surfaces = board.querySelectorAll<HTMLElement>(
          '.board-background, [data-battle-ui-anchor*="-stage-"], [data-battle-ui-anchor$="-live-zone"]'
        );
        for (const surface of surfaces) {
          secondaryAnimations.push(
            surface.animate(
              [
                { translate: '0px 0px' },
                { translate: `${-amplitude * 0.3}px ${amplitude}px`, offset: 0.12 },
                { translate: `${amplitude * 0.22}px ${-amplitude * 0.45}px`, offset: 0.32 },
                { translate: `${-amplitude * 0.12}px ${amplitude * 0.24}px`, offset: 0.52 },
                { translate: `0px ${-amplitude * 0.1}px`, offset: 0.72 },
                { translate: '0px 0px' },
              ],
              { duration: 240, easing: 'linear' }
            )
          );
        }
      };
    }, CARD_ENTRANCE_LANDING_DELAY_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
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
                    '--spark-y': `${Math.sin(angle) * impact.size * 0.5 - impact.size * 0.12}px`,
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
