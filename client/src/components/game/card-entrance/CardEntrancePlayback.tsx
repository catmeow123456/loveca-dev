import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CardEntranceProfile } from '@/lib/cardEntranceProfiles';
import { prepareEntranceAssets } from '@/lib/cardEntranceAssets';
import { entranceTimeline, entranceImpactCss, entranceRemaining } from '@/lib/cardEntranceTimeline';
import { CardEntrancePortrait } from './CardEntrancePortrait';
import { CardLanding, type LandingPresentation } from './CardLanding';

/** One cancellable resource preparation and one clock for portrait, landing and completion. */
export function CardEntrancePlayback({
  presentation,
  profile,
  reduced,
  onImpact,
  onDone,
}: {
  presentation: LandingPresentation;
  profile: CardEntranceProfile;
  reduced: boolean;
  onImpact: () => void;
  onDone: () => void;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  const [ready, setReady] = useState<{
    portrait: HTMLImageElement;
    card: HTMLImageElement | null;
    startedAt: number;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setReady(null);
    prepareEntranceAssets(profile, reduced ? null : presentation.imagePath, controller.signal)
      .then((assets) => {
        if (!controller.signal.aborted) setReady({ ...assets, startedAt: performance.now() });
      })
      .catch(() => {
        if (!controller.signal.aborted) done.current();
      });
    return () => controller.abort();
  }, [profile, presentation.imagePath, reduced]);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(
      () => done.current(),
      entranceRemaining(
        ready.startedAt,
        reduced ? entranceTimeline.reduced : entranceTimeline.total
      )
    );
    return () => window.clearTimeout(timer);
  }, [ready, reduced]);
  return (
    <div
      className="card-entrance-presentation"
      data-profile={profile.id}
      data-phase={ready ? 'playing' : 'loading'}
      style={
        {
          '--entrance-art-center': profile.center,
          '--entrance-mobile-height': profile.mobileHeight,
          '--entrance-light': profile.light,
          ...entranceImpactCss,
        } as CSSProperties
      }
    >
      {ready && (
        <>
          <CardEntrancePortrait
            profile={profile}
            image={ready.portrait}
            startedAt={ready.startedAt}
            reduced={reduced}
            onDone={onDone}
          />
          {!reduced && (
            <CardLanding
              presentation={presentation}
              startedAt={ready.startedAt}
              onImpact={onImpact}
              onDone={onDone}
            />
          )}
        </>
      )}
      <button
        className="card-entrance-skip"
        onClick={(e) => {
          e.stopPropagation();
          onDone();
        }}
      >
        跳过演出
      </button>
    </div>
  );
}
