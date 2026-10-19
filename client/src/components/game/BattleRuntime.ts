import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import type { PlayerViewState } from '@game/online/types';

/** Playback owns only the completion signal; token, retry and expiry are shared by both renderers. */
export function useCardEntranceBarrier(view: PlayerViewState, completed: boolean) {
  const wait = view.match.entrance;
  const waiting = wait?.waitingSeats.includes(view.match.viewerSeat) === true;
  const token = wait?.id;
  const deadline = wait?.deadlineAt;
  useEffect(() => {
    if (!completed || !waiting || !token) return;
    const acknowledge = () => useGameStore.getState().acknowledgeCardEntrance(token);
    acknowledge();
    const timer = window.setInterval(acknowledge, 1000);
    return () => window.clearInterval(timer);
  }, [completed, waiting, token]);
  useEffect(() => {
    if (deadline === undefined) return;
    const timer = window.setTimeout(
      () => useGameStore.getState().expireLocalCardEntrance(),
      Math.max(0, deadline - Date.now()) + 20
    );
    return () => window.clearTimeout(timer);
  }, [deadline]);
}

/** This lifecycle remains mounted when changing renderer or covering the application. */
export function useResultWindowCompletion({
  visible,
  autoComplete,
  windowKey,
  duration = 2800,
  onComplete,
}: {
  visible: boolean;
  autoComplete: boolean;
  windowKey: string | number | null | undefined;
  duration?: number;
  onComplete?: () => void;
}) {
  const complete = useRef(onComplete);
  useLayoutEffect(() => {
    complete.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    if (!visible || !autoComplete) return;
    const timer = window.setTimeout(() => complete.current?.(), duration);
    return () => window.clearTimeout(timer);
  }, [visible, autoComplete, windowKey, duration]);
}

/** Once a public window has been hidden, restoring it must not replay its visuals. */
export function useWindowVisualEligibility(key: string | null, enabled: boolean): boolean {
  const [windowState, setWindowState] = useState({ key, allowed: enabled });
  if (windowState.key !== key) {
    setWindowState({ key, allowed: enabled });
    return key !== null && enabled;
  }
  if (!enabled && windowState.allowed) setWindowState({ key, allowed: false });
  return key !== null && enabled && windowState.allowed;
}
