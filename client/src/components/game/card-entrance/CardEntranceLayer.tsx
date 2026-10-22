import { getRinaLiveSwapSource } from '@/lib/rinaLiveSwap';
import { RinaLivePlayback } from './rina-sec/RinaLivePlayback';
import { useCardEntranceBarrier, useWindowVisualEligibility } from '../BattleRuntime';
import { useTextPresentation } from '@/lib/appPresentation';
import { useEffect, useLayoutEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { cardEntranceProfiles, getCardEntranceProfile } from '@/lib/cardEntranceProfiles';
import { preloadEntranceProfiles } from '@/lib/cardEntrancePreload';
import { getEntranceStageTarget } from '@/lib/cardEntranceLanding';
import { CardEntrancePlayback } from './CardEntrancePlayback';
import type { PlayerViewState } from '@game/online/types';
import { getDoubleRelaySources } from '@/lib/doubleRelayEntrance';
import { getWaitingReturnSource } from '@/lib/waitingReturnEntrance';
import { getAbilityTransferSource, getKahoRelaySource } from '@/lib/ginkoFlowerTransfer';
import { AbilityTransferPlayback } from './AbilityTransferPlayback';
import { getHonokaMemoryPresentation } from '@/lib/honokaMemoryPresentation';
import { HonokaMemoryPlayback } from './HonokaMemoryPlayback';
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
  const textOnly = useTextPresentation();
  const playVisuals = useWindowVisualEligibility(wait.id, enabled);
  const viewerWaiting = wait.waitingSeats.includes(view.match.viewerSeat);
  const reduced = !!useReducedMotion();
  const [transfer] = useState(() =>
    getAbilityTransferSource(view, useGameStore.getState().getCardImagePath)
  );
  const [rinaSwap] = useState(() =>
    getRinaLiveSwapSource(view, useGameStore.getState().getCardImagePath)
  );
  const [swapDone, setSwapDone] = useState(false);
  const activeSwap = playVisuals && viewerWaiting && !swapDone ? rinaSwap : undefined;
  const [memory] = useState(() =>
    getHonokaMemoryPresentation(view, useGameStore.getState().getCardImagePath)
  );
  // Snapshot only public, already-present stage cards. No historical event replay on mount.
  const [queue] = useState(() =>
    (wait.abilityTransfer || wait.rinaLiveSwap || wait.honokaMemory ? [] : wait.objectIds).flatMap(
      (objectId) => {
        const target = getEntranceStageTarget(view, objectId);
        const profile = target && getCardEntranceProfile(target.cardCode);
        return target && profile
          ? [
              {
                id: `${wait.id}:${objectId}`,
                target,
                profile,
                imagePath: useGameStore.getState().getCardImagePath(target.cardCode),
                kahoSource: getKahoRelaySource(
                  view,
                  objectId,
                  useGameStore.getState().getCardImagePath
                ),
                waitingReturn: getWaitingReturnSource(
                  view,
                  objectId,
                  useGameStore.getState().getCardImagePath
                ),
                relaySources: getDoubleRelaySources(
                  view,
                  objectId,
                  useGameStore.getState().getCardImagePath
                ),
              },
            ]
          : [];
      }
    )
  );
  const [index, setIndex] = useState(0);
  const [landedId, setLandedId] = useState<string | null>(null);
  const [releasedPreludeId, setReleasedPreludeId] = useState<string | null>(null);
  const [transferDone, setTransferDone] = useState(false);
  const [memoryDone, setMemoryDone] = useState(false);
  const activeMemory = playVisuals && viewerWaiting && !memoryDone ? memory : undefined;
  const activeTransfer = playVisuals && viewerWaiting && !transferDone ? transfer : undefined;
  const active = playVisuals && viewerWaiting ? queue[index] : undefined;
  const done = !active && !activeTransfer && !activeSwap && !activeMemory;

  useCardEntranceBarrier(view, done);

  useLayoutEffect(() => {
    const candidates = playVisuals && viewerWaiting && !reduced ? queue.slice(index) : [];
    const ids = candidates
      .filter((p) => p.id !== landedId)
      .flatMap((p) =>
        [
          p.target.objectId,
          ...p.relaySources.map((s) => s.objectId),
          ...(p.kahoSource && releasedPreludeId !== p.id ? [p.kahoSource.objectId] : []),
          ...(p.waitingReturn?.objectIds ?? []),
        ].map((objectId) => ({
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
  }, [playVisuals, viewerWaiting, reduced, queue, index, landedId, releasedPreludeId]);

  useLayoutEffect(() => {
    if (!activeSwap || reduced) return;
    const store = useGameStore.getState();
    const eventId = `entrance:${wait.id}:rina-live`;
    store.addBattleAnimationOcclusions([
      { eventId, objectId: activeSwap.liveObjectId, suppressDefaultMovement: true },
    ]);
    return () => store.removeBattleAnimationOcclusion(eventId);
  }, [activeSwap, reduced, wait.id]);

  if (textOnly) return null;
  return (
    <>
      <div className="absolute inset-0 z-[59]" aria-hidden="true" />
      {activeSwap ? (
        <RinaLivePlayback source={activeSwap} reduced={reduced} onDone={() => setSwapDone(true)} />
      ) : activeMemory ? (
        <HonokaMemoryPlayback
          presentation={activeMemory}
          reduced={reduced}
          onDone={() => setMemoryDone(true)}
        />
      ) : activeTransfer ? (
        <AbilityTransferPlayback
          source={activeTransfer}
          reduced={reduced}
          onDone={() => setTransferDone(true)}
        />
      ) : active ? (
        <CardEntrancePlayback
          key={active.id}
          presentation={active}
          profile={active.profile}
          relaySources={active.relaySources}
          waitingReturn={active.waitingReturn}
          kahoSource={active.kahoSource}
          onPreludeDone={() => setReleasedPreludeId(active.id)}
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
