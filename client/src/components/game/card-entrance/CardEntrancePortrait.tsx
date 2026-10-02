import { useEffect, useRef } from 'react';
import { CardEntranceNameplate } from './CardEntranceNameplate';
import { createCardEntranceMesh } from '../../../lib/cardEntranceMesh';
import type { CardEntranceProfile } from '../../../lib/cardEntranceProfiles';
import { entrancePortraitFrame } from '../../../lib/cardEntranceTimeline';

export function CardEntrancePortrait({
  profile,
  image,
  startedAt,
  reduced,
  onDone,
}: {
  profile: CardEntranceProfile;
  image: HTMLImageElement;
  startedAt: number;
  reduced: boolean;
  onDone: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const target = canvas.current;
    const lost = () => done.current();
    target?.addEventListener('webglcontextlost', lost);
    let frame = 0,
      disposed = false;
    let mesh: ReturnType<typeof createCardEntranceMesh> = null;
    const initialize = () => {
      if (disposed || !canvas.current) return;
      try {
        mesh = createCardEntranceMesh(canvas.current, image, profile.mesh);
      } catch {
        done.current();
        return;
      }
      if (!mesh) {
        done.current();
        return;
      }
      const tick = (now: number) => {
        if (disposed) return;
        const elapsed = now - startedAt;
        const visual = entrancePortraitFrame(elapsed, reduced);
        if (visual.finished) {
          if (container.current) container.current.style.opacity = '0';
          return;
        }
        if (container.current) {
          container.current.style.opacity = String(visual.opacity);
          container.current.style.setProperty('--name-opacity', String(visual.label));
          container.current.style.setProperty('--name-y', `${(1 - visual.label) * 12}px`);
          container.current.style.setProperty('--entrance-x', `${visual.x}px`);
        }
        mesh?.draw(elapsed / 1000, reduced);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    initialize();
    return () => {
      disposed = true;
      target?.removeEventListener('webglcontextlost', lost);
      cancelAnimationFrame(frame);
      mesh?.dispose();
    };
  }, [reduced, profile, image, startedAt]);
  return (
    <div
      ref={container}
      className={`card-entrance card-entrance--centered${profile.nameLayout === 'group' ? ' card-entrance--group' : ''}`}
      data-testid="card-entrance"
      aria-label={`${profile.name}登场`}
      style={{ opacity: 0 }}
    >
      <div className="card-entrance-light" />
      <canvas
        ref={canvas}
        className="card-entrance-art"
        style={{ aspectRatio: profile.artAspectRatio }}
      />
      <CardEntranceNameplate name={profile.name} />
    </div>
  );
}
