export type BattleFeedbackTone = 'intent' | 'success' | 'error' | 'info';

export interface BattleFeedbackAnchor {
  readonly targetId?: string;
  readonly zoneId?: string;
  readonly cardId?: string;
}

export interface BattleDragActionHint {
  readonly label: string;
  readonly detail?: string;
  readonly tone: 'recommended' | 'attempt' | 'blocked';
  readonly anchor: BattleFeedbackAnchor;
}

export interface BattleFeedbackInput {
  readonly label: string;
  readonly detail?: string;
  readonly tone: BattleFeedbackTone;
  readonly anchor?: BattleFeedbackAnchor;
  readonly durationMs?: number;
}

export interface BattleFeedbackEvent extends BattleFeedbackInput {
  readonly id: string;
  readonly createdAt: number;
  readonly durationMs: number;
}

let nextBattleFeedbackId = 0;

export function createBattleFeedbackEvent(input: BattleFeedbackInput): BattleFeedbackEvent {
  return {
    ...input,
    id: `battle-feedback-${Date.now()}-${nextBattleFeedbackId++}`,
    createdAt: Date.now(),
    durationMs: input.durationMs ?? getDefaultBattleFeedbackDuration(input.tone),
  };
}

export function getDefaultBattleFeedbackDuration(tone: BattleFeedbackTone): number {
  switch (tone) {
    case 'error':
      return 2600;
    case 'success':
      return 1500;
    case 'intent':
      return 900;
    case 'info':
    default:
      return 1800;
  }
}

export function isBattleFeedbackEventExpired(
  event: BattleFeedbackEvent,
  now: number = Date.now()
): boolean {
  return now - event.createdAt >= event.durationMs;
}

export function getNextBattleFeedbackExpiryDelay(
  events: readonly BattleFeedbackEvent[],
  now: number = Date.now()
): number | null {
  if (events.length === 0) {
    return null;
  }

  let nextDelay: number | null = null;
  for (const event of events) {
    const delay = event.createdAt + event.durationMs - now;
    nextDelay = nextDelay === null ? delay : Math.min(nextDelay, delay);
  }

  return Math.max(0, nextDelay ?? 0);
}

export function escapeCssAttributeValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value
    .replace(/\0/g, '\uFFFD')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\a ')
    .replace(/\r/g, '\\d ')
    .replace(/\f/g, '\\c ');
}
