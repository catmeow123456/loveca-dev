import { useTextPresentation } from '@/lib/appPresentation';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react';
import type { HeartRequirement } from '@game/domain/entities/card';
import type { Seat } from '@game/online';
import { SubPhase, type HeartColor } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';
import {
  playCheerMotion,
  readCheerJudgmentLabels,
  warmCheerAssets,
  type CheerMotionCard,
} from './cheerMotion';

// The review page can compare timings; ordinary battles use the default automatically.
export const CheerMotionContext = createContext<{
  enabled: boolean;
  speed: number;
  phase?: (label: string) => void;
  done?: () => void;
}>({ enabled: true, speed: 0.5 });

interface Cursor {
  matchId: string;
  viewer: Seat | null;
  seat: Seat | null;
  seq: number;
  epoch: number | undefined;
  phase: SubPhase;
  open: boolean;
  ids: Record<Seat, string[]>;
}

export function useCheerRevealMotion(input: {
  panel: RefObject<HTMLElement | null>;
  isOpen: boolean;
  isReadOnly: boolean;
  seat: Seat | null;
  phase: SubPhase;
  cards: CheerMotionCard[];
  members: Map<HeartColor, number>;
  totals: Map<HeartColor, number>;
  requirements: HeartRequirement | null;
  playerName: string;
}) {
  const config = useContext(CheerMotionContext);
  const view = useGameStore((s) => s.playerViewState);
  const epoch = useGameStore((s) => s.publicBattleLog.presentationEpoch);
  const previous = useRef<Cursor | null>(null);
  const labels = useRef<ReturnType<typeof readCheerJudgmentLabels>>([]);
  const textOnly = useTextPresentation();
  const cancel = useRef<(() => void) | null>(null);
  const pending = useRef<{
    cards: CheerMotionCard[];
    before: Map<HeartColor, number>;
    labels: typeof labels.current;
    firstBatch: boolean;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef({ input, config });
  current.current = { input, config };

  const stop = () => {
    const cleanup = cancel.current;
    cancel.current = null;
    pending.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    cleanup?.();
  };
  useEffect(() => {
    if (!textOnly) void warmCheerAssets();
    return stop;
  }, [textOnly]);

  useLayoutEffect(() => {
    if (textOnly) {
      stop();
      return;
    }
    const store = useGameStore.getState();
    const prev = previous.current;
    const match = view?.match;
    const next: Cursor | null = match
      ? {
          matchId: match.matchId,
          viewer: match.viewerSeat,
          seat: input.seat,
          seq: match.seq,
          epoch,
          phase: input.phase,
          open: input.isOpen,
          ids: {
            FIRST: store.getResolutionCardIdsForSeat('FIRST'),
            SECOND: store.getResolutionCardIdsForSeat('SECOND'),
          },
        }
      : null;
    // Save before registering movement ownership, which can synchronously render again.
    previous.current = next;
    const reset =
      !prev ||
      !next ||
      prev.matchId !== next.matchId ||
      prev.viewer !== next.viewer ||
      prev.epoch !== next.epoch ||
      next.seq < prev.seq ||
      input.isReadOnly ||
      !config.enabled;
    if (reset) {
      stop();
      labels.current = readCheerJudgmentLabels(input.panel.current);
      return;
    }
    const oldLabels = labels.current;
    if (next.seq !== prev.seq || next.seat !== prev.seat || (prev.open && !next.open)) stop();
    const added = input.seat
      ? input.cards.filter((card) => !prev.ids[input.seat!].includes(card.id))
      : [];
    const enteringJudgment =
      input.phase === SubPhase.PERFORMANCE_JUDGMENT && prev.phase !== input.phase;
    // A new auto-cheer can precede GameBoard's panel-open effect by one render.
    // Reopening a panel, reconnecting, changing viewer or undoing never replays old cards.
    if (added.length && (input.isOpen || enteringJudgment)) {
      const before = new Map(input.totals);
      for (const card of added)
        for (const heart of card.hearts)
          before.set(heart.color, Math.max(0, (before.get(heart.color) ?? 0) - heart.count));
      pending.current = {
        cards: added,
        before,
        labels: prev.seat === next.seat ? oldLabels : [],
        firstBatch: prev.ids[input.seat!].length === 0,
      };
      const owners = added.map((card) => ({
        eventId: `cheer:${next.matchId}:${next.seq}:${card.objectId}`,
        objectId: card.objectId,
        suppressDefaultMovement: true,
      }));
      const release = () =>
        owners.forEach((owner) =>
          useGameStore.getState().removeBattleAnimationOcclusion(owner.eventId)
        );
      cancel.current = release;
      store.addBattleAnimationOcclusions(owners);
      if (!input.isOpen) timer.current = setTimeout(stop, 1000);
    }
    if (pending.current && input.isOpen && input.panel.current) {
      if (timer.current !== null) clearTimeout(timer.current);
      const batch = pending.current;
      pending.current = null;
      const release = cancel.current;
      // Prepare backs and starting counts in this layout effect, before the panel paints.
      // The panel-local presentation follows the drawer and starts its clock after it settles.
      cancel.current = playCheerMotion({
        panel: input.panel.current,
        cards: batch.cards,
        before: batch.before,
        labels: batch.labels,
        members: input.members,
        speed: config.speed,
        requirements: input.requirements,
        playerName: input.playerName,
        firstBatch: batch.firstBatch,
        phase: config.phase,
        done: () => {
          cancel.current = null;
          release?.();
          current.current.config.done?.();
        },
      });
    }
    labels.current = readCheerJudgmentLabels(input.panel.current);
  });
}
