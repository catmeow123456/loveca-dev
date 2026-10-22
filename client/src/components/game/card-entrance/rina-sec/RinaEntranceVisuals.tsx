import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CardEntranceProfile } from '@/lib/cardEntranceProfiles';
import type { EntranceStageTarget } from '@/lib/cardEntranceLanding';
import { RinaSecPresentation } from './RinaSecPresentation';
import { readRinaBattleLayout } from './rinaBattleLayout';
import { rinaSecFrame } from './rinaSecTimeline';

/** Shares the entrance player's preparation, clock, cancellation and completion barrier. */
export function RinaEntranceVisuals({
  target,
  profile,
  ready,
  reduced,
  onImpact,
  onDone,
}: {
  target: EntranceStageTarget;
  profile: CardEntranceProfile;
  ready: {
    portrait: HTMLImageElement;
    card: HTMLImageElement | null;
    blink: HTMLImageElement | null;
    startedAt: number;
  };
  reduced: boolean;
  onImpact: () => void;
  onDone: () => void;
}) {
  const callbacks = useRef({ onImpact, onDone });
  callbacks.current = { onImpact, onDone };
  const [layout, setLayout] = useState<ReturnType<typeof readRinaBattleLayout>>(null);
  const [elapsed, setElapsed] = useState(0);
  const invalid = useCallback(() => callbacks.current.onDone(), []);
  const assets = useMemo(
    () => ({
      ...ready,
      member: ready.card ?? ready.portrait,
      oldLive: ready.portrait,
      newLive: ready.portrait,
    }),
    [ready]
  );
  useLayoutEffect(() => {
    const geometry = readRinaBattleLayout(target, 'self');
    if (!geometry) {
      invalid();
      return;
    }
    setLayout(geometry);
    let raf = 0,
      impacted = false;
    const tick = (now: number) => {
      const time = now - ready.startedAt;
      const frame = rinaSecFrame('entrance', time, reduced);
      setElapsed(time);
      if (!impacted && frame.memberVisible) {
        impacted = true;
        callbacks.current.onImpact();
      }
      if (!frame.finished) raf = requestAnimationFrame(tick);
    };
    tick(performance.now());
    window.addEventListener('resize', invalid);
    window.addEventListener('scroll', invalid, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', invalid);
      window.removeEventListener('scroll', invalid, true);
    };
  }, [ready, target, reduced, invalid]);
  return (
    layout && (
      <RinaSecPresentation
        cardCode={target.cardCode}
        scene="entrance"
        elapsed={elapsed}
        reduced={reduced}
        layout={layout}
        assets={assets}
        profile={profile}
        onError={invalid}
      />
    )
  );
}
