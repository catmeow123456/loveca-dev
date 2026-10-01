import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '@/store/gameStore';
import { collectCardEntrances, emptyEntranceCursor } from '@/lib/cardEntranceEvents';
import { createCardEntranceMesh } from '@/lib/cardEntranceMesh';
import art from './kanata.png';
import { CardLanding, type LandingPresentation } from './CardLanding';
import {
  CARD_ENTRANCE_TOTAL_MS,
  getEntranceStageTarget,
  sameEntranceTarget,
} from '@/lib/cardEntranceLanding';
import './cardEntrance.css';

export function CardEntranceLayer({ enabled }: { enabled: boolean }) {
  const { view, log } = useGameStore(
    useShallow((s) => ({
      view: s.playerViewState,
      log: s.publicBattleLog,
    }))
  );
  const [queue, setQueue] = useState<(LandingPresentation & { receivedAt: number })[]>([]);
  const [landedId, setLandedId] = useState<string | null>(null);
  const cursor = useRef(emptyEntranceCursor());
  const reservations = useRef(new Set<string>());
  const reduced = !!useReducedMotion();
  const blocked = !!(
    view?.activeEffect ||
    view?.pendingCostPayment ||
    view?.pendingSpecialMemberPlay ||
    view?.match.endInfo
  );
  const canPresent = enabled && !blocked && log.matchId === view?.match.matchId;

  useLayoutEffect(() => {
    const result = collectCardEntrances(cursor.current, {
      matchId: log.matchId,
      epoch: log.presentationEpoch,
      seq: log.currentPublicSeq,
      events: log.events,
    });
    cursor.current = result.cursor;
    if (result.reset || !canPresent) {
      setQueue([]);
      return;
    }
    const fresh = result.entrances.flatMap((entry) => {
      const target = getEntranceStageTarget(view, entry.objectId);
      return target
        ? [
            {
              id: entry.id,
              target,
              imagePath: useGameStore.getState().getCardImagePath(target.cardCode),
              receivedAt: performance.now(),
            },
          ]
        : [];
    });
    setQueue((q) =>
      [
        ...q.filter(
          (e) =>
            e.target &&
            performance.now() - e.receivedAt < 5000 &&
            sameEntranceTarget(e.target, getEntranceStageTarget(view, e.target.objectId)) &&
            !fresh.some((f) => f.target.objectId === e.target?.objectId)
        ),
        ...fresh,
      ].slice(0, 4)
    );
  }, [log, view, canPresent]);

  const active = canPresent ? queue[0] : undefined;
  const presentation = active;
  const presentationId = presentation?.id;
  const finishPresentation = () => {
    setQueue((q) =>
      q.filter((e) => e.id !== presentationId && performance.now() - e.receivedAt < 5000)
    );
  };

  // Reserve the public stage cards before paint. The ordinary move layer yields to these owners.
  useLayoutEffect(() => {
    const candidates = canPresent && !reduced ? queue : [];
    const wanted = new Map(
      candidates
        .filter((p) => p.target && p.id !== landedId)
        .map((p) => [`entrance:${p.id}`, p.target!.objectId])
    );
    const store = useGameStore.getState();
    for (const id of reservations.current) {
      if (!wanted.has(id)) store.removeBattleAnimationOcclusion(id);
    }
    store.addBattleAnimationOcclusions(
      [...wanted].map(([eventId, objectId]) => ({
        eventId,
        objectId,
        suppressDefaultMovement: true,
      }))
    );
    reservations.current = new Set(wanted.keys());
  }, [queue, landedId, canPresent, reduced]);
  useLayoutEffect(
    () => () => {
      for (const id of reservations.current)
        useGameStore.getState().removeBattleAnimationOcclusion(id);
      reservations.current.clear();
    },
    []
  );

  useEffect(() => {
    if (!presentationId) return;
    const timer = window.setTimeout(
      () => {
        setQueue((q) =>
          q.filter((e) => e.id !== presentationId && performance.now() - e.receivedAt < 5000)
        );
      },
      reduced ? 160 : CARD_ENTRANCE_TOTAL_MS
    );
    return () => window.clearTimeout(timer);
  }, [presentationId, reduced]);

  return (
    <>
      {presentation && (
        <div key={presentation.id} className="card-entrance-presentation">
          <Entrance reduced={reduced} onDone={finishPresentation} />
          {!reduced && (
            <CardLanding
              presentation={presentation}
              onImpact={() => setLandedId(presentation.id)}
              onDone={finishPresentation}
            />
          )}
          <button
            className="card-entrance-skip"
            onClick={(e) => {
              e.stopPropagation();
              finishPresentation();
            }}
          >
            跳过演出
          </button>
        </div>
      )}
    </>
  );
}

function Entrance({ reduced, onDone }: { reduced: boolean; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const image = new Image();
    const target = canvas.current;
    const lost = () => done.current();
    target?.addEventListener('webglcontextlost', lost);
    let frame = 0,
      disposed = false;
    let mesh: ReturnType<typeof createCardEntranceMesh> = null;
    const start = performance.now();
    image.onload = () => {
      if (disposed || !canvas.current) return;
      try {
        mesh = createCardEntranceMesh(canvas.current, image);
      } catch {
        done.current();
        return;
      }
      if (!mesh) {
        done.current();
        return;
      }
      const tick = (now: number) => {
        if (disposed) return;
        const t = (now - start) / 1000;
        if (t >= 1.95) {
          if (container.current) container.current.style.opacity = '0';
          return;
        }
        const enter = 1 - (1 - Math.min(1, t / 0.6)) ** 3;
        const exit = Math.max(0, Math.min(1, (t - 1.5) / 0.45));
        if (container.current) {
          container.current.style.opacity = String(reduced ? 1 : enter * (1 - exit));
          const labelEnter = reduced
            ? 1
            : 1 - (1 - Math.max(0, Math.min(1, (t - 0.3) / 0.35))) ** 3;
          container.current.style.setProperty('--name-opacity', String(labelEnter));
          container.current.style.setProperty('--name-y', `${(1 - labelEnter) * 12}px`);
          container.current.style.setProperty(
            '--entrance-x',
            `${reduced ? 0 : (1 - enter) * 65}px`
          );
        }
        mesh?.draw(t, reduced);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    image.onerror = () => done.current();
    image.src = art;
    return () => {
      disposed = true;
      target?.removeEventListener('webglcontextlost', lost);
      cancelAnimationFrame(frame);
      image.onload = null;
      image.onerror = null;
      mesh?.dispose();
    };
  }, [reduced]);
  return (
    <div
      ref={container}
      className="card-entrance card-entrance--centered"
      data-testid="kanata-entrance"
      aria-label="近江彼方登场"
      style={{ opacity: 0 }}
    >
      <div className="card-entrance-light" />
      <canvas ref={canvas} className="card-entrance-art" />
      <div className="card-entrance-name">
        <span className="card-entrance-card-name">近江彼方</span>
      </div>
    </div>
  );
}
