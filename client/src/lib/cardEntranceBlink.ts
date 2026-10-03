type Rect = readonly [number, number, number, number];

/** Eye artwork is sampled in portrait UVs so it follows the same head geometry. */
export interface EntranceBlinkProfile {
  start: number;
  close: number;
  hold: number;
  open: number;
  eyes: readonly [EntranceBlinkEye, EntranceBlinkEye];
}
export interface EntranceBlinkEye {
  /** Destination rectangle in original portrait UVs; feathered elliptical boundary. */
  target: Rect;
  half: Rect;
  closed: Rect;
}

/** One blink, with no timers or looping; skipped frames still produce the right pose. */
export function entranceBlinkAmount(
  seconds: number,
  blink: EntranceBlinkProfile,
  reduced: boolean
) {
  if (reduced || seconds <= blink.start) return 0;
  const elapsed = seconds - blink.start;
  const smooth = (x: number) => x * x * (3 - 2 * x);
  if (elapsed < blink.close) return smooth(elapsed / blink.close);
  if (elapsed < blink.close + blink.hold) return 1;
  const opening = (elapsed - blink.close - blink.hold) / blink.open;
  return opening < 1 ? 1 - smooth(opening) : 0;
}

/** Group portraits stagger faces: only one eye pair is composited at a time. */
export function entranceBlinkFrame(
  seconds: number,
  faces: readonly EntranceBlinkProfile[],
  reduced: boolean
): { face: EntranceBlinkProfile; amount: number } | null {
  for (const face of faces) {
    const amount = entranceBlinkAmount(seconds, face, reduced);
    if (amount > 0) return { face, amount };
  }
  return null;
}
