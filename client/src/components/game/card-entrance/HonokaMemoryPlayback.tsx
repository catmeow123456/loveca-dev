import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getEntranceStageTarget, sameEntranceTarget } from '@/lib/cardEntranceLanding';
import { collectBattleAnimationAnchors } from '@/lib/battleAnimationEvents';
import {
  BATTLE_UI_ANCHORS,
  getBattleHandAnchor,
  getBattleLiveZoneAnchor,
  getBattleSuccessLiveZoneAnchor,
  getBattleWaitingRoomAnchor,
} from '@/lib/battleUiAnchors';
import { ENTRANCE_LOAD_TIMEOUT_MS } from '@/lib/cardEntranceAssets';
import type { HonokaMemoryPresentation } from '@/lib/honokaMemoryPresentation';
import { HonokaMemoryStage } from './honoka-memory-stage/HonokaMemoryStage';
import {
  memoryDuration,
  type MemoryLayout,
  type MemoryRect,
} from './honoka-memory-stage/honokaMemoryTimeline';

const rect = (r?: {
  left: number;
  top: number;
  width: number;
  height: number;
}): MemoryRect | undefined =>
  r?.width && r.height ? { x: r.left, y: r.top, width: r.width, height: r.height } : undefined;
const anchor = (id: string) =>
  rect(document.querySelector(`[data-battle-ui-anchor="${id}"]`)?.getBoundingClientRect());

/** Shared barrier owns synchronization; this component only owns its current visual window. */
export function HonokaMemoryPlayback({
  presentation,
  reduced,
  onDone,
}: {
  presentation: HonokaMemoryPresentation;
  reduced: boolean;
  onDone: () => void;
}) {
  const { cue, target, side } = presentation;
  const done = useRef(onDone);
  done.current = onDone;
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState<{ elapsed: number; layout: MemoryLayout } | null>(null);
  const valid = useGameStore((s) =>
    sameEntranceTarget(
      target,
      s.playerViewState ? getEntranceStageTarget(s.playerViewState, target.objectId) : null
    )
  );
  useEffect(() => {
    if (!valid) done.current();
  }, [valid]);

  useEffect(() => {
    if (reduced) {
      setReady(true);
      return;
    }
    let cancelled = false;
    const images = [
      ...new Set([...cue.memories, ...(cue.recovered ? [cue.recovered] : [])].map((f) => f.image)),
    ].map((url) => {
      const image = new Image();
      image.src = url;
      return image;
    });
    const timeout = setTimeout(() => {
      if (!cancelled) done.current();
    }, ENTRANCE_LOAD_TIMEOUT_MS);
    Promise.all(images.map((image) => image.decode())).then(
      () => {
        if (!cancelled) {
          clearTimeout(timeout);
          setReady(true);
        }
      },
      () => {
        if (!cancelled) done.current();
      }
    );
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      for (const image of images) image.removeAttribute('src');
    };
  }, [cue, reduced]);

  useLayoutEffect(() => {
    if (reduced || !cue.recovered) return;
    const store = useGameStore.getState();
    const eventId = `honoka-memory:${cue.id}:${cue.recovered.objectId}`;
    store.addBattleAnimationOcclusions([
      { eventId, objectId: cue.recovered.objectId, suppressDefaultMovement: true },
    ]);
    return () => store.removeBattleAnimationOcclusion(eventId);
  }, [cue, reduced]);

  useLayoutEffect(() => {
    if (!ready || !valid) return;
    let raf = requestAnimationFrame(() => {
      const cards = collectBattleAnimationAnchors().cards;
      const board = anchor(BATTLE_UI_ANCHORS.BOARD);
      const member = rect(cards.get(target.objectId));
      const success = anchor(getBattleSuccessLiveZoneAnchor(side));
      const live = anchor(getBattleLiveZoneAnchor(side));
      const waiting = anchor(getBattleWaitingRoomAnchor(side));
      // The opponent's recovered card remains hidden; target the public hand zone only.
      const hand =
        (side === 'self' && cue.recovered ? rect(cards.get(cue.recovered.objectId)) : undefined) ??
        anchor(getBattleHandAnchor(side));
      if (!board || !member || !success || !live || !waiting || !hand) {
        done.current();
        return;
      }
      const layout = { board, member, success, live, waiting, hand, sourceSide: side };
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = now - start;
        if (elapsed >= memoryDuration(cue, reduced)) {
          done.current();
          return;
        }
        setFrame({ elapsed, layout });
        raf = requestAnimationFrame(tick);
      };
      tick(start);
    });
    const cancel = () => done.current();
    window.addEventListener('resize', cancel);
    window.addEventListener('scroll', cancel, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('scroll', cancel, true);
    };
  }, [ready, valid, cue, target, side, reduced]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[69]">
      {frame && (
        <HonokaMemoryStage
          cue={cue}
          elapsed={frame.elapsed}
          layout={frame.layout}
          reduced={reduced}
        />
      )}
      <button type="button" className="card-entrance-skip" onClick={() => done.current()}>
        跳过演出
      </button>
    </div>
  );
}
