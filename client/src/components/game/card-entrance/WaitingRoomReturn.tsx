import { useLayoutEffect, useRef } from 'react';
import { getBattleDeckAnchor, getBattleWaitingRoomAnchor } from '@/lib/battleUiAnchors';
import { getCardBackUrl } from '@/lib/imageService';
import {
  waitingReturnFrame,
  waitingReturnTimeline,
  type WaitingReturnSource,
} from '@/lib/waitingReturnEntrance';

/** Previously public members turn face-down before a cosmetic shuffle and grouped bottom return. */
export function WaitingRoomReturn({
  source,
  startedAt,
  onInvalid,
}: {
  source: WaitingReturnSource;
  startedAt: number | null;
  onInvalid: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const invalid = useRef(onInvalid);
  invalid.current = onInvalid;
  useLayoutEffect(() => {
    const layer = root.current;
    const zone = (anchor: string) =>
      document.querySelector<HTMLElement>(
        `[data-battle-ui-anchor="${anchor}"] [data-animation-zone-id]`
      );
    const waiting = zone(getBattleWaitingRoomAnchor(source.side));
    const deck = zone(getBattleDeckAnchor(source.side, 'main'));
    if (!layer || !waiting || !deck) {
      invalid.current();
      return;
    }
    const from = waiting.getBoundingClientRect(),
      to = deck.getBoundingClientRect();
    if (!from.width || !to.width) {
      invalid.current();
      return;
    }
    const origin = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
    const end = { x: to.left + to.width / 2, y: to.top + to.height / 2 + to.height * 0.14 };
    const spread = Math.min(15, from.width * 0.3);
    const elements = [...layer.querySelectorAll<HTMLImageElement>('[data-return-card]')];
    const ring = layer.querySelector<HTMLElement>('.waiting-return-ring')!;
    const deckFace = layer.querySelector<HTMLElement>('.waiting-return-deck')!;
    const width = Math.min(58, from.width * 1.25);
    const fanPadding = width * 0.65 + ((elements.length - 1) * spread) / 2 + 18;
    const fanCenterX = Math.max(
      fanPadding,
      Math.min(document.documentElement.clientWidth - fanPadding, origin.x)
    );
    Object.assign(ring.style, {
      left: `${end.x}px`,
      top: `${end.y}px`,
      width: `${to.width * 2.5}px`,
      height: `${to.width * 2.5}px`,
    });
    Object.assign(deckFace.style, {
      left: `${to.left + to.width / 2}px`,
      top: `${to.top + to.height / 2}px`,
      width: `${to.width}px`,
      height: `${to.height}px`,
    });
    const originalTransform = deck.style.transform,
      originalShadow = deck.style.filter;
    const restore = () => {
      deck.style.transform = originalTransform;
      deck.style.filter = originalShadow;
    };
    let frame = 0,
      disposed = false;
    const abort = () => invalid.current();
    window.addEventListener('resize', abort);
    window.addEventListener('scroll', abort, true);
    const tick = (now: number) => {
      if (disposed) return;
      const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt);
      const batch = waitingReturnFrame(elapsed, 0, elements.length);
      layer.dataset.phase = batch.phase;
      layer.style.opacity = batch.finished ? '0' : '1';
      elements.forEach((card, i) => {
        const f = waitingReturnFrame(elapsed, i, elements.length);
        const n = i - (elements.length - 1) / 2;
        // Shuffle only anonymous backs; no per-instance identity is carried into deck positions.
        const shuffle =
          elements.length > 1 ? Math.sin(f.shuffle * Math.PI * 2) * (i % 2 ? 1 : -1) : 0;
        const fan = (1 - f.flight) * f.rise;
        const start = {
          x: origin.x + (fanCenterX - origin.x + n * spread + shuffle * 14) * fan,
          y: origin.y - (18 - Math.abs(n) * 2) * fan,
        };
        const arc = Math.min(65, Math.abs(end.x - origin.x) * 0.22 + 24);
        const x = start.x + (end.x - start.x) * f.flight;
        const y = start.y + (end.y - start.y) * f.flight - Math.sin(f.flight * Math.PI) * arc;
        const scale = 1 + f.rise * 0.2 - f.flight * 0.4;
        const turn = Math.max(0.03, Math.abs(Math.cos(f.flip * Math.PI)));
        const src = f.face ? source.facePaths[i]! : getCardBackUrl();
        if (card.getAttribute('src') !== src) card.setAttribute('src', src);
        Object.assign(card.style, {
          left: `${x}px`,
          top: `${y}px`,
          width: `${width}px`,
          height: `${width * 1.4}px`,
          opacity: String(f.opacity),
          zIndex: String(f.flight > 0.8 ? 0 : 10 + i),
          transform: `translate(-50%,-50%) rotate(${n * 7 * fan}deg) scale(${scale * turn},${scale})`,
          filter: `drop-shadow(0 ${4 + fan * 5}px ${4 + fan * 4}px #071b2377)`,
        });
      });
      const timeline = waitingReturnTimeline;
      const lift = Math.sin(
        Math.PI * Math.min(1, Math.max(0, (elapsed - timeline.deckLiftAt) / timeline.deckLift))
      );
      deck.style.transform = `${originalTransform} scale(${1 + lift * 0.09})`;
      deck.style.filter = `${originalShadow} drop-shadow(0 ${lift * 7}px ${lift * 6}px #061b2580)`;
      // This public card-back cover lets the incoming anonymous cards visibly slip underneath.
      deckFace.style.opacity = elapsed > timeline.flyAt && !batch.finished ? '1' : '0';
      deckFace.style.transform = `translate(-50%,-50%) scale(${1 + lift * 0.09})`;
      const pulse = Math.min(1, Math.max(0, (elapsed - timeline.ringAt) / timeline.ring));
      ring.style.opacity = String(Math.sin(pulse * Math.PI) * 0.7);
      ring.style.transform = `translate(-50%,-50%) scale(${0.5 + pulse * 0.75})`;
      if (!batch.finished) frame = requestAnimationFrame(tick);
      else restore();
    };
    tick(performance.now());
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      restore();
      window.removeEventListener('resize', abort);
      window.removeEventListener('scroll', abort, true);
    };
  }, [source, startedAt]);
  return (
    <div
      ref={root}
      className="waiting-return-entrance"
      data-testid="waiting-return-entrance"
      aria-hidden="true"
    >
      {source.facePaths.map((src, i) => (
        <img key={i} data-return-card={i} src={src} alt="" draggable={false} />
      ))}
      <img className="waiting-return-deck" src={getCardBackUrl()} alt="" draggable={false} />
      <div className="waiting-return-ring" />
    </div>
  );
}
