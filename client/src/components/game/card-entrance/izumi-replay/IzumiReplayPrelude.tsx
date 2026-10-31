import { useLayoutEffect, useRef } from 'react';
import { useGameStore } from '@/store/gameStore';
import { getBattleWaitingRoomAnchor } from '@/lib/battleUiAnchors';
import { OrientationState } from '@game/shared/types/enums';
import { izumiReplayTiming as t, type IzumiReplaySource } from '@/lib/izumiReplay';
import { arc, clamp, ease, paintIzumiMoonlight } from './izumiReplayDrawing';
import './izumiReplay.css';

/** Rotation may still be transitioning after the atomic replay has already turned the member active. */
function measureReplayCard(objectId: string, orientation: OrientationState) {
  const card = document.querySelector<HTMLElement>(
    `.battle-card-slot [data-card-surface][data-object-id="${CSS.escape(objectId)}"]`
  );
  if (!card) return null;
  const rect = card.getBoundingClientRect();
  const style = getComputedStyle(card);
  // The painted bounding box grows during a quarter turn; only its centre is useful here.
  let width = Number.parseFloat(style.width),
    height = Number.parseFloat(style.height);
  if (!(width > 0 && height > 0)) return null;
  // Narrow boards fit waiting cards to the column. Reuse that CSS constraint for the old
  // pose even though the authoritative replay has already restored the active card layout.
  if (
    orientation === OrientationState.WAITING &&
    style.getPropertyValue('--battle-mobile-waiting-card-width')
  ) {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:absolute;visibility:hidden;pointer-events:none;height:0;width:min(100%,var(--battle-mobile-waiting-card-width))';
    card.parentElement!.append(probe);
    const waitingWidth = Number.parseFloat(getComputedStyle(probe).width);
    probe.remove();
    if (waitingWidth > 0 && waitingWidth < width) {
      height *= waitingWidth / width;
      width = waitingWidth;
    }
  }
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width,
    height,
    rotation: orientation === OrientationState.WAITING ? 90 : 0,
  };
}

/** One visual clock shared with the following portrait. No command or rule mutation here. */
export function IzumiReplayPrelude({
  source,
  startedAt,
  portrait,
  reduced,
  onDone,
  onInvalid,
}: {
  source: IzumiReplaySource;
  startedAt: number | null;
  portrait: boolean;
  reduced: boolean;
  onDone: () => void;
  onInvalid: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onDone, onInvalid });
  callbacks.current = { onDone, onInvalid };
  useLayoutEffect(() => {
    const layer = root.current!;
    const target = measureReplayCard(source.targetObjectId, source.target.orientation);
    const original = measureReplayCard(source.targetObjectId, source.previousOrientation);
    const waitRect = document
      .querySelector(`[data-battle-ui-anchor="${getBattleWaitingRoomAnchor(source.side)}"]`)
      ?.getBoundingClientRect();
    const board = document
      .querySelector('[data-battle-ui-anchor="battle-board"]')
      ?.getBoundingClientRect();
    const ctx = layer.querySelector('canvas')!.getContext('2d');
    if (!target || !original || !waitRect?.width || !board?.width || !ctx) {
      callbacks.current.onInvalid();
      return;
    }
    const host = source.host
      ? measureReplayCard(source.sourceObjectId, source.host.orientation)
      : null;
    const waiting = {
      x: waitRect.left + waitRect.width / 2,
      y: waitRect.top + waitRect.height / 2,
    };
    const center = { x: board.left + board.width / 2, y: board.top + board.height * 0.43 };
    const destination = portrait ? center : target;
    const face = layer.querySelector<HTMLElement>('.izumi-replay-target')!;
    const sourceFace = layer.querySelector<HTMLElement>('.izumi-replay-host');
    const shadow = layer.querySelector<HTMLElement>('.izumi-replay-shadow')!;
    const size = original.height;
    const dpr = Math.min(2, devicePixelRatio || 1);
    ctx.canvas.width = Math.round(innerWidth * dpr);
    ctx.canvas.height = Math.round(innerHeight * dpr);
    ctx.scale(dpr, dpr);
    Object.assign(face.style, { width: `${original.width}px`, height: `${original.height}px` });
    Object.assign(shadow.style, { width: `${original.width}px`, height: `${original.height}px` });
    const store = useGameStore.getState(),
      hostEvent = `izumi-host:${source.targetObjectId}:${source.sourceObjectId}`;
    if (host && sourceFace && !reduced) {
      Object.assign(sourceFace.style, {
        width: `${host.width}px`,
        height: `${host.height}px`,
        left: `${host.x}px`,
        top: `${host.y}px`,
      });
      if (startedAt !== null)
        store.addBattleAnimationOcclusions([
          { eventId: hostEvent, objectId: source.sourceObjectId, suppressDefaultMovement: true },
        ]);
    }
    let raf = 0,
      hostReleased = false;
    const releaseHost = () => {
      if (!hostReleased) {
        store.removeBattleAnimationOcclusion(hostEvent);
        hostReleased = true;
      }
    };
    const invalid = () => callbacks.current.onInvalid();
    const tick = (now: number) => {
      const ms = startedAt === null ? 0 : Math.max(0, now - startedAt);
      const end = reduced ? t.reduced : t.end;
      if (startedAt !== null && ms >= end) {
        layer.style.display = 'none';
        releaseHost();
        callbacks.current.onDone();
        return;
      }
      layer.dataset.phase =
        startedAt === null
          ? 'loading'
          : ms < t.invite
            ? 'invite'
            : ms < t.bow
              ? 'bow'
              : ms < t.returnAt
                ? 'depart'
                : 'return';
      const bow = Math.sin(Math.PI * clamp((ms - t.invite) / (t.bow - t.invite)));
      const retreat = ease((ms - t.bow) / (t.waiting - t.bow));
      const arrival = ease((ms - t.returnAt) / (end - t.returnAt));
      const small = Math.min(0.48, waitRect.width / original.width);
      const returning = ms >= t.returnAt;
      const point = returning
        ? arc(waiting, destination, arrival, size * 0.45)
        : arc(target, waiting, retreat, size * 0.18);
      const scale = returning
        ? small + ((portrait ? 1.2 : target.width / original.width) - small) * arrival
        : 1 - (1 - small) * retreat;
      const rotation = returning
        ? 0
        : (source.previousOrientation === OrientationState.WAITING ? 90 : 0) * (1 - retreat);
      const alpha = reduced ? 0 : portrait && returning ? 1 - ease((arrival - 0.55) / 0.45) : 1;
      Object.assign(face.style, {
        left: `${point.x}px`,
        top: `${point.y - bow * 8}px`,
        opacity: String(alpha),
        transform: `translate(-50%,-50%) perspective(700px) rotate(${rotation}deg) rotateX(${bow * 12 - Math.sin(arrival * Math.PI) * 8}deg) rotateY(${-bow * 7}deg) scale(${scale})`,
      });
      Object.assign(shadow.style, {
        left: `${point.x + bow * 4}px`,
        top: `${point.y + 8 + bow * 7}px`,
        opacity: String(alpha * 0.24),
        transform: `translate(-50%,-50%) rotate(${rotation}deg) scale(${scale * 0.95})`,
        filter: `blur(${4 + bow * 5}px)`,
      });
      if (sourceFace && host) {
        const lift = Math.sin(Math.PI * clamp(ms / t.bow));
        sourceFace.style.opacity = startedAt !== null && !reduced && ms < t.bow ? '1' : '0';
        sourceFace.style.transform = `translate(-50%,calc(-50% - ${lift * 7}px)) perspective(700px) rotate(${host.rotation}deg) rotateX(${lift * 7}deg)`;
        if (ms >= t.bow || reduced) releaseHost();
      }
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      if (startedAt !== null)
        paintIzumiMoonlight(
          ctx,
          ms,
          { host: host ?? target, stage: target, waiting, destination, size },
          portrait,
          reduced
        );
      raf = requestAnimationFrame(tick);
    };
    tick(performance.now());
    window.addEventListener('resize', invalid);
    window.addEventListener('scroll', invalid, true);
    return () => {
      cancelAnimationFrame(raf);
      releaseHost();
      window.removeEventListener('resize', invalid);
      window.removeEventListener('scroll', invalid, true);
    };
  }, [source, startedAt, portrait, reduced]);
  return (
    <div
      ref={root}
      className="izumi-replay-prelude"
      aria-label="桂城泉月下邀演"
      data-portrait={portrait}
    >
      <canvas aria-hidden="true" />
      <div className="izumi-replay-shadow" />
      {source.hostImagePath && (
        <img className="izumi-replay-host" src={source.hostImagePath} alt="" />
      )}
      <img className="izumi-replay-target" src={source.imagePath} alt="" />
    </div>
  );
}
