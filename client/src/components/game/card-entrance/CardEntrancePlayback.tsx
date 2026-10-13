import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CardEntranceProfile } from '@/lib/cardEntranceProfiles';
import { prepareEntranceAssets } from '@/lib/cardEntranceAssets';
import { entranceTimeline, entranceImpactCss, entranceRemaining } from '@/lib/cardEntranceTimeline';
import { DoubleRelayFusion } from './DoubleRelayFusion';
import { doubleRelayTimeline, type DoubleRelaySource } from '@/lib/doubleRelayEntrance';
import { CardEntrancePortrait } from './CardEntrancePortrait';
import { CardLanding, type LandingPresentation } from './CardLanding';
import { useGameStore } from '@/store/gameStore';
import { getEntranceStageTarget, sameEntranceTarget } from '@/lib/cardEntranceLanding';

const NO_RELAY_SOURCES: readonly DoubleRelaySource[] = [];

/** One cancellable resource preparation and one clock for portrait, landing and completion. */
export function CardEntrancePlayback({
  presentation,
  profile,
  reduced,
  relaySources = NO_RELAY_SOURCES,
  onImpact,
  onDone,
}: {
  presentation: LandingPresentation;
  profile: CardEntranceProfile;
  reduced: boolean;
  relaySources?: readonly DoubleRelaySource[];
  onImpact: () => void;
  onDone: () => void;
}) {
  const fusion = !reduced && relaySources.length === 2;
  const portraitOffset = fusion ? doubleRelayTimeline.portraitAt : 0;
  const done = useRef(onDone);
  done.current = onDone;
  const sourceValid = useGameStore((state) =>
    sameEntranceTarget(
      presentation.target,
      state.playerViewState
        ? getEntranceStageTarget(state.playerViewState, presentation.target.objectId)
        : null
    )
  );
  useEffect(() => {
    if (!sourceValid) done.current();
  }, [sourceValid]);
  const [ready, setReady] = useState<{
    portrait: HTMLImageElement;
    card: HTMLImageElement | null;
    blink: HTMLImageElement | null;
    startedAt: number;
  } | null>(null);
  useEffect(() => {
    if (!sourceValid) return;
    const controller = new AbortController();
    setReady(null);
    prepareEntranceAssets(
      profile,
      reduced ? null : presentation.imagePath,
      controller.signal,
      undefined,
      fusion ? relaySources.map((s) => s.imagePath) : []
    )
      .then((assets) => {
        if (!controller.signal.aborted) setReady({ ...assets, startedAt: performance.now() });
      })
      .catch(() => {
        if (!controller.signal.aborted) done.current();
      });
    return () => controller.abort();
  }, [profile, presentation.imagePath, reduced, sourceValid, fusion, relaySources]);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(
      () => done.current(),
      entranceRemaining(
        ready.startedAt,
        reduced ? entranceTimeline.reduced : portraitOffset + entranceTimeline.total
      )
    );
    return () => window.clearTimeout(timer);
  }, [ready, reduced, portraitOffset]);
  return (
    <div
      className="card-entrance-presentation"
      data-profile={profile.id}
      data-phase={ready ? 'playing' : 'loading'}
      data-double-relay={fusion || undefined}
      style={
        {
          '--entrance-art-center': profile.center,
          '--entrance-mobile-height': profile.mobileHeight,
          '--entrance-light': profile.light,
          ...entranceImpactCss,
        } as CSSProperties
      }
    >
      {fusion && (
        <DoubleRelayFusion
          sources={relaySources}
          cardPath={presentation.imagePath}
          startedAt={ready?.startedAt ?? null}
          onInvalid={() => done.current()}
        />
      )}
      {ready && (
        <>
          <CardEntrancePortrait
            profile={profile}
            image={ready.portrait}
            blinkImage={ready.blink}
            startedAt={ready.startedAt + portraitOffset}
            reduced={reduced}
            onDone={onDone}
          />
          {!reduced && (
            <CardLanding
              presentation={presentation}
              startedAt={ready.startedAt + portraitOffset}
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
