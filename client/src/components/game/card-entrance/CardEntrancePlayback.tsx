import { RinaEntranceVisuals } from './rina-sec/RinaEntranceVisuals';
import { rinaSecTiming } from './rina-sec/rinaSecTimeline';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CardEntranceProfile } from '@/lib/cardEntranceProfiles';
import { prepareEntranceAssets } from '@/lib/cardEntranceAssets';
import { entranceTimeline, entranceRemaining } from '@/lib/cardEntranceTimeline';
import { DoubleRelayFusion } from './DoubleRelayFusion';
import { GinkoFlowerPrelude } from './GinkoFlowerPrelude';
import { ginkoFlowerTimeline } from '@/lib/ginkoFlowerTransfer';
import { doubleRelayTimeline, type DoubleRelaySource } from '@/lib/doubleRelayEntrance';
import { waitingReturnTimeline, type WaitingReturnSource } from '@/lib/waitingReturnEntrance';
import { getCardBackUrl } from '@/lib/imageService';
import { WaitingRoomReturn } from './WaitingRoomReturn';
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
  waitingReturn,
  kahoSource,
  onPreludeDone,
  onImpact,
  onDone,
}: {
  presentation: LandingPresentation;
  profile: CardEntranceProfile;
  reduced: boolean;
  relaySources?: readonly DoubleRelaySource[];
  waitingReturn?: WaitingReturnSource;
  kahoSource?: DoubleRelaySource;
  onPreludeDone?: () => void;
  onImpact: () => void;
  onDone: () => void;
}) {
  const rina = profile.id === 'rina';
  const fusion = !reduced && relaySources.length === 2;
  const returning = !reduced && !!waitingReturn;
  const [preludeDone, setPreludeDone] = useState(false);
  const kahoRelay = !reduced && !!kahoSource;
  const kahoTiming = ginkoFlowerTimeline.relay;
  const portraitOffset = rina
    ? rinaSecTiming.portraitAt
    : kahoRelay
      ? kahoTiming.portraitAt
      : returning
        ? waitingReturnTimeline.portraitAt
        : fusion
          ? doubleRelayTimeline.portraitAt
          : 0;
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
      kahoRelay
        ? [kahoSource.imagePath]
        : returning
          ? [...waitingReturn.facePaths, getCardBackUrl()]
          : fusion
            ? relaySources.map((s) => s.imagePath)
            : []
    )
      .then((assets) => {
        if (!controller.signal.aborted) setReady({ ...assets, startedAt: performance.now() });
      })
      .catch(() => {
        if (!controller.signal.aborted) done.current();
      });
    return () => controller.abort();
  }, [
    profile,
    presentation.imagePath,
    reduced,
    sourceValid,
    fusion,
    relaySources,
    returning,
    waitingReturn,
    kahoRelay,
    kahoSource,
  ]);
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
      data-kaho-relay={kahoRelay || undefined}
      style={
        {
          '--entrance-art-center': profile.center,
          '--entrance-mobile-height': profile.mobileHeight,
          '--entrance-light': profile.light,
        } as CSSProperties
      }
    >
      {kahoRelay && !preludeDone && (
        <GinkoFlowerPrelude
          source={kahoSource}
          startedAt={ready?.startedAt ?? null}
          onDone={() => {
            setPreludeDone(true);
            onPreludeDone?.();
          }}
          onInvalid={() => done.current()}
        />
      )}
      {returning && (
        <WaitingRoomReturn
          source={waitingReturn}
          startedAt={ready?.startedAt ?? null}
          onInvalid={() => done.current()}
        />
      )}
      {fusion && !returning && (
        <DoubleRelayFusion
          sources={relaySources}
          cardPath={presentation.imagePath}
          startedAt={ready?.startedAt ?? null}
          onInvalid={() => done.current()}
        />
      )}
      {ready &&
        (rina ? (
          <RinaEntranceVisuals
            target={presentation.target}
            profile={profile}
            ready={ready}
            reduced={reduced}
            onImpact={onImpact}
            onDone={onDone}
          />
        ) : (
          <>
            <CardEntrancePortrait
              profile={profile}
              image={ready.portrait}
              blinkImage={ready.blink}
              startedAt={ready.startedAt + portraitOffset}
              reduced={reduced}
              preludeRevealMs={kahoRelay ? kahoTiming.portraitAt - kahoTiming.arrive : 0}
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
        ))}
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
