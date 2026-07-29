import { describe, expect, it, vi } from 'vitest';
import {
  MachineDecisionScheduler,
  type MachineDecisionTimerHandle,
} from '../../src/server/ai-battle/machine-decision-scheduler';

interface ManualTimerHandle extends MachineDecisionTimerHandle {
  readonly id: number;
}

function createManualTimers() {
  let sequence = 0;
  const jobs = new Map<
    number,
    { readonly callback: () => void; readonly delayMs: number; cancelled: boolean }
  >();
  return {
    scheduleTimer: (callback: () => void, delayMs: number): ManualTimerHandle => {
      const id = ++sequence;
      jobs.set(id, { callback, delayMs, cancelled: false });
      return { id };
    },
    cancelTimer: (handle: MachineDecisionTimerHandle) => {
      const job = jobs.get((handle as ManualTimerHandle).id);
      if (job) job.cancelled = true;
    },
    fire: (id: number, options: { readonly evenIfCancelled?: boolean } = {}) => {
      const job = jobs.get(id);
      if (!job) throw new Error(`missing timer ${id}`);
      if (!job.cancelled || options.evenIfCancelled) job.callback();
    },
    read: (id: number) => jobs.get(id) ?? null,
    count: () => sequence,
  };
}

describe('MachineDecisionScheduler', () => {
  it('coalesces repeated requests and performs one decision per timer turn', async () => {
    const timers = createManualTimers();
    const onDecisionDue = vi.fn().mockResolvedValueOnce('PROGRESSED').mockResolvedValueOnce('IDLE');
    const scheduler = new MachineDecisionScheduler({
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'schedule',
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onDecisionDue,
      onTerminalFailure: vi.fn(),
    });

    const first = scheduler.requestMatch('match-a');
    const reused = scheduler.requestMatch('match-a');
    expect(reused).toEqual(first);
    expect(timers.count()).toBe(1);

    timers.fire(1);
    await vi.waitFor(() => expect(timers.count()).toBe(2));
    expect(onDecisionDue).toHaveBeenCalledTimes(1);

    timers.fire(2);
    await vi.waitFor(() => expect(onDecisionDue).toHaveBeenCalledTimes(2));
    expect(scheduler.getCurrent('match-a')).toBeNull();
  });

  it('honors a request raised while the callback is still running', async () => {
    const timers = createManualTimers();
    let finishFirst!: (result: 'IDLE') => void;
    const firstResult = new Promise<'IDLE'>((resolve) => {
      finishFirst = resolve;
    });
    const onDecisionDue = vi.fn().mockReturnValueOnce(firstResult).mockResolvedValueOnce('IDLE');
    const scheduler = new MachineDecisionScheduler({
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'schedule',
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onDecisionDue,
      onTerminalFailure: vi.fn(),
    });

    scheduler.requestMatch('match-a');
    timers.fire(1);
    await vi.waitFor(() => expect(onDecisionDue).toHaveBeenCalledOnce());
    scheduler.requestMatch('match-a');
    finishFirst('IDLE');

    await vi.waitFor(() => expect(timers.count()).toBe(2));
    timers.fire(2);
    await vi.waitFor(() => expect(onDecisionDue).toHaveBeenCalledTimes(2));
  });

  it('cancels pending work and ignores a late callback from the old registration', async () => {
    const timers = createManualTimers();
    const onDecisionDue = vi.fn();
    const scheduler = new MachineDecisionScheduler({
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'schedule',
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onDecisionDue,
      onTerminalFailure: vi.fn(),
    });
    const registration = scheduler.requestMatch('match-a');

    scheduler.cancelMatch('match-a');
    timers.fire(1, { evenIfCancelled: true });
    await Promise.resolve();

    expect(timers.read(1)?.cancelled).toBe(true);
    expect(scheduler.isCurrent(registration)).toBe(false);
    expect(onDecisionDue).not.toHaveBeenCalled();
  });

  it('bounds unexpected callback failure retries', async () => {
    const timers = createManualTimers();
    const onTerminalFailure = vi.fn();
    const scheduler = new MachineDecisionScheduler({
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'schedule',
      retryDelayMs: 50,
      maxConsecutiveCallbackFailures: 2,
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onDecisionDue: () => {
        throw new Error('unexpected scheduler failure');
      },
      onTerminalFailure,
    });
    scheduler.requestMatch('match-a');

    timers.fire(1);
    await vi.waitFor(() => {
      expect(timers.read(2)).toMatchObject({ delayMs: 50, cancelled: false });
    });
    timers.fire(2);
    await vi.waitFor(() => {
      expect(timers.read(3)).toMatchObject({ delayMs: 0, cancelled: false });
    });
    timers.fire(3);
    await vi.waitFor(() => expect(scheduler.getCurrent('match-a')).toBeNull());
    expect(timers.count()).toBe(3);
    expect(onTerminalFailure).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: 'match-a' }),
      'CALLBACK_FAILURE_LIMIT'
    );
  });

  it('routes BLOCKED decisions to terminal failure handling instead of parking the match', async () => {
    const timers = createManualTimers();
    const onTerminalFailure = vi.fn();
    const scheduler = new MachineDecisionScheduler({
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'schedule',
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onDecisionDue: () => 'BLOCKED',
      onTerminalFailure,
    });
    scheduler.requestMatch('match-a');

    timers.fire(1);
    await vi.waitFor(() => expect(scheduler.getCurrent('match-a')).toBeNull());
    expect(onTerminalFailure).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: 'match-a' }),
      'BLOCKED'
    );
  });

  it('retries terminal failure handling when the terminal callback itself fails', async () => {
    const timers = createManualTimers();
    const onTerminalFailure = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary terminal failure'))
      .mockResolvedValueOnce(undefined);
    const scheduler = new MachineDecisionScheduler({
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'schedule',
      retryDelayMs: 50,
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onDecisionDue: () => 'BLOCKED',
      onTerminalFailure,
    });
    scheduler.requestMatch('match-a');

    timers.fire(1);
    await vi.waitFor(() => {
      expect(timers.read(2)).toMatchObject({ delayMs: 50, cancelled: false });
    });
    timers.fire(2);
    await vi.waitFor(() => expect(scheduler.getCurrent('match-a')).toBeNull());
    expect(onTerminalFailure).toHaveBeenCalledTimes(2);
  });
});
