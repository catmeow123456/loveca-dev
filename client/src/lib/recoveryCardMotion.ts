import {
  measureBattleAnimationCardRect,
  type BattleAnimationRect,
  type BattleAnimationSeat,
} from './battleAnimationEvents';
import { RECOVERY_DURATION_MS } from './battleAnimationSequencing';
import { sampleWaitingRoomCardPose } from './waitingRoomCardPresentation';

export interface RecoveryCardPose extends BattleAnimationRect {
  readonly rotation: number;
}

/** Reverse the discard path; the live hand pose remains the exact final destination. */
export function sampleRecoveryMotion(
  from: RecoveryCardPose,
  to: RecoveryCardPose,
  elapsed: number,
  reveal: RecoveryCardPose
) {
  return { pose: sampleWaitingRoomCardPose(to, reveal, from, RECOVERY_DURATION_MS - elapsed) };
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
  const bounds = measureBattleAnimationCardRect(card);
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  if (bounds.rotation !== undefined) return { ...bounds, rotation: bounds.rotation };
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
