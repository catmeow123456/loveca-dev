export interface EntranceMotionTiming {
  start: number;
  duration: number;
  /** Cubic spreads movement more evenly; quintic preserves existing gestures. */
  easing?: 'smoothstep' | 'smootherstep';
}

/** One purposeful move followed by a held pose; no pendulum or return swing. */
export function entranceArmProgress(
  seconds: number,
  start: number,
  duration: number,
  easing: EntranceMotionTiming['easing'] = 'smootherstep'
): number {
  const t = Math.max(0, Math.min(1, (seconds - start) / duration));
  if (easing === 'smoothstep') return t * t * (3 - 2 * t);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** All parts use the portrait clock; the torso may lead the hand without another timer. */
export function entranceLayerFrame(
  seconds: number,
  motion: EntranceMotionTiming & { bodyMotion?: EntranceMotionTiming },
  reduced: boolean
) {
  if (reduced) return { arm: 1, body: 1, follow: 0 };
  const body = motion.bodyMotion ?? motion;
  const arm = entranceArmProgress(seconds, motion.start, motion.duration, motion.easing);
  const bodyProgress = entranceArmProgress(seconds, body.start, body.duration, body.easing);
  const trailing = entranceArmProgress(
    seconds - 0.16,
    body.start,
    body.duration + 0.16,
    body.easing
  );
  return { arm, body: bodyProgress, follow: (bodyProgress - trailing) * 3 };
}
