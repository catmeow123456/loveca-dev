import { useEffect, useLayoutEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { cardEntranceProfiles, getCardEntranceProfile } from '@/lib/cardEntranceProfiles';
import { preloadEntranceProfiles } from '@/lib/cardEntrancePreload';
import { getEntranceStageTarget } from '@/lib/cardEntranceLanding';
import { CardEntrancePlayback } from './CardEntrancePlayback';
import type { PlayerViewState } from '@game/online/types';
import { getDoubleRelaySources } from '@/lib/doubleRelayEntrance';
import './cardEntrance.css';

export function CardEntranceLayer({ enabled }: { enabled: boolean }) {
  const view = useGameStore((s) => s.playerViewState);
  const wait = view?.match.entrance;
  const contextKey = `${view?.match.matchId}:${view?.match.viewerSeat}`;
  // A content key avoids restarting on every snapshot/ACK. The board already gates eligible modes.
  const preloadKey =
    enabled && view && !view.match.endInfo
      ? JSON.stringify(view.match.entranceAssetIds ?? [])
      : '[]';
  const matchId = view?.match.matchId;
  useEffect(() => {
    const ids = new Set<string>(JSON.parse(preloadKey));
    if (!ids.size) return;
    return preloadEntranceProfiles(cardEntranceProfiles.filter((profile) => ids.has(profile.id)));
  }, [matchId, preloadKey]);
  return view && wait && !view.match.endInfo ? (
    <SynchronizedEntrance key={`${contextKey}:${wait.id}`} view={view} enabled={enabled} />
  ) : null;
}

function SynchronizedEntrance({ view, enabled }: { view: PlayerViewState; enabled: boolean }) {
  const wait = view.match.entrance!;
  const viewerWaiting = wait.waitingSeats.includes(view.match.viewerSeat);
  const reduced = !!useReducedMotion();
  // Snapshot only public, already-present stage cards. No historical event replay on mount.
  const [queue] = useState(() =>
    wait.objectIds.flatMap((objectId) => {
      const target = getEntranceStageTarget(view, objectId);
      const profile = target && getCardEntranceProfile(target.cardCode);
      return target && profile
        ? [
            {
              id: `${wait.id}:${objectId}`,
              target,
              profile,
              imagePath: useGameStore.getState().getCardImagePath(target.cardCode),
              relaySources: getDoubleRelaySources(
                view,
                objectId,
                useGameStore.getState().getCardImagePath
              ),
            },
          ]
        : [];
    })
  );
  const [index, setIndex] = useState(0);
  const [landedId, setLandedId] = useState<string | null>(null);
  const active = enabled && viewerWaiting ? queue[index] : undefined;
  const done = !active;

  useEffect(() => {
    if (!done || !viewerWaiting) return;
    const acknowledge = () => useGameStore.getState().acknowledgeCardEntrance(wait.id);
    acknowledge();
    // Retry a lost response with the same barrier token; authority validates the participant.
    const timer = window.setInterval(acknowledge, 1000);
    return () => window.clearInterval(timer);
  }, [done, viewerWaiting, wait.id]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => useGameStore.getState().expireLocalCardEntrance(),
      Math.max(0, wait.deadlineAt - Date.now()) + 20
    );
    return () => window.clearTimeout(timer);
  }, [wait.deadlineAt]);

  useLayoutEffect(() => {
    const candidates = enabled && viewerWaiting && !reduced ? queue.slice(index) : [];
    const ids = candidates
      .filter((p) => p.id !== landedId)
      .flatMap((p) =>
        [p.target.objectId, ...p.relaySources.map((s) => s.objectId)].map((objectId) => ({
          eventId: `entrance:${p.id}:${objectId}`,
          objectId,
          suppressDefaultMovement: true,
        }))
      );
    const store = useGameStore.getState();
    store.addBattleAnimationOcclusions(ids);
    return () => {
      for (const { eventId } of ids) store.removeBattleAnimationOcclusion(eventId);
    };
  }, [enabled, viewerWaiting, reduced, queue, index, landedId]);

  return (
    <>
      <div className="absolute inset-0 z-[59]" aria-hidden="true" />
      {active ? (
        <CardEntrancePlayback
          key={active.id}
          presentation={active}
          profile={active.profile}
          relaySources={active.relaySources}
          reduced={reduced}
          onImpact={() => setLandedId(active.id)}
          onDone={() => setIndex((current) => (current === index ? current + 1 : current))}
        />
      ) : (
        <div
          role="status"
          className="absolute left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-slate-950/85 px-5 py-3 text-white shadow-lg"
        >
          等待对方演出结束
        </div>
      )}
    </>
  );
}
