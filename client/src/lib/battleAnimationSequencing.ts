import { ZoneType } from '@game/shared/types/enums';
import type { BattleAnimationEvent } from './battleAnimationEvents';

export const BATTLE_CARD_MOVE_DURATION_MS = 360;
export const BATTLE_CARD_MOVE_SETTLE_BUFFER_MS = 120;
export const BATTLE_PULSE_DURATION_MS = 260;
export const WAITING_ROOM_REVEAL_MOVE_DURATION_MS = 300;
export const WAITING_ROOM_REVEAL_HOLD_DURATION_MS = 520;
export const WAITING_ROOM_REVEAL_COLLECT_DURATION_MS = 160;
export const WAITING_ROOM_REVEAL_DURATION_MS =
  WAITING_ROOM_REVEAL_MOVE_DURATION_MS +
  WAITING_ROOM_REVEAL_HOLD_DURATION_MS +
  WAITING_ROOM_REVEAL_COLLECT_DURATION_MS;
export const ENTER_EFFECT_SURFACE_SUSPEND_MS =
  BATTLE_CARD_MOVE_DURATION_MS + BATTLE_CARD_MOVE_SETTLE_BUFFER_MS;

const STAGE_ENTRY_FOLLOW_UP_MOVE_DELAY_MS = BATTLE_CARD_MOVE_DURATION_MS + 80;
const INSPECTION_AFTER_STAGE_ENTRY_MOVE_DELAY_MS = ENTER_EFFECT_SURFACE_SUSPEND_MS + 120;

export interface ScheduledBattleAnimationEvent {
  readonly event: BattleAnimationEvent;
  readonly delayMs: number;
}

export function createSequencedBattleAnimationEvents(
  events: readonly BattleAnimationEvent[]
): ScheduledBattleAnimationEvent[] {
  const hasStageEntryMove = events.some(
    (event) =>
      event.kind === 'CARD_MOVE' &&
      event.toZoneType === ZoneType.MEMBER_SLOT &&
      event.fromZoneType !== ZoneType.MEMBER_SLOT
  );

  if (!hasStageEntryMove) {
    return events.map((event) => ({ event, delayMs: 0 }));
  }

  return events.map((event) => ({
    event,
    delayMs: getStageEntrySequencedDelay(event),
  }));
}

export function getBattleAnimationEventDurationMs(event: BattleAnimationEvent): number {
  if (event.kind === 'CARD_MOVE' && event.presentation === 'WAITING_ROOM_REVEAL') {
    return WAITING_ROOM_REVEAL_DURATION_MS;
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
