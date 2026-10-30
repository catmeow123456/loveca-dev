import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getPublicStageMemberTarget, sameEntranceTarget } from '@/lib/cardEntranceLanding';
import { ENTRANCE_LOAD_TIMEOUT_MS } from '@/lib/cardEntranceAssets';
import type { EffectImageCache } from '@/lib/effectImageCache';
import type { IzumiReplaySource } from '@/lib/izumiReplay';
import { IzumiReplayPrelude } from './IzumiReplayPrelude';

/** Targets without a portrait finish in their real slot under the same ACK/timeout protocol. */
export function IzumiReplayPlayback({
  source,
  images,
  reduced,
  onDone,
}: {
  source: IzumiReplaySource;
  images: EffectImageCache;
  reduced: boolean;
  onDone: () => void;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const valid = useGameStore((s) =>
    sameEntranceTarget(
      source.target,
      getPublicStageMemberTarget(s.playerViewState, source.targetObjectId)
    )
  );
  useEffect(() => {
    if (!valid) {
      done.current();
      return;
    }
    if (reduced) {
      setStartedAt(performance.now());
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      cancelled = true;
      done.current();
    }, ENTRANCE_LOAD_TIMEOUT_MS);
    Promise.all(
      [source.imagePath, ...(source.hostImagePath ? [source.hostImagePath] : [])].map((url) =>
        images.load(url)
      )
    )
      .then(() => {
        if (!cancelled) {
          clearTimeout(timer);
          setStartedAt(performance.now());
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearTimeout(timer);
          done.current();
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, images, reduced, valid]);
  return (
    <div className="card-entrance-presentation" data-izumi-replay="true">
      <IzumiReplayPrelude
        source={source}
        startedAt={startedAt}
        portrait={false}
        reduced={reduced}
        onDone={onDone}
        onInvalid={onDone}
      />
      <button
        className="card-entrance-skip"
        onClick={(event) => {
          event.stopPropagation();
          onDone();
        }}
      >
        跳过演出
      </button>
    </div>
  );
}
