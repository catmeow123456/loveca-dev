import { ZoneType } from '@game/shared/types/enums';
import type { BattleAnimationEvent } from './battleAnimationEvents';

export const BATTLE_CARD_MOVE_DURATION_MS = 360;

export function isRecoveryCardMove(event: BattleAnimationEvent): boolean {
  return (
    event.kind === 'CARD_MOVE' &&
    event.fromZoneType === ZoneType.WAITING_ROOM &&
    event.toZoneType === ZoneType.HAND
  );
}
export const BATTLE_CARD_MOVE_SETTLE_BUFFER_MS = 120;
export const BATTLE_PULSE_DURATION_MS = 260;
export const WAITING_ROOM_REVEAL_MOVE_DURATION_MS = 300;
export const WAITING_ROOM_REVEAL_HOLD_DURATION_MS = 720;
export const WAITING_ROOM_REVEAL_COLLECT_DURATION_MS = 160;
export const WAITING_ROOM_REVEAL_DURATION_MS =
  WAITING_ROOM_REVEAL_MOVE_DURATION_MS +
  WAITING_ROOM_REVEAL_HOLD_DURATION_MS +
  WAITING_ROOM_REVEAL_COLLECT_DURATION_MS;
// Same presentation played backwards: pile → reveal → hand.
export const RECOVERY_DURATION_MS = WAITING_ROOM_REVEAL_DURATION_MS;
export const DISCARD_PRESENTATION_REDUCED_MOTION_DURATION_MS = 800;
export const DISCARD_PRESENTATION_REDUCED_MOTION_FADE_MS = 80;
export const ENTER_EFFECT_SURFACE_SUSPEND_MS =
  BATTLE_CARD_MOVE_DURATION_MS + BATTLE_CARD_MOVE_SETTLE_BUFFER_MS;

const STAGE_ENTRY_FOLLOW_UP_MOVE_DELAY_MS = BATTLE_CARD_MOVE_DURATION_MS + 80;
const INSPECTION_AFTER_STAGE_ENTRY_MOVE_DELAY_MS = ENTER_EFFECT_SURFACE_SUSPEND_MS + 120;

export interface ScheduledBattleAnimationEvent {
  readonly event: BattleAnimationEvent;
  readonly delayMs: number;
}

export function createSequencedBattleAnimationEvents(
  events: readonly BattleAnimationEvent[],
  recoveryEffectsEnabled = true
): ScheduledBattleAnimationEvent[] {
  const hasStageEntryMove = events.some(
    (event) =>
      event.kind === 'CARD_MOVE' &&
      event.toZoneType === ZoneType.MEMBER_SLOT &&
      event.fromZoneType !== ZoneType.MEMBER_SLOT
  );

  const recoveryCounts = new Map<string, number>();
  const recoveryTotals = new Map<string, number>();
  for (const event of events) {
    if (recoveryEffectsEnabled && event.kind === 'CARD_MOVE' && isRecoveryCardMove(event)) {
      const seat = event.toSeat ?? '';
      recoveryTotals.set(seat, (recoveryTotals.get(seat) ?? 0) + 1);
    }
  }
  return events.map((event) => {
    const delayMs = hasStageEntryMove ? getStageEntrySequencedDelay(event) : 0;
    if (recoveryEffectsEnabled && event.kind === 'CARD_MOVE' && isRecoveryCardMove(event)) {
      const seat = event.toSeat ?? '';
      const index = recoveryCounts.get(seat) ?? 0;
      recoveryCounts.set(seat, index + 1);
      return {
        event: { ...event, recoveryGroup: { index, count: recoveryTotals.get(seat)! } },
        delayMs,
      };
    }
    return { event, delayMs };
  });
}

export function getBattleAnimationEventDurationMs(
  event: BattleAnimationEvent,
  prefersReducedMotion = false,
  recoveryEffectsEnabled = true
): number {
  if (event.kind === 'DISCARD_PRESENTATION_BATCH') {
    return prefersReducedMotion
      ? DISCARD_PRESENTATION_REDUCED_MOTION_DURATION_MS
      : WAITING_ROOM_REVEAL_DURATION_MS;
  }

  if (event.kind === 'CARD_MOVE' && event.presentation === 'WAITING_ROOM_REVEAL') {
    return WAITING_ROOM_REVEAL_DURATION_MS;
  }

  if (isRecoveryCardMove(event)) {
    return prefersReducedMotion
      ? 120
      : recoveryEffectsEnabled
        ? RECOVERY_DURATION_MS
        : BATTLE_CARD_MOVE_DURATION_MS;
  }

  if (event.kind === 'ZONE_PULSE') {
    return BATTLE_PULSE_DURATION_MS;
  }

  return BATTLE_CARD_MOVE_DURATION_MS;
}

function getStageEntrySequencedDelay(event: BattleAnimationEvent): number {
  if (event.kind !== 'CARD_MOVE' || isStageTransitionMove(event)) {
    return 0;
  }

  if (event.toZoneType === ZoneType.INSPECTION_ZONE) {
    return INSPECTION_AFTER_STAGE_ENTRY_MOVE_DELAY_MS;
  }

  return STAGE_ENTRY_FOLLOW_UP_MOVE_DELAY_MS;
}

function isStageTransitionMove(
  event: Extract<BattleAnimationEvent, { kind: 'CARD_MOVE' }>
): boolean {
  return event.fromZoneType === ZoneType.MEMBER_SLOT || event.toZoneType === ZoneType.MEMBER_SLOT;
}
