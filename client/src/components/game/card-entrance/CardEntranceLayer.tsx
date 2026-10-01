import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '@/store/gameStore';
import { collectCardEntrances, emptyEntranceCursor } from '@/lib/cardEntranceEvents';
import { getCardEntranceProfile, type CardEntranceProfile } from '@/lib/cardEntranceProfiles';
import { CardEntrancePortrait } from './CardEntrancePortrait';
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
  const [queue, setQueue] = useState<
    (LandingPresentation & { receivedAt: number; profile: CardEntranceProfile })[]
  >([]);
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
      const profile = target && getCardEntranceProfile(target.cardCode);
      return target && profile
        ? [
            {
              id: entry.id,
              profile,
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
        <div
          key={presentation.id}
          className="card-entrance-presentation"
          data-profile={presentation.profile.id}
          style={
            {
              '--entrance-art-center': presentation.profile.center,
              '--entrance-mobile-height': presentation.profile.mobileHeight,
              '--entrance-light': presentation.profile.light,
            } as CSSProperties
          }
        >
          <CardEntrancePortrait
            profile={presentation.profile}
            reduced={reduced}
            onDone={finishPresentation}
          />
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
