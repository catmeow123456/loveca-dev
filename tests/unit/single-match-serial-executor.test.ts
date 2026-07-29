import { describe, expect, it } from 'vitest';
import {
  SingleMatchSerialExecutor,
  type SingleMatchCriticalSection,
} from '../../src/server/ai-battle/single-match-serial-executor';

describe('SingleMatchSerialExecutor', () => {
  it('runs operations for one match in FIFO order without overlap', async () => {
    const executor = new SingleMatchSerialExecutor();
    const trace: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });

    const first = executor.runExclusive('match-a', async () => {
      trace.push('first:start');
      markFirstStarted();
      await firstGate;
      trace.push('first:end');
      return 1;
    });
    const second = executor.runExclusive('match-a', () => {
      trace.push('second');
      return 2;
    });

    await firstStarted;
    expect(trace).toEqual(['first:start']);
    expect(executor.hasPendingOperations('match-a')).toBe(true);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(trace).toEqual(['first:start', 'first:end', 'second']);
    await Promise.resolve();
    expect(executor.hasPendingOperations('match-a')).toBe(false);
  });

  it('does not let a rejected operation poison the following operation', async () => {
    const executor = new SingleMatchSerialExecutor();
    const rejected = executor.runExclusive('match-a', () => {
      throw new Error('expected failure');
    });
    const recovered = executor.runExclusive('match-a', () => 'recovered');

    await expect(rejected).rejects.toThrow('expected failure');
    await expect(recovered).resolves.toBe('recovered');
  });

  it('allows different matches to run concurrently', async () => {
    const executor = new SingleMatchSerialExecutor();
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = executor.runExclusive('match-a', async () => {
      started.push('a');
      await gate;
    });
    const second = executor.runExclusive('match-b', () => {
      started.push('b');
    });

    await second;
    expect(started).toEqual(['a', 'b']);
    release();
    await first;
  });

  it('reports the active match while an operation owns the critical section', async () => {
    const executor = new SingleMatchSerialExecutor();
    let completedSection: SingleMatchCriticalSection | null = null;
    await executor.runExclusive('match-a', (criticalSection) => {
      completedSection = criticalSection;
      expect(executor.isExecutingMatch('match-a', criticalSection)).toBe(true);
      expect(executor.isExecutingMatch('match-b', criticalSection)).toBe(false);
    });

    expect(executor.isExecutingMatch('match-a', completedSection)).toBe(false);
  });

  it('queues detached timer work until its parent critical section has finished', async () => {
    const executor = new SingleMatchSerialExecutor();
    const trace: string[] = [];
    let releaseParent!: () => void;
    let markTimerAttempted!: () => void;
    const parentGate = new Promise<void>((resolve) => {
      releaseParent = resolve;
    });
    const timerAttempted = new Promise<void>((resolve) => {
      markTimerAttempted = resolve;
    });
    let detached!: Promise<void>;

    const parent = executor.runExclusive('match-a', async () => {
      trace.push('parent:start');
      setTimeout(() => {
        markTimerAttempted();
        detached = executor.runExclusive('match-a', () => {
          trace.push('detached');
        });
      }, 0);
      await parentGate;
      trace.push('parent:end');
    });

    await timerAttempted;
    await Promise.resolve();
    expect(trace).toEqual(['parent:start']);
    releaseParent();
    await parent;
    await detached;
    expect(trace).toEqual(['parent:start', 'parent:end', 'detached']);
  });
});
