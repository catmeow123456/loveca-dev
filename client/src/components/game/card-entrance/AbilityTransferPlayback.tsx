import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getEntranceStageTarget, sameEntranceTarget } from '@/lib/cardEntranceLanding';
import { collectBattleAnimationAnchors } from '@/lib/battleAnimationEvents';
import { getBattleWaitingRoomAnchor } from '@/lib/battleUiAnchors';
import {
  DISCARD_PRESENTATION_REDUCED_MOTION_DURATION_MS,
  DISCARD_PRESENTATION_REDUCED_MOTION_FADE_MS,
} from '@/lib/battleAnimationSequencing';
import { ENTRANCE_LOAD_TIMEOUT_MS } from '@/lib/cardEntranceAssets';
import {
  flowerEase,
  ginkoFlowerTimeline,
  type AbilityTransferSource,
} from '@/lib/ginkoFlowerTransfer';

import { paintAbilityKnot } from '@/lib/ginkoKnotTransfer';

/** Public grant feedback, with the host always visible and the paid card staying in waiting. */
export function AbilityTransferPlayback({
  source,
  reduced,
  onDone,
  onReceived,
  onDismissNotice,
}: {
  source: AbilityTransferSource;
  reduced: boolean;
  onDone: () => void;
  onReceived: () => void;
  onDismissNotice: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const received = useRef(onReceived);
  received.current = onReceived;
  const dismissNotice = useRef(onDismissNotice);
  dismissNotice.current = onDismissNotice;
  const announced = useRef(false);
  const [ready, setReady] = useState<{
    startedAt: number;
    from?: { x: number; y: number };
    releaseAfter: number;
  } | null>(null);
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
    if (!source.afterDiscard) {
      // A multi-ability choice may finish after the discard has already collected.
      // Emit from the actual pile in that case; never create another copy of the face.
      setReady({ startedAt: performance.now(), releaseAfter: 0 });
      return;
    }
    let raf = 0;
    const deadline = performance.now() + ENTRANCE_LOAD_TIMEOUT_MS;
    const findReveal = (now: number) => {
      const card = document.querySelector<HTMLElement>(
        `[data-discard-presentation-object-id="${source.sourceObjectId}"]`
      );
      const revealAt = Number(
        card?.closest('[data-discard-reveal-at]')?.getAttribute('data-discard-reveal-at')
      );
      if (card && revealAt > 0 && now >= revealAt) {
        const rect = card.getBoundingClientRect();
        if (rect.width && rect.height) {
          setReady({
            startedAt: now,
            from: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
            releaseAfter: reduced
              ? revealAt +
                DISCARD_PRESENTATION_REDUCED_MOTION_DURATION_MS -
                DISCARD_PRESENTATION_REDUCED_MOTION_FADE_MS
              : 0,
          });
          return;
        }
      }
      if (now >= deadline) {
        done.current();
        return;
      }
      raf = requestAnimationFrame(findReveal);
    };
    raf = requestAnimationFrame(findReveal);
    return () => cancelAnimationFrame(raf);
  }, [source.afterDiscard, source.sourceObjectId, reduced]);
  useLayoutEffect(() => {
    if (!ready) return;
    const { startedAt } = ready;
    const layer = root.current!;
    const target = collectBattleAnimationAnchors().cards.get(source.hostObjectId);
    const wait = document
      .querySelector(`[data-battle-ui-anchor="${getBattleWaitingRoomAnchor(source.side)}"]`)
      ?.getBoundingClientRect();
    if (!target?.width || !wait?.width) {
      done.current();
      return;
    }
    const halo = layer.querySelector<HTMLElement>('.ginko-transfer-halo')!;
    const canvas = layer.querySelector('canvas')!;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      done.current();
      return;
    }
    const from = ready.from ?? { x: wait.left + wait.width / 2, y: wait.top + wait.height / 2 };
    const to = { x: target.left + target.width / 2, y: target.top + target.height / 2 };
    Object.assign(halo.style, {
      left: `${target.left}px`,
      top: `${target.top}px`,
      width: `${target.width}px`,
      height: `${target.height}px`,
    });
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const cancel = () => {
      dismissNotice.current();
      done.current();
    };
    window.addEventListener('resize', cancel);
    window.addEventListener('scroll', cancel, true);
    let raf = 0;
    const tick = (now: number) => {
      const t = ginkoFlowerTimeline.copy,
        elapsed = now - startedAt;
      const duration = reduced ? t.reduced : t.total;
      if (!announced.current && (reduced || elapsed >= t.receive)) {
        announced.current = true;
        received.current();
      }
      if (elapsed >= duration) {
        layer.style.visibility = 'hidden';
        if (now >= ready.releaseAfter) {
          done.current();
          return;
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      const finish = flowerEase((elapsed - t.receive) / (t.total - t.receive));
      layer.dataset.phase =
        reduced || elapsed >= t.receive ? 'received' : elapsed < t.extract ? 'extract' : 'transfer';
      halo.style.opacity = reduced ? '.7' : String(Math.sin(Math.PI * finish));
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (!reduced)
        paintAbilityKnot(
          ctx,
          from,
          to,
          target,
          elapsed,
          source.hostObjectId,
          source.target.orientation
        );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('scroll', cancel, true);
    };
  }, [source, reduced, ready]);
  return (
    <div
      ref={root}
      className="ginko-ability-transfer"
      role="status"
      aria-label={`获得登场能力：${source.name}`}
    >
      <canvas aria-hidden="true" />
      <div className="ginko-transfer-halo" aria-hidden="true" />
      <button
        className="card-entrance-skip"
        onClick={(e) => {
          e.stopPropagation();
          onDismissNotice();
          onDone();
        }}
      >
        跳过演出
      </button>
    </div>
  );
}
