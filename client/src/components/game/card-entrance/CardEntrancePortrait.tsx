import { useEffect, useRef } from 'react';
import { createCardEntranceMesh } from '../../../lib/cardEntranceMesh';
import type { CardEntranceProfile } from '../../../lib/cardEntranceProfiles';
import kanataArt from './kanata.png';
import renArt from './ren.png';
const artwork = { kanata: kanataArt, ren: renArt };

export function CardEntrancePortrait({
  profile,
  reduced,
  onDone,
}: {
  profile: CardEntranceProfile;
  reduced: boolean;
  onDone: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const image = new Image();
    const target = canvas.current;
    const lost = () => done.current();
    target?.addEventListener('webglcontextlost', lost);
    let frame = 0,
      disposed = false;
    let mesh: ReturnType<typeof createCardEntranceMesh> = null;
    const start = performance.now();
    image.onload = () => {
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
        const t = (now - start) / 1000;
        if (t >= 1.95) {
          if (container.current) container.current.style.opacity = '0';
          return;
        }
        const enter = 1 - (1 - Math.min(1, t / 0.6)) ** 3;
        const exit = Math.max(0, Math.min(1, (t - 1.5) / 0.45));
        if (container.current) {
          container.current.style.opacity = String(reduced ? 1 : enter * (1 - exit));
          const labelEnter = reduced
            ? 1
            : 1 - (1 - Math.max(0, Math.min(1, (t - 0.3) / 0.35))) ** 3;
          container.current.style.setProperty('--name-opacity', String(labelEnter));
          container.current.style.setProperty('--name-y', `${(1 - labelEnter) * 12}px`);
          container.current.style.setProperty(
            '--entrance-x',
            `${reduced ? 0 : (1 - enter) * 65}px`
          );
        }
        mesh?.draw(t, reduced);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    image.onerror = () => done.current();
    image.src = artwork[profile.id];
    return () => {
      disposed = true;
      target?.removeEventListener('webglcontextlost', lost);
      cancelAnimationFrame(frame);
      image.onload = null;
      image.onerror = null;
      mesh?.dispose();
    };
  }, [reduced, profile]);
  return (
    <div
      ref={container}
      className="card-entrance card-entrance--centered"
      data-testid="card-entrance"
      aria-label={`${profile.name}登场`}
      style={{ opacity: 0 }}
    >
      <div className="card-entrance-light" />
      <canvas ref={canvas} className="card-entrance-art" />
      <div className="card-entrance-name">
        <span className="card-entrance-card-name">{profile.name}</span>
      </div>
    </div>
  );
}
