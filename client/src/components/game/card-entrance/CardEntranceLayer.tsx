import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '@/store/gameStore';
import {
  collectCardEntrances,
  emptyEntranceCursor,
  type CardEntrance,
} from '@/lib/cardEntranceEvents';
import { createCardEntranceMesh } from '@/lib/cardEntranceMesh';
import art from './kanata.png';
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
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [queue, setQueue] = useState<(CardEntrance & { receivedAt: number })[]>([]);
  const cursor = useRef(emptyEntranceCursor());
  const reduced = !!useReducedMotion();
  const blocked = !!(
    view?.activeEffect ||
    view?.pendingCostPayment ||
    view?.pendingSpecialMemberPlay ||
    view?.match.endInfo
  );

  useEffect(() => {
    const result = collectCardEntrances(cursor.current, {
      matchId: log.matchId,
      epoch: log.presentationEpoch,
      seq: log.currentPublicSeq,
      events: log.events,
    });
    cursor.current = result.cursor;
    if (result.reset || !local || !enabled || blocked || log.matchId !== view?.match.matchId) {
      setQueue([]);
      setPreviewId(null);
      return;
    }
    // Confirm the public object is still a face-up top-level stage occupant.
    const staged = new Set(
      Object.values(view.table.zones).flatMap((z) =>
        Object.values(z.slotMap ?? {}).filter((id): id is string => !!id)
      )
    );
    const fresh = result.entrances.filter(
      (e) => staged.has(e.objectId) && view.objects[e.objectId]?.surface === 'FRONT'
    );
    const now = performance.now();
    setQueue((q) =>
      [
        ...q.filter((e) => now - e.receivedAt < 5000 && staged.has(e.objectId)),
        ...fresh.map((e) => ({ ...e, receivedAt: now })),
      ].slice(0, 4)
    );
  }, [log, view, local, enabled, blocked]);

  const active = local && enabled && !blocked ? queue[0] : undefined;
  const presentationId = local && enabled && !blocked ? (active?.id ?? previewId) : null;
  const finishPresentation = () => {
    setPreviewId(null);
    setQueue((q) =>
      q.filter((e) => e.id !== presentationId && performance.now() - e.receivedAt < 5000)
    );
  };
  useEffect(() => {
    if (!presentationId) return;
    const timer = window.setTimeout(
      () => {
        setPreviewId(null);
        setQueue((q) =>
          q.filter((e) => e.id !== presentationId && performance.now() - e.receivedAt < 5000)
        );
      },
      reduced ? 160 : 2400
    );
    return () => window.clearTimeout(timer);
  }, [presentationId, reduced]);
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
        <button
          type="button"
          disabled={!enabled || blocked || !!active}
          onClick={() => setPreviewId(`preview-${performance.now()}`)}
        >
          预览
        </button>
      </div>
      {presentationId && (
        <Entrance
          key={presentationId}
          layout={layout}
          reduced={reduced}
          onDone={finishPresentation}
        />
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
        if (t >= 2.4) {
          done.current();
          return;
        }
        const enter = 1 - (1 - Math.min(1, t / 0.6)) ** 3;
        const exit = Math.max(0, Math.min(1, (t - 1.95) / 0.45));
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
      <button
        className="card-entrance-skip"
        onClick={(e) => {
          e.stopPropagation();
          done.current();
        }}
      >
        跳过演出
      </button>
    </div>
  );
}
