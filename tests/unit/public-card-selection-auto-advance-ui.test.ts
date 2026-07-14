import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveEffectViewState } from '../../src/online/types';
import {
  buildPublicCardSelectionDisplayEntries,
  isPublicCardSelectionAutoAdvanceView,
  PUBLIC_CARD_SELECTION_FALLBACK_DELAY_MS,
  schedulePublicCardSelectionAutoAdvance,
} from '../../client/src/lib/publicCardSelectionAutoAdvance';

function effect(overrides: Partial<ActiveEffectViewState> = {}): ActiveEffectViewState {
  return {
    id: 'effect-1',
    abilityId: 'test:effect',
    sourceObjectId: 'obj_source',
    controllerSeat: 'FIRST',
    effectText: '测试效果',
    stepId: 'COMMON_PUBLIC_CARD_SELECTION_CONFIRMATION',
    stepText: '即将自动继续处理',
    waitingSeat: 'FIRST',
    revealedObjectIds: ['obj_target-b', 'obj_target-a'],
    publicCardSelectionAutoAdvanceAt: 12_000,
    publicCardSelectionAutoAdvanceAfterMs: 2_000,
    publicCardSelectionOrdered: true,
    ...overrides,
  };
}

describe('public card selection auto-advance UI model', () => {
  afterEach(() => vi.useRealTimers());

  it('identifies the dedicated display and preserves ordered card labels', () => {
    const view = effect();
    expect(isPublicCardSelectionAutoAdvanceView(view)).toBe(true);
    expect(PUBLIC_CARD_SELECTION_FALLBACK_DELAY_MS).toBe(5_000);
    expect(buildPublicCardSelectionDisplayEntries(view)).toEqual([
      { cardId: 'target-b', order: 1 },
      { cardId: 'target-a', order: 2 },
    ]);
    expect(
      buildPublicCardSelectionDisplayEntries(effect({ publicCardSelectionOrdered: false }))
    ).toEqual([
      { cardId: 'target-b', order: null },
      { cardId: 'target-a', order: null },
    ]);
  });

  it('requests automatic advance once at the projected delay and cancels stale timers', () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const cancel = schedulePublicCardSelectionAutoAdvance(2_000, advance);

    vi.advanceTimersByTime(1_999);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(advance).toHaveBeenCalledTimes(1);

    const staleAdvance = vi.fn();
    const cancelStale = schedulePublicCardSelectionAutoAdvance(2_000, staleAdvance);
    cancelStale();
    vi.advanceTimersByTime(2_000);
    expect(staleAdvance).not.toHaveBeenCalled();
    cancel();
  });
});
