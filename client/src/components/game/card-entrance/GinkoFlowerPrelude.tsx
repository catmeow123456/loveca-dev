import { useLayoutEffect, useRef } from 'react';
import { getBattleStageAnchor, getBattleWaitingRoomAnchor } from '@/lib/battleUiAnchors';
import { getLandingCardGeometry } from '@/lib/cardEntranceLanding';
import type { DoubleRelaySource } from '@/lib/doubleRelayEntrance';
import {
  flowerEase,
  ginkoFlowerTimeline,
  paintKahoFlowerRelay,
  createKahoPetals,
} from '@/lib/ginkoFlowerTransfer';

export function GinkoFlowerPrelude({
  source,
  startedAt,
  onDone,
  onInvalid,
}: {
  source: DoubleRelaySource;
  startedAt: number | null;
  onDone: () => void;
  onInvalid: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onDone, onInvalid });
  callbacks.current = { onDone, onInvalid };
  useLayoutEffect(() => {
    if (startedAt === null) return;
    const layer = root.current!;
    const stage = document.querySelector(
      `[data-battle-ui-anchor="${getBattleStageAnchor(source.side, source.slot.toLowerCase() as 'left' | 'center' | 'right')}"]`
    );
    const waiting = document.querySelector(
      `[data-battle-ui-anchor="${getBattleWaitingRoomAnchor(source.side)}"]`
    );
    const portrait = layer.parentElement?.querySelector('.card-entrance-art');
    const stageRect = stage?.firstElementChild?.getBoundingClientRect();
    const waitRect = waiting?.getBoundingClientRect();
    const portraitRect = portrait?.getBoundingClientRect();
    const face = layer.querySelector('img')!;
    const backdrop = layer.querySelector<HTMLElement>('.ginko-relay-backdrop')!;
    const canvas = layer.querySelector('canvas')!;
    const ctx = canvas.getContext('2d');
    if (!stageRect?.width || !waitRect?.width || !portraitRect?.width || !ctx) {
      callbacks.current.onInvalid();
      return;
    }
    const geometry = getLandingCardGeometry(stageRect, source.orientation);
    const from = { x: geometry.x, y: geometry.y };
    const petals = createKahoPetals();
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    Object.assign(face.style, { width: `${geometry.width}px`, height: `${geometry.height}px` });
    const invalid = () => callbacks.current.onInvalid();
    window.addEventListener('resize', invalid);
    window.addEventListener('scroll', invalid, true);
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - startedAt,
        t = ginkoFlowerTimeline.relay;
      if (elapsed >= t.portraitAt) {
        callbacks.current.onDone();
        return;
      }
      layer.dataset.phase =
        elapsed < t.charge ? 'charge' : elapsed < t.arrive ? 'travel' : 'receive';
      const departure = flowerEase((elapsed - t.charge) / 350);
      const revealAt = t.arrive;
      const arrival = flowerEase((elapsed - revealAt) / (t.portraitAt - revealAt));
      const x = from.x + (waitRect.left + waitRect.width / 2 - from.x) * departure;
      const y = from.y + (waitRect.top + waitRect.height / 2 - from.y) * departure;
      face.style.left = `${x}px`;
      face.style.top = `${y}px`;
      face.style.transform = `translate(-50%, -50%) rotate(${geometry.rotation * (1 - departure)}deg) scale(${1 - departure * 0.3})`;
      face.style.opacity = String(1 - flowerEase((elapsed - 520) / 80));
      face.style.boxShadow = 'none';
      backdrop.style.opacity = String(1 - arrival);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      paintKahoFlowerRelay(ctx, from, portraitRect, petals, elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', invalid);
      window.removeEventListener('scroll', invalid, true);
    };
  }, [source, startedAt]);
  return (
    <div ref={root} className="ginko-flower-prelude" aria-hidden="true">
      <div className="ginko-relay-backdrop" />
      <img src={source.imagePath} alt="" />
      <canvas />
    </div>
  );
}
