import type { BattleAnimationRect, BattleAnimationSeat } from './battleAnimationEvents';
import {
  RECOVERY_CHARGE_DURATION_MS,
  RECOVERY_RISE_DURATION_MS,
  RECOVERY_HOLD_DURATION_MS,
  RECOVERY_FLIGHT_DURATION_MS,
  RECOVERY_DURATION_MS,
} from './battleAnimationSequencing';

export interface RecoveryCardPose extends BattleAnimationRect {
  readonly rotation: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

/** Same charge / release / still hover / flight as the approved stage prototype, in viewport pixels. */
export function sampleRecoveryMotion(
  from: RecoveryCardPose,
  to: RecoveryCardPose,
  elapsed: number
) {
  const riseProgress = clamp((elapsed - RECOVERY_CHARGE_DURATION_MS) / RECOVERY_RISE_DURATION_MS);
  const launchAt =
    RECOVERY_CHARGE_DURATION_MS + RECOVERY_RISE_DURATION_MS + RECOVERY_HOLD_DURATION_MS;
  const flightProgress = clamp((elapsed - launchAt) / RECOVERY_FLIGHT_DURATION_MS);
  const rise = 1 - (1 - riseProgress) ** 3;
  const flight = 1 - (1 - flightProgress) ** 3;
  const mix = (a: number, b: number) => a + (b - a) * flight;
  const width = mix(from.width * (1 + 0.5 * rise), to.width);
  const height = mix(from.height * (1 + 0.5 * rise), to.height);
  // Fit the lifted face above the pile, including when the opponent's pile is near the top edge.
  const lift =
    Math.min(from.width, Math.max(0, from.top - from.height * 0.25 - 8)) *
    rise *
    (1 - smooth(flightProgress));
  const rotationDelta = ((to.rotation - from.rotation + 540) % 360) - 180;
  const pose =
    elapsed >= RECOVERY_DURATION_MS
      ? to
      : {
          left: mix(from.left + from.width / 2, to.left + to.width / 2) - width / 2,
          top: mix(from.top + from.height / 2, to.top + to.height / 2) - height / 2 - lift,
          width,
          height,
          rotation: from.rotation + rotationDelta * flight,
        };
  return {
    pose,
    riseProgress,
    flightProgress,
    // The face emerges at the pile; it is never first shown at the hover position.
    opacity: clamp((elapsed - RECOVERY_CHARGE_DURATION_MS) / 24),
    sourceGlow:
      smooth(elapsed / RECOVERY_CHARGE_DURATION_MS) * (1 - smooth((elapsed - launchAt + 50) / 50)),
    popGlow: Math.sin(Math.PI * riseProgress),
    trailGlow: Math.sin(Math.PI * riseProgress) * 0.6 + Math.sin(Math.PI * flightProgress) * 0.65,
  };
}

/** BoundingClientRect includes fan rotation and all ancestor scales. Undo the rotation only. */
export function recoveryPoseFromBounds(
  bounds: BattleAnimationRect,
  rotation: number
): RecoveryCardPose {
  const radians = (rotation * Math.PI) / 180;
  const c = Math.abs(Math.cos(radians)),
    s = Math.abs(Math.sin(radians));
  const divisor = c * c - s * s;
  const w =
    Math.abs(divisor) > 0.1 ? (bounds.width * c - bounds.height * s) / divisor : bounds.width;
  const h =
    Math.abs(divisor) > 0.1 ? (bounds.height * c - bounds.width * s) / divisor : bounds.height;
  const width = w > 0 ? w : bounds.width,
    height = h > 0 ? h : bounds.height;
  return {
    left: bounds.left + (bounds.width - width) / 2,
    top: bounds.top + (bounds.height - height) / 2,
    width,
    height,
    rotation,
  };
}

/** Only reads an already-rendered own hand. Anonymous opponent cards are never identified. */
export function measureRecoveryHandPose(objectId: string): RecoveryCardPose | null {
  const wrapper = Array.from(
    document.querySelectorAll<HTMLElement>('[data-recovery-hand-card]')
  ).find((node) => node.dataset.recoveryHandCard === objectId);
  const card = wrapper?.querySelector<HTMLElement>('[data-object-id]');
  if (!wrapper || !card) return null;
  const bounds = card.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const matrix = new DOMMatrixReadOnly(getComputedStyle(wrapper).transform);
  return recoveryPoseFromBounds(bounds, (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI);
}

export function portraitRecoveryPose(rect: BattleAnimationRect): RecoveryCardPose {
  const width = Math.min(rect.width, (rect.height * 5) / 7);
  const height = (width * 7) / 5;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
    rotation: 0,
  };
}

/** Prefer the pile itself, never the expanded waiting-room selection card. */
export function measureRecoveryZonePose(
  seat: BattleAnimationSeat | undefined,
  zone: 'waiting-room' | 'hand'
) {
  const key = `seat-${seat}::${zone}`;
  const node =
    Array.from(document.querySelectorAll<HTMLElement>('[data-animation-zone-id], [data-zone-id]'))
      .filter((node) => !node.closest('[data-battle-animation-ignore="true"]'))
      .find((node) => node.dataset.animationZoneId === key) ?? document.getElementById(key);
  if (!node) return null;
  const bounds = node.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0 ? portraitRecoveryPose(bounds) : null;
}

/** Two short edge trails, not a border or an orbit around the pile. */
export function recoveryEdgePoint(pose: RecoveryCardPose, side: number) {
  const angle = (pose.rotation * Math.PI) / 180;
  const x = side * pose.width * 0.48,
    y = pose.height * 0.23;
  return {
    x: pose.left + pose.width / 2 + x * Math.cos(angle) - y * Math.sin(angle),
    y: pose.top + pose.height / 2 + x * Math.sin(angle) + y * Math.cos(angle),
  };
}
