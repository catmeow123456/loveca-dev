import { useContext, useEffect, useRef, useState } from 'react';
import { MotionConfigContext } from 'framer-motion';
import { EffectImageCache } from '@/lib/effectImageCache';
import { prepareMiraiImages } from './miraiLoading';
import { MIRAI_DURATION, miraiCover, type MiraiReturnPresentation } from '@/lib/miraiReturn';
import { MODIFIER_ICON_SOURCE } from '@/lib/modifierIconAssets';
import {
  BATTLE_UI_ANCHORS,
  getBattleDeckAnchor,
  getBattleWaitingRoomAnchor,
} from '@/lib/battleUiAnchors';
import { collectBattleAnimationAnchors } from '@/lib/battleAnimationEvents';
import { drawMirai, type Rect } from './miraiDrawing';

const rect = (r?: {
  left: number;
  top: number;
  width: number;
  height: number;
}): Rect | undefined =>
  r?.width && r.height ? { x: r.left, y: r.top, width: r.width, height: r.height } : undefined;
const anchor = (id: string) =>
  rect(document.querySelector(`[data-battle-ui-anchor="${id}"]`)?.getBoundingClientRect());

/** Shared production renderer; holdAt/timeScale are supplied only by the isolated visual review. */
export function MiraiReturnPlayback({
  source,
  images,
  reduced: deviceReduced,
  onDone,
  holdAt,
  timeScale = 1,
}: {
  source: MiraiReturnPresentation;
  images: EffectImageCache;
  reduced: boolean;
  onDone: () => void;
  holdAt?: number;
  timeScale?: number;
}) {
  const motionConfig = useContext(MotionConfigContext);
  const reduced = deviceReduced || motionConfig.reducedMotion === 'always';
  const canvas = useRef<HTMLCanvasElement>(null),
    done = useRef(onDone);
  done.current = onDone;
  const [loaded, setLoaded] = useState<HTMLImageElement[] | null>(null);
  useEffect(() => {
    if (reduced) {
      setLoaded([]);
      return;
    }
    const controller = new AbortController();
    prepareMiraiImages(
      images,
      [miraiCover, ...source.members.map((m) => m.image), MODIFIER_ICON_SOURCE.blade],
      controller.signal
    ).then(
      (list) => {
        if (!controller.signal.aborted) setLoaded(list);
      },
      () => {
        if (!controller.signal.aborted) done.current();
      }
    );
    return () => controller.abort();
  }, [source, images, reduced]);
  useEffect(() => {
    const el = canvas.current,
      ctx = el?.getContext('2d');
    if (!el || !ctx || !loaded) return;
    let raf = requestAnimationFrame(() => {
      const board = anchor(BATTLE_UI_ANCHORS.BOARD),
        waiting = anchor(getBattleWaitingRoomAnchor(source.side)),
        deck = anchor(getBattleDeckAnchor(source.side, 'main'));
      if (!board || !waiting || !deck) {
        done.current();
        return;
      }
      const anchors = collectBattleAnimationAnchors().cards;
      const targets = source.targets.flatMap((id) => {
        const r = rect(anchors.get(id));
        return r ? [r] : [];
      });
      const dpr = Math.min(devicePixelRatio || 1, 2);
      el.width = innerWidth * dpr;
      el.height = innerHeight * dpr;
      const start = performance.now();
      const tick = (now: number) => {
        const elapsed = holdAt ?? (now - start) * timeScale;
        if (holdAt === undefined && elapsed >= (reduced ? 550 : MIRAI_DURATION)) {
          done.current();
          return;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        drawMirai(
          ctx,
          elapsed,
          { board, waiting, deck, targets },
          loaded[0],
          loaded.slice(1, 10),
          loaded[10],
          reduced
        );
        if (holdAt === undefined) raf = requestAnimationFrame(tick);
      };
      tick(start);
    });
    const stop = () => done.current();
    window.addEventListener('resize', stop);
    window.addEventListener('scroll', stop, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', stop);
      window.removeEventListener('scroll', stop, true);
    };
  }, [source, loaded, reduced, holdAt, timeScale]);
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[69]"
      role="status"
      aria-label="未来音 · 九音归途"
    >
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
      <button className="card-entrance-skip" onClick={() => done.current()}>
        {holdAt === undefined ? '跳过演出' : '关闭定格'}
      </button>
    </div>
  );
}
