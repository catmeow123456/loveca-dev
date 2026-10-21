import { useEffect, useRef } from 'react';
import { CardEntranceNameplate } from './CardEntranceNameplate';
import { createCardEntranceMesh } from '../../../lib/cardEntranceMesh';
import type { CardEntranceProfile } from '../../../lib/cardEntranceProfiles';
import { entrancePortraitFrame } from '../../../lib/cardEntranceTimeline';
import { paintPortraitFlowers } from '@/lib/ginkoFlowerTransfer';

export function CardEntrancePortrait({
  profile,
  image,
  blinkImage,
  startedAt,
  reduced,
  preludeRevealMs = 0,
  onDone,
}: {
  profile: CardEntranceProfile;
  image: HTMLImageElement;
  blinkImage?: HTMLImageElement | null;
  startedAt: number;
  reduced: boolean;
  preludeRevealMs?: number;
  onDone: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const flowers = useRef<HTMLCanvasElement>(null);
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
        mesh = createCardEntranceMesh(
          canvas.current,
          image,
          profile.mesh,
          profile.blink && blinkImage
            ? { image: blinkImage, faces: profile.blink.faces }
            : undefined
        );
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
        // Let the incoming flower light reveal the portrait during the gathering phase
        // of the prelude. Keep the hand stationary so the light has a real recipient.
        if (preludeRevealMs && !reduced) {
          const reveal = Math.max(0, Math.min(1, (elapsed + preludeRevealMs) / preludeRevealMs));
          visual.opacity = reveal * (1 - Math.max(0, Math.min(1, (elapsed - 1500) / 450)));
          visual.x = 0;
        }
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
        if (flowers.current && profile.flowerLight)
          paintPortraitFlowers(
            flowers.current,
            elapsed,
            profile.flowerLight,
            reduced,
            preludeRevealMs > 0
          );
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
  }, [reduced, profile, image, blinkImage, startedAt, preludeRevealMs]);
  return (
    <div
      ref={container}
      className={`card-entrance card-entrance--centered${profile.nameLayout ? ` card-entrance--${profile.nameLayout}` : ''}${profile.mobileSkipPosition === 'below-name' ? ' card-entrance--lower-skip' : ''}`}
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
      {profile.flowerLight && (
        <canvas
          ref={flowers}
          className="card-entrance-art ginko-portrait-flowers"
          style={{ aspectRatio: profile.artAspectRatio }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
