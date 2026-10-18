import { easeInOut, easeOut } from 'framer-motion';
import type { DiscardPresentationCardLayout } from './battleAnimationEvents';
import {
  WAITING_ROOM_REVEAL_MOVE_DURATION_MS,
  WAITING_ROOM_REVEAL_HOLD_DURATION_MS,
  WAITING_ROOM_REVEAL_DURATION_MS,
} from './battleAnimationSequencing';

export const WAITING_ROOM_CARD_CLASS_NAME =
  'fixed overflow-hidden rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_82%,white)] bg-[var(--bg-overlay)] shadow-[0_16px_36px_rgba(0,0,0,0.42),0_1px_0_rgba(255,255,255,0.08)_inset]';
export const WAITING_ROOM_CARD_TIMES = [
  0,
  WAITING_ROOM_REVEAL_MOVE_DURATION_MS / WAITING_ROOM_REVEAL_DURATION_MS,
  (WAITING_ROOM_REVEAL_MOVE_DURATION_MS + WAITING_ROOM_REVEAL_HOLD_DURATION_MS) /
    WAITING_ROOM_REVEAL_DURATION_MS,
  1,
];
export const WAITING_ROOM_CARD_EASING = ['easeOut', 'linear', 'easeInOut'] as const;

/** Discard and recovery share the same geometry, layout and easing; recovery samples backwards. */
export function getWaitingRoomCardKeyframes(
  from: DiscardPresentationCardLayout,
  reveal: DiscardPresentationCardLayout,
  to: DiscardPresentationCardLayout
) {
  return {
    left: [from.left, reveal.left, reveal.left, to.left],
    top: [from.top, reveal.top, reveal.top, to.top],
    width: [from.width, reveal.width, reveal.width, to.width],
    height: [from.height, reveal.height, reveal.height, to.height],
    rotate: [from.rotation, reveal.rotation, reveal.rotation, to.rotation],
  };
}

export function sampleWaitingRoomCardPose(
  from: DiscardPresentationCardLayout,
  reveal: DiscardPresentationCardLayout,
  to: DiscardPresentationCardLayout,
  elapsed: number
): DiscardPresentationCardLayout {
  if (elapsed <= 0) return from;
  if (elapsed >= WAITING_ROOM_REVEAL_DURATION_MS) return to;
  const progress = elapsed / WAITING_ROOM_REVEAL_DURATION_MS;
  const segment =
    progress < WAITING_ROOM_CARD_TIMES[1] ? 0 : progress < WAITING_ROOM_CARD_TIMES[2] ? 1 : 2;
  const fraction =
    (progress - WAITING_ROOM_CARD_TIMES[segment]) /
    (WAITING_ROOM_CARD_TIMES[segment + 1] - WAITING_ROOM_CARD_TIMES[segment]);
  const eased = segment === 0 ? easeOut(fraction) : segment === 2 ? easeInOut(fraction) : fraction;
  const frames = getWaitingRoomCardKeyframes(from, reveal, to);
  const mix = (values: number[]) =>
    values[segment] + (values[segment + 1] - values[segment]) * eased;
  return {
    left: mix(frames.left),
    top: mix(frames.top),
    width: mix(frames.width),
    height: mix(frames.height),
    rotation: mix(frames.rotate),
  };
}
