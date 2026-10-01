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
import { ZoneType } from '@game/shared/types/enums';
import './cardEntrance.css';

type EntranceLayout = 'centered' | 'side';

const isLocalDevelopment = () =>
  import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

export function CardEntranceLayer() {
  const { view, log, source, readOnly } = useGameStore(
    useShallow((s) => ({
      view: s.playerViewState,
      log: s.publicBattleLog,
      source: s.remoteSession?.source ?? null,
      readOnly: s.getBattleSurfaceCapabilities().isReadOnly,
    }))
  );
  const local =
    isLocalDevelopment() &&
    (source === null || source === 'DEBUG' || source === 'SOLITAIRE') &&
    !readOnly;
  const [enabled, setEnabled] = useState(
    () => new URLSearchParams(location.search).get('summonAnimation') === '1'
  );
  const [layout, setLayout] = useState<EntranceLayout>('centered');
  const [preview, setPreview] = useState<LandingPresentation | null>(null);
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
  const canPresent = local && enabled && !blocked && log.matchId === view?.match.matchId;

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
      setPreview(null);
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
    setPreview((p) =>
      p?.target && !sameEntranceTarget(p.target, getEntranceStageTarget(view, p.target.objectId))
        ? null
        : p
    );
  }, [log, view, canPresent]);

  const active = canPresent ? queue[0] : undefined;
  const presentation = canPresent ? (active ?? preview) : null;
  const presentationId = presentation?.id;
  const finishPresentation = () => {
    setPreview(null);
    setQueue((q) =>
      q.filter((e) => e.id !== presentationId && performance.now() - e.receivedAt < 5000)
    );
  };

  // Reserve the public stage cards before paint. The ordinary move layer yields to these owners.
  useLayoutEffect(() => {
    const candidates =
      canPresent && !reduced ? [...queue, ...(active ? [] : preview ? [preview] : [])] : [];
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
  }, [queue, preview, active, landedId, canPresent, reduced]);
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
        setPreview(null);
        setQueue((q) =>
          q.filter((e) => e.id !== presentationId && performance.now() - e.receivedAt < 5000)
        );
      },
      reduced ? 160 : CARD_ENTRANCE_TOTAL_MS
    );
    return () => window.clearTimeout(timer);
  }, [presentationId, reduced]);

  const startPreview = () => {
    const target = Object.keys(view?.objects ?? {})
      .map((id) => getEntranceStageTarget(view, id))
      .find(Boolean);
    let previewAnchor: string | undefined;
    if (!target && view) {
      const ownStage = Object.values(view.table.zones).find(
        (z) => z.zone === ZoneType.MEMBER_SLOT && z.ownerSeat === view.match.viewerSeat
      );
      const slot = ['CENTER', 'LEFT', 'RIGHT'].find(
        (s) => !ownStage?.slotMap?.[s as keyof typeof ownStage.slotMap]
      );
      if (slot) previewAnchor = `self-stage-${slot.toLowerCase()}`;
    }
    setPreview({
      id: `preview-${performance.now()}`,
      target: target ?? undefined,
      previewAnchor,
      imagePath: useGameStore.getState().getCardImagePath(target?.cardCode ?? 'PL!N-bp7-006-SEC'),
    });
  };
  if (!local) return null;
  return (
    <>
      <div className="card-entrance-switch" onClick={(e) => e.stopPropagation()}>
        <label title="仅本地开发：费用17彼方登场演出">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{' '}
          彼方登场试作
        </label>
        <select
          aria-label="登场布局"
          value={layout}
          onChange={(e) => setLayout(e.target.value as EntranceLayout)}
        >
          <option value="centered">居中布局</option>
          <option value="side">左右布局</option>
        </select>
        <button type="button" disabled={!enabled || blocked || !!active} onClick={startPreview}>
          预览
        </button>
      </div>
      {presentation && (
        <div key={presentation.id} className="card-entrance-presentation">
          <Entrance layout={layout} reduced={reduced} onDone={finishPresentation} />
          {!reduced && (presentation.target || presentation.previewAnchor) && (
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

function Entrance({
  reduced,
  onDone,
  layout,
}: {
  reduced: boolean;
  onDone: () => void;
  layout: EntranceLayout;
}) {
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
      className={`card-entrance card-entrance--${layout}`}
      data-testid="kanata-entrance"
      aria-label="近江彼方登场"
      style={{ opacity: 0 }}
    >
      <div className="card-entrance-light" />
      <canvas ref={canvas} className="card-entrance-art" />
      <div className="card-entrance-name">
        {layout === 'centered' ? (
          <span className="card-entrance-card-name">近江彼方</span>
        ) : (
          <>
            近江彼方<span className="card-entrance-english">KANATA KONOE</span>
          </>
        )}
      </div>
    </div>
  );
}
