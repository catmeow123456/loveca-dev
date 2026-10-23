import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getEntranceStageTarget, sameEntranceTarget } from '@/lib/cardEntranceLanding';
import { collectBattleAnimationAnchors } from '@/lib/battleAnimationEvents';
import { BATTLE_UI_ANCHORS, getBattleWaitingRoomAnchor } from '@/lib/battleUiAnchors';
import { ENTRANCE_LOAD_TIMEOUT_MS } from '@/lib/cardEntranceAssets';
import type { EffectImageCache } from '@/lib/effectImageCache';
import { HEART_ICON_SOURCE_BY_COLOR } from '@/lib/modifierIconAssets';
import { getShizukuStackElement, shizukuTiming, type ShizukuRole } from '@/lib/shizukuRole';
import { ShizukuRoleScene, type ShizukuRoleLayout } from './ShizukuTheatre';

export function ShizukuRolePlayback({
  source,
  images,
  reduced,
  onDone,
}: {
  source: ShizukuRole;
  images: EffectImageCache;
  reduced: boolean;
  onDone: () => void;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState<{ elapsed: number; layout: ShizukuRoleLayout } | null>(null);
  const valid = useGameStore((s) =>
    sameEntranceTarget(
      source.target,
      s.playerViewState ? getEntranceStageTarget(s.playerViewState, source.hostObjectId) : null
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
    const fail = () => {
      if (!cancelled) {
        cancelled = true;
        done.current();
      }
    };
    const timer = setTimeout(fail, ENTRANCE_LOAD_TIMEOUT_MS);
    Promise.all(
      [
        ...new Set([
          source.imagePath,
          ...source.hearts.map((h) => HEART_ICON_SOURCE_BY_COLOR[h.color]),
        ]),
      ].map((url) => images.load(url))
    ).then(() => {
      if (!cancelled) {
        clearTimeout(timer);
        setReady(true);
      }
    }, fail);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, images, reduced]);
  useLayoutEffect(() => {
    if (reduced) return;
    const store = useGameStore.getState(),
      eventId = `shizuku-role:${source.sourceObjectId}`;
    store.addBattleAnimationOcclusions([
      { eventId, objectId: source.sourceObjectId, suppressDefaultMovement: true },
    ]);
    return () => store.removeBattleAnimationOcclusion(eventId);
  }, [source, reduced]);
  useLayoutEffect(() => {
    if (!ready || !valid) return;
    const anchor = (id: string) =>
      document.querySelector(`[data-battle-ui-anchor="${id}"]`)?.getBoundingClientRect();
    const board = anchor(BATTLE_UI_ANCHORS.BOARD),
      waiting = anchor(getBattleWaitingRoomAnchor(source.side));
    const member = collectBattleAnimationAnchors().cards.get(source.hostObjectId);
    const stacked = getShizukuStackElement(source.sourceObjectId)?.getBoundingClientRect();
    if (!board || !waiting || !member || (!reduced && !stacked)) {
      done.current();
      return;
    }
    const layout = { board, waiting, member, stacked: stacked ?? member };
    const started = performance.now();
    let raf = 0;
    let revealed = false;
    const tick = (now: number) => {
      const elapsed = now - started;
      if (elapsed >= (reduced ? shizukuTiming.reduced : shizukuTiming.role)) {
        done.current();
        return;
      }
      if (!reduced && !revealed && elapsed >= shizukuTiming.stackReveal) {
        revealed = true;
        // The scene already controls its opacity and pose. Reveal only our own
        // occlusion so the real card can emerge naturally beneath the host.
        useGameStore
          .getState()
          .removeBattleAnimationOcclusion(`shizuku-role:${source.sourceObjectId}`);
      }
      setFrame({ elapsed, layout });
      raf = requestAnimationFrame(tick);
    };
    tick(started);
    const cancel = () => done.current();
    window.addEventListener('resize', cancel);
    window.addEventListener('scroll', cancel, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('scroll', cancel, true);
    };
  }, [ready, valid, source, reduced]);
  return (
    <div
      className="shizuku-role-layer"
      role="status"
      aria-label="樱坂雫进入角色，采用所选成员的 HEART"
    >
      {frame && (
        <ShizukuRoleScene
          source={source}
          layout={frame.layout}
          elapsed={frame.elapsed}
          reduced={reduced}
        />
      )}
      <button className="card-entrance-skip" onClick={() => done.current()}>
        跳过演出
      </button>
    </div>
  );
}
