import type { PlayerViewState } from '@game/online/types';

/** One public batch, with no correspondence to the secret shuffled positions. */
export interface WaitingReturnSource {
  side: 'self' | 'opponent';
  objectIds: readonly string[];
  facePaths: readonly string[];
  count: number;
}
export function getWaitingReturnSource(
  view: PlayerViewState,
  objectId: string,
  imagePath: (code: string) => string
): WaitingReturnSource | undefined {
  const entry = view.match.entrance?.waitingRoomReturns?.find((r) => r.objectId === objectId);
  if (!entry?.members.length) return undefined;
  return {
    side: entry.ownerSeat === view.match.viewerSeat ? 'self' : 'opponent',
    objectIds: entry.members.map((m) => m.objectId),
    facePaths: entry.members.slice(0, 7).map((m) => imagePath(m.cardCode)),
    count: entry.members.length,
  };
}

// Preserve every phase's original proportions while extending the prelude to 1.3 seconds.
const scaleTiming = (ms: number) => (ms * 1300) / 1020;
/** The final ~153 ms overlap the portrait entrance; batch size never extends it. */
export const waitingReturnTimeline = {
  rise: scaleTiming(200),
  fadeIn: scaleTiming(55),
  flipAt: scaleTiming(180),
  flip: scaleTiming(140),
  shuffleAt: scaleTiming(320),
  shuffle: scaleTiming(120),
  flyAt: scaleTiming(430),
  flight: scaleTiming(350),
  stagger: scaleTiming(18),
  settle: scaleTiming(130),
  deckLiftAt: scaleTiming(610),
  deckLift: scaleTiming(410),
  ringAt: scaleTiming(790),
  ring: scaleTiming(230),
  portraitAt: scaleTiming(900),
  end: 1300,
} as const;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
export function waitingReturnFrame(elapsed: number, index: number, count: number) {
  const t = waitingReturnTimeline;
  const rise = smooth(elapsed / t.rise);
  const flip = smooth((elapsed - t.flipAt) / t.flip);
  const shuffle = clamp((elapsed - t.shuffleAt) / t.shuffle);
  const flight = smooth((elapsed - t.flyAt - index * t.stagger) / t.flight);
  const settle = smooth(
    (elapsed - (t.flyAt + t.flight + (Math.min(count, 7) - 1) * t.stagger)) / t.settle
  );
  return {
    rise,
    flip,
    shuffle,
    flight,
    settle,
    face: flip < 0.5,
    opacity: smooth(elapsed / t.fadeIn) * (1 - smooth((flight - 0.84) / 0.16)),
    finished: elapsed >= t.end,
    phase:
      elapsed < t.flipAt
        ? 'rise'
        : elapsed < t.shuffleAt
          ? 'flip'
          : elapsed < t.flyAt
            ? 'shuffle'
            : elapsed < t.portraitAt
              ? 'return'
              : 'settle',
  };
}
