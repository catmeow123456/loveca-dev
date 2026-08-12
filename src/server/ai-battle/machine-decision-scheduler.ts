import { randomUUID } from 'node:crypto';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';

export const MACHINE_DECISION_SCHEDULE_SCHEMA_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.runtime.machineDecisionSchedule;

export interface MachineDecisionScheduleRegistration {
  readonly schemaVersion: typeof MACHINE_DECISION_SCHEDULE_SCHEMA_VERSION;
  readonly registrationId: string;
  readonly runtimeEpoch: string;
  readonly matchId: string;
}

export type MachineDecisionScheduleResult =
  'PROGRESSED' | 'IDLE' | 'BLOCKED' | 'RETRY' | 'TERMINAL';

export type MachineDecisionScheduleFailureReason = 'BLOCKED' | 'CALLBACK_FAILURE_LIMIT';

export interface MachineDecisionTimerHandle {
  unref?(): void;
}

export interface MachineDecisionSchedulerOptions {
  readonly runtimeEpoch?: string;
  readonly idGenerator?: () => string;
  readonly retryDelayMs?: number;
  readonly maxConsecutiveCallbackFailures?: number;
  readonly scheduleTimer?: (callback: () => void, delayMs: number) => MachineDecisionTimerHandle;
  readonly cancelTimer?: (handle: MachineDecisionTimerHandle) => void;
  readonly onDecisionDue: (
    registration: MachineDecisionScheduleRegistration
  ) => Promise<MachineDecisionScheduleResult> | MachineDecisionScheduleResult;
  readonly onTerminalFailure: (
    registration: MachineDecisionScheduleRegistration,
    reason: MachineDecisionScheduleFailureReason
  ) => Promise<void> | void;
}

interface ActiveMachineDecisionSchedule {
  readonly registration: MachineDecisionScheduleRegistration;
  timerHandle: MachineDecisionTimerHandle | null;
  running: boolean;
  rerunRequested: boolean;
  consecutiveCallbackFailures: number;
  terminalFailureReason: MachineDecisionScheduleFailureReason | null;
}

const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_CONSECUTIVE_CALLBACK_FAILURES = 3;

/**
 * Coalesces authority changes into one-at-a-time machine decision attempts.
 *
 * Each callback performs at most one authority decision. Successful writes
 * request another turn through the normal authority reconciliation hook, so a
 * run of adjacent SYSTEM windows advances without recursive command calls or
 * an unbounded synchronous loop.
 */
export class MachineDecisionScheduler {
  readonly runtimeEpoch: string;

  private readonly idGenerator: () => string;
  private readonly retryDelayMs: number;
  private readonly maxConsecutiveCallbackFailures: number;
  private readonly scheduleTimer: NonNullable<MachineDecisionSchedulerOptions['scheduleTimer']>;
  private readonly cancelTimer: NonNullable<MachineDecisionSchedulerOptions['cancelTimer']>;
  private readonly onDecisionDue: MachineDecisionSchedulerOptions['onDecisionDue'];
  private readonly onTerminalFailure: MachineDecisionSchedulerOptions['onTerminalFailure'];
  private readonly activeByMatch = new Map<string, ActiveMachineDecisionSchedule>();
  private registrationSequence = 0;

  constructor(options: MachineDecisionSchedulerOptions) {
    this.runtimeEpoch = normalizeRequiredValue(
      options.runtimeEpoch ?? randomUUID(),
      'runtimeEpoch'
    );
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.maxConsecutiveCallbackFailures =
      options.maxConsecutiveCallbackFailures ?? DEFAULT_MAX_CONSECUTIVE_CALLBACK_FAILURES;
    this.scheduleTimer =
      options.scheduleTimer ??
      ((callback, delayMs) => {
        const handle = setTimeout(callback, delayMs);
        handle.unref();
        return handle;
      });
    this.cancelTimer =
      options.cancelTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
    this.onDecisionDue = options.onDecisionDue;
    this.onTerminalFailure = options.onTerminalFailure;
    if (!Number.isSafeInteger(this.retryDelayMs) || this.retryDelayMs <= 0) {
      throw new Error('retryDelayMs 必须是正安全整数');
    }
    if (
      !Number.isSafeInteger(this.maxConsecutiveCallbackFailures) ||
      this.maxConsecutiveCallbackFailures <= 0
    ) {
      throw new Error('maxConsecutiveCallbackFailures 必须是正安全整数');
    }
  }

  requestMatch(matchIdInput: string): MachineDecisionScheduleRegistration {
    const matchId = normalizeRequiredValue(matchIdInput, 'matchId');
    const existing = this.activeByMatch.get(matchId);
    if (existing) {
      if (existing.running) existing.rerunRequested = true;
      return existing.registration;
    }
    return this.scheduleNew(matchId, 0, 0).registration;
  }

  cancelMatch(matchIdInput: string): boolean {
    const matchId = normalizeRequiredValue(matchIdInput, 'matchId');
    const active = this.activeByMatch.get(matchId);
    if (!active) return false;
    this.activeByMatch.delete(matchId);
    if (active.timerHandle) {
      this.cancelTimer(active.timerHandle);
      active.timerHandle = null;
    }
    return true;
  }

  isCurrent(registration: MachineDecisionScheduleRegistration): boolean {
    const current = this.activeByMatch.get(registration.matchId)?.registration;
    return (
      current?.registrationId === registration.registrationId &&
      current.runtimeEpoch === this.runtimeEpoch
    );
  }

  getCurrent(matchId: string): MachineDecisionScheduleRegistration | null {
    return this.activeByMatch.get(matchId)?.registration ?? null;
  }

  dispose(): void {
    for (const matchId of [...this.activeByMatch.keys()]) {
      this.cancelMatch(matchId);
    }
  }

  private scheduleNew(
    matchId: string,
    delayMs: number,
    consecutiveCallbackFailures: number,
    terminalFailureReason: MachineDecisionScheduleFailureReason | null = null
  ): ActiveMachineDecisionSchedule {
    const registration: MachineDecisionScheduleRegistration = {
      schemaVersion: MACHINE_DECISION_SCHEDULE_SCHEMA_VERSION,
      registrationId: `${this.runtimeEpoch}:${++this.registrationSequence}:${this.idGenerator()}`,
      runtimeEpoch: this.runtimeEpoch,
      matchId,
    };
    const active: ActiveMachineDecisionSchedule = {
      registration,
      timerHandle: null,
      running: false,
      rerunRequested: false,
      consecutiveCallbackFailures,
      terminalFailureReason,
    };
    this.activeByMatch.set(matchId, active);
    active.timerHandle = this.scheduleTimer(() => this.handleTimer(active), delayMs);
    active.timerHandle.unref?.();
    return active;
  }

  private handleTimer(active: ActiveMachineDecisionSchedule): void {
    if (!this.isCurrent(active.registration) || active.running) return;
    active.timerHandle = null;
    active.running = true;
    void this.runTimer(active);
  }

  private async runTimer(active: ActiveMachineDecisionSchedule): Promise<void> {
    if (active.terminalFailureReason) {
      await this.finishTerminalFailure(active, active.terminalFailureReason);
      return;
    }
    let result: MachineDecisionScheduleResult;
    try {
      result = await this.onDecisionDue(active.registration);
    } catch {
      this.finishFailedRun(active);
      return;
    }
    if (result === 'BLOCKED') {
      await this.finishTerminalFailure(active, 'BLOCKED');
      return;
    }
    this.finishRun(active, result);
  }

  private finishRun(
    active: ActiveMachineDecisionSchedule,
    result: MachineDecisionScheduleResult
  ): void {
    if (!this.isCurrent(active.registration)) return;
    const rerunRequested = active.rerunRequested;
    active.running = false;
    this.activeByMatch.delete(active.registration.matchId);
    if (
      result === 'PROGRESSED' ||
      result === 'RETRY' ||
      (rerunRequested && result !== 'TERMINAL')
    ) {
      this.scheduleNew(active.registration.matchId, result === 'RETRY' ? this.retryDelayMs : 0, 0);
    }
  }

  private finishFailedRun(active: ActiveMachineDecisionSchedule): void {
    if (!this.isCurrent(active.registration)) return;
    const failureCount = active.consecutiveCallbackFailures + 1;
    active.running = false;
    this.activeByMatch.delete(active.registration.matchId);
    if (failureCount < this.maxConsecutiveCallbackFailures) {
      this.scheduleNew(active.registration.matchId, this.retryDelayMs, failureCount);
      return;
    }
    this.scheduleNew(active.registration.matchId, 0, failureCount, 'CALLBACK_FAILURE_LIMIT');
  }

  private async finishTerminalFailure(
    active: ActiveMachineDecisionSchedule,
    reason: MachineDecisionScheduleFailureReason
  ): Promise<void> {
    try {
      await this.onTerminalFailure(active.registration, reason);
    } catch {
      if (!this.isCurrent(active.registration)) return;
      active.running = false;
      this.activeByMatch.delete(active.registration.matchId);
      this.scheduleNew(
        active.registration.matchId,
        this.retryDelayMs,
        active.consecutiveCallbackFailures,
        reason
      );
      return;
    }
    this.finishRun(active, 'TERMINAL');
  }
}

function normalizeRequiredValue(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} 不能为空`);
  return normalized;
}
