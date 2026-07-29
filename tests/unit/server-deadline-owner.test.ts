import { describe, expect, it, vi } from 'vitest';
import { createGameState, type GameState } from '../../src/domain/entities/game';
import {
  ServerDeadlineOwner,
  type ServerDeadlineTimerHandle,
} from '../../src/server/ai-battle/server-deadline-owner';

interface ManualTimerHandle extends ServerDeadlineTimerHandle {
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
    cancelTimer: (handle: ServerDeadlineTimerHandle) => {
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

function createDeadlineState(input: {
  readonly effectId?: string;
  readonly stepId?: string;
  readonly autoAdvanceAt: number;
  readonly kind?: 'CARD' | 'CHOICE';
}): GameState {
  const game = createGameState('deadline-owner', 'p1', 'P1', 'p2', 'P2');
  return {
    ...game,
    activeEffect: {
      id: input.effectId ?? 'effect-1',
      abilityId: 'deadline-test',
      sourceCardId: 'source-1',
      controllerId: 'p1',
      effectText: '公开展示',
      stepId: input.stepId ?? 'step-1',
      stepText: '等待公开展示结束',
      awaitingPlayerId: 'p1',
      ...(input.kind === 'CHOICE'
        ? { publicEffectChoiceAutoAdvanceAt: input.autoAdvanceAt }
        : { publicCardSelectionAutoAdvanceAt: input.autoAdvanceAt }),
    },
  };
}

describe('ServerDeadlineOwner', () => {
  it('reuses an unchanged registration and schedules it for the authoritative time', () => {
    const timers = createManualTimers();
    const owner = new ServerDeadlineOwner({
      now: () => 1_000,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'deadline-1',
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onDeadlineDue: vi.fn(),
    });
    const snapshot = {
      game: createDeadlineState({ autoAdvanceAt: 1_250 }),
      authorityRevision: 7,
    };

    const first = owner.reconcileMatch('match-a', snapshot);
    const reused = owner.reconcileMatch('match-a', snapshot);

    expect(reused).toEqual(first);
    expect(timers.count()).toBe(1);
    expect(timers.read(1)).toMatchObject({ delayMs: 250, cancelled: false });
  });

  it('replaces a registration after revision growth and ignores the cancelled callback', async () => {
    let now = 1_000;
    let idSequence = 0;
    const timers = createManualTimers();
    const onDeadlineDue = vi.fn();
    const owner = new ServerDeadlineOwner({
      now: () => now,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => `deadline-${++idSequence}`,
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onDeadlineDue,
    });
    const game = createDeadlineState({ autoAdvanceAt: 1_250 });
    const first = owner.reconcileMatch('match-a', { game, authorityRevision: 7 });
    const second = owner.reconcileMatch('match-a', { game, authorityRevision: 8 });
    if (!first || !second) throw new Error('missing registration');

    expect(second.registrationId).not.toBe(first.registrationId);
    expect(timers.read(1)?.cancelled).toBe(true);
    now = 1_250;
    timers.fire(1, { evenIfCancelled: true });
    await Promise.resolve();
    expect(onDeadlineDue).not.toHaveBeenCalled();

    timers.fire(2);
    await Promise.resolve();
    expect(onDeadlineDue).toHaveBeenCalledOnce();
    expect(onDeadlineDue).toHaveBeenCalledWith(second);
  });

  it('cancels a removed window and rejects a late callback from the old runtime', async () => {
    let now = 1_000;
    const timers = createManualTimers();
    const onDeadlineDue = vi.fn();
    const owner = new ServerDeadlineOwner({
      now: () => now,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'deadline-1',
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onDeadlineDue,
    });
    const game = createDeadlineState({
      autoAdvanceAt: 1_100,
      kind: 'CHOICE',
    });
    const registration = owner.reconcileMatch('match-a', {
      game,
      authorityRevision: 7,
    });
    if (!registration) throw new Error('missing registration');

    owner.reconcileMatch('match-a', {
      game: { ...game, activeEffect: null },
      authorityRevision: 8,
    });
    now = 1_100;
    timers.fire(1, { evenIfCancelled: true });
    await Promise.resolve();

    expect(owner.isCurrent(registration)).toBe(false);
    expect(onDeadlineDue).not.toHaveBeenCalled();
  });

  it('retries a still-current due registration after callback failure', async () => {
    let now = 1_000;
    const timers = createManualTimers();
    const owner = new ServerDeadlineOwner({
      now: () => now,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'deadline-1',
      retryDelayMs: 50,
      scheduleTimer: timers.scheduleTimer,
      cancelTimer: timers.cancelTimer,
      onDeadlineDue: () => {
        throw new Error('temporary failure');
      },
    });
    owner.reconcileMatch('match-a', {
      game: createDeadlineState({ autoAdvanceAt: 1_100 }),
      authorityRevision: 7,
    });

    now = 1_100;
    timers.fire(1);

    await vi.waitFor(() => {
      expect(timers.read(2)).toMatchObject({ delayMs: 50, cancelled: false });
    });
  });
});
