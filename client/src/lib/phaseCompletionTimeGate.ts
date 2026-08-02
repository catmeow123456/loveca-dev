import { GameCommandType } from '@game/application/game-commands';
import type { ViewCommandHint, ViewCommandTimeGateAvailability } from '@game/online/types';
import { GamePhase, SubPhase } from '@game/shared/types/enums';

export interface PhaseActionDispatchOptions {
  readonly isReadOnly: boolean;
  readonly isPhaseCompletionTimeGateLocked: boolean;
  readonly currentSubPhase: SubPhase;
  readonly phase: GamePhase;
  readonly onOpenJudgment?: () => void;
  readonly endPhase: () => void;
  readonly advancePhase: () => void;
  readonly confirmSubPhase: (subPhase: SubPhase) => void;
}

/**
 * Shared defensive action guard for both responsive button renderings.
 * Native `disabled` is the first line of defence; this guard also guarantees
 * that a synthetic/programmatic click cannot dispatch while the gate is locked.
 */
export function dispatchPhaseAction(options: PhaseActionDispatchOptions): void {
  if (options.isReadOnly || options.isPhaseCompletionTimeGateLocked) {
    return;
  }

  if (options.currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT && options.onOpenJudgment) {
    options.onOpenJudgment();
    return;
  }

  if (options.currentSubPhase !== SubPhase.NONE) {
    options.confirmSubPhase(options.currentSubPhase);
    return;
  }

  if (options.phase === GamePhase.MAIN_PHASE) {
    options.endPhase();
    return;
  }

  options.advancePhase();
}

export function isPhaseCompletionTimeGateHint(
  hint: ViewCommandHint | null | undefined
): hint is ViewCommandHint & { readonly availability: ViewCommandTimeGateAvailability } {
  return (
    (hint?.command === GameCommandType.END_PHASE ||
      hint?.command === GameCommandType.CONFIRM_STEP) &&
    hint?.availability?.kind === 'TIME_GATE' &&
    hint.availability.windowKey.length > 0 &&
    Number.isFinite(hint.availability.availableAfterMs) &&
    hint.availability.availableAfterMs >= 0
  );
}

export function createPhaseCompletionTimeGateDeadline(
  availability: ViewCommandTimeGateAvailability,
  receivedAt = Date.now()
): number {
  return receivedAt + Math.max(0, availability.availableAfterMs);
}

export function getPhaseCompletionTimeGateRemainingMs(deadline: number, now = Date.now()): number {
  return Math.max(0, deadline - now);
}

export function getPhaseCompletionTimeGateCountdownSeconds(
  deadline: number,
  now = Date.now()
): number {
  return Math.ceil(getPhaseCompletionTimeGateRemainingMs(deadline, now) / 1_000);
}
